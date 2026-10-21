import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { config, bitrateFor } from "./config.js";
import { buildTikTokArgs, TIKTOK_PRESET } from './tiktok-preset.js';

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
    codec: video.codec_name, pixelFormat: video.pix_fmt, videoTag: video.codec_tag_string, colorSpace: video.color_space, colorPrimaries: video.color_primaries, colorTransfer: video.color_transfer, audio: audio ? { codec: audio.codec_name, channels: audio.channels, sampleRate: audio.sample_rate, duration: Number(audio.duration || info.format?.duration || 0) } : null };
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
  return buildTikTokArgs(input, output);
}

export async function render({ input, output, onProgress = () => {}, signal }) {
  throwIfAborted(signal);
  const media = await probe(input);
  throwIfAborted(signal);
  const expectedDuration = media.duration * TIKTOK_PRESET.timestampScale;
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
    if (result.width !== media.width || result.height !== media.height || Math.abs(fpsN / fpsD - 60) > 0.01 || Math.abs(result.duration - expectedDuration) > Math.max(0.1, expectedDuration * 0.005) || result.codec !== 'hevc' || result.pixelFormat !== 'yuv420p' || result.videoTag !== 'hvc1' || result.colorSpace !== 'bt709' || result.colorPrimaries !== 'bt709' || result.colorTransfer !== 'bt709' || (media.audio && (result.audio?.codec !== 'aac' || result.audio?.channels !== 2 || result.audio?.sampleRate !== '48000'))) {
      throw new Error("TikTok export did not match the locked commit 6378e68 profile.");
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
