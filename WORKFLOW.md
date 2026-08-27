# Insta360 Luna to TikTok workflow

This repository is the **local export worker**.  It is intentionally not a
cloud video service: camera originals, proxy media, and completed videos stay
on the Windows PC.  GitHub stores only the worker, scripts, and documentation.

## Use this setup

1. Copy the camera card to an external SSD or a large local drive.  Keep the
   original camera files unchanged.
2. If the original is an Insta360 camera file, use Insta360 Studio to reframe
   it and export an edit master.  Do not use its social-media export for the
   master.
3. Create a job folder.  This keeps originals, editor projects, review files,
   and final deliveries apart:

   ```powershell
   .\scripts\New-LunaProject.ps1 -ProjectName "RPE8 week 2 Thursday"
   ```

4. Edit the footage in **Kdenlive** (recommended free/open-source choice), or
   DaVinci Resolve.  For 4K60, turn on proxies before editing.  Keep the
   Kdenlive/Resolve project in `03-Edit-project` and export a high-quality
   master into `04-Edit-master`.
5. Redact faces before making the master.  In Kdenlive, apply **Motion
   Tracker**, draw the tracking area around the face, choose *Gaussian Blur* or
   *Pixelate*, analyze, and inspect the full shot frame by frame.  A tracker can
   lose a face during turns, occlusion, or a cut, so split shots and correct
   those sections manually.
6. Convert the completed master to a TikTok delivery.  The script preserves the
   whole frame by default and adds black padding when necessary; use `-Fit crop`
   only after checking that it does not crop a face or important text.

   ```powershell
   .\scripts\Export-TikTok1080p60.ps1 `
     -InputPath "J:\Tiktok\Luna Video Projects\2026-08-28-rpe8-week-2-thursday\04-Edit-master\rpe8-master.mp4" `
     -OutputDirectory "J:\Tiktok\Luna Video Projects\2026-08-28-rpe8-week-2-thursday\05-TikTok-delivery" `
     -OpenTikTok
   ```

7. Watch the completed `05-TikTok-delivery` MP4 once from start to finish,
   including every face blur.  Then upload it in the TikTok browser page opened
   by the script.  Add the caption, audience, cover, and any native TikTok
   features there, then publish yourself.

## Folder meanings

| Folder | Put here | GitHub? |
| --- | --- | --- |
| `01-Camera-originals` | Unchanged Insta360 files/card copy | No |
| `02-Proxies` | Lightweight editor proxies | No |
| `03-Edit-project` | Kdenlive `.kdenlive` or Resolve `.drp` export | Optional, only project files |
| `04-Edit-master` | Finished high-quality edit before TikTok conversion | No |
| `05-TikTok-delivery` | Verified 1080x1920 60fps upload file | No |
| `06-Notes` | Shot list, caption drafts, release/privacy notes | Optional |

## Delivery specification

`Export-TikTok1080p60.ps1` creates a 1080x1920, constant-60fps MP4 with H.264
High video, 4:2:0 pixel format, AAC stereo audio, Rec.709 tags, one-second
keyframes, and fast-start metadata.  It does not create artificial frames or
change playback speed.  A 30fps source remains 30fps motion duplicated to a
60fps container; your 60fps edit remains 60fps.

The script uses the bundled FFmpeg in this repository when it is present.  Set
the `FFMPEG_PATH` environment variable if you prefer a separately installed
FFmpeg build.

## TikTok publishing boundary

This repository deliberately opens the official upload page instead of using a
stored TikTok password or browser automation.  TikTok's direct-post API needs a
registered and reviewed developer application, `video.publish` approval, and
explicit consent for each upload.  Its sharing rules also say that an internal
tool limited to uploading a team or personal account is not an acceptable
Direct Post API use case.  Manual upload is the reliable and policy-compliant
path for this personal workflow.

## Editor recommendations

1. **Kdenlive — best free/open-source fit.**  No ads, no watermark, Windows
   build, proxy workflow, cuts, masks, motion tracking, blur, pixelation, and
   object masks.  Use this first for privacy edits.
2. **DaVinci Resolve Free — best free professional editor if your Windows GPU
   handles it.**  Excellent cutting, colour, audio, and 4K60 8-bit delivery.
   Use manual Power Windows/tracking for privacy work.  It is proprietary but
   has no ads or subscription.
3. **DaVinci Resolve Studio — best one-time-purchase upgrade for automatic
   people/face masking.**  A US$295 perpetual license adds Magic Mask and the
   AI Neural Engine.  It is the smoother option when you blur many moving faces,
   especially with 10-bit camera media.
4. **Shotcut — free/open-source lightweight alternative.**  Good for simple
   edits; Motion Tracker plus Mask: Simple Shape and Mosaic/Blur works well for
   a few faces.  Kdenlive is the better main tool for a larger project.
5. **LosslessCut — free/open-source companion for quick rough trims.**  Use it
   before the editor when a clip only needs cuts on keyframes; do final privacy
   masking in Kdenlive or Resolve.

Only download these tools from their official project sites.  Avoid "free
premium editor" download sites, driver-updater bundles, browser extensions, and
cracked copies: none are needed for this workflow.
