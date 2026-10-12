# Local Video Converter

This runs entirely on your Windows machine. Upload a video from the local
dashboard, queue a local FFmpeg export, and download the finished MP4 directly
to this machine. It has no Telegram bot integration and does not contact or
modify any other installation.

## What the export does

The profile now matches the supplied FFmpeg reference:

- `-itsscale 2`, making half-speed output; set `VIDEO_TIMESTAMP_SCALE=1` for
  normal-speed delivery
- `fps=60,unsharp=3:3:0.4:3:3:0.4`; no resizing or cropping is applied
- HEVC/H.265 with resolution-based target/max bitrate: 18 Mbps up to 1080p,
  28 Mbps up to 1440p, and 45 Mbps above 1440p (using the shorter edge).
  The buffer is twice that rate. Legacy `VIDEO_BITRATE` overrides are ignored.
  This copies only Khaled's rate limits; audio and timestamp handling are
  unchanged from `27f2768`. A 60-frame GOP, Rec.709 metadata, 4:2:0 pixels,
  `hvc1` tagging, fast-start metadata, and no embedded timecode track
- AAC stereo audio at 256 kbps

The exact `hevc_videotoolbox` encoder in the reference is macOS-only. This
Windows installation uses FFmpeg's `libx265` encoder to create the equivalent
HEVC/H.265 `hvc1` output. You can set `VIDEO_CODEC` in `.env` to an available
Windows hardware encoder such as `hevc_nvenc`, `hevc_amf`, or `hevc_qsv`.

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
