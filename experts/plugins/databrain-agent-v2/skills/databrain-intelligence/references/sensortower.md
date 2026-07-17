# Sensortower

> Canonical mobile tables for DataBrain Text2SQL. Do **not** use `intelligence.game_metric_mobile_daily` / `intelligence.game_metric_mobile_monthly`; route mobile metrics to the Sensortower tables documented here.

**Commercial data source** providing mobile app market intelligence.

> **Always use `_uid` tables** (`game_metric_sensortower_*_uid`). Raw tables (`game_metric_sensortower_daily/weekly/monthly`) are off-limits except:
> - `entity_name` LIKE fallback when a title has no `_uid` rows → [`fallback_entity_name.sql`](../examples/sensortower/fallback_entity_name.sql)
> - `region` column breakdown (not available in `_uid` views)

## `_uid` Views (default)

Three views keyed by **unified_id** (`id` field, a `u`-prefixed hash). Use these when you have a unified_id instead of a Sensortower app_id.

| Table | Granularity | Activity field | Date anchor |
|---|---|---|---|
| `intelligence.game_metric_sensortower_daily_uid`| Daily | `dau` | Any date  |
| `intelligence.game_metric_sensortower_weekly_uid`  | Weekly| `wau` | Sunday |
| `intelligence.game_metric_sensortower_monthly_uid` | Monthly  | `mau` | 1st of month |

**Full table names (BigQuery):**
- `tencent-databrain-prod.intelligence.game_metric_sensortower_daily_uid`
- `tencent-databrain-prod.intelligence.game_metric_sensortower_weekly_uid`
- `tencent-databrain-prod.intelligence.game_metric_sensortower_monthly_uid`

> All three are **views** defined as `SELECT * FROM ..._uid_q2`. The underlying `_uid_q2` physical tables are partitioned by `DATE_TRUNC(date, MONTH)`, so a `WHERE date ...` filter prunes those partitions through the view.

**Schema (shared by all three views):**

| Field | Type | Notes |
|---|---|---|
| `id`| STRING  | unified_id(i.e. mobile_id) (`u`-prefixed hash) |
| `date` | DATE | Data date — partition key on the underlying `_uid_q2` table (`DATE_TRUNC(date, MONTH)`) |
| `platform`| STRING  | `appstore` / `googleplay` (lowercase)|
| `market`  | STRING  | `global` / `global_wo_china` / `us` / `jp` / ... |
| `revenue` | FLOAT64 | Revenue within the period (USD)|
| `download`| INT64| Downloads within the period |
| `dau` / `wau` / `mau` | INT64| Active users — `dau` on daily, `wau` on weekly, `mau` on monthly|
| `cumulative_download` | INT64| Cumulative downloads  |
| `cumulative_revenue`  | FLOAT64 | Cumulative revenue (USD) |

> `arpu` = average revenue per user. IE = Revenue/Avtive Users

> `daily_uid` and `monthly_uid` views also expose `insert_time TIMESTAMP`; the `weekly_uid` view does **not** — don't reference `insert_time` in queries that target weekly.

> The `_uid` views are metric-only. They do **not** have `entity_name`, `game_name`, `region`, or ranking columns. Use `market` for country / aggregate-market slices. If you need `region`, use the raw `app_id` Sensortower tables instead.

> **Getting entity names — exact JOIN syntax for `_uid` tables:**
> ```sql
> LEFT JOIN common.app_detail d
>ON d.app_id = m.id -- m.id is the unified_id in _uid tables
>  AND d.id_type = 'unified_id'  -- MUST filter; other id_type rows are raw bundle/store IDs
> ```


## Table C — Demographics (user profile)

User demographics / audience profile for a mobile app (gender & age distribution + confidence). Physical table; `source = 'sensortower_demographics'`, `entity_type = 'mobile'`.

