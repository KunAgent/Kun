# search-hotel ref

## Hotel Search (search-hotel)

### Parameters

- **--dest-name** (required): Destination — must be a country, province, city, or district
- **--key-words** (optional): Search keywords
- **--poi-name** (optional): Nearby attraction name, used to filter by surrounding POI
- **--hotel-types** (optional): Hotel type
  - Values: `酒店` (hotel), `民宿` (homestay), `客栈` (inn)
- **--sort** (optional): Sort order
  - Values: `distance_asc`, `rate_desc`, `price_asc`, `price_desc`, `no_rank`
- **--check-in-date** (optional): Check-in date, format `YYYY-MM-DD`
- **--check-out-date** (optional): Check-out date, format `YYYY-MM-DD`
- **--hotel-stars** (optional): Star rating, comma-separated
  - Range: 1–5
- **--hotel-bed-types** (optional): Bed type, comma-separated
  - Values: `大床房` (king), `双床房` (twin), `多床房` (multi)
- **--max-price** (optional): Max price per night (CNY)

### Examples

```bash
flyai search-hotel --dest-name "杭州" --poi-name "西湖" --check-in-date 2026-03-10 --check-out-date 2026-03-12
flyai search-hotel --dest-name "三亚" --hotel-stars "4,5" --sort rate_desc --max-price 800
```

### Output Example

```json
{
  "data": {
    "itemList": [
        {
          "address": "环城西路2号",
          "brandName": "雷迪森",
          "decorationTime": "2014",
          "interestsPoi": "近杭州西湖风景名胜区",
          "latitude": "30.259204",
          "longitude": "120.159246",
          "mainPic": "https://img.alicdn.com/...",
          "detailUrl": "...",
          "name": "杭州望湖宾馆",
          "price": "¥618",
          "review": "西湖边的位置，家庭出游首选",
          "score": "5.0",
          "scoreDesc": "超棒",
          "shId": "10021423",
          "star": "豪华型"
        }
    ]
  },
  "message": "success",
  "systemMessage": "...",
  "status": 0
}
```