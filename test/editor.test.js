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
  assert.throws(() => validateEditSettings({ blurRegions: [], segments: [] }, 2), /timeline clip/i);
  assert.equal(validateEditSettings({ blurRegions: [], segments: Array.from({length:101}, () => ({start:0,end:1})) }, 2).segments.length,101);
  assert.equal(validateEditSettings({ blurRegions: [], segments: [{start:0,end:1},{start:.5,end:2}] }, 2).segments.length,2);
  assert.equal(validateEditSettings({ blurRegions: [], segments: [{start:1,end:2},{start:0,end:1}] }, 2).segments[0].start,1);
  assert.equal(validateEditSettings({ blurRegions: [], segments: [{start:0,end:2.0001}] }, 2).segments[0].end,2);
  assert.throws(() => validateEditSettings({ blurRegions: [], segments: [{sourceIndex:1,start:0,end:1}] }, [2]), /unknown source/i);
  assert.throws(() => validateEditSettings({ blurRegions: [], segments: [{start:0,end:1,videoEnabled:false,audioEnabled:false}] }, 2), /neither video nor audio/i);
  assert.equal(validateEditSettings({ blurRegions: [], segments: [{start:0,end:1,videoEnabled:false,audioEnabled:true}] }, 2).segments[0].videoEnabled,false);
  assert.equal(validateEditSettings({ blurRegions: [], voiceIn:.25, voiceOut:.75 }, 2).voiceOut,.75);
  assert.throws(() => validateEditSettings({ blurRegions: [], voiceIn:1, voiceOut:.5 }, 2), /Voice out/i);
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

test('timeline cuts and rearranges the rendered master with matching audio duration', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'gym-editor-cuts-'));
  try {
    const input = path.join(folder, 'source.mp4'), output = path.join(folder, 'cut.mp4');
    ffmpeg(['-f','lavfi','-i','color=c=red:s=160x288:r=60:d=0.5',
      '-f','lavfi','-i','color=c=blue:s=160x288:r=60:d=0.5',
      '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1',
      '-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-map','2:a',
      '-c:v','libx264','-preset','ultrafast','-c:a','aac',input]);
    const source = await probe(input);
    const settings = validateEditSettings({ blurRegions: [], autoFaces: false, encoder: 'cpu',
      segments: [{start:.5,end:1},{start:0,end:.4}] }, source.duration);
    const result = await renderEdit({ input, output, settings });
    assert.equal(result.fps, '60/1');
    assert.ok(Math.abs(result.duration - .9) < .08, `Expected a 0.9-second cut, got ${result.duration}`);
    const sample = (time) => {
      const frame = spawnSync(config.ffmpeg, ['-v','error','-ss',String(time),'-i',output,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-'], { windowsHide:true });
      assert.equal(frame.status,0,frame.stderr?.toString());
      const pixel = frame.stdout.subarray(0,3);
      return [pixel[0], pixel[2]];
    };
    const first = sample(.1), second = sample(.65);
    assert.ok(first[1] > first[0] + 70, `First clip should be blue: ${first}`);
    assert.ok(second[0] > second[1] + 70, `Second clip should be red: ${second}`);
    const audio = spawnSync(config.ffprobe, ['-v','error','-select_streams','a:0','-show_entries','stream=duration','-of','default=noprint_wrappers=1:nokey=1',output], { encoding:'utf8', windowsHide:true });
    assert.equal(audio.status,0,audio.stderr);
    assert.ok(Math.abs(Number(audio.stdout.trim()) - result.duration) < .08);
  } finally { await fs.rm(folder, { recursive:true, force:true }); }
});

