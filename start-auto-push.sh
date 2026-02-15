#!/bin/zsh
set -euo pipefail

REPO_DIR="/Users/g/Desktop/millers-cafe-site"
PID_FILE="$REPO_DIR/.autopush.pid"
LOG_FILE="/tmp/millers-autopush.log"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$PID" ]] && ps -p "$PID" >/dev/null 2>&1; then
    echo "Auto-push is already running (PID $PID)"
    exit 0
  fi
fi

nohup "$REPO_DIR/auto-push.sh" >> "$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"
echo "Auto-push started (PID $PID). Log: $LOG_FILE"
