#!/usr/bin/env bash
# html-ppt :: render.sh — headless Chrome screenshot(s)
#
# Usage:
#   render.sh <html-file>                     # one PNG, slide 1
#   render.sh <html-file> <N>                 # N PNGs, slides 1..N, via #/k
#   render.sh <html-file> all                 # autodetect .slide count
#   render.sh <html-file> <N> <out-dir>       # custom output dir
#
# Requires: Chrome / Chromium / Edge. Set CHROME=/path/to/browser to override auto-detection.

set -euo pipefail

find_chrome() {
  if [[ -n "${CHROME:-}" && -x "$CHROME" ]]; then
    echo "$CHROME"
    return 0
  fi

  local candidates=(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
    "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
    "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe"
    "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  )

  local cmd
  for cmd in google-chrome google-chrome-stable chromium chromium-browser chrome msedge microsoft-edge; do
    if command -v "$cmd" >/dev/null 2>&1; then
      command -v "$cmd"
      return 0
    fi
  done

  local path
  for path in "${candidates[@]}"; do
    if [[ -x "$path" ]]; then
      echo "$path"
      return 0
    fi
  done

  return 1
}

CHROME="$(find_chrome || true)"
if [[ -z "$CHROME" ]]; then
  echo "error: Chrome/Chromium/Edge not found. Set CHROME=/path/to/browser and retry." >&2
  exit 1
fi

FILE="${1:-}"
if [[ -z "$FILE" ]]; then
  echo "usage: render.sh <html> [N|all] [out-dir]" >&2
  exit 1
fi
if [[ ! -f "$FILE" ]]; then
  echo "error: $FILE not found" >&2
  exit 1
fi

COUNT="${2:-1}"
OUT="${3:-}"

ABS="$(cd "$(dirname "$FILE")" && pwd)/$(basename "$FILE")"
STEM="$(basename "${FILE%.*}")"

if [[ "$COUNT" == "all" ]]; then
  COUNT="$(grep -c 'class="slide"' "$FILE" || true)"
  [[ -z "$COUNT" || "$COUNT" -lt 1 ]] && COUNT=1
fi

if [[ -z "$OUT" ]]; then
  if [[ "$COUNT" -gt 1 ]]; then
    OUT="$(dirname "$FILE")/${STEM}-png"
    mkdir -p "$OUT"
  fi
fi

render_one() {
  local url="$1" target="$2"
  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --hide-scrollbars \
    --no-sandbox \
    --virtual-time-budget=4000 \
    --window-size=1920,1080 \
    --screenshot="$target" \
    "$url" >/dev/null 2>&1
  echo "  ✔ $target"
}

if [[ "$COUNT" == "1" ]]; then
  OUT_FILE="${OUT:-$(dirname "$FILE")/${STEM}.png}"
  render_one "file://$ABS" "$OUT_FILE"
else
  for i in $(seq 1 "$COUNT"); do
    render_one "file://$ABS#/$i" "$OUT/${STEM}_$(printf '%02d' "$i").png"
  done
fi

echo "done: rendered $COUNT slide(s) from $FILE"
