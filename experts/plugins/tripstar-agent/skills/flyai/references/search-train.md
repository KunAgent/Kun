# search-train ref

## Train Search (search-train)

### Parameters

- **--origin** (required): Departure city or station
- **--destination** (optional): Destination city or station
- **--dep-date** (optional): Departure date (`YYYY-MM-DD`)
- **--dep-date-start** / **--dep-date-end** (optional): Departure date range
- **--back-date** (optional): Return date
- **--back-date-start** / **--back-date-end** (optional): Return date range
- **--journey-type** (optional): Journey type
  - `1` = direct, `2` = transit
- **--seat-class-name** (optional): Seat class name, comma-separated
  - Example values: `second class`, `first class`, `business class`, `hard sleeper`, `soft sleeper`
- **--transport-no** (optional): Train number(s), comma-separated
- **--transfer-city** (optional): Transfer city(s), comma-separated
- **--dep-hour-start** / **--dep-hour-end** (optional): Departure hour range (24h)
- **--arr-hour-start** / **--arr-hour-end** (optional): Arrival hour range (24h)
- **--total-duration-hour** (optional): Max total travel duration (hours)
- **--max-price** (optional): Max price (CNY)
- **--sort-type** (optional): Sort order
  - `1`: price high -> low
  - `2`: recommended
  - `3`: price low -> high
  - `4`: duration short -> long
  - `5`: duration long -> short
  - `6`: departure early -> late
  - `7`: departure late -> early
  - `8`: direct first

### Examples

```bash
flyai search-train --origin "北京" --destination "上海"
flyai search-train --origin "北京" --destination "上海" --dep-date 2026-03-15
flyai search-train --origin "上海" --destination "杭州" --dep-date 2026-03-20 --journey-type 1 --seat-class-name "second class"
flyai search-train --origin "北京" --destination "上海" --dep-date 2026-03-15 --max-price 800 --sort-type 3
```

### Output Example

```json
{
  "data": {
    "itemList": [
      {
        "adultPrice": "¥553.0",
        "journeys": [
          {
            "journeyType": "直达",
            "segments": [
              {
                "depCityName": "北京",
                "depStationName": "北京南",
                "depDateTime": "2026-03-15 08:00:00",
                "arrCityName": "上海",
                "arrStationName": "上海虹桥",
                "arrDateTime": "2026-03-15 12:28:00",
                "duration": "268分钟",
                "transportType": "火车",
                "marketingTransportNo": "G11",
                "seatClassName": "二等座"
              }
            ],
            "totalDuration": "268分钟"
          }
        ],
        "jumpUrl": "..."
      }
    ]
  },
  "message": "success",
  "systemMessage": "...",
  "status": 0
}
```