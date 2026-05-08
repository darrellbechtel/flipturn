#!/bin/bash
#
# auto-deploy.sh — pull origin/main and reload pm2 if origin/main moved
# past whatever was last deployed.
#
# Run by ~/Library/LaunchAgents/com.flipturn.deploy.plist on a timer.
# CI on `main` already gates the merge (typecheck / lint / vitest), so this
# script trusts that anything reachable on origin/main is safe to ship.
#
# Truth source for "what's running" is `~/.flipturn-deployed-sha` — a file
# this script writes after every successful pm2 reload. We compare that to
# origin/main, NOT local HEAD, because merging from this same box (gh pr
# merge fast-forwards local main automatically) would otherwise leave the
# script thinking there's nothing to deploy while pm2 is still on stale
# code. Bootstrap: on first run, the file is seeded from current HEAD and
# the run becomes a no-op.
#
# Defenses:
#  - single-instance lock (`mkdir` lockfile)
#  - refuses to run on a dirty working tree (could indicate ad-hoc edits)
#  - `git checkout main && git merge --ff-only origin/main` so the deploy
#    can never accidentally merge or rebase, regardless of starting branch
#  - `pm2 reload` is graceful / zero-downtime
#  - deployed-sha is written ONLY after a successful reload, so a failed
#    deploy doesn't poison the next tick into thinking it succeeded
#
# Logs to ~/.flipturn-deploy.log. Tail with `tail -f ~/.flipturn-deploy.log`.
#
set -euo pipefail

REPO="${HOME}/code/flipturn"
LOG="${HOME}/.flipturn-deploy.log"
LOCK="/tmp/flipturn-deploy.lock"
DEPLOYED_SHA_FILE="${HOME}/.flipturn-deployed-sha"

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

REMOTE=$(git rev-parse origin/main)

# Bootstrap: assume whatever pm2 is currently running matches HEAD on
# first install. After this seeding run, only real merges past origin/main
# will trigger a deploy.
if [ ! -f "$DEPLOYED_SHA_FILE" ]; then
  HEAD_SHA=$(git rev-parse HEAD)
  echo "$HEAD_SHA" > "$DEPLOYED_SHA_FILE"
  log "seeded deployed-sha file with HEAD=${HEAD_SHA:0:7}"
  exit 0
fi

DEPLOYED=$(cat "$DEPLOYED_SHA_FILE")

if [ "$DEPLOYED" = "$REMOTE" ]; then
  log "tick: deployed=${DEPLOYED:0:7} (no diff)"
  exit 0
fi

log "deploying ${DEPLOYED:0:7} -> ${REMOTE:0:7}"

# pnpm / pm2 / prisma live under Homebrew + the user's local node bin. launchd
# doesn't source shell rc files, so build a usable PATH explicitly.
export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

{
  # Ensure we're on main pointing at origin/main, regardless of which
  # branch the operator left checked out. Working tree is already clean
  # per the dirty-tree check above, so the switch is safe.
  git checkout main
  git merge --ff-only origin/main
  pnpm install --frozen-lockfile
  pnpm --filter @flipturn/db exec prisma migrate deploy
  pm2 reload "${REPO}/infra/pm2/ecosystem.config.cjs" --update-env
} >>"$LOG" 2>&1

echo "$REMOTE" > "$DEPLOYED_SHA_FILE"
log "deploy complete: now at ${REMOTE:0:7}"
