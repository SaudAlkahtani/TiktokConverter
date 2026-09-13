# Local Video Converter

This runs entirely on your Windows machine. Upload a video from the local
dashboard, queue a local FFmpeg export, and download the finished MP4 directly
to this machine. It has no Telegram bot integration and does not contact or
modify any other installation.

## What the export does

The converter preserves the video's displayed width and height: a 1728×3072
master stays 1728×3072, and a 3840×2160 clip stays 3840×2160. Portrait rotation
metadata is baked into the pixels so the output stays correctly oriented.
There is no forced 1080p resize, crop, stretch, or upscaling.

- HEVC/H.265 (`libx265`), slow preset, CRF 18 for high-quality variable bitrate.
  Detailed 3K/4K footage can use more bits instead of sharing a fixed 10 Mbps cap.
- Constant 60fps, 60-frame maximum GOP, `hvc1`, fast-start MP4, no timecode track.
- Optional gentle luma sharpening (`unsharp=3:3:0.3:3:3:0`) adds detail without
  sharpening color noise. Turn it off for already-sharpened camera footage.
- PQ/HLG HDR is tone-mapped to SDR Rec.709; tagged SDR is converted to Rec.709.
  Untagged footage is assumed SDR Rec.709. Camera log footage needs its correct
  LUT applied in your editor first. Review HDR highlights after conversion.
- 10-bit sources retain 10-bit output precision; standard even-sized sources
  use 4:2:0. Odd sizes use 4:4:4 to preserve every pixel, with a compatibility
  notice because some upload services/players do not support HEVC 4:4:4.
- AAC stereo, 48 kHz, 256 kbps target when source audio exists.

Choose normal or half speed for each upload. Half speed uses `-itsscale 2`
with matching audio time stretching (`atempo=0.5`). It duplicates frames to
60fps rather than generating new motion. The previous half-speed default
remains; set `VIDEO_TIMESTAMP_SCALE=1` for a normal-speed default.

Quality mode deliberately replaces the legacy VIDEO_BITRATE, VIDEO_CODEC and
VIDEO_SHARPEN overrides. Set `VIDEO_CRF` (12–28; default 18) to trade file size
against quality. This profile uses software libx265 to keep behavior consistent.
High-resolution slow-preset encoding can take longer and produce larger files.

## Source files accepted

The local uploader accepts 1080p60, 2K, 3K, and 4K source video, plus any
containers/codecs that the bundled FFmpeg can decode and the HEVC encoder can
encode. There is no 1080p/2K/3K/4K whitelist. Practical limits are available RAM,
disk space, codec constraints (including a 16-pixel minimum), and the configured
upload limit. The file chooser permits unfamiliar extensions; the server validates
the actual video stream. Every completed export is probed to confirm the source
dimensions and 60fps, and its real output metadata is displayed on the dashboard.

It is a transparent, high-quality profile inspired by the goal of a “60fps
mode”; it does not copy or claim to be Decoy’s proprietary preset. TikTok can
still transcode every upload, so a perfect byte-for-byte preservation guarantee
is not possible.

## Install

1. Install Node.js 20 or newer and run `npm ci`. FFmpeg/ffprobe are bundled;
   leave their `.env` path overrides blank to use those binaries.
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
git switch local-upload-workflow
npm ci
Copy-Item .env.example .env
```

Set `MEDIA_ROOT` in `.env` to keep incoming and exported media on another
drive. The server binds to `127.0.0.1`, so it is accessible only from this
machine. Files stay in `incoming/` and `output/` until you delete them.

## Verification

Run `npm test` to encode synthetic 1080p, 2K, 3K, 4K, landscape, odd-sized,
rotated portrait, 10-bit PQ/HLG and audio clips. Tests verify dimensions, codec,
frame rate, color tags and normal/half-speed audio duration, and clean up fixtures.
These are technical checks, not a guarantee of TikTok's final compression quality.
TikTok controls its own transcoding; this tool cannot guarantee Decoy-equivalent
results or retain 60fps on every platform playback variant.
