# DataBrain Calibration

> Authoritative single-source PC/Console calibrated revenue & units (`game_metric_calibration_lifetime_daily` / `game_metric_calibration_daily`).

> **When to use**: this is the canonical single-source DataBrain **calibrated** data for PC/Console titles. Each row is a high-confidence revenue / units number derived by one of 4 calibration methods, with the most-trustworthy method **auto-selected per title** upstream. Prefer this over `pconsole_*_cid.gamalytic_*` when:
>
> - the answer will be reported as a **serious external number** (not just a trend chart) — the wide-table family is "Integrated / Estimated (trend-only)"; Calibration is the authoritative single source;
> - you need **lifetime / cumulative revenue** anchored to a specific date (not a 30-day window);
> - you need a **per-country revenue breakdown with the "Calibration" label** (Gamalytic is global-only; Calibration exposes ~60 countries);
> - you want to **label the confidence level** in the final answer (`calibration_method` tells you fine-calibrated vs Gamalytic/MScience-only).
>
> Calibration tables are narrow (revenue + units only, no DAU / wishlists / reviews / mentions). For multi-metric exploration keep using [pconsole_*_cid](pconsole-integrated-tables.md).

**Core tables** (both keyed by `combined_id`, same 11-column schema except the `cumulative_*` fields):

| Table | Cycle | Unique content |
|-------|-------|----------------|
| `intelligence.game_metric_calibration_daily` | DAY | Daily `units` / `revenue` (per-day deltas) |
| `intelligence.game_metric_calibration_lifetime_daily` | DAY | Same as daily **plus** `cumulative_units` / `cumulative_revenue` (running lifetime totals as of `date`). Prefer this variant unless you only need the delta. |

**Partition**: `date` (DAY). Always filter `date` in `WHERE`.

