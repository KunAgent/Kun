#!/usr/bin/env bash
set -euo pipefail

# macOS release: bump version, build dmg/zip, create draft GitHub release, upload Mac assets.
#
# Usage:
#   ./scripts/release-mac.sh
#   ./scripts/release-mac.sh --tag v0.1.3
#   ./scripts/release-mac.sh --r2              # upload macOS metadata only; promotion waits for Windows
#   ./scripts/release-mac.sh --stable --r2     # upload stable-channel macOS metadata only
#   ./scripts/release-mac.sh --r2-upload-only  # upload archive only, no latest promotion
#   ./scripts/release-mac.sh --publish
#   ./scripts/release-mac.sh --p12 ... --p12-password ... --p8 ... --key-id ... --issuer ...
#
# Release notes default: summarize conventional commits since the previous tag.
#   --notes "..."        custom text only
#   --notes-file path    markdown file
#   --no-commit-notes    generic build info only (old behavior)
#
# Speed knobs:
#   RELEASE_UPLOAD_CONCURRENCY=4    GitHub/R2 upload concurrency
#   KUN_RUNTIME_CACHE=0             disable bundled runtime cache
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
RELEASE_UPLOAD_CONCURRENCY="${RELEASE_UPLOAD_CONCURRENCY:-4}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish) PUBLISH=true; shift ;;
    --r2) R2_UPLOAD=true; R2_PROMOTE=false; shift ;;
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
      sed -n '4,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "Unknown flag: $1" ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || die "release-mac.sh must run on macOS."

if [[ "${R2_PROMOTE}" == "true" ]]; then
  die "macOS release only uploads single-platform R2 metadata; run release-win.sh --r2-promote after the complete three-platform bundle passes verification."
fi

build_macos() {
  cyan "Building macOS serially for architecture-specific native dependencies..."
  npm run dist:mac || die "macOS build failed"
}

resolve_mac_resources() {
  local arch="$1"
  local candidates=()
  local candidate

  case "${arch}" in
    arm64)
      candidates=(
        "${ROOT}/dist/mac-arm64/Kun.app/Contents/Resources"
      )
      ;;
    x64)
      candidates=(
        "${ROOT}/dist/mac/Kun.app/Contents/Resources"
      )
      ;;
    *) die "Unsupported macOS Extension smoke architecture: ${arch}" ;;
  esac

  for candidate in "${candidates[@]}"; do
    if [[ -d "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  die "Cannot find packaged macOS ${arch} resources for Extension smoke."
}

smoke_macos_extensions() {
  local x64_resources
  local arm64_resources
  local host_resources
  local host_arch

  x64_resources="$(resolve_mac_resources x64)"
  arm64_resources="$(resolve_mac_resources arm64)"

  cyan "Verifying packaged native architecture (macOS x64)..."
  npm run verify:packaged-macos-native -- --resources "${x64_resources}" --arch x64 \
    || die "macOS x64 packaged native architecture verification failed"

  cyan "Verifying packaged native architecture (macOS arm64)..."
  npm run verify:packaged-macos-native -- --resources "${arm64_resources}" --arch arm64 \
    || die "macOS arm64 packaged native architecture verification failed"

  cyan "Smoking packaged Extension Node runtime (macOS x64)..."
  npm run smoke:packaged-extensions -- --resources "${x64_resources}" \
    || die "macOS x64 packaged Extension Node runtime smoke failed"

  cyan "Smoking packaged Extension Node runtime (macOS arm64)..."
  npm run smoke:packaged-extensions -- --resources "${arm64_resources}" \
    || die "macOS arm64 packaged Extension Node runtime smoke failed"

  host_arch="$(node -p 'process.arch')"
  case "${host_arch}" in
    arm64) host_resources="${arm64_resources}" ;;
    x64) host_resources="${x64_resources}" ;;
    *) die "Unsupported host architecture for desktop Extension smoke: ${host_arch}" ;;
  esac

  cyan "Smoking packaged OCR dependencies (host-native macOS ${host_arch})..."
  KUN_PACKAGED_RESOURCES_DIR="${host_resources}" node scripts/smoke-packaged-ocr.cjs \
    || die "macOS packaged OCR dependency smoke failed"

  cyan "Smoking packaged Extension desktop Chromium (host-native macOS ${host_arch})..."
  npm run smoke:packaged-extension-desktop -- --resources "${host_resources}" \
    || die "macOS packaged Extension desktop Chromium smoke failed"

  cyan "Smoking host-native FFmpeg broker (macOS ${host_arch})..."
  KUN_RUN_MEDIA_SMOKE=1 npm run smoke:extension-native-media \
    || die "macOS host-native FFmpeg broker smoke failed"

  cyan "Smoking packaged Kun Video Editor native workflow (macOS ${host_arch})..."
  npm run smoke:packaged-video-editor-native -- --resources "${host_resources}" \
    --archive "${ROOT}/dist/kun-video-editor-0.4.4.kunx" \
    || die "macOS packaged Kun Video Editor native workflow smoke failed"

  cyan "Recording commit-bound macOS native evidence..."
  npm run evidence:extension-native \
    || die "macOS native evidence generation failed"
}

