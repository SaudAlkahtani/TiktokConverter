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
  inputTimestampScale: Math.max(0.01, Number(process.env.VIDEO_TIMESTAMP_SCALE || 2)),
  export: {
    videoCodec: process.env.VIDEO_CODEC || "libx265",
    // Every export is constant 60 fps, so use the higher 20 Mbps target.
    bitrate: process.env.VIDEO_BITRATE || "20M",
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
