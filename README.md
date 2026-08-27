# Local Video Converter

This runs entirely on your Windows machine. Upload a video from the local
dashboard, queue a local FFmpeg export, and download the finished MP4 directly
to this machine. It has no Telegram bot integration and does not contact or
modify any other installation.

## What the export does

The `TikTok 1080p60` profile makes an MP4 with:

- 1080 × 1920 vertical canvas, preserving the whole image with black padding if
  a clip is not vertical
- constant 60 fps (30 fps sources are duplicated, not AI-interpolated)
- H.264/AVC High profile, 4:2:0, `avc1`, 1-second keyframes
- H.264 constrained VBR: 10 Mbps target / 12 Mbps maximum / 24 Mbps buffer
- AAC stereo audio at 256 kbps and fast-start metadata
- moderate luma/chroma sharpening (`unsharp=3:3:0.4:3:3:0.4`), Rec.709 tags,
  1-second keyframes, and no embedded timecode track

`VIDEO_TIMESTAMP_SCALE=2` is enabled in this installation as a half-speed test
mode matching the reference command's `-itsscale 2`. Set it back to `1` in
`.env` for normal-speed delivery. It keeps the output at 60fps by duplicating
frames; it does not generate new interpolated motion. The exporter keeps H.264
rather than macOS-only `hevc_videotoolbox`, matching the requested
TikTok-compatible delivery format.

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
