# search-marriott-hotel ref

## Marriott Hotel Search (search-marriott-hotel)

### Parameters

- **--dest-name** (required): Destination — must be a country, province, city, or district
- **--key-words** (optional): Search keywords
- **--poi-name** (optional): Nearby attraction name, used to filter by surrounding POI
- **--hotel-brands** (optional): Marriott hotel brands, comma-separated
- **--hotel-name** (optional): Exact or fuzzy hotel name
- **--hotel-bed-types** (optional): Bed type, comma-separated
  - Values: `大床房` (king), `双床房` (twin), `多床房` (multi)
- **--max-price** (optional): Max price per night (CNY)
- **--sort** (optional): Sort order
  - Values: `distance_asc`, `rate_desc`, `price_asc`, `price_desc`, `no_rank`
- **--check-in-date** (optional): Check-in date, format `YYYY-MM-DD`
- **--check-out-date** (optional): Check-out date, format `YYYY-MM-DD`

### Examples

```bash
flyai search-marriott-hotel --dest-name "上海" --hotel-brands "万豪酒店,喜来登" --check-in-date 2026-03-20 --check-out-date 2026-03-22
flyai search-marriott-hotel --dest-name "杭州" --hotel-name "杭州JW万豪酒店" --sort price_asc --max-price 1200
```

### Output Example

```json
{
  "data": {
    "itemList": [
      {
        "address": "延安中路1218号",
        "brandName": "JW万豪",
        "interestsPoi": "近静安寺商圈",
        "latitude": "31.224612",
        "longitude": "121.442115",
        "mainPic": "https://img.alicdn.com/...",
        "detailUrl": "...",
        "name": "上海明天广场JW万豪酒店",
        "price": "¥1288",
        "review": "地理位置优越，服务稳定",
        "score": "4.8",
        "scoreDesc": "很棒",
        "shId": "12345678",
        "star": "豪华型"
      }
    ]
  },
  "message": "success",
  "systemMessage": "...",
  "status": 0
}
```
