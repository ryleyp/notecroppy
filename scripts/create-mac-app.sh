#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$PROJECT_DIR/Notetaker.app"
SCRIPT_FILE="$(mktemp /tmp/notetaker-launcher.XXXXXX.applescript)"

cat >"$SCRIPT_FILE" <<APPLESCRIPT
do shell script "cd " & quoted form of "$PROJECT_DIR" & " && ./scripts/start-notetaker-local.sh >/tmp/notetaker-webapp-launcher.log 2>&1 &"
APPLESCRIPT

rm -rf "$APP_DIR"
osacompile -o "$APP_DIR" "$SCRIPT_FILE"
rm "$SCRIPT_FILE"

echo "Created $APP_DIR"