test('unlinked track deletion exports silent video and audio-only black frames in their aligned slots', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'gym-editor-unlinked-'));
  try {
    const input = path.join(folder,'source.mp4'), output = path.join(folder,'unlinked.mp4');
    ffmpeg(['-f','lavfi','-i','color=c=red:s=160x288:r=60:d=0.8',
      '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.8',
      '-c:v','libx264','-preset','ultrafast','-c:a','aac',input]);
    const media = await probe(input);
    const settings = validateEditSettings({blurRegions:[],autoFaces:false,encoder:'cpu',segments:[
      {sourceIndex:0,start:0,end:.4,videoEnabled:true,audioEnabled:false},
      {sourceIndex:0,start:.4,end:.8,videoEnabled:false,audioEnabled:true}
    ]},[media]);
    const result = await renderEdit({input,output,settings});
    assert.equal(result.hasAudio,true);
    const pixelAt = time => {
      const frame = spawnSync(config.ffmpeg,['-v','error','-ss',String(time),'-i',output,'-frames:v','1',
        '-vf','crop=2:2:80:144','-pix_fmt','rgb24','-f','rawvideo','-'],{windowsHide:true});
      assert.equal(frame.status,0,frame.stderr?.toString());
      return frame.stdout.subarray(0,3);
    };
    assert.ok(pixelAt(.15)[0]>130,'The first slot keeps red video.');
    assert.ok(pixelAt(.6).every(value=>value<30),'The audio-only slot renders black.');
    const audioLevel = time => {
      const sample = spawnSync(config.ffmpeg,['-v','error','-ss',String(time),'-i',output,'-t','0.1','-vn',
        '-ac','1','-ar','48000','-f','s16le','-'],{windowsHide:true});
      assert.equal(sample.status,0,sample.stderr?.toString());
      let peak=0;
      for(let i=0;i+1<sample.stdout.length;i+=2) peak=Math.max(peak,Math.abs(sample.stdout.readInt16LE(i)));
      return peak;
    };
    assert.ok(audioLevel(.15)<50,'The video-only slot must be silent.');
    assert.ok(audioLevel(.6)>200,'The audio-only slot keeps camera audio.');
  } finally { await fs.rm(folder,{recursive:true,force:true}); }
});

test('voice monitor In/Out trim and timeline offset are reflected in the exported audio', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'gym-editor-voice-trim-'));
  try {
    const input = path.join(folder,'silent.mp4'), voice = path.join(folder,'voice.wav'), output = path.join(folder,'voice-edit.mp4');
    ffmpeg(['-f','lavfi','-i','color=c=blue:s=160x288:r=60:d=1','-c:v','libx264','-preset','ultrafast',input]);
    ffmpeg(['-f','lavfi','-i','sine=frequency=660:sample_rate=48000:duration=1','-c:a','pcm_s16le',voice]);
    const settings = validateEditSettings({blurRegions:[],autoFaces:false,encoder:'cpu',
      voiceIn:.2,voiceOut:.5,voiceStart:.1},1);
    const result = await renderEdit({input,output,voicePath:voice,settings});
    assert.equal(result.hasAudio,true);
    const peakAt = time => {
      const sample = spawnSync(config.ffmpeg,['-v','error','-ss',String(time),'-i',output,'-t','0.08','-vn',
        '-ac','1','-ar','48000','-f','s16le','-'],{windowsHide:true});
      assert.equal(sample.status,0,sample.stderr?.toString());
      let peak=0;
      for(let i=0;i+1<sample.stdout.length;i+=2) peak=Math.max(peak,Math.abs(sample.stdout.readInt16LE(i)));
      return peak;
    };
    assert.ok(peakAt(.16)>200,'Voice should begin after its timeline offset.');
    assert.ok(peakAt(.6)<50,'Voice should be silent after its Out point.');
  } finally { await fs.rm(folder,{recursive:true,force:true}); }
});

