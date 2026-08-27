#!/usr/bin/env bash
set -euo pipefail

# Run inside Ubuntu 24.04 WSL. This uses Telegram's official source repository.
sudo apt-get update
sudo apt-get install -y build-essential cmake git gperf libssl-dev zlib1g-dev

INSTALL_ROOT="$HOME/telegram-bot-api"
if [[ ! -d "$INSTALL_ROOT/.git" ]]; then
  git clone --recursive https://github.com/tdlib/telegram-bot-api.git "$INSTALL_ROOT"
else
  git -C "$INSTALL_ROOT" pull --ff-only
  git -C "$INSTALL_ROOT" submodule update --init --recursive
fi

cmake -S "$INSTALL_ROOT" -B "$INSTALL_ROOT/build" -DCMAKE_BUILD_TYPE=Release
cmake --build "$INSTALL_ROOT/build" --parallel "$(nproc)"
test -x "$INSTALL_ROOT/build/telegram-bot-api"
echo "Official Telegram Bot API server is ready: $INSTALL_ROOT/build/telegram-bot-api"
echo "No system-wide install is needed; this avoids writing to /usr/local/bin."
