# Maintained branches

| Branch | Purpose |
| --- | --- |
| `release/combined-converter` | Default local workspace: TikTok, Instagram, Both, and gym editor. |
| `release/editor-studio` | Gym editor, Remotion motion titles and JSON edit plans, and the same local converter profiles. |
| `release/local-uploader` | Single-platform browser uploader with the standard TikTok profile. |
| `release/telegram-publisher` | Telegram bot, local dashboard, and optional TikTok publishing with the standard TikTok profile. |

All branches use the same final TikTok conversion: 1080 × 1920 H.264, AAC
256 kb/s stereo, Rec.709. Sources at 45 fps or higher export at 60 fps with a
25 Mb/s video target and a 2× input timestamp scale. Lower source rates export
at 30 fps with a 15 Mb/s target and normal duration. On branches with an
Instagram route, that route always exports 1080 × 1920 H.264 at 30 fps and
15 Mb/s with normal duration. The editor's working master keeps its separate
quality and timing before final conversion.

The former `codex/vertical-1080p-fps-bitrate-test` branch is the source of
this promoted profile. Historical branch tips remain available as
`archive/2026-10-21/*` tags.
