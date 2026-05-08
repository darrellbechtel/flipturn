#!/bin/bash
#
# build.sh — fire off an EAS Build for the Flip Turn mobile app, then
# render the install URL as a scannable QR PNG on the operator's Desktop.
#
# Usage:
#   ./scripts/build.sh                       # ios preview (default)
#   ./scripts/build.sh android               # android preview
#   ./scripts/build.sh ios production        # ios store-bound
#   ./scripts/build.sh all preview           # both platforms in one run
#
# Or via pnpm from the mobile package: `pnpm build:eas [platform] [profile]`.
#
# All flags after the two positional args are forwarded to `eas-cli build`,
# so you can append e.g. `--non-interactive` for CI, `--clear-cache`, or
# `--message "fix XYZ"` without editing the script.
#
# After a successful build, the script greps the EAS output for the
# `https://expo.dev/.../builds/<UUID>` install URL and (when `qrencode`
# is on PATH) writes a PNG to
# `~/Desktop/flipturn-build-<ts>-<platform>-<profile>.png` and `open`s it.
# Scan it from your iPhone camera; or paste the URL into Mobile Safari.
#
# If `qrencode` isn't installed the script just echoes the URL plus a hint.
#
set -euo pipefail

# Anchor at the mobile package root so this works no matter where it's run from.
cd "$(dirname "$0")/.."

PLATFORM="${1:-ios}"
PROFILE="${2:-preview}"
shift 2 2>/dev/null || shift "$#"

case "$PLATFORM" in
  ios|android|all) ;;
  *)
    echo "Invalid platform: $PLATFORM (expected: ios | android | all)" >&2
    exit 64
    ;;
esac

case "$PROFILE" in
  development|preview|production) ;;
  *)
    echo "Invalid profile: $PROFILE (expected: development | preview | production)" >&2
    exit 64
    ;;
esac

LOG="$(mktemp -t eas-build.XXXXXX)"
trap 'rm -f "$LOG"' EXIT

echo "EAS build → platform=$PLATFORM profile=$PROFILE${*:+ (extra flags: $*)}"
# Tee through a logfile so we can mine the install URL after the build.
# `set -o pipefail` propagates eas-cli's exit code, so a failed build still
# fails this script.
npx eas-cli build --platform "$PLATFORM" --profile "$PROFILE" "$@" 2>&1 | tee "$LOG"

URL="$(grep -oE 'https://expo\.dev/accounts/[^ ]+/projects/[^ ]+/builds/[0-9a-f-]+' "$LOG" | tail -1 || true)"

if [ -z "$URL" ]; then
  echo
  echo "Build complete; no install URL detected in EAS output (skipping QR)."
  exit 0
fi

if ! command -v qrencode >/dev/null 2>&1; then
  echo
  echo "Install URL: $URL"
  echo "(install qrencode for an auto-rendered QR: brew install qrencode)"
  exit 0
fi

TS="$(date +%Y-%m-%dT%H-%M)"
PNG="${HOME}/Desktop/flipturn-build-${TS}-${PLATFORM}-${PROFILE}.png"
qrencode -o "$PNG" -s 12 "$URL"
echo
echo "Install URL: $URL"
echo "Install QR:  $PNG"

# macOS only — opens Preview so you can scan from your phone right away.
if [ "$(uname)" = "Darwin" ]; then
  open "$PNG" || true
fi
