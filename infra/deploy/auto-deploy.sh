#!/bin/bash
#
# auto-deploy.sh — pull origin/main and reload pm2 if HEAD moved.
#
# Run by ~/Library/LaunchAgents/com.flipturn.deploy.plist on a timer.
# CI on `main` already gates the merge (typecheck / lint / vitest), so this
# script trusts that anything reachable on origin/main is safe to ship.
#
# Defenses:
#  - single-instance lock (`mkdir` lockfile)
#  - refuses to run on a dirty working tree (could indicate ad-hoc edits)
#  - `git pull --ff-only` so we never accidentally merge or rebase
#  - `pm2 reload` is graceful / zero-downtime
#
# Logs to ~/.flipturn-deploy.log. Tail with `tail -f ~/.flipturn-deploy.log`.
#
set -euo pipefail

REPO="${HOME}/code/flipturn"
LOG="${HOME}/.flipturn-deploy.log"
LOCK="/tmp/flipturn-deploy.lock"

log() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >>"$LOG"
}

if ! mkdir "$LOCK" 2>/dev/null; then
  log "previous run still holding $LOCK, skipping"
  exit 0
fi
trap 'rmdir "$LOCK"' EXIT

cd "$REPO"

if ! git diff --quiet || ! git diff --cached --quiet; then
  log "dirty working tree at $REPO, refusing to deploy"
  exit 1
fi

git fetch --quiet origin main

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

log "deploying ${LOCAL:0:7} -> ${REMOTE:0:7}"

# pnpm / pm2 / prisma live under Homebrew + the user's local node bin. launchd
# doesn't source shell rc files, so build a usable PATH explicitly.
export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

{
  git pull --ff-only origin main
  pnpm install --frozen-lockfile
  pnpm --filter @flipturn/db exec prisma migrate deploy
  pm2 reload "${REPO}/infra/pm2/ecosystem.config.cjs" --update-env
} >>"$LOG" 2>&1

log "deploy complete: now at ${REMOTE:0:7}"
