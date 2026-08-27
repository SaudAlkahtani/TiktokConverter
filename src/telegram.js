import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { Bot, InputFile } from "grammy";
import { config, isLocalBotApi } from "./config.js";
import { probe } from "./ffmpeg.js";

const cloudApi = "https://api.telegram.org";

function permitted(chatId) { return config.allowedChatIds.size === 0 || config.allowedChatIds.has(String(chatId)); }
function mediaFrom(ctx) {
  const document = ctx.message?.document;
  const video = ctx.message?.video;
  const animation = ctx.message?.animation;
  const media = document || video || animation;
  if (!media) return null;
  const filename = document?.file_name || video?.file_name || animation?.file_name || `telegram-video-${media.file_unique_id}`;
  return { fileId: media.file_id, filename, bytes: Number(media.file_size || 0) };
}
function localFileUrl(filePath) {
  return new URL(`/file/bot${config.token}/${filePath.replace(/^\/+/, "")}`, config.telegramApiRoot).toString();
}
function localFileSystemPath(filePath) {
  // The official server is running in WSL, so it returns paths such as
  // /mnt/c/Users/... . Convert those to the equivalent Windows path before
  // copying them with Node on Windows.
  const wslMount = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(filePath || "");
  if (wslMount) return `${wslMount[1].toUpperCase()}:\\${wslMount[2].replace(/\//g, "\\")}`;
  const wslHome = /^\/(home\/.*)$/.exec(filePath || "");
  return wslHome ? `\\\\wsl.localhost\\Ubuntu-24.04\\${wslHome[1].replace(/\//g, "\\")}` : filePath;
}
function isLocallyReachableWslPath(filePath) { return /^\/(?:mnt\/[a-zA-Z]|home)\//.test(filePath || ""); }
async function saveIncoming(bot, media, target) {
  const file = await bot.api.getFile(media.fileId);
  if (isLocalBotApi && file.file_path && isLocallyReachableWslPath(file.file_path)) {
    const localCachePath = localFileSystemPath(file.file_path);
    await fs.copyFile(localCachePath, target);
    // This is the Local Bot API's disposable download cache. The worker has
    // its own copy in MEDIA_ROOT now, so remove the duplicate immediately.
    try { await fs.rm(localCachePath, { force: true }); }
    catch (error) { console.warn("Could not remove Local Bot API cache:", error.message); }
    return;
  }
  const source = isLocalBotApi ? localFileUrl(file.file_path) : `${cloudApi}/file/bot${config.token}/${file.file_path}`;
  const response = await fetch(source);
  if (!response.ok || !response.body) throw new Error(`Telegram download failed (${response.status})`);
  await fs.writeFile(target, Readable.fromWeb(response.body));
}
function humanBytes(bytes) { return bytes < 1024 ** 2 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`; }

export async function startTelegram(queue) {
  if (!config.token) return null;
  const bot = new Bot(config.token, { client: { apiRoot: config.telegramApiRoot } });
  const me = await bot.api.getMe();
  const expectedUsername = config.botUsername.replace(/^@/, "").toLowerCase();
  if ((me.username || "").toLowerCase() !== expectedUsername) {
    throw new Error(`The configured token belongs to @${me.username || "unknown"}, not ${config.botUsername}. The bot was not started.`);
  }
  bot.command("start", (ctx) => ctx.reply("Send an original video as a File. I accept 1080p60, 2K, 3K, 4K, and any container FFmpeg can read; I will make a 1080×1920, 60fps TikTok export and return it here."));
  bot.command("profile", (ctx) => ctx.reply("Output: 1080×1920 • 60fps • H.264 MP4 • 10 Mbps target / 12 Mbps max • AAC 256 kbps stereo • half-speed timestamp test mode."));
  bot.command("status", (ctx) => {
    const jobs = queue.snapshot().filter((job) => String(job.chatId) === String(ctx.chat.id));
    const active = jobs.find((job) => job.status === "processing") || jobs.find((job) => job.status === "queued");
    return ctx.reply(active ? `${active.status}: ${active.sourceName} — ${active.progress}%` : "No active export. Send a video as a File.");
  });
  bot.on(["message:document", "message:video", "message:animation"], async (ctx) => {
    if (!permitted(ctx.chat.id)) return ctx.reply("This bot is not authorized for this chat.");
    const media = mediaFrom(ctx);
    if (!media) return ctx.reply("Please send a video as a File.");
    if (config.maxInputBytes && media.bytes > config.maxInputBytes) return ctx.reply(`That file is ${humanBytes(media.bytes)}, above this worker's configured input limit.`);
    if (!isLocalBotApi && media.bytes > 20 * 1024 * 1024) return ctx.reply("This clip is larger than 20 MB. Standard Telegram bots cannot download it. Configure TELEGRAM_API_ROOT to a local Telegram Bot API Server, then resend the original file.");
    const receivedName = `${Date.now()}-${media.filename.replace(/[^a-z0-9._-]/gi, "_")}`;
    const target = path.join(config.directories.incoming, receivedName);
    try {
      await ctx.reply(`Downloading ${media.filename} (${humanBytes(media.bytes)}) to this computer…`);
      await saveIncoming(bot, media, target);
      const source = await probe(target);
      const job = queue.add({ sourcePath: target, sourceName: media.filename, chatId: ctx.chat.id, messageId: ctx.message.message_id, bytes: media.bytes });
      await ctx.reply(`Accepted ${source.width}×${source.height} at ${source.fps || "unknown"} fps. Queued #${job.id.slice(0, 8)} with the 1080×1920 60fps profile.`);
    } catch (error) {
      console.error("Telegram download failed:", error.message.replaceAll(config.token, "[redacted]"));
      await fs.rm(target, { force: true });
      const message = error.message.includes("No readable video stream") || error.message.startsWith("ffprobe failed")
        ? "I downloaded that file, but FFmpeg could not read it as a video. Send an original video file or use a supported codec/container."
        : "Could not receive that video. The local download failed; please resend it as a File.";
      await ctx.reply(message);
    }
  });
  queue.on("complete", async (job) => {
    try {
      await bot.api.sendDocument(job.chatId, new InputFile(job.outputPath), { caption: `Done: ${path.basename(job.outputPath)}\n1080×1920 • 60 fps • H.264 • ${humanBytes(job.media.bytes)}` });
    } catch (error) {
      job.telegramError = error.message; queue.emitUpdate();
      await bot.api.sendMessage(job.chatId, "The export is complete, but Telegram could not accept the output. Download it from the local dashboard.");
      return;
    }
    if (config.cleanupSourceAfterSend) {
      try {
        await fs.rm(job.sourcePath, { force: true });
        job.sourceDeletedAt = new Date().toISOString();
      } catch (error) {
        job.cleanupError = error.message;
      }
      queue.emitUpdate();
    }
  });
  queue.on("failed", (job) => bot.api.sendMessage(job.chatId, `Export failed for ${job.sourceName}: ${job.error.slice(0, 700)}`).catch(() => {}));
  bot.catch((error) => console.error("Telegram bot error:", error.message));
  bot.start({ drop_pending_updates: false });
  return bot;
}
