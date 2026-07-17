# DataBrain Game ID System

> Source: iWiki https://iwiki.woa.com/p/4013008413
> Last updated: 2025-02-20 | Local sync: 2026-03-24

## Overview

DataBrain aggregates data from multiple sources, each with its own `app_id`. DataBrain maps them to a unified game ID (`game_id`).

## ID Types

| ID | Description | Prefix | Aliases |
|----|-------------|--------|---------|
| `app_id` | Raw source ID | none | — |
| `game_id` | DataBrain single-platform ID | Mobile: `u`, PC/Console: `e` | `unified_id` / `edition_id` / `unified_edition_id` |
| `unified_edition_id` | Same as game_id | same | same |
| `unified_id` | Mobile single-platform ID | `u` | `game_id` / `unified_edition_id` |
| `edition_id` | PC or Console single-platform ID | `e` | `game_id` / `unified_edition_id` |
| `combined_id` | Cross-platform (PC+Console+Mobile) combined ID | `c` | — |

Examples:
- PUBG `unified_id`: `ufc454d9b1af70b40588e2a6fa4da4a8b`
- POE2 `edition_id`: `e7f672beaa5fddd166df98bc046ba4bd4`
- Diablo IV `combined_id`: `c00002262`

## Core Lookup Tables

### `common.unified_ids` — app_id ↔ game_id mapping

> **Performance tip**: Prefer `common.unified_ids_part` (partition-optimized) when querying app_ids under a game_id.

#### Schema (19 columns) — verified 2026-06-29

| Column | Type | Notes |
|---|---|---|
| `entity_type` | STRING | `mobile` / `pc` / `console` |
| `app_id` | STRING | Raw source ID (e.g. iOS numeric, Steam URL, package name). Filter key for joining into raw `intelligence.*` tables |
| `unified_id` | STRING | `u`-prefixed mobile single-platform ID. **Populated for every row** (even PC/Console — same md5 suffix as `edition_id`) |
| `edition_id` | STRING | `e`-prefixed PC/Console single-platform ID. **Populated for every row** (mobile rows reuse the same md5 suffix) |
| `entity_md5` | STRING | MD5 hash of the entity |
| `entity_name` | STRING | Game display name from this `source` (raw, not canonical) |
| `other_name` | STRING | Alternative name |
| `entity_country` | STRING | Country of the entity |
| `entity_region` | STRING | Region of the entity |
| `source` | STRING | Data source (e.g. `sensortower`, `steam`, `google_play`, `app_store`) |
| `entity_id` | STRING | Unknown semantics — **verified NOT equal to `company_details.uuid`** (JOIN returns zero rows). Filled for mobile sources (`sensortower`/`app_store`/`google_play` = 100%), NULL for most PC/Console sources. **Do NOT use this column to filter by company** — it cannot be joined to `company_details`. |
| `create_time` | DATETIME | Row creation time |
| `update_time` | DATETIME | Last update time |
| `unpublished` | INT64 | `1` = removed/unpublished from the source |
| `country_id` | STRING | Country ID |
| `ext1` / `ext2` / `ext3` | STRING | Extension fields |
| `_p_key` | INT64 | Internal partition key |

> **`unified_ids` has NO `developer_id` or `publisher_id` columns, and `entity_id` cannot be joined to `company_details.uuid`.** To find a company's games, use `common.app_detail.publisher_id` / `developer_id` → `company_details.uuid`.


#### Schema of `common.unified_ids_part` (partition-optimized subset, 5 columns)

| Column | Type | Notes |
|---|---|---|
| `entity_type` | STRING | partition / cluster key |
| `app_id` | STRING | Raw source ID |
| `unified_edition_id` | STRING | = `unified_id` (mobile) / `edition_id` (pc, console) |
| `edition_id` | STRING | Same as in `unified_ids` |
| `update_time` | DATETIME | Last refreshed |

#### Examples

```sql
-- Get all app_ids for a game_id (recommended)
SELECT app_id
FROM common.unified_ids_part
WHERE entity_type = 'pc'
  AND unified_edition_id = 'eff4d75bd19f929b410eb3a11afaab54a'
```

```sql
-- Reverse lookup: app_id → game_id
SELECT
  IF(entity_type='mobile', unified_id, edition_id) AS game_id,
  entity_type,
  app_id
FROM common.unified_ids
WHERE entity_type = 'pc'
  AND app_id = 'https://store.steampowered.com/app/292030/The_Witcher_3_Wild_Hunt/'
```

```sql
-- Resolve unified_id → raw Sensortower app_ids (mobile)
SELECT app_id
FROM common.unified_ids
WHERE entity_type = 'mobile'
  AND source      = 'sensortower'
  AND unified_id  = 'ufc454d9b1af70b40588e2a6fa4da4a8b'
```

