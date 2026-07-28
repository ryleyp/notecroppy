#!/bin/bash

# Resolve the project directory relative to this script
DIR="$(cd "$(dirname "$0")" && pwd)"

# Find npm — works for Homebrew (Apple Silicon & Intel) and nvm
NPM=""
for candidate in \
  "/opt/homebrew/bin/npm" \
  "/usr/local/bin/npm" \
  "$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -1)/bin/npm"
do
  if [ -x "$candidate" ]; then
    NPM="$candidate"
    break
  fi
done

if [ -z "$NPM" ]; then
  osascript -e 'display alert "npm not found" message "Could not locate npm. Make sure Node.js is installed via Homebrew or nvm."'
  exit 1
fi

# If the server is already running, just open the browser
if lsof -ti:3000 > /dev/null 2>&1; then
  open "http://localhost:3000"
  exit 0
fi

# Start the dev server in the background
cd "$DIR"
"$NPM" run dev &> /tmp/notetaker.log &

# Wait until the server responds (up to 30s)
for i in $(seq 1 30); do
  if curl -s http://localhost:3000 > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

open "http://localhost:3000"
