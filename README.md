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
- HEVC/H.265 at 10 Mbps with a 60-frame GOP, Rec.709 metadata, 4:2:0 pixels,
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

Open `/both` to upload each source once and queue two independent exports. TikTok explicitly uses timestamp scale 2 (HEVC, 60 fps, existing configurable bitrate), with the original TikTok audio handling (AAC stereo, 256 kbps; no added tempo filter). Instagram keeps normal speed and the existing 1080x1920 H.264 / 30 fps / AAC profile. Each export has its own progress, failure status and download; a failed export does not prevent its partner from running. The Both tab's clear buttons operate only on exports submitted through that tab. Platform tabs also show their respective outputs from combined uploads.

Run `node --test test/*.test.js` for conversion and navigation checks.

## Gym video editor branch

Branch: `codex/gym-video-editor`. Start the local server and open
`http://127.0.0.1:4173/editor`. The editor accepts a 4K source, creates an
original-dimension, 60 fps edited master, then queues the existing TikTok,
Instagram, or dual-platform converter profiles. Download the edited master or
either platform export from its own queue card. Existing converter pages still
accept simple uploads without going through the editor.

1. Choose the original clip. Preview, pause, and drag a **blur area** over a
   background face or a place where someone may appear. Set start and end times
   for that rectangle, or leave the end blank to cover the whole clip. Use
   multiple rectangles for moving people or different parts of the scene.
2. **Detect and blur faces automatically** is enabled by default. Draw a
   **Keep clear** rectangle around your own face to exclude it from detection.
   The detector is OpenCV's bundled frontal-face cascade. It may miss small,
   turned, occluded or fast-moving faces. Inspect the complete finished video
   before sharing it, and add manual blur areas wherever needed. Manual blur
   works even without Python.
3. Optionally choose a voice recording and lower the **Original sound** slider.
   Voice starts at the chosen second; picture in picture can be placed in any
   corner with its own size and time range. Picture in picture audio is muted.
4. Choose one platform or both, select **Auto**, **CPU**, **NVIDIA NVENC**, or
   **AMD AMF**, and start the edit. Auto checks whether a real encode works on
   this machine, prefers NVIDIA then AMD, and uses CPU when neither works.
   The mask, blur, audio and overlay filters still run on the CPU; hardware
   selection accelerates video encoding only. NVIDIA RTX 4070 Ti and 5070 or
   AMD Radeon RX 9060 XT use their respective encoders when their driver and
   FFmpeg build support them. The editor lists available choices locally.

For automatic face detection on each machine, install Python 3 and run:

```powershell
python -m pip install -r requirements-editor.txt
```

If `python` is not on PATH, set `EDITOR_PYTHON` in `.env` to its full executable
path. The existing `ffmpeg-static` build is used by default; you can set
`FFMPEG_PATH` and `FFPROBE_PATH` in `.env` to matching builds with working NVIDIA
or AMD encoders. The server stays bound to localhost. `MEDIA_ROOT` controls
where uploaded sources, voice, picture in picture assets and exports are saved;
set it to a drive with room for the 4K original plus the edited master and
platform exports. Files remain there until you remove them deliberately.

The TikTok converter now stretches audio with the default 2× timestamp scale,
so added speech stays synchronized and keeps its pitch. Instagram remains normal
speed. The mask composition uses FFmpeg's
[masked video filters](https://ffmpeg.org/ffmpeg-filters.html) and OpenCV's
[cascade face detector](https://docs.opencv.org/4.x/db/d28/tutorial_cascade_classifier.html).
