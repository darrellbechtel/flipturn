#!/bin/bash
#
# build.sh — fire off an EAS Build for the Flip Turn mobile app.
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
# The build runs on EAS cloud workers. The CLI returns a build URL within
# a few seconds; the actual build takes ~5–15 minutes. Defaults match the
# closed-beta workflow: internal-distribution preview build that
# installs over QR / TestFlight internal.
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

echo "EAS build → platform=$PLATFORM profile=$PROFILE${*:+ (extra flags: $*)}"
exec npx eas-cli build --platform "$PLATFORM" --profile "$PROFILE" "$@"
