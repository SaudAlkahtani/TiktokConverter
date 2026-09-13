import test from 'node:test';
import assert from 'node:assert/strict';
import { encoderArgs, selectEncoder, encodeWithFallback, isEncoder } from '../src/encoders.js';
import { buildRenderArgs, run } from '../src/ffmpeg.js';

const media = { width: 1728, height: 3072, pixelFormat: 'yuv420p', streamIndex: 0 };
test('GPU profiles keep filters, resolution, playback and audio options', () => {
  for (const encoder of ['cpu', 'amd', 'nvidia']) {
    const { args } = buildRenderArgs({ ...media, audio: { index: 1 } }, 'in.mp4', 'out.mp4', { encoder, timestampScale: 2 });
    assert.equal(args[args.indexOf('-itsscale') + 1], '2');
    assert.match(args[args.indexOf('-vf') + 1], /fps=60,unsharp=/);
    assert.equal(args[args.indexOf('-af') + 1], 'asetpts=N/SR/TB,atempo=0.5');
    assert.ok(!args.includes('-s'));
    if (encoder !== 'cpu') { assert.ok(!args.includes('-crf')); assert.ok(!args.includes('-x265-params')); }
  }
  assert.ok(encoderArgs('amd').includes('hevc_amf'));
  assert.ok(encoderArgs('nvidia').includes('hevc_nvenc'));
  const ten = buildRenderArgs({ ...media, pixelFormat: 'yuv420p10le' }, 'in', 'out', { encoder: 'nvidia' });
  assert.equal(ten.pixelFormat, 'p010le');
});

test('GPU selection validates input and preserves dimensions and precision', async () => {
  const works = async () => {};
  const fails = async () => { throw Error('no matching GPU'); };
  const never = async () => { assert.fail('Compatibility fallback should not launch GPU'); };
  for (const value of ['auto', '__proto__', '', ['amd'], null]) assert.equal(isEncoder(value), false);
  await assert.rejects(selectEncoder(media, 'bad', works));
  assert.equal((await selectEncoder(media, 'cpu', never)).encoder, 'cpu');
  for (const encoder of ['amd', 'nvidia']) {
    assert.equal((await selectEncoder(media, encoder, works)).encoder, encoder);
    const missing = await selectEncoder(media, encoder, fails);
    assert.equal(missing.encoder, 'cpu'); assert.match(missing.warnings[0], /compatibility check failed/);
    assert.equal((await selectEncoder({ ...media, width: 1729 }, encoder, never)).encoder, 'cpu');
  }
  const tenBit = { ...media, pixelFormat: 'yuv420p10le' };
  assert.equal((await selectEncoder(tenBit, 'amd', never)).encoder, 'cpu');
  assert.equal((await selectEncoder(tenBit, 'nvidia', works)).encoder, 'nvidia');
});

test('runtime GPU failure retries CPU once and reports actual encoder', async () => {
  const attempts = [], states = [];
  const result = await encodeWithFallback({ encoder: 'amd', warnings: [] }, async encoder => {
    attempts.push(encoder); if (encoder === 'amd') throw Error('device lost');
  }, state => states.push(state));
  assert.deepEqual(attempts, ['amd', 'cpu']); assert.equal(result.encoder, 'cpu');
  assert.match(result.warnings[0], /retrying once/); assert.equal(states.at(-1).encoder, 'cpu');
  await assert.rejects(encodeWithFallback({ encoder: 'nvidia', warnings: [] }, async () => { throw Error('disk error'); }), /disk error/);
});

test('hardware probe timeout terminates a hung child', async () => {
  await assert.rejects(run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], () => {}, 100), /timed out/);
});