release_check_prerequisites
release_apply_signing_env
release_acquire_lock

cyan "Verifying clean release checkout..."
npm run verify:manual-extension-release -- --clean-only \
  || die "Release checkout contains tracked or untracked changes"

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

cyan "Checking Extension public release gate..."
npm run check:extension-release-gate || die "Extension public release gate failed"

release_clean_dist_artifacts

cyan "Building macOS..."
build_macos

cyan "Building deterministic Kun Video Editor extension package..."
rm -f "${ROOT}"/dist/kun-video-editor-*.kunx
npm run pack:kun-video-editor || die "Kun Video Editor extension package failed"

smoke_macos_extensions

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

collect_optional() {
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
    yellow "  • ${label}: none"
    return
  fi

  for file in "${matched[@]}"; do
    ASSETS+=("${file}")
    green "  ✓ ${label}: ${file}"
  done
}

# artifactName: Kun-${version}-mac-${arch}.dmg|zip
collect "macOS arm64 dmg" "dist/Kun-*-mac-arm64.dmg"
collect "macOS x64 dmg" "dist/Kun-*-mac-x64.dmg"
collect "macOS arm64 zip" "dist/Kun-*-mac-arm64.zip"
collect "macOS x64 zip" "dist/Kun-*-mac-x64.zip"
collect "macOS native evidence" "dist/extension-native-evidence-darwin.json"
collect "Kun Video Editor extension" "dist/kun-video-editor-*.kunx"
collect_optional "macOS blockmap" "dist/Kun-*-mac-*.zip.blockmap"

upload_github_assets() {
  local tag="$1"
  shift
  local concurrency="${RELEASE_UPLOAD_CONCURRENCY}"
  local failures=0
  local pids=()
  local files=()

  if ! [[ "${concurrency}" =~ ^[1-9][0-9]*$ ]]; then
    concurrency=4
  fi

  for asset in "$@"; do
    green "  ↑ $(basename "${asset}")"
    gh release upload "${tag}" "${asset}" --clobber &
    pids+=("$!")
    files+=("${asset}")

    if [[ ${#pids[@]} -ge ${concurrency} ]]; then
      if wait "${pids[0]}"; then
        green "  ✓ $(basename "${files[0]}")"
      else
        red "  ✗ $(basename "${files[0]}")"
        failures=1
      fi
      pids=("${pids[@]:1}")
      files=("${files[@]:1}")
    fi
  done

  for i in "${!pids[@]}"; do
    if wait "${pids[$i]}"; then
      green "  ✓ $(basename "${files[$i]}")"
    else
      red "  ✗ $(basename "${files[$i]}")"
      failures=1
    fi
  done

  [[ "${failures}" -eq 0 ]] || die "One or more GitHub release uploads failed."
}

NOTES_TMP=$(mktemp "${TMPDIR:-/tmp}/release-notes.XXXXXX")
UNSIGNED_NOTE=""
if ! $SIGNING; then
  UNSIGNED_NOTE=$(
    cat <<'EOF'

### ⚠️ macOS: Unsigned Build

This is an unsigned build. macOS Gatekeeper will block first launch.
Run this after downloading:

```sh
xattr -cr "Kun.app"
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

cyan "Verifying created release tag matches local HEAD..."
npm run verify:manual-extension-release -- --tag "${TAG_NAME}" --version "${RELEASE_VERSION}" --tag-only \
  || die "Created release tag does not match the local checkout"

cyan "Uploading ${#ASSETS[@]} macOS asset(s) to GitHub (concurrency ${RELEASE_UPLOAD_CONCURRENCY})..."
upload_github_assets "${TAG_NAME}" "${ASSETS[@]}"

if [[ "${R2_UPLOAD}" == "true" ]]; then
  cyan "Uploading macOS asset metadata to R2 (${TAG_NAME})..."
  node "${ROOT}/scripts/publish-r2.mjs" upload --platform mac --tag "${TAG_NAME}" --channel "${RELEASE_CHANNEL}" \
    || die "R2 upload failed for macOS assets"
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
cyan "  https://github.com/KunAgent/Kun/releases/tag/${TAG_NAME}"
