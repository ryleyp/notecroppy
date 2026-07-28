#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${NOTETAKER_PORT:-3000}"
URL="http://127.0.0.1:${PORT}"
LOG_FILE="/tmp/notetaker-webapp.log"

cd "$PROJECT_DIR"

if curl -s --max-time 2 "$URL" >/dev/null 2>&1; then
  open "$URL"
  exit 0
fi

if [ ! -d node_modules ]; then
  npm install
fi

WATCHPACK_POLLING=true npm run dev -- --port "$PORT" >"$LOG_FILE" 2>&1 &

for _ in $(seq 1 60); do
  if curl -s --max-time 2 "$URL" >/dev/null 2>&1; then
    open "$URL"
    exit 0
  fi
  sleep 1
done

open "$URL"
