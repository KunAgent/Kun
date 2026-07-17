#!/bin/sh
# kdocs-cli installer — downloads the platform-specific binary to a global PATH location.
# No Node.js or Go required. Only curl/wget needed.
#
# Usage:
#   bash scripts/setup.sh
#   curl -fsSL <CDN>/setup.sh | sh
#
# Environment variables (all optional):
#   KDOCS_CLI_VERSION   — version to install (default: read from SKILL.md or "latest")
#   KDOCS_CLI_CDN       — CDN base URL override
#   KDOCS_CLI_DIR       — install directory override (default: ~/.local/bin)

set -eu

CDN_BASE="${KDOCS_CLI_CDN:-https://wpsai.wpscdn.cn/skillhub/pro}"
BIN_NAME="kdocs-cli"
INSTALL_DIR="${KDOCS_CLI_DIR:-$HOME/.local/bin}"

# ── Helpers ──────────────────────────────────────────────────────────────────

say()  { printf '  %s\n' "$@"; }
err()  { printf '  ❌ %s\n' "$@" >&2; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1; }

download() {
  url="$1"; dest="$2"
  if need_cmd curl; then
    curl -fsSL "$url" -o "$dest"
  elif need_cmd wget; then
    wget -qO "$dest" "$url"
  else
    err "Neither curl nor wget found. Please install one and retry."
  fi
}

detect_os() {
  case "$(uname -s)" in
    Linux*)  echo "linux"  ;;
    Darwin*) echo "darwin" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *) err "Unsupported OS: $(uname -s)" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)  echo "amd64" ;;
    arm64|aarch64) echo "arm64" ;;
    *) err "Unsupported architecture: $(uname -m)" ;;
  esac
}

resolve_version() {
  if [ -n "${KDOCS_CLI_VERSION:-}" ]; then
    echo "$KDOCS_CLI_VERSION"
    return
  fi
  # Try reading from nearby SKILL.md (when run from skill directory)
  script_dir="$(cd "$(dirname "$0")" 2>/dev/null && pwd || echo ".")"
  for candidate in "$script_dir/../SKILL.md" "$script_dir/../../SKILL.md" "./SKILL.md"; do
    if [ -f "$candidate" ]; then
      ver="$(sed -n 's/^version:[[:space:]]*//p' "$candidate" | head -1 | tr -d ' \r\n\"')"
      if [ -n "$ver" ]; then
        echo "$ver"
        return
      fi
    fi
  done
  err "Cannot determine version. Set KDOCS_CLI_VERSION explicitly."
}

version_ge() {
  # Returns 0 (true) if $1 >= $2 using semantic version comparison
  printf '%s\n%s\n' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n -C
}

check_existing() {
  if need_cmd "$BIN_NAME"; then
    existing_path="$(command -v "$BIN_NAME")"
    existing_ver="$("$BIN_NAME" version 2>/dev/null || echo "0.0.0")"
    if [ "$existing_ver" = "$1" ]; then
      say "${BIN_NAME} v${1} is already installed at ${existing_path}"
      say "Use '${BIN_NAME} upgrade' to check for updates."
      exit 0
    fi
    if version_ge "$existing_ver" "$1"; then
      say "Installed ${BIN_NAME} v${existing_ver} >= target v${1}, skipping."
      say "Use '${BIN_NAME} upgrade' to manage versions."
      exit 0
    fi
    say "Found existing ${BIN_NAME} v${existing_ver} at ${existing_path}"
    say "Will upgrade to v${1} in ${INSTALL_DIR}/"
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
  os="$(detect_os)"
  arch="$(detect_arch)"
  version="$(resolve_version)"

  check_existing "$version"

  if [ "$os" = "windows" ]; then
    ext=".zip"
  else
    ext=".tar.gz"
  fi

  archive_name="${BIN_NAME}-${version}-${os}-${arch}${ext}"
  download_url="${CDN_BASE}/v${version}/releases/${archive_name}"
  checksums_url="${CDN_BASE}/v${version}/releases/checksums.txt"

  say "Installing ${BIN_NAME} v${version} (${os}/${arch})..."
  say "Target: ${INSTALL_DIR}/${BIN_NAME}"

  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT INT TERM

  say "Downloading ${archive_name}..."
  download "$download_url" "$tmpdir/$archive_name"

  # SHA256 verification
  if download "$checksums_url" "$tmpdir/checksums.txt" 2>/dev/null; then
    expected="$(awk -v file="$archive_name" '$2 == file { print $1; exit }' "$tmpdir/checksums.txt")"
    if [ -n "$expected" ]; then
      actual=""
      if need_cmd sha256sum; then
        actual="$(sha256sum "$tmpdir/$archive_name" | awk '{print $1}')"
      elif need_cmd shasum; then
        actual="$(shasum -a 256 "$tmpdir/$archive_name" | awk '{print $1}')"
      fi
      if [ -n "$actual" ] && [ "$actual" != "$expected" ]; then
        err "SHA256 mismatch! Expected ${expected}, got ${actual}."
      fi
      if [ -n "$actual" ]; then
        say "SHA256 verified ✓"
      else
        say "⚠ sha256sum/shasum not found; skipping checksum verification"
      fi
    else
      say "⚠ Archive not found in checksums.txt; skipping verification"
    fi
  else
    say "⚠ Could not download checksums.txt; skipping verification"
  fi

  say "Extracting..."
  if [ "$ext" = ".tar.gz" ]; then
    tar xzf "$tmpdir/$archive_name" -C "$tmpdir"
  else
    if need_cmd unzip; then
      unzip -q "$tmpdir/$archive_name" -d "$tmpdir"
    else
      err "unzip not found; cannot extract .zip archive."
    fi
  fi

  mkdir -p "$INSTALL_DIR"
  bin_file="$(find "$tmpdir" -name "$BIN_NAME" -o -name "${BIN_NAME}.exe" | head -1)"
  if [ -z "$bin_file" ]; then
    err "Binary not found in the downloaded archive."
  fi

  cp "$bin_file" "$INSTALL_DIR/"
  chmod +x "$INSTALL_DIR/$BIN_NAME"

  # Record install source for analytics (X-Request-Source header)
  printf '%s' "aippt" > "$INSTALL_DIR/.source"

  say "✅ Installed: ${INSTALL_DIR}/${BIN_NAME}"

  # Check if install_dir is in PATH
  case ":$PATH:" in
    *":${INSTALL_DIR}:"*) ;;
    *)
      say ""
      say "⚠ ${INSTALL_DIR} is not in your PATH."
      say "  Add it with:"
      say "    export PATH=\"${INSTALL_DIR}:\$PATH\""
      say "  Or add this line to your ~/.bashrc / ~/.zshrc"
      ;;
  esac

  say ""
  say "🎉 ${BIN_NAME} v${version} ready!"
  say "  Run: ${BIN_NAME} version"
  say "  Upgrade later: ${BIN_NAME} upgrade"
}

main
