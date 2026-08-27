#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/mnt/c/Users/BigBoi/OneDrive/Documents/ChatGPT/Tiktok High quality upload"
SECRETS_FILE="$PROJECT_ROOT/local-bot-api/secrets.env"
SERVER_BIN="$HOME/telegram-bot-api/build/telegram-bot-api"
# TDLib's per-bot database uses POSIX-only filenames and atomic operations.
# Keep this small disposable cache on WSL's Linux filesystem; the exporter
# copies real media to D: immediately and removes this cache copy afterward.
STATE_DIR="$HOME/.local/share/luna-tiktok-bot-api"
LOG_FILE="$PROJECT_ROOT/local-bot-api/server.log"

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "Missing $SECRETS_FILE. Run scripts/enable-local-bot-api.ps1 first." >&2
  exit 1
fi
if [[ ! -x "$SERVER_BIN" ]]; then
  echo "Missing official Bot API server. Run local-bot-api/install-official-server.sh in Ubuntu first." >&2
  exit 1
fi

set -a
source "$SECRETS_FILE"
set +a
mkdir -p "$STATE_DIR" "$STATE_DIR/tmp"
exec "$SERVER_BIN" --api-id="$TELEGRAM_API_ID" --api-hash="$TELEGRAM_API_HASH" --local --http-port=8081 --dir="$STATE_DIR" --temp-dir="$STATE_DIR/tmp" >> "$LOG_FILE" 2>&1
