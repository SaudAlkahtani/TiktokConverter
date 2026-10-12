import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { config, bitrateFor } from "./config.js";

const run = async (command, args) => {
  const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(`${command} exited with code ${code}: ${stderr.slice(-1800)}`);
};

export async function probe(input) {
  const child = spawn(config.ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", input], { windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(`ffprobe failed: ${stderr}`);
  const info = JSON.parse(stdout);
  const video = info.streams.find((stream) => stream.codec_type === "video" && !stream.disposition?.attached_pic) || {};
  if (!video.width || !video.height) throw new Error("No readable video stream was found in this file.");
  const rotation = Number(video.side_data_list?.find((item) => item.rotation !== undefined)?.rotation || video.tags?.rotate || 0);
  const swapped = Math.abs(rotation % 180) === 90;
  const audio = info.streams.find((stream) => stream.codec_type === "audio");
  return { duration: Number(video.duration || info.format?.duration || 0),
    width: swapped ? video.height : video.width, height: swapped ? video.width : video.height,
    fps: video.avg_frame_rate !== "0/0" ? video.avg_frame_rate : video.r_frame_rate,
    codec: video.codec_name, audio: audio ? { codec: audio.codec_name, channels: audio.channels, duration: Number(audio.duration || info.format?.duration || 0) } : null };
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

export function buildRenderArgs(media, input, output) {
  if (![1, 2].includes(config.inputTimestampScale)) throw new Error('VIDEO_TIMESTAMP_SCALE must be 1 or 2.');
  const filters = [
    'setpts=PTS-STARTPTS',
    "fps=60",
    ...(config.inputTimestampScale === 2 ? ['tpad=stop_mode=clone:stop_duration=0.034'] : []),
    config.export.sharpen
  ].filter(Boolean).join(",");
  const rates = bitrateFor(media);
  return [
    "-hide_banner", "-y", "-itsscale", String(config.inputTimestampScale), "-i", input,
    "-map", "0:v:0", "-map", "0:a?",
    "-vf", filters,
    "-c:v", config.export.videoCodec, "-b:v", rates.bitrate, "-maxrate", rates.maxrate, "-bufsize", rates.bufsize, "-g", String(config.export.gop),
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-tag:v", "hvc1", "-movflags", "+faststart", "-write_tmcd", "0", "-pix_fmt", "yuv420p",
    '-af', `asetpts=N/SR/TB,atempo=${1 / config.inputTimestampScale}`,
    "-c:a", "aac", "-b:a", config.export.audioBitrate, "-ar", "48000", "-ac", "2",
    '-t', String(media.duration * config.inputTimestampScale),
    "-progress", "pipe:1", "-nostats", output
  ];
}

export async function render({ input, output, onProgress = () => {}, signal }) {
  throwIfAborted(signal);
  const media = await probe(input);
  throwIfAborted(signal);
  const expectedDuration = media.duration * config.inputTimestampScale;
  const args = buildRenderArgs(media, input, output);
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
    const result = await probe(output);
    const [fpsN, fpsD = 1] = result.fps.split("/").map(Number);
    if (result.width !== media.width || result.height !== media.height || Math.abs(fpsN / fpsD - 60) > 0.01 || Math.abs(result.duration - expectedDuration) > Math.max(0.1, expectedDuration * 0.005)) {
      throw new Error("Output did not retain the source dimensions, expected duration, or 60fps.");
    }
    const stat = await fs.stat(output);
    return { ...result, timestampScale: config.inputTimestampScale, source: media, ...bitrateFor(media), bytes: stat.size, output: path.basename(output) };
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
