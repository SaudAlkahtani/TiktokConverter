import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { run, probe, render } from '../src/ffmpeg.js';

test('native resolution, rotation, HDR, and audio timing survive the export pipeline', async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'luna-export-test-'));
  const fixture = async (name, size, extra = [], frames = '8') => {
    const target = path.join(folder, name);
    await run(config.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=60`,
      '-frames:v', frames, '-c:v', 'libx264', '-preset', 'ultrafast', ...extra, '-y', target]);
    return target;
  };
  try {
    for (const [width, height] of [[1080, 1920], [1440, 2560], [1728, 3072], [2160, 3840], [640, 360]]) {
      await t.test(`preserves ${width}x${height}`, async () => {
        const input = await fixture(`${width}.mkv`, `${width}x${height}`);
        const result = await render({ input, output: path.join(folder, `${width}.mp4`), options: { timestampScale: 1 } });
        assert.equal(result.width, width); assert.equal(result.height, height);
        assert.equal(result.codec, 'hevc'); assert.equal(result.fps, '60/1');
        assert.ok(Math.abs(result.duration - 8 / 60) < 0.04);
      });
    }
    await t.test('preserves odd dimensions without rounding', async () => {
      const input = path.join(folder, 'odd.mkv');
      await run(config.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=321x481:rate=60', '-frames:v', '8', '-c:v', 'ffv1', '-pix_fmt', 'yuv444p', '-y', input]);
      const result = await render({ input, output: path.join(folder, 'odd.mp4'), options: { timestampScale: 1 } });
      assert.equal(result.width, 321); assert.equal(result.height, 481); assert.equal(result.pixelFormat, 'yuv444p');
      assert.ok(result.warnings.some(x => x.includes('4:4:4')));
    });
    await t.test('bakes portrait rotation into correctly oriented pixels', async () => {
      const input = await fixture('unrotated.mp4', '640x360');
      const rotated = path.join(folder, 'rotated.mp4');
      await run(config.ffmpeg, ['-v', 'error', '-display_rotation', '90', '-i', input, '-c', 'copy', '-y', rotated]);
      const result = await render({ input: rotated, output: path.join(folder, 'portrait.mp4'), options: { timestampScale: 1 } });
      assert.equal(result.width, 360); assert.equal(result.height, 640); assert.equal(result.rotation, 0);
    });
    for (const transfer of ['smpte2084', 'arib-std-b67']) {
      await t.test(`tone maps ${transfer} and preserves 10-bit precision`, async () => {
        const input = await fixture(`${transfer}.mkv`, '320x240', ['-pix_fmt', 'yuv420p10le', '-color_primaries', 'bt2020', '-color_trc', transfer, '-colorspace', 'bt2020nc']);
        const result = await render({ input, output: path.join(folder, `${transfer}.mp4`), options: { timestampScale: 1 } });
        assert.equal(result.colorTransfer, 'bt709'); assert.equal(result.colorPrimaries, 'bt709');
        assert.equal(result.pixelFormat, 'yuv420p10le'); assert.ok(result.warnings.some(x => x.includes('HDR')));
      });
    }
    await t.test('half-speed sound and video have matching durations', async () => {
      const input = path.join(folder, 'audio-input.mkv');
      await run(config.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=60', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'pcm_s16le', '-y', input]);
      for (const timestampScale of [1, 2]) {
        const result = await render({ input, output: path.join(folder, `audio-${timestampScale}.mp4`), options: { timestampScale, sharpen: false } });
        assert.ok(Math.abs(result.duration - 2 * timestampScale) < 0.07);
        assert.ok(Math.abs(result.audio.duration - result.duration) < 0.1);
        assert.equal(result.audio.codec, 'aac'); assert.equal(result.audio.channels, 2);
      }
    });
    await t.test('rejects a non-video file', async () => {
      const input = path.join(folder, 'text.mp4'); await fs.writeFile(input, 'not a video');
      await assert.rejects(probe(input), /ffprobe failed/);
    });
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});
