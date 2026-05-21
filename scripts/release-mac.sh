#!/usr/bin/env bash
set -euo pipefail

# macOS release: bump version, build dmg/zip, create draft GitHub release, upload Mac assets.
#
# Usage:
#   ./scripts/release-mac.sh
#   ./scripts/release-mac.sh --tag v0.1.3
#   ./scripts/release-mac.sh --r2              # upload and promote macOS latest on R2
#   ./scripts/release-mac.sh --stable --r2     # publish to the stable update channel
#   ./scripts/release-mac.sh --r2-upload-only  # upload archive only, no latest promotion
#   ./scripts/release-mac.sh --publish
#   ./scripts/release-mac.sh --p12 ... --p12-password ... --p8 ... --key-id ... --issuer ...
#
# Release notes default: summarize conventional commits since the previous tag.
#   --notes "..."        custom text only
#   --notes-file path    markdown file
#   --no-commit-notes    generic build info only (old behavior)
#
# After this completes, run on Windows (same version):
#   ./scripts/release-win.sh --tag v<RELEASE_VERSION from output> --r2 --r2-promote --publish

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/release-common.sh
source "${ROOT}/scripts/lib/release-common.sh"
release_load_local_env

PUBLISH=false
CUSTOM_NOTES=""
NOTES_FILE=""
RELEASE_NOTES_FROM_COMMITS=1
RELEASE_TAG=""
P12_PATH="${P12_PATH:-${CSC_LINK:-}}"
P12_PASSWORD="${P12_PASSWORD:-${CSC_KEY_PASSWORD:-}}"
P8_PATH="${P8_PATH:-${APPLE_API_KEY:-}}"
KEY_ID="${KEY_ID:-${APPLE_API_KEY_ID:-}}"
ISSUER="${ISSUER:-${APPLE_API_ISSUER:-}}"
RELEASE_CHANNEL="${RELEASE_CHANNEL:-frontier}"
R2_UPLOAD="${R2_UPLOAD:-false}"
R2_PROMOTE="${R2_PROMOTE:-false}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish) PUBLISH=true; shift ;;
    --r2) R2_UPLOAD=true; R2_PROMOTE=true; shift ;;
    --r2-upload-only) R2_UPLOAD=true; R2_PROMOTE=false; shift ;;
    --r2-promote) R2_UPLOAD=true; R2_PROMOTE=true; shift ;;
    --tag) RELEASE_TAG="$2"; shift 2 ;;
    --channel) RELEASE_CHANNEL="$2"; shift 2 ;;
    --stable) RELEASE_CHANNEL=stable; shift ;;
    --frontier) RELEASE_CHANNEL=frontier; shift ;;
    --p12) P12_PATH="$2"; shift 2 ;;
    --p12-password) P12_PASSWORD="$2"; shift 2 ;;
    --p8) P8_PATH="$2"; shift 2 ;;
    --key-id) KEY_ID="$2"; shift 2 ;;
    --issuer) ISSUER="$2"; shift 2 ;;
    --notes) CUSTOM_NOTES="$2"; shift 2 ;;
    --notes-file) NOTES_FILE="$2"; shift 2 ;;
    --no-commit-notes) RELEASE_NOTES_FROM_COMMITS=0; shift ;;
    --help|-h)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "Unknown flag: $1" ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || die "release-mac.sh must run on macOS."

release_check_prerequisites
release_apply_signing_env
release_acquire_lock

cyan "Computing release version..."
if [[ -n "${RELEASE_TAG}" ]]; then
  RELEASE_BUMP=none
fi
release_compute_version

cyan "  Base:    ${BASE_VERSION}"
cyan "  Latest:  ${LATEST_TAG:-<none>}"
cyan "  Next:    ${RELEASE_VERSION}  (tag: ${TAG_NAME})"
release_export_update_channel
release_export_app_version

release_ensure_tag_available
release_prepare_builder_cache
release_clean_dist_artifacts

cyan "Building macOS..."
npm run dist:mac || die "macOS build failed"

release_write_meta_file

