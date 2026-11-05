import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Bot } from 'grammy';
import { config, bitrateFor } from '../src/config.js';
import { buildRenderArgs, render, probe } from '../src/ffmpeg.js';
import { JobQueue } from '../src/queue.js';
import { TikTokDrafts } from '../src/tiktok-drafts.js';
import { startTelegram, saveIncoming, deliverTelegramExport, localFileSystemPath, redactTelegramError, registerVideoMethods } from '../src/telegram.js';

async function tool(args) {
  const child = spawn(config.ffmpeg, ['-v', 'error', '-y', ...args], { windowsHide: true });
  let error = ''; child.stderr.on('data', (chunk) => { error += chunk; });
  child.stdout.resume();
  assert.equal((await once(child, 'close'))[0], 0, error);
}
async function waitFor(check, timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const value = await check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error('Timed out waiting for workflow.');
}
const token = '123456789:FAKE_TOKEN_ONLY_FOR_TESTING_0123456789';
const identity = { id: 123456789, is_bot: true, first_name: 'Test', username: 'DedicatedTest_bot' };
const chat = { id: 42, type: 'private', first_name: 'Test' };
const settingsFor = (folder) => ({ ...config, token, botUsername: '@DedicatedTest_bot', telegramApiRoot: 'http://127.0.0.1:8081',
  tiktok: { ...config.tiktok, settingsPath: path.join(folder, 'tiktok') },
  directories: { incoming: path.join(folder, 'incoming'), output: path.join(folder, 'output'), data: path.join(folder, 'data') },
  uploadLimitBytes: 10 * 1024 ** 2, cleanupSourceAfterSend: true, allowedChatIds: new Set(['42']) });
const option = (args, key) => args[args.indexOf(key) + 1];

test('TikTok rate and timing follow the standard vertical profile', () => {
  for (const [width, height] of [[1080,1920],[1920,1080],[1440,2560],[1728,3072],[2160,3840],[640,360]]) {
    const media = { width, height, fps: '60/1', colorPrimaries: 'bt709', colorTransfer: 'bt709', colorSpace: 'bt709' }; const args = buildRenderArgs(media, 'in.mp4', 'out.mp4');
    assert.deepEqual(bitrateFor(media), { bitrate: '25M' });
    assert.equal(option(args, '-b:v'), '25M'); assert.equal(option(args, '-maxrate'), '25M');
    assert.equal(option(args, '-bufsize'), '50M'); assert.equal(option(args, '-itsscale'), '2');
    assert.equal(args.includes('-af'), false);
    assert.equal(option(args, '-c:v'), 'libx264'); assert.equal(option(args, '-b:a'), '256k');
    assert.match(option(args, '-vf'), /fps=60/); assert.match(option(args, '-vf'), /pad=1080:1920/);
  }
});

test('Windows resolves /mnt and Linux-home Telegram paths correctly', () => {
  assert.equal(localFileSystemPath('/mnt/d/cache/movie.MP4','Ubuntu-24.04','win32'), 'D:\\cache\\movie.MP4');
  assert.equal(localFileSystemPath('/home/bigboi/.local/cache/movie.MP4','Ubuntu-24.04','win32'), '\\\\wsl.localhost\\Ubuntu-24.04\\home\\bigboi\\.local\\cache\\movie.MP4');
  assert.equal(localFileSystemPath('/home/test/file.mp4','Ubuntu','linux'), '/home/test/file.mp4');
  assert.equal(redactTelegramError(new Error(`request ${token} failed`), {token}), 'request [redacted] failed');
});

test('real H.264 exports are vertical with doubled duration, audio, and 60fps', async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'local-profile-test-'));
  try {
    for (const [width, height] of [[1080,1920],[1440,2560],[1728,3072],[2160,3840]]) {
      await t.test(`${width}x${height}`, async () => {
        const input = path.join(folder, `source-${width}.mp4`); const output = path.join(folder, `export-${width}.mp4`);
        await tool(['-f','lavfi','-i',`color=blue:size=${width}x${height}:rate=60:duration=0.2`,'-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',input]);
        const result = await render({ input, output });
        assert.equal(result.width,1080); assert.equal(result.height,1920); assert.equal(result.fps,'60/1');
        assert.equal(result.codec,'h264'); assert.ok(Math.abs(result.duration - 0.4) < 0.05);
        assert.equal(result.audio.codec,'aac'); assert.equal(result.audio.channels,2);
        assert.equal(result.bitrate,'25M');
      });
    }
  } finally { await fs.rm(folder,{recursive:true,force:true}); }
});

