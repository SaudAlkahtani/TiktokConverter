import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Bot } from 'grammy';
import { config } from '../src/config.js';
import { TikTokDrafts, parseSchedule } from '../src/tiktok-drafts.js';
import { TikTokBrowser, digest, within } from '../src/tiktok-browser.js';
import { registerTikTok } from '../src/tiktok-telegram.js';

async function fixture() {
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'tiktok-draft-test-'));
  const settings={...config,directories:{...config.directories,output:folder},tiktok:{...config.tiktok,handle:'test_owner',ownerIds:new Set(['42']),settingsPath:path.join(folder,'state')}};
  const browser={calls:0,manifest:async()=>({fields:{comments:{kind:'checkbox',label:'Comments'}}}),cancel:async()=>{},prepare:async(draft)=>({review:{account:'@test_owner',caption:draft.caption,fields:draft.options},screenshot:'fake-preview.png'}),submit:async function(){this.calls++;return {status:'published',url:'https://www.tiktok.com/tiktokstudio/content'};}};
  const drafts=await new TikTokDrafts(browser,settings).load();
  const draft=await drafts.create({id:'job',userId:42,chatId:42,sourceName:'clip.mp4',outputPath:path.join(folder,'clip.mp4')});
  return {folder,settings,browser,drafts,draft,close:()=>fs.rm(folder,{recursive:true,force:true})};
}

