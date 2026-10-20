import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { config } from '../src/config.js';
import { probe } from '../src/ffmpeg.js';
import { buildEditArgs, createFaceMask, renderEdit, validateEditSettings } from '../src/editor.js';
import { JobQueue } from '../src/queue.js';

function ffmpeg(args) {
  const result = spawnSync(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('editor validates privacy areas, destination and GPU choices', () => {
  assert.throws(() => validateEditSettings({ blurRegions: [{ x: .9, y: 0, w: .5, h: .3, start: 0, end: 1 }] }, 2), /outside/);
  assert.throws(() => validateEditSettings({ blurRegions: [], encoder: 'shell' }, 2), /encoding/);
  assert.throws(() => validateEditSettings({ blurRegions: [], pipEnd: 3 }, 2), /end/i);
  assert.equal(validateEditSettings({ blurRegions: [], destination: 'both' }, 2).destination, 'both');
  assert.throws(() => validateEditSettings({ blurRegions: [], destination: 'instagram' }, 2), /together/);
});

test('edit mixes voice, reduces source sound, blurs a region and overlays video before platform export', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'gym-editor-'));
  const priorOutput = config.directories.output; config.directories.output = folder;
  try {
    const input = path.join(folder, 'gym.mp4'), voice = path.join(folder, 'voice.wav'), pip = path.join(folder, 'pip.mp4'), master = path.join(folder, 'master.mp4');
    ffmpeg(['-f','lavfi','-i','testsrc2=size=320x568:rate=60:duration=1','-f','lavfi','-i','sine=frequency=220:sample_rate=48000:duration=1','-c:v','libx264','-preset','ultrafast','-c:a','aac',input]);
    ffmpeg(['-f','lavfi','-i','sine=frequency=660:sample_rate=48000:duration=1','-c:a','pcm_s16le',voice]);
    ffmpeg(['-f','lavfi','-i','color=c=red:s=80x80:r=30:duration=1','-c:v','libx264','-preset','ultrafast',pip]);
    const media = await probe(input);
    const settings = validateEditSettings({ blurRegions:[{x:.5,y:.05,w:.35,h:.22,start:0,end:1}], originalVolume:.2, voiceVolume:1,
      voiceStart:0, pipStart:0, pipEnd:1, pipWidth:.32, destination:'both',encoder:'cpu' }, media.duration);
    const args = buildEditArgs({ input, output:master, voicePath:voice, pipPath:pip, media, settings, videoEncoder:'libx265' });
    assert.match(args[args.indexOf('-filter_complex')+1], /alphamerge/);
    assert.match(args[args.indexOf('-filter_complex')+1], /amix=inputs=2/);
    const result = await renderEdit({input,output:master,voicePath:voice,pipPath:pip,settings});
    assert.equal(result.width,320);assert.equal(result.height,568);assert.equal(result.fps,'60/1');assert.equal(result.hasAudio,true);
    const blurCrop = (file) => {
      const frame = spawnSync(config.ffmpeg, ['-v','error','-i',file,'-frames:v','1','-vf','crop=96:120:164:34,format=gray','-f','rawvideo','-'], { windowsHide:true });
      assert.equal(frame.status,0,frame.stderr?.toString());
      const pixels=frame.stdout;let differences=0;
      for(let y=0;y<120;y++)for(let x=1;x<96;x++)differences+=Math.abs(pixels[y*96+x]-pixels[y*96+x-1]);
      return differences;
    };
    const originalDetail=blurCrop(input), editedDetail=blurCrop(master);
    assert.ok(editedDetail<originalDetail*0.7,`Marked area must visibly lose detail (${editedDetail} vs ${originalDetail}).`);
    const queue = new JobQueue();
    const complete = new Promise((resolve,reject)=>{queue.on('complete',job=>{if(job.platform==='instagram')resolve(job);});queue.on('failed',job=>reject(new Error(job.error)));});
    queue.addEditor({sourcePath:input,sourceName:'gym.mp4',bytes:100,voicePath:voice,pipPath:pip,settings});
    const instagram = await complete;
    assert.equal(instagram.media.width,1080);assert.equal(instagram.media.height,1920);assert.equal(instagram.media.fps,'30/1');
    assert.ok(queue.jobs.some(job=>job.platform==='tiktok'&&job.status==='complete'&&job.timestampScale===2));
    assert.ok(queue.jobs.some(job=>job.platform==='editor'&&job.status==='complete'));
    assert.ok(queue.snapshot().every(job=>!('editor' in job)&&!('sourcePath' in job)));
  } finally { config.directories.output = priorOutput; await fs.rm(folder,{recursive:true,force:true}); }
});