### `common.combined_ids` — game_id ↔ combined_id mapping

```sql
SELECT entity_name, pc_id, console_id, mobile_id
FROM common.combined_ids
WHERE combined_id = 'c00002262'
```

### `common.unified_combined_ids` — all IDs combined (unified_ids + combined_ids)

```sql
-- Get all app_ids for a combined_id
SELECT DISTINCT app_id
FROM common.unified_combined_ids
WHERE combined_id = 'c00002262'
```

## Game Detail Tables

### `common.app_detail` — game details by app_id or game_id

> Note: The `app_id` column meaning depends on `id_type`: `app_id` / `unified_id` / `edition_id`

```sql
SELECT entity_name, entity_type, iegg_genre, publisher, release_time
FROM common.app_detail
WHERE app_id = 'eff4d75bd19f929b410eb3a11afaab54a'
```

### `common.combined_detail` — game details by combined_id

```sql
SELECT entity_name, publisher, release_date, iegg_genre, steam_id, cover
FROM common.combined_detail
WHERE combined_id = 'c00002262'
```

## Notes

- `entity_type` values: `mobile`, `pc`, `console`. The same game may have different `edition_id`s on PC vs Console.
- For cross-platform queries, first use `combined_id` to find all platform IDs, then query each platform's data separately.

## Name → ID Resolution (API — Preferred Method)

**Always use the Search API before falling back to SQL LIKE.** It's faster, handles aliases, and returns all ID types at once. Supports **games AND companies**.

```bash
# Games
python scripts/search_entity.py --name "PUBG Mobile" --type mobile
python scripts/search_entity.py --name "Counter-Strike 2" --type pc
python scripts/search_entity.py --name "王者荣耀"            # auto-detect type

# Companies / developers / publishers
python scripts/search_entity.py --name "SYBO" --type company
python scripts/search_entity.py --name "miHoYo" --type company --top 3
```

### API → Database Column Mapping (Critical)

| API returns | entity_type | = DB column | Use in these tables |
|-------------|-------------|-------------|---------------------|
| `mobile_id` | mobile | `id` (unified_id, `u` prefix) | `*_uid` tables: `sensortower_daily_uid`, `sensortower_monthly_uid`, `streamhatchet_stream_uid`, `gsd_weekly_uid`, `npd_monthly_uid` |
| `pc_id` | pc | `edition_id` (`e` prefix) | `game_metric_gamalytic_daily`, `ampere_daily`.`edition_id`. **⚠️ NOT for `pconsole_*_cid`** — those are `combined_id`-keyed; use `combine_id` instead |
| `console_id` | console | `edition_id` (`e` prefix) | `ampere_daily`.`edition_id` (raw, console platform rows). **⚠️ NOT for `pconsole_*_cid`** — use `combine_id` |
| `combine_id` | (any game) | `combined_id` (`c` prefix) | **All `*_cid` tables** — `pconsole_daily_cid` / `_weekly_cid` / `_monthly_cid`, `ampere_daily_cid`, `ampere_monthly_cid`; plus `common.combined_ids`, `common.unified_combined_ids` |
| `entity_id` | **company** | `uuid` in `common.company_details` | Filter: `WHERE cd.uuid = '<entity_id>'` to look up company profile. **`company_details` has NO `company_id` column — primary key is `uuid`.** To find all games of a company, use `app_detail.publisher_id` / `developer_id` → `company_details.uuid` (see Pattern in sensortower.md). **Do NOT use `unified_ids.entity_id`** — it is NOT equal to `company_details.uuid` (verified: JOIN returns zero rows). |

### Special Cases

1. **~~VG Insights~~ (DEPRECATED)** — access revoked, do not query. Previously used Steam store URLs as `app_id`. For Steam/PC data, use Gamalytic with `edition_id` exclusively.

2. **`common.app_detail`** does NOT contain `combine_id` / `combined_id` as `app_id`. Only `unified_id` and `edition_id` exist in `app_id` column (check `id_type`).

3. **`combined_id` is NOT in Gamalytic**: `game_metric_gamalytic_daily` has `edition_id` only, no `combined_id` column. Use `pc_id` from API directly.

### Verified ID Examples

| Game | mobile_id (=unified_id) | pc_id (=edition_id) | combine_id |
|------|-------------------------|---------------------|------------|
| PUBG Mobile | `ufc454d9b1af70b40588e2a6fa4da4a8b` | — | `c00068567` |
| CS2 | — | `e9ec9568bb80051c45b5d19204249d6f0` | `c00001765` |
| 王者荣耀 | `u477a9f3809a0b7af26ae6383139dd66a` | — | — |
| Free Fire | `u589791f804845507e85fa880c6d88d41` | — | — |
| HOK | `u10000000066` | — | — |
| 鸣潮 | `u10000000088` | — | — |
