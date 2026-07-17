#!/usr/bin/env python3
"""
HTML PPT Screenshot Tool

Usage:
    python3 screenshot-ppt.py [--url URL] [--output OUTPUT] [--pages PAGES]

Examples:
    python3 screenshot-ppt.py
    python3 screenshot-ppt.py --url http://localhost:5173 --output ./screenshots
    python3 screenshot-ppt.py --pages 10
"""

import argparse
import os
import sys
import subprocess
from pathlib import Path

# Script directory and project root
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent.parent.parent

# Virtual environment directory (inside scripts folder)
VENV_DIR = SCRIPT_DIR / ".venv"

# Default output directory for screenshots (relative to project root)
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "docs" / "posters" / "pages"


def is_in_venv():
    """Check if we're running inside our virtual environment."""
    # Method 1: Check sys.prefix
    try:
        venv_path = VENV_DIR.resolve()
        current_prefix = Path(sys.prefix).resolve()
        if current_prefix == venv_path:
            return True
    except:
        pass
    
    # Method 2: Check if executable path contains our venv
    try:
        exec_path = Path(sys.executable).resolve()
        venv_bin = (VENV_DIR / "bin").resolve()
        if str(exec_path).startswith(str(venv_bin)):
            return True
    except:
        pass
    
    # Method 3: Check VIRTUAL_ENV environment variable
    venv_env = os.environ.get("VIRTUAL_ENV", "")
    if venv_env:
        try:
            if Path(venv_env).resolve() == VENV_DIR.resolve():
                return True
        except:
            pass
    
    return False


def ensure_venv():
    """Ensure virtual environment exists and restart in it if needed."""
    venv_python = VENV_DIR / "bin" / "python3"
    
    # Check if we're already in the venv
    if is_in_venv():
        return  # Already in venv
    
    # Check if venv exists, create if not
    if not venv_python.exists():
        print("Creating virtual environment...")
        subprocess.check_call([sys.executable, "-m", "venv", str(VENV_DIR)])
        print(f"Virtual environment created at: {VENV_DIR}")
    
    # Re-run this script with the venv python using subprocess instead of execv
    print("Switching to virtual environment...")
    result = subprocess.run(
        [str(venv_python), str(Path(__file__).resolve())] + sys.argv[1:],
        cwd=os.getcwd()
    )
    sys.exit(result.returncode)


def check_dependencies():
    """Check and install required dependencies."""
    missing = []
    
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        missing.append("playwright")
    
    if missing:
        print(f"Installing dependencies: {', '.join(missing)}...")
        for pkg in missing:
            subprocess.check_call([sys.executable, "-m", "pip", "install", pkg, "-q"])
        
        if "playwright" in missing:
            print("Installing Playwright Chromium browser...")
            subprocess.check_call([sys.executable, "-m", "playwright", "install", "chromium"])
        
        print("Dependencies installed successfully!\n")


# Ensure we're in venv before doing anything else
ensure_venv()
check_dependencies()

from playwright.sync_api import sync_playwright


def get_total_pages(page) -> int:
    """Get total number of slides from the page indicator."""
    try:
        indicator = page.locator("#pageIndicator").text_content(timeout=5000)
        # Format: "1 / 10"
        if "/" in indicator:
            return int(indicator.split("/")[1].strip())
    except:
        pass
    
    # Fallback: count slideDataMap entries
    try:
        total = page.evaluate("() => window.slideDataMap ? window.slideDataMap.size : 0")
        if total > 0:
            return total
    except:
        pass
    
    return 0


def capture_slides(url: str, output_dir: str, total_pages: int = None) -> list:
    """Capture screenshots of all slides."""
    screenshots = []
    
    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1440, "height": 810},
            device_scale_factor=2  # High DPI for better quality
        )
        page = context.new_page()
        
        # Load first page to get total slides
        print(f"Loading {url}...")
        page.goto(f"{url}?page=1", wait_until="networkidle")
        page.wait_for_timeout(1000)  # Wait for animations
        
        if total_pages is None:
            total_pages = get_total_pages(page)
        
        if total_pages == 0:
            print("Error: Could not determine total pages. Use --pages to specify.")
            browser.close()
            return []
        
        print(f"Found {total_pages} slides\n")
        
        # Capture each slide
        for i in range(1, total_pages + 1):
            print(f"  Capturing slide {i}/{total_pages}...")
            
            page.goto(f"{url}?page={i}", wait_until="networkidle")
            page.wait_for_timeout(500)  # Wait for render
            
            # Find the viewport element and screenshot it
            viewport = page.locator("#ppt-viewport")
            screenshot_path = os.path.join(output_dir, f"page-{i}.png")
            
            try:
                viewport.screenshot(path=screenshot_path)
            except:
                # Fallback to full page screenshot with clip
                page.screenshot(
                    path=screenshot_path,
                    clip={"x": 0, "y": 0, "width": 1440, "height": 810}
                )
            
            screenshots.append(screenshot_path)
        
        browser.close()
    
    return screenshots


def main():
    parser = argparse.ArgumentParser(description="Capture screenshots of HTML PPT slides")
    parser.add_argument("--url", default="http://localhost:5173", help="PPT URL (default: http://localhost:5173)")
    parser.add_argument("--output", "-o", default=None, help="Output directory for screenshots (default: docs/posters/pages/)")
    parser.add_argument("--pages", "-p", type=int, default=None, help="Total number of pages (auto-detect if not specified)")
    
    args = parser.parse_args()
    
    # Default output directory
    output_dir = args.output if args.output else str(DEFAULT_OUTPUT_DIR)
    
    try:
        print("=" * 50)
        print("  HTML PPT Screenshot Tool")
        print("=" * 50 + "\n")
        
        # Capture screenshots
        screenshots = capture_slides(args.url, output_dir, args.pages)
        
        if not screenshots:
            print("\nNo slides captured. Make sure the dev server is running:")
            print(f"  1. Start server: cd frontend && npm run dev")
            print(f"  2. Then run this script again")
            sys.exit(1)
        
        print("\n" + "=" * 50)
        print(f"  Screenshot complete!")
        print(f"  Slides: {len(screenshots)}")
        print(f"  Output: {output_dir}/page-{{1..{len(screenshots)}}}.png")
        print("=" * 50)
        
    except Exception as e:
        print(f"\nError: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
