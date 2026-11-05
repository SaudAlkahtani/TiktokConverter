# Local Video Converter

This runs entirely on your Windows machine. Upload a video from the local
dashboard, queue a local FFmpeg export, and download the finished MP4 directly
to this machine. It has no Telegram bot integration and does not contact or
modify any other installation.

## What the export does

TikTok exports use the standard vertical profile: 1080×1920 H.264 MP4, AAC 256 kb/s stereo, square pixels, and verified Rec.709 tags. Sources at 45 fps or higher become 60 fps at a 25 Mb/s target and play on a 2× timeline with matching audio. Lower frame rates become 30 fps at 15 Mb/s and keep normal timing. The picture is fit inside the frame with padding when needed.

## Source files accepted

The local uploader accepts 1080p60, 2K, 3K, and 4K source video, plus any
container/codecs that the bundled FFmpeg can decode. It validates the actual
video stream after upload instead of relying solely on a filename extension.

It is a transparent, high-quality profile inspired by the goal of a “60fps
mode”; it does not copy or claim to be Decoy’s proprietary preset. TikTok can
still transcode every upload, so a perfect byte-for-byte preservation guarantee
is not possible.

## Install

1. This machine uses a portable Node.js runtime in `tools\node` (kept out of
   Git). On another machine, install a current Node.js LTS and run `npm ci`.
2. Copy `.env.example` to `.env` only if you want to customize the port,
   FFmpeg paths, media location, or upload limit. Keep TikTok video settings intact.
3. Double-click `Start-Local-Converter.cmd`, then open `http://127.0.0.1:4173`.
4. Choose a video, click **Upload & convert**, and use **Download export** when
   the job completes.

## Move to another Windows machine

Clone the private repository, install dependencies, then configure the secret
files locally (they are intentionally never stored in GitHub):

```powershell
git clone https://github.com/SaudAlkahtani/TiktokConverter.git
cd TiktokConverter
npm ci
Copy-Item .env.example .env
```

Set `MEDIA_ROOT` in `.env` to keep incoming and exported media on another
drive. The server binds to `127.0.0.1`, so it is accessible only from this
machine. Files stay in `incoming/` and `output/` until you delete them.
