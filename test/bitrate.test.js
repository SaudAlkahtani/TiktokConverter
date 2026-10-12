import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config, bitrateFor } from "../src/config.js";
import { render } from "../src/ffmpeg.js";

test("resolution-based rate limits work for portrait and landscape", () => {
  for (const [width, height, bitrate, bufsize] of [
    [640, 360, "18M", "36M"],
    [1920, 1080, "18M", "36M"],
    [1080, 1920, "18M", "36M"],
    [2560, 1082, "28M", "56M"],
    [2560, 1440, "28M", "56M"],
    [1440, 2560, "28M", "56M"],
    [3000, 1600, "45M", "90M"],
    [3840, 2160, "45M", "90M"],
    [2160, 3840, "45M", "90M"]
  ]) {
    assert.deepEqual(bitrateFor({ width, height }), { bitrate, maxrate: bitrate, bufsize });
  }
});

function run(command, args) {
  const result = spawnSync(command, args, { windowsHide: true, encoding: "utf8" });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  return result.stdout;
}

test("real export keeps baseline HEVC, 60 fps, timestamp scaling and AAC audio", async () => {
  assert.equal(config.inputTimestampScale, 2);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "converter-bitrate-test-"));
  try {
    const input = path.join(directory, "input.mp4");
    const output = path.join(directory, "output.mp4");
    run(config.ffmpeg, [
      "-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=60",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "0.5",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", input
    ]);
    await render({ input, output, onProgress: () => {} });
    const info = JSON.parse(run(config.ffprobe, ["-v", "error", "-show_streams", "-of", "json", output]));
    const video = info.streams.find((stream) => stream.codec_type === "video");
    const audio = info.streams.find((stream) => stream.codec_type === "audio");
    assert.equal(video.codec_name, "hevc");
    assert.equal(video.codec_tag_string, "hvc1");
    assert.equal(video.width, 320);
    assert.equal(video.height, 180);
    assert.equal(video.r_frame_rate, "60/1");
    assert.ok(Number(video.duration) >= 0.9 && Number(video.duration) <= 1.1, video.duration);
    assert.equal(audio.codec_name, "aac");
    assert.equal(audio.sample_rate, "48000");
    assert.equal(audio.channels, 2);
    run(config.ffmpeg, ["-v", "error", "-i", output, "-map", "0:a:0", "-f", "null", "-"]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
