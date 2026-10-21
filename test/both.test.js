import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JobQueue } from '../src/queue.js';
import { config } from '../src/config.js';

test('one source produces distinct TikTok scale-2 and Instagram normal-speed outputs', async () => {
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'dual-converter-'));
 const previous=config.directories.output; config.directories.output=folder;
 try {
  const input=path.join(folder,'source.mp4');
  const fixture=spawnSync(config.ffmpeg,['-y','-f','lavfi','-i','testsrc2=size=180x320:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','libx264','-c:a','aac',input],{windowsHide:true});
  assert.equal(fixture.status,0,fixture.stderr?.toString());
  const queue=new JobQueue();
  const finished=new Promise((resolve,reject)=>{queue.on('failed',job=>reject(new Error(job.error)));queue.on('complete',()=>{if(queue.jobs.every(j=>j.status==='complete'))resolve();});});
  const base={sourcePath:input,sourceName:'source.mp4',bytes:1,origin:'both',groupId:'pair'};
  const tiktok=queue.add({...base,platform:'tiktok',timestampScale:2});
  const instagram=queue.add({...base,platform:'instagram'});
  await finished;
  assert.equal(tiktok.sourcePath,instagram.sourcePath);
  assert.notEqual(tiktok.outputPath,instagram.outputPath);
  assert.equal(tiktok.media.fps,'60/1'); assert.ok(Math.abs(tiktok.media.duration-2)<0.2,`TikTok duration ${tiktok.media.duration}`);
  assert.equal(instagram.media.fps,'30/1');assert.equal(instagram.media.displayAspectRatio,'9:16');assert.ok(Math.abs(instagram.media.duration-1)<0.2);
  for(const [job,codec,duration] of [[tiktok,'hevc',2],[instagram,'h264',1]]) {
   const result=spawnSync(config.ffprobe,['-v','error','-show_streams','-of','json',job.outputPath],{encoding:'utf8',windowsHide:true});
   const streams=JSON.parse(result.stdout).streams;assert.equal(streams.find(s=>s.codec_type==='video').codec_name,codec);
   const audio=streams.find(s=>s.codec_type==='audio');assert.equal(audio.codec_name,'aac');assert.equal(audio.channels,2);assert.equal(audio.sample_rate,'48000');
   assert.ok(Math.abs(Number(audio.duration)-duration)<0.2,`${job.platform} audio duration ${audio.duration}`);
  }
  assert.equal(queue.clearCompleted('both').cleared,2);
 }finally{config.directories.output=previous;await fs.rm(folder,{recursive:true,force:true});}
});
