import fs from "node:fs/promises";
import { config } from "./config.js";
import { validateTools } from "./ffmpeg.js";

let failed = false;
for (const dir of Object.values(config.directories)) await fs.mkdir(dir, { recursive: true });
try { await validateTools(); console.log("✓ FFmpeg and ffprobe are available."); } catch (error) { failed = true; console.error("✗ FFmpeg check failed. Install FFmpeg and put its bin folder on PATH.\n", error.message); }
console.log(`✓ Local upload limit: ${(config.uploadLimitBytes / 1024 ** 3).toFixed(0)} GB.`);
console.log(`✓ Workspace folders ready in ${config.mediaRoot}`);
process.exitCode = failed ? 1 : 0;
