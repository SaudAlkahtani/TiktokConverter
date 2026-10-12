# Telegram → conversion → TikTok Studio (Playwright)

## Current readiness

Caption prompts, persistent drafts, settings, native scheduling requests,
review/confirmation and the Playwright adapter are implemented. **Live posting
is locked until the account and upload controls are verified.** Studio was logged
out during inspection. No real video was published or scheduled. Unit tests
simulate TikTok; they do not verify your current account's upload interface.

TikTok's [Studio documentation](https://support.tiktok.com/en/using-tiktok/creating-videos/creator-tools-on-tiktok)
describes web uploads and scheduling. Fields and limits vary by account and UI
version. This integration does not bypass CAPTCHA, authentication, permissions
or platform restrictions and does not call private TikTok APIs.

## One-time setup

1. Use `/myid` in the exporter bot. Put your Telegram **user ID**, not an arbitrary
   group/chat ID, in `TIKTOK_ALLOWED_USER_IDS` in the ignored `.env`.
2. `TIKTOK_HANDLE=sauds.journey` targets `@sauds.journey` (“Saud fitness journey”).
   The browser must verify that exact logged-in handle; a display name alone is
   not enough. `TIKTOK_TIMEZONE=Asia/Riyadh` is the default (UTC+03:00).
3. Restart the converter. Click **Connect TikTok (manual login)** on the local
   dashboard and sign in yourself in its separate Edge window. Alternatively,
   stop the server and run `npm run tiktok:login`; close that window before the
   server owns the profile. Never send passwords, cookies or OTPs to the bot.
4. Inspect the actual Studio controls with the dashboard button. Open the account
   menu if necessary so its @handle link is visible. Calibrate the ignored
   `data/tiktok/studio-controls.json` using actual unique selectors returned by
   inspection. `accountSelector` must identify the **logged-in account**, not
   a recommended creator, caption or unrelated profile link.
5. Map identity, file input and caption first. Settings can appear only after
   uploading a video; inspect again then, map the remaining fields and verify
   their read-back. Configure distinct publish/schedule buttons and verifiable
   published/scheduled success indicators. Missing controls stop automation.
6. Only enable submission after live verification of the complete preview.

The browser profile is isolated in ignored `.tiktok-browser/`. Captions, drafts
and previews stay in ignored `data/tiktok/`; never commit these. Only one process
may own the profile. Local setup endpoints require a same-origin dashboard
request and custom header. Telegram cannot alter the owner list or login setup.

## Studio options: extensible, not full feature parity yet

Copy `docs/studio-controls.example.json` to the ignored manifest location and
replace blank selectors with inspected ones. This is a calibration template,
**not a ready-to-use selector preset**. Blank selectors intentionally block use.

Generic text, textarea, contenteditable, number, date, time, datetime-local,
select, checkbox and ARIA switch fields are supported. `/studio` lists every
mapped setting and select choice; `/option` sets any mapped field. Inspect and
map the actual audience/privacy, comments, Duet/Stitch/reuse, AI-content label,
commercial disclosures, copyright checks and other fields available to this
account. Do not fabricate unavailable controls or map legal agreements as
generic boolean settings.

Custom editors (covers, music/sounds, locations, mentions, product links and
multi-step disclosure dialogs) are **not copied in full** by this adapter. They
need dedicated live-tested mappings or manual Studio completion. The app will
not silently claim unsupported choices were applied.

Scheduling requires `schedule`, `scheduleDate` and `scheduleTime` mappings.
Input format: `YYYY-MM-DD HH:mm` in the configured timezone. The bot validates
calendar dates and requires at least 15 minutes ahead; TikTok can impose stricter
limits or a different horizon. Native Studio must accept the date/time. There is
no Windows timer fallback and no fallback from scheduling to posting now. Once
native scheduling is confirmed, TikTok handles later publication remotely.

## Telegram flow

1. Send an original video as a File. The bot asks for a method for **that video**:
   **Return video only** converts and returns the File, with no TikTok draft or
   caption prompt. **Upload to TikTok @sauds.journey** converts and returns a
   preview File, then starts the caption/review steps below. Only the sender in
   the originating chat can select; repeated taps cannot queue it twice. No file
   is downloaded before selecting. Choose within one hour; resend after expiry
   or a server restart. It becomes original-resolution, 60fps HEVC,
   18/28/45 Mbps, default `-itsscale 2`. Audio uses rebuilt sample timestamps and
   `atempo=0.5`, preserving pitch. Set `VIDEO_TIMESTAMP_SCALE=1` for normal speed.
2. For the TikTok method, reply to the converted video's description prompt with
   the TikTok post caption and hashtags for `@sauds.journey`. This is not burned-in
   video text. Choosing this method does not authorize an otherwise unauthorized
   Telegram user to publish, log in, or bypass Studio setup.
3. Choose fields and a schedule using the per-video draft ID. Replies and IDs
   distinguish multiple videos and persist across restarts.
4. `/prepare ID` transfers the converted video to the verified TikTok account
   for review, fills/read-backs metadata and sends a Studio screenshot. It does
   not publish. Confirm only after checking the exact account and every setting.
5. Press **Confirm publish** or **Confirm schedule**. Approval expires in 15
   minutes and is invalidated by metadata changes or a server restart.

```text
/myid
/tiktok
/caption DRAFT_ID Your description #fitness
/studio
/option DRAFT_ID comments false
/schedule DRAFT_ID 2026-10-20 19:30
/schedule DRAFT_ID now
/prepare DRAFT_ID
/cancelpost DRAFT_ID
```

Publishing requires an authorized Telegram user ID. Each draft is accessible
only by its creator in the originating chat. The bot claims success only after
the configured Studio confirmation is visible. An unverified submission is
persisted as `uncertain`: check Studio manually before any retry to avoid a
duplicate. Restarting never automatically resumes posting.

Outputs remain on disk after Telegram originals are cleaned up. Cancelling a
draft keeps files and does not remove an already submitted TikTok post. Account
disconnect and post deletion are deliberate manual operations.
