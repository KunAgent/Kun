#!/usr/bin/env python3
"""
Canvas Design - Font Downloader (Multi-source with China CDN support)

Downloads all required fonts on-demand with multi-source fallback:
  1. Google Fonts CSS API via China mirror (fonts.googleapis.cn -> fonts.gstatic.cn)
  2. Google Fonts CSS API via international (fonts.googleapis.com -> fonts.gstatic.com)
  3. GitHub google/fonts repo direct download

All 29 font families are covered. Variable fonts are used where available
(one file covers all weights); static fonts where no variable version exists.

Usage:
  python download-fonts.py              # Download all fonts
  python download-fonts.py --list       # List available fonts
  python download-fonts.py Lora.ttf     # Download specific font(s)
"""

import os
import sys
import re
import urllib.request
import urllib.error
from pathlib import Path

FONT_DIR = Path(__file__).parent
GITHUB_BASE = "https://github.com/google/fonts/raw/main/ofl"

# Chrome User-Agent triggers TTF response from Google Fonts CSS API
CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

# ============================================================
# Google Fonts CSS API query parameters for each font family
# Format: (css_family_spec, local_filename)
#   css_family_spec: used in ?family= parameter
#   For variable fonts: specify weight range e.g. "Lora:wght@100..900"
#   For static fonts: specify exact weight e.g. "DM+Mono"
# ============================================================

# Fonts that can be fetched via Google Fonts CSS API (27 of 29 families)
GFONTS_CSS = {
    # local_filename: (css_family_query, description)
    # --- Variable fonts (one file, all weights) ---
    "BigShouldersDisplay.ttf": ("Big+Shoulders+Display:wght@100..900", "display, wide"),
    "BricolageGrotesque.ttf": ("Bricolage+Grotesque:opsz,wght@12..96,200..800", "sans-serif"),
    "CrimsonPro.ttf": ("Crimson+Pro:wght@200..900", "serif, elegant"),
    "CrimsonPro-Italic.ttf": ("Crimson+Pro:ital,wght@1,200..900", "serif italic"),
    "GeistMono.ttf": ("Geist+Mono:wght@100..900", "monospace, Vercel"),
    "InstrumentSans.ttf": ("Instrument+Sans:wdth,wght@75..100,400..700", "sans-serif"),
    "InstrumentSans-Italic.ttf": ("Instrument+Sans:ital,wdth,wght@1,75..100,400..700", "sans-serif italic"),
    "JetBrainsMono.ttf": ("JetBrains+Mono:wght@100..800", "monospace, coding"),
    "Jura.ttf": ("Jura:wght@300..700", "sans-serif, futuristic"),
    "LibreBaskerville.ttf": ("Libre+Baskerville:wght@400..700", "serif, classic"),
    "Lora.ttf": ("Lora:wght@400..700", "serif, calligraphic"),
    "Lora-Italic.ttf": ("Lora:ital,wght@1,400..700", "serif italic"),
    "NationalPark.ttf": ("National+Park:wght@100..900", "display, nature"),
    "Outfit.ttf": ("Outfit:wght@100..900", "sans-serif, geometric"),
    "PixelifySans.ttf": ("Pixelify+Sans:wght@400..700", "pixel, retro"),
    "RedHatMono.ttf": ("Red+Hat+Mono:wght@300..700", "monospace"),
    "SmoochSans.ttf": ("Smooch+Sans:wght@100..900", "sans-serif, soft"),
    "Tektur.ttf": ("Tektur:wdth,wght@75..100,400..900", "sans-serif, tech"),
    "WorkSans.ttf": ("Work+Sans:wght@100..900", "sans-serif, versatile"),
    "WorkSans-Italic.ttf": ("Work+Sans:ital,wght@1,100..900", "sans-serif italic"),
    # --- Static fonts (single weight, no variable) ---
    "ArsenalSC-Regular.ttf": ("Arsenal+SC", "serif, multilingual"),
    "Boldonse-Regular.ttf": ("Boldonse", "display, bold"),
    "DMMono-Regular.ttf": ("DM+Mono", "monospace"),
    "EricaOne-Regular.ttf": ("Erica+One", "display, heavy"),
    "Gloock-Regular.ttf": ("Gloock", "serif, display"),
    "Italiana-Regular.ttf": ("Italiana", "serif, display"),
    "NothingYouCouldDo.ttf": ("Nothing+You+Could+Do", "handwriting"),
    "PoiretOne-Regular.ttf": ("Poiret+One", "display, Art Deco"),
    "Silkscreen-Regular.ttf": ("Silkscreen", "pixel, retro"),
    "YoungSerif-Regular.ttf": ("Young+Serif", "serif, retro"),
    # --- Static fonts from IBM (multiple variants, not on CSS with variable) ---
    "IBMPlexMono-Regular.ttf": ("IBM+Plex+Mono", "monospace, IBM"),
    "IBMPlexMono-Bold.ttf": ("IBM+Plex+Mono:wght@700", "monospace bold"),
    "IBMPlexSerif-Regular.ttf": ("IBM+Plex+Serif", "serif, IBM"),
    "IBMPlexSerif-Bold.ttf": ("IBM+Plex+Serif:wght@700", "serif bold"),
    "IBMPlexSerif-Italic.ttf": ("IBM+Plex+Serif:ital@1", "serif italic"),
    "IBMPlexSerif-BoldItalic.ttf": ("IBM+Plex+Serif:ital,wght@1,700", "serif bold italic"),
    "InstrumentSerif-Regular.ttf": ("Instrument+Serif", "serif, elegant"),
    "InstrumentSerif-Italic.ttf": ("Instrument+Serif:ital@1", "serif italic"),
}

