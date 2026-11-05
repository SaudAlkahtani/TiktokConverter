import test from 'node:test';
import assert from 'node:assert/strict';
import { tiktokProfile, buildVerticalArgs } from '../src/vertical-profile.js';

test('the standard TikTok profile selects cadence, bitrate, and timeline', () => {
  for (const [rate, fps, bitrate, scale] of [['60/1', 60, 25, 2], ['30/1', 30, 15, 1]]) {
    const media = { width: 3840, height: 2160, fps: rate, averageFrameRate: rate, colorPrimaries: 'bt709', colorTransfer: 'bt709', colorSpace: 'bt709' };
    const profile = tiktokProfile(media);
    assert.equal(profile.fps, fps);
    assert.equal(profile.bitrateMbps, bitrate);
    assert.equal(profile.timestampScale, scale);
    const args = buildVerticalArgs('input.mp4', 'output.mp4', media, profile);
    assert.equal(args[args.indexOf('-b:v') + 1], `${bitrate}M`);
    assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
    assert.equal(args.includes('-itsscale'), scale === 2);
    assert.match(args[args.indexOf('-vf') + 1], /pad=1080:1920/);
  }
});

test('a real 60 fps export is vertical H.264 with matched half-speed audio', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const { config } = await import('../src/config.js');
  const { render } = await import('../src/ffmpeg.js');
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'vertical-profile-'));
  const input = path.join(folder, 'source.mp4');
  const output = path.join(folder, 'export.mp4');
  try {
    const child = spawn(config.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=60:duration=0.3', '-f', 'lavfi', '-i', 'sine=duration=0.3:sample_rate=48000', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', input], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdout.resume();
    assert.equal((await once(child, 'close'))[0], 0, stderr);
    const result = await render({ input, output });
    assert.equal(result.width, 1080);
    assert.equal(result.height, 1920);
    assert.equal(result.fps, '60/1');
    assert.equal(result.videoCodec, 'h264');
    assert.equal(result.timestampScale, 2);
    assert.equal(result.targetVideoBitrateMbps, 25);
    assert.ok(Math.abs(result.duration - 0.6) < 0.15);
    assert.equal(result.audioCodec, 'aac');
    assert.equal(result.colorPrimaries, 'bt709');
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
