#!/bin/bash
set -euo pipefail

ROOT="/Users/will/code/stremio-library-importer"
PORT=3456
URL="http://127.0.0.1:${PORT}"
LOG="/tmp/stremio-library-viewer.log"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
fi

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display dialog "Node.js was not found. Install Node 18+ and try again." buttons {"OK"} default button 1 with icon stop'
  exit 1
fi

if [ ! -f "$ROOT/src/web/server.js" ]; then
  osascript -e "display dialog \"Could not find the app at ${ROOT}.\" buttons {\"OK\"} default button 1 with icon stop"
  exit 1
fi

server_is_up() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

stop_server() {
  curl -sS -m 2 -X POST "$URL/api/shutdown" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    if ! server_is_up; then
      return 0
    fi
    sleep 0.1
  done
  local pid
  pid="$(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "${pid:-}" ]; then
    kill $pid >/dev/null 2>&1 || true
  fi
}

if server_is_up; then
  choice="$(osascript -e 'button returned of (display dialog "Stremio Library is already running." buttons {"Quit server", "Cancel", "Open"} default button "Open")')"
  if [ "$choice" = "Quit server" ]; then
    stop_server
    exit 0
  fi
  if [ "$choice" != "Open" ]; then
    exit 0
  fi
else
  cd "$ROOT"
  nohup node src/web/server.js >>"$LOG" 2>&1 &
  for _ in $(seq 1 40); do
    if server_is_up; then
      break
    fi
    sleep 0.15
  done
fi

if ! server_is_up; then
  osascript -e 'display dialog "The library viewer did not start. Check /tmp/stremio-library-viewer.log" buttons {"OK"} default button 1 with icon stop'
  exit 1
fi

open "$URL"
