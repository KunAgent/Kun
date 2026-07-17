# Store Rankings

> Daily storefront ranking tables: `intelligence.game_metric_rank_mobile` + `intelligence.game_metric_rank_pconsole_all`.

Two daily ranking tables covering **storefront-level chart positions** across all major digital stores. Keyed by the **raw store `app_id`** (Sensortower ID for mobile, Steam / PS / Xbox / Epic / Nintendo IDs for PC/console) — not `unified_id` / `edition_id` / `combined_id`.

| Table | Coverage | Key | Partition |
|-------|----------|-----|-----------|
| `intelligence.game_metric_rank_mobile` | App Store / Google Play / TapTap | raw `app_id` + `source` + `date` | none (cluster on `date`, `app_id`) |
| `intelligence.game_metric_rank_pconsole_all` | Steam / PlayStation / Xbox / Epic / Nintendo (superset, recommended) | raw `app_id` + `package_id` + `source` + `date` | `DATE_TRUNC(date, MONTH)` + cluster on `source`, `date`, `app_id` |

> **Note on `game_metric_rank_pconsole_all` vs `game_metric_rank_pconsole`**: the `_all` variant is a superset of `game_metric_rank_pconsole`, adding the columns `package_id` / `rank_change` / `weeks` / `price` and the sources `daily steam top 100 sellers` / `daily steam top 100 players`. Always prefer `_all`.

> **For mobile**, use `intelligence.game_metric_rank_mobile` directly for all App Store / Google Play / TapTap charts, including `appstore top free`, `appstore top paid`, `appstore top grossing`, and `googleplay top popular`.

---

## Mobile Store Rankings

**Daily mobile-store rankings** — one row per game × source × platform × market × date.

**Full table**: `intelligence.game_metric_rank_mobile`

| Field | Type | Description |
|-------|------|-------------|
| `date` | DATE | Data date |
| `app_id` | STRING | Raw Sensortower / TapTap app ID |
| `source` | STRING | Chart name (e.g. `appstore top free`, `googleplay top grossing`, `taptap android top reserve`) — see Key Dimensions |
| `entity_type` | STRING | Always `mobile` |
| `entity_name` | STRING | Game name from data source (NOT the unified name) |
| `granularity` | STRING | Always `daily` |
| `platform` | STRING | `appstore` / `googleplay` |
| `region` | STRING | Region (`global`, `eur`, `sea`, `jpn`, …) |
| `market` | STRING | Country (lowercase ISO-2: `global` / `br` / `de` / `cn` / …) |
| `rank` | INT64 | Rank position (1-based) |
| `is_top3` / `is_top5` / `is_top10` / `is_top20` / `is_top50` / `is_top200` | INT64 | Pre-computed "in top-N" flags (1 / 0) |
| `is_bundle_sub_game` | INT64 | Steam bundle / sub-game flag (retained for schema parity; typically 0 for mobile) |
| `spider_time` | STRING | Crawl time |
| `insert_time` | TIMESTAMP | Insert time |

## `source` values (mobile)

**Use only the exact strings below** — any other value returns zero rows.

- **App Store**: `appstore top free`, `appstore top paid`, `appstore top grossing`, `appstore top today games`, `appstore top new games`
- **Google Play**: `googleplay top free`, `googleplay top paid`, `googleplay top grossing`, `googleplay top popular`, `googleplay top recommend`
- **TapTap**: `taptap android top reserve`, `taptap ios top reserve`

---

## PC / Console Store Rankings

**Daily PC / Console store rankings — aggregated superset**. One row per game × source × platform × market × date. Covers Steam / PlayStation / Xbox / Epic / Nintendo chart positions, pre-order / wishlist / upcoming boards, and the Steam daily top-100 sellers & players.

**Full table**: `intelligence.game_metric_rank_pconsole_all`

