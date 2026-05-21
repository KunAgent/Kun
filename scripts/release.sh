#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# release.sh — macOS GitHub Release (wrapper)
#
# Builds macOS artifacts and creates a draft GitHub release with the next
# version tag. Build Windows on a Windows machine with the same tag:
#
#   ./scripts/release-mac.sh              # or ./scripts/release.sh
#   ./scripts/release-win.sh --tag vX.Y.Z
#
# Use --publish on release-win.sh after both platforms are uploaded.
#
# Legacy --all is removed (cross-compiling node-pty on Mac for Windows fails).
# =============================================================================

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${1:-}" == "--all" ]]; then
  printf '\033[31m%s\033[0m\n' "[ERROR] --all is no longer supported." >&2
  echo "Build each platform on its native OS:" >&2
  echo "  macOS:   ./scripts/release-mac.sh" >&2
  echo "  Windows: ./scripts/release-win.sh --tag v<version from mac build>" >&2
  exit 1
fi

exec "${ROOT}/scripts/release-mac.sh" "$@"
