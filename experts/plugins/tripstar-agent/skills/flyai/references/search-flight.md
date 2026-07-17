# search-flight ref

## Flight Search (search-flight)

### Parameters

- **--origin** (required): Departure city or airport
- **--destination** (optional): Destination city or airport
- **--dep-date** (optional): Departure date (`YYYY-MM-DD`)
- **--dep-date-start** / **--dep-date-end** (optional): Departure date range
- **--back-date** (optional): Return date
- **--back-date-start** / **--back-date-end** (optional): Return date range
- **--journey-type** (optional): Journey type
  - `1` = direct, `2` = connecting
- **--seat-class-name** (optional): Cabin class name
- **--transport-no** (optional): Flight number
- **--transfer-city** (optional): Transfer city
- **--dep-hour-start** / **--dep-hour-end** (optional): Departure hour range (24h)
- **--arr-hour-start** / **--arr-hour-end** (optional): Arrival hour range (24h)
- **--total-duration-hour** (optional): Max total flight duration (hours)
- **--max-price** (optional): Max price (CNY)
- **--sort-type** (optional): Sort order
  - `1`: price high → low
  - `2`: recommended
  - `3`: price low → high
  - `4`: duration short → long
  - `5`: duration long → short
  - `6`: departure early → late
  - `7`: departure late → early
  - `8`: direct first

### Examples

```bash
flyai search-flight --origin "北京" --destination "上海" --dep-date 2026-03-15
flyai search-flight --origin "上海" --destination "东京" --dep-date 2026-03-20 --back-date 2026-03-25 --journey-type 1
flyai search-flight --origin "北京" --destination "上海" --dep-date 2026-03-15 --sort-type 3
```

### Output Example

```json
{
  "data": {
    "itemList": [
      {
        "adultPrice": "¥400.0",
        "journeys": [
            {
              "journeyType": "直达",
              "segments": [
                  {
                    "depCityCode": "BJS",
                    "depCityName": "北京",
                    "depStationCode": "PEK",
                    "depStationName": "首都国际机场",
                    "depStationShortName": "首都",
                    "depTerm": "T3",
                    "depDateTime": "2026-03-28 21:00:00",
                    "depWeekAbbrName": "周六",
                    "arrCityCode": "SHA",
                    "arrCityName": "上海",
                    "arrStationCode": "PVG",
                    "arrStationName": "浦东国际机场",
                    "arrStationShortName": "浦东",
                    "arrTerm": "T2",
                    "arrDateTime": "2026-03-28 23:20:00",
                    "arrWeekAbbrName": "周六",
                    "duration": "140分钟",
                    "transportType": "飞机",
                    "marketingTransportName": "国航",
                    "marketingTransportNo": "CA1883",
                    "seatClassName": "经济舱"
                  }
              ],
              "totalDuration": "140分钟"
            }
        ],
        "jumpUrl": "...",
        "totalDuration": "140分钟"
      }
    ]
  },
  "message": "success",
  "systemMessage": "...",
  "status": 0
}
```