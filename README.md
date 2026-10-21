# Luna TikTok Exporter

This runs entirely on your Windows machine. A dedicated Telegram bot receives
an original clip, queues a local FFmpeg export, sends the final MP4 back to the
same Telegram chat, and exposes a local progress dashboard. It does not use or
modify OpenClaw or `@BigBoiSaud_bot`.

## What the export does

The TikTok profile is locked to the method in commit `6378e68` and makes an MP4 with:

- source dimensions, without resize or crop
- constant 60 fps (lower-fps sources duplicate frames, not AI interpolation)
- HEVC/H.265, 4:2:0, `hvc1`, 60-frame GOP
- 20 Mbps video bitrate target, Rec.709 metadata
- AAC stereo audio at 256 kbps and fast-start metadata
- moderate luma/chroma sharpening (`unsharp=3:3:0.4:3:3:0.4`), Rec.709 tags,
  1-second keyframes, and no embedded timecode track

`-itsscale 2` gives half-speed playback, including scaled source-audio
timestamps. On Windows, `libx265` replaces macOS-only `hevc_videotoolbox`.
Conflicting `.env` values for the locked settings prevent startup; completed
files are checked with ffprobe. The target bitrate does not guarantee a measured
20 Mbps for simple footage.

## Source files accepted

The Telegram bot accepts 1080p60, 2K, 3K, and 4K source video, plus any
container/codecs that the bundled FFmpeg can decode. It validates the actual
video stream after download instead of rejecting a file merely because its
filename has an unfamiliar extension. Send originals as Telegram **Files** to
avoid Telegram-side recompression.

It is a transparent, high-quality profile inspired by the goal of a “60fps
mode”; it does not copy or claim to be Decoy’s proprietary preset. TikTok can
still transcode every upload, so a perfect byte-for-byte preservation guarantee
is not possible.

## Install

1. Install a current [Node.js LTS](https://nodejs.org/).
2. In this folder, run `npm install` and then copy `.env.example` to `.env`.
   The project downloads a private FFmpeg runtime automatically. If you prefer
   a system FFmpeg build, set `FFMPEG_PATH` and `FFPROBE_PATH` in `.env`.
3. Create a new dedicated exporter bot with [@BotFather](https://t.me/BotFather).
   Do not use `@BigBoiSaud_bot`. Run
   `powershell -ExecutionPolicy Bypass -File .\scripts\configure-new-bot.ps1`
   and enter the new bot's username and token locally.
4. Start it with `npm start`, then open `http://127.0.0.1:4173`.
5. Message `/start` to the bot and send a clip as a **File**.

## Move to another Windows machine

Clone the private repository, install dependencies, then configure the secret
files locally (they are intentionally never stored in GitHub):

```powershell
git clone https://github.com/SaudAlkahtani/TiktokConverter.git
cd TiktokConverter
npm ci
Copy-Item .env.example .env
```

Run `scripts\configure-new-bot.ps1` to add the bot token locally. For original
4K Telegram files, follow the Local Bot API setup in this README and run
`scripts\enable-local-bot-api.ps1` with the Telegram application API ID/hash.
Run only one copy of the exporter bot at a time; two machines polling the same
bot token will conflict.

## Windows desktop shortcut

The shortcut named **Luna TikTok Exporter** starts the dedicated Local Bot API
server (once configured) and the local Node worker in the background, then
opens the dashboard. It never starts or changes OpenClaw.

## Important: large 4K Telegram files

Telegram's standard Bot API can download only 20 MB and send files up to 50 MB.
This project detects that limit and explains it in Telegram. For normal 4K
clips, use Telegram's **Local Bot API Server**, set `TELEGRAM_API_ROOT` to its
address, and restart this app. The local server supports unlimited downloads
and uploads up to 2 GB. The dashboard always has a local download link, so a
completed export remains available even if Telegram rejects an oversized output.

Set `MEDIA_ROOT` in `.env` to keep incoming and exported media on another
drive. This installation uses `D:\Luna TikTok Exporter`. Once Telegram confirms
it received an export, the original 4K source is automatically deleted; the
same-resolution output remains available in the dashboard.

## Dedicated Local Bot API setup (true 4K)

This project includes the official-source setup files in `local-bot-api/`. Use
the new dedicated exporter bot created above; do not reuse `@BigBoiSaud_bot`.

1. Install Ubuntu 24.04 in WSL, complete its first-run username/password setup,
   then run `bash /mnt/c/Users/BigBoi/OneDrive/Documents/ChatGPT/Tiktok\ High\ quality\ upload/local-bot-api/install-official-server.sh` inside Ubuntu. The build stays in your Linux home folder and does not require a system-wide install or `sudo` for the final step.
2. Create a Telegram *application* (not a bot) at `https://my.telegram.org/apps`.
   You will receive an API ID and API hash.
3. Run `powershell -ExecutionPolicy Bypass -File .\scripts\enable-local-bot-api.ps1`.

The setup starts the Local Bot API server and switches only this project's
dedicated bot to `http://127.0.0.1:8081`. Keep the Local Bot API server
local-only.

## Safety and cleanup

Files stay in `incoming/` and `output/`. Delete those folders whenever you want
to clear completed media. Keep `.env` private: it contains the bot token.