| Field | Type | Description |
|-------|------|-------------|
| `date` | DATE | Data date — **partition field** (`DATE_TRUNC(date, MONTH)`) |
| `app_id` | STRING | Raw store ID (Steam app ID, PS / Xbox / Epic / Nintendo native IDs) |
| `package_id` | STRING | Package / bundle ID (extra field vs. `game_metric_rank_pconsole`) |
| `source` | STRING | Chart name (see Key Dimensions) |
| `entity_type` | STRING | `pc` / `console` |
| `entity_name` | STRING | Game name from data source (NOT the unified name) |
| `granularity` | STRING | Always `daily` |
| `platform` | STRING | Always `unified` (PC/Console mixed) |
| `region` | STRING | Region (`global`, `eur`, `sea`, `jpn`, …) |
| `market` | STRING | Country |
| `rank` | INT64 | Rank position (1-based) |
| `rank_change` | INT64 | Rank change vs. previous day (extra vs. `game_metric_rank_pconsole`) |
| `is_top3` / `is_top5` / `is_top10` / `is_top20` / `is_top50` / `is_top200` | INT64 | Pre-computed "in top-N" flags |
| `is_bundle_sub_game` | INT64 | Steam bundle / sub-game flag (1 / 0) |
| `weeks` | INT64 | Weeks on the chart (extra vs. `game_metric_rank_pconsole`) |
| `price` | STRING | Current price on the store (extra vs. `game_metric_rank_pconsole`) |
| `spider_time` | STRING | Crawl time |
| `insert_time` | TIMESTAMP | Insert time |

## `source` values (PC / Console)

- **Steam**: `steam top sellers`, `steam top wish lists`, `steam upcoming`, `steam new and trending`, `daily steam top 100 sellers`, `daily steam top 100 players`
- **PlayStation**: `playstation best selling`, `playstation most downloaded`, `playstation new games`, `playstation free to play`, `playstation coming soon`, `playstation ps5 pre-orders`, `playstation ps5 best selling`, `playstation ps4 best selling`, `playstation indies games`, `playstation ps vr essentials`
- **Xbox**: `xbox top paid`, `xbox top free`, `xbox most played`, `xbox best rated`, `xbox new release`, `xbox upcoming`
- **Epic**: `epic top sellers`, `epic most played`, `epic top popular`, `epic top player rated`, `epic new releases`, `epic coming soon`, `epic top upcoming wishlisted`
- **Nintendo**: `nintendo best sellers`, `nintendo new release`, `nintendo coming soon`

---

## Store Rankings — Common Query Patterns

### Today's top 20 on a specific chart (mobile)

> **`game_metric_rank_mobile` has NO `combined_id` column** — the schema only contains `app_id` (raw Sensortower ID), `entity_name`, `rank`, `source`, `platform`, `market`, `date`, and `is_top*` flags. Never SELECT or JOIN on `combined_id` directly from this table. To enrich with game metadata, join through `common.unified_ids` (see template below).

```sql
SELECT rank, entity_name, app_id, market
FROM intelligence.game_metric_rank_mobile
WHERE date = CURRENT_DATE()
  AND source = '<chart_source>'  -- use exact value from `source` values (mobile) above, e.g. 'appstore top grossing'
  AND market = '<market>'
ORDER BY rank
LIMIT 20
```

### Track specific games' daily rank on a mobile chart (multi-game, date range)

> **NEVER filter by game name string** — the server scans the full SQL text including string literals for forbidden keywords (e.g. `'Call of Duty'` triggers `CALL` → 61003 error). This table has no `unified_id` column; use the JOIN pattern below to filter by ID.

**Use this pattern** when the user asks for rank history of a fixed set of games (e.g. "鸣潮/原神/崩铁 在 iOS 畅销榜的排名 过去30天"):
1. Resolve each game's `unified_id` via `search_entity.py` (returns `mobile_id` = unified_id).
2. `INNER JOIN common.unified_ids` on `app_id` (with `source='sensortower'` and `entity_type='mobile'`) to filter to the target games, then `LEFT JOIN common.app_detail` for the display name — all in one query.
3. **do NOT select `combined_id`** from `game_metric_rank_mobile` (column does not exist in this table).

> **`market` values**: lowercase ISO-2 country code (e.g. `'cn'` China, `'jp'` Japan, `'kr'` South Korea, `'us'` US, `'gb'` UK, `'tw'` Taiwan, `'de'` Germany, …) or `'global'` for worldwide. This is not an exhaustive list — use the standard ISO-2 code for any country.

> **Multi-package note**: one `unified_id` may map to multiple `app_id` rows in `common.unified_ids` (regional variants). If duplicate `(date, unified_id, market)` rows appear, deduplicate with `QUALIFY ROW_NUMBER() OVER (PARTITION BY r.date, ui.unified_id, r.market ORDER BY r.rank) = 1`.

