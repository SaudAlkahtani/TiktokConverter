import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bundledFfmpeg from "ffmpeg-static";
import bundledFfprobe from "ffprobe-static";

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
  inputTimestampScale: Number(process.env.VIDEO_TIMESTAMP_SCALE || 2),
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
    videoCodec: process.env.VIDEO_CODEC || "libx265",
    // Copy only Khaled's resolution-dependent rate limits, not its codec/patch.
    bitrate: "18M / 28M / 45M by resolution",
    audioBitrate: "192k",
    gop: Math.max(1, Number(process.env.VIDEO_GOP || 60)),
    sharpen: process.env.VIDEO_SHARPEN?.trim() ?? "unsharp=3:3:0.4:3:3:0.4"
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
  const shortEdge = Math.min(media.width, media.height);
  const mbps = shortEdge <= 1080 ? 18 : shortEdge <= 1440 ? 28 : 45;
  return { bitrate: `${mbps}M`, maxrate: `${mbps}M`, bufsize: `${mbps * 2}M` };
}