test('edited 4K master preserves dimensions and 60 fps',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'gym-editor-4k-'));
  try{
    const input=path.join(folder,'4k.mp4'),output=path.join(folder,'4k-edit.mp4');
    ffmpeg(['-f','lavfi','-i','color=c=blue:size=3840x2160:rate=60:duration=0.1','-c:v','libx264','-preset','ultrafast',input]);
    const settings=validateEditSettings({autoFaces:false,blurRegions:[{x:.1,y:.1,w:.2,h:.2,start:0,end:.1}],encoder:'cpu'},0.1);
    const result=await renderEdit({input,output,settings});
    assert.equal(result.width,3840);assert.equal(result.height,2160);assert.equal(result.fps,'60/1');
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});

test('automatic face mask is generated from video frames and can include a manual privacy region', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'gym-face-mask-'));
  try {
    const input=path.join(folder,'input.mp4'), mask=path.join(folder,'face-mask.mkv'), output=path.join(folder,'edited.mp4');
    ffmpeg(['-f','lavfi','-i','testsrc2=size=320x568:rate=30:duration=0.5','-c:v','libx264','-preset','ultrafast',input]);
    const media=await probe(input);
    const settings=validateEditSettings({autoFaces:true,blurRegions:[{x:.4,y:.1,w:.2,h:.2,start:0,end:.5}],encoder:'cpu'},media.duration);
    await createFaceMask(input,mask,media,settings);
    assert.ok((await fs.stat(mask)).size>0);
    const result=await renderEdit({input,output,settings});
    assert.equal(result.width,320);assert.equal(result.height,568);assert.equal(result.fps,'60/1');
    assert.equal(result.hasAudio,false);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});

test('local editor upload queues a 60 fps master and two finished platform exports', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'gym-editor-api-'));
  const port = 28000 + Math.floor(Math.random() * 10000);
  const server = spawn(process.execPath, ['src/server.js'], { cwd: config.root, windowsHide: true,
    env: { ...process.env, PORT: String(port), MEDIA_ROOT: folder }, stdio: ['ignore','ignore','pipe'] });
  let stderr = ''; server.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-1500); });
  try {
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 50; i++) { try { ready = (await fetch(base + '/api/health')).ok; } catch {} if (ready) break; await new Promise(r => setTimeout(r, 100)); }
    assert.ok(ready, stderr);
    assert.equal((await fetch(base + '/editor')).status, 200);
    const input = path.join(folder, 'source.mp4');
    ffmpeg(['-f','lavfi','-i','testsrc2=size=180x320:rate=30:duration=0.6','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.6','-c:v','libx264','-preset','ultrafast','-c:a','aac',input]);
    const body = new FormData(); body.append('source', new Blob([await fs.readFile(input)], { type: 'video/mp4' }), 'source.mp4');
    body.append('settings', JSON.stringify({autoFaces:false,blurRegions:[{x:.5,y:.1,w:.3,h:.3,start:0,end:.6}],destination:'both',encoder:'cpu'}));
    const upload = await fetch(base + '/api/editor/jobs', { method:'POST', body });
    assert.equal(upload.status, 202, await upload.text());
    let jobs;
    for (let i = 0; i < 200; i++) {
      jobs = await (await fetch(base + '/api/jobs')).json();
      if (jobs.length === 3 && jobs.every(job => ['complete','failed'].includes(job.status))) break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.equal(jobs.length, 3, JSON.stringify(jobs));
    assert.ok(jobs.every(job => job.status === 'complete'), JSON.stringify(jobs));
    assert.deepEqual(jobs.map(job => job.platform).sort(), ['editor','instagram','tiktok']);
    assert.ok(jobs.every(job => job.downloadable));
    const tiktok = jobs.find(job => job.platform === 'tiktok');
    const instagram = jobs.find(job => job.platform === 'instagram');
    assert.equal(tiktok.timestampScale,2);
    assert.equal(instagram.media.width,1080);assert.equal(instagram.media.height,1920);assert.equal(instagram.media.fps,'30/1');
    assert.equal(tiktok.groupId,jobs.find(job => job.platform === 'editor').id);
    assert.equal(instagram.groupId,tiktok.groupId);
    const audioProbe = spawnSync(config.ffprobe, ['-v','error','-select_streams','a:0','-show_entries','stream=duration','-of','default=noprint_wrappers=1:nokey=1',
      path.join(folder,'output',tiktok.media.output)], { encoding:'utf8', windowsHide:true });
    assert.equal(audioProbe.status,0,audioProbe.stderr);
    assert.ok(Math.abs(Number(audioProbe.stdout.trim())-tiktok.media.duration)<0.2, `TikTok voice timing ${audioProbe.stdout.trim()} vs ${tiktok.media.duration}`);
  } finally { server.kill(); await once(server,'close'); await fs.rm(folder,{recursive:true,force:true}); }
});
