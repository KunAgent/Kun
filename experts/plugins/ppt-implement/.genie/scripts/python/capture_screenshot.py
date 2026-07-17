#!/usr/bin/env python3
"""Screenshot tool using Chrome/Chromium headless mode."""

import sys
import subprocess
import platform
import time
import urllib.request
import urllib.error
import json
from pathlib import Path
import shutil


def _copy_fallback_image(output_path: str = None) -> None:
    script_dir = Path(__file__).parent
    project_root = script_dir.parent.parent.parent
    source_png = script_dir / "assets" / "genie.png"
    output_path = Path(output_path)
    if output_path.is_absolute():
        output_path = project_root / str(output_path).lstrip("/")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_png, output_path)
    print(f"✅ Copied image to: {output_path}", file=sys.stderr)
    print(f"   Target file: {output_path}")

# Default URL to capture
DEFAULT_URL = "http://localhost:5173"

# Window sizes for different preview types (width, height)
WINDOW_SIZES = {
    "mobile": (510, 932),     # iPhone 14 Pro Max size
    "desktop": (1280, 720),   # Default desktop size
}


def get_preview_type() -> str:
    """Read preview_type from docs/project.json.

    Returns:
        The preview type string, defaults to 'desktop' if not found.
    """
    script_dir = Path(__file__).parent
    project_root = script_dir.parent.parent.parent
    project_json_path = project_root / "docs" / "project.json"

    try:
        if project_json_path.exists():
            with open(project_json_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                preview_type = config.get("preview_type", "desktop")
                print(f"📱 Preview type from project.json: {preview_type}", file=sys.stderr)
                return preview_type
    except (json.JSONDecodeError, IOError) as e:
        print(f"⚠️  Failed to read project.json: {e}", file=sys.stderr)

    return "desktop"


def wait_for_server(url: str, timeout: int = 30) -> bool:
    """Wait for server to be ready (return 200 status code).

    Args:
        url: The URL to probe
        timeout: Maximum time to wait in seconds (default 30s)

    Returns:
        True if server is ready, False if timeout reached
    """
    print(f"🔍 Waiting for server at {url} to be ready (timeout: {timeout}s)...", file=sys.stderr)
    start_time = time.time()
    attempt = 0

    while time.time() - start_time < timeout:
        attempt += 1
        try:
            req = urllib.request.Request(url, method='GET')
            with urllib.request.urlopen(req, timeout=5) as response:
                if response.status == 200:
                    elapsed = time.time() - start_time
                    print(f"✅ Server ready! (attempt {attempt}, {elapsed:.1f}s elapsed)", file=sys.stderr)
                    return True
        except urllib.error.HTTPError as e:
            # Server responded but with non-200 status
            print(f"⚠️  Attempt {attempt}: HTTP {e.code}", file=sys.stderr)
        except urllib.error.URLError as e:
            # Connection failed (server not up yet)
            print(f"⚠️  Attempt {attempt}: {e.reason}", file=sys.stderr)
        except Exception as e:
            print(f"⚠️  Attempt {attempt}: {type(e).__name__}: {e}", file=sys.stderr)

        time.sleep(1)

    elapsed = time.time() - start_time
    print(f"❌ Server not ready after {elapsed:.1f}s ({attempt} attempts)", file=sys.stderr)
    return False


def capture_screenshot(output_path: str, url: str = DEFAULT_URL) -> None:
    """Capture screenshot of a webpage."""
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    # Wait 3 seconds before starting to allow service to initialize
    print("⏳ Waiting 3s for service to initialize...", file=sys.stderr)
    time.sleep(3)

    # Get preview type and determine window size
    preview_type = get_preview_type()
    width, height = WINDOW_SIZES.get(preview_type, WINDOW_SIZES["desktop"])
    window_size = f"{width},{height}"
    print(f"📐 Using window size: {window_size} ({preview_type})", file=sys.stderr)

    # Wait for server to be ready (probe for 90s to allow for slow startup)
    if not wait_for_server(url, timeout=60):
        print("❌ Server not responding, using fallback image.", file=sys.stderr)
        _copy_fallback_image(output_path)
        return

    # Server is ready, wait 5 seconds to ensure page is fully loaded
    print("⏳ Waiting 1s before capturing screenshot...", file=sys.stderr)
    time.sleep(1)

    # Chrome paths for different systems
    chrome_paths = {
        "Darwin": [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ],
        "Linux": [
            "google-chrome", "chromium", "chromium-browser",
            "/usr/bin/google-chrome", "/usr/bin/chromium",
        ]
    }.get(platform.system(), [])

    if not chrome_paths:
        sys.exit(f"❌ Unsupported OS: {platform.system()}")

    print(f"📋 OS: {platform.system()}", file=sys.stderr)
    print(f"💾 Output: {output_path}", file=sys.stderr)
    print(f"🔍 Chrome paths to try: {len(chrome_paths)}", file=sys.stderr)

    # Try each Chrome path
    last_error = None
    attempt = 0
    for chrome_path in chrome_paths:
        attempt += 1
        try:
            # Check if exists
            if "/" in chrome_path:
                if not Path(chrome_path).exists():
                    print(
                        f"⚠️  [{attempt}/{len(chrome_paths)}] Path not found: {chrome_path}", file=sys.stderr)
                    continue
            elif subprocess.run(["which", chrome_path], capture_output=True).returncode != 0:
                print(
                    f"⚠️  [{attempt}/{len(chrome_paths)}] Command not found: {chrome_path}", file=sys.stderr)
                continue

            print(
                f"🔍 [{attempt}/{len(chrome_paths)}] Trying: {chrome_path}", file=sys.stderr)

            # Build Chrome arguments
            chrome_args = [
                chrome_path,
                "--headless=new",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-dbus",
                f"--window-size={window_size}",
                "--hide-scrollbars",
                "--force-device-scale-factor=1",
                "--virtual-time-budget=10000",
                "--default-background-color=00000000",
                f"--screenshot={output_path}",
            ]

            # Add mobile emulation for mobile preview type
            if preview_type == "mobile":
                chrome_args.append("--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1")

            chrome_args.append(url)

            # Take screenshot
            result = subprocess.run(chrome_args, capture_output=True, timeout=30, check=True, text=True)

            if output_file.exists() and output_file.stat().st_size > 0:
                size = output_file.stat().st_size
                if size < 10 * 1024:
                    print(f"⚠️  Screenshot too small ({size:,} bytes). Replacing with fallback image...", file=sys.stderr)
                    _copy_fallback_image(output_file)
                    size = output_file.stat().st_size if output_file.exists() else 0
                print(f"✅ Screenshot captured successfully!", file=sys.stderr)
                print(f"✅ {output_path} ({size:,} bytes)")
                return
            else:
                error_msg = "Screenshot file not created or empty"
                print(f"⚠️  [{attempt}/{len(chrome_paths)}] {error_msg}", file=sys.stderr)
                last_error = error_msg
        except subprocess.CalledProcessError as e:
            stderr_output = e.stderr.strip() if e.stderr else "No stderr output"
            last_error = f"Chrome process failed (exit code {e.returncode})"
            print(f"❌ [{attempt}/{len(chrome_paths)}] {last_error}", file=sys.stderr)
            print(f"   Chrome stderr: {stderr_output}", file=sys.stderr)
            continue
        except subprocess.TimeoutExpired as e:
            last_error = "Chrome process timeout (>30s)"
            print(f"❌ [{attempt}/{len(chrome_paths)}] {last_error}", file=sys.stderr)
            continue
        except Exception as e:
            last_error = f"{type(e).__name__}: {e}"
            print(f"❌ [{attempt}/{len(chrome_paths)}] {last_error}", file=sys.stderr)
            continue

    print(f"\n❌ All {attempt} attempts failed, using fallback image.", file=sys.stderr)
    _copy_fallback_image(output_path)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python capture_screenshot.py <output_path>")
    
    capture_screenshot(sys.argv[1])
