# Local Video Converter

This runs entirely on your Windows machine. Upload a video from the local
dashboard, queue a local FFmpeg export, and download the finished MP4 directly
to this machine. It has no Telegram bot integration and does not contact or
modify any other installation.

## What the export does

The TikTok profile is locked to the FFmpeg method at commit `6378e68`:

- `-itsscale 2` on the one source input, scaling video and audio timestamps
- `fps=60,unsharp=3:3:0.4:3:3:0.4`; no resizing or cropping is applied
- HEVC/H.265 at a 20 Mbps target with a 60-frame GOP, Rec.709 metadata, 4:2:0 pixels,
  `hvc1` tagging, fast-start metadata, and no embedded timecode track
- AAC stereo audio at 256 kbps

TikTok always uses `libx265` and the exact one-input argument sequence from
that commit. Conflicting `VIDEO_CODEC`, `VIDEO_BITRATE`, `VIDEO_GOP`,
`VIDEO_SHARPEN`, or `VIDEO_TIMESTAMP_SCALE` values in `.env` stop the app.
Instagram keeps its distinct 1080x1920 H.264 / 30 fps method.

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
   FFmpeg paths, output quality, or upload limit.
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

## Instagram converter

Branch: `combined-tiktok-insta-converters`. Both converter pages use the same shared dark theme with gradient accents. Start the server with `Start-Local-Converter.cmd` or `npm start`.
- TikTok: http://127.0.0.1:4173/tiktok (also the home page).
- Instagram: http://127.0.0.1:4173/instagram.

Both pages have platform buttons. Jobs share one FIFO worker, with separate page views and platform-scoped clear buttons. Existing API clients default to TikTok; send `POST /api/uploads?platform=instagram` for Reels.

Instagram uses normal playback, 1080x1920 with aspect-preserving padding, constant 30 fps, H.264 High / yuv420p, CRF 18 with a 12 Mbps ceiling, closed 2-second GOP, AAC 128 kbps / 48 kHz stereo when audio exists, fast-start MP4 without edit lists. HDR PQ/HLG sources are tone mapped to SDR. No sharpening or container patch is applied. Smaller sources are enlarged to the target canvas. Enable Instagram's highest-quality upload setting; Instagram will recompress the result.

These are practical export defaults, not a guarantee of upload quality. Meta's sample specifies H.264/HEVC, 23–60 fps, VBR up to 25 Mbps, AAC, and recommends 9:16:
https://github.com/fbsamples/reels_publishing_apis/blob/main/insta_reels_publishing_api_sample/README.md#reels-requirements-for-publishing
The converter does not trim clips or enforce Instagram publishing duration/file-size limits.

## Both platforms tab

Open `/both` to upload each source once and queue two independent exports. TikTok uses the locked HEVC 60 fps / 20 Mbps method with timestamp scale 2 on the entire input, including audio. Instagram keeps normal speed and the existing 1080x1920 H.264 / 30 fps / AAC profile. Each export has its own progress, failure status and download; a failed export does not prevent its partner from running. The Both tab's clear buttons operate only on exports submitted through that tab. Platform tabs also show their respective outputs from combined uploads.

Run `node --test test/*.test.js` for conversion and navigation checks.
