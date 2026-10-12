import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { config } from './config.js';
import { within } from './tiktok-browser.js';

export function parseSchedule(date,time,timezone,now=Date.now()) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error('Use YYYY-MM-DD HH:mm.');
  const [year,month,day]=date.split('-').map(Number); const [hour,minute]=time.split(':').map(Number);
  const base=Date.UTC(year,month-1,day,hour,minute);
  if(month<1 || month>12 || day<1 || day>31 || hour>23 || minute>59 || new Date(base).toISOString().slice(0,10)!==date) throw new Error('Invalid calendar date/time.');
  const format=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  let instant=base;
  const wall=(value)=>{const p=Object.fromEntries(format.formatToParts(new Date(value)).map((part)=>[part.type,part.value])); return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);};
  for(let n=0;n<3;n++) instant+=base-wall(instant);
  if(wall(instant)!==base) throw new Error('That time does not exist in this timezone.');
  if(instant-now<15*60*1000) throw new Error('Schedule at least 15 minutes ahead. TikTok may require a longer interval.');
  return {date,time,timezone,instant:new Date(instant).toISOString()};
}

export class TikTokDrafts {
  constructor(browser,settings=config) {this.browser=browser;this.settings=settings;this.items=[];this.writes=Promise.resolve();}
  async load() {
    try {this.items=JSON.parse(await fs.readFile(path.join(this.settings.tiktok.settingsPath,'drafts.json'),'utf8'));}
    catch(error) {if(error.code!=='ENOENT') throw error;}
    for(const draft of this.items) {if(draft.status==='submitting') draft.status='uncertain'; if(draft.status==='review') {draft.status='editing';delete draft.confirmation;}}
    await this.save(); return this;
  }
  save() {
    const snapshot=JSON.stringify(this.items,null,2);
    this.writes=this.writes.catch(()=>{}).then(async()=>{const folder=this.settings.tiktok.settingsPath;await fs.mkdir(folder,{recursive:true});const temporary=path.join(folder,'drafts.tmp');await fs.writeFile(temporary,snapshot);await fs.rename(temporary,path.join(folder,'drafts.json'));});
    return this.writes;
  }
  owner(userId) {return this.settings.tiktok.ownerIds.has(String(userId));}
  get(id,userId,chatId) {
    if(typeof id!=='string' || !/^[a-f0-9-]{8,36}$/i.test(id)) throw new Error('Supply the draft ID shown with your video.');
    const matches=this.items.filter((d)=>d.id.startsWith(id) && String(d.userId)===String(userId) && String(d.chatId)===String(chatId));
    if(matches.length!==1) throw new Error('Draft not found in your chat, or its ID is ambiguous.'); return matches[0];
  }
  editable(draft) {if(['submitting','published','scheduled','uncertain','cancelled'].includes(draft.status)) throw new Error('This draft cannot be changed or automatically retried. Check TikTok Studio.');}
  async create(job) {
    if(!within(this.settings.directories.output,job.outputPath)) throw new Error('Only converter exports are accepted.');
    const existing=this.items.find((d)=>d.jobId===job.id); if(existing)return existing;
    const draft={id:randomUUID(),jobId:job.id,userId:job.userId,chatId:job.chatId,sourceName:job.sourceName,outputPath:job.outputPath,status:'caption',caption:'',options:{},schedule:null,createdAt:new Date().toISOString()};
    this.items.push(draft);await this.save();return draft;
  }
  async invalidate(draft) {if(draft.status==='review')await this.browser.cancel(draft.id);draft.status='editing';delete draft.confirmation;}
  async caption(draft,text) {this.editable(draft);if(!text.trim() || [...text].length>4000) throw new Error('Caption must be nonempty and at most 4000 characters; Studio may impose a smaller limit.');await this.invalidate(draft);draft.caption=text.trim();await this.save();}
  async option(draft,key,value) {this.editable(draft);const manifest=await this.browser.manifest();const field=manifest.fields?.[key];if(!field)throw new Error('Unknown option. Use /studio to see mapped controls.');if(['checkbox','switch'].includes(field.kind)){if(!['true','false'].includes(String(value)))throw new Error('Use true or false.');value=String(value)==='true';}await this.invalidate(draft);draft.options[key]=value;await this.save();}
  async schedule(draft,date,time) {this.editable(draft);const schedule=date==='now'?null:parseSchedule(date,time,this.settings.tiktok.timezone);await this.invalidate(draft);draft.schedule=schedule;await this.save();}
  async review(draft) {
    this.editable(draft);
    if(!this.owner(draft.userId) || !this.settings.tiktok.handle) throw new Error('TikTok publishing is locked. Configure the exact account handle and authorized Telegram user IDs first.');
    if(!draft.caption) throw new Error('Send the description first.');
    if(draft.schedule)parseSchedule(draft.schedule.date,draft.schedule.time,this.settings.tiktok.timezone);
    const result=await this.browser.prepare(draft);draft.status='review';draft.review=result.review;draft.confirmation=randomBytes(8).toString('hex');draft.confirmationExpires=Date.now()+15*60*1000;await this.save();return result;
  }
  async publish(draft,confirmation) {
    if(!this.owner(draft.userId))throw new Error('You are not authorized to publish.');
    if(draft.status!=='review' || confirmation!==draft.confirmation || Date.now()>draft.confirmationExpires)throw new Error('Review confirmation is stale. Use /prepare again.');
    if(draft.schedule)parseSchedule(draft.schedule.date,draft.schedule.time,this.settings.tiktok.timezone);
    draft.status='submitting';delete draft.confirmation;await this.save();
    try {const result=await this.browser.submit(draft);Object.assign(draft,result);draft.completedAt=new Date().toISOString();await this.save();return result;}
    catch(error){draft.status='uncertain';draft.error=error.message;await this.save();throw new Error('Submission was not verified. Check TikTok Studio before trying anything else; automatic retry is blocked to avoid duplicate posts.');}
  }
  async cancel(draft) {this.editable(draft);await this.browser.cancel(draft.id);draft.status='cancelled';delete draft.confirmation;await this.save();}
}
