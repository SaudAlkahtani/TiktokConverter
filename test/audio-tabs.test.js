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

test('standalone TikTok and Instagram both preserve normal audio timing', async () => {
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
    const tiktok = await render({ input, output: tiktokPath, platform: 'tiktok' });
    const instagram = await render({ input, output: instagramPath, platform: 'instagram' });

    assert.ok(Math.abs(tiktok.duration - 0.8) < 0.2, `TikTok video: ${tiktok.duration}`);
    const tiktokAudio = audioDuration(tiktokPath);
    assert.ok(Math.abs(tiktokAudio - 0.8) < 0.2, `TikTok audio duration: ${tiktokAudio}`);
    assert.ok(Math.abs(instagram.duration - 0.8) < 0.2, `Instagram video: ${instagram.duration}`);
    assert.ok(Math.abs(audioDuration(instagramPath) - 0.8) < 0.2, 'Instagram audio must stay at source duration');
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('all converter tabs describe the experimental platform profiles', async () => {
  for (const page of ['index.html', 'instagram.html', 'both.html', 'editor.html', 'vertical-test.html']) {
    const html = await fs.readFile(path.join(config.root, 'public', page), 'utf8');
    assert.match(html, /NEW BRANCH — TEST CAREFULLY/i, page);
    assert.match(html, /1080/i, page);
    if (page === 'instagram.html') {
      assert.match(html, /30 fps/i, page);
      assert.match(html, /normal speed/i, page);
    } else assert.match(html, /2×|half speed/i, page);
    assert.doesNotMatch(html, /HEVC/i, page);
  }
});
