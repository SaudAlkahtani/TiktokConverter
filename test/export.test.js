import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { run, probe, render } from '../src/ffmpeg.js';

test('Khaled preparation and ghost-sample patch preserve real pictures and normal playback', async (t) => {
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
        const result = await render({ input, output: path.join(folder, `${width}.mp4`), options: { resolution: 0 } });
        assert.equal(result.width, width); assert.equal(result.height, height);
        assert.equal(result.codec, 'h264'); assert.ok(result.patch.validated);
        assert.equal(result.patch.stats.original_frames, 8); assert.equal(result.patch.stats.declared_frames, 80);
        assert.equal(result.patch.decodedPicturesMatch, true);
        assert.ok(Math.abs(result.duration - 8 / 60) < 0.04);
      });
    }
    await t.test('rounds odd dimensions for 8-bit H.264', async () => {
      const input = path.join(folder, 'odd.mkv');
      await run(config.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=321x481:rate=60', '-frames:v', '8', '-c:v', 'ffv1', '-pix_fmt', 'yuv444p', '-y', input]);
      const result = await render({ input, output: path.join(folder, 'odd.mp4'), options: { resolution: 0 } });
      assert.equal(result.width, 320); assert.equal(result.height, 480); assert.equal(result.pixelFormat, 'yuv420p');
      assert.ok(result.warnings.some(x => x.includes('Odd dimensions')));
    });
    await t.test('bakes portrait rotation into correctly oriented pixels', async () => {
      const input = await fixture('unrotated.mp4', '640x360');
      const rotated = path.join(folder, 'rotated.mp4');
      await run(config.ffmpeg, ['-v', 'error', '-display_rotation', '90', '-i', input, '-c', 'copy', '-y', rotated]);
      const result = await render({ input: rotated, output: path.join(folder, 'portrait.mp4') });
      assert.equal(result.width, 360); assert.equal(result.height, 640); assert.equal(result.rotation, 0);
    });
    for (const transfer of ['smpte2084', 'arib-std-b67']) {
      await t.test(`tone maps ${transfer} into 8-bit`, async () => {
        const input = await fixture(`${transfer}.mkv`, '320x240', ['-pix_fmt', 'yuv420p10le', '-color_primaries', 'bt2020', '-color_trc', transfer, '-colorspace', 'bt2020nc']);
        const result = await render({ input, output: path.join(folder, `${transfer}.mp4`) });
        assert.equal(result.colorTransfer, 'bt709'); assert.equal(result.colorPrimaries, 'bt709');
        assert.equal(result.pixelFormat, 'yuv420p'); assert.ok(result.warnings.some(x => x.includes('HDR')));
      });
    }
    await t.test('normal-speed sound and video have matching durations', async () => {
      const input = path.join(folder, 'audio-input.mkv');
      await run(config.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=60', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'pcm_s16le', '-y', input]);
      {
        const result = await render({ input, output: path.join(folder, 'audio.mp4') });
        assert.ok(Math.abs(result.duration - 2) < 0.07);
        assert.ok(Math.abs(result.audio.duration - result.duration) < 0.1);
        assert.equal(result.audio.codec, 'aac'); assert.equal(result.audio.channels, 2);
        assert.equal(result.patch.decodedAudioMatch, true);
      }
    });
    await t.test('1080p choice downsizes 3K without upscaling smaller clips', async () => {
      const input = await fixture('3k.mkv', '1728x3072');
      const result = await render({ input, output: path.join(folder, '1080.mp4'), options: { resolution: 1080 } });
      assert.equal(result.width, 1080); assert.equal(result.height, 1920);
      assert.equal(result.maxrate, '18M');
    });
    for (const fps of [24, 30, 60, 120]) {
      await t.test(`preserves ${fps} real fps and normal duration`, async () => {
        const input = path.join(folder, `fps-${fps}.mp4`);
        await run(config.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=320x240:rate=${fps}`, '-frames:v', String(fps), '-c:v', 'libx264', '-y', input]);
        const result = await render({ input, output: path.join(folder, `patched-${fps}.mp4`) });
        assert.equal(result.targetFps, String(fps));
        assert.equal(result.patch.stats.original_frames, fps);
        assert.ok(Math.abs(result.duration - 1) < 0.02);
      });
    }
    await t.test('normalizes variable-rate video and reduces 240fps by an integer factor', async () => {
      const vfr = path.join(folder, 'vfr.mkv');
      await run(config.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=60', '-t', '1',
        '-vf', "select='not(mod(n,2))+not(mod(n,5))'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-y', vfr]);
      const variable = await render({ input: vfr, output: path.join(folder, 'vfr-patched.mp4') });
      assert.ok(variable.patch.validated); assert.ok(variable.warnings.some(x => x.includes('Variable frame')));
      const high = path.join(folder, '240.mp4');
      await run(config.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=240', '-frames:v', '240', '-c:v', 'libx264', '-y', high]);
      const reduced = await render({ input: high, output: path.join(folder, '240-patched.mp4') });
      assert.equal(reduced.targetFps, '120'); assert.equal(reduced.patch.stats.original_frames, 120);
    });
    await t.test('rejects a non-video file', async () => {
      const input = path.join(folder, 'text.mp4'); await fs.writeFile(input, 'not a video');
      await assert.rejects(probe(input), /ffprobe failed/);
    });
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});
