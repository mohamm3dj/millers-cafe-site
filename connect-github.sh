#!/bin/zsh
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: ./connect-github.sh <git@github.com:USER/REPO.git|https://github.com/USER/REPO.git>"
  exit 1
fi

REPO_DIR="/Users/g/Desktop/millers-cafe-site"
REMOTE_URL="$1"

cd "$REPO_DIR"

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE_URL"
else
  git remote add origin "$REMOTE_URL"
fi

git push -u origin main

echo "GitHub remote configured and initial push completed."
