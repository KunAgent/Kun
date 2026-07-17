# search-marriott-package ref

## Marriott Package Search (search-marriott-package)

### Parameters

- **--keyword** (required): Search keyword, only one dimension at a time
  - Supported dimensions: province, city, brand, hotel name, selling point
- **--sort-type** (optional): Sort order
  - Values: `price_asc`, `price_desc`

### Examples

```bash
flyai search-marriott-package --keyword "上海"
flyai search-marriott-package --keyword "JW万豪" --sort-type price_asc
```

### Output Example

```json
{
  "data": {
    "itemList": [
      {
        "name": "上海浦东丽思卡尔顿酒店 双人下午茶套餐",
        "brandName": "丽思卡尔顿",
        "hotelName": "上海浦东丽思卡尔顿酒店",
        "cityName": "上海",
        "price": "¥899",
        "detailUrl": "https://...",
        "mainPic": "https://img.alicdn.com/...",
        "sellingPoint": "高空景观、双人下午茶、周末可用"
      }
    ]
  },
  "message": "success",
  "systemMessage": "...",
  "status": 0
}
```
