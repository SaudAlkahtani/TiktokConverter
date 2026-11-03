# Active branches

| Branch | Purpose |
| --- | --- |
| `release/editor-studio` | Multitrack gym editor plus TikTok and Instagram exports. |
| `release/combined-converter` | TikTok and Instagram converter without the editor; default branch. |
| `release/telegram-publisher` | Dedicated Telegram bot, local dashboard, and optional TikTok publishing workflow. |
| `release/local-uploader` | Browser-based local upload and TikTok conversion only. |

All four branches use the same `src/tiktok-preset.js` method from commit
`6378e68`: `-itsscale 2`, same-resolution 60 fps HEVC at a 20 Mbps target,
Rec.709 tags, and AAC 256 kbps stereo. Each branch runs the same exact-argument
and real-output test. Instagram and editor-master exports retain their separate
presets. The method is fixed in code; conflicting TikTok environment values
reject startup. GitHub Actions runs the locked-preset test on all four branches.

`codex/vertical-1080p-fps-bitrate-test` is an additional experimental branch.
It retains the four release modes and adds a separate 1080 × 1920 H.264 test
mode at 25 Mb/s for 60 fps or 15 Mb/s for 30 fps. It is not one of the four
maintained release branches. The dashboard labels this branch prominently.

Previous branch tips are preserved as `archive/2026-10-21/*` Git tags. To inspect
one without changing an active branch, fetch tags and check out its tag in a
separate worktree. Tags are historical snapshots, not maintained release lines.
