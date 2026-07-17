# ai-search ref

## AI Search (ai-search)

### Parameters

- **--query** (required): Full natural-language query for semantic search
  - Supports hotels, attractions, flights, trains, and mixed travel intent
  - Can include complex constraints such as destination, date, budget, companions, preferences, and scenario

### Examples

```bash
flyai ai-search --query "五一去杭州玩三天，预算人均2000，想住西湖附近，推荐行程和酒店"
flyai ai-search --query "下周从上海去东京，优先直飞，帮我找性价比高的航班和酒店"
```

### Output Example

```json
{
  "status": 0,
  "message": "success",
  "systemMessage": "...",
  "data": "..."
}
```
