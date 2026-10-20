import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { selectEncoder } from './encoders.js';

const run = async (command, args) => {
  const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(`${command} exited with code ${code}: ${stderr.slice(-1800)}`);
};

export async function probe(input) {
  const child = spawn(config.ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate,sample_aspect_ratio,display_aspect_ratio,color_transfer,color_primaries,color_space", "-of", "json", input], { windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(`ffprobe failed: ${stderr}`);
  const info = JSON.parse(stdout);
  const video = info.streams.find((stream) => stream.codec_type === "video") || {};
  if (!video.width || !video.height) throw new Error("No readable video stream was found in this file.");
  return { duration: Number(info.format?.duration || 0), width: video.width, height: video.height, fps: video.r_frame_rate, hasAudio: info.streams.some((stream) => stream.codec_type === 'audio'), sampleAspectRatio: video.sample_aspect_ratio, displayAspectRatio: video.display_aspect_ratio, colorTransfer: video.color_transfer, colorPrimaries: video.color_primaries, colorSpace: video.color_space };
}

export class RenderCancelledError extends Error {
  constructor() {
    super("Conversion was cancelled.");
    this.name = "RenderCancelledError";
  }
}

const throwIfAborted = (signal) => {
  if (signal?.aborted) throw new RenderCancelledError();
};

export async function render({ input, output, onProgress = () => {}, signal, platform = "tiktok", timestampScale = config.inputTimestampScale, encoder = 'cpu' }) {
  throwIfAborted(signal);
  const media = await probe(input);
  throwIfAborted(signal);
  // -itsscale changes the output timeline. Progress arrives in output time, so
  // compare it with the scaled duration rather than the source duration.
  const instagram = platform === "instagram";
  const selected = await selectEncoder(encoder, instagram ? 'h264' : 'hevc');
  const expectedDuration = media.duration * (instagram ? 1 : timestampScale);
  const filters = [
    "fps=60",
    config.export.sharpen
  ].filter(Boolean).join(",");
  const args = instagram ? buildInstagramArgs(input, output, media, selected.encoder) : [
    "-hide_banner", "-y", "-itsscale", String(timestampScale), "-i", input,
    "-map", "0:v:0", "-map", "0:a?",
    "-vf", filters,
    "-c:v", selected.encoder, "-b:v", config.export.bitrate, "-g", String(config.export.gop),
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-tag:v", "hvc1", "-movflags", "+faststart", "-write_tmcd", "0", "-pix_fmt", "yuv420p",
    ...(media.hasAudio && timestampScale === 2 ? ['-af', 'asetpts=N/SR/TB,atempo=0.5'] : []),
    "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2",
    "-progress", "pipe:1", "-nostats", output
  ];
  const child = spawn(config.ffmpeg, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const stop = () => child.kill();
  signal?.addEventListener("abort", stop, { once: true });
  let stderr = "";
  let buffer = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      const [key, value] = line.split("=");
      if (key === "out_time_ms" && expectedDuration) onProgress(Math.min(99, Math.max(0, Math.round((Number(value) / 1000000 / expectedDuration) * 100))));
    }
  });
  try {
    const [code] = await once(child, "close");
    throwIfAborted(signal);
    if (code !== 0) throw new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-1800)}`);
    const stat = await fs.stat(output);
    const result = await probe(output);
    if (instagram && (result.width !== 1080 || result.height !== 1920 || result.sampleAspectRatio !== '1:1' || result.displayAspectRatio !== '9:16' || result.fps !== '30/1' || Math.abs(result.duration - media.duration) > 0.2)) throw new Error('Instagram export failed dimensions, frame rate or duration validation.');
    return { ...result, platform, encoder: selected.encoder, bytes: stat.size, output: path.basename(output) };
  } catch (error) {
    await fs.rm(output, { force: true });
    throw error;
  } finally {
    signal?.removeEventListener("abort", stop);
  }
}

export async function validateTools() {
  await run(config.ffmpeg, ["-version"]);
  await run(config.ffprobe, ["-version"]);
}

// Practical Reels preset; pad rather than crop the source picture.
export function buildInstagramArgs(input, output, media = {}, videoEncoder = 'libx264') {
  const hdr = ["smpte2084", "arib-std-b67"].includes(media.colorTransfer);
  const colorFilter = hdr ? `zscale=pin=${media.colorPrimaries || "bt2020"}:tin=${media.colorTransfer}:min=${media.colorSpace || "bt2020nc"}:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:desat=2,zscale=t=bt709:m=bt709:r=limited,` : "";
  return ['-hide_banner', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', colorFilter + 'scale=trunc(iw*sar/2)*2:ih,setsar=1,scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p',
    '-c:v', videoEncoder, ...(videoEncoder === 'libx264' ? ['-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-level:v', '4.1', '-keyint_min', '60', '-sc_threshold', '0', '-flags', '+cgop'] : ['-b:v', '12M']), '-maxrate', '12M', '-bufsize', '24M', '-g', '60',
    '-r', '30', '-fps_mode', 'cfr', '-pix_fmt', 'yuv420p', '-tag:v', 'avc1',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', '-use_editlist', '0',
    '-progress', 'pipe:1', '-nostats', output];
}
