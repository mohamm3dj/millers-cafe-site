#!/bin/zsh
set -euo pipefail

REPO_DIR="/Users/g/Desktop/millers-cafe-site"
PID_FILE="$REPO_DIR/.autopush.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "No PID file found."
  exit 0
fi

PID="$(cat "$PID_FILE")"
if [[ -n "$PID" ]] && ps -p "$PID" >/dev/null 2>&1; then
  kill "$PID" || true
  echo "Stopped auto-push (PID $PID)."
else
  echo "Process not running."
fi

rm -f "$PID_FILE"
