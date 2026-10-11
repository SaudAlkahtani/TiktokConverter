# Khaled Method — Windows Local Converter

This branch (`codex/khaled-windows-local`) adapts the encoding and MP4 patch method
from [Khxxxxd/khaled-cli-hq](https://github.com/Khxxxxd/khaled-cli-hq) to the local
browser uploader in `working-local-version`. Source is pinned to commit
`2352a75cdda48bc06d29c6c44bb41c6f0b0ef2b5`. It runs on Windows with Node and Python.
Uploads and exports remain on this machine.

## Install and run on Windows

Install Node.js 20+ and Python 3.10+ (enable Python on PATH). FFmpeg and ffprobe
are supplied by the existing npm dependencies; no Mac tools or shell installer
are needed. There are no third-party Python dependencies.

```powershell
git clone https://github.com/SaudAlkahtani/TiktokConverter.git
cd TiktokConverter
git switch codex/khaled-windows-local
npm ci
Copy-Item .env.example .env
npm run doctor
.\Start-Local-Converter.cmd
```

Open http://127.0.0.1:4173, choose a local video, select a resolution, then
**Upload & convert**. Download appears only after preparation and patch validation
succeed. Progress shows measurement, encoding, and patch/validation stages.
Jobs process one at a time in upload order.

Playback now defaults to **Half speed (2× duration)** for comparison with the
earlier timestamp-scale method. Choose **Normal speed** for Khaled's original
timing. Half speed uses input `-itsscale 2`, keeps the measured output fps by
duplicating frames, and uses `asetpts=N/SR/TB,atempo=0.5` to stretch audio while
preserving pitch. A 10-second source becomes about 20 seconds. It is not optical
flow interpolation and does not inherently improve compression quality. Use
positive `2`; negative `-2` is rejected. The patch is applied after the slow-motion
preparation and checked against that prepared video.

For an existing checkout, use `git fetch origin` and switch to this branch before
installing dependencies. Preserve your existing `.env`; there is no need to copy
over it. Set `PYTHON_PATH=C:\Python314\python.exe` if Python is not on PATH
(use your own installed executable). Set `MEDIA_ROOT=D:\Luna TikTok Exporter` to
use your larger drive. The server listens only on 127.0.0.1.
The existing startup command and desktop shortcut that launches it still work.

Old `VIDEO_BITRATE`, `VIDEO_CODEC`, `VIDEO_CRF`, `VIDEO_GOP`, and
`VIDEO_TIMESTAMP_SCALE` settings do not change this branch's fixed Khaled profile.
Playback is selected per upload in the dashboard; legacy settings do not override it.

## What the method does

1. Measure real packet timing with Khaled's checker. Preserve standard source rates
   up to 120fps; higher rates are reduced by an integer factor. Variable-rate
   footage is converted to a measured constant rate.
2. Prepare H.264 High profile, libx264 slow, CRF 17, no B-frames, two-second GOP,
   8-bit 4:2:0, Rec.709, avc1, AAC stereo 48 kHz at 192 kbps. No added sharpening.
3. Choose 1080, 1440, or 2160 as the maximum shorter edge. Lanczos downsizing only;
   smaller clips are never enlarged. Original dimensions is an additional option.
   Odd dimensions round down to even pixels for H.264.
4. Apply the vendored tiktok-quality transform with multiplier 10. It strips
   first-sample SEI, adds ghost sample table entries, rebuilds MP4 metadata/chunk
   offsets, and places moov before mdat. It does not re-encode the prepared video.
5. Validate decoded frame count, duration, audio presence/sample tables, patch
   tables, and picture match. This port additionally checks exact SHA-256 equality
   of decoded pixels between the prepared and patched files. Intermediate files
   and failed output files are removed. Original uploads stay on disk.

At up to 60fps, maximum video rates/buffers are 18/36 Mbps for 1080,
28/56 for 1440, and 45/90 for 2160. These are ceilings, not fixed targets;
CRF controls quality. Above 60fps, ceilings follow Khaled's FPS-based scaling.
Original-size mode chooses the same ceiling by shorter-edge size.

The Windows port uses the existing CPU zscale/Mobius tone mapping for PQ/HLG HDR.
Khaled's Mac script uses Apple VideoToolbox for that step. Rotation is handled by
FFmpeg's automatic display-matrix rotation rather than Mac-specific manual filters.
The encoder selects an appropriate H.264 level rather than hardcoding one for
arbitrary source aspect ratios.

## Comparison with your branches

| Behavior | working-local-version | local-upload-workflow (GPU version) | official-local-version | This Khaled Windows branch |
| --- | --- | --- | --- | --- |
| Video | HEVC, CPU slow CRF 18 | HEVC, CPU/AMD/NVIDIA presets | HEVC, 20 Mbps target default | H.264 slow CRF 17, bitrate ceilings |
| Container | Standard MP4 | Standard MP4 | Standard MP4 | 10× declared samples via ghost entries |
| Frame rate | Forced 60 | Forced 60 | Forced 60 | Measured source rate, up to 120 |
| Playback | Normal or half speed | Normal or half speed | Global itsscale, default half | Normal or half speed (default half) |
| Resolution | Original | Original | No explicit resize | Short-edge ceiling or original, no upscale |
| Sharpening | Gentle luma | Gentle luma | Stronger luma and chroma | None |
| 10-bit / HDR | 10-bit preserved, HDR tone mapped | Precision retained with CPU fallback | 8-bit; Rec.709 tags only | 8-bit, HDR tone mapped |
| Audio | AAC 256 kbps, speed matched | AAC 256 kbps, speed matched | AAC 256 kbps, no time stretching | AAC 192 kbps, normal speed |
| GPU buttons | None | AMD / NVIDIA / CPU | Configuration only | CPU only, matching upstream libx264 |
| Upload controls | One file | One file | Batch + clear queue | One file, FIFO queue |

Khaled's original app is Apple Silicon/macOS-specific and has drag/drop and Finder
actions. This port provides the Windows browser upload/download workflow.
It does not claim that Windows output is byte-identical to Apple's HDR conversion.

## Container patch limitations

The ghost entries are not real motion frames. A 60fps video still has 60 real
frames per second. Some metadata tools and players show misleading frame counts,
bitrates or rates, and decoders can log warnings for the ghost entries.
Use the dashboard's **real fps** and validated preparation metadata for comparison.
Do not remux the patched file afterward: that can remove the patch.

The upstream method aims to affect TikTok's upload processing; local validation
cannot prove TikTok will serve original quality. Try an upload from TikTok Studio
in a desktop browser and compare the published result. TikTok can change its
processing at any time.

The patcher reads the prepared MP4 into memory and uses 32-bit MP4 offsets.
This port limits prepared files to 1 GB so long/high-bitrate jobs fail clearly
before patching. Input upload limits are separate; split large exports into
shorter clips and allow memory headroom.

## Verification and attribution

Run `npm test`. Tests exercise actual FFmpeg/Python exports at multiple
resolutions, 24/30/60/120fps, portrait rotation, odd dimensions, HDR, audio,
10× sample tables, decoded pixel equality, and upload-to-download validation.
No TikTok quality guarantee follows from these local checks.

The original MIT notices are preserved in `vendor/khaled/LICENSE` and
`vendor/khaled/tiktok_quality/LICENSE`. The transform, MP4 parser/builder and
frame-rate/checker code are vendored from the pinned source.
Local modifications: optional timestamp-scaled half speed and matching audio; explicit FFmpeg executable paths in the checker; Windows
hidden subprocess handling in the bridge; CPU HDR conversion and additional
validation/size limits in the integration. Mac installers and Swift app are not run.
