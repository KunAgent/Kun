#!/usr/bin/env python3
"""Aviation weather fetcher - METAR, TAF, and PIREPs from aviationweather.gov"""

import argparse
import json
import sys
from urllib.request import urlopen
from urllib.error import URLError
from datetime import datetime

BASE_URL = "https://aviationweather.gov/api/data"

def fetch_metar(stations: list[str], hours: int = 2) -> list[dict]:
    """Fetch METAR data for given stations."""
    ids = ",".join(s.upper() for s in stations)
    url = f"{BASE_URL}/metar?ids={ids}&format=json&hours={hours}"
    try:
        with urlopen(url, timeout=10) as resp:
            return json.loads(resp.read())
    except URLError as e:
        print(f"Error fetching METAR: {e}", file=sys.stderr)
        return []

def fetch_taf(stations: list[str]) -> list[dict]:
    """Fetch TAF data for given stations."""
    ids = ",".join(s.upper() for s in stations)
    url = f"{BASE_URL}/taf?ids={ids}&format=json"
    try:
        with urlopen(url, timeout=10) as resp:
            return json.loads(resp.read())
    except URLError as e:
        print(f"Error fetching TAF: {e}", file=sys.stderr)
        return []

def fetch_pireps(lat: float, lon: float, radius: int = 100) -> list[dict]:
    """Fetch PIREPs within a bounding box around lat/lon."""
    # Create bounding box roughly matching the radius (1 degree ~ 60nm)
    delta = radius / 60
    bbox = f"{lon-delta},{lat-delta},{lon+delta},{lat+delta}"
    url = f"{BASE_URL}/pirep?format=json&bbox={bbox}"
    try:
        with urlopen(url, timeout=10) as resp:
            content = resp.read()
            if not content:
                return []
            return json.loads(content)
    except URLError as e:
        print(f"Error fetching PIREPs: {e}", file=sys.stderr)
        return []

def decode_flight_category(cat: str) -> str:
    """Return emoji + description for flight category."""
    categories = {
        "VFR": "🟢 VFR",
        "MVFR": "🔵 MVFR", 
        "IFR": "🔴 IFR",
        "LIFR": "🟣 LIFR"
    }
    return categories.get(cat, cat)

def format_metar(data: list[dict], verbose: bool = False) -> str:
    """Format METAR data for display."""
    if not data:
        return "No METAR data available."
    
    lines = []
    for m in data:
        station = m.get("icaoId", "????")
        raw = m.get("rawOb", "")
        cat = decode_flight_category(m.get("fltCat", ""))
        
        # Basic info
        temp = m.get("temp")
        dewp = m.get("dewp")
        wdir = m.get("wdir")
        wspd = m.get("wspd")
        vis = m.get("visib")
        alt = m.get("altim")
        
        header = f"**{station}** {cat}"
        
        details = []
        if temp is not None and dewp is not None:
            details.append(f"Temp: {temp}°C / Dewpoint: {dewp}°C")
        if wdir is not None and wspd is not None:
            wdir_str = "VRB" if wdir == "VRB" else f"{wdir:03d}°"
            details.append(f"Wind: {wdir_str} @ {wspd}kt")
        if vis is not None:
            details.append(f"Vis: {vis}sm")
        if alt is not None:
            details.append(f"Altimeter: {alt:.2f}")
        
        lines.append(header)
        if verbose:
            lines.append(f"  {raw}")
        lines.append("  " + " | ".join(details))
        lines.append("")
    
    return "\n".join(lines)

def format_taf(data: list[dict], verbose: bool = False) -> str:
    """Format TAF data for display."""
    if not data:
        return "No TAF data available."
    
    lines = []
    for t in data:
        station = t.get("icaoId", "????")
        raw = t.get("rawTAF", "")
        
        lines.append(f"**{station} TAF**")
        if verbose:
            lines.append(f"  {raw}")
        else:
            # Just show raw TAF, it's most useful
            lines.append(f"  {raw}")
        lines.append("")
    
    return "\n".join(lines)

def format_pireps(data: list[dict]) -> str:
    """Format PIREP data for display."""
    if not data:
        return "No PIREPs in the area."
    
    lines = ["**Pilot Reports:**"]
    for p in data:
        raw = p.get("rawOb", "")
        lines.append(f"  • {raw}")
    
    return "\n".join(lines)

def main():
    parser = argparse.ArgumentParser(description="Fetch aviation weather data")
    parser.add_argument("stations", nargs="*", help="ICAO station IDs (e.g., KLAX KSMO)")
    parser.add_argument("--metar", "-m", action="store_true", help="Fetch METAR (default if no flags)")
    parser.add_argument("--taf", "-t", action="store_true", help="Fetch TAF")
    parser.add_argument("--pirep", "-p", action="store_true", help="Fetch PIREPs (requires --lat/--lon)")
    parser.add_argument("--lat", type=float, help="Latitude for PIREP search")
    parser.add_argument("--lon", type=float, help="Longitude for PIREP search")
    parser.add_argument("--radius", type=int, default=100, help="PIREP search radius in nm (default: 100)")
    parser.add_argument("--hours", type=int, default=2, help="Hours of METAR history (default: 2)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show raw observations")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    
    args = parser.parse_args()
    
    # Default to METAR if no flags
    if not args.metar and not args.taf and not args.pirep:
        args.metar = True
    
    # Default stations for Santa Monica area
    if not args.stations and (args.metar or args.taf):
        args.stations = ["KSMO", "KLAX", "KVNY"]
        print("Using default stations: KSMO, KLAX, KVNY\n")
    
    output = []
    
    if args.metar and args.stations:
        data = fetch_metar(args.stations, args.hours)
        if args.json:
            print(json.dumps(data, indent=2))
        else:
            output.append(format_metar(data, args.verbose))
    
    if args.taf and args.stations:
        data = fetch_taf(args.stations)
        if args.json:
            print(json.dumps(data, indent=2))
        else:
            output.append(format_taf(data, args.verbose))
    
    if args.pirep:
        lat = args.lat or 34.0158  # Default: Santa Monica
        lon = args.lon or -118.4513
        data = fetch_pireps(lat, lon, args.radius)
        if args.json:
            print(json.dumps(data, indent=2))
        else:
            output.append(format_pireps(data))
    
    if not args.json:
        print("\n".join(output))

if __name__ == "__main__":
    main()
