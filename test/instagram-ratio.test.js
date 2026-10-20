import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { render } from '../src/ffmpeg.js';

test('Instagram exports have square pixels and a 9:16 display ratio', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'instagram-ratio-'));
  try {
    for (const [name, size, sar] of [['landscape', '320x180', '1'], ['portrait', '180x320', '1'], ['square', '180x180', '1'], ['anamorphic', '320x180', '2']]) {
      const input = path.join(folder, `${name}.mp4`);
      const output = path.join(folder, `${name}-out.mp4`);
      const fixture = spawnSync(config.ffmpeg, ['-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30`, '-vf', `setsar=${sar}`, '-t', '0.2', '-c:v', 'libx264', input], { windowsHide: true });
      assert.equal(fixture.status, 0, fixture.stderr?.toString());
      const result = await render({ input, output, platform: 'instagram' });
      assert.equal(result.width, 1080, name);
      assert.equal(result.height, 1920, name);
      assert.equal(result.sampleAspectRatio, '1:1', name);
      assert.equal(result.displayAspectRatio, '9:16', name);
      assert.equal(result.fps, '60/1', name);
    }
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
