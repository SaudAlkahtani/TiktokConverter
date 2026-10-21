import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Bot, InputFile } from "grammy";
import { config, bitrateFor } from "./config.js";
import { probe } from "./ffmpeg.js";
import { registerTikTok } from './tiktok-telegram.js';

const humanBytes = (bytes) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const localApi = (settings) => new URL(settings.telegramApiRoot).hostname !== "api.telegram.org";
export const redactTelegramError = (error, settings = config) => String(error?.message || error)
  .replaceAll(settings.token || "[no-token]", "[redacted]")
  .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "[redacted]");

// Local Bot API returns Linux absolute paths, not Windows-relative paths.
export function localFileSystemPath(filePath, distribution = config.wslDistribution, platform = process.platform) {
  if (platform !== "win32") return filePath;
  const mount = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(filePath);
  if (mount) return `${mount[1].toUpperCase()}:\\${mount[2].replace(/\//g, "\\")}`;
  if (filePath.startsWith("/")) return `\\\\wsl.localhost\\${distribution}\\${filePath.slice(1).replace(/\//g, "\\")}`;
  return filePath;
}

export async function saveIncoming(bot, media, target, settings = config) {
  const file = await bot.api.getFile(media.fileId);
  if (!file.file_path) throw new Error("Telegram did not return a downloadable file.");
  const filePath = file.file_path;
  const absolute = filePath.startsWith("/") || path.win32.isAbsolute(filePath);
  const segments = filePath.replace(/\\/g, "/").split("/");
  if (segments.includes("..")) throw new Error("Invalid Telegram cache path.");
  if (localApi(settings) && absolute) {
    const cachePath = localFileSystemPath(filePath, settings.wslDistribution);
    const stat = await fs.stat(cachePath);
    if (!stat.isFile() || stat.size > settings.uploadLimitBytes) throw new Error("Telegram file exceeds the configured input limit.");
    await fs.copyFile(cachePath, target, fssync.constants.COPYFILE_EXCL);
    // Remove only a file inside this dedicated bot's disposable media cache.
    const botIndex = segments.indexOf(settings.token);
    if (botIndex >= 0 && ["documents", "videos", "animations", "video_notes"].includes(segments[botIndex + 1])) {
      try { await fs.unlink(cachePath); } catch { console.warn("Telegram cache cleanup failed; worker copy is safe."); }
    }
    return stat.size;
  }
  if (absolute) throw new Error("Unexpected absolute path from the cloud Bot API.");
  const root = settings.telegramApiRoot.replace(/\/$/, "");
  const response = await fetch(`${root}/file/bot${settings.token}/${filePath}`, { signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`Telegram download failed (${response.status}).`);
  let size = 0;
  const limit = new Transform({ transform(chunk, encoding, callback) {
    size += chunk.length;
    callback(size > settings.uploadLimitBytes ? new Error("Telegram file exceeds the configured input limit.") : null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), limit, fssync.createWriteStream(target, { flags: "wx" }));
  return size;
}

export async function receiveTelegramVideo(ctx, queue, bot, settings = config, method = 'return') {
  if (!['return', 'tiktok'].includes(method)) throw new Error('Unknown video method.');
  const media = ctx.message.document || ctx.message.video || ctx.message.animation;
  if (!media) return;
  const bytes = Number(media.file_size || 0);
  if (bytes > settings.uploadLimitBytes) return ctx.reply("That file exceeds this worker's input limit.");
  if (!localApi(settings) && bytes > 20 * 1024 ** 2) return ctx.reply("Files above 20 MB need the Local Telegram Bot API server. Enable it on this computer, then resend as a File.");
  const sourceName = path.basename(media.file_name || `telegram-${media.file_unique_id}.mp4`).slice(0, 100);
  const target = path.join(settings.directories.incoming, `${Date.now()}-${randomUUID()}-${sourceName.replace(/[^a-z0-9._-]/gi, "_")}`);
  let queued = false;
  try {
    await ctx.reply(`Downloading ${sourceName} (${humanBytes(bytes)}) to this computer…`);
    const savedBytes = await saveIncoming(bot, { fileId: media.file_id }, target, settings);
    const source = await probe(target);
    const job = queue.add({ sourcePath: target, sourceName, bytes: savedBytes, chatId: ctx.chat.id, messageId: ctx.message.message_id, userId: ctx.from?.id, method });
    queued = true;
    await ctx.reply(`Queued #${job.id.slice(0, 8)}: ${source.width}×${source.height} → same resolution, 60fps, ${settings.inputTimestampScale === 2 ? 'half speed (2× duration)' : 'normal speed'}, HEVC, ${bitrateFor(source).bitrate} target. ${method === 'tiktok' ? `I will return a preview File, then ask for the description for @${settings.tiktok.handle}. Publishing requires review and confirmation.` : 'I will return the MP4 as a File only. No TikTok draft or post will be created.'}`);
  } catch (error) {
    console.error("Telegram receive:", redactTelegramError(error, settings));
    if (!queued) {
      await fs.rm(target, { force: true });
      await ctx.reply("Could not receive that video. Send an original video as a File. Check the local dashboard and Telegram API server if it happens again.");
    }
  }
}

// Choices belong to a particular message, not a global user preference. No file
// is downloaded until its sender chooses; restart/expiry requires resending.
export function registerVideoMethods(bot, receive, { settings = config, tiktokAvailable = true, now = Date.now } = {}) {
  const choices = new Map();
  const expiresAfter = 60 * 60 * 1000;
  bot.on(['message:document', 'message:video', 'message:animation'], async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    for (const [id, choice] of choices) if (choice.expires <= now()) choices.delete(id);
    if (choices.size >= 500) return ctx.reply('Too many waiting videos. Choose a method for an earlier video or try again in an hour.');
    const id = randomUUID().replaceAll('-', '').slice(0, 16);
    const media = ctx.message.document || ctx.message.video || ctx.message.animation;
    const name = path.basename(media.file_name || 'your video').slice(0, 100);
    choices.set(id, { ctx, userId: ctx.from.id, chatId: ctx.chat.id, expires: now() + expiresAfter });
    try {
      await ctx.reply(`Which method for ${name}?\nReturn video only: convert and send the File back.\nUpload to TikTok: convert, send a preview, then ask for the description for @${settings.tiktok.handle}. You must review and confirm before publishing.\nChoose within one hour.`, {
        reply_parameters: { message_id: ctx.message.message_id },
        reply_markup: { inline_keyboard: [
          [{ text: 'Return video only', callback_data: `vm:${id}:return` }],
          [{ text: `Upload to TikTok @${settings.tiktok.handle}`, callback_data: `vm:${id}:tiktok` }]
        ] }
      });
    } catch (error) { choices.delete(id); throw error; }
  });
  bot.callbackQuery(/^vm:/, async (ctx) => {
    const [, id, method] = ctx.callbackQuery.data.split(':');
    const choice = choices.get(id);
    if (!choice || choice.expires <= now()) {
      choices.delete(id);
      return ctx.answerCallbackQuery({ text: 'Already selected or expired. Resend the video for a new choice.', show_alert: true });
    }
    if (String(choice.userId) !== String(ctx.from?.id) || String(choice.chatId) !== String(ctx.chat?.id)) {
      return ctx.answerCallbackQuery({ text: 'Only the sender can choose a method for this video.', show_alert: true });
    }
    if (!['return', 'tiktok'].includes(method)) return ctx.answerCallbackQuery({ text: 'Unknown method.', show_alert: true });
    if (method === 'tiktok' && !tiktokAvailable) return ctx.answerCallbackQuery({ text: 'TikTok workflow is unavailable. Choose Return video only.', show_alert: true });
    // Consume before awaiting so two rapid taps cannot enqueue the video twice.
    choices.delete(id);
    await ctx.answerCallbackQuery({ text: method === 'return' ? 'Return video only selected' : 'TikTok upload selected' }).catch(() => {});
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    await receive(choice.ctx, method);
  });
}

export async function deliverTelegramExport(bot, queue, job, settings = config) {
  if (job.chatId == null) return; // Never send browser uploads to Telegram.
  job.telegramStatus = "sending"; queue.emitUpdate();
  try {
    const bytes = job.media.bytes;
    if (bytes > (localApi(settings) ? 2000 * 1000 ** 2 : 50 * 1024 ** 2)) throw new Error("Output exceeds Telegram's file upload limit.");
    await bot.api.sendDocument(job.chatId, new InputFile(job.outputPath), {
      caption: `Done: ${path.basename(job.outputPath)}\n${job.media.width}×${job.media.height} • 60fps • ${job.media.timestampScale === 2 ? 'half speed (2× duration)' : 'normal speed'} • HEVC • ${job.media.bitrate} target • ${humanBytes(bytes)}`
    });
    job.telegramStatus = "sent"; job.telegramSentAt = new Date().toISOString();
  } catch (error) {
    job.telegramStatus = "failed"; job.telegramError = redactTelegramError(error, settings); queue.emitUpdate();
    await bot.api.sendMessage(job.chatId, "The export is complete, but delivery failed. The original and output are kept on this computer. Use /retry or download it from the local dashboard.").catch(() => {});
    return;
  }
  // Source removal happens only after Telegram confirms successful delivery.
  if (settings.cleanupSourceAfterSend) {
    const relative = path.relative(settings.directories.incoming, job.sourcePath);
    try {
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Source is outside the worker's incoming directory.");
      await fs.unlink(job.sourcePath); job.sourceDeletedAt = new Date().toISOString();
    } catch (error) { job.cleanupError = redactTelegramError(error, settings); }
  }
  queue.emitUpdate();
}

export async function startTelegram(queue, { settings = config, bot, poll = true, state = {}, tiktokDrafts } = {}) {
  state.configured = Boolean(settings.token); state.status = "disabled";
  if (!settings.token) return null;
  if (!settings.botUsername) throw new Error("Set TELEGRAM_BOT_USERNAME to the dedicated exporter bot, not OpenClaw's bot.");
  bot ??= new Bot(settings.token, { client: { apiRoot: settings.telegramApiRoot, timeoutSeconds: 1800 } });
  bot.botInfo = await bot.api.getMe(AbortSignal.timeout(15000));
  if (bot.botInfo.username?.toLowerCase() !== settings.botUsername.replace(/^@/, "").toLowerCase()) throw new Error("Telegram token does not match the dedicated exporter username. Bot not started.");
  const webhook = await bot.api.getWebhookInfo(AbortSignal.timeout(15000));
  if (webhook.url) throw new Error("Dedicated bot has a webhook. Remove it deliberately before using this local polling worker.");
  state.username = bot.botInfo.username; state.status = "starting";
  bot.use(async (ctx, next) => {
    if (ctx.message?.text === '/myid') return next();
    if (!ctx.chat || (settings.allowedChatIds.size && !settings.allowedChatIds.has(String(ctx.chat.id)))) return ctx.reply("This bot is not authorized for this chat.");
    await next();
  });
  bot.command("start", (ctx) => ctx.reply(`Send your original video as a File, then choose Return video only or Upload to TikTok @${settings.tiktok.handle}. Same locked local profile: original dimensions, 60fps, half-speed timestamps, HEVC MP4, 20 Mbps target, AAC 256k. Only the TikTok choice asks for a description. Use /myid and /tiktok for setup/status. Publishing requires account verification and explicit confirmation.`));
  bot.command("profile", (ctx) => ctx.reply(`Same as local uploads: original dimensions • 60fps • -itsscale 2 • HEVC/hvc1 • 20M • AAC 256k stereo • locked to commit 6378e68.`));
  let askForCaption = async()=>{};
  if(!tiktokDrafts)bot.command('myid',(ctx)=>ctx.reply(`Telegram user ID: ${ctx.from?.id}\nChat ID: ${ctx.chat?.id}`));
  bot.command("status", (ctx) => {
    const jobs = queue.snapshot().filter((job) => String(job.chatId) === String(ctx.chat.id));
    const job = jobs.find((item) => item.status === "processing") || jobs.find((item) => item.status === "queued") || jobs.at(-1);
    return ctx.reply(job ? `${job.sourceName}: ${job.status}, ${job.progress}%${job.telegramStatus ? `, Telegram ${job.telegramStatus}` : ""}` : "No exports. Send a video as a File.");
  });
  const pending = new Set();
  const send = (job) => {
    if (job.chatId == null || job.telegramStatus === "sending" || job.telegramStatus === "sent") return Promise.resolve();
    const task = deliverTelegramExport(bot, queue, job, settings).then(()=>job.telegramStatus === 'sent' && job.method === 'tiktok' ? askForCaption(job) : undefined).catch((error) => console.error("Telegram delivery:", redactTelegramError(error, settings)));
    pending.add(task); task.finally(() => pending.delete(task)); return task;
  };
  bot.command("retry", async (ctx) => {
    const job = queue.jobs.findLast((item) => String(item.chatId) === String(ctx.chat.id) && item.status === "complete" && item.telegramStatus === "failed");
    if (!job) return ctx.reply("No failed delivery to retry.");
    await send(job);
  });
  registerVideoMethods(bot, (ctx, method) => receiveTelegramVideo(ctx, queue, bot, settings, method), { settings, tiktokAvailable: Boolean(tiktokDrafts) });
  if(tiktokDrafts)askForCaption=registerTikTok(bot,tiktokDrafts);
  const failed = (job) => {
    if (job.chatId != null) bot.api.sendMessage(job.chatId, `Export failed for ${job.sourceName}. The source was kept; check the dashboard for details.`).catch(() => {});
  };
  queue.on("complete", send); queue.on("failed", failed);
  bot.catch((error) => console.error("Telegram update:", redactTelegramError(error, settings)));
  if (poll) bot.start({ drop_pending_updates: false, allowed_updates: ["message","callback_query"], onStart: () => { state.status = "running"; } })
    .catch((error) => { state.status = "failed"; state.error = redactTelegramError(error, settings); console.error("Telegram polling:", state.error); });
  else state.status = "ready";
  return { bot, state, async stop() { queue.off("complete", send); queue.off("failed", failed); if (bot.isRunning()) await bot.stop(); await Promise.allSettled([...pending]); state.status = "stopped"; } };
}
