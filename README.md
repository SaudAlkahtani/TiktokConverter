# Gym Video Editor + Combined Converter

TikTok, Instagram, Both, and the editor's
final downloads are 1080 × 1920 H.264 MP4 files. TikTok uses
60 fps at 25 Mb/s with `-itsscale 2` for a 60 fps source, slowing video and
audio to a 2× timeline. Lower source frame rates use 30 fps at 15 Mb/s and
normal speed. Instagram always uses 30 fps at 15 Mb/s and normal speed,
including for 3K 60 fps sources. These rates are encoder targets and ceilings;
the measured average may be lower for simple footage. The full source frame is
fitted with padding when its aspect ratio is not 9:16. AAC audio is 256 kb/s,
48 kHz, stereo. TikTok and Instagram have their own tabs, and Both makes the two versions from
one upload. The four maintained branches use this conversion profile.

This Windows app edits local gym clips and exports them through one shared
combined-converter workflow. It does not use Telegram, OpenClaw, or a cloud
video service. The local dashboard is available only on `127.0.0.1`.

Editing in DaVinci Resolve Free instead? See the
[Resolve setup and drag-and-drop handoff](docs/DAVINCI_RESOLVE.md).

## Install on a Windows machine

1. Install Git, Node.js 20 or newer, and Python 3 if you want automatic face
   detection. Make sure `git`, `node`, `npm`, and optionally `python` work in
   PowerShell. Install a current NVIDIA or AMD driver if using GPU encoding.
2. Clone the combined converter branch of the private repository and install its Node
   dependencies:

   ```powershell
   git clone --branch release/combined-converter --single-branch https://github.com/SaudAlkahtani/TiktokConverter.git
   Set-Location TiktokConverter
   npm ci
   ```

   If the repository is already cloned, run `git fetch origin`, then
   `git switch release/combined-converter` if the branch exists locally, or
   `git switch --track origin/release/combined-converter` if it does not. Run
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
   [http://127.0.0.1:4173/both](http://127.0.0.1:4173/both) for two exports,
   or `/tiktok`, `/instagram`, or `/editor` for those workflows. Keep the
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
many times. Click the ruler or scrub bar to place the playhead, press **Shift+R** or
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
both rows. Drag any imported video from the bin onto V1 to insert picture and
its camera sound, or onto A2 to use its sound alone. **Add audio at playhead**
also puts the selected source range on A2. Select an A2 clip to trim its own
In/Out points, move it on the timeline, set its volume, split it with
**Shift+R**, or delete it without changing the video. **Shift+D** detaches a
V1/A1 clip's camera audio into A2 as a full independent clip; you can then
split or remove the video while keeping the audio. Audio that continues past
the last visible video keeps a black picture for that remaining time. A3 holds
the optional voice recording, and V2 shows picture in picture. The separate
voice monitor lets you listen to a recording, mark its source In/Out points,
adjust its volume, and choose where it starts in the timeline.
The project monitor jumps between source videos during sequence playback. Blur, voice
start and overlay times use the **merged sequence clock**. Review the finished
video for missed faces and correct audio timing before sharing.

### Remotion titles and edit plans

The **Motion titles** panel adds animated text at exact points on the merged
timeline. Set its text, start/end times, position, and color. The project
monitor previews the title placement. When titles are present, the editor
renders them with [Remotion](https://www.remotion.dev/docs) onto the edited
master before sending that master through the existing TikTok and Instagram
converters. Blur, voice, picture in picture, and cuts keep their existing
editor controls. Rendering titles requires a local Chromium-based browser;
the app checks Chrome, Edge, then Brave on Windows. Set
`REMOTION_BROWSER_PATH` if the browser is installed elsewhere. Untitled edits
continue through the usual FFmpeg path.

For repeatable edits, click **Generate JSON** in the **Edit plan JSON** panel.
You can change clip ranges, independent `audioClips`, audio levels, blur rectangles, and motion titles in
the JSON, then click **Apply JSON**. Import the source videos named in the plan
in the same order first. **Download plan** saves the JSON file. The browser
cannot restore local file selections from JSON, so voice and picture in
picture files must also be selected again.

For a scripted batch render, save the plan beside its source videos (or use
paths relative to the plan), then run:

```powershell
npm ci
npm run editor:plan -- .\gym-edit-plan.json
```

See [the example plan](examples/gym-edit-plan.json) and the
[separate audio example](examples/separate-audio-plan.json) for the schema.
Each `audioClips` entry uses a source index, source In/Out seconds, a timeline
start, and a 0–2 volume multiplier. The CLI
creates a master, TikTok MP4, Instagram MP4, and an outputs JSON in the plan's
`outputDir` or the configured output folder. It uses the same edit validation,
Remotion titles, and final conversion profiles as the browser editor. Keep the
source files and output directory on a drive with enough free space for 4K
intermediates. `npm ci` installs the pinned Remotion packages; the first title
render also bundles the composition locally.

The editor first makes a downloadable 60 fps master. Its canvas uses the first
timeline clip's dimensions; other sources are aspect-preserved and padded to
fit. The editor assembles longer timelines in small FFmpeg batches, joins them
into one high-bitrate temporary sequence, and removes the intermediate files
after processing. The merged master then passes through the **same combined
converter used by `/both`**, which
creates two separately downloadable MP4 files:

| Export | Video | Timing | Audio |
| --- | --- | --- | --- |
| TikTok | H.264 High, 1080 × 1920 square-pixel frame, 60 fps at 25 Mb/s or 30 fps at 15 Mb/s, Rec.709, `avc1` | 60 fps: 2× input timeline; 30 fps: normal duration | AAC stereo 256 kb/s / 48 kHz on the same timeline |
| Instagram | H.264 High, 1080 × 1920, always 30 fps at 15 Mb/s, Rec.709, `avc1` | Normal duration, including 60 fps sources | AAC stereo 256 kb/s / 48 kHz at original timing |

Both outputs preserve the full picture with aspect-aware padding rather than
cropping. The GOP is two seconds at the chosen output rate. HDR PQ/HLG and
tagged BT.2020 SDR sources are converted to Rec.709 in the final exports.
For a 60 fps source, TikTok's input timestamp scale affects both video and
audio; its finished file lasts about twice as long. Instagram keeps the source
duration while converting to 30 fps.
The final H.264 conversion uses CPU libx264; the editor's GPU choice applies
to its working master. Legacy `VIDEO_*` values from other branches are ignored
in the maintained branches.

Color safety: TikTok, Instagram, and editor exports check source color tags
before rendering and validate Rec.709 tags afterward. The final converters
transform supported BT.2020 sources; other unsupported profiles need a
correctly graded Rec.709 master first. The editor master retains its separate
color policy. Untagged inputs are treated as Rec.709 SDR. See [the Resolve guide](docs/DAVINCI_RESOLVE.md)
for the workflow and limits of these checks.

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
