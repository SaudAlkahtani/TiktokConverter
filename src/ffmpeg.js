import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { buildTikTokArgs, TIKTOK_PRESET } from './tiktok-preset.js';

const run = async (command, args) => {
  const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(`${command} exited with code ${code}: ${stderr.slice(-1800)}`);
};

export async function probe(input) {
  const child = spawn(config.ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,color_transfer,color_primaries,color_space,pix_fmt,codec_tag_string,sample_rate,channels", "-of", "json", input], { windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(`ffprobe failed: ${stderr}`);
  const info = JSON.parse(stdout);
  const video = info.streams.find((stream) => stream.codec_type === "video") || {};
  const audio = info.streams.find((stream) => stream.codec_type === "audio");
  if (!video.width || !video.height) throw new Error("No readable video stream was found in this file.");
  return { duration: Number(info.format?.duration || 0), width: video.width, height: video.height, fps: video.r_frame_rate, hasAudio: Boolean(audio), videoCodec: video.codec_name, pixelFormat: video.pix_fmt, videoTag: video.codec_tag_string, audioCodec: audio?.codec_name, audioSampleRate: audio?.sample_rate, audioChannels: audio?.channels, colorTransfer: video.color_transfer, colorPrimaries: video.color_primaries, colorSpace: video.color_space };
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

export async function render({ input, output, onProgress, signal }) {
  throwIfAborted(signal);
  const media = await probe(input);
  throwIfAborted(signal);
  const expectedDuration = media.duration * TIKTOK_PRESET.timestampScale;
  const args = buildTikTokArgs(input, output);
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
    if (result.videoCodec !== 'hevc' || result.fps !== '60/1' || result.pixelFormat !== 'yuv420p' || result.videoTag !== 'hvc1' || result.colorSpace !== 'bt709' || result.colorPrimaries !== 'bt709' || result.colorTransfer !== 'bt709' || (media.hasAudio && (result.audioCodec !== 'aac' || result.audioSampleRate !== '48000' || result.audioChannels !== 2))) throw new Error('TikTok export does not match the locked commit 6378e68 profile.');
    return { ...result, encoder: TIKTOK_PRESET.videoCodec, bytes: stat.size, output: path.basename(output) };
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