```sql
SELECT
  r.date,
  d.entity_name AS game_name,
  r.rank,
  r.market
FROM intelligence.game_metric_rank_mobile r
INNER JOIN common.unified_ids ui
  ON ui.app_id = r.app_id
  AND ui.source = 'sensortower'
  AND ui.entity_type = 'mobile'
LEFT JOIN common.app_detail d
  ON d.app_id = ui.unified_id AND d.id_type = 'unified_id'
WHERE ui.unified_id IN (<mobile_id_game1>, <mobile_id_game2>, ...)
  AND r.source = '<chart_source>'  -- use exact value from `source` values (mobile) above, e.g. 'appstore top grossing'
  AND r.market = '<market>'
  AND r.date BETWEEN '<start_date>' AND '<end_date>'
ORDER BY r.date, r.rank
LIMIT 1000
```

> **Multi-market in one query**: replace `r.market = '<market>'` with `r.market IN ('<market1>', '<market2>', ...)` and add `r.market` to `SELECT` + `ORDER BY`.

### Today's Steam top-sellers global

```sql
SELECT rank, entity_name, app_id, rank_change, price, weeks
FROM intelligence.game_metric_rank_pconsole_all
WHERE date = CURRENT_DATE()
  AND source = 'steam top sellers'
  AND market = 'global'
ORDER BY rank
LIMIT 50
```

