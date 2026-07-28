#!/bin/bash

# Change to the project directory
cd "$(dirname "$0")"

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
  echo "ERROR: npm not found. Install Node.js from https://nodejs.org"
  read -p "Press Enter to close..."
  exit 1
fi

# If already running and responding, just open the browser
if curl -s --max-time 2 http://localhost:3000 > /dev/null 2>&1; then
  echo "Server already running — opening browser..."
  open "http://localhost:3000"
  exit 0
fi

echo "Starting Notetaker..."
"$NPM" run dev &

# Wait until the server responds (up to 30s)
echo "Waiting for server..."
for i in $(seq 1 30); do
  if curl -s http://localhost:3000 > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

open "http://localhost:3000"
echo "Done — you can minimize this window."
