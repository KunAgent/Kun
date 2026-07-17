---
name: flights
version: 1.2.0
description: Search flights via Google Flights. Find nonstop/connecting flights, filter by time and cabin class, get booking links. Supports city names (NYC, London, Tokyo) with automatic multi-airport search. No API key required.
description_zh: "通过 Google Flights 搜索航班，支持城市名、舌位筛选和预订链接"
description_en: "Search Google Flights for real-time prices, schedules and booking links"
allowed-tools: Bash,Read
---

# Flight Search

Search real-time flight schedules and prices via Google Flights data.

## Prerequisites

- **Python 3.9+**
- **[uv](https://docs.astral.sh/uv/)** (recommended) — install with `curl -LsSf https://astral.sh/uv/install.sh | sh`

The `flights-search` CLI is bundled at `scripts/flights-search` in this skill directory.

The `fast-flights` library is installed automatically on first run via `uvx` (cached after that). Or install manually: `pip install fast-flights`

## CLI Usage

```bash
uvx --with fast-flights python3 scripts/flights-search <origin> <destination> <date> [options]
```

Origin and destination accept **IATA codes** (JFK, LAX) or **city names** (NYC, London, Tokyo). City names automatically search all airports in that metro area.

### Examples

```bash
# Search all NYC airports to LAX
flights-search NYC LAX 2026-03-15

# Nonstop flights from NYC to Berlin
flights-search NYC Berlin 2026-03-15 --nonstop

# Evening departures only
flights-search JFK LHR 2026-03-15 --after 17 --before 22

# Business class
flights-search NYC London 2026-03-15 --class business

# Multiple passengers with booking link
flights-search SF Tokyo 2026-04-01 --passengers 2 --link
```

### Options

| Option | Description |
|--------|-------------|
| `--nonstop` | Nonstop flights only |
| `--all-stops` | Show all flights regardless of stops |
| `--after HH` | Depart after hour (24h format) |
| `--before HH` | Depart before hour (24h format) |
| `--class` | Cabin: economy, premium, business, first |
| `--passengers N` | Number of travelers (default: 1) |
| `--link` | Print Google Flights URL |

### Supported City Names

When you use a city name, the CLI searches all airports in that metro area:

| City | Airports |
|------|----------|
| NYC / New York | JFK, EWR, LGA |
| LA / Los Angeles | LAX, BUR, LGB, ONT, SNA |
| SF / San Francisco | SFO, OAK, SJC |
| Chicago | ORD, MDW |
| DC / Washington | DCA, IAD, BWI |
| London | LHR, LGW, STN, LTN, LCY |
| Paris | CDG, ORY |
| Tokyo | NRT, HND |
| Toronto | YYZ, YTZ |

60+ metro areas supported. Use any IATA code directly for airports not in the list.

## Default Behavior

By default, the CLI shows only flights with the **minimum stops available**:
- If nonstops exist → shows only nonstops
- If no nonstops → shows only 1-stop flights
- Use `--all-stops` to see everything

## Output

```
Searching from NYC: JFK, EWR, LGA

Route        Depart                       Arrive                       Airline          Price       Duration
------------------------------------------------------------------------------------------------------------
EWR→LAX      6:00 AM on Sat, Mar 7        9:07 AM on Sat, Mar 7        United           $289        6 hr 7 min
EWR→LAX      12:00 PM on Sat, Mar 7       3:14 PM on Sat, Mar 7        United           $289        6 hr 14 min
JFK→LAX      8:00 AM on Sat, Mar 7        11:30 AM on Sat, Mar 7       Delta            $304        5 hr 30 min

3 flight(s) found.
```

## Notes

- Date format: `YYYY-MM-DD`
- Airport codes: Standard IATA codes (JFK, LAX, LHR, etc.)
- Prices are in USD
- Times shown in local airport timezone
- No API key required — uses Google Flights data via reverse-engineered protobuf API
- Some routes may return price-only results (missing departure/arrival times) due to upstream parsing limitations

## Data Source

Uses Google Flights data via the [`fast-flights`](https://github.com/AWeirdDev/flights) Python package.