**JOIN / filter key**: `combined_id` ONLY (the `c` prefix, e.g. `c00001765`). Subject to the standard `*_cid`-family silent-failure trap — see [intelligence-sources.md → Cross-source conventions § 8](intelligence-sources.md#cross-source-conventions).

**Freshness**: T-0 (today's date typically available). Much fresher than `pconsole_*_cid.ampere_*` (which lags ~12 days).

## Columns — calibration tables

| Field | Type | Role | Notes |
|-------|------|------|-------|
| `combined_id` | STRING | dimension | Game key (`c` prefix); required in `WHERE` for any title-specific query |
| `date` | DATE | dimension | Partition; required in `WHERE` |
| `calibration_method` | STRING | dimension | Which method produced the number; see values below. **One method per game** — no need to filter, but surface it as a caveat |
| `market` | STRING | dimension | `'global'` + 60+ country codes (`us`, `cn`, `gb`, `de`, `jp`, `br`, `ru`, ...). Country rows **are populated** (unlike Gamalytic which is global-only). Sum of country rows ≈ global (minor rounding drift) |
| `sub_game_type` | STRING | dimension | `'All'` / `'PC'` / `'Console'`. **This is the platform split axis** — not `platform` |
| `platform` | STRING | dimension | **Vestigial** — only value `'All'` today. Ignore; don't filter |
| `segment` | STRING | dimension | **Vestigial** — only value `'All'` today. Ignore; don't filter |
| `units` | FLOAT64 | metric | Units delta for the given day |
| `revenue` | FLOAT64 | metric | Revenue delta (USD) for the given day |
| `cumulative_units` | FLOAT64 | metric | Lifetime units up to and including `date` (**`_lifetime_daily` only**) |
| `cumulative_revenue` | FLOAT64 | metric | Lifetime revenue (USD) up to and including `date` (**`_lifetime_daily` only**) |

## `calibration_method` values (priority selected upstream)

Priority order (applied per-game in the upstream `_stg_calibration_source_selection` staging):

| # | Method | What it means | Observed share |
|---|--------|--------------|----------------|
| 1 | `fine_calibration` | Official partner data + DataBrain manual calibration — highest confidence | ~1% of rows (top-priority titles only) |
| 2 | `gamalytic_mscience` | Blend of Gamalytic + M Science | ~6% |
| 3 | `gamalytic_only` | Gamalytic-only calibration | ~93% (majority) |
| 4 | `mscience_only` | Fallback when Gamalytic is missing (rare) | ~0% observed recently |

Each `combined_id` is tagged with exactly **one** method — agents do not need to pick a method; the table already contains the best available. **Surface `calibration_method` in the final answer** so the confidence level is visible, and when comparing multiple titles where methods differ call that out (`fine_calibration` and `gamalytic_only` are not perfectly comparable at sub-percent precision).

## Dimension matrix — calibration tables

- For a given `(combined_id, date, market)` tuple you get up to **3 rows** (one per `sub_game_type` value). Pick the one you want (`'All'` for total, `'PC'` or `'Console'` for per-platform splits).
- `market = 'global'` → worldwide total; `market IN ('us', 'cn', 'gb', ...)` → country split.
- `platform` and `segment` are both `'All'` always — don't bother filtering or grouping by them.
- Cardinality: `(combined_id × date × market × sub_game_type)` ≈ 3 × 60 × N_games rows per day. A 14-day scan ≈ 40M rows — always tight-filter `date` + `combined_id` (or at minimum `market`) to keep scans cheap.

## Pitfalls — calibration tables

(The `combined_id`-only key trap is shared with the rest of the `*_cid` family — see [Cross-source conventions § 8](intelligence-sources.md#cross-source-conventions). The sparse-fill rule does **not** apply here; Calibration is densely populated.)

1. **`sub_game_type`, not `platform`, is the platform split**. Filtering `WHERE platform IN ('PC', 'Console', ...)` returns 0 rows because `platform` only has value `'All'`. Use `sub_game_type IN ('PC','Console')` instead.
2. **`cumulative_*` lives in `_lifetime_daily` only** — not in `game_metric_calibration_daily`. For any "as-of-today total" or "period delta" question, use the lifetime table.
3. **Cumulative vs daily fields**: `cumulative_revenue` is a running total as of `date`; `revenue` is the delta for that single day. For a period total prefer `MAX(cumulative_revenue) - MIN(cumulative_revenue)` over the window rather than `SUM(revenue)` — cumulative-diff is robust to daily gaps in the feed.
4. **Always label the answer** with "DataBrain Calibration (high-confidence)". If `calibration_method != 'fine_calibration'`, mention which method powered the number.
5. **Revenue is in USD**. Don't assume local currency.
6. **Country rows sum ≈ global, not exact**: the country-split pipeline uses `gamalytic.top_countries` ratios, so there's small rounding drift between `market='global'` and `SUM(market IN country_list)`. For headline numbers, prefer the native `market='global'` row rather than reconstructing.

## Common query patterns — calibration tables

### Lifetime revenue snapshot for one title (latest date, global, All platforms)

```sql
SELECT date, combined_id, sub_game_type, calibration_method,
       cumulative_revenue, cumulative_units
FROM intelligence.game_metric_calibration_lifetime_daily
WHERE combined_id = 'c00001765'  -- CS2
  AND date = (
    SELECT MAX(date) FROM intelligence.game_metric_calibration_lifetime_daily
    WHERE combined_id = 'c00001765'
      AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
  )
  AND market = 'global'
ORDER BY sub_game_type
```

### Per-country lifetime revenue breakdown

```sql
SELECT market, cumulative_revenue, cumulative_units, calibration_method
FROM intelligence.game_metric_calibration_lifetime_daily
WHERE combined_id = 'c00001765'
  AND date = '2026-04-20'
  AND sub_game_type = 'PC'
  AND market != 'global'
ORDER BY cumulative_revenue DESC
LIMIT 20
```

### Period revenue delta (e.g. full-year 2025)

```sql
SELECT combined_id, sub_game_type,
       MAX(cumulative_revenue) - MIN(cumulative_revenue) AS period_revenue_usd,
       MAX(cumulative_units)   - MIN(cumulative_units)   AS period_units,
       ANY_VALUE(calibration_method) AS method
FROM intelligence.game_metric_calibration_lifetime_daily
WHERE combined_id IN ('c00001765', 'c00002262')  -- CS2, Diablo IV
  AND date BETWEEN '2024-12-31' AND '2025-12-31'
  AND market = 'global'
  AND sub_game_type = 'All'
GROUP BY combined_id, sub_game_type
ORDER BY combined_id, sub_game_type
```

> Why `MAX - MIN` on `cumulative_*` rather than `SUM(revenue)`: robust to occasional feed gaps, and `cumulative_*` is the authoritative running total.

### Cross-title YTD revenue ranking (with title enrichment)

```sql
WITH ytd AS (
  SELECT combined_id,
         MAX(cumulative_revenue) - MIN(cumulative_revenue) AS ytd_revenue,
         ANY_VALUE(calibration_method) AS method
  FROM intelligence.game_metric_calibration_lifetime_daily
  WHERE date BETWEEN '2025-12-31' AND CURRENT_DATE()
    AND market = 'global'
    AND sub_game_type = 'All'
  GROUP BY combined_id
  HAVING ytd_revenue > 0
)
SELECT y.combined_id, d.entity_name, y.ytd_revenue, y.method
FROM ytd y
LEFT JOIN common.combined_detail d ON d.combined_id = y.combined_id
ORDER BY y.ytd_revenue DESC
LIMIT 50
```

### Today's top 20 titles by daily calibrated revenue

```sql
SELECT c.combined_id, d.entity_name, c.revenue AS daily_revenue_usd,
       c.units AS daily_units, c.calibration_method
FROM intelligence.game_metric_calibration_lifetime_daily c
LEFT JOIN common.combined_detail d ON d.combined_id = c.combined_id
WHERE c.date = CURRENT_DATE()
  AND c.market = 'global'
  AND c.sub_game_type = 'All'
  AND c.revenue IS NOT NULL
ORDER BY c.revenue DESC
LIMIT 20
```

### Calibration vs Gamalytic comparison (methodology sanity check)

```sql
SELECT c.combined_id,
       c.cumulative_revenue      AS calib_cum_revenue,
       p.gamalytic_cumulative_revenue AS gama_cum_revenue,
       c.calibration_method
FROM intelligence.game_metric_calibration_lifetime_daily c
LEFT JOIN intelligence.game_metric_pconsole_daily_cid p
  ON p.combined_id = c.combined_id
  AND p.date = c.date
  AND p.platform = 'PC'
  AND p.segment = 'All'
  AND p.market = c.market
WHERE c.combined_id = 'c00001765'
  AND c.date = '2026-04-20'
  AND c.market = 'global'
  AND c.sub_game_type = 'PC'
```
