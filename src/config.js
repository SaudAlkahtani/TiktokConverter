import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bundledFfmpeg from "ffmpeg-static";
import bundledFfprobe from "ffprobe-static";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mediaRoot = path.resolve((process.env.MEDIA_ROOT || root).trim());
const list = (value) => new Set((value || "").split(",").map((item) => item.trim()).filter(Boolean));

export const config = {
  root,
  port: Number(process.env.PORT || 4173),
  botUsername: (process.env.TELEGRAM_BOT_USERNAME || "@YOUR_NEW_EXPORTER_BOT").trim(),
  token: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramApiRoot: (process.env.TELEGRAM_API_ROOT || "https://api.telegram.org").replace(/\/$/, ""),
  allowedChatIds: list(process.env.ALLOWED_CHAT_IDS),
  ffmpeg: process.env.FFMPEG_PATH || bundledFfmpeg || "ffmpeg",
  ffprobe: process.env.FFPROBE_PATH || bundledFfprobe.path || "ffprobe",
  maxInputBytes: Math.max(0, Number(process.env.MAX_INPUT_GB || 0)) * 1024 ** 3,
  cleanupSourceAfterSend: (process.env.DELETE_SOURCE_AFTER_SEND || "true").trim().toLowerCase() !== "false",
  inputTimestampScale: Math.max(0.01, Number(process.env.VIDEO_TIMESTAMP_SCALE || 1)),
  export: {
    bitrate: process.env.VIDEO_BITRATE || "10M",
    maxrate: process.env.VIDEO_MAXRATE || "12M",
    bufsize: process.env.VIDEO_BUFSIZE || "24M",
    sharpen: process.env.VIDEO_SHARPEN?.trim() ?? "unsharp=3:3:0.4:3:3:0.4"
  },
  directories: {
    incoming: path.join(mediaRoot, "incoming"),
    output: path.join(mediaRoot, "output"),
    data: path.join(root, "data")
  },
  mediaRoot
};

export const isLocalBotApi = config.telegramApiRoot !== "https://api.telegram.org";
