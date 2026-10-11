import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export function run(command, args, onData = () => {}, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-1000000); onData(chunk.toString()); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-6000); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`Media tool exited (${code}): ${stderr.slice(-1800)}`)));
  });
}

export async function probe(input) {
  let info;
  try { info = JSON.parse(await run(config.ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", input])); }
  catch { throw new Error("ffprobe failed: this file could not be read as video."); }
  const video = info.streams?.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  if (!video?.width || !video?.height) throw new Error("No readable video stream was found in this file.");
  const rotation = Number(video.side_data_list?.find((s) => s.rotation !== undefined)?.rotation || video.tags?.rotate || 0);
  const swapped = Math.abs(rotation % 180) === 90;
  const audio = info.streams.find((s) => s.codec_type === "audio");
  return {
    width: swapped ? video.height : video.width, height: swapped ? video.width : video.height,
    codedWidth: video.width, codedHeight: video.height, rotation, streamIndex: video.index,
    fps: video.avg_frame_rate !== "0/0" ? video.avg_frame_rate : video.r_frame_rate,
    duration: Number(video.duration || info.format?.duration || 0),
    codec: video.codec_name, pixelFormat: video.pix_fmt, sampleAspectRatio: video.sample_aspect_ratio,
    frames: Number(video.nb_frames || 0),
    colorSpace: video.color_space, colorTransfer: video.color_transfer, colorPrimaries: video.color_primaries,
    colorRange: video.color_range,
    audio: audio ? { index: audio.index, codec: audio.codec_name, channels: audio.channels, duration: Number(audio.duration || info.format?.duration || 0) } : null
  };
}

export function buildRenderArgs(media, input, output, options = {}) {
  const timestampScale = Number(options.timestampScale ?? config.inputTimestampScale);
  if (![1, 2].includes(timestampScale)) throw new Error('Choose normal or half-speed playback.');
  if (timestampScale === 2 && !(media.duration > 0)) throw new Error('A readable video duration is required for half-speed playback.');
  const resolution = options.resolution ?? config.export.resolution;
  if (![0, 1080, 1440, 2160].includes(resolution)) throw new Error('Choose original, 1080p, 1440p, or 4K.');
  if (Math.min(media.width, media.height) < 16) throw new Error('H.264 requires dimensions of at least 16 pixels.');
  const factor = resolution ? Math.min(1, resolution / Math.min(media.width, media.height)) : 1;
  const width = Math.floor(media.width * factor / 2) * 2;
  const height = Math.floor(media.height * factor / 2) * 2;
  const rate = options.rate || { targetFps: media.fps || '60', frameFilter: `fps=${media.fps || '60'}` };
  const [num, den = '1'] = rate.targetFps.split('/');
  const fps = Number(num) / Number(den);
  if (!Number.isFinite(fps) || fps <= 0 || fps > 120.5) throw new Error('Invalid measured frame rate.');
  const sizeClass = resolution || (Math.min(width, height) <= 1080 ? 1080 : Math.min(width, height) <= 1440 ? 1440 : 2160);
  let maxrate = { 1080: 18, 1440: 28, 2160: 45 }[sizeClass];
  if (Math.round(fps) > 60) maxrate = Math.floor(maxrate * Math.round(fps) / 30);
  const hdr = ["smpte2084", "arib-std-b67"].includes(media.colorTransfer);
  const warnings = [];
  if (media.width % 2 || media.height % 2) warnings.push('Odd dimensions rounded down to even pixels for H.264 4:2:0.');
  if (/10|12|16|p010/.test(media.pixelFormat || '')) warnings.push('Khaled preparation produces 8-bit H.264, including from 10-bit sources.');
  if (rate.vfr) warnings.push(`Variable frame rate normalized to ${rate.targetFps} fps; frames can repeat or drop.`);
  if (timestampScale === 2) warnings.push('Half speed doubles duration and duplicates frames to retain the output frame rate; it does not interpolate new motion.');
  const filters = ["setpts=PTS-STARTPTS"];
  if (hdr) {
    const transfer = media.colorTransfer === "smpte2084" ? "smpte2084" : "arib-std-b67";
    filters.push(`zscale=pin=${media.colorPrimaries || "bt2020"}:tin=${transfer}:min=${media.colorSpace || "bt2020nc"}:rin=${media.colorRange === "pc" ? "full" : "limited"}:t=linear:npl=100`,
      "format=gbrpf32le", "zscale=p=bt709", "tonemap=tonemap=mobius:desat=2", "zscale=t=bt709:m=bt709:r=limited");
    warnings.push("HDR converted to SDR Rec.709. Review highlights before publishing.");
  } else {
    const known = (value) => value && !["unknown", "unspecified", "reserved"].includes(value);
    const primaries = known(media.colorPrimaries) ? media.colorPrimaries : "bt709";
    const transfer = known(media.colorTransfer) ? media.colorTransfer : "bt709";
    const matrix = known(media.colorSpace) ? media.colorSpace : "bt709";
    filters.push(`zscale=pin=${primaries}:tin=${transfer}:min=${matrix}:rin=${media.colorRange === "pc" ? "full" : "limited"}:p=bt709:t=bt709:m=bt709:r=limited`);
    if (!known(media.colorTransfer)) warnings.push("Untagged footage assumed SDR Rec.709; apply the correct camera LUT to log footage before upload.");
  }
  if (width !== media.width || height !== media.height) filters.push(`scale=${width}:${height}:flags=lanczos`);
  // Upstream's setpts=N/(fps)/TB conform filter would erase -itsscale.
  // Half speed must use the rescaled input timeline, then sample it at target fps.
  // Pad the final picture briefly and trim to the expected timeline so the last
  // frame receives its full duration even when only packet PTS was rescaled.
  filters.push(...(timestampScale === 2 ? [`fps=${rate.targetFps}`, `tpad=stop_mode=clone:stop_duration=${2 / fps}`] : [rate.frameFilter]), 'setsar=0', 'format=yuv420p');
  const args = ["-hide_banner", "-y", '-itsscale', String(timestampScale), "-i", input,
    "-map", `0:${media.streamIndex}`, ...(media.audio ? ["-map", `0:${media.audio.index}`] : []),
    "-vf", filters.join(","), "-c:v", "libx264", "-preset", config.export.preset, '-profile:v', 'high',
    "-crf", String(config.export.crf), '-maxrate', `${maxrate}M`, '-bufsize', `${maxrate * 2}M`,
    '-bf', '0', '-g', String(Math.round(fps) * 2), "-pix_fmt", 'yuv420p',
    "-r", rate.targetFps, "-fps_mode", "cfr",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-map_metadata", "-1", "-map_chapters", "-1", "-tag:v", "avc1", "-movflags", "+write_colr", "-write_tmcd", "0"];
  if (media.audio) args.push('-af', timestampScale === 2 ? 'asetpts=N/SR/TB,atempo=0.5' : 'asetpts=PTS-STARTPTS', "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2");
  if (timestampScale === 2) args.push('-t', String(media.duration * timestampScale));
  args.push("-progress", "pipe:1", "-nostats", output);
  return { args, warnings, width, height, targetFps: rate.targetFps, maxrate, timestampScale, pixelFormat: 'yuv420p' };
}

export async function runBridge(args) {
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1',
    HQ_FFMPEG: config.ffmpeg, HQ_FFPROBE: config.ffprobe };
  try { return JSON.parse(await run(config.python, ['-X', 'utf8', path.join(config.root, 'scripts', 'khaled-bridge.py'), ...args], () => {}, env)); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('Python 3.10+ is required. Install Python on Windows or set PYTHON_PATH in .env.');
    throw error;
  }
}

export async function render({ input, output, onProgress = () => {}, onStage = () => {}, options = {} }) {
  onStage('Measuring source frame rate');
  const source = await probe(input);
  const rate = await runBridge(['rate', input]);
  const settings = buildRenderArgs(source, input, '', { ...options, rate });
  const folder = await fs.mkdtemp(path.join(path.dirname(output), '.khaled-'));
  const prepared = path.join(folder, 'prep.mp4');
  const { args } = buildRenderArgs(source, input, prepared, { ...options, rate });
  const { warnings, width, height, targetFps, maxrate, timestampScale } = settings;
  const expectedDuration = source.duration * timestampScale;
  let buffer = "";
  try {
    onStage('Preparing H.264 video');
    await run(config.ffmpeg, args, (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/); buffer = lines.pop();
      for (const line of lines) {
        const [key, value] = line.split("=");
        if (key === "out_time_us" && expectedDuration) onProgress(Math.min(90, Math.max(0, Math.round(Number(value) / 1000000 / expectedDuration * 90))));
      }
    });
    const result = await probe(prepared);
    const numberRate = (value) => { const [n, d = 1] = value.split('/').map(Number); return n / d; };
    if (result.width !== width || result.height !== height || Math.abs(numberRate(result.fps) - numberRate(targetFps)) > 0.01 || result.codec !== 'h264') throw new Error('Prepared output failed dimension, codec, or frame-rate validation.');
    const targetNumber = Number(targetFps.split('/')[0]) / Number(targetFps.split('/')[1] || 1);
    const expectedFrames = timestampScale === 2 || rate.frameFilter.startsWith('fps=') ? Math.round(expectedDuration * targetNumber)
      : Math.ceil(rate.sourceFrames * targetNumber / numberRate(rate.sourceFps));
    if (Math.abs(result.frames - expectedFrames) > 2) throw new Error('Prepared video frame count differs unexpectedly from the source.');
    if (Math.abs(result.duration - expectedDuration) > Math.max(0.05, 2 / targetNumber, expectedDuration * 0.002)) throw new Error('Prepared video duration differs unexpectedly from the selected playback speed.');
    const expectedAudioDuration = timestampScale === 2 ? Math.min(source.audio?.duration * timestampScale, expectedDuration) : source.audio?.duration;
    if (source.audio && (!result.audio || Math.abs(result.audio.duration - expectedAudioDuration) > Math.max(0.1, expectedDuration * 0.002))) throw new Error('Prepared audio duration differs unexpectedly from the selected playback speed.');
    onProgress(92); onStage('Patching MP4 and validating pictures, timing and audio');
    const patch = await runBridge(['patch', prepared, output, targetFps]);
    const stat = await fs.stat(output);
    warnings.push('Experimental MP4 ghost-sample patch: some players report misleading frame counts or decoding warnings. Upload results depend on TikTok.');
    return { ...result, source, warnings, timestampScale, targetFps, maxrate: `${maxrate}M`, patch, bytes: stat.size, output: path.basename(output) };
  } catch (error) {
    await fs.rm(output, { force: true });
    throw error;
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
}

export async function validateTools() {
  await run(config.ffmpeg, ["-version"]);
  await run(config.ffprobe, ["-version"]);
  await run(config.python, ['-c', 'import sys; assert sys.version_info >= (3,10), "Python 3.10+ required"']);
}