test('two-second source follows locked half-speed audio/video timing',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'audio-timing-test-'));
  try{
    const input=path.join(folder,'sound.mp4');await tool(['-f','lavfi','-i','testsrc2=size=320x240:rate=60:duration=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-c:v','libx264','-preset','ultrafast','-c:a','aac',input]);
    const result=await render({input,output:path.join(folder,'half-speed.mp4')});assert.ok(Math.abs(result.duration-4)<0.05);assert.ok(Math.abs(result.audio.duration-result.duration)<0.1);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});

test('Telegram receives → shared queue → real conversion → returns File → cleans only its source', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(),'telegram-workflow-test-'));
  const previousDirectories = config.directories; const settings = settingsFor(folder);
  config.directories = settings.directories;
  const queue = new JobQueue(); await queue.prepare();
  let worker;
  try {
    const fixture = path.join(folder,'telegram-cache.mp4');
    await tool(['-f','lavfi','-i','testsrc2=size=320x240:rate=60:duration=0.5','-f','lavfi','-i','sine=duration=0.5','-c:v','libx264','-preset','ultrafast','-c:a','aac',fixture]);
    const sent = []; const replies = []; const messages = [];
    const bot = new Bot(token,{botInfo:identity});
    bot.api.config.use(async (previous, method, payload) => {
      if (method === 'getMe') return {ok:true,result:identity};
      if (method === 'getWebhookInfo') return {ok:true,result:{url:'',pending_update_count:0}};
      if (method === 'getFile') return {ok:true,result:{file_id:'test',file_path:fixture}};
      if (method === 'sendDocument') { sent.push(payload); assert.ok(await fs.stat(payload.document.fileData)); return {ok:true,result:{message_id:5,chat,date:0}}; }
      if (method === 'sendMessage') { replies.push(payload.text); messages.push(payload); return {ok:true,result:{message_id:messages.length + 10,chat,date:0,text:payload.text}}; }
      if (['answerCallbackQuery','editMessageReplyMarkup'].includes(method)) return {ok:true,result:true};
      throw new Error(`Unexpected Telegram method ${method}`);
    });
    const drafts = await new TikTokDrafts({},settings).load();
    worker = await startTelegram(queue,{settings,bot,poll:false,tiktokDrafts:drafts});
    const update = {update_id:1,message:{message_id:1,date:0,chat,from:{id:42,is_bot:false,first_name:'Test'},document:{file_id:'test',file_unique_id:'unique',file_name:'clip.mp4',file_size:(await fs.stat(fixture)).size}}};
    await bot.handleUpdate(update);
    assert.equal(queue.jobs.length,0,'Wait for the method before downloading or queueing.');
    const choose = async (data,update_id) => bot.handleUpdate({update_id,callback_query:{id:`choice-${update_id}`,from:update.message.from,chat_instance:'test',data,message:{message_id:11,date:0,chat}}});
    await choose(messages[0].reply_markup.inline_keyboard[0][0].callback_data,2);
    const job = queue.jobs[0]; assert.equal(job.origin,'telegram'); assert.equal(job.chatId,42); assert.equal(job.method,'return');
    await waitFor(() => job.sourceDeletedAt || job.status === 'failed');
    assert.equal(job.status,'complete',job.error); assert.equal(job.telegramStatus,'sent'); assert.equal(sent.length,1);
    assert.equal(sent[0].chat_id,42); assert.match(sent[0].caption,/1080×1920.*60fps.*half speed/);
    await assert.rejects(fs.access(job.sourcePath)); await fs.access(job.outputPath); await fs.access(fixture);
    assert.equal(job.media.codec,'h264'); assert.equal(job.media.fps,'60/1'); assert.ok(Math.abs(job.media.duration-1)<0.05);
    assert.equal(drafts.items.length,0,'Return-only must never create a TikTok draft.');
    assert.ok(!replies.some((text)=>text.includes('What description')));
    // A different video explicitly selects TikTok: same encoding and delivery,
    // followed by a persisted caption draft, but never browser submission.
    await bot.handleUpdate({...update,update_id:3,message:{...update.message,message_id:2}});
    const prompt=messages.findLast((message)=>message.reply_markup?.inline_keyboard);
    await choose(prompt.reply_markup.inline_keyboard[1][0].callback_data,4);
    const tiktokJob=queue.jobs[1]; assert.equal(tiktokJob.method,'tiktok');
    await waitFor(()=>drafts.items[0]?.promptMessageId || tiktokJob.status==='failed');
    assert.equal(tiktokJob.telegramStatus,'sent'); assert.equal(drafts.items.length,1);
    assert.equal(drafts.items[0].jobId,tiktokJob.id); assert.equal(drafts.items[0].status,'caption');
    assert.ok(replies.some((text)=>text.includes(`What description/caption should accompany it on TikTok @${settings.tiktok.handle}`)));
    // Local uploads must never be returned to a Telegram chat or deleted.
    const localSource = path.join(settings.directories.incoming,'browser.mp4'); await fs.copyFile(fixture,localSource);
    const local = queue.add({sourcePath:localSource,sourceName:'browser.mp4',bytes:100});
    await waitFor(() => local.status === 'complete' || local.status === 'failed');
    assert.equal(local.status,'complete',local.error); await fs.access(localSource); assert.equal(sent.length,2);
    // Permissions apply to commands as well as videos.
    await bot.handleUpdate({...update,update_id:5,message:{...update.message,chat:{...chat,id:99}}});
    assert.equal(queue.jobs.length,3); assert.ok(replies.some((text) => text.includes('not authorized')));
  } finally { await worker?.stop(); config.directories = previousDirectories; await fs.rm(folder,{recursive:true,force:true}); }
});