test('six exercise videos merge in timeline order with mixed orientations and silent clips', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'gym-editor-six-'));
  try {
    const colors = ['red','blue','green','yellow','magenta','cyan'];
    const inputs = [];
    for (const [index, color] of colors.entries()) {
      const input = path.join(folder, `exercise-${index}.mp4`), size = index % 2 ? '288x160' : '160x288';
      const args = ['-f','lavfi','-i',`color=c=${color}:s=${size}:r=30:d=0.35`];
      if (index % 2 === 0) args.push('-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.35');
      args.push('-c:v','libx264','-preset','ultrafast');
      if (index % 2 === 0) args.push('-c:a','aac');
      ffmpeg([...args,input]); inputs.push(input);
    }
    const media = await Promise.all(inputs.map(probe));
    const segments = media.map((_, sourceIndex) => ({ sourceIndex, start:.05, end:.25 }));
    segments.push({sourceIndex:0,start:.25,end:.34});
    for (const sourceIndex of [1,2,3]) segments.push({sourceIndex,start:.05,end:.15});
    const settings = validateEditSettings({ autoFaces:false, blurRegions:[{x:.6,y:.1,w:.2,h:.2,start:.4,end:.8}],
      segments, encoder:'cpu' }, media);
    const output = path.join(folder, 'six-exercises.mp4');
    const result = await renderEdit({ inputPaths:inputs, output, settings });
    assert.equal(result.width,160);assert.equal(result.height,288);assert.equal(result.fps,'60/1');
    assert.equal(result.hasAudio,true);
    assert.ok(Math.abs(result.duration - 1.59) < .12, `Merged duration ${result.duration}`);
    const audio = spawnSync(config.ffprobe,['-v','error','-select_streams','a:0','-show_entries','stream=duration','-of','default=noprint_wrappers=1:nokey=1',output],{encoding:'utf8',windowsHide:true});
    assert.equal(audio.status,0,audio.stderr);
    assert.ok(Math.abs(Number(audio.stdout.trim()) - result.duration) < .12);
    const frame = spawnSync(config.ffmpeg,['-v','error','-ss','1.52','-i',output,'-frames:v','1','-vf','crop=2:2:80:144','-pix_fmt','rgb24','-f','rawvideo','-'],{windowsHide:true});
    assert.equal(frame.status,0,frame.stderr?.toString());
    const pixel = frame.stdout.subarray(0,3);
    assert.ok(pixel[0] > 100 && pixel[1] > 100 && pixel[2] < 80, `Last batch should show the yellow source: ${[...pixel]}`);
  } finally { await fs.rm(folder,{recursive:true,force:true}); }
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
    const input = path.join(folder, 'source.mp4'), second = path.join(folder, 'second.mp4');
    ffmpeg(['-f','lavfi','-i','testsrc2=size=180x320:rate=30:duration=0.6','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.6','-c:v','libx264','-preset','ultrafast','-c:a','aac',input]);
    ffmpeg(['-f','lavfi','-i','color=c=blue:s=320x180:r=30:d=0.6','-c:v','libx264','-preset','ultrafast',second]);
    const body = new FormData(); body.append('source', new Blob([await fs.readFile(input)], { type: 'video/mp4' }), 'source.mp4');
    body.append('source', new Blob([await fs.readFile(second)], { type: 'video/mp4' }), 'second.mp4');
    const extraSource = await fs.readFile(second);
    for (let index=0; index<20; index++) body.append('source', new Blob([extraSource], { type:'video/mp4' }), `extra-${index}.mp4`);
    body.append('settings', JSON.stringify({autoFaces:false,blurRegions:[{x:.5,y:.1,w:.3,h:.3,start:0,end:.45}],
      segments:[{sourceIndex:0,start:0,end:.2},{sourceIndex:1,start:.35,end:.6}],destination:'both',encoder:'cpu'}));
    const upload = await fetch(base + '/api/editor/jobs', { method:'POST', body });
    const uploadBody = await upload.json();
    assert.equal(upload.status, 202, JSON.stringify(uploadBody));
    assert.equal(uploadBody.sources.length,22);
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
    assert.ok(Math.abs(jobs.find(job => job.platform === 'editor').media.duration - .45) < .1);
    assert.ok(Math.abs(tiktok.media.duration - .9) < .15);
    assert.equal(tiktok.timestampScale,2);
    assert.equal(instagram.media.width,1080);assert.equal(instagram.media.height,1920);assert.equal(instagram.media.fps,'30/1');
    assert.equal(tiktok.groupId,jobs.find(job => job.platform === 'editor').id);
    assert.equal(instagram.groupId,tiktok.groupId);
    const audioProbe = spawnSync(config.ffprobe, ['-v','error','-select_streams','a:0','-show_entries','stream=duration','-of','default=noprint_wrappers=1:nokey=1',
      path.join(folder,'output',tiktok.media.output)], { encoding:'utf8', windowsHide:true });
    assert.equal(audioProbe.status,0,audioProbe.stderr);
    const masterDuration = jobs.find(job => job.platform === 'editor').media.duration;
    assert.ok(Math.abs(Number(audioProbe.stdout.trim())-masterDuration)<0.2, `TikTok voice timing ${audioProbe.stdout.trim()} vs original ${masterDuration}`);
  } finally { server.kill(); await once(server,'close'); await fs.rm(folder,{recursive:true,force:true}); }
});
