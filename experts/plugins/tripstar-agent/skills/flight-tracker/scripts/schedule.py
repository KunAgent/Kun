#!/usr/bin/env python3
"""
Flight schedule checker - find scheduled flights between airports
Usage: 
    python3 schedule.py HAM ZRH
    python3 schedule.py --from HAM --to ZRH --date 2026-01-15
"""
import sys
import json
import urllib.request
import urllib.parse
from datetime import datetime, timedelta

# Airport codes mapping (IATA)
AIRPORTS = {
    'ZRH': 'Zurich',
    'HAM': 'Hamburg',
    'GVA': 'Geneva',
    'BSL': 'Basel',
    'BRN': 'Bern',
    'LUG': 'Lugano',
    'FRA': 'Frankfurt',
    'MUC': 'Munich',
    'BER': 'Berlin',
    'LHR': 'London Heathrow',
    'CDG': 'Paris CDG',
    'AMS': 'Amsterdam',
    'VIE': 'Vienna',
    'FCO': 'Rome',
    'BCN': 'Barcelona',
    'MAD': 'Madrid',
}

def format_time(time_str):
    """Format time from ISO or other formats"""
    try:
        if 'T' in time_str:
            dt = datetime.fromisoformat(time_str.replace('Z', '+00:00'))
            return dt.strftime('%H:%M')
        return time_str
    except:
        return time_str

def get_aviationstack_schedule(origin, dest, api_key, date=None):
    """Query AviationStack API for flight schedules (requires API key)"""
    base_url = "http://api.aviationstack.com/v1/flights"
    
    params = {
        'access_key': api_key,
        'dep_iata': origin,
        'arr_iata': dest,
    }
    
    if date:
        params['flight_date'] = date
    
    url = f"{base_url}?{urllib.parse.urlencode(params)}"
    
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            data = json.loads(response.read())
            return data
    except Exception as e:
        print(f"API Error: {e}", file=sys.stderr)
        return None

def print_aviationstack_results(data, origin, dest):
    """Print AviationStack flight results"""
    if not data or 'data' not in data:
        print("No flight data available.")
        return
    
    flights = data['data']
    
    if not flights:
        print(f"No scheduled flights found from {origin} to {dest}.")
        return
    
    origin_name = AIRPORTS.get(origin, origin)
    dest_name = AIRPORTS.get(dest, dest)
    
    print(f"\n✈️  Flight Schedule: {origin_name} ({origin}) → {dest_name} ({dest})")
    print(f"📊 Found {len(flights)} flight(s)\n")
    print("=" * 100)
    
    for flight in flights:
        flight_number = flight.get('flight', {}).get('number', 'N/A')
        airline = flight.get('airline', {}).get('name', 'Unknown')
        
        dep_time = flight.get('departure', {}).get('scheduled', 'N/A')
        arr_time = flight.get('arrival', {}).get('scheduled', 'N/A')
        
        dep_terminal = flight.get('departure', {}).get('terminal', '')
        dep_gate = flight.get('departure', {}).get('gate', '')
        arr_terminal = flight.get('arrival', {}).get('terminal', '')
        
        status = flight.get('flight_status', 'scheduled')
        
        print(f"\n{airline} {flight_number}")
        print(f"  Departure: {format_time(dep_time)}", end='')
        if dep_terminal:
            print(f" (Terminal {dep_terminal}", end='')
            if dep_gate:
                print(f", Gate {dep_gate}", end='')
            print(")", end='')
        print()
        
        print(f"  Arrival:   {format_time(arr_time)}", end='')
        if arr_terminal:
            print(f" (Terminal {arr_terminal})", end='')
        print()
        
        print(f"  Status:    {status.title()}")
    
    print("\n" + "=" * 100)

def show_manual_options(origin, dest, date=None):
    """Show manual search options when no API key available"""
    origin_name = AIRPORTS.get(origin, origin)
    dest_name = AIRPORTS.get(dest, dest)
    
    today = datetime.now().strftime('%Y-%m-%d') if not date else date
    
    print(f"\n✈️  Flight Schedule Search: {origin_name} ({origin}) → {dest_name} ({dest})")
    print(f"📅 Date: {today}\n")
    print("=" * 100)
    print("\n⚠️  No API key configured. Use these resources:\n")
    
    # Google Flights URL
    google_url = f"https://www.google.com/travel/flights?q=Flights%20from%20{origin}%20to%20{dest}%20on%20{today}"
    print(f"🔍 Google Flights:")
    print(f"   {google_url}\n")
    
    # FlightRadar24 route
    fr24_url = f"https://www.flightradar24.com/data/flights/{origin.lower()}-{dest.lower()}"
    print(f"📡 FlightRadar24:")
    print(f"   {fr24_url}\n")
    
    # Airline websites
    print(f"🏢 Check airline websites:")
    if origin == 'HAM' and dest == 'ZRH':
        print(f"   • SWISS: https://www.swiss.com")
        print(f"   • Lufthansa: https://www.lufthansa.com")
        print(f"   • Eurowings: https://www.eurowings.com")
    else:
        print(f"   • Search for direct carriers between {origin} and {dest}")
    
    print("\n" + "=" * 100)
    print("\n💡 Tip: Get a free API key at https://aviationstack.com (100 requests/month)")
    print("   Then set: export AVIATIONSTACK_API_KEY='your_key_here'\n")

def main():
    import argparse
    import os
    
    parser = argparse.ArgumentParser(description='Check flight schedules between airports')
    parser.add_argument('origin', nargs='?', help='Origin airport (IATA code, e.g., HAM)')
    parser.add_argument('destination', nargs='?', help='Destination airport (IATA code, e.g., ZRH)')
    parser.add_argument('--from', dest='from_airport', help='Origin airport (alternative)')
    parser.add_argument('--to', dest='to_airport', help='Destination airport (alternative)')
    parser.add_argument('--date', help='Flight date (YYYY-MM-DD)')
    
    args = parser.parse_args()
    
    # Determine origin and destination
    origin = (args.origin or args.from_airport or '').upper()
    dest = (args.destination or args.to_airport or '').upper()
    
    if not origin or not dest:
        print("Usage: python3 schedule.py HAM ZRH")
        print("       python3 schedule.py --from HAM --to ZRH --date 2026-01-15")
        print(f"\nCommon airports: {', '.join(sorted(AIRPORTS.keys()))}")
        sys.exit(1)
    
    # Check for API key
    api_key = os.environ.get('AVIATIONSTACK_API_KEY')
    
    if api_key:
        # Use API
        data = get_aviationstack_schedule(origin, dest, api_key, args.date)
        print_aviationstack_results(data, origin, dest)
    else:
        # Show manual options
        show_manual_options(origin, dest, args.date)

if __name__ == '__main__':
    main()