# GitHub direct download URLs (fallback)
GITHUB_URLS = {
    "ArsenalSC-Regular.ttf": f"{GITHUB_BASE}/arsenalsc/ArsenalSC-Regular.ttf",
    "BigShouldersDisplay.ttf": f"{GITHUB_BASE}/bigshouldersdisplay/BigShouldersDisplay%5Bwght%5D.ttf",
    "Boldonse-Regular.ttf": f"{GITHUB_BASE}/boldonse/Boldonse-Regular.ttf",
    "BricolageGrotesque.ttf": f"{GITHUB_BASE}/bricolagegrotesque/BricolageGrotesque%5Bopsz%2Cwdth%2Cwght%5D.ttf",
    "CrimsonPro.ttf": f"{GITHUB_BASE}/crimsonpro/CrimsonPro%5Bwght%5D.ttf",
    "CrimsonPro-Italic.ttf": f"{GITHUB_BASE}/crimsonpro/CrimsonPro-Italic%5Bwght%5D.ttf",
    "DMMono-Regular.ttf": f"{GITHUB_BASE}/dmmono/DMMono-Regular.ttf",
    "EricaOne-Regular.ttf": f"{GITHUB_BASE}/ericaone/EricaOne-Regular.ttf",
    "GeistMono.ttf": f"{GITHUB_BASE}/geistmono/GeistMono%5Bwght%5D.ttf",
    "Gloock-Regular.ttf": f"{GITHUB_BASE}/gloock/Gloock-Regular.ttf",
    "IBMPlexMono-Regular.ttf": f"{GITHUB_BASE}/ibmplexmono/IBMPlexMono-Regular.ttf",
    "IBMPlexMono-Bold.ttf": f"{GITHUB_BASE}/ibmplexmono/IBMPlexMono-Bold.ttf",
    "IBMPlexSerif-Regular.ttf": f"{GITHUB_BASE}/ibmplexserif/IBMPlexSerif-Regular.ttf",
    "IBMPlexSerif-Bold.ttf": f"{GITHUB_BASE}/ibmplexserif/IBMPlexSerif-Bold.ttf",
    "IBMPlexSerif-Italic.ttf": f"{GITHUB_BASE}/ibmplexserif/IBMPlexSerif-Italic.ttf",
    "IBMPlexSerif-BoldItalic.ttf": f"{GITHUB_BASE}/ibmplexserif/IBMPlexSerif-BoldItalic.ttf",
    "InstrumentSans.ttf": f"{GITHUB_BASE}/instrumentsans/InstrumentSans%5Bwdth%2Cwght%5D.ttf",
    "InstrumentSans-Italic.ttf": f"{GITHUB_BASE}/instrumentsans/InstrumentSans-Italic%5Bwdth%2Cwght%5D.ttf",
    "InstrumentSerif-Regular.ttf": f"{GITHUB_BASE}/instrumentserif/InstrumentSerif-Regular.ttf",
    "InstrumentSerif-Italic.ttf": f"{GITHUB_BASE}/instrumentserif/InstrumentSerif-Italic.ttf",
    "Italiana-Regular.ttf": f"{GITHUB_BASE}/italiana/Italiana-Regular.ttf",
    "JetBrainsMono.ttf": f"{GITHUB_BASE}/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf",
    "Jura.ttf": f"{GITHUB_BASE}/jura/Jura%5Bwght%5D.ttf",
    "LibreBaskerville.ttf": f"{GITHUB_BASE}/librebaskerville/LibreBaskerville%5Bwght%5D.ttf",
    "Lora.ttf": f"{GITHUB_BASE}/lora/Lora%5Bwght%5D.ttf",
    "Lora-Italic.ttf": f"{GITHUB_BASE}/lora/Lora-Italic%5Bwght%5D.ttf",
    "NationalPark.ttf": f"{GITHUB_BASE}/nationalpark/NationalPark%5Bwght%5D.ttf",
    "NothingYouCouldDo.ttf": f"{GITHUB_BASE}/nothingyoucoulddo/NothingYouCouldDo.ttf",
    "Outfit.ttf": f"{GITHUB_BASE}/outfit/Outfit%5Bwght%5D.ttf",
    "PixelifySans.ttf": f"{GITHUB_BASE}/pixelifysans/PixelifySans%5Bwght%5D.ttf",
    "PoiretOne-Regular.ttf": f"{GITHUB_BASE}/poiretone/PoiretOne-Regular.ttf",
    "RedHatMono.ttf": f"{GITHUB_BASE}/redhatmono/RedHatMono%5Bwght%5D.ttf",
    "Silkscreen-Regular.ttf": f"{GITHUB_BASE}/silkscreen/Silkscreen-Regular.ttf",
    "SmoochSans.ttf": f"{GITHUB_BASE}/smoochsans/SmoochSans%5Bwght%5D.ttf",
    "Tektur.ttf": f"{GITHUB_BASE}/tektur/Tektur%5Bwdth%2Cwght%5D.ttf",
    "WorkSans.ttf": f"{GITHUB_BASE}/worksans/WorkSans%5Bwght%5D.ttf",
    "WorkSans-Italic.ttf": f"{GITHUB_BASE}/worksans/WorkSans-Italic%5Bwght%5D.ttf",
    "YoungSerif-Regular.ttf": f"{GITHUB_BASE}/youngserif/YoungSerif-Regular.ttf",
}