ASSETS=()
collect() {
  local label="$1"
  shift
  local matched=()
  local pattern file

  shopt -s nullglob
  for pattern in "$@"; do
    for file in ${pattern}; do
      [[ -f "${file}" ]] || continue
      matched+=("${file}")
    done
  done
  shopt -u nullglob

  if [[ ${#matched[@]} -eq 0 ]]; then
    red "  ✗ ${label}"
    die "Missing asset: ${label}"
  fi

  for file in "${matched[@]}"; do
    ASSETS+=("${file}")
    green "  ✓ ${label}: ${file}"
  done
}

# artifactName: ${productName}-${version}-mac-${arch}.dmg|zip
collect "macOS arm64 dmg" "dist/DeepSeek-GUI-*-mac-arm64.dmg"
collect "macOS x64 dmg" "dist/DeepSeek-GUI-*-mac-x64.dmg"
collect "macOS arm64 zip" "dist/DeepSeek-GUI-*-mac-arm64.zip"
collect "macOS x64 zip" "dist/DeepSeek-GUI-*-mac-x64.zip"
collect "macOS blockmap" "dist/DeepSeek-GUI-*-mac-*.zip.blockmap"

NOTES_TMP=$(mktemp "${TMPDIR:-/tmp}/release-notes.XXXXXX")
UNSIGNED_NOTE=""
if ! $SIGNING; then
  UNSIGNED_NOTE=$(
    cat <<'EOF'

### ⚠️ macOS: Unsigned Build

This is an unsigned build. macOS Gatekeeper will block first launch.
Run this after downloading:

```sh
xattr -cr "DeepSeek GUI.app"
# or
npm run mac:unquarantine
```
EOF
  )
fi

release_write_notes_file "${NOTES_TMP}"
echo "${UNSIGNED_NOTE}" >>"${NOTES_TMP}"

cyan "Creating GitHub release ${TAG_NAME}..."
GITHUB_RELEASE_FLAGS=(--draft)
if [[ "${RELEASE_CHANNEL}" == "frontier" ]]; then
  GITHUB_RELEASE_FLAGS+=(--prerelease)
fi
gh release create "${TAG_NAME}" \
  --title "${RELEASE_NAME}" \
  --notes-file "${NOTES_TMP}" \
  --target "$(release_git branch --show-current)" \
  "${GITHUB_RELEASE_FLAGS[@]}" \
  || die "gh release create failed"

cyan "Uploading ${#ASSETS[@]} macOS asset(s)..."
for asset in "${ASSETS[@]}"; do
  green "  ↑ $(basename "${asset}")"
  gh release upload "${TAG_NAME}" "${asset}" --clobber \
    || die "gh release upload failed for ${asset}"
done

if [[ "${R2_UPLOAD}" == "true" ]]; then
  cyan "Uploading macOS asset metadata to R2 (${TAG_NAME})..."
  node "${ROOT}/scripts/publish-r2.mjs" upload --platform mac --tag "${TAG_NAME}" --channel "${RELEASE_CHANNEL}" \
    || die "R2 upload failed for macOS assets"
fi

if [[ "${R2_PROMOTE}" == "true" ]]; then
  cyan "Promoting ${TAG_NAME} as R2 latest..."
  node "${ROOT}/scripts/publish-r2.mjs" promote --tag "${TAG_NAME}" --channel "${RELEASE_CHANNEL}" \
    || die "R2 promote failed"
fi

if $PUBLISH; then
  die "Use --publish only after Windows assets are uploaded (release-win.sh --publish)."
fi

rm -f "${NOTES_TMP}"

echo
green "macOS release ${TAG_NAME} ready (draft)."
cyan "  Meta: dist/.release-meta.env"
cyan "  Channel: ${RELEASE_CHANNEL}"
cyan "  Next on Windows: ./scripts/release-win.sh --tag ${TAG_NAME} --channel ${RELEASE_CHANNEL}"
cyan "  https://github.com/XingYu-Zhong/DeepSeek-GUI/releases/tag/${TAG_NAME}"
