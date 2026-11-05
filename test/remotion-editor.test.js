import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {config} from '../src/config.js';
import {probe, render} from '../src/ffmpeg.js';
import {renderEdit, validateEditSettings} from '../src/editor.js';

test('edit plan validates timed Remotion titles', () => {
  const base = {segments: [{sourceIndex: 0, start: 0, end: 2}], blurRegions: [],
    motionTitles: [{text: 'Squats', start: 0.2, end: 1.6, position: 'bottom', color: '#ffffff'}]};
  assert.equal(validateEditSettings(base, [2]).motionTitles[0].text, 'Squats');
  assert.throws(() => validateEditSettings({...base, motionTitles: [{...base.motionTitles[0], end: 3}]}, [2]), /Motion title/);
  assert.throws(() => validateEditSettings({...base, motionTitles: [{...base.motionTitles[0], color: 'red'}]}, [2]), /hex color/);
});

test('editor, Remotion titles, and both final converters keep timing and audio', {timeout: 180000}, async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'remotion-editor-test-'));
  const input = path.join(folder, 'source.mp4'), output = path.join(folder, 'titled-master.mp4');
  try {
    const child = spawn(config.ffmpeg, ['-v','error','-y','-f','lavfi','-i','color=c=gray:s=360x640:r=60:d=0.4',
      '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.4',
      '-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',
      '-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709',input], {windowsHide: true});
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; }); child.stdout.resume();
    assert.equal((await once(child, 'close'))[0], 0, stderr);
    const settings = validateEditSettings({segments: [{sourceIndex: 0, start: 0, end: 0.4}], blurRegions: [],
      autoFaces: false, encoder: 'cpu', motionTitles: [{text: 'Workout', start: 0, end: 0.35,
        position: 'bottom', color: '#ffffff', background: true, fontSize: 72}]}, [await probe(input)]);
    await renderEdit({inputPaths: [input], output, settings});
    const result = await probe(output);
    assert.equal(result.width, 360);
    assert.equal(result.height, 640);
    assert.equal(result.fps, '60/1');
    assert.equal(result.audioCodec, 'aac');
    assert.equal(result.colorPrimaries, 'bt709');
    const frame = spawn(config.ffmpeg, ['-v','error','-ss','0.18','-i',output,'-frames:v','1',
      '-f','rawvideo','-pix_fmt','rgb24','pipe:1'], {windowsHide: true});
    const pixels = [];
    frame.stdout.on('data', chunk => pixels.push(chunk)); frame.stderr.resume();
    assert.equal((await once(frame, 'close'))[0], 0);
    const rgb = Buffer.concat(pixels);
    const neutral = (40 * 360 + 40) * 3;
    assert.ok(Math.abs(rgb[neutral] - rgb[neutral + 1]) < 6 &&
      Math.abs(rgb[neutral + 1] - rgb[neutral + 2]) < 6, 'Remotion shifted neutral source color.');
    let bright = 0;
    for (let pixel = 360 * 430; pixel < 360 * 640; pixel++) {
      const offset = pixel * 3;
      if (rgb[offset] > 220 && rgb[offset + 1] > 220 && rgb[offset + 2] > 220) bright++;
    }
    assert.ok(bright > 150, `Expected visible white title pixels near the bottom, found ${bright}.`);
    const tiktok = await render({input: output, output: path.join(folder, 'tiktok.mp4'), platform: 'tiktok'});
    const instagram = await render({input: output, output: path.join(folder, 'instagram.mp4'), platform: 'instagram'});
    assert.equal(tiktok.fps, '60/1');
    assert.equal(tiktok.timestampScale, 2);
    assert.equal(instagram.fps, '30/1');
    assert.equal(instagram.timestampScale, 1);
  } finally { await fs.rm(folder, {recursive: true, force: true}); }
});

test('JSON edit plan CLI renders a master and both platform files', {timeout: 90000}, async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'scripted-gym-edit-'));
  try {
    const input = path.join(folder, 'clip.mp4');
    const source = spawn(config.ffmpeg, ['-v','error','-y','-f','lavfi','-i','color=c=gray:s=180x320:r=30:d=0.3',
      '-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',input], {windowsHide: true});
    source.stdout.resume(); source.stderr.resume();
    assert.equal((await once(source, 'close'))[0], 0);
    const plan = path.join(folder, 'plan.json');
    await fs.writeFile(plan, JSON.stringify({version: 1, sources: ['clip.mp4'], outputDir: 'exports',
      settings: {segments: [{sourceIndex: 0, start: 0, end: 0.3}], blurRegions: [], autoFaces: false,
        motionTitles: [], encoder: 'cpu', destination: 'both'}}));
    const child = spawn(process.execPath, ['scripts/render-editor-plan.js', plan],
      {cwd: config.root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    assert.equal((await once(child, 'close'))[0], 0, stderr);
    assert.match(stdout, /Finished:/);
    const names = await fs.readdir(path.join(folder, 'exports'));
    assert.equal(names.filter(name => name.endsWith('.mp4')).length, 3);
    const instagram = names.find(name => name.endsWith('_instagram.mp4'));
    assert.equal((await probe(path.join(folder, 'exports', instagram))).fps, '30/1');
  } finally { await fs.rm(folder, {recursive: true, force: true}); }
});