test('per-video method choices isolate senders, expire, and cannot be replayed',async()=>{
  const bot = new Bot(token,{botInfo:identity}); const messages=[]; const alerts=[]; const received=[]; let now=1000;
  bot.api.config.use(async(previous,method,payload)=>{
    if(method==='sendMessage'){messages.push(payload);return {ok:true,result:{message_id:messages.length,chat,date:0}};}
    if(method==='answerCallbackQuery'){alerts.push(payload);return {ok:true,result:true};}
    if(method==='editMessageReplyMarkup')return {ok:true,result:true};
    throw new Error(`Unexpected Telegram method ${method}`);
  });
  registerVideoMethods(bot,async(ctx,method)=>{received.push({messageId:ctx.message.message_id,userId:ctx.from.id,chatId:ctx.chat.id,method});},{settings:config,now:()=>now});
  const from={id:42,is_bot:false,first_name:'Test'};
  let seq=0;
  const video=(id)=>bot.handleUpdate({update_id:++seq,message:{message_id:id,date:0,chat,from,document:{file_id:`file-${id}`,file_unique_id:`unique-${id}`,file_name:`clip-${id}.mp4`}}});
  const choose=(data,userId=42,chatId=42)=>bot.handleUpdate({update_id:++seq,callback_query:{id:`choice-${seq}`,from:{...from,id:userId},chat_instance:'test',data,message:{message_id:1,date:0,chat:{...chat,id:chatId}}}});
  await video(1); await video(2); assert.equal(received.length,0);
  const first=messages[0].reply_markup.inline_keyboard[0][0].callback_data;
  const second=messages[1].reply_markup.inline_keyboard[1][0].callback_data;
  await choose(first,99);await choose(first,42,99);assert.equal(received.length,0);
  await Promise.all([choose(first),choose(first)]); assert.equal(received.length,1);
  await choose(second); assert.deepEqual(received,[{messageId:1,userId:42,chatId:42,method:'return'},{messageId:2,userId:42,chatId:42,method:'tiktok'}]);
  await video(3);const expired=messages[2].reply_markup.inline_keyboard[0][0].callback_data;
  now+=3600001;await choose(expired);assert.equal(received.length,2);
  await choose('vm:unknown:return');assert.equal(received.length,2);
  assert.ok(alerts.some((alert)=>alert.text.includes('Only the sender')));
  assert.ok(alerts.some((alert)=>alert.text.includes('Already selected or expired')));
});

test('failed Telegram delivery keeps originals and supports a successful retry', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(),'telegram-delivery-test-'));
  try {
    const settings = settingsFor(folder); await fs.mkdir(settings.directories.incoming);
    const sourcePath = path.join(settings.directories.incoming,'original.mp4'); await fs.writeFile(sourcePath,'fixture');
    const outputPath = path.join(folder,'export.mp4'); await fs.writeFile(outputPath,'export');
    const job = {chatId:42,sourcePath,outputPath,media:{bytes:6,width:1080,height:1920,bitrate:'25M',fps:'60/1',timestampScale:2}};
    const queue = {emitUpdate(){}};
    const bot = {api:{sendDocument:async()=>{throw new Error(`network ${token}`);},sendMessage:async()=>{}}};
    await deliverTelegramExport(bot,queue,job,settings);
    assert.equal(job.telegramStatus,'failed'); assert.doesNotMatch(job.telegramError,/FAKE_TOKEN/); await fs.access(sourcePath); await fs.access(outputPath);
    bot.api.sendDocument = async()=>({message_id:5}); await deliverTelegramExport(bot,queue,job,settings);
    assert.equal(job.telegramStatus,'sent'); await assert.rejects(fs.access(sourcePath)); await fs.access(outputPath);
    // Guard deletion outside the incoming directory even if delivery succeeds.
    await deliverTelegramExport(bot,queue,{...job,sourcePath:outputPath},settings); await fs.access(outputPath);
  } finally { await fs.rm(folder,{recursive:true,force:true}); }
});

