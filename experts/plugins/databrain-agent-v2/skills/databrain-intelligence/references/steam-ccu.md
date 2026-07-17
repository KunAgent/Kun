# Steam CCU / PCU / ACU

> **CCU** on Steam PC = concurrent players (PCU). Three independent sources — label each in answers.

## Source matrix

| Layer | Mechanism | Freshness | Tool |
|-------|-----------|-----------|------|
| **Live CCU** | Steam Web API `GetNumberOfCurrentPlayers` | Snapshot at query time | `scripts/fetch_steam_ccu.py` |
| **Warehouse near-live** | `pconsole_*_cid.spider_steam_pcu` / `spider_steam_acu` | T-0 crawler (minutes lag vs API) | `execute_sql.py` — [Pattern 2](../examples/steam_ccu_queries.sql) |
| **Historical / trend** | Alinea `pcu` / `acu` on `game_metric_alinea_daily_cid` | T-0 partial → T-1 complete | [alinea.md](alinea.md) + [examples/alinea_queries.sql](../examples/alinea_queries.sql) |

**Default answer shape** (per [glossaries.json](glossaries.json) CCU entry): when the user asks CCU / 在线 / 同时在线 without other constraints:

1. **Live** — `fetch_steam_ccu.py` (Steam API)
2. **Trend** — last 30 days ACU (Alinea SQL) and/or spider PCU for today
3. **Never** headline Alinea same-day PCU as “实时”

## Workflow

```
search_entity.py → combined_id
       │
       ├─「现在 / 实时 / 当前在线」→ fetch_steam_ccu.py --combined-id c...
       │
       └─ 趋势 / 对比 / 排行 / 昨日 → execute_sql + steam_ccu_queries.sql
```

### Live CCU script

```bash
python scripts/fetch_steam_ccu.py --combined-id c00001765
python scripts/fetch_steam_ccu.py --name "Counter-Strike 2" --type pc
```

Output JSON fields: `combined_id`, `entity_name`, `steam_id`, `CCU`, `fetched_at_utc`, `source` (`steam API`), or `error`.

Requires `TAI_IT_TOKEN` only to read `common.combined_detail.steam_id`. The Steam endpoint is public (no Steam API key).

### Host / ChatBI parity

In **databrain_host**, `steam_ccu.py` + `metrics_query_tool` (`steam_ccu` metric) use the same Steam API via entity detail. Prefer this skill’s script when only `databrain-intelligence` is loaded; prefer host metrics when already inside ChatBI agent.

## Warehouse rules (SQL)

### `spider_steam_*` — `segment IS NULL`

Spider PCU/ACU lives on the **`segment IS NULL`** slice (`platform='PC'`, `market='global'`). A filter `segment = 'All'` **never** returns spider columns even though they exist in the schema.

See [pconsole-integrated-tables.md Pattern 8](pconsole-integrated-tables.md#pattern-8--steam-source-selection-freshness-today--coverage-long-tail).

### Alinea is not live

`game_metric_alinea_daily_cid.pcu` / `acu` are batch estimates (T-0 partial catalog → T-1 complete). Do not substitute for Steam API or spider for “right now” questions.

### ID resolution

`common.combined_detail.steam_id` (STRING) → Steam `appid`. Non-Steam or unreleased titles may have empty `steam_id` — `fetch_steam_ccu.py` will error; use warehouse upcoming patterns in [alinea.md](alinea.md) instead.

## Answer labelling (required)

| You show | Label as |
|----------|----------|
| `CCU` from script | **Steam API 实时 CCU** + `fetched_at_utc` |
| `spider_steam_pcu` | **数仓爬虫 PCU（T-0，非 API 秒级）** + `date` |
| Alinea `pcu` / `acu` | **Alinea 估算** + `date`；历史用 T-1 完整日 |

Single-point CCU without ACU trend is misleading — include 30-day ACU or daily PCU series when possible.

## Pitfalls

1. **Roblox CCU** — different domain → [roblox-sources.md](roblox-sources.md), not this file.
2. **CCV** — stream viewers (Streamhatchet), not game CCU → glossary CCV entry.
3. **Console / multi-platform** — live script is **Steam PC appid only**; console concurrent players use other tables (e.g. Ampere), not Steam API.
4. **`WITH` CTE** — do not use in `execute_sql.py` queries (CTE names → false `intelligence.*` table 404).

## Executable SQL

Copy one block from [examples/steam_ccu_queries.sql](../examples/steam_ccu_queries.sql) — never pass the whole file to `--sql_file`.
