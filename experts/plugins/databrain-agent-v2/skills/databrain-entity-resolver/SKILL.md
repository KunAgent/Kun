---
name: databrain-entity-resolver
description: "Resolve game/company names to canonical DataBrain entities + per-system permissions. Run once per query before any data skill when the user names games or companies."
---

# Entity Resolver

Map game/company names → canonical entity + routing permissions. **Run before** dashboard, intelligence, opinion, or datalab skills.

## Command

```bash
python3 scripts/resolve_entities.py --entities '[{"original_name":"HOK","standard_name":"Honor of Kings","english_name":"Honor of Kings","type":"game"}]'
python3 scripts/resolve_entities.py --names "Honor of Kings" "PUBG Mobile"
```

`DATABRAIN_TOKEN` from env only. `type`: `"game"` | `"game company"`.

## Internal routing (tool output — not for users)

| Field | Route to |
|-------|----------|
| `has_dashboard_permission` | `databrain-dashboard-service` |
| `has_opinion_permission` | opinion skills |
| `has_intelligence` | `databrain-intelligence` |
| `dashboard_info` | Only when dashboard permission is true |

## User-visible wording

**Never** quote JSON, `has_*_permission`, or internal IDs. If a limitation must be explained:

| Internal | Tell the user |
|----------|---------------|
| `has_dashboard_permission=false` | 该游戏暂无**经分**权限（或：无经分数据权限），以下使用**情报**数据 |
| `has_opinion_permission=false` | 暂无**舆情**数据 |
| `matched=false` | 未能匹配到该游戏/公司，请确认名称 |

Default: route silently; skip the caveat if the answer is clear without it.
