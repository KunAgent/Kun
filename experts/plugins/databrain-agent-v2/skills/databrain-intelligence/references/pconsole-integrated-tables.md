# PC/Console Integrated Wide Tables (RECOMMENDED entry points)

> PC/Console integrated wide tables: `game_metric_pconsole_daily_cid` / `_weekly_cid` / `_monthly_cid`. They pre-join Alinea + Gamalytic + Ampere + MScience + Streamhatchet + reviews + metascore + social mentions + Steam spider into a single wide row keyed by `combined_id`. **Recommended first stop for multi-metric PC/Console questions** (revenue + DAU + reviews + live PCU via `spider_steam_*`). **未上线 / upcoming** with fuzzy release dates → [`examples/alinea_queries.sql` Pattern 6](../examples/alinea_queries.sql), not this wide table's `release_date` alone.
>
> Two cross-cutting traps apply (both documented once in [intelligence-sources.md → Cross-source conventions § 8](intelligence-sources.md#cross-source-conventions), do not repeat here):
> - 🚨 **`combined_id`-only join key** (no `edition_id` / `unified_id` columns; using them returns 0 rows silently).
> - 🚨 **Sparse-fill** — when fetching "latest" (no date specified by user), default to a 30-day window + per-column non-null aggregation. **Honor user-specified dates exactly** instead of silently widening the window.
>
> **Fall back to a raw source table** when you need:
> 1. **T-0 / T-1 fresh Ampere DAU** — the `ampere_*` columns here lag ~12 days; use `intelligence.game_metric_ampere_daily_cid` directly.
> 2. **`unified_id` granularity** rather than `combined_id` (e.g. for streaming / news / store rank cross-joins).
> 3. **Single-source clean semantics** for a serious external **revenue / units** number — this family is labelled "Integrated / Estimated" and is trend-only. For calibrated revenue / units use [DataBrain Calibration](databrain-calibration.md).
> 4. **Fields not in the wide table** (e.g. `rank`, `rank_change`, `price_history`).
> 5. **Per-day Alinea delta where you care about the exact `revenue` / `units_sold` daily column** rather than `alinea_premium_*` / `alinea_cumulative_*` (the raw Alinea table exposes the daily delta directly without subtraction). See [`alinea.md`](alinea.md) for that pattern.

## Schema overview (~95 / ~85 / ~130 cols, confirmed post-Alinea integration)

| Table | Columns | Cycle | Key fields unique to this table |
|------|----|------|---------------------|
| `game_metric_pconsole_daily_cid` | **~95** | DAY | Steam (Alinea + Gamalytic + spider) + Console DAU + reviews + mentions in the same row: `alinea_dau`, `alinea_pcu`, `alinea_cumulative_revenue`, `gamalytic_cumulative_revenue`, `ampere_dau`, `mentions`, `meta_score`, `streamhatchet_hours_watched`, **`release_date` / `release_day`** |
| `game_metric_pconsole_weekly_cid` | ~85 | WEEK | **GSD European retail** — `gsd_digital_revenue/units`, `gsd_physical_revenue/units` (alinea_* prefix coverage in weekly/monthly variants may lag — probe `MIN(date)` per prefix) |
| `game_metric_pconsole_monthly_cid` | **~130** | MONTH | **Ampere expanded to 21 columns** — `mau`, `mau_new`, `mau_returning`, `stickiness`, `churn`, 6 `time_spent_Nh` buckets, `d1` / `d7` / `d28` retention, `avg_monthly_playtime`, `avg_days_played`, `player_share`, `acquisition_number`; plus `npd_*` North-American monthly sales |

> Column counts grew vs the pre-Alinea documentation (was 74 / 63 / 111) because the **Alinea integration added 17 columns** to the daily variant plus 2 `spider_steam_*` columns. Always run `python scripts/fetch_schema.py --table_ids <id> --format ai` once if your query depends on a column existing in a specific variant — `alinea_*` is **confirmed live in `_daily_cid`**; coverage in `_weekly_cid` / `_monthly_cid` may not be fully populated yet.

Note: `alinea_cumulative_{}` / `gamalytic_cumulative_{}` delta is computed over \((start_date, end_date]\); e.g., 2026-04-02 → 2026-04-05 counts 2026-04-03–05 only (excludes 2026-04-02).

**Source-prefix groups in `_daily_cid`** (the prefix identifies which vendor the column comes from):

| Prefix | Source | Columns (daily / monthly) | Status |
|-----|---|----|------|
| **`alinea_*`** | **Alinea Analytics (Steam) — DEFAULT** | **17** / probe | ✅ **Preferred Steam prefix.** Mirrors all 15 Gamalytic columns + adds `alinea_dau`, `alinea_wishlist_countries`. `pcu`/`acu` aggregate same-day but the **catalog is still ramping on T-0 (~24K filled by midday vs ~141K by T-1)**; `dau`/`revenue`/`units_sold`/`wishlists_total`/`followers_total` are **T-1**. Covers ~141K games per day at steady state. |
| `gamalytic_*` | Gamalytic (Steam) — LEGACY | 15 / 15 | ⚠️ **Legacy parallel feed.** Same metrics as `alinea_*` minus DAU / wishlist_countries. **T-1** typical. **Broader coverage** — ~338K games/day, 2× Alinea — so use as a coverage fallback for long-tail / niche Steam titles. |
| **`spider_steam_*`** | Steam spider crawl (PCU/ACU only) — **best for "today"** | 2 | ✅ **Guaranteed T-0** real-time Steam-API crawler — no aggregation lag. **Lives on a DIFFERENT slice** — `segment IS NULL` (not `segment='All'`) — so a normal `WHERE segment='All'` query will NEVER see it. Use as the **primary source for today's PCU/ACU**; also independent cross-validation reading vs Alinea/Gamalytic. |
| `ampere_*` | Ampere (Console) | 13 / **21** | ⚠️ ~12-day lag |
| `mscience_*` | M Science (PC/Console digital sales) | 9 / 9 | ⚠️ ~5-day lag |
| `streamhatchet_*` | Streamhatchet (streaming) | 4 / 4 | ✅ T-1 |
| `npd_*` | NPD (North-American console) | — / 2 | monthly only |
| `gsd_*` | GSD (European console) | — / — | **weekly only** (exposed in `pconsole_weekly_cid` as un-prefixed `gsd_digital_revenue` etc.) |
| `steam_*` | Steam raw (deprecated columns) | 11 / 11 | **Abandoned / not populated** — all 11 `steam_*` columns measure as NULL; do NOT select them. Use `alinea_*` instead. |
| un-prefixed | Cross-source derived | 16 | `meta_score`, `all_reviews_count`, `all_reviews_score`, `mentions`, `positive_social`, `negative_social`, `positive_store`, `negative_store`, `recommend`, `non_recommend`, `top_countries`, `follower_total`, `wishlists`, `wishlists_total` (last 2 NULL, deprecated — use `alinea_wishlists*`), **`release_date` / `release_day`** (game release info — already in this table, no need to JOIN `common.combined_detail` just for release date) |

> **No `entity_name` column** in any `pconsole_*_cid` variant. For the displayed game name you must `LEFT JOIN common.combined_detail d ON d.combined_id = p.combined_id` (use `d.entity_name`) — or `common.app_detail` if you've fanned out by `unified_id`. Don't try to read the name off `pconsole_*_cid` directly.

## Source coverage matrix by `(platform, segment)`

This wide table mixes **game sales metrics + streaming + social mentions** — three very different domains — routed by the `(platform, segment)` tuple. **Using the wrong filter yields lots of NULLs or missing data**:

| `platform` | `segment` | Source columns actually populated | `market` values | Purpose |
|----|----|---|---|---|
| `PC` | `'All'` | **`alinea_*` (PREFERRED)**, `gamalytic_*` (legacy parallel), `mscience_*`, `all_reviews_*`, `mentions`, `follower_total`. **NO `spider_steam_*` / `meta_score` here** | **`global` only** | Steam sales / DAU (`alinea_dau`) / wishlist / reputation overview |
| `PC` | `NULL` (SQL NULL) | **`spider_steam_pcu` / `spider_steam_acu` only** (~21K rows/day) | `global` | Raw Steam-API PCU/ACU scrape — independent from alinea/gamalytic. Different slice — won't show up in `segment='All'` queries. |
| `PlayStation` / `Xbox` / `Nintendo` | `'All'` | `mscience_*`, `mentions`, `positive_/negative_social`, `all_reviews_*`, `ampere_*` | **per-country** (`us` / `gb` / `fr` / `de` / `jp` / …) + `global` | Console sales / retention / reputation |
| `PC` / `PlayStation` / `Xbox` | `''` (empty string) | **`meta_score` only** | — | Metacritic-only rows |
| `twitch` | `NULL` | **`streamhatchet_*` only** | — | Streaming metrics |
| `youtube` / `tiktok` / `twitter` / `reddit` / `instagram` / `facebook` / `bilibili` / `douyin` / … | `'All'` | `mentions`, `positive_social`, `negative_social` | — | Social buzz and sentiment per platform |

## Per-source data freshness (latency)

| Source | Latest available date | Lag | Notes |
|----|----|----|----|
| `spider_steam_pcu` / `spider_steam_acu` | **Today** | **T-0 (guaranteed)** | Real-time crawler — populated as games are scraped, no aggregation lag. Lives on `segment IS NULL` slice (PC global, ~21K rows/day). **The most reliable source for "today's PCU/ACU"** — Alinea hasn't finished aggregating today's full catalog yet. |
| `alinea_pcu` / `alinea_acu` | Today (partial) / Yesterday (complete) | **T-0 partial → T-1 complete** | Pre-aggregated Alinea estimate. Same-day rows exist but **catalog is still ramping** (e.g. ~24K games filled by midday on T-0 vs ~141K by T-1). Use `gamalytic_pcu` / `spider_steam_pcu` if a specific game is missing on T-0. |
| `alinea_dau` / `alinea_revenue` / `alinea_units_sold` / `alinea_wishlists_total` / `alinea_followers_total` | Yesterday | **T-1** | Estimate / cumulative columns settle 1 day behind, no T-0 path. For "today's revenue" / "today's DAU" → not yet available, report "latest available = yesterday". |
| `gamalytic_*` | Yesterday | **T-1** | All columns; 1 day behind Alinea PCU. Useful when alinea is NULL for a specific game (Gamalytic covers ~2× the Steam catalog Alinea covers). |
| `mentions` / `meta_score` / `all_reviews_*` | Today | **T-0** | |
| `streamhatchet_*` | Yesterday | T-1 | |
| `mscience_*` | T-5 | Moderate lag | |
| `ampere_*` | **T-12** | ⚠️ **Significant** — "yesterday's Console DAU" returns NULL; fall back to `game_metric_ampere_daily_cid` |
| `steam_*` | NULL | — | Entire prefix abandoned |
| `wishlists` / `wishlists_total` (no-prefix) | NULL | — | Abandoned — use `alinea_wishlists` / `alinea_wishlists_total` (preferred) or `gamalytic_wishlists*` (legacy) instead |

## Filter templates (must follow)

```sql
-- A. PC sales / reputation overview (Steam) — prefer alinea_*
WHERE platform = 'PC'
  AND segment  = 'All'
  AND market   = 'global'
  AND alinea_pcu IS NOT NULL   -- alinea_pcu: T-0 partial (NOT real-time); dau/revenue/wishlists: T-1

-- A2. Steam DAU (unique to alinea_*; no Gamalytic equivalent) — T-1 ceiling
WHERE platform = 'PC'
  AND segment  = 'All'
  AND market   = 'global'
  AND alinea_dau IS NOT NULL

-- A3. Real-time Steam-API PCU/ACU (segment IS NULL slice — use for 实时 / "right now")
WHERE platform = 'PC'
  AND segment IS NULL
  AND market   = 'global'
  AND spider_steam_pcu IS NOT NULL
-- Do not combine A and A3 in the same WHERE — they sit on different segment slices.

-- B. Console DAU (per-country) — using ampere_*
WHERE platform IN ('PlayStation', 'Xbox', 'Nintendo')
  AND segment  = 'All'
  AND market  IN ('us','gb','fr','de','jp','br','ca','au','it','mx','ru','pl','es','zz')
  AND ampere_dau IS NOT NULL   -- the 12-day lag leaves NULLs; always filter

-- C. Console monthly MAU / retention / playtime distribution (unique to this table)
WHERE platform IN ('PlayStation','Xbox','Nintendo')
  AND segment  = 'All'
  AND ampere_mau IS NOT NULL
-- Only available in game_metric_pconsole_monthly_cid

-- D. Streaming hours watched
WHERE platform IN ('twitch','youtube','ytg','facebook')
  AND segment IS NULL
  AND streamhatchet_hours_watched IS NOT NULL

-- E. Social buzz / sentiment
WHERE platform IN ('twitter','reddit','tiktok','instagram','youtube','facebook')
  AND segment  = 'All'
  AND mentions IS NOT NULL
```

## Common query patterns — pconsole_*_cid

### Pattern 1 — Single-game PC/Console overview in one query (replaces a 5-table JOIN)

```sql
SELECT
  date, detailed_platform,
  -- Sales / units (Steam → Alinea preferred)
  alinea_cumulative_revenue, alinea_premium_revenue, alinea_premium_units,
  mscience_total_revenue, mscience_total_units,
  -- Engagement
  alinea_acu, alinea_pcu, alinea_dau,        -- Steam DAU exclusive to alinea_*
  ampere_dau,                                -- Console DAU
  -- Demand
  alinea_wishlists_total, alinea_follower_total,
  -- Quality
  all_reviews_score, all_reviews_count, meta_score,
  -- Buzz
  mentions, positive_social, negative_social,
  -- Streaming
  streamhatchet_hours_watched, streamhatchet_peak_viewers
FROM intelligence.game_metric_pconsole_daily_cid
WHERE combined_id = 'c00001765'                  -- CS2
  AND date = '2026-04-20'
  AND segment = 'All'
  AND market  IN ('global', 'us', 'gb')          -- 'global' rows give PC, per-country rows give console
  AND platform IN ('PC','PlayStation','Xbox','Nintendo')
ORDER BY platform, market
```

> **Legacy variant** — if `alinea_*` is NULL (e.g. for dates before the Alinea cutover, or a title not yet covered), substitute `gamalytic_premium_revenue` / `gamalytic_pcu` / `gamalytic_wishlists_total` etc. Don't mix the two prefixes in the same headline number.

### Pattern 2 — Cross-title Steam revenue ranking (via daily delta sum)

```sql
SELECT combined_id,
       SUM(alinea_premium_revenue) AS revenue_delta,
       MAX(alinea_wishlists_total) AS wishlists_peak,
       MAX(alinea_dau)             AS peak_dau,
       MAX(all_reviews_score)      AS review_score
FROM intelligence.game_metric_pconsole_daily_cid
WHERE platform = 'PC' AND segment = 'All' AND market = 'global'
  AND date BETWEEN '2026-01-01' AND '2026-03-31'
  AND alinea_premium_revenue IS NOT NULL
GROUP BY combined_id
ORDER BY revenue_delta DESC
LIMIT 50
```

### Pattern 3 — Console monthly MAU + retention + playtime (no other table provides this)

```sql
SELECT FORMAT_DATE('%Y-%m', date) AS month,
       platform, detailed_platform, market,
       ampere_mau, ampere_mau_new, ampere_mau_returning,
       stickiness, churn,
       time_spent_0h, time_spent_1h, time_spent_5h, time_spent_10h, time_spent_25h, time_spent_50h,
       d1, d7, d28,
       avg_monthly_playtime, avg_days_played
FROM intelligence.game_metric_pconsole_monthly_cid
WHERE combined_id = 'c00002262'                  -- Diablo IV
  AND platform IN ('PlayStation','Xbox')
  AND segment = 'All'
  AND date >= DATE '2025-10-01'
  AND ampere_mau IS NOT NULL
ORDER BY month DESC, platform, market
```

### Pattern 4 — European console digital sales (GSD weekly, keyed by combined_id)

```sql
SELECT FORMAT_DATE('%Y-%U', date) AS week, platform, detailed_platform,
       gsd_digital_revenue, gsd_digital_units,
       gsd_physical_revenue, gsd_physical_units
FROM intelligence.game_metric_pconsole_weekly_cid
WHERE combined_id = 'c00002262'
  AND platform IN ('PlayStation','Xbox','Nintendo')
  AND segment = 'All'
  AND date >= DATE '2025-10-01'
  AND (gsd_digital_revenue IS NOT NULL OR gsd_physical_revenue IS NOT NULL)
ORDER BY week DESC, platform
```

### Pattern 5 — Batch full-catalog picture (all games with Steam data on a given day)

```sql
-- Note: this is an expensive full-scan pattern; always tighten the date range
SELECT date, combined_id,
       alinea_premium_revenue, alinea_dau, alinea_acu, alinea_pcu,
       all_reviews_score, mentions
FROM intelligence.game_metric_pconsole_daily_cid
WHERE platform = 'PC' AND segment = 'All' AND market = 'global'
  AND date = '2026-04-20'
  AND alinea_premium_revenue IS NOT NULL
ORDER BY alinea_premium_revenue DESC
LIMIT 200
```

### Pattern 6 — First-month / since-release window using the table's own `release_date` (no detail-table JOIN)

The wide table already carries `release_date` and `release_day` per row, so for "since-release" / "first-month" / "first-week" questions you don't need to JOIN `common.combined_detail` for the launch date — only JOIN if you also need `entity_name` / `publisher` / `iegg_genre` etc.

> ⚠️ On **`pconsole_*_cid`**, `release_date` is **`DATE`** (already normalized to a calendar day, or NULL). Use it directly in `DATE_DIFF` / `BETWEEN` — **do not** `REGEXP_CONTAINS` / `PARSE_DATE` / `SUBSTR` it (those are for **`common.combined_detail.release_date`**, which is STRING and may be fuzzy — see Pitfall #11). See Pitfall #11.

```sql
-- First-month cumulative revenue + days-since-release annotation, single title
SELECT date,
       release_date,
       DATE_DIFF(date, release_date, DAY) AS days_since_release,
       alinea_cumulative_revenue,
       alinea_wishlists_total,
       alinea_dau,
       all_reviews_score
FROM intelligence.game_metric_pconsole_daily_cid
WHERE combined_id = 'c00001765'                  -- swap in target combined_id
  AND platform = 'PC'
  AND segment  = 'All'
  AND market   = 'global'
  AND release_date IS NOT NULL
  AND date BETWEEN release_date
              AND DATE_ADD(release_date, INTERVAL 30 DAY)
ORDER BY date
```

```sql
-- Add entity_name only when you also need the display name
SELECT p.combined_id, d.entity_name, p.release_date,
       p.alinea_cumulative_revenue, p.alinea_dau, p.all_reviews_score
FROM intelligence.game_metric_pconsole_daily_cid p
LEFT JOIN common.combined_detail d ON d.combined_id = p.combined_id
WHERE p.combined_id IN ('c00001765', 'c00002262')
  AND p.platform = 'PC' AND p.segment = 'All' AND p.market = 'global'
  AND p.date = '2026-04-20'
```

### Pattern 7 — Premium vs F2P filter (use `alinea_price`, no business-model JOIN)

For PC titles, the cleanest paid/free filter is the in-table Steam price directly. **Prefer `alinea_price`; fall back to `gamalytic_price` only when `alinea_price IS NULL`**:

- `price > 0` → **premium** (one-time purchase / Buy-to-Play)
- `price = 0` → **F2P** (free-to-play, IAP/ad monetised)
- `price IS NULL` → **unknown** (~1% of catalog; handle as a separate bucket or fall back to `common.unified_business_model`)

Use this in-table over a `LEFT JOIN common.unified_business_model` whenever you only need the **current** paid/free flag (not the F2P-conversion timeline or Game Pass / PS Plus coverage windows — those still require the business-model table; see [game-detail-tables.md](game-detail-tables.md#unified_business_model)).

Always pull the **latest non-null** price within a 30-day window (sparse-fill rule applies — see Pitfall #2):

```sql
-- Top 20 PC premium games by Q1 2026 revenue (Alinea preferred, Gamalytic fallback)
WITH per_game AS (
  SELECT combined_id,
    COALESCE(
      MAX_BY(alinea_price,    CASE WHEN alinea_price    IS NOT NULL THEN date END),
      MAX_BY(gamalytic_price, CASE WHEN gamalytic_price IS NOT NULL THEN date END)
    ) AS latest_price,
    SUM(COALESCE(alinea_premium_revenue, gamalytic_premium_revenue)) AS q1_revenue
  FROM intelligence.game_metric_pconsole_daily_cid
  WHERE platform = 'PC' AND segment = 'All' AND market = 'global'
    AND date BETWEEN '2026-01-01' AND '2026-03-31'
  GROUP BY combined_id
)
SELECT g.combined_id, d.entity_name, g.latest_price, g.q1_revenue
FROM per_game g
LEFT JOIN common.combined_detail d ON d.combined_id = g.combined_id
WHERE g.latest_price > 0          -- premium only
  AND g.q1_revenue IS NOT NULL
ORDER BY g.q1_revenue DESC
LIMIT 20
```

### Pattern 8 — Steam source selection: freshness (today) + coverage (long tail)

> **CCU routing**: live Steam API → [`steam-ccu.md`](steam-ccu.md) + `scripts/fetch_steam_ccu.py`; warehouse spider + Alinea trends → [`examples/steam_ccu_queries.sql`](../examples/steam_ccu_queries.sql).

For Steam PCU/ACU/revenue/wishlists, three providers sit on the wide table — two on `segment='All'` (Alinea + Gamalytic) and one on `segment IS NULL` (spider). They differ on **two independent dimensions**: freshness (for "today") and catalog coverage:

| Provider | Slice | Catalog coverage (PC global / day) | Freshness | Use as |
|---|---|---|---|---|
| `spider_steam_pcu` / `acu` | `segment IS NULL` | ~5–21K rows/day | **Guaranteed T-0** (real-time crawler) | **Primary for "today's" PCU/ACU** — Alinea hasn't finished aggregating today's catalog yet |
| `alinea_*` | `segment='All'` | ~141K games at steady state | T-0 partial (still ramping mid-day) → T-1 complete; DAU/revenue/wishlists/followers T-1 only | **Default** for yesterday-and-older and for non-PCU metrics (DAU, revenue, wishlists) |
| `gamalytic_*` | `segment='All'` | ~338K games (~2.4× Alinea) | T-1 across the board | **Coverage fallback** when a game is in the long tail Alinea doesn't cover |

**Decision matrix for PCU/ACU specifically:**

| Query date | First choice | Why |
|---|---|---|
| **Today (T-0)** | `spider_steam_pcu/acu` (from `segment IS NULL`) | Crawler — guaranteed fresh; Alinea may still be partial. |
| **Yesterday (T-1) and older** | `alinea_pcu/acu` (from `segment='All'`) | Fully populated estimate; ~141K catalog. |
| **Game missing from Alinea** | `gamalytic_pcu` (from `segment='All'`) | 2× catalog reach. Label the swap. |

For revenue / DAU / wishlists / followers — Alinea / Gamalytic only (no spider equivalent), and T-1 is the freshest you can get.

```sql
-- "Today's PCU for game X" — prefer spider, fall back to alinea/gamalytic for yesterday
SELECT date, segment,
       spider_steam_pcu, alinea_pcu, gamalytic_pcu,
       COALESCE(spider_steam_pcu, alinea_pcu, gamalytic_pcu) AS pcu_best,
       CASE
         WHEN spider_steam_pcu IS NOT NULL THEN 'spider (T-0 crawler)'
         WHEN alinea_pcu       IS NOT NULL THEN 'alinea'
         WHEN gamalytic_pcu    IS NOT NULL THEN 'gamalytic (coverage fallback)'
         ELSE NULL
       END AS pcu_source
FROM intelligence.game_metric_pconsole_daily_cid
WHERE combined_id = 'c00001765'
  AND platform = 'PC' AND market = 'global'
  -- Important: include BOTH segment slices in the same query
  AND (segment = 'All' OR segment IS NULL)
  AND date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY) AND CURRENT_DATE()
ORDER BY date DESC, segment NULLS FIRST
```

> Each row in the result above is one (date, segment) combination — the `segment IS NULL` row will hold the spider data, the `segment='All'` row will hold alinea+gamalytic. If you want one row per date, aggregate with `MAX(...)` over the two segments:

```sql
SELECT date,
       MAX(spider_steam_pcu) AS spider_pcu,
       MAX(alinea_pcu)       AS alinea_pcu,
       MAX(gamalytic_pcu)    AS gamalytic_pcu,
       COALESCE(MAX(spider_steam_pcu), MAX(alinea_pcu), MAX(gamalytic_pcu)) AS pcu_best
FROM intelligence.game_metric_pconsole_daily_cid
WHERE combined_id = 'c00001765'
  AND platform = 'PC' AND market = 'global'
  AND (segment = 'All' OR segment IS NULL)
  AND date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND CURRENT_DATE()
GROUP BY date
ORDER BY date DESC
```

> When you publish a single headline number that COALESCEs sources, **label the swap** (e.g. "PCU 1,381,333 — from `spider_steam` (crawler T-0)"). Don't silently splice; for serious external numbers pick one provider and stick with it — see Pitfall #3a.

For **non-PCU/ACU Steam metrics** (revenue / DAU / wishlists / followers) — spider has no equivalent, so fall back to the Alinea→Gamalytic coverage flow within `segment='All'`:

```sql
SELECT date,
       COALESCE(alinea_revenue,         gamalytic_premium_revenue)  AS revenue_best,
       COALESCE(alinea_wishlists_total, gamalytic_wishlists_total)  AS wishlists_best,
       CASE WHEN alinea_revenue IS NOT NULL THEN 'alinea'
            WHEN gamalytic_premium_revenue IS NOT NULL THEN 'gamalytic (coverage fallback)'
            ELSE NULL END AS revenue_source
FROM intelligence.game_metric_pconsole_daily_cid
WHERE combined_id = 'c00001765'
  AND platform = 'PC' AND segment = 'All' AND market = 'global'
  AND date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND CURRENT_DATE()
ORDER BY date DESC
LIMIT 14
```

## Pitfalls — pconsole integrated tables

(The two cross-cutting `*_cid` traps — `combined_id`-only key and sparse-fill / 30-day window — are noted in the file lead and detailed in [Cross-source conventions § 8](intelligence-sources.md#cross-source-conventions). Pitfalls below are pconsole-specific.)

1. **Must label as "DataBrain Integrated (trend-only estimate)"**: this family is officially Integrated / Estimated data — see [source-descriptions.md](source-descriptions.md) "DataBrain Integrated" section. **For serious external numbers, fall back to the raw sources** (Alinea / Ampere / GSD) and label the source. Calibrated revenue / units → use [DataBrain Calibration](databrain-calibration.md) instead.
2. **`steam_*` columns are abandoned**: all 11 columns (`steam_premium_revenue`, `steam_acu`, …) measure as NULL; never include them in SELECT. For Steam data use **`alinea_*`** (preferred) or `gamalytic_*` (legacy fallback).
3. **Un-prefixed `wishlists` / `wishlists_total` are abandoned**: always NULL — use **`alinea_wishlists` / `alinea_wishlists_total`** (preferred) or `gamalytic_wishlists*` (legacy fallback). Same applies to un-prefixed `follower_total`: prefer `alinea_follower_total`.
3a. **Never combine `alinea_*` and `gamalytic_*` into a single headline number**: they are independent third-party data feeds. Pick one prefix per metric per answer; `COALESCE(alinea_x, gamalytic_x)` is acceptable only as an explicit, labelled "Alinea (Gamalytic-backfilled for long-tail coverage)" series — not for serious external numbers. To cross-validate the two providers, SELECT both prefixes side-by-side (and optionally `spider_steam_pcu` / `spider_steam_acu` as a third independent reading from the `segment IS NULL` slice — see [Pattern 8](#pattern-8--steam-source-selection-freshness-today--coverage-long-tail)) and let the reader inspect the divergence. Between just Alinea and Gamalytic, **coverage** is the real driver — Gamalytic covers ~2× the Steam catalog Alinea covers. For the freshness dimension (today's PCU/ACU), `spider_steam_*` is the right answer, not gamalytic.
3b. **For Steam DAU, use `alinea_dau`**: this is the **only** Steam DAU column in the wide table. `gamalytic_*` has no DAU column at all. The old "no native Steam DAU" guidance is obsolete inside `pconsole_*_cid` post-Alinea integration. Note `alinea_dau` is **T-1** (yesterday is the freshest available); for "today's DAU" report "not yet available, latest = yesterday".
3c. **`spider_steam_*` lives on `segment IS NULL`, NOT `segment='All'`**: a `WHERE platform='PC' AND segment='All' AND market='global'` query will NEVER see spider data, even though the column exists in the schema. To read spider, switch the segment filter (see Filter Template A3 + Pattern 8). Don't combine A and A3 in the same WHERE clause.
4. **Ampere 12-day lag**: any "last 7 days Console DAU" query needs `ampere_dau IS NOT NULL`; for T-0 / T-1 freshness, fall back to `game_metric_ampere_daily_cid`.
5. **`segment` routing is easy to get wrong**: `'All'` covers most sales / reputation / social; `'None'` is streamhatchet; `''` (empty string) is Metacritic-only rows. **Forgetting the segment filter will mix metascore rows into mention aggregations.**
6. **`market` is degenerate for PC**: PC rows only have `market='global'`; writing `WHERE platform='PC' AND market='us'` returns 0 rows. Only Console rows have per-country markets (plus `global`).
7. **`platform` holds both "game platforms" and "social/streaming platforms"**: without an explicit `platform IN ('PC','PlayStation','Xbox','Nintendo')` filter, rows like `twitter` / `youtube` / `twitch` leak into sales aggregates.
8. **`detailed_platform` ≠ `platform`**: under `platform='PlayStation'` there are `PlayStation 4` / `PlayStation 5`; under `Xbox` there are `Xbox One` / `Xbox Series X|S` / `Xbox`. To avoid double-counting, **prefer aggregating by `platform`**; only split by `detailed_platform` when you explicitly want a generation comparison.
9. **Multiple rows per `(combined_id, date)`**: different `(platform, segment, market, detailed_platform, device)` slices coexist. Always confirm your `GROUP BY` dimensions before summing, or you'll double-count.
10. **No `entity_name` column → JOIN `common.combined_detail`** for the displayed game name:
    ```sql
    SELECT p.combined_id, d.entity_name, p.gamalytic_cumulative_revenue
    FROM intelligence.game_metric_pconsole_daily_cid p
    LEFT JOIN common.combined_detail d ON d.combined_id = p.combined_id
    WHERE p.combined_id IN (...) AND p.date = '2026-04-20'
      AND p.platform = 'PC' AND p.segment = 'All' AND p.market = 'global'
    ```
    Don't try to read the name off the wide table — there is no such column. Same applies to all `pconsole_*_cid` variants.
11. **`release_date` / `release_day` ARE in this table** (un-prefixed columns, every row carries the title's release info). For "days since launch", "first-month revenue", **"新游 / released in last N days"** with a concrete calendar window, filter on this column directly — **no need to JOIN `common.combined_detail` solely for release date**.

    ⚠️ **Type split — do not mix recipes:**
    | Table / column | Type | Fuzzy (`2026-Q3`, `TBD`, …)? | SQL |
    |---|---|---|---|
    | **`pconsole_*_cid.release_date`** | **`DATE`** | No — NULL if unknown | `DATE_DIFF(date, release_date, DAY)`; `release_date BETWEEN ...` |
    | **`common.combined_detail.release_date`** | **STRING** | Yes | [`examples/alinea_queries.sql` Pattern 6](../examples/alinea_queries.sql) (rules in [`alinea.md` § Upcoming](alinea.md#upcoming-games--release_date-取-未上线-数据)) |

    **Never** run `REGEXP_CONTAINS(release_date, ...)` on `pconsole_*_cid` — BigQuery returns:
    ```
    No matching signature for function REGEXP_CONTAINS
      Argument types: DATE, STRING
    ```
    That error means you copied the **`combined_detail`** fuzzy-date pattern onto the wide table by mistake.

    **pconsole recipe** — "新游" / last-60-day releases (PC, already has a DATE):
    ```sql
    AND release_date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY) AND CURRENT_DATE()
    ```

    **combined_detail recipe** — "未上线" / upcoming / fuzzy release strings → [`examples/alinea_queries.sql` Pattern 6](../examples/alinea_queries.sql) (see [`alinea.md`](alinea.md)); do **not** expect `pconsole.release_date` to carry `Coming Soon` / `2026-Q3`.

    **Same game, two columns — are they the same?** (empirical, PC `segment='All'`, 2026-05):
    - When **both** sides have a parseable calendar day, they **always match** if you normalize detail with `SUBSTR(COALESCE(release_date_str, release_date), 1, 10)` then `SAFE.PARSE_DATE` — **0 mismatches** across ~123K titles in a spot check.
    - They **look** different because:
      1. **Type** — detail is STRING (`'2026-02-05 00:00:00'`, `'1998'`, `'Coming Soon'`); pconsole is **DATE** (resolved day or NULL).
      2. **Semantics** — detail is catalog / marketing copy; pconsole is the **metric-pipeline anchor** used with `release_day` (`DATE_DIFF` vs row `date`). When detail is fuzzy (`'2018'`, `'TBD'`, `'Coming Soon'`), pconsole may still carry a **resolved** DATE (e.g. Steam PC launch) that does not equal the raw string.
      3. **Coverage** — ~19K PC-ish detail rows have only fuzzy/unparseable strings; ~20K pconsole `combined_id`s have `release_date IS NULL` (often no metric row / long-tail). Do not assume JOINing both columns on the same `combined_id` always populates both.
    - **Pick one per question**: calendar filters on titles **in** `pconsole_*_cid` → use `p.release_date` (DATE). Upcoming / fuzzy / display string → use `combined_detail` (+ normalization). Do not `COALESCE` them blindly for "release date" in the answer text without saying which source you used.

    Only JOIN `combined_detail` when you also need `entity_name`, `publisher`, `iegg_genre`, `steam_id`, or fuzzy upcoming semantics that `pconsole.release_date` cannot represent.