| Table | `granularity` values | Key | Notes |
|---|---|---|---|
| `intelligence.game_metric_sensortower_demographics` | `all_time` / `quarterly` | `app_id` + `platform` + `market` + `date` (+ `granularity`) | Metrics: `female` / `male` (gender share, **0–1 fraction**), age buckets `female_0/18/25/35/45/55` and `male_0/18/25/35/45/55` (each is **that gender×age cell as a fraction of total audience**, 0–1), plus `average_age_total` and `confidence`. |

> This table is keyed by raw Sensortower `app_id` (NOT `unified_id`). If you need to query by unified_id, resolve to `app_id` first via `common.unified_ids` (filter `source='sensortower'` and `entity_type='mobile'`), then join on `app_id`. Always filter by a specific `granularity` value — mixing `all_time` and `quarterly` double-counts.

### 🎯 Granularity default — fallback to `all_time` when no period is mentioned

**If the user does NOT mention a quarter / time window / specific period (e.g. just "MLBB 的用户画像 / demographic"), default to `granularity = 'all_time'`.** This matches the DataBrain web UI's 用户画像 tab "全周期" view. Only use `granularity = 'quarterly'` when the user explicitly asks for a quarter / recent / time-windowed snapshot (then filter the specific `date`, e.g. `'2026-01-01'` for Q1 2026).

