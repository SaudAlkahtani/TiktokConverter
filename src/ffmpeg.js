import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { encoderArgs, encoderPixelFormat, isTenBit, selectEncoder, encodeWithFallback } from "./encoders.js";

export function run(command, args, onData = () => {}, timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-1000000); onData(chunk.toString()); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-6000); });
    let timedOut = false;
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs) : null;
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('Media tool compatibility check timed out.'));
      else if (code === 0) resolve(stdout);
      else reject(new Error(`Media tool exited (${code}): ${stderr.slice(-1800)}`));
    });
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
    colorSpace: video.color_space, colorTransfer: video.color_transfer, colorPrimaries: video.color_primaries,
    colorRange: video.color_range,
    audio: audio ? { index: audio.index, codec: audio.codec_name, channels: audio.channels, duration: Number(audio.duration || info.format?.duration || 0) } : null
  };
}

export function buildRenderArgs(media, input, output, options = {}) {
  const timestampScale = Number(options.timestampScale ?? config.inputTimestampScale);
  if (![1, 2].includes(timestampScale)) throw new Error("Playback must be normal speed or half speed.");
  if (Math.min(media.width, media.height) < 16) throw new Error("HEVC requires dimensions of at least 16 pixels.");
  const odd = media.width % 2 || media.height % 2;
  const encoder = options.encoder ?? 'cpu';
  const pixelFormat = encoderPixelFormat(media, encoder);
  const hdr = ["smpte2084", "arib-std-b67"].includes(media.colorTransfer);
  const warnings = [];
  if (odd) warnings.push("Odd dimensions preserved with HEVC 4:4:4; some players and upload services may not support this format.");
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
  filters.push("fps=60");
  if (options.sharpen !== false) filters.push(config.export.sharpen);
  filters.push(`format=${pixelFormat}`);
  const args = ["-hide_banner", "-y", "-itsscale", String(timestampScale), "-i", input,
    "-map", `0:${media.streamIndex}`, ...(media.audio ? ["-map", `0:${media.audio.index}`] : []),
    "-vf", filters.join(","), ...encoderArgs(encoder), "-pix_fmt", pixelFormat,
    "-r", "60", "-fps_mode", "cfr", "-video_track_timescale", "60000",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-map_metadata", "-1", "-map_chapters", "-1", "-tag:v", "hvc1", "-movflags", "+faststart", "-write_tmcd", "0"];
  // Scaling packet timestamps alone leaves audio gaps. Rebuild sample timestamps
  // and stretch the sound while preserving pitch to match the video duration.
  if (media.audio) args.push("-af", `asetpts=N/SR/TB,atempo=${1 / timestampScale}`, "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2");
  args.push("-progress", "pipe:1", "-nostats", output);
  return { args, warnings, timestampScale, pixelFormat };
}

export async function checkHardwareEncoder(encoder, media) {
  await run(config.ffmpeg, ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i',
    `color=size=${media.width}x${media.height}:rate=60`, '-frames:v', '2',
    '-vf', `format=${encoderPixelFormat(media, encoder)}`, ...encoderArgs(encoder),
    '-pix_fmt', encoderPixelFormat(media, encoder), '-f', 'null', '-'], () => {}, 15000);
}

export async function render({ input, output, onProgress = () => {}, onEncoder = () => {}, options = {} }) {
  const source = await probe(input);
  const requestedEncoder = options.encoder ?? 'cpu';
  // Validate playback and dimensions before attempting a hardware check.
  const { warnings, timestampScale } = buildRenderArgs(source, input, output, { ...options, encoder: 'cpu' });
  const selection = await selectEncoder(source, requestedEncoder, checkHardwareEncoder);
  const expectedDuration = source.duration * timestampScale;
  let buffer = "";
  try {
    const actual = await encodeWithFallback(selection, async (encoder) => {
      buffer = ''; onProgress(0);
      const { args } = buildRenderArgs(source, input, output, { ...options, encoder });
      await run(config.ffmpeg, args, (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/); buffer = lines.pop();
        for (const line of lines) {
          const [key, value] = line.split("=");
          if (key === "out_time_us" && expectedDuration) onProgress(Math.min(99, Math.max(0, Math.round(Number(value) / 1000000 / expectedDuration * 100))));
        }
      });
    }, onEncoder);
    const result = await probe(output);
    if (result.width !== source.width || result.height !== source.height || result.fps !== "60/1") throw new Error("Output validation failed: dimensions or frame rate changed unexpectedly.");
    if (result.codec !== 'hevc' || isTenBit(result) !== isTenBit(source)) throw new Error('Output validation failed: codec or bit depth changed unexpectedly.');
    const stat = await fs.stat(output);
    return { ...result, source, warnings: [...warnings, ...actual.warnings], encoder: actual.encoder, requestedEncoder, timestampScale, bytes: stat.size, output: path.basename(output) };
  } catch (error) {
    await fs.rm(output, { force: true });
    throw error;
  }
}

export async function validateTools() {
  await run(config.ffmpeg, ["-version"]);
  await run(config.ffprobe, ["-version"]);
}
