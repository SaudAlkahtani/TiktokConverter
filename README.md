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
   git clone --branch codex/editor-kdenlive-workflow --single-branch https://github.com/SaudAlkahtani/TiktokConverter.git
   Set-Location TiktokConverter
   npm ci
   ```

   If the repository is already cloned, run `git fetch origin`, then
   `git switch codex/editor-kdenlive-workflow` if the branch exists locally, or
   `git switch --track origin/codex/editor-kdenlive-workflow` if it does not. Run
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

Import any number of source videos, including 4K clips, subject to your machine's
available storage and processing capacity. Draw timed blur regions over
background faces, or enable automatic face detection and mark **Keep clear**
over your own face. Check every finished frame: automatic detection can miss
small, turned, or moving faces. Optionally add voice audio, lower the original
sound, and add a timed picture-in-picture clip (its sound is muted). Select
Auto, CPU, NVIDIA NVENC, or AMD AMF, then start the edit.

The project bin accepts multiple videos in one selection or in later batches.
The editor has separate source and project monitors: preview a selected source,
use **Mark In**/**Mark Out**, then add it to the project timeline. The project
monitor previews the assembled sequence.
Click **Add all full videos** to join them in import order, or choose any video's
**In** and **Out** seconds and click **Add range**. You can add the same source
many times. Click the ruler or scrub bar to place the playhead, press **S** or
**Split at playhead** to cut a clip, select a clip to set exact In/Out trim points,
then remove it, drag it to a new position, or use Move left/right. To remove a
middle section, split at both ends and remove the middle clip. **Clear timeline**
empties the sequence but keeps imported sources. The zoom slider and horizontal
scroll let you navigate longer timelines without squeezing every clip into view.
These operations do not alter the original files. The V1 track shows the merged
video; A1 sits directly beneath it with its aligned camera audio. Select either
row. **Shift+G** unlinks the pair; **Delete** then removes only the selected
video or audio row while preserving the other and its position. **Shift+L**
relinks an intact pair, and **Restore selected track** brings a removed row back
from the source. **Shift+R** splits at the playhead. **Revert** or **Ctrl+Z**
undoes the last timeline edit; **Ctrl+Shift+Z** redoes it. Linked deletion removes
both rows. A2 and V2 show optional voice and picture in picture. The separate
voice monitor lets you listen to a recording, mark its source In/Out points,
adjust its volume, and choose where it starts in the timeline.
The project monitor jumps between source videos during sequence playback. Blur, voice
start and overlay times use the **merged sequence clock**. Review the finished
video for missed faces and correct audio timing before sharing.

The editor first makes a downloadable 60 fps master. Its canvas uses the first
timeline clip's dimensions; other sources are aspect-preserved and padded to
fit. The editor assembles longer timelines in small FFmpeg batches, joins them
into one high-bitrate temporary sequence, and removes the intermediate files
after processing. The merged master then passes through the **same combined
converter used by `/both`**, which
creates two separately downloadable MP4 files:

| Export | Video | Timing | Audio |
| --- | --- | --- | --- |
| TikTok | HEVC/H.265, master dimensions, constant 60 fps, locked 20 Mbps target, Rec.709, `hvc1` | `-itsscale 2` on the input (twice the merged duration) | AAC stereo 256 kbps on the same scaled timeline |
| Instagram | H.264 High, 1080 × 1920 square-pixel frame, constant 30 fps, CRF 18 with a 12 Mbps ceiling | Normal duration | AAC stereo 128 kbps / 48 kHz |

Standalone TikTok, Both, and the editor's TikTok export all use the exact
conversion arguments from commit `6378e68`: one input with timestamp scale 2
applied before mapping video and audio. The edited master keeps normal-speed
timeline audio before that final TikTok export. Standalone Instagram, Both,
and the editor's Instagram export retain their distinct 30 fps preset and
normal timing. The editor's encoder choice applies to the master and Instagram,
not the locked CPU/libx265 TikTok export.

Instagram preserves the full picture with aspect-aware padding rather than
cropping. Its 2-second GOP uses 60 frames at 30 fps. HDR PQ/HLG sources are
tone-mapped to SDR. TikTok uses the locked unsharp filter and does not resize.
`VIDEO_CODEC`, `VIDEO_BITRATE`, `VIDEO_GOP`, `VIDEO_SHARPEN`, and
`VIDEO_TIMESTAMP_SCALE` may be omitted or set to the reference values in
`.env`; conflicting values stop the app rather than silently change the method.
The standalone `/instagram` page uses the same 30 fps Instagram profile.

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
