#!/usr/bin/env bash
# Deploy SnartChessBox to https://snart.com/chessbox
#
# Whole-project rsync into the shared webroot's chessbox/ subdirectory,
# excluding VCS and dev tooling (see .rsync-exclude). Static only, no build step.
set -euo pipefail

HOST="proisp"
DEST="$(ssh -o BatchMode=yes "$HOST" 'readlink -f "$HOME/www/chessbox"')"

# create the target directory on the host first (idempotent)
ssh "$HOST" "mkdir -p '$DEST'"

rsync -avz --delete \
  --exclude-from="$(git rev-parse --show-toplevel)/.rsync-exclude" \
  "$(git rev-parse --show-toplevel)/" "$HOST":"$DEST"/

echo
echo "Deployed to: https://snart.com/chessbox"
echo "  remote:    $DEST"
echo "  files:     $(ssh "$HOST" "find '$DEST' -type f | wc -l")"
