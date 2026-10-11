import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from '../src/config.js';
import { run, probe } from '../src/ffmpeg.js';

test('local upload → queue → verified download, with rejected invalid uploads', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luna-upload-test-'));
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: config.root, windowsHide: true,
    env: { ...process.env, PORT: '0', MEDIA_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  const exited = once(child, 'exit');
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  try {
    let url;
    for (let attempt = 0; attempt < 100; attempt++) {
      url = logs.match(/http:\/\/127\.0\.0\.1:([1-9]\d*)/)?.[0];
      if (url) break;
      if (child.exitCode !== null) throw new Error(logs);
      await delay(100);
    }
    assert.ok(url, 'test server started');
    const health = await (await fetch(`${url}/api/health`)).json();
    assert.equal(health.profile.crf, 17);
    const fixture = path.join(root, 'fixture.mkv');
    await run(config.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=480x640:rate=60', '-frames:v', '20', '-c:v', 'libx264', '-y', fixture]);
    const form = new FormData(); form.set('video', new Blob([await fs.readFile(fixture)]), 'camera.no-extension');
    const accepted = await fetch(`${url}/api/uploads?resolution=1080`, { method: 'POST', body: form });
    assert.equal(accepted.status, 202);
    const { job } = await accepted.json();
    let done;
    for (let attempt = 0; attempt < 200; attempt++) {
      done = (await (await fetch(`${url}/api/jobs`)).json()).find(x => x.id === job.id);
      if (['complete', 'failed'].includes(done?.status)) break;
      await delay(100);
    }
    assert.equal(done.status, 'complete', done?.error);
    assert.equal(done.media.width, 480); assert.equal(done.media.height, 640);
    assert.equal(done.media.timestampScale, 1); assert.equal(done.options.resolution, 1080);
    assert.ok(done.media.patch.validated); assert.equal(done.media.patch.stats.declared_frames, 200);
    const downloaded = await fetch(`${url}/api/jobs/${job.id}/download`);
    assert.equal(downloaded.status, 200); assert.match(downloaded.headers.get('content-disposition'), /attachment/);
    const target = path.join(root, 'download.mp4'); await fs.writeFile(target, Buffer.from(await downloaded.arrayBuffer()));
    assert.equal((await probe(target)).codec, 'h264');
    assert.equal((await fetch(`${url}/api/uploads?speed=99`, { method: 'POST', body: form })).status, 400);
    assert.equal((await fetch(`${url}/api/uploads?resolution=999`, { method: 'POST', body: form })).status, 400);
    const invalid = new FormData(); invalid.set('video', new Blob(['plain text']), 'bad.mp4');
    assert.equal((await fetch(`${url}/api/uploads`, { method: 'POST', body: invalid })).status, 400);
    assert.equal((await fs.readdir(path.join(root, 'incoming'))).length, 1, 'failed upload cleaned up, original valid upload kept');
  } finally {
    child.kill(); await exited;
    await fs.rm(root, { recursive: true, force: true });
  }
});
