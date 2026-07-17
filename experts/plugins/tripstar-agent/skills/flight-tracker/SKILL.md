---
name: flight-tracker
description: Flight tracking and scheduling. Track live flights in real-time by region, callsign, or airport using OpenSky Network. Search flight schedules between airports. Use for queries like "What flights are over Switzerland?" or "When do flights from Hamburg arrive in Zurich?" or "Track flight SWR123".
description_zh: "实时航班追踪，支持按地区、呼号、机场查询航班动态与时刻"
description_en: "Real-time flight tracking and schedule search via OpenSky Network"
version: 1.1.0
homepage: https://openskynetwork.github.io/opensky-api/
allowed-tools: Bash,Read
---

# Flight Tracker

Track flights in real-time and search flight schedules between airports.

## Quick Commands

### Live Flight Tracking

#### Flights over a region (bounding box)
```bash
# Switzerland (lat_min, lat_max, lon_min, lon_max)
curl -s "https://opensky-network.org/api/states/all?lamin=45.8&lomin=5.9&lamax=47.8&lomax=10.5" | \
  jq -r '.states[] | "\(.[1]) - \(.[2]) | Alt: \(.[7])m | Speed: \(.[9])m/s | From: \(.[5])"'
```

### Track specific flight by callsign
```bash
curl -s "https://opensky-network.org/api/states/all?icao24=<aircraft-icao>" | jq .
```

#### Get live flight info
```bash
# Use helper script
python3 scripts/track.py --region switzerland
python3 scripts/track.py --callsign SWR123
python3 scripts/track.py --airport LSZH
```

### Flight Schedules

Search for scheduled flights between airports:

```bash
# Basic usage (shows search links)
python3 scripts/schedule.py HAM ZRH

# With specific date
python3 scripts/schedule.py --from HAM --to ZRH --date 2026-01-15

# With API key (optional, for detailed results)
export AVIATIONSTACK_API_KEY='your_key_here'
python3 scripts/schedule.py HAM ZRH
```

**Without API key:** Shows helpful search links (Google Flights, FlightRadar24, airline websites)

**With API key:** Fetches live schedule data with departure/arrival times, terminals, gates, and status

Free API key available at [aviationstack.com](https://aviationstack.com) (100 requests/month)

## Regions

Pre-defined regions in the script:

- **switzerland**: Swiss airspace
- **europe**: European airspace (rough bounds)
- **zurich**: Area around Zurich
- **geneva**: Area around Geneva

## API Endpoints

### All states
```bash
GET https://opensky-network.org/api/states/all
```

Optional parameters:
- `lamin`, `lomin`, `lamax`, `lomax`: Bounding box
- `icao24`: Specific aircraft (hex code)
- `time`: Unix timestamp (0 = now)

### Response Format

Each flight state contains:
```
[0]  icao24      - Aircraft ICAO24 address (hex)
[1]  callsign    - Flight callsign (e.g., "SWR123")
[2]  origin_country - Country name
[5]  origin      - Origin airport (if available)
[7]  baro_altitude - Altitude in meters
[9]  velocity    - Speed in m/s
[10] heading     - Direction in degrees
[11] vertical_rate - Climb/descent rate in m/s
```

## Airport Codes

### ICAO (for live tracking)
- **LSZH** - Zurich
- **LSGG** - Geneva
- **LSZB** - Bern
- **LSZA** - Lugano
- **LFSB** - Basel-Mulhouse (EuroAirport)

### IATA (for schedules)
- **ZRH** - Zurich
- **GVA** - Geneva
- **BSL** - Basel
- **BRN** - Bern
- **LUG** - Lugano
- **HAM** - Hamburg
- **FRA** - Frankfurt
- **MUC** - Munich
- **BER** - Berlin
- **LHR** - London Heathrow
- **CDG** - Paris CDG
- **AMS** - Amsterdam

## Notes

### Live Tracking (OpenSky Network)
- Free API with rate limits (anonymous: 400/day)
- Real-time data from ADS-B receivers worldwide
- No API key required
- Data updated every 10 seconds
- Create account for higher limits and historical data

### Flight Schedules (AviationStack)
- Optional API key for detailed schedule data
- Free tier: 100 requests/month
- Without API: provides search links to Google Flights, FlightRadar24, etc.
- Supports date-specific queries