> **Note**: `price` in `game_metric_rank_pconsole_all` may be **NULL for an entire day** (some ranking crawls don't fill price reliably). When the user wants "current price" (no date specified), use the enrichment template below and take `pconsole_daily_cid.alinea_price` as **latest non-null within a 30-day window** (`MAX_BY(..., date)`), not `MAX(price)`. Fall back to `gamalytic_price` only when `alinea_price` is NULL across the window. When the user asks for the price on a specific date, honor that date and return whatever the table shows (possibly NULL).

### Per-game rank history (30-day trend on one chart)

```sql
SELECT date, rank, rank_change
FROM intelligence.game_metric_rank_pconsole_all
WHERE app_id = ?
  AND source = 'steam top sellers'
  AND market = 'global'
  AND date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) AND CURRENT_DATE()
ORDER BY date
```

### Games that stayed on a chart longest (Steam Top Sellers, last 90 days)

```sql
SELECT app_id, ANY_VALUE(entity_name) AS entity_name,
       COUNT(*) AS days_on_chart,
       MIN(rank) AS best_rank, AVG(rank) AS avg_rank
FROM intelligence.game_metric_rank_pconsole_all
WHERE source = 'steam top sellers'
  AND market = 'global'
  AND date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY) AND CURRENT_DATE()
GROUP BY app_id
ORDER BY days_on_chart DESC, avg_rank ASC
LIMIT 30
```

### Enrich a rank row with `unified_id` / `edition_id` + game metadata

```sql
SELECT r.date, r.source, r.rank, r.entity_name AS raw_name,
       ui.unified_id, ui.edition_id, d.entity_name AS unified_name,
       d.publisher, d.iegg_genre
FROM intelligence.game_metric_rank_pconsole_all r
LEFT JOIN common.unified_ids ui
  ON ui.app_id = r.app_id
LEFT JOIN common.app_detail d
  ON d.app_id = COALESCE(ui.unified_id, ui.edition_id)
WHERE r.date = CURRENT_DATE()
  AND r.source = 'xbox most played'
ORDER BY r.rank
LIMIT 20
```

### Steam Top Sellers + pconsole enrichment (recommended template) — PC/Console ONLY

> **[IMPORTANT] THIS TEMPLATE IS FOR `game_metric_rank_pconsole_all` (Steam / PS / Xbox) ONLY.** Do NOT apply it to `game_metric_rank_mobile`. The `combined_id` column referenced here does NOT exist in `game_metric_rank_mobile`. For mobile chart enrichment, use the "Track specific games' daily rank on a mobile chart" template above.

Full enrichment of a Steam Top Sellers ranking with wishlists / reviews / revenue / pricing / DAU, in a single query. This is the **canonical path** for "today's top Steam games with their core commercial metrics" (no date specified by user → default to "latest"). Do **not** try to join the ranking straight to `game_metric_alinea_daily` / `game_metric_gamalytic_daily` raw (the `edition_id` ↔ `combined_id` path is lossy). The pconsole JOIN below uses the **default-latest pattern** — a 30-day window + per-column non-null aggregation — because the integrated columns are sparsely populated and a single-day JOIN matches only ~6% of rows. **If the user specifies a date** (e.g. "top sellers on 2026-03-15 with their wishlists at that time"), replace both the ranking filter and the pconsole window with that date and accept the higher NULL rate as a faithful answer.

> **Prefix preference**: use the **`alinea_*`** columns (preferred Steam feed; includes `alinea_dau`, no Gamalytic equivalent). `gamalytic_*` is a legacy parallel feed in the same wide table — only fall back if `alinea_*` is NULL for the window. Don't `COALESCE(alinea_x, gamalytic_x)` into a single headline number (see [`pconsole-integrated-tables.md` Pitfall 3a](pconsole-integrated-tables.md#pitfalls--pconsole-integrated-tables)).

```sql
SELECT
  r.rank,
  r.entity_name,
  uci.combined_id,
  MAX(CASE WHEN p.alinea_wishlists_total IS NOT NULL
      THEN p.alinea_wishlists_total END) AS wishlists_total,
  MAX(CASE WHEN p.alinea_follower_total IS NOT NULL
      THEN p.alinea_follower_total END) AS followers,
  MAX(CASE WHEN p.alinea_cumulative_revenue IS NOT NULL
      THEN p.alinea_cumulative_revenue END) AS cum_revenue,
  MAX(CASE WHEN p.alinea_cumulative_units IS NOT NULL
      THEN p.alinea_cumulative_units END) AS cum_units,
  MAX(CASE WHEN p.alinea_dau IS NOT NULL
      THEN p.alinea_dau END) AS peak_dau,
  MAX_BY(
    p.alinea_price,
    CASE WHEN p.alinea_price IS NOT NULL THEN p.date END
  ) AS alinea_price_latest,
  MAX(CASE WHEN p.all_reviews_count IS NOT NULL AND p.all_reviews_count > 0
      THEN p.all_reviews_count END) AS reviews,
  MAX(CASE WHEN p.all_reviews_score IS NOT NULL AND p.all_reviews_score > 0
      THEN p.all_reviews_score END) AS review_score,
  MAX(CASE WHEN p.meta_score IS NOT NULL AND p.meta_score > 0
      THEN p.meta_score END) AS meta
FROM (
  SELECT rank, entity_name, app_id
  FROM intelligence.game_metric_rank_pconsole_all
  WHERE date = CURRENT_DATE()
    AND source = 'steam top sellers'
    AND market = 'global'
) r
LEFT JOIN common.unified_combined_ids uci
  ON uci.app_id = r.app_id
LEFT JOIN intelligence.game_metric_pconsole_daily_cid p
  ON p.combined_id = uci.combined_id
  AND p.date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
                  AND CURRENT_DATE()
GROUP BY r.rank, r.entity_name, uci.combined_id
ORDER BY r.rank
LIMIT 50
```

**Why this shape**:

- **Ranking → `common.unified_combined_ids` via `app_id`** (Steam store URL): ~98% hit rate, cleanest mapping to `combined_id`.
- **`pconsole_daily_cid` JOINed on `combined_id` + 30-day window + per-column aggregation**: this is the **default-latest** pattern that compensates for sparse column population. Measured on a recent run, a single-day JOIN matched only 3 out of 50 rows; the 30-day window matched 48. For **price**, use **latest non-null** (`MAX_BY`) rather than `MAX(price)`.
- **Use `alinea_*` prefix, not `gamalytic_*`**: post-Alinea integration, the wide table carries both prefixes in parallel; `alinea_*` is the preferred feed and additionally exposes `alinea_dau` (Steam DAU). Fall back to `gamalytic_*` only if `alinea_*` is NULL across the entire window for a row.
- **Do not try ranking → `game_metric_alinea_daily` / `game_metric_gamalytic_daily` raw**: the ranking table exposes Steam URLs (`app_id`), not `edition_id` / `combined_id`. The wide-table JOIN above is the canonical path now that both Alinea and Gamalytic columns are co-located in `pconsole_*_cid`.
- **When user specifies a date**: drop the 30-day window. Filter both `r.date` and `p.date` to the user's date (or date range) — even if many `alinea_*` / `gamalytic_*` / reviews columns end up NULL, that's the faithful "as of that date" answer. Don't widen the window without telling the user.
- Adapt the inner subquery's `source` / `market` filter for other PC charts (`steam most played`, `steam top sellers cn`, `epic top sellers`, …).

### "Newly charted this week" — top games appearing for the first time

Games whose `MIN(date) on the chart` falls within the last 7 days.

```sql
SELECT app_id, ANY_VALUE(entity_name) AS entity_name,
       MIN(date) AS first_chart_day, MIN(rank) AS best_rank
FROM intelligence.game_metric_rank_mobile
WHERE source = '<chart_source>'  -- use exact value from `source` values (mobile) above
  AND market = '<market>'
  AND date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY) AND CURRENT_DATE()
GROUP BY app_id
HAVING MIN(date) >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
ORDER BY best_rank
LIMIT 20
```

---

## Store Rankings — Pitfalls

1. **Always scope `source` AND `market`**: `source` + `market` + `date` form the natural chart unit. Without `source` you mix App Store / Google Play / Steam / PS rows; without `market` you mix US / JP / global. Both filters are also cluster keys (for `pconsole_all`), so they help performance.
2. **Always filter `date`**: `game_metric_rank_pconsole_all` partitions on `date` (monthly); `game_metric_rank_mobile` is only clustered on `date`. In both cases unbounded scans are expensive.
3. **`app_id` is the raw store ID — NOT `unified_id` / `edition_id`**: to join into the metric tables or detail tables, go through `common.unified_ids` (mobile → `unified_id`; PC/console → `edition_id`).
4. **`entity_name` is the store-raw name, not the canonical one**: use it for display only; for stable identity or grouping across stores, resolve to `unified_id` / `edition_id` and JOIN `common.app_detail` / `common.combined_detail`.
5. **Prefer `game_metric_rank_pconsole_all` over `game_metric_rank_pconsole`**: the `_all` table is a superset (includes `rank_change`, `price`, `weeks`, `package_id`, plus the two `daily steam top 100 *` sources). The non-`_all` table is effectively a legacy subset.
6. **Mobile ranks live in `game_metric_rank_mobile`**: this table is the source of truth for mobile chart positions. It is keyed by raw `app_id`; join through `common.unified_ids` when you need `unified_id` / canonical game metadata, and join Sensortower metric tables separately when revenue / DAU are also needed.
7. **`is_topN` columns are pre-computed flags**: use `WHERE is_top10 = 1` as a fast filter when you only need top-10 rows — avoids `ORDER BY rank LIMIT 10` per group.
8. **`rank_change = NULL` on a game's first day**: the first observation of a game on a chart has no previous day to diff against.
9. **`price` is STRING**: `price` on `pconsole_all` is stored as text (to accommodate currency formatting / "Free" / "—"). Parse with `SAFE_CAST(REGEXP_REPLACE(price, r'[^0-9.]', '') AS FLOAT64)` when numeric comparison is needed.
10. **Long historical tail on PC/Console**: `pconsole_all` data goes back to 2005-12-27. Old rows may have missing columns or sparsely populated `rank_change` / `weeks`.
11. **Never add `GROUP BY` to a plain rank lookup** — both `game_metric_rank_mobile` and `game_metric_rank_pconsole_all` are detail tables keyed by `(app_id, source, market, date)` (one row per combination). Adding a `GROUP BY` is unnecessary and causes a BigQuery error: `ORDER BY clause expression references column 'rank' which is neither grouped nor aggregated`. Use `SELECT … WHERE … ORDER BY rank` directly — no aggregation needed.
12. **`game_metric_rank_mobile` has NO `combined_id` column** — selecting or filtering `combined_id` on this table causes `Error 400: Unrecognized name: combined_id`. The "Steam Top Sellers + pconsole enrichment" template uses `uci.combined_id` but that template is **PC/Console only** (`game_metric_rank_pconsole_all`). For mobile chart queries, resolve game identity via `common.unified_ids` (returns `unified_id`), not `common.unified_combined_ids` (returns `combined_id`). See the "Track specific games' daily rank on a mobile chart" template above for the correct mobile multi-game pattern.
13. **NEVER filter by game name string — always use `app_id` / `unified_id`**: The server-side SQL security scanner performs a full-text regex scan on the entire SQL string, including string literals. Game names containing forbidden substrings will trigger a 61003 security error even though the SQL is valid — e.g. `WHERE entity_name LIKE '%Call of Duty%'` triggers the `CALL` keyword ban. **Always resolve the game to a `unified_id` via `search_entity.py` first, then filter with `WHERE ui.unified_id = '<id>'`** (see the "Track specific games' daily rank" template above). This is also the correct approach for identity stability — `entity_name` varies across markets and time.
14. **Empty result diagnosis — check in this order, then accept the result**: (1) Verify `source` is an exact string from the `source values` list above. (2) Verify `market` is lowercase ISO-2 (e.g. `vn`, `pk`, `in`, `np`, `bd`). (3) Confirm the `unified_id` maps to `app_id` rows in `common.unified_ids` with `source='sensortower'` and `entity_type='mobile'`. (4) Run a `COUNT(*)` without the game filter to confirm the table has data for those market+date combinations. If all checks pass and the result is still empty, the game is not ranked on that chart for those markets/dates — report `null` rank. **Do NOT fall back to `LIKE` patterns or game name strings as a workaround.**
