import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { probe, render } from '../src/ffmpeg.js';
import { renderEdit, validateEditSettings } from '../src/editor.js';
import { assertColorInput, assertRec709Output, colorProfile } from '../src/color-safety.js';

const run = args => {
  const result = spawnSync(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true });
  assert.equal(result.status, 0, result.stderr?.toString());
};

const centerPixel = (file, width, height) => {
  const result = spawnSync(config.ffmpeg, ['-v', 'error', '-i', file, '-frames:v', '1',
    '-vf', `crop=2:2:${Math.floor(width / 2) - 1}:${Math.floor(height / 2) - 1},format=rgb24`,
    '-f', 'rawvideo', '-'], { windowsHide: true });
  assert.equal(result.status, 0, result.stderr?.toString());
  return [...result.stdout.subarray(0, 3)];
};

test('color policy refuses unsafe relabeling and validates all output tags', () => {
  assert.equal(colorProfile({}), 'untagged-sdr-assumed');
  assert.equal(colorProfile({ colorPrimaries: 'bt709', colorTransfer: 'bt709', colorSpace: 'bt709' }), 'rec709');
  const bt2020Sdr = { colorPrimaries: 'bt2020', colorTransfer: 'bt2020-10', colorSpace: 'bt2020nc' };
  assert.throws(() => assertColorInput(bt2020Sdr), /Rec.709 SDR master/);
  assert.throws(() => assertColorInput(bt2020Sdr, { allowHdr: true }), /white-balance shift/);
  const hdr = { colorPrimaries: 'bt2020', colorTransfer: 'arib-std-b67', colorSpace: 'bt2020nc' };
  assert.equal(assertColorInput(hdr, { allowHdr: true }), 'hdr-bt2020');
  assert.throws(() => assertColorInput(hdr), /Rec.709 SDR master/);
  assert.throws(() => assertColorInput({ colorPrimaries: 'bt709', colorTransfer: 'bt709' , colorSpace: 'bt2020nc' }), /Rec.709 SDR master/);
  assert.throws(() => assertRec709Output({ colorPrimaries: 'bt709', colorTransfer: 'bt709' }), /consistent Rec.709/);
});

test('all three exports keep a neutral gray reference neutral', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'converter-color-safety-'));
  try {
    const input = path.join(folder, 'neutral.mp4');
    run(['-f', 'lavfi', '-i', 'color=c=gray:s=160x288:r=30:d=0.2', '-c:v', 'libx264',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', input]);
    const source = await probe(input);
    const original = centerPixel(input, source.width, source.height);
    const outputs = [
      { name: 'tiktok', run: output => render({ input, output, platform: 'tiktok' }) },
      { name: 'instagram', run: output => render({ input, output, platform: 'instagram' }) },
      { name: 'editor', run: output => renderEdit({ input, output, settings: validateEditSettings({ blurRegions: [] }, source.duration) }) }
    ];
    for (const item of outputs) {
      const output = path.join(folder, `${item.name}.mp4`);
      await item.run(output);
      const media = await probe(output);
      assert.doesNotThrow(() => assertRec709Output(media), item.name);
      const pixel = centerPixel(output, media.width, media.height);
      assert.ok(Math.max(...pixel) - Math.min(...pixel) <= 5, `${item.name} introduced a color cast: ${pixel}`);
      assert.ok(pixel.every((channel, index) => Math.abs(channel - original[index]) <= 12), `${item.name} shifted neutral gray: ${original} to ${pixel}`);
    }
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('BT.2020 SDR is rejected before rendering on each route', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'converter-color-reject-'));
  try {
    const input = path.join(folder, 'bt2020.mp4');
    run(['-f', 'lavfi', '-i', 'color=c=gray:s=160x288:r=30:d=0.2', '-c:v', 'libx264',
      '-colorspace', 'bt2020nc', '-color_primaries', 'bt2020', '-color_trc', 'bt2020-10', input]);
    for (const platform of ['tiktok', 'instagram']) {
      const output = path.join(folder, `${platform}.mp4`);
      await assert.rejects(render({ input, output, platform }), /Rec.709 SDR master/);
      await assert.rejects(fs.stat(output), { code: 'ENOENT' });
    }
    const media = await probe(input);
    const output = path.join(folder, 'editor.mp4');
    await assert.rejects(renderEdit({ input, output, settings: validateEditSettings({ blurRegions: [] }, media.duration) }), /Rec.709 SDR master/);
    await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('supported HDR tone mapping keeps a neutral reference neutral in Instagram and editor', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'converter-hdr-neutral-'));
  try {
    const input = path.join(folder, 'hlg.mp4');
    run(['-f', 'lavfi', '-i', 'color=c=gray:s=160x288:r=30:d=0.2', '-c:v', 'libx264',
      '-colorspace', 'bt2020nc', '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', input]);
    const source = await probe(input);
    assert.equal(colorProfile(source), 'hdr-bt2020');
    const outputs = [
      { name: 'instagram', run: output => render({ input, output, platform: 'instagram' }) },
      { name: 'editor', run: output => renderEdit({ input, output, settings: validateEditSettings({ blurRegions: [] }, source.duration) }) }
    ];
    for (const item of outputs) {
      const output = path.join(folder, `${item.name}.mp4`);
      const result = await item.run(output);
      assert.equal(result.colorCheck, 'hdr-bt2020');
      const media = await probe(output);
      assertRec709Output(media);
      const pixel = centerPixel(output, media.width, media.height);
      assert.ok(Math.max(...pixel) - Math.min(...pixel) <= 5, `${item.name} introduced a color cast: ${pixel}`);
    }
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
