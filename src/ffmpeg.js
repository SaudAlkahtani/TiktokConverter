import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

const run = async (command, args) => {
  const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(`${command} exited with code ${code}: ${stderr.slice(-1800)}`);
};

export async function probe(input) {
  const child = spawn(config.ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate", "-of", "json", input], { windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(`ffprobe failed: ${stderr}`);
  const info = JSON.parse(stdout);
  const video = info.streams.find((stream) => stream.codec_type === "video") || {};
  if (!video.width || !video.height) throw new Error("No readable video stream was found in this file.");
  return { duration: Number(info.format?.duration || 0), width: video.width, height: video.height, fps: video.r_frame_rate };
}

export async function render({ input, output, onProgress }) {
  const media = await probe(input);
  const filters = [
    "scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2",
    "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black",
    "setsar=1",
    "fps=60",
    config.export.sharpen,
    "format=yuv420p"
  ].filter(Boolean).join(",");
  const args = [
    "-hide_banner", "-y", "-itsscale", String(config.inputTimestampScale), "-i", input,
    "-map", "0:v:0", "-map", "0:a?",
    "-vf", filters,
    "-c:v", "libx264", "-preset", "slow", "-b:v", config.export.bitrate,
    "-maxrate", config.export.maxrate, "-bufsize", config.export.bufsize,
    "-profile:v", "high", "-level:v", "4.2", "-pix_fmt", "yuv420p",
    "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
    "-r", "60", "-fps_mode", "cfr", "-video_track_timescale", "60000", "-tag:v", "avc1",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", "-write_tmcd", "0", "-progress", "pipe:1", "-nostats", output
  ];
  const child = spawn(config.ffmpeg, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  let buffer = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      const [key, value] = line.split("=");
      if (key === "out_time_ms" && media.duration) onProgress(Math.min(99, Math.max(0, Math.round((Number(value) / 1000000 / media.duration) * 100))));
    }
  });
  const [code] = await once(child, "close");
  if (code !== 0) {
    await fs.rm(output, { force: true });
    throw new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-1800)}`);
  }
  const stat = await fs.stat(output);
  return { ...media, bytes: stat.size, output: path.basename(output) };
}

export async function validateTools() {
  await run(config.ffmpeg, ["-version"]);
  await run(config.ffprobe, ["-version"]);
}