test('Telegram refuses a mismatched username or existing webhook', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(),'telegram-identity-test-'));
  try {
    for (const [username,url,match] of [['Wrong_bot','',/does not match/],['DedicatedTest_bot','https://other-worker.example',/webhook/]]) {
      const bot = new Bot(token,{botInfo:identity});
      bot.api.config.use(async(previous,method)=>({ok:true,result:method==='getMe'?{...identity,username}:{url,pending_update_count:0}}));
      await assert.rejects(startTelegram(new JobQueue(),{settings:settingsFor(folder),bot,poll:false}),match);
    }
  } finally { await fs.rm(folder,{recursive:true,force:true}); }
});

test('cache copies are size-limited and downloads never overwrite files', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(),'telegram-cache-test-'));
  try {
    const settings = settingsFor(folder); const cache = path.join(folder,'cache.mp4'); await fs.writeFile(cache,'12345');
    const bot = {api:{getFile:async()=>({file_path:cache})}}; const target = path.join(folder,'copy.mp4');
    assert.equal(await saveIncoming(bot,{fileId:'f'},target,settings),5);
    await assert.rejects(saveIncoming(bot,{fileId:'f'},target,settings));
    await assert.rejects(saveIncoming(bot,{fileId:'f'},path.join(folder,'oversize.mp4'),{...settings,uploadLimitBytes:4}),/limit/);
  } finally { await fs.rm(folder,{recursive:true,force:true}); }
});

test('batch browser uploads use the same profile, keep originals, and clear records safely', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(),'local-server-test-'));
  const port = 18000 + Math.floor(Math.random()*10000);
  const server = spawn(process.execPath,['src/server.js'],{cwd:config.root,windowsHide:true,env:{...process.env,PORT:String(port),MEDIA_ROOT:folder,TIKTOK_DATA_ROOT:path.join(folder,'tiktok'),TELEGRAM_BOT_TOKEN:'',MAX_INPUT_GB:'0.01'}});
  let errors=''; server.stderr.on('data',(data)=>{errors+=data;}); server.stdout.resume();
  try {
    const base=`http://127.0.0.1:${port}`;
    await waitFor(async()=>{try{return (await fetch(`${base}/api/health`)).ok;}catch{return false;}},10000);
    assert.equal((await fetch(`${base}/api/tiktok/connect`,{method:'POST'})).status,403);
    const fixture=path.join(folder,'fixture.mp4'); await tool(['-f','lavfi','-i','color=size=320x240:rate=60:duration=0.25','-c:v','libx264','-preset','ultrafast',fixture]);
    const form=new FormData(); const body=await fs.readFile(fixture);
    form.append('video',new Blob([body]),'one.mp4'); form.append('video',new Blob([body]),'two.mp4');
    const response=await fetch(`${base}/api/uploads`,{method:'POST',body:form}); assert.equal(response.status,202);
    const accepted=await response.json(); assert.equal(accepted.jobs.length,2);
    const jobs=await waitFor(async()=>{const list=await (await fetch(`${base}/api/jobs`)).json(); return list.length===2 && list.every((job)=>['complete','failed'].includes(job.status)) ? list : false;});
    assert.ok(jobs.every((job)=>job.status==='complete'),JSON.stringify(jobs));
    assert.deepEqual(jobs.map((job)=>job.sourceName),['one.mp4','two.mp4']); assert.ok(jobs.every((job)=>job.media.bitrate==='25M' && !job.telegramStatus));
    const download=await fetch(`${base}/api/jobs/${jobs[0].id}/download`); assert.equal(download.status,200);
    const output=path.join(folder,'download.mp4'); await fs.writeFile(output,new Uint8Array(await download.arrayBuffer()));
    assert.equal((await probe(output)).codec,'h264');
    await fetch(`${base}/api/jobs/completed`,{method:'DELETE'});
    assert.deepEqual(await (await fetch(`${base}/api/jobs`)).json(),[]);
    assert.equal((await fs.readdir(path.join(folder,'incoming'))).length,2);
    assert.equal((await fs.readdir(path.join(folder,'output'))).length,2);
  } finally { server.kill(); await once(server,'close'); await fs.rm(folder,{recursive:true,force:true}); }
  assert.equal(errors,'');
});
