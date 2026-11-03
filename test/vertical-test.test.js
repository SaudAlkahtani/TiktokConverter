import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { probe, render } from '../src/ffmpeg.js';
import { buildVerticalTestArgs, verticalTestProfile } from '../src/vertical-test.js';

function fixture(args) {
  const result = spawnSync(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('vertical test selects cadence and bitrate from average frame rate', () => {
  for (const [rate, fps, bitrateMbps] of [['30000/1001', 30, 15], ['30/1', 30, 15], ['60000/1001', 60, 25], ['60/1', 60, 25], ['120/1', 60, 25], ['24/1', 30, 15]]) {
    const profile = verticalTestProfile({ fps: '120/1', averageFrameRate: rate });
    assert.equal(profile.fps, fps, rate);
    assert.equal(profile.bitrateMbps, bitrateMbps, rate);
    const args = buildVerticalTestArgs('input.mp4', 'output.mp4', {}, profile);
    assert.equal(args[args.indexOf('-b:v') + 1], `${bitrateMbps}M`);
    assert.equal(args[args.indexOf('-maxrate') + 1], `${bitrateMbps}M`);
    assert.equal(args[args.indexOf('-r') + 1], String(fps));
    assert.match(args[args.indexOf('-vf') + 1], /pad=1080:1920/);
  }
  assert.throws(() => verticalTestProfile({ fps: '0/0' }), /frame rate/);
});

test('test UI identifies the experimental branch on every tab', async () => {
  for (const name of ['index', 'instagram', 'both', 'editor', 'vertical-test']) {
    const html = await fs.readFile(path.join(config.root, 'public', `${name}.html`), 'utf8');
    assert.match(html, /NEW BRANCH — TEST CAREFULLY/, name);
    assert.match(html, /href="\/vertical-test"/, name);
  }
  const html = await fs.readFile(path.join(config.root, 'public', 'vertical-test.html'), 'utf8');
  assert.match(html, /25 Mb\/s/);
  assert.match(html, /15 Mb\/s/);
});

test('30 fps landscape and 60 fps 4K exports are vertical, correctly tagged, and normal speed', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'vertical-export-test-'));
  try {
    for (const [name, size, rate, bitrate] of [['landscape30', '320x180', 30, 15], ['fourk60', '3840x2160', 60, 25]]) {
      const input = path.join(folder, `${name}.mp4`), output = path.join(folder, `${name}-out.mp4`);
      fixture(['-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${rate}:duration=0.25`,
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.25',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac',
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', input]);
      const source = await probe(input);
      const result = await render({ input, output, platform: 'vertical-test' });
      assert.equal(result.width, 1080, name);
      assert.equal(result.height, 1920, name);
      assert.equal(result.displayAspectRatio, '9:16', name);
      assert.equal(result.sampleAspectRatio, '1:1', name);
      assert.equal(result.fps, `${rate}/1`, name);
      assert.equal(result.targetVideoBitrateMbps, bitrate, name);
      assert.equal(result.videoCodec, 'h264', name);
      assert.equal(result.videoTag, 'avc1', name);
      assert.equal(result.colorPrimaries, 'bt709', name);
      assert.equal(result.colorTransfer, 'bt709', name);
      assert.equal(result.colorSpace, 'bt709', name);
      assert.equal(result.audioCodec, 'aac', name);
      assert.equal(result.audioSampleRate, '48000', name);
      assert.equal(result.audioChannels, 2, name);
      assert.ok(Math.abs(result.duration - source.duration) < 0.2, `${name} changed playback duration`);
    }
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('BT.2020 SDR source is transformed to Rec.709 in the new mode', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'vertical-bt2020-test-'));
  try {
    const input = path.join(folder, 'bt2020.mp4'), output = path.join(folder, 'output.mp4');
    fixture(['-f', 'lavfi', '-i', 'color=c=gray:s=160x288:r=30:d=0.2', '-c:v', 'libx264',
      '-colorspace', 'bt2020nc', '-color_primaries', 'bt2020', '-color_trc', 'bt2020-10', input]);
    const result = await render({ input, output, platform: 'vertical-test' });
    assert.equal(result.colorCheck, 'sdr-bt2020');
    assert.equal(result.colorPrimaries, 'bt709');
    assert.equal(result.colorTransfer, 'bt709');
    assert.equal(result.colorSpace, 'bt709');
    const pixel = spawnSync(config.ffmpeg, ['-v', 'error', '-i', output, '-frames:v', '1',
      '-vf', 'crop=2:2:539:959,format=rgb24', '-f', 'rawvideo', '-'], { windowsHide: true });
    assert.equal(pixel.status, 0, pixel.stderr?.toString());
    const rgb = [...pixel.stdout.subarray(0, 3)];
    assert.ok(Math.max(...rgb) - Math.min(...rgb) <= 5, `Neutral reference acquired a cast: ${rgb}`);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
