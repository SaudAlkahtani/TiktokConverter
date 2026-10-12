import { InputFile } from 'grammy';

const help=(draft)=>`Draft ${draft.id.slice(0,8)}\nCaption saved.\n/studio — mapped Studio settings\n/option ${draft.id.slice(0,8)} FIELD VALUE\n/schedule ${draft.id.slice(0,8)} YYYY-MM-DD HH:mm\n/schedule ${draft.id.slice(0,8)} now\n/prepare ${draft.id.slice(0,8)} — upload privately for review\n/cancelpost ${draft.id.slice(0,8)}\nTime zone: ${draft.schedule?.timezone || 'configured account timezone'}. No post is published without confirmation.`;
export function registerTikTok(bot,drafts) {
  const own=(ctx,id)=>drafts.get(id,ctx.from?.id,ctx.chat?.id);
  const run=(action)=>async(ctx)=>{try{await action(ctx);}catch(error){await ctx.reply(error.message.slice(0,1500));}};
  bot.command('myid',(ctx)=>ctx.reply(`Telegram user ID: ${ctx.from?.id}\nChat ID: ${ctx.chat?.id}`));
  bot.command('tiktok',run(async(ctx)=>{
    const items=drafts.items.filter((d)=>String(d.userId)===String(ctx.from?.id) && String(d.chatId)===String(ctx.chat?.id));
    await ctx.reply(`TikTok: ${drafts.settings.tiktok.handle?`@${drafts.settings.tiktok.handle}`:'not connected'}\nPublishing ${drafts.owner(ctx.from?.id)?'authorized (browser setup still required)':'locked: configure TIKTOK_ALLOWED_USER_IDS'}\n${items.slice(-8).map((d)=>`${d.id.slice(0,8)} ${d.sourceName}: ${d.status}`).join('\n') || 'Send a video first.'}`);
  }));
  bot.command('caption',run(async(ctx)=>{const [id,...text]=ctx.match.trim().split(/\s+/);const d=own(ctx,id);await drafts.caption(d,text.join(' '));await ctx.reply(help(d));}));
  bot.command('studio',run(async(ctx)=>{
    if(!drafts.owner(ctx.from?.id))throw new Error('Studio access is restricted to configured Telegram owners.');
    const manifest=await drafts.browser.manifest();
    const rows=Object.entries(manifest.fields || {}).map(([id,f])=>`${id}: ${f.label || id} (${f.kind})${f.options?` · ${f.options.map((o)=>`${o.label}=${o.value}`).join(', ')}`:''}`);
    await ctx.reply(`Actual calibrated Studio controls:\n${rows.join('\n') || 'No settings mapped yet.'}\nUse /option DRAFT FIELD VALUE. Complex editors such as covers, music, locations or product links require separate calibration/manual Studio review; they are not silently ignored.`);
  }));
  bot.command('option',run(async(ctx)=>{const [id,key,...value]=ctx.match.trim().split(/\s+/);const d=own(ctx,id);await drafts.option(d,key,value.join(' '));await ctx.reply(`Saved ${key}. Use /prepare ${d.id.slice(0,8)} to review.`);}));
  bot.command('schedule',run(async(ctx)=>{const [id,date,time]=ctx.match.trim().split(/\s+/);const d=own(ctx,id);await drafts.schedule(d,date,time);await ctx.reply(d.schedule?`Schedule requested: ${d.schedule.date} ${d.schedule.time} ${d.schedule.timezone}. TikTok must accept it; this is not a local timer.`:'Posting time: now, after explicit review confirmation.');}));
  bot.command('prepare',run(async(ctx)=>{
    const d=own(ctx,ctx.match.trim());await ctx.reply('Preparing the converted file in your verified TikTok Studio account. This uploads it for review but does not publish.');
    const result=await drafts.review(d);
    await bot.api.sendPhoto(ctx.chat.id,new InputFile(result.screenshot),{caption:`Studio review for ${d.id.slice(0,8)} — verify every visible setting.`});
    const summary=`Account: ${result.review.account}\nCaption: ${d.caption}\nWhen: ${d.schedule?`${d.schedule.date} ${d.schedule.time} ${d.schedule.timezone}`:'Post now'}\nSettings: ${JSON.stringify(result.review.fields)}\nConfirm only after checking the preview. The confirmation expires in 15 minutes.`;
    await ctx.reply(summary.slice(0,3900),{reply_markup:{inline_keyboard:[[{text:d.schedule?'Confirm schedule':'Confirm publish',callback_data:`tp:${d.id.slice(0,8)}:${d.confirmation}`}],[{text:'Cancel',callback_data:`tc:${d.id.slice(0,8)}`}]]}});
  }));
  bot.command('cancelpost',run(async(ctx)=>{const d=own(ctx,ctx.match.trim());await drafts.cancel(d);await ctx.reply('Posting cancelled. Converted file kept.');}));
  bot.callbackQuery(/^t[pc]:/,run(async(ctx)=>{
    const [action,id,confirmation]=ctx.callbackQuery.data.split(':');const d=own(ctx,id);await ctx.answerCallbackQuery();
    if(action==='tc'){await drafts.cancel(d);await ctx.reply('Posting cancelled.');return;}
    const result=await drafts.publish(d,confirmation);await ctx.reply(`TikTok confirmed: ${result.status}. Check TikTok Studio for the post.`);
  }));
  bot.on('message:text',run(async(ctx)=>{
    if(ctx.message.text.startsWith('/'))return;
    const items=drafts.items.filter((d)=>String(d.userId)===String(ctx.from?.id) && String(d.chatId)===String(ctx.chat.id) && d.status==='caption');
    const replyId=ctx.message.reply_to_message?.message_id;
    const d=replyId?items.find((item)=>item.promptMessageId===replyId):items.length===1?items[0]:null;
    if(!d){if(items.length)await ctx.reply('Reply to the description prompt for the correct video, or use /caption DRAFT description.');return;}
    await drafts.caption(d,ctx.message.text);await ctx.reply(help(d));
  }));
  return async(job)=>{
    if(job.chatId==null || job.userId==null || job.method!=='tiktok')return;
    const draft=await drafts.create(job);
    if(draft.promptMessageId)return;
    const prompt=await bot.api.sendMessage(job.chatId,`Converted ${job.sourceName}. What description/caption should accompany it on TikTok @${drafts.settings.tiktok.handle}? Reply to this message.\nDraft ${draft.id.slice(0,8)}. Nothing will be published yet.${drafts.owner(job.userId)?'':'\nPublishing is locked until your Telegram user ID is authorized. Use /myid for setup.'}`,{reply_markup:{force_reply:true,selective:true}});
    draft.promptMessageId=prompt.message_id;await drafts.save();
  };
}
