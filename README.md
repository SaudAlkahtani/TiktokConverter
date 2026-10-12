# Local + Telegram Video Converter

Based on `official-local-version` (`27f2768`), the latest local build before the
Khaled branch. Browser batch uploads and the dedicated Telegram bot share one
FIFO conversion queue and exactly the same FFmpeg profile. Processing runs on
your Windows computer; the dashboard listens only on `127.0.0.1:4173`.

## Shared export profile

- Original dimensions, with no resize or crop; constant 60fps and half-speed
  playback by default (`-itsscale 2`). Audio is stretched with preserved pitch.
- Native HEVC/H.265 MP4 (`libx265`, `hvc1`, fast start), not Khaled's H.264 codec.
- Existing reference sharpening: `unsharp=3:3:0.4:3:3:0.4`.
- Khaled's resolution-dependent video rate limits, used here as HEVC **targets
  and caps**: 18 Mbps for a shorter edge up to 1080; 28 Mbps up to 1440;
  45 Mbps above 1440, including 3K and 4K. Buffer size is twice the video rate.
- AAC 192 kbps stereo, 48 kHz; 60-frame GOP, Rec.709 metadata, 8-bit 4:2:0.
- Only bitrate settings were borrowed. No ghost-sample MP4 patch, CRF 17,
  Khaled frame manipulation, or automatic resolution changes.

These are encoder rate-control settings, not a guaranteed measured bitrate:
simple footage can use less. Khaled uses them as ceilings with CRF; this local
version retains its bitrate-targeted encoding method. Its above-60fps rate
multiplier is not used because this version always outputs 60fps.

Legacy `VIDEO_BITRATE`, `VIDEO_MAXRATE` and `VIDEO_BUFSIZE` settings are ignored.
`VIDEO_TIMESTAMP_SCALE=2` is the default; set it to `1` for normal speed.
This latest pre-Khaled build does not include the separate GPU-selection branch.
Its existing SDR/8-bit filter is retained: grade/tone-map HDR or log masters to
SDR Rec.709 in your editor before upload. HEVC 4:2:0 needs even dimensions.
TikTok may recompress uploads; no final-platform quality guarantee is made.

## Start on Windows

Install Node.js 20+ and run `npm ci` once. The bundled FFmpeg/ffprobe dependencies
are used unless `.env` supplies explicit paths. Python is not required here.
Copy `.env.example` to `.env` on a new machine, without overwriting an existing
configuration. Set `MEDIA_ROOT=D:\Luna TikTok Exporter` to store downloaded
originals and outputs on D:.

Double-click `Start-Local-Converter.cmd` or the existing desktop shortcut.
The launcher starts the dedicated Local Telegram Bot API if configured, starts
the converter hidden, and opens the dashboard. Choose multiple videos to enqueue
them. Clear active cancels the active conversion and removes waiting records;
Clear completed removes finished records. Neither button deletes original or
finished files. Export files stay available on disk after a server restart,
but the in-memory dashboard records reset.

## Telegram download → convert → return

Use a separate exporter bot, never the bot used by OpenClaw. Set these locally:

```dotenv
TELEGRAM_BOT_USERNAME=@YourDedicatedExporter_bot
TELEGRAM_BOT_TOKEN=your_private_token
TELEGRAM_API_ROOT=http://127.0.0.1:8081
WSL_DISTRIBUTION=Ubuntu-24.04
TELEGRAM_ALLOWED_CHAT_IDS=your_numeric_chat_id
DELETE_SOURCE_AFTER_SEND=true
MEDIA_ROOT=D:\Luna TikTok Exporter
```

The username must match the token. Existing webhooks are not removed
automatically. Blank allowed-chat IDs permit anyone who can contact your bot;
set an allowlist to prevent unwanted use. Only one machine should poll this bot
at a time. Tokens and Telegram application credentials are ignored by Git.

Send the original video **as a File/document**, not a compressed video message.
For each video, choose **Return video only** or **Upload to TikTok @sauds.journey**.
Only after your choice does the worker download it, validate the video, queue it
alongside browser jobs, and return the finished MP4 as a File to that same chat.
Return-only never creates a TikTok draft or asks for a description. The TikTok
choice also starts the caption/review workflow; it does not publish automatically.
Choices expire after an hour or a server restart; resend an unselected video.
Local browser uploads
are never sent to Telegram. `/profile` shows settings, `/status` shows your latest
job, and `/retry` retries the latest failed output delivery without re-encoding.

After successful Telegram delivery the worker deletes only its downloaded
original from the incoming directory. On conversion or delivery failure it keeps
the original for recovery. Finished outputs are retained. The Local Bot API's
disposable download cache copy is removed once a safe worker copy exists.
Linux paths, including `/mnt/d/...` and `/home/.../.local/...`, are translated
properly for Node on Windows, avoiding the previous `C:\mnt\...` error.

### Large files and Local Bot API

Telegram's [official Local Bot API](https://core.telegram.org/bots/api#using-a-local-bot-api-server)
allows unlimited-size downloads and uploads up to 2000 MB. The standard cloud API
is limited to 20 MB downloads and 50 MB uploads. This app also enforces the
configured `MAX_INPUT_GB` limit and checks final Telegram output size before send.

For a new machine install Ubuntu 24.04 in WSL and run
`local-bot-api/install-official-server.sh` in Ubuntu. It builds the official
binary without copying to `/usr/local/bin` (no install permission error).
Run `scripts/configure-new-bot.ps1`, then `scripts/enable-local-bot-api.ps1` to
enter application credentials and migrate only the dedicated bot to the local
API. The default scripts use Ubuntu-24.04; adjust them if you change the distro.
Keep the POSIX-only Telegram database/cache in the WSL Linux filesystem; the
worker immediately copies video to `MEDIA_ROOT` and cleans the duplicate cache.
The API HTTP server binds only to localhost. OpenClaw configuration is untouched.

## Checks and troubleshooting

`npm test` covers real 1080p/1440p/3K/4K HEVC exports, half-speed duration and
audio, batch upload/download, and simulated Telegram receive/return/cleanup,
failed delivery, bot isolation and authorization. It sends nothing to real chats.
`npm run doctor` checks the installed media tools.

Dashboard health (`/api/health`) includes Telegram connection status without
credentials. Launcher logs are `logs/luna-exporter.log` and
`logs/luna-exporter-error.log`; API logs are `local-bot-api/server.log`.
If Telegram is not ready, check the Local Bot API, credentials, matching username,
webhook status, and other machines using the same bot; then restart the converter.

## TikTok publishing (setup required)

When you select **Upload to TikTok**, after conversion the bot asks for a post
caption for `@sauds.journey`. It supports per-video settings,
native scheduling requests, browser previews and explicit publish confirmation.
Playwright uses an isolated local Edge profile. **Live posting is locked until
the exact TikTok handle, authorized Telegram user ID and actual Studio controls
are verified.** No real TikTok post has been made during development. Full Studio
feature parity is not yet verified; complex editors need separate calibration.
See [TikTok setup and limitations](docs/TIKTOK.md).

Khaled comparison versions remain on their separate branches. The code here
does not alter those branches or your OpenClaw installation.
