import fs from "node:fs/promises";
import { config, isLocalBotApi } from "./config.js";
import { validateTools } from "./ffmpeg.js";

let failed = false;
for (const dir of Object.values(config.directories)) await fs.mkdir(dir, { recursive: true });
try { await validateTools(); console.log("✓ FFmpeg and ffprobe are available."); } catch (error) { failed = true; console.error("✗ FFmpeg check failed. Install FFmpeg and put its bin folder on PATH.\n", error.message); }
if (config.token) console.log(`✓ Token configured for dedicated bot ${config.botUsername} (${isLocalBotApi ? "local Bot API" : "standard Bot API"}).`);
else { failed = true; console.error(`✗ TELEGRAM_BOT_TOKEN is missing in .env for ${config.botUsername}.`); }
if (!isLocalBotApi) console.warn("! Standard Telegram Bot API is active: downloads are capped at 20 MB and uploads at 50 MB. Use the dedicated Local Bot API server for 4K originals.");
console.log(`✓ Workspace folders ready in ${config.root}`);
process.exitCode = failed ? 1 : 0;
