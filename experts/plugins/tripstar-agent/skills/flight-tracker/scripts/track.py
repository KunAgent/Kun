#!/usr/bin/env python3
"""
Simple flight tracker using OpenSky Network API
Usage: 
    python3 track.py --region switzerland
    python3 track.py --callsign SWR123
    python3 track.py --icao <aircraft-code>
"""
import sys
import json
import urllib.request
import urllib.parse
from datetime import datetime

# Pre-defined regions (lat_min, lon_min, lat_max, lon_max)
REGIONS = {
    'switzerland': (45.8, 5.9, 47.8, 10.5),
    'zurich': (47.3, 8.4, 47.5, 8.7),
    'geneva': (46.1, 6.0, 46.3, 6.3),
    'europe': (35.0, -10.0, 70.0, 40.0),
}

def format_altitude(alt_meters):
    """Convert meters to feet and format"""
    if alt_meters is None:
        return "N/A"
    feet = int(alt_meters * 3.28084)
    return f"{feet:,} ft ({int(alt_meters)}m)"

def format_speed(speed_ms):
    """Convert m/s to km/h and knots"""
    if speed_ms is None:
        return "N/A"
    kmh = int(speed_ms * 3.6)
    knots = int(speed_ms * 1.94384)
    return f"{kmh} km/h ({knots} kts)"

def format_heading(heading):
    """Format heading with cardinal direction"""
    if heading is None:
        return "N/A"
    
    directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    idx = int((heading + 22.5) / 45) % 8
    return f"{int(heading)}° {directions[idx]}"

def get_flights(region=None, callsign=None, icao24=None):
    """Query OpenSky Network API"""
    base_url = "https://opensky-network.org/api/states/all"
    params = {}
    
    if region and region in REGIONS:
        lamin, lomin, lamax, lomax = REGIONS[region]
        params = {
            'lamin': lamin,
            'lomin': lomin,
            'lamax': lamax,
            'lomax': lomax
        }
    elif icao24:
        params['icao24'] = icao24
    
    url = f"{base_url}?{urllib.parse.urlencode(params)}" if params else base_url
    
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            data = json.loads(response.read())
            return data
    except urllib.error.HTTPError as e:
        print(f"HTTP Error {e.code}: {e.reason}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

def print_flights(data, callsign_filter=None):
    """Print flight data in readable format"""
    states = data.get('states', [])
    
    if not states:
        print("No flights found.")
        return
    
    # Filter by callsign if specified
    if callsign_filter:
        states = [s for s in states if s[1] and callsign_filter.upper() in s[1].strip().upper()]
    
    if not states:
        print(f"No flights matching callsign '{callsign_filter}' found.")
        return
    
    timestamp = data.get('time', 0)
    dt = datetime.fromtimestamp(timestamp)
    
    print(f"\n✈️  Flight Tracker - {dt.strftime('%Y-%m-%d %H:%M:%S')} UTC")
    print(f"📊 Found {len(states)} flight(s)\n")
    print("=" * 100)
    
    for state in states:
        icao24 = state[0]
        callsign = (state[1] or 'N/A').strip()
        country = state[2] or 'Unknown'
        altitude = format_altitude(state[7])
        velocity = format_speed(state[9])
        heading = format_heading(state[10])
        vertical_rate = state[11]
        on_ground = state[8]
        
        # Climb/descent indicator
        climb = ""
        if vertical_rate:
            if vertical_rate > 0.5:
                climb = "↗️ Climbing"
            elif vertical_rate < -0.5:
                climb = "↘️ Descending"
            else:
                climb = "→ Level"
        
        status = "🛬 On Ground" if on_ground else "✈️  In Flight"
        
        print(f"\n{callsign:12} | {country:20} | {status}")
        print(f"  ICAO24:    {icao24}")
        print(f"  Altitude:  {altitude}")
        print(f"  Speed:     {velocity}")
        print(f"  Heading:   {heading}")
        if climb:
            print(f"  Status:    {climb}")
    
    print("\n" + "=" * 100)

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Track flights using OpenSky Network')
    parser.add_argument('--region', choices=list(REGIONS.keys()), 
                       help='Track flights in a region')
    parser.add_argument('--callsign', help='Filter by callsign (e.g., SWR123)')
    parser.add_argument('--icao', help='Track specific aircraft by ICAO24 code')
    
    args = parser.parse_args()
    
    if not any([args.region, args.callsign, args.icao]):
        print("Usage: python3 track.py --region switzerland")
        print("       python3 track.py --callsign SWR123")
        print("       python3 track.py --icao <icao24-code>")
        print(f"\nAvailable regions: {', '.join(REGIONS.keys())}")
        sys.exit(1)
    
    # Get flight data
    data = get_flights(
        region=args.region,
        icao24=args.icao
    )
    
    # Print results
    print_flights(data, callsign_filter=args.callsign)

if __name__ == '__main__':
    main()