def _fetch(url, ua=CHROME_UA, timeout=20):
    """Fetch URL content. Returns bytes or None."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": ua})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except (urllib.error.URLError, OSError, TimeoutError):
        return None


def download_via_css_api(family_query, api_host, gstatic_host):
    """
    Download font via Google Fonts CSS API.
    1. Request CSS from api_host
    2. Parse out .ttf URL from gstatic_host
    3. Download the TTF file
    Returns bytes or None.
    """
    css_url = f"https://{api_host}/css2?family={family_query}"
    css_data = _fetch(css_url)
    if not css_data:
        return None

    css_text = css_data.decode("utf-8", errors="replace")

    # Extract .ttf URLs from CSS @font-face rules
    ttf_urls = re.findall(r'url\((https://[^)]+\.ttf)\)', css_text)
    if not ttf_urls:
        # Some responses use gstatic URL without .ttf extension
        all_urls = re.findall(r'url\((https://[^)]+)\)', css_text)
        ttf_urls = [u for u in all_urls if gstatic_host in u]

    if not ttf_urls:
        return None

    # Download the first TTF URL
    font_data = _fetch(ttf_urls[0])
    if font_data and len(font_data) > 1000:
        return font_data
    return None


def download_font(filename):
    """
    Download a single font with multi-source fallback.
    Returns: "ok", "cached", or "failed"
    """
    target = FONT_DIR / filename
    if target.exists() and target.stat().st_size > 1000:
        return "cached"

    css_query = GFONTS_CSS.get(filename)
    github_url = GITHUB_URLS.get(filename)

    # Source 1: Google Fonts CSS API via China mirror
    if css_query:
        data = download_via_css_api(css_query[0], "fonts.googleapis.cn", "fonts.gstatic.cn")
        if data:
            target.write_bytes(data)
            return "ok"

    # Source 2: Google Fonts CSS API via international
    if css_query:
        data = download_via_css_api(css_query[0], "fonts.googleapis.com", "fonts.gstatic.com")
        if data:
            target.write_bytes(data)
            return "ok"

    # Source 3: GitHub direct download
    if github_url:
        data = _fetch(github_url, timeout=30)
        if data and len(data) > 1000:
            target.write_bytes(data)
            return "ok"

    return "failed"


def main():
    FONT_DIR.mkdir(parents=True, exist_ok=True)

    if "--list" in sys.argv:
        print("Available fonts (38 files, 29 families):")
        for name in sorted(GFONTS_CSS.keys()):
            desc = GFONTS_CSS[name][1]
            print(f"  {name:40s} ({desc})")
        return 0

    if len(sys.argv) > 1 and sys.argv[1] != "--list":
        names = [a for a in sys.argv[1:] if not a.startswith("-")]
        to_download = [n for n in names if n in GFONTS_CSS]
        if not to_download:
            print("No matching fonts. Use --list to see available fonts.")
            return 1
    else:
        to_download = list(GFONTS_CSS.keys())

    total = len(to_download)
    results = {"ok": 0, "cached": 0, "failed": 0}
    failed = []

    print(f"Downloading {total} font files to {FONT_DIR} ...")
    print(f"  Sources: fonts.gstatic.cn (China) > fonts.gstatic.com > GitHub\n")

    for i, filename in enumerate(to_download, 1):
        print(f"  [{i}/{total}] {filename:40s} ", end="", flush=True)
        status = download_font(filename)
        results[status] += 1
        if status == "failed":
            failed.append(filename)
        print(status.upper())

    ok = results["ok"]
    cached = results["cached"]
    fail = results["failed"]
    print(f"\nDone: {ok} downloaded, {cached} cached, {fail} failed (total {total})")
    if failed:
        print(f"Failed: {', '.join(failed)}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
