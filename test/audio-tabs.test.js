import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { render } from '../src/ffmpeg.js';

const audioDuration = (file) => {
  const result = spawnSync(config.ffprobe, [
    '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return Number(result.stdout.trim());
};

test('standalone TikTok uses the locked scaled-input method while Instagram stays normal', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'converter-audio-tabs-'));
  try {
    const input = path.join(folder, 'input.mp4');
    const fixture = spawnSync(config.ffmpeg, [
      '-y', '-f', 'lavfi', '-i', 'testsrc2=size=180x320:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '0.8', '-c:v', 'libx264', '-c:a', 'aac', input
    ], { windowsHide: true });
    assert.equal(fixture.status, 0, fixture.stderr?.toString());

    const tiktokPath = path.join(folder, 'tiktok.mp4');
    const instagramPath = path.join(folder, 'instagram.mp4');
    const tiktok = await render({ input, output: tiktokPath, platform: 'tiktok', timestampScale: 2 });
    const instagram = await render({ input, output: instagramPath, platform: 'instagram' });

    assert.ok(Math.abs(tiktok.duration - 1.6) < 0.2, `TikTok video: ${tiktok.duration}`);
    const tiktokAudio = audioDuration(tiktokPath);
    assert.ok(Math.abs(tiktokAudio - 1.6) < 0.2, `TikTok scaled-input audio duration: ${tiktokAudio}`);
    assert.ok(Math.abs(instagram.duration - 0.8) < 0.2, `Instagram video: ${instagram.duration}`);
    assert.ok(Math.abs(audioDuration(instagramPath) - 0.8) < 0.2, 'Instagram audio must stay at source duration');
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('TikTok tabs describe the locked scaled-input method without changing Instagram', async () => {
  for (const page of ['index.html', 'both.html', 'editor.html']) {
    const html = await fs.readFile(path.join(config.root, 'public', page), 'utf8');
    assert.match(html, /2×/i, page);
    assert.match(html, /audio/i, page);
    assert.doesNotMatch(html, /original.speed audio/i, page);
  }
  const instagram = await fs.readFile(path.join(config.root, 'public', 'instagram.html'), 'utf8');
  assert.match(instagram, /original.speed AAC stereo audio/i);
});