test('Riyadh scheduling is timezone-aware and invalid/past dates are rejected',()=>{
  const now=Date.parse('2026-10-12T12:00:00Z');
  assert.equal(parseSchedule('2026-10-13','19:30','Asia/Riyadh',now).instant,'2026-10-13T16:30:00.000Z');
  assert.throws(()=>parseSchedule('2026-02-31','19:30','Asia/Riyadh',now),/Invalid/);
  assert.throws(()=>parseSchedule('2026-10-12','15:01','Asia/Riyadh',now),/15 minutes/);
  assert.throws(()=>parseSchedule('2026-10-13','25:00','Asia/Riyadh',now),/Invalid/);
});
test('caption → settings → review → explicit confirmation publishes exactly once',async()=>{
  const f=await fixture();try {
    await f.drafts.caption(f.draft,'Leg day #fitness');await f.drafts.option(f.draft,'comments','false');
    assert.equal(f.draft.options.comments,false);assert.equal(f.browser.calls,0);
    await f.drafts.review(f.draft);const confirmation=f.draft.confirmation;
    await assert.rejects(f.drafts.publish(f.draft,'wrong'),/stale/);assert.equal(f.browser.calls,0);
    await f.drafts.publish(f.draft,confirmation);assert.equal(f.browser.calls,1);assert.equal(f.draft.status,'published');
    await assert.rejects(f.drafts.publish(f.draft,confirmation),/stale/);assert.equal(f.browser.calls,1);
  }finally{await f.close();}
});
test('caption changes invalidate preview and cross-user/cross-chat access is rejected',async()=>{
  const f=await fixture();try {
    await f.drafts.caption(f.draft,'First caption');await f.drafts.review(f.draft);const stale=f.draft.confirmation;
    await f.drafts.caption(f.draft,'Changed caption');await assert.rejects(f.drafts.publish(f.draft,stale),/stale/);
    assert.throws(()=>f.drafts.get(f.draft.id,99,42),/not found/);assert.throws(()=>f.drafts.get(f.draft.id,42,99),/not found/);
    f.settings.tiktok.ownerIds.clear();await assert.rejects(f.drafts.review(f.draft),/locked/);
  }finally{await f.close();}
});
test('unverified submission is persisted as uncertain and cannot be automatically repeated',async()=>{
  const f=await fixture();try {
    await f.drafts.caption(f.draft,'Caption');await f.drafts.review(f.draft);const token=f.draft.confirmation;
    f.browser.submit=async()=>{f.browser.calls++;throw new Error('Success selector not found after click');};
    await assert.rejects(f.drafts.publish(f.draft,token),/not verified/);assert.equal(f.draft.status,'uncertain');
    const restored=await new TikTokDrafts(f.browser,f.settings).load();assert.equal(restored.items[0].status,'uncertain');
    await assert.rejects(restored.publish(restored.items[0],token),/stale/);assert.equal(f.browser.calls,1);
  }finally{await f.close();}
});
test('restart discards stale approvals and never resumes an in-flight post',async()=>{
  const f=await fixture();try {
    f.draft.status='submitting';await f.drafts.save();let restored=await new TikTokDrafts(f.browser,f.settings).load();assert.equal(restored.items[0].status,'uncertain');
    f.draft.status='review';f.draft.confirmation='old';await f.drafts.save();restored=await new TikTokDrafts(f.browser,f.settings).load();assert.equal(restored.items[0].status,'editing');assert.equal(restored.items[0].confirmation,undefined);
  }finally{await f.close();}
});
test('adapter fails closed without selectors, correct identity or unchanged settings',async()=>{
  const f=await fixture();try {
    const browser=new TikTokBrowser(f.settings);
    await assert.rejects(browser.manifest(),/calibration/);
    browser.page={url:()=> 'https://www.tiktok.com/tiktokstudio/upload',locator:()=>({count:async()=>1,textContent:async()=>'@wrong_user',getAttribute:async()=>null,innerText:async()=>''})};
    await assert.rejects(browser.account({accountSelector:'#account'}),/does not match/);
    browser.prepared={id:f.draft.id,hash:digest({caption:'old'}),manifest:{}};
    browser.readState=async()=>({caption:'changed'});
    await assert.rejects(browser.submit(f.draft),/changed after review/);
    assert.ok(!within(f.folder,path.join(f.folder,'..','private.txt')));
  }finally{await f.close();}
});
test('scheduled adapter uses only native Schedule and its own success indicator',async()=>{
  const f=await fixture();try{
    const browser=new TikTokBrowser(f.settings);const state={account:'@test_owner',caption:'Caption',fields:{schedule:true}};let clicked='';let success='';
    browser.prepared={id:f.draft.id,hash:digest(state),manifest:{postSelector:'#post',scheduleSubmitSelector:'#schedule',successSelector:'#posted',scheduledSuccessSelector:'#scheduled'}};
    browser.readState=async()=>state;browser.unique=async(selector)=>({innerText:async()=>'Schedule',isEnabled:async()=>true,click:async()=>{clicked=selector;}});
    browser.page={locator:(selector)=>({waitFor:async()=>{success=selector;}}),url:()=> 'https://www.tiktok.com/tiktokstudio/content'};
    const result=await browser.submit({...f.draft,schedule:{date:'2026-10-20',time:'19:30'}});
    assert.equal(clicked,'#schedule');assert.equal(success,'#scheduled');assert.equal(result.status,'scheduled');
  }finally{await f.close();}
});
test('Telegram requests the caption after conversion and routes replies to the correct persisted draft',async()=>{
  const f=await fixture();try {
    const bot=new Bot('123456:TEST_TOKEN_NOT_REAL',{botInfo:{id:123456,is_bot:true,first_name:'Test',username:'Test_bot'}});
    const messages=[];
    bot.api.config.use(async(previous,method,payload)=>{assert.equal(method,'sendMessage');messages.push(payload);return {ok:true,result:{message_id:messages.length,chat:{id:42,type:'private'},date:0}};});
    const completed=registerTikTok(bot,f.drafts);
    await completed({id:'return-job',userId:42,chatId:42,sourceName:'return-only.mp4',method:'return',outputPath:path.join(f.folder,'return-only.mp4')});
    assert.equal(messages.length,0);assert.equal(f.drafts.items.length,1);
    await completed({id:'new-job',userId:42,chatId:42,sourceName:'second.mp4',method:'tiktok',outputPath:path.join(f.folder,'second.mp4')});
    const draft=f.drafts.items[1];assert.match(messages[0].text,/What description/);
    await bot.handleUpdate({update_id:1,message:{message_id:20,date:0,chat:{id:42,type:'private'},from:{id:42,is_bot:false,first_name:'Test'},text:'Workout caption #fitness',reply_to_message:{message_id:draft.promptMessageId,date:0,chat:{id:42,type:'private'}}}});
    assert.equal(draft.caption,'Workout caption #fitness');assert.equal(f.draft.caption,'');assert.equal(f.browser.calls,0);
    await bot.handleUpdate({update_id:2,message:{message_id:21,date:0,chat:{id:42,type:'private'},from:{id:42,is_bot:false,first_name:'Test'},text:`/schedule ${draft.id.slice(0,8)} now`,entities:[{offset:0,length:9,type:'bot_command'}]}});
    assert.equal(draft.schedule,null);
  }finally{await f.close();}
});
