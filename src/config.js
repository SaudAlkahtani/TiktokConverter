import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bundledFfmpeg from "ffmpeg-static";
import bundledFfprobe from "ffprobe-static";
import { TIKTOK_PRESET, assertTikTokPresetEnvironment } from './tiktok-preset.js';

assertTikTokPresetEnvironment();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mediaRoot = path.resolve((process.env.MEDIA_ROOT || root).trim());
const gigabytes = Math.max(0, Number(process.env.MAX_INPUT_GB || 0));
const uploadFiles = Math.max(1, Math.min(100, Number(process.env.MAX_UPLOAD_FILES) || 20));

export const config = {
  root,
  port: Number(process.env.PORT || 4173),
  ffmpeg: process.env.FFMPEG_PATH || bundledFfmpeg || "ffmpeg",
  ffprobe: process.env.FFPROBE_PATH || bundledFfprobe.path || "ffprobe",
  // A blank/zero MAX_INPUT_GB permits uploads up to this local-server default.
  // It prevents an accidental unlimited browser upload while still allowing 4K clips.
  maxInputBytes: gigabytes * 1024 ** 3,
  uploadLimitBytes: (gigabytes || 20) * 1024 ** 3,
  maxUploadFiles: uploadFiles,
  inputTimestampScale: TIKTOK_PRESET.timestampScale,
  tiktok: {
    accountName: 'Saud fitness journey',
    handle: (process.env.TIKTOK_HANDLE || 'sauds.journey').replace(/^@/, '').trim(),
    ownerIds: new Set((process.env.TIKTOK_ALLOWED_USER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean)),
    timezone: process.env.TIKTOK_TIMEZONE || 'Asia/Riyadh',
    browserChannel: process.env.TIKTOK_BROWSER_CHANNEL || 'msedge',
    profilePath: path.join(root, '.tiktok-browser'),
    settingsPath: process.env.TIKTOK_DATA_ROOT || path.join(root, 'data', 'tiktok')
  },
  token: process.env.TELEGRAM_BOT_TOKEN?.trim() || "",
  botUsername: process.env.TELEGRAM_BOT_USERNAME?.trim() || "",
  telegramApiRoot: process.env.TELEGRAM_API_ROOT?.trim() || "https://api.telegram.org",
  wslDistribution: process.env.WSL_DISTRIBUTION?.trim() || "Ubuntu-24.04",
  allowedChatIds: new Set((process.env.TELEGRAM_ALLOWED_CHAT_IDS || "").split(",").map((id) => id.trim()).filter(Boolean)),
  cleanupSourceAfterSend: process.env.DELETE_SOURCE_AFTER_SEND !== "false",
  export: {
    videoCodec: TIKTOK_PRESET.videoCodec,
    bitrate: TIKTOK_PRESET.bitrate,
    audioBitrate: TIKTOK_PRESET.audioBitrate,
    gop: TIKTOK_PRESET.gop,
    sharpen: TIKTOK_PRESET.sharpen
  },
  directories: {
    incoming: path.join(mediaRoot, "incoming"),
    output: path.join(mediaRoot, "output"),
    data: path.join(root, "data")
  },
  mediaRoot
};

export const isLocalBotApi = new URL(config.telegramApiRoot).hostname !== "api.telegram.org";

export function bitrateFor(media) {
  return { bitrate: TIKTOK_PRESET.bitrate };
}
