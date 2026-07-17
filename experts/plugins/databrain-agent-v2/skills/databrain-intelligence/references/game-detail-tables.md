# Game Detail Tables Reference

> Coverage: game metadata lookup by any ID type (`app_id` / `unified_id` / `edition_id` / `combined_id`) or by name
> Database: `common` schema, `database_uuid = 15000`

Related: see [company-detail-tables.md](company-detail-tables.md) for resolving `publisher_id` / `developer_id` into a company profile.

---

## Table of Contents

- [Source Overview](#source-overview)
- [Tables](#tables)
  - [app_detail (per-platform detail)](#app_detail)
  - [combined_detail (cross-platform merged detail)](#combined_detail)
  - [unified_business_model (F2P + Subscription coverage)](#unified_business_model)
- [Key Dimensions](#key-dimensions)
- [Common Query Patterns](#common-query-patterns)
- [Pitfalls & Notes](#pitfalls--notes)

---

## Source Overview

| Table | Grain | Primary Key | Cluster Key |
|-------|-------|-------------|-------------|
| `common.app_detail` | Single platform × single ID type (one game may have multiple rows) | `app_id` (unique) + `id_type` semantics | `app_id` |
| `common.combined_detail` | Cross-platform merged snapshot (one row per game franchise) | `combined_id` (unique) | `combined_id` |
| `common.unified_business_model` | Per-game × source time-windowed business-model status (Free-to-Play / PlayStation Plus / Xbox Game Pass) | composite: `unified_edition_id` + `source` + `start_date` | `unified_edition_id`, `source`, `start_date` |

**When to use which:**

| Scenario | Table |
|----------|-------|
| Known `app_id` / `unified_id` / `edition_id` — need metadata | `common.app_detail` |
| Known `combined_id` — need cross-platform merged metadata | `common.combined_detail` |
| Fuzzy name search | `common.app_detail` by `entity_name` (fallback of `scripts/search_entity.py`) |
| **List all games of a company / developer / publisher**（如 "SYBO 的所有游戏"） | 先 `scripts/search_entity.py --name <公司名> --type company` 拿 `entity_id`，再在 `common.app_detail` 的 `developer_id` / `publisher_id`（pipe 分隔的多值列）里 `LIKE '%<entity_id>%'` 过滤。不要直接 `LOWER(developer) LIKE '%<名字>%'` —— 公司名拼写 / 子公司 / 本地化差异会漏掉很多条。 |
| Is this game free-to-play or paid? When did it go free? | `common.unified_business_model` (status='free' / 'pay'). **Shortcut for PC current-state only**: `intelligence.game_metric_pconsole_daily_cid.gamalytic_price` (`>0` premium / `=0` F2P; ~99% catalog coverage). Use the shortcut when you only need today's flag, not the timeline. See [pconsole-integrated-tables.md Pattern 7](pconsole-integrated-tables.md#pattern-7--premium-vs-f2p-filter-use-gamalytic_price-no-business-model-join). |
| Is this game on Game Pass / PS Plus? For how long? | `common.unified_business_model` (source in 'Xbox Game Pass' / 'PlayStation Plus') |
| Genre / sub-genre leaderboards | `common.app_detail.iegg_genre` / `iegg_sub_genre` |
| Cross-platform franchise (one IP spanning Steam + PS + Xbox + Mobile) | `common.combined_detail` |

---

## Tables

### app_detail

**Per-platform detail** — the main game metadata table. Same game may appear across multiple `id_type` rows (raw `app_id`, `unified_id`, `edition_id`, `entity_id`).

**Full table**: `common.app_detail`

> **Field name quick ref** — common mistakes:
> - Game name column is **`entity_name`** — NOT `name`, NOT `app_name`, NOT `game_name` (all three raise `Unrecognized name` errors)
> - Join/filter key is **`app_id`** (Sensortower bundle_id / numeric App Store ID) — there is **NO `unified_id` column** in this table. To filter by `unified_id`, join through `common.unified_ids` on `app_id`.
> - Dedup helper: `entity_md5` (groups multiple platform rows for the same game)
> - `entity_id` in `id_type` column is an **id_type value** (a row category label), NOT a column name in `common.company_details`. `company_details` has NO `entity_id` column — its primary key is `uuid`. To look up a company, use `WHERE cd.uuid = '<company_uuid>'`.

| Field | Type | Description |
|-------|------|-------------|
| `app_id` | STRING | App ID; meaning determined by `id_type` (raw / unified / edition / entity) |
| `id_type` | STRING | `app_id` / `unified_id` / `edition_id` / `entity_id` |
| `entity_md5` | STRING | Entity MD5 (dedup helper) |
| `source` | STRING | Source providers, pipe-delimited (`app_store\|appannie\|sensortower`, etc.) |
| `entity_name` | STRING | Primary / English name |
| `entity_type` | STRING | `mobile` / `pc` / `console` |
| `entity_country` | STRING | Entity country |
| `entity_region` | STRING | Entity region |
| `other_name` | STRING | Alternate names (localized, former titles) |
| `att_source` | STRING | Attribute source (which provider populated the row) |
| `description` | STRING | Description (raw) |
| `description_en` | STRING | English description |
| `description_zh` | STRING | Chinese description |
| `cover` | STRING | Cover URL |
| `genre` | STRING | Source-raw genre (not normalized) |
| `sub_genre` | STRING | Source-raw sub-genre |
| `entity_image` | STRING | Image URLs, pipe-delimited |
| `entity_video` | STRING | Video URLs, pipe-delimited |
| `tag_list` | STRING | Tag list (raw string) |
| `developer` | STRING | Developer(s), pipe-delimited |
| `publisher` | STRING | Publisher(s), pipe-delimited |
| `release_time` | DATETIME | Release time |
| `update_time` | DATETIME | Update time |
| `platform` | STRING | Platform(s), pipe-delimited (`ios\|android`, `steam\|PC`, etc.) |
| `size` | STRING | Package size (text) |
| `current_version` | STRING | Current version |
| `version_history` | STRING | Version history |
| `system_demands` | STRING | System requirements (PC/Console) |
| `language` | STRING | Languages (JSON or delimited text) |
| `similar_entity` | STRING | Similar games |
| `content_classification` | STRING | Content rating |
| `is_published` | STRING | Published flag |
| `is_free` | STRING | Free-to-play flag |
| `players` | STRING | Player modes (single / multi / coop) |
| `publisher_website` | STRING | Publisher website |
| `publisher_address` | STRING | Publisher address |
| `developer_id` | STRING | Developer ID(s) — FK to `company_details.uuid`; pipe-delimited when multi |
| `publisher_id` | STRING | Publisher ID(s) — FK to `company_details.uuid`; pipe-delimited when multi |
| `create_time` | DATETIME | Create time |
| `first_create_time` | DATETIME | First create time |
| `ext1` | STRING | Extension field 1 |
| `ext2` | STRING | Extension field 2 |
| `ext3` | STRING | Extension field 3 |
| `ext4` | STRING | Sensortower `tags_for_apps` |
| `ext5` | STRING | Extension field 5 |
| `array_developer` | ARRAY\<STRING\> | Developers array |
| `array_publisher` | ARRAY\<STRING\> | Publishers array |
| `array_genre` | ARRAY\<STRING\> | Genres array |
| `array_sub_genre` | ARRAY\<STRING\> | Sub-genres array |
| `iegg_genre` | STRING | IEGG-standardized genre (use this for genre leaderboards) |
| `iegg_sub_genre` | STRING | IEGG-standardized sub-genre, pipe-delimited |
| `iegg_genre_source` | STRING | Source of IEGG genre classification |
| `steam_id` | STRING | Steam App ID |
| `pre_order_time` | DATETIME | Pre-order time |
| `ext_json` | STRING | Extension JSON blob |

---

### combined_detail

**Cross-platform merged detail** — one row per `combined_id`. Aggregates a franchise across Mobile + PC + Console into a single snapshot.

**Full table**: `common.combined_detail`

> **Field name quick ref** — common mistakes:
> - Game name column is **`entity_name`** — NOT `name`, NOT `game_name` (both raise `Unrecognized name` errors regardless of table alias, e.g. `cd.name` also fails)
> - Primary key is **`combined_id`** (STRING, `c...` prefix)
> - Release date is **`release_date`** (STRING, not DATE — compare with `SUBSTR(release_date, 1, 10)` or cast)
> ```sql
> -- CORRECT
> SELECT cd.combined_id, cd.entity_name, cd.developer_id, cd.publisher_id
> FROM common.combined_detail cd
> -- WRONG: cd.name, cd.game_name (column does not exist)
> ```

| Field | Type | Description |
|-------|------|-------------|
| `combined_id` | STRING | Combined ID, `c` prefix — unique primary key |
| `entity_name` | STRING | Primary name |
| `cover` | STRING | Cover URL |
| `platform` | STRING | Covered platforms, pipe-delimited |
| `publisher` | STRING | Publisher(s), pipe-delimited |
| `developer` | STRING | Developer(s), pipe-delimited |
| `publisher_id` | STRING | Publisher ID(s) — FK to `company_details.uuid`; pipe-delimited when multi |
| `developer_id` | STRING | Developer ID(s) — FK to `company_details.uuid`; pipe-delimited when multi |
| `release_date` | STRING | Release date (`YYYY-MM-DD` **string, NOT DATE**) |
| `release_date_str` | STRING | Release date string backup |
| `iegg_genre` | STRING | IEGG-standardized genre |
| `iegg_sub_genre` | STRING | IEGG-standardized sub-genre, pipe-delimited |
| `entity_image` | STRING | Image URLs, pipe-delimited |
| `entity_video` | STRING | Video URLs, pipe-delimited |
| `description` | STRING | Description |
| `description_en` | STRING | English description |
| `description_zh` | STRING | Chinese description |
| `similar_games` | STRING | Similar games |
| `calibrator` | STRING | Calibrator (who curated this combine) |
| `create_time` | DATETIME | Create time |
| `update_time` | DATETIME | Update time |
| `insert_time` | DATETIME | Insert time |
| `ext_json` | STRING | Extension JSON blob |
| `storage` | STRING | Storage size |
| `downloadable_contents` | STRING | DLC list |
| `release_dates_by_platform` | STRING | Per-platform release dates (JSON) |
| `steam_id` | STRING | Steam App ID |
| `language` | STRING | Language support (JSON, e.g. `{"English":{"Interface":1,"Subtitles":1},...}`) |
| `tag_list` | STRING | Tag list |
| `players` | STRING | Player modes |
| `in_app_purchase` | STRING | IAP info |
| `game_category` | STRING | Game category |
| `pre_order_time` | DATETIME | Pre-order time |

**NOT on `combined_detail`** (BigQuery error `Name X not found inside c` if you `SELECT c.X` anyway):

| Column | Use instead |
|--------|-------------|
| `edition_id`, `unified_id`, `app_id` (as ID columns) | `common.app_detail` with matching `id_type`, or `common.unified_combined_ids` / `common.unified_ids` |
| `id_type`, `release_time` | `common.app_detail` only |
| `f2p`, `game_pass`, `ps_plus` (boolean flags) | **Do not invent** — use `common.unified_business_model` (`source` = `'Free-to-Play'` / `'Xbox Game Pass'` / `'PlayStation Plus'`) |
| `alinea_price`, metric columns | `intelligence.game_metric_*` tables |

---

### unified_business_model

> **Shortcut for "is this PC game premium or F2P, today?"** — skip this table entirely and use `intelligence.game_metric_pconsole_daily_cid.gamalytic_price` (`>0` premium / `=0` F2P, ~99% catalog coverage). This `unified_business_model` table is required when you need: (a) the **timeline / transition date** of F2P conversion, (b) **mobile / console** business-model status (PC current-state is fine via the shortcut), or (c) **PlayStation Plus / Xbox Game Pass** coverage windows. See [pconsole-integrated-tables.md Pattern 7](pconsole-integrated-tables.md#pattern-7--premium-vs-f2p-filter-use-gamalytic_price-no-business-model-join).

**Business-model time-windowed log** — merges two data classes into a single table:

1. **Free-to-Play status** (`source='Free-to-Play'`, `status` ∈ {`pay`, `free`}) — captures the game's paid/free state and when it transitions (e.g. a paid title going F2P)
2. **Subscription coverage windows** (`source` ∈ {`PlayStation Plus`, `Xbox Game Pass`}, `status IS NULL`) — the intervals during which the game was available on a console subscription service

One game can have multiple rows — one per `(source, start_date)` interval. `end_date IS NULL` means the window is still open.

**Full table**: `common.unified_business_model`

| Field | Type | Description |
|-------|------|-------------|
| `unified_edition_id` | STRING | **Polymorphic game ID**: `unified_id` (mobile), `edition_id` (pc / console), or `combined_id` (combined) — the actual ID type is determined by `entity_type` |
| `entity_type` | STRING | `combined` / `pc` / `console` / `mobile` (schema allows mobile, but current data has none — see pitfalls) |
| `status` | STRING | `pay` / `free` for F2P rows; NULL for Subscription rows |
| `start_date` | DATE | Window start |
| `end_date` | DATE | Window end — NULL means the window is still open |
| `source` | STRING | `Free-to-Play` / `PlayStation Plus` / `Xbox Game Pass` |
| `ext1` | STRING | Extension field (currently `0` or NULL — semantics undocumented) |

**Key characteristics:**

- No date partitioning; clustered on `(unified_edition_id, source, start_date)` — point lookups by game ID are fast, full-table scans on other predicates are costly
- `entity_type = 'combined'` rows use `combined_id` (value has `c` prefix, e.g. `c00081343`); `pc` / `console` rows use `edition_id` (value has `e` prefix)
- Same `unified_edition_id` can appear under multiple `source` values — e.g. a `combined_id` may have a `Free-to-Play` row AND a `Xbox Game Pass` row

---

## Key Dimensions

### id_type values (app_detail)

- `app_id` — raw source ID (bundle_id / Steam URL / App Store numeric / IGDB URL, etc.)
- `unified_id` — DataBrain unified mobile ID (`u` prefix, always with `entity_type = 'mobile'`)
- `edition_id` — DataBrain single-platform PC / Console ID (`e` prefix)
- `entity_id` — entity aggregation ID (rarely used)

### entity_type values (app_detail)

- `mobile`
- `pc`
- `console`

### platform values (both tables, pipe-delimited)

- Mobile: `ios`, `android`, `ios|android`
- PC: `steam`, `PC`, `steam|PC`, `steam|PC|epic`
- Console: `Nintendo`, `PS`, `Xbox`, `Nintendo|PS`, etc.
- Cross-platform: `steam|PC|Xbox|Nintendo|PS`, `ios|android|steam|PC`, etc.

### iegg_genre values (both tables)

`Action` / `Casual` / `Adventure` / `Strategy` / `RPG` / `Simulation` / `Shooter` / `Racing` / `Sports` / `Gacha` / `Casino` / `Software` / `Hypercasual` / `Arcade` / `''` (empty for most rows)

> No first-class "Hyper Casual" category exists — approximate with `iegg_genre = 'Casual'` and label the approximation.

### Key differences between the two tables

| Aspect | `app_detail` | `combined_detail` |
|--------|--------------|-------------------|
| Primary key | `app_id` unique, semantics depend on `id_type` | `combined_id` unique |
| Grain | Single platform × single ID type | Cross-platform merged snapshot |
| `source` / `id_type` | Present | Absent |
| Release date type | `release_time` DATETIME | `release_date` STRING (`YYYY-MM-DD`) |
| Array columns | `array_developer/publisher/genre/sub_genre` | None — all pipe-delimited strings |
| Package size | `size` | Absent (use `storage`) |
| Extension columns | `ext1`–`ext5` + `ext_json` | Only `ext_json` |
| DLC / per-platform release | Absent | `downloadable_contents` / `release_dates_by_platform` |

### unified_business_model — `status` values

- `pay` — paid / up-front purchase (F2P rows, the baseline)
- `free` — free-to-play
- NULL — **not "unknown"**: it marks Subscription rows (PS Plus / Xbox Game Pass); their business-model status is "covered by subscription", not pay/free

### unified_business_model — `source` values

- `Free-to-Play` — tracks pay / free transitions (dominant share of rows)
- `PlayStation Plus` — PS Plus catalog coverage windows
- `Xbox Game Pass` — Xbox Game Pass coverage windows

### unified_business_model — `entity_type` values in practice

- `combined` — uses `combined_id` (most rows)
- `pc` — uses `edition_id`
- `console` — uses `edition_id`
- `mobile` — schema allows it, but currently **no rows** exist. Do not attempt to resolve mobile F2P status from this table.

---

## Common Query Patterns

### 1. Metadata lookup by `unified_id` / `edition_id`

```sql
SELECT entity_name, entity_type, platform, publisher, iegg_genre, release_time
FROM common.app_detail
WHERE app_id = 'ufc454d9b1af70b40588e2a6fa4da4a8b'
  AND id_type = 'unified_id'
```

### 2. Cross-platform metadata lookup by `combined_id` (combined_detail only)

```sql
SELECT combined_id, entity_name, developer, publisher,
       iegg_genre, tag_list, platform, steam_id, cover,
       release_date, release_date_str
FROM common.combined_detail
WHERE combined_id = 'c00002262'
LIMIT 1
```

### 2.1 `combined_id` + edition_id / F2P / Game Pass / PS Plus (multi-table)

Need platform IDs or subscription flags → **JOIN**; do not add those columns to `combined_detail`.

```sql
SELECT
  c.combined_id,
  c.entity_name,
  c.steam_id,
  c.release_date,
  c.iegg_genre,
  c.cover,
  uci.edition_id,
  uci.app_id,
  MAX(CASE WHEN b.source = 'Free-to-Play' AND b.end_date IS NULL
           THEN b.status END) AS f2p_status,
  MAX(CASE WHEN b.source = 'Xbox Game Pass' AND b.end_date IS NULL
           THEN 'active' END) AS xbox_game_pass,
  MAX(CASE WHEN b.source = 'PlayStation Plus' AND b.end_date IS NULL
           THEN 'active' END) AS ps_plus
FROM common.combined_detail c
LEFT JOIN common.unified_combined_ids uci
  ON uci.combined_id = c.combined_id
LEFT JOIN common.unified_business_model b
  ON b.unified_edition_id = c.combined_id
 AND b.entity_type = 'combined'
WHERE c.combined_id = 'c00065844'
GROUP BY c.combined_id, c.entity_name, c.steam_id, c.release_date,
         c.iegg_genre, c.cover, uci.edition_id, uci.app_id
LIMIT 1
```

Per-platform `app_detail` row (when you need one `edition_id` slice):

```sql
SELECT d.app_id, d.id_type, d.entity_name, d.platform, d.publisher, d.release_time
FROM common.app_detail d
WHERE d.app_id = '<edition_id>'
  AND d.id_type = 'edition_id'
LIMIT 1
```

### 2.5 Export PC/Console per-platform release dates (v2 canonical)

When the user asks for **PC/Console 分平台发布日期** (sub-platform + country granularity), do **NOT** use `app_detail.platform` — it is a coarse pipe-delimited label. Use:
- `common.combined_detail.release_dates_by_platform` (JSON string)
- structure: `[{platform, release_info:[{country, status, release_date}]}]`

```sql
WITH expanded AS (
  SELECT
    combined_id,
    entity_name,
    platform AS platforms_pipe,
    JSON_VALUE(p, '$.platform') AS platform,
    JSON_VALUE(i, '$.country') AS country,
    JSON_VALUE(i, '$.status') AS status,
    JSON_VALUE(i, '$.release_date') AS release_date_str,
    SAFE.PARSE_DATE('%Y-%m-%d', JSON_VALUE(i, '$.release_date')) AS release_date
  FROM common.combined_detail c
  CROSS JOIN UNNEST(JSON_QUERY_ARRAY(c.release_dates_by_platform)) AS p
  CROSS JOIN UNNEST(JSON_QUERY_ARRAY(p, '$.release_info')) AS i
  WHERE c.release_dates_by_platform IS NOT NULL
    AND JSON_VALID(c.release_dates_by_platform)
    -- Keep the export PC/Console-oriented (combined_detail may include mobile-only franchises)
    AND REGEXP_CONTAINS(LOWER(c.platform), r'(steam|pc|epic|playstation|ps|xbox|nintendo|switch)')
)
SELECT
  combined_id,
  entity_name,
  platform,
  country,
  status,
  release_date_str,
  release_date
FROM expanded
WHERE release_date BETWEEN DATE '2021-01-01' AND DATE '2025-12-31'
ORDER BY release_date, combined_id, platform, country
LIMIT 5000
```

### 3. Enrich a Gamalytic leaderboard with game names

```sql
SELECT g.edition_id,
       d.entity_name,
       d.publisher,
       MAX(g.revenue_total) - MIN(g.revenue_total) AS revenue
FROM intelligence.game_metric_gamalytic_daily g
LEFT JOIN common.app_detail d
  ON d.app_id = g.edition_id AND d.id_type = 'edition_id'
WHERE g.date BETWEEN '2026-03-01' AND '2026-03-31'
GROUP BY g.edition_id, d.entity_name, d.publisher
ORDER BY revenue DESC
LIMIT 20
```

### 4. Enrich a Sensortower leaderboard with game names

```sql
SELECT s.id AS unified_id,
       d.entity_name,
       d.publisher,
       SUM(s.revenue) AS revenue
FROM intelligence.game_metric_sensortower_monthly_uid s
LEFT JOIN common.app_detail d
  ON d.app_id = s.id AND d.id_type = 'unified_id'
WHERE s.date = '2026-03-01' AND s.market = 'global'
GROUP BY s.id, d.entity_name, d.publisher
ORDER BY revenue DESC
LIMIT 20
```

### 5. Genre-filtered candidate set (then join metrics)

```sql
SELECT r.unified_id, d.entity_name, SUM(s.download) AS downloads
FROM (
  SELECT DISTINCT app_id AS unified_id
  FROM common.app_detail
  WHERE id_type = 'unified_id'
    AND iegg_genre = 'RPG'
    AND entity_type = 'mobile'
) r
JOIN intelligence.game_metric_sensortower_monthly_uid s
  ON s.id = r.unified_id
LEFT JOIN common.app_detail d
  ON d.app_id = r.unified_id AND d.id_type = 'unified_id'
WHERE s.date = '2026-03-01' AND s.market = 'global'
GROUP BY r.unified_id, d.entity_name
ORDER BY downloads DESC
LIMIT 50
```

### 6. Expand a `combined_id` to all underlying `app_id`s

```sql
SELECT uci.app_id, uci.entity_type, uci.unified_id, uci.edition_id,
       d.entity_name, d.platform, d.publisher
FROM common.unified_combined_ids uci
LEFT JOIN common.app_detail d
  ON d.app_id = uci.app_id
WHERE uci.combined_id = 'c00002262'
```

### 7. Same-name game disambiguation

```sql
SELECT combined_id, entity_name, platform, publisher,
       release_date, iegg_genre, steam_id
FROM common.combined_detail
WHERE LOWER(entity_name) = 'diablo iv'
ORDER BY release_date DESC
```

### 8. Genre / gameplay fallback leaderboard (title + tag + subgenre matching)

For questions like "Mahjong recent-week download ranking" where no clean universal taxonomy exists, build a candidate app set from `common.app_detail` via title / tag / subgenre matching, de-duplicate to the latest `app_id`, then join the metric table and aggregate. Label the result as a **heuristic fallback** — localized package duplication may inflate totals.

```sql
WITH candidates AS (
  SELECT DISTINCT app_id AS unified_id
  FROM common.app_detail
  WHERE id_type = 'unified_id'
    AND entity_type = 'mobile'
    AND (
      LOWER(entity_name) LIKE '%mahjong%'
      OR LOWER(tag_list)  LIKE '%mahjong%'
      OR LOWER(iegg_sub_genre) LIKE '%mahjong%'
    )
)
SELECT c.unified_id, d.entity_name, SUM(s.download) AS downloads
FROM candidates c
JOIN intelligence.game_metric_sensortower_daily_uid s
  ON s.id = c.unified_id
LEFT JOIN common.app_detail d
  ON d.app_id = c.unified_id AND d.id_type = 'unified_id'
WHERE s.date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND CURRENT_DATE()
  AND s.market = 'global'
GROUP BY c.unified_id, d.entity_name
ORDER BY downloads DESC
LIMIT 20
```

### 9. Backfill `unified_id` when `app_detail` has only raw rows

Some games only have `id_type='app_id'` rows in `app_detail` (no `unified_id` row). Use `common.unified_ids` to recover the mapping:

```sql
SELECT DISTINCT unified_id
FROM common.unified_ids
WHERE app_id IN ('<bundle_id>', '<store_id>')
```

### 10. Current business model for a game

`end_date IS NULL` marks still-active windows. Join against `combined_detail` for a human-readable name.

```sql
SELECT b.unified_edition_id, b.entity_type, b.source, b.status,
       b.start_date, b.end_date,
       c.entity_name
FROM common.unified_business_model b
LEFT JOIN common.combined_detail c
  ON c.combined_id = b.unified_edition_id AND b.entity_type = 'combined'
WHERE b.unified_edition_id = 'c00002262'
  AND b.end_date IS NULL
ORDER BY b.source, b.start_date
```

### 11. When did a game switch from paid to free-to-play?

Look for the first `status='free'` row under the `Free-to-Play` source.

```sql
SELECT unified_edition_id, entity_type, status, start_date, end_date
FROM common.unified_business_model
WHERE source = 'Free-to-Play'
  AND unified_edition_id = ?        -- combined_id / edition_id
ORDER BY start_date
```

### 12. Games currently on Xbox Game Pass / PS Plus (enriched with names)

```sql
SELECT b.unified_edition_id AS combined_id,
       c.entity_name, c.publisher, c.release_date,
       b.source, b.start_date
FROM common.unified_business_model b
LEFT JOIN common.combined_detail c
  ON c.combined_id = b.unified_edition_id
WHERE b.source IN ('Xbox Game Pass', 'PlayStation Plus')
  AND b.entity_type = 'combined'
  AND b.end_date IS NULL               -- still on the service
ORDER BY b.source, b.start_date DESC
LIMIT 50
```

### 13. List all F2P games released after a cutoff date

Joins `Free-to-Play` rows back to `combined_detail` for release date + genre filtering.

```sql
SELECT b.unified_edition_id AS combined_id,
       c.entity_name, c.release_date, c.iegg_genre,
       b.start_date AS f2p_since
FROM common.unified_business_model b
JOIN common.combined_detail c
  ON c.combined_id = b.unified_edition_id
WHERE b.source = 'Free-to-Play'
  AND b.status  = 'free'
  AND b.entity_type = 'combined'
  AND b.end_date IS NULL                -- still free
  AND c.release_date >= '2023-01-01'
ORDER BY c.release_date DESC
LIMIT 50
```

---

## Pitfalls & Notes

1. **`app_detail.app_id` semantics depend on `id_type`**: the same raw string may appear under `id_type='app_id'` (raw bundle/store) and also under `id_type='unified_id'` (with `u`/`e` prefix). Always include `AND id_type = '<xxx>'` when filtering by `unified_id` / `edition_id` to avoid cross-type contamination.

2. **`combined_detail.release_date` is STRING**: compare with `PARSE_DATE('%Y-%m-%d', release_date)` when DATE semantics are needed, or rely on lexical comparison (the `YYYY-MM-DD` format is naturally sortable). Only `app_detail.release_time` is a true `DATETIME`.

3. **Pipe-delimited multi-value columns**: `platform` / `publisher` / `developer` / `publisher_id` / `developer_id` / `source` / `language` / `iegg_sub_genre` all use `|` as separator. Use `LOWER(publisher) LIKE '%blizzard%'` for simple matches, or `SPLIT(col, '|')` + `UNNEST` for exact multi-value expansion.

4. **PC/Console "per-platform release dates" is NOT `app_detail.platform`**: `app_detail.platform` is a coarse pipe-delimited label and does not provide sub-platform + country release dates. For exports like "2021-01-01..2025-12-31 PC&Console 分平台发布日期", use `common.combined_detail.release_dates_by_platform` and parse its JSON (see Pattern 2.5).

5. **Same-name `combined_id` duplicates**: same `entity_name` can map to many `combined_id`s (e.g. casino/Plinko variants). Always resolve names via `scripts/search_entity.py` instead of `LIKE entity_name` when possible.

6. **Some games have raw `app_id` rows only, no `unified_id` row**: use `common.unified_ids` to backfill `unified_id` (see [game-id-system.md](game-id-system.md)).

7. **`iegg_genre` is empty for most rows**: always add `WHERE iegg_genre != ''` for genre leaderboards. Treat hyper-casual as `iegg_genre = 'Casual'` and label the approximation.

8. **`combined_detail` has no `id_type` / `source`**: cannot tell which provider contributed a row. Fall back to `app_detail` or `common.unified_combined_ids` when provenance is needed.

8b. **Never `SELECT c.edition_id` / `c.app_id` / `c.f2p` / `c.game_pass` / `c.ps_plus` FROM `combined_detail c`** — those columns do not exist on `c` (error: `Name edition_id not found inside c`). See the **NOT on combined_detail** table above and [Pattern 2.1](#21-combined_id--edition_id--f2p--game-pass--ps-plus-multi-table).

9. **Gamalytic has no `entity_name`**: any Gamalytic leaderboard must `JOIN common.app_detail d ON d.app_id = g.edition_id AND d.id_type = 'edition_id'` to retrieve game names.

10. **`language` in `combined_detail` is a JSON string** (e.g. `{\"English\":{\"Interface\":1,\"Subtitles\":1},...}`) — parse with `JSON_EXTRACT_SCALAR`. `app_detail.language` is usually a plain text list.

11. **Array columns exist only in `app_detail`**: for IEGG sub-genre breakdowns, prefer `array_sub_genre` + `UNNEST` over `SPLIT(iegg_sub_genre, '|')`.

12. **No date partition on detail tables**: both tables use an internal `_p_key` partition key — do NOT filter on `_p_key`. ID-keyed lookups are served by the cluster key (`app_id` / `combined_id`).

13. **For publisher/developer profiles, follow the FK to `company_details.uuid`** — see [company-detail-tables.md](company-detail-tables.md).

14. **Multiple `unified_id`s may exist for the same game name**: e.g. Lords Mobile has both `u7f692976100a6ed255ad976e71185f51` and `ua02446d606953540008808df19d7eb92`. Always probe the metric table with **both** IDs to determine which one actually carries data before committing to a single ID.

15. **Top-N leaderboard enrichment — do not stop at opaque IDs**: for any user-facing leaderboard (weekly Top10 by revenue/DAU, etc.), first compute ranked IDs in the metric table as a subquery, then `LEFT JOIN common.app_detail` with the matching `id_type` (`unified_id` for mobile, `edition_id` for PC) to fetch human-readable `entity_name` + publisher. See Pattern #3 and #4.

### `unified_business_model` specifics

1. **`unified_edition_id` is polymorphic** — the column name is fixed but the value is a `combined_id` when `entity_type='combined'`, an `edition_id` when `entity_type` is `pc` / `console`, and in theory a `unified_id` when `entity_type='mobile'`. Always filter by `entity_type` alongside the ID when joining back to `combined_detail` / `app_detail`, otherwise the JOIN will silently miss or mismatch.

2. **No mobile rows in practice**: despite the schema allowing `entity_type='mobile'`, the table currently contains **zero** mobile rows. Do not try to look up a mobile game's F2P status from this table; return "not available" instead.

3. **`status=NULL` is NOT "unknown"**: NULL specifically marks Subscription rows (`PlayStation Plus` / `Xbox Game Pass`). Filter by `source` before interpreting `status`.

4. **`end_date IS NULL` = currently active**: always handle both cases when building period filters. Checking "covered by PS Plus on date X" requires `start_date <= X AND (end_date IS NULL OR end_date >= X)`.

5. **Same game can have multiple rows under different sources**: a title can simultaneously have a `Free-to-Play` row and a `Xbox Game Pass` row — do not deduplicate on `unified_edition_id` alone; include `source` in the key.

6. **No date partition; full scan on non-ID filters**: only clustered on `(unified_edition_id, source, start_date)`. Filtering by `unified_edition_id = ?` or prefix is fast; "all games currently on Game Pass" is a full scan — always add `LIMIT`.

7. **`ext1` has no documented semantics**: observed values are `0` / `None` — treat as opaque and do not rely on it for business logic.

