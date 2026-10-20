# Gym Video Editor + Combined Converter

This Windows app edits local gym clips and exports them through one shared
combined-converter workflow. It does not use Telegram, OpenClaw, or a cloud
video service. The local dashboard is available only on `127.0.0.1`.

## Install on a Windows machine

1. Install Git, Node.js 20 or newer, and Python 3 if you want automatic face
   detection. Make sure `git`, `node`, `npm`, and optionally `python` work in
   PowerShell. Install a current NVIDIA or AMD driver if using GPU encoding.
2. Clone **this branch** of the private repository and install its locked Node
   dependencies:

   ```powershell
   git clone --branch codex/gym-video-editor --single-branch https://github.com/SaudAlkahtani/TiktokConverter.git
   Set-Location TiktokConverter
   npm ci
   ```

   If the repository is already cloned, run `git fetch origin`, then
   `git switch codex/gym-video-editor` if the branch exists locally, or
   `git switch --track origin/codex/gym-video-editor` if it does not. Run
   `git pull --ff-only` and `npm ci` after switching.
3. Create the machine-local configuration file:

   ```powershell
   Copy-Item .env.example .env
   ```

   Edit `.env` if you want `MEDIA_ROOT` on a larger drive, for example
   `MEDIA_ROOT=D:\GymVideoConverter`. Ensure that drive exists and has space
   for the original, edited master, and both exports. The default media
   location is the project folder. `.env` and video files are not committed.
4. For automatic face detection, install its Python dependencies:

   ```powershell
   python -m pip install -r requirements-editor.txt
   ```

   If Python is not on `PATH`, set `EDITOR_PYTHON` in `.env` to its executable.
   Manual blur rectangles work without Python.
5. Start the server with `npm start` or double-click
   `Start-Local-Converter.cmd`. Open
   [http://127.0.0.1:4173/editor](http://127.0.0.1:4173/editor). Keep the
   command window open while processing. Run `npm run doctor` to check local
   FFmpeg and encoder capabilities. The project includes bundled FFmpeg and
   FFprobe; for a different build, set `FFMPEG_PATH` and `FFPROBE_PATH` in
   `.env` to matching executables. Available GPU encoders depend on the
   machine, its drivers, and its FFmpeg build; Auto falls back to CPU.

## Edit and export

Choose a source video, including 4K clips. Draw timed blur regions over
background faces, or enable automatic face detection and mark **Keep clear**
over your own face. Check every finished frame: automatic detection can miss
small, turned, or moving faces. Optionally add voice audio, lower the original
sound, and add a timed picture-in-picture clip (its sound is muted). Select
Auto, CPU, NVIDIA NVENC, or AMD AMF, then start the edit.

The editor first makes a downloadable, source-dimension 60 fps master. It then
passes that master to the **same combined converter used by `/both`**, which
creates two separately downloadable MP4 files:

| Export | Video | Timing | Audio |
| --- | --- | --- | --- |
| TikTok | HEVC/H.265, source dimensions, constant 60 fps, 20 Mbps target by default, Rec.709, `hvc1` | `-itsscale 2` (twice the source duration) | AAC stereo 256 kbps; audio slowed to match while preserving pitch |
| Instagram | H.264 High, 1080 × 1920 square-pixel frame, constant 30 fps, CRF 18 with a 12 Mbps ceiling | Normal duration | AAC stereo 128 kbps / 48 kHz |

Instagram preserves the full picture with aspect-aware padding rather than
cropping. Its 2-second GOP uses 60 frames at 30 fps. HDR PQ/HLG sources are
tone-mapped to SDR. TikTok sharpens moderately by default and does not resize;
change `VIDEO_SHARPEN` or `VIDEO_BITRATE` in `.env` if needed. The standalone
`/instagram` page uses the same 30 fps Instagram profile. The standalone
`/tiktok` page uses `VIDEO_TIMESTAMP_SCALE` (default 2); the combined workflow
always specifies scale 2 explicitly.

Both exports are local preparation files. TikTok and Instagram can recompress
uploads, so no encoder can guarantee identical quality after publishing. Meta's
[Reels publishing sample](https://github.com/fbsamples/reels_publishing_apis/blob/main/insta_reels_publishing_api_sample/README.md#reels-requirements-for-publishing)
lists 23–60 fps, H.264/HEVC, AAC, and a 9:16 recommendation. The app does not
enforce platform publishing duration or file-size limits.

Open `/both` to run the combined converter on an unedited source. `/tiktok`
and `/instagram` are also available for individual conversions. All routes
share one FIFO processing worker. Inputs and outputs remain on disk until you
remove them; clearing queue cards does not delete the files. No upload is sent
to a social network.

## Verify changes

```powershell
node --test test/*.test.js
```