| User intent | granularity | date filter |
|---|---|---|
| No period mentioned ("用户画像 / demographic / 受众") — **default** | `'all_time'` | take latest via `QUALIFY ROW_NUMBER() ... ORDER BY date DESC` (all_time is anchored at the launch date, so don't hardcode a date) |
| "最近 / 本季度 / 某季度 / 趋势" | `'quarterly'` | specific quarter start, e.g. `date = '2026-01-01'`; for a trend, range over multiple quarters |

### Field &口径 traps (verified against web UI 用户画像)

1. **`platform` values are `android` / `ios`** here (NOT `appstore` / `googleplay` like the `_uid` tables). **Google Play = `platform = 'android'`**; App Store = `platform = 'ios'`.
2. **Values are 0–1 fractions** — multiply by 100 for percentages (`female + male = 1.0`).
3. **Under-18 is not collected**: `female_0` / `male_0` are `NULL`. The web UI's "Age <25" therefore equals the **18–24 bucket** (`female_18 + male_18`).
4. **Web UI age groups are gender-combined** — add the two genders per age bucket: `Age 25–34 = female_25 + male_25`, etc. My per-gender rows must be summed to reconcile with the web page.
5. **Pick the canonical store package per platform** — a title has many regional sub-apps under one `unified_id` (MLBB ≈ 14 variants). Filter to the main package (highest `confidence`), e.g. MLBB → `com.mobile.legends` (android / Google Play) + `1160056295` (ios). Joining ALL variants inflates rows and mixes regional profiles.
6. **`all_time` rows are anchored at the launch date** (e.g. MLBB → `2015-08-01`) and updated in place; always take the latest row per `(app_id, platform)` via `QUALIFY`, never assume `date = CURRENT_DATE()`.

### Example — reproduce the web UI 用户画像 (global, all-time, Google Play)

```sql
SELECT
  d.platform,
  ROUND(d.male*100,1)   AS male_pct,
  ROUND(d.female*100,1) AS female_pct,
  -- web UI "Age <25" = under-18 (NULL) + 18–24 bucket, both genders combined
  ROUND((IFNULL(d.female_0,0)+IFNULL(d.male_0,0)+d.female_18+d.male_18)*100,1) AS age_under25,
  ROUND((d.female_25+d.male_25)*100,1) AS age_25_34,
  ROUND((d.female_35+d.male_35)*100,1) AS age_35_44,
  ROUND((d.female_45+d.male_45)*100,1) AS age_45_54,
  ROUND((d.female_55+d.male_55)*100,1) AS age_55p
FROM intelligence.game_metric_sensortower_demographics d
WHERE d.app_id = 'com.mobile.legends'  -- Google Play 主包；iOS 用 '1160056295'
  AND d.market = 'global'
  AND d.granularity = 'all_time'        -- default when no period mentioned
QUALIFY ROW_NUMBER() OVER (PARTITION BY d.platform ORDER BY d.date DESC) = 1
LIMIT 5
```

Resolving `app_id` from a unified_id (when you only have the mobile_id):

```sql
SELECT app_id
FROM common.unified_ids
WHERE unified_id = 'u...'
  AND source = 'sensortower'
  AND entity_type = 'mobile'
```

---

## Sensortower Query Decision Guide

### Metric → Table Matrix

| Metric needed | Use this table | Note |
|---|---|---|
| MAU | **monthly `_uid`** | `mau` field — direct|
| Monthly revenue / downloads | **monthly `_uid`** | `revenue` / `download` fields|
| WAU | **weekly `_uid`**  | `wau` field — direct (date must be Sunday)  |
| Weekly revenue / downloads  | **weekly `_uid`**  | `revenue` / `download` aggregated over ISO week ending Sunday |
| DAU | **daily `_uid`**| `dau` field — direct|
| Monthly avg DAU | **daily `_uid`**| `AVG(dau)` aggregated per month |
| Daily revenue / downloads| **daily `_uid`**| `revenue` / `download` fields|
| Cumulative downloads / revenue | **any `_uid`**  | Take latest row's `cumulative_*`|

### Field Traps

1. **Monthly table `date` must be the 1st of the month** — use `'2025-03-01'`, not `'2025-03'` or `'2025-03-15'`.
2. **Weekly table `date` must be Sunday** — use `'2026-04-12'`, not a mid-week date. Align target dates with `DATE_TRUNC(target_date, WEEK(SUNDAY))` or pick the Sunday directly.
3. **Each activity field lives in exactly one granularity table**: `dau` → daily only, `wau` → weekly only, `mau` → monthly only. Querying the wrong one returns NULL or an `Unrecognized name` error.
4. **`platform` values are always lowercase**: `appstore` (iOS) and `googleplay` (Android).
5. **Use `UNNEST([...])` CTE to pass ID lists** — BigQuery supports hundreds of IDs this way.
6. **BigQuery scans by partition cost** — always include a `date` range filter. `_uid` tables partition by `DATE_TRUNC(date, MONTH)`; raw `app_id` tables are cluster-only on `date`, so narrow date ranges are still important.
7. **Market trap for CN-dominant titles** — in some Sensortower mobile records, `market='global'` may equal `market='cn'` exactly (rather than true worldwide aggregate). If `global` and `cn` are identical for the same date/platform, describe the result as this source's available market coverage (often effectively China iOS), not confirmed global total revenue.
8. **`market` values are lowercase ISO-2 codes**: use `market = 'cn'`, not `'CN'`; same for `'us'` / `'jp'` / `'kr'` / `'global'`. Uppercase returns **zero rows**. Note: `market` has no implicit "default" in queries — every row carries an explicit `market` value (per-country slices AND a pre-computed `'global'` rollup); always filter explicitly to avoid double-counting (see Pitfall #11 / #15).
9. **DAU is only populated for large markets**: `global` plus a handful (`cn`, `us`, `jp`, `kr`, etc.). Small countries (`iq`, `ve`, `gh`, …) return `dau IS NULL` even when `download` and `revenue` are populated. Probe with `SELECT dau FROM ... WHERE market='xx' AND dau IS NOT NULL LIMIT 1` before relying on DAU for a niche market.
10. **`revenue` can be NULL while `download` / `dau` are populated**: for some titles / markets / periods on daily tables, revenue is simply not covered. Never auto-coerce NULL revenue to 0; describe it as "revenue not reliably covered for that slice".
11. **`_uid` tables are per-platform rows**: for the same `(id, date, market)` you typically get **two rows** (`platform='appstore'` and `platform='googleplay'`). Any query that expects “one row per day” must either `GROUP BY date, market` (omit `platform`) or aggregate explicitly.
12. **`revenue` / `download` are per-platform period increments**: to get iOS+Android totals, use `SUM(revenue)` / `SUM(download)` and group without `platform` (e.g. `GROUP BY date, market`).
13. **`cumulative_revenue` / `cumulative_download` are platform-specific running totals**: you must take `MAX` **within each platform** first, then sum platforms in an outer query. Do **NOT** use `MAX(cumulative_revenue)` directly, or you'll only keep the larger platform and drop the other.

 ```sql
 SELECT SUM(cum_rev) AS lifetime_revenue, SUM(cum_dl) AS lifetime_download
 FROM (
SELECT platform,
 MAX(cumulative_revenue) AS cum_rev,
 MAX(cumulative_download) AS cum_dl
FROM intelligence.game_metric_sensortower_monthly_uid
WHERE id = ?
  AND market = 'global'
  AND date >= '2012-01-01'
GROUP BY platform
 ) t
 ```

14. **Correct two-step aggregation for DAU / WAU / MAU over a multi-period window**:

   The `_uid` tables store one row per `(id, date, platform, market)`. To get the average AU over a date range:

   **Step 1 — SUM across platforms per period** (inner query):
   
   ```sql
   SELECT id, date, SUM(dau) AS au   -- or SUM(wau), SUM(mau)
   FROM intelligence.game_metric_sensortower_daily_uid --or weekly_uid, monthly_uid
   WHERE ...
   GROUP BY id, date
   ```

   **Step 2 — AVG across periods(days/weeks/months)** (outer query):
   ```sql
   SELECT id, AVG(au) AS avg_dau
   FROM (...inner query...)
   GROUP BY id
   ```

   | What | Correct | Wrong |
   |---|---|---|
   | Combined iOS+Android AU per day/week/month | `SUM(dau/wau/mau) GROUP BY id, date` | reading a single row (one platform only) |
   | Average AU over N periods | `AVG(inner.au)` | `SUM(dau)` across all rows (adds periods together) |
   | Average AU across platforms without date grouping | — | `AVG(dau) GROUP BY id` directly (mixes platforms and dates) |

   Always group by `(id, date)` first (Step 1), then `AVG` across dates (Step 2). Never `SUM` AU across dates.
15. **Unified monthly trends need `SUM ... GROUP BY date`**: `game_metric_sensortower_monthly_uid` can have multiple rows per month for the same title (iOS + Android both under `market='global'`). Always aggregate; never read raw rows directly.
16. **Prefer daily_uid for rolling last-N-days**: for last-7/30-day, month-to-date, or short country-trend questions, `game_metric_sensortower_daily_uid` is the right table — not the monthly tables.
17. **Exclude synthetic aggregates when querying "real countries"**: `market='global'` and `'global_wo_china'` are synthetic totals. Add `market NOT IN ('global', 'global_wo_china')` for country-level rankings and share analysis.
18. **Lowercase `platform` values for `_uid` tables**: `appstore` / `googleplay`. (Same rule as raw tables — restated here because it's the single most common copy-paste mistake.)
19. **Daily tables have T-1 ~ T-2 ingestion lag** — `WHERE date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)` ("yesterday") routinely returns **zero rows** because the data isn't yet ingested. For any "today / yesterday / latest day" question, **use a single query with `ORDER BY date DESC LIMIT 1`** — do NOT split into two separate tool calls:
 ```sql
 -- Preferred: single-pass, fetch latest available day's data directly
 SELECT date, SUM(dau) AS dau
 FROM intelligence.game_metric_sensortower_daily_uid
 WHERE id = ? AND market = 'global'
 GROUP BY date
 ORDER BY date DESC
 LIMIT 1
 ```
 Do **not** probe `MAX(date)` in a separate tool call first — embed it in the same query. Same lag applies to `_daily` (raw) and `_daily_uid`.
20. **With a unified_id, go to the `_uid` table — don't fall back to entity_name on the raw table.**
21. **`_uid` MAU aggregation — two valid patterns depending on goal**:

   `game_metric_sensortower_monthly_uid` stores one row per `(id, platform, market)`. Two common aggregation patterns — both can be correct:

   | Goal | Pattern | Note |
   |---|---|---|
   | **Cross-game MAU ranking** (relative order) | `_uid` + inner `SUM(mau) GROUP BY id, date` → outer `AVG ... ORDER BY` | Sums iOS+Android per month; all games equally affected so ranking order is preserved. Label output as "iOS+Android summed MAU". See [`topn_mau_ranking.sql`](../examples/sensortower/topn_mau_ranking.sql) |
   | **Absolute MAU number** (single game or external report) | Per-platform only (`WHERE platform = 'appstore'`), or raw table `game_metric_sensortower_monthly GROUP BY entity_name` | Raw table is pre-aggregated at source; no double-count |

   Do **not** do `SUM(mau) GROUP BY id` across a multi-month range without date grouping — that sums months together. Always group by `(id, date)` first, then `AVG` across months.
22. **`common.app_detail` has no `unified_id` column and no `name` column** — game name is `entity_name`. The join key is `app_id`. **Correct JOIN to get game name from a `_uid` metric table:**
```sql
-- CORRECT: join app_detail on app_id = m.id, use entity_name
JOIN common.app_detail ad ON ad.app_id = m.id AND ad.id_type = 'unified_id'
SELECT ad.entity_name AS game_name   -- NOT ad.name, NOT ad.app_name, NOT ad.game_name
```
If `search_entity.py` returned a `mobile_id`, use `WHERE id = '<mobile_id>'` directly in the `_uid` table without joining `app_detail` for the filter.

---

## Sensortower Common Query Patterns

All SQL files live in [`examples/sensortower/`](../examples/sensortower/). Copy one file at a time into `execute_sql.py --sql`; never run the whole directory.

| File | Use when |
|---|---|
| [`rolling_revenue_downloads.sql`](../examples/sensortower/rolling_revenue_downloads.sql) | Near N-day revenue / downloads for a single title    |
| [`country_topn_revenue.sql`](../examples/sensortower/country_topn_revenue.sql)| Top-N countries by revenue|
| [`lifetime_revenue.sql`](../examples/sensortower/lifetime_revenue.sql)| Launch-to-date / lifetime revenue (monthly + partial-month stitch)|
| [`monthly_trend.sql`](../examples/sensortower/monthly_trend.sql)   | Monthly revenue / download / MAU trend (iOS + Android combined)   |
| [`platform_pivot.sql`](../examples/sensortower/platform_pivot.sql) | Per-platform DAU/revenue pivot (no platform specified by user)    |
| [`multi_country_trend.sql`](../examples/sensortower/multi_country_trend.sql)  | Multi-country daily DAU trend (SEA example) |
| [`two_game_comparison.sql`](../examples/sensortower/two_game_comparison.sql)  | Two-game side-by-side daily comparison    |
| [`country_revenue_share.sql`](../examples/sensortower/country_revenue_share.sql)| Per-country revenue share (%) for a title |
| [`macro_region_share.sql`](../examples/sensortower/macro_region_share.sql)    | Macro-region revenue share (NA / EU / JP+KR / CN / SEA)|
| [`topn_mau_ranking.sql`](../examples/sensortower/topn_mau_ranking.sql)| **Top-N MAU ranking across all games** — use raw table, no double-count |
| [`fallback_entity_name.sql`](../examples/sensortower/fallback_entity_name.sql)| Fallback when `_uid` tables return zero rows|

> **Retention** (D2/D3/D7/D15/D31, monthly cohort, MAU-weighted, legacy lifetime) → **[`sensortower-retention.md`](sensortower-retention.md)**. SQL examples: [`retention_unified.sql`](../examples/sensortower/retention_unified.sql), [`retention_weighted_multi.sql`](../examples/sensortower/retention_weighted_multi.sql), [`retention_per_platform.sql`](../examples/sensortower/retention_per_platform.sql), [`retention_lifetime.sql`](../examples/sensortower/retention_lifetime.sql).

> The `_uid` views have **no `region` column**. For region-level breakdowns, query the raw `app_id` tables (`game_metric_sensortower_<daily|weekly|monthly>`, no `_uid` suffix) which do have `region`. For **weekly / monthly** variants of the pivot pattern: swap `dau` → `wau` / `mau`. The `_uid` views don't carry `entity_name` — join `common.app_detail` for canonical metadata.

### Pattern: All products by a company (Downloads + DAU)

**Use case**: "查询厂商 X 在某月某市场的所有产品的月下载量和 DAU"

**Key rules**:
- `common.company_details` primary key is **`uuid`** (NOT `company_id`). The `entity_id` returned by `search_entity.py --type company` maps to `company_details.uuid`.
- **To find a company's games**: join `common.app_detail.publisher_id` or `developer_id` → `company_details.uuid`. Filter `id_type = 'unified_id'` to get the `app_id` = unified_id for `_uid` metric tables. `publisher_id`/`developer_id` may be pipe-delimited multi-value — use `SPLIT(...,'|')[SAFE_OFFSET(0)]` for the primary, or `UNNEST(SPLIT(...,'|'))` for all.
- **Do NOT use `unified_ids.entity_id`** to filter by company — it cannot be joined to `company_details.uuid` (verified: JOIN returns zero rows).
- DAU for a month = `AVG(dau)` over daily rows (Step 1: `SUM(dau) GROUP BY id, date`; Step 2: `AVG`). Alternatively query `mau` from the monthly table directly.

```sql
-- Monthly downloads + avg DAU for all products of a company (May 2026, US, iOS+Android)
-- '<company_uuid>' = entity_id from search_entity.py --type company

WITH company_games AS (
  SELECT DISTINCT ad.app_id AS unified_id, ad.entity_name
  FROM common.app_detail ad
  WHERE ad.id_type = 'unified_id'
    AND (
      SPLIT(ad.publisher_id, '|')[SAFE_OFFSET(0)] = '<company_uuid>'
      OR SPLIT(ad.developer_id, '|')[SAFE_OFFSET(0)] = '<company_uuid>'
    )
),
monthly_dl AS (
  SELECT id, SUM(download) AS total_downloads
  FROM intelligence.game_metric_sensortower_monthly_uid
  WHERE date = '2026-05-01'
    AND market = 'us'
    AND id IN (SELECT unified_id FROM company_games)
  GROUP BY id
),
daily_dau AS (
  SELECT id, AVG(daily_sum) AS avg_dau
  FROM (
    SELECT id, date, SUM(dau) AS daily_sum
    FROM intelligence.game_metric_sensortower_daily_uid
    WHERE date >= '2026-05-01' AND date < '2026-06-01'
      AND market = 'us'
      AND id IN (SELECT unified_id FROM company_games)
    GROUP BY id, date
  )
  GROUP BY id
)
SELECT
  cg.entity_name,
  dl.total_downloads AS downloads,
  dd.avg_dau AS dau
FROM company_games cg
LEFT JOIN monthly_dl dl ON dl.id = cg.unified_id
LEFT JOIN daily_dau dd ON dd.id = cg.unified_id
WHERE dl.total_downloads IS NOT NULL OR dd.avg_dau IS NOT NULL
ORDER BY downloads DESC NULLS LAST
```

> **Do NOT use `company_id` as a column name in `company_details`** — it does not exist. Always use `uuid`.
> **Do NOT use `unified_ids.entity_id`** to filter by company — it cannot be joined to `company_details.uuid` (verified empty).
