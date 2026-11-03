# DaVinci Resolve Free → local converter

This is the Windows workflow for the free edition of DaVinci Resolve. Edit in
Resolve, keep a high-quality normal-speed master, then let this project create
the final TikTok and Instagram files. The original footage and Resolve master
are not deleted by the handoff script.

## Install and prepare

1. Download **DaVinci Resolve (free, Windows)** from Blackmagic Design's
   [official support page](https://www.blackmagicdesign.com/support/family/davinci-resolve-and-fusion).
   Resolve was not found on this PC when this guide was written. Use the free
   download, not Studio, unless you already have a Studio license.
2. Keep camera originals, Resolve project backups, cache, and rendered masters
   on your larger D: drive. A useful folder layout is:

   ```text
   D:\Gym Videos\Originals
   D:\Gym Videos\Resolve Projects
   D:\Gym Videos\Cache
   D:\Gym Videos\Masters
   ```

   Configure Resolve's media storage/cache location under **Preferences →
   System → Media Storage**. Back up projects with Resolve's project-export
   feature; a cache folder is not a project backup.
3. Before importing clips, create a timeline that matches the intended portrait
   master. For your 3K portrait material, start with **1728 × 3072, 60 fps** if
   that is the source's actual size and cadence. For a different source, match
   its width, height, and frame rate. Set timeline frame rate before editing;
   changing it later can require a new timeline.
4. Keep the timeline and exported master at normal speed. Add your cuts,
   voiceover, audio ducking, picture-in-picture, and face blurs in Resolve.
   Inspect the finished timeline for missed background faces before delivery.
5. For SDR footage, use a Rec.709 output grade. If a clip is HDR or log, set
   its actual input color space/transfer in Resolve before grading. Do not
   assume all Insta360 clips use the same color profile.

The converter checks color tags before each TikTok, Instagram, and editor
render. On this experimental branch, TikTok and Instagram transform correctly
tagged BT.2020 SDR and PQ/HLG sources to Rec.709. The editor's working master
retains its own color policy. Unsupported log or inconsistent profiles are
rejected rather than simply relabeled Rec.709. Tone mapping changes overall
tone and gamut, so review the result. Untagged files are assumed SDR
Rec.709 because their original color space cannot be determined from metadata.
After rendering, each output must carry consistent Rec.709 tags. These checks
catch unsafe color labeling; they cannot prove that an unknown camera profile
or an intentional grade has the same visual white balance.

For the gym edit, place exercise clips on V1 and their camera audio on A1.
Put voiceover on a separate audio track so you can lower camera sound without
affecting speech. Put picture-in-picture on V2 and adjust its size/position in
the Inspector. In the free edition, blur background faces with a tracked Color
page Power Window or manual keyframes; inspect the track at the start, middle,
and end of every affected shot. Do not depend on Studio-only Magic Mask.

## Export a master for the converter

On the Deliver page, choose a custom export to `D:\Gym Videos\Masters`:

- **Resolution and frame rate:** match the timeline, e.g. 1728 × 3072 at 60 fps.
- **High-quality master:** QuickTime MOV with DNxHR HQX (10-bit) if available;
  use DNxHR HQ if HQX is unavailable. These files can be large, so check D:
  free space before rendering.
- **Audio:** uncompressed PCM, 48 kHz, stereo if that option is available.
- **Range:** entire timeline; ensure the rendered video and audio end together.

The master is not the TikTok upload. It preserves the edit before the local
converter applies its shared vertical 1080p method. If Resolve offers different codec
choices on your installation, use a high-quality intraframe master that FFmpeg
can read, and check the result with `ffprobe` or the converter's upload probe.
Keep this master at normal speed. Both final outputs are 1080 × 1920 at normal
timing. A 60 fps master produces 60 fps outputs at a 25 Mb/s target; a 30 fps
master produces 30 fps outputs at a 15 Mb/s target.

## One-step handoff

1. Start `Start-Local-Converter.cmd` in this project and leave it running.
2. Drag the rendered master onto `Send-Resolve-Master.cmd`. It queues **both**
   TikTok and Instagram exports and opens the progress page. The script uploads
   the master to the loopback server; it does not post to either social network.
3. Alternatively, run one platform explicitly:

   ```powershell
   .\scripts\send-resolve-master.ps1 -VideoPath 'D:\Gym Videos\Masters\Workout.mov' -Platform tiktok -OpenDashboard
   ```

   Use `-CheckOnly` to verify the file and server without uploading. The
   converter retains its own incoming copy and exported files; manage those
   in D: when you need space. Do not delete the Resolve project or master
   until you have reviewed the final exports.

## MCP and scripting in the free edition

Blackmagic's official AI-assistant/MCP connection is a **Resolve Studio 21.1**
feature, not a connection available in the free edition. Its setup route is
**File → Setup AI Assistants** in Studio. Third-party bridges for free Resolve
exist, but their Windows/21.1 support is experimental and their automation
permissions are broad. This workflow intentionally does not install one.

If you later switch to Studio, use Blackmagic's native connection first, test
it on a duplicate project with a read-only question, and keep external
scripting restricted to **Local** rather than Network unless you explicitly
need remote control. See Blackmagic's
[Resolve 21.1 announcement](https://www.blackmagicdesign.com/media/release/20260908-03)
and [support downloads](https://www.blackmagicdesign.com/support/family/davinci-resolve-and-fusion).
