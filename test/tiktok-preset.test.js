import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { render } from '../src/ffmpeg.js';
import { assertTikTokPresetEnvironment, buildTikTokArgs, TIKTOK_PRESET } from '../src/tiktok-preset.js';

test('TikTok FFmpeg arguments match commit 6378e68 exactly', () => {
  assert.deepEqual(TIKTOK_PRESET, {
    timestampScale: 2, videoCodec: 'libx265', bitrate: '20M', gop: 60,
    sharpen: 'unsharp=3:3:0.4:3:3:0.4', audioBitrate: '256k'
  });
  assert.deepEqual(buildTikTokArgs('input.mp4', 'output.mp4'), [
    '-hide_banner', '-y', '-itsscale', '2', '-i', 'input.mp4',
    '-map', '0:v:0', '-map', '0:a?',
    '-vf', 'fps=60,unsharp=3:3:0.4:3:3:0.4',
    '-c:v', 'libx265', '-b:v', '20M', '-g', '60',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-tag:v', 'hvc1', '-movflags', '+faststart', '-write_tmcd', '0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
    '-progress', 'pipe:1', '-nostats', 'output.mp4'
  ]);
});

test('conflicting TikTok environment overrides are rejected', () => {
  assert.doesNotThrow(() => assertTikTokPresetEnvironment({ VIDEO_CODEC: 'libx265', VIDEO_BITRATE: '20M' }));
  for (const [key, value] of [
    ['VIDEO_CODEC', 'hevc_nvenc'], ['VIDEO_BITRATE', '10M'], ['VIDEO_GOP', '30'],
    ['VIDEO_SHARPEN', 'unsharp=5:5:1'], ['VIDEO_TIMESTAMP_SCALE', '1']
  ]) assert.throws(() => assertTikTokPresetEnvironment({ [key]: value }), new RegExp(key));
});

test('TikTok render produces the locked HEVC/AAC profile', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'tiktok-locked-preset-'));
  try {
    const input = path.join(folder, 'source.mp4');
    const output = path.join(folder, 'output.mp4');
    const fixture = spawnSync(config.ffmpeg, [
      '-y', '-f', 'lavfi', '-i', 'testsrc2=size=180x320:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '0.8', '-c:v', 'libx264', '-c:a', 'aac', input
    ], { windowsHide: true });
    assert.equal(fixture.status, 0, fixture.stderr?.toString());
    await render({ input, output, onProgress: () => {}, timestampScale: 2, encoder: 'nvidia' });
    const result = spawnSync(config.ffprobe, [
      '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,codec_tag_string,pix_fmt,r_frame_rate,color_space,color_primaries,color_transfer,sample_rate,channels,duration',
      '-of', 'json', output
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const info = JSON.parse(result.stdout);
    const video = info.streams.find(stream => stream.codec_type === 'video');
    const audio = info.streams.find(stream => stream.codec_type === 'audio');
    assert.equal(video.codec_name, 'hevc');
    assert.equal(video.codec_tag_string, 'hvc1');
    assert.equal(video.pix_fmt, 'yuv420p');
    assert.equal(video.r_frame_rate, '60/1');
    assert.equal(video.color_space, 'bt709');
    assert.equal(video.color_primaries, 'bt709');
    assert.equal(video.color_transfer, 'bt709');
    assert.equal(audio.codec_name, 'aac');
    assert.equal(audio.sample_rate, '48000');
    assert.equal(audio.channels, 2);
    assert.ok(Math.abs(Number(info.format.duration) - 1.6) < 0.2);
    assert.ok(Math.abs(Number(audio.duration) - 1.6) < 0.2);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
