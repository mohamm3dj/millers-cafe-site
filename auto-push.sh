#!/bin/zsh
set -u

REPO_DIR="/Users/g/Desktop/millers-cafe-site"
LOG_PREFIX="[auto-push]"

cd "$REPO_DIR" || exit 1

while true; do
  # Wait until remote is configured.
  if ! git remote get-url origin >/dev/null 2>&1; then
    echo "$LOG_PREFIX origin remote not set yet; waiting..."
    sleep 60
    continue
  fi

  BRANCH="$(git branch --show-current)"
  if [[ -z "$BRANCH" ]]; then
    BRANCH="main"
    git checkout -B "$BRANCH" >/dev/null 2>&1 || true
  fi

  if [[ -n "$(git status --porcelain)" ]]; then
    git add -A
    git commit -m "auto: $(date '+%Y-%m-%d %H:%M:%S')" >/dev/null 2>&1 || true
    git push -u origin "$BRANCH" >/dev/null 2>&1 || echo "$LOG_PREFIX push failed; will retry"
  fi

  sleep 60
done
