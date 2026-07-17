# search-poi ref

## POI / Attraction Search (search-poi)

### Parameters

- **--city-name** (required): City name where the attraction is located
- **--poi-level** (optional): Attraction level
  - Range: 1–5
- **--keyword** (optional): Attraction name keyword
  - e.g. `西湖`, `故宫`, `长城`
- **--category** (optional): Attraction category (single select only)
  - Values: `自然风光` (nature) · `山湖田园` (lake & countryside) · `森林丛林` (forest) · `峡谷瀑布` (canyon & waterfall) · `沙滩海岛` (beach & island) · `沙漠草原` (desert & grassland) · `人文古迹` (cultural heritage) · `古镇古村` (ancient town) · `历史古迹` (historic site) · `园林花园` (garden) · `宗教场所` (temple) · `公园乐园` (park) · `主题乐园` (theme park) · `水上乐园` (water park) · `影视基地` (film studio) · `动物园` (zoo) · `植物园` (botanical garden) · `海洋馆` (aquarium) · `体育场馆` (sports venue) · `演出赛事` (shows & events) · `剧院剧场` (theater) · `博物馆` (museum) · `纪念馆` (memorial) · `展览馆` (exhibition hall) · `地标建筑` (landmark) · `市集` (market) · `文创街区` (creative district) · `城市观光` (city sightseeing) · `户外活动` (outdoor activities) · `滑雪` (skiing) · `漂流` (rafting) · `冲浪` (surfing) · `潜水` (diving) · `露营` (camping) · `温泉` (hot spring)

### Examples

```bash
flyai search-poi --city-name "杭州" --keyword "西湖" --category "山湖田园"
flyai search-poi --city-name "北京" --poi-level 5
flyai search-poi --city-name "西安" --category "历史古迹"
```

### Output Example

```json
{
    "data": {
      "itemList": [
        {
          "address": "陕西省西安市莲湖区北院门...",
          "id": "177224",
          "mainPic": "https://img.alicdn.com/tfscom/...",
          "jumpUrl": "...",
          "name": "西安钟鼓楼",
          "freePoiStatus": "...",
          "ticketInfo": {
              "price": null,
              "priceDate": "2026-03-19",
              "ticketName": "西安鼓楼门票 成人票"
          }
        }
      ]
    },
    "message": "success",
    "systemMessage": "...",
    "status": 0
}
```