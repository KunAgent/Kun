# Gamalytic — LEGACY (Steam raw)

> 🚨 **Default Steam raw single-source is now [Alinea](alinea.md), not Gamalytic.** This file is kept for back-compat. **Only reach for `game_metric_gamalytic_daily` when**:
> 1. You explicitly need a Gamalytic column that Alinea hasn't surfaced (probe `fetch_schema.py` on `intelligence.game_metric_alinea_daily` first to confirm),
> 2. You need **historical coverage** for dates predating Alinea (probe `MIN(date)` of `alinea_*` columns for the title first),
> 3. You're reproducing a pre-existing Gamalytic-based report verbatim.
>
> For every other Steam question — Steam PCU/ACU / wishlists / daily revenue / top-N / upcoming — use [`alinea.md`](alinea.md) (not real-time; live PCU → `spider_steam_*` in [`pconsole-integrated-tables.md`](pconsole-integrated-tables.md)).

> Raw single-source PC (Steam) intelligence (`intelligence.game_metric_gamalytic_daily` / `_monthly`).

> ⚠️ **Wide-table integration: `pconsole_*_cid` now exposes BOTH `alinea_*` (preferred, 17 cols incl. `alinea_dau`) and `gamalytic_*` (legacy, 15 cols) prefixes side-by-side.** When you reach for `pconsole_*_cid` for multi-metric PC views, **default to the `alinea_*` columns** there too — `gamalytic_*` in the wide table is the same legacy parallel feed as this raw file. Use the `gamalytic_*` prefix only when (a) `alinea_*` is NULL for the row, (b) you're explicitly cross-validating the two providers by SELECT-ing both prefixes side-by-side (with `spider_steam_pcu/acu` as a third independent reading), or (c) you're reproducing a pre-Alinea report. Full wide-table reference: [`pconsole-integrated-tables.md`](pconsole-integrated-tables.md).
>
> Use this raw Gamalytic table (instead of the wide table's `gamalytic_*` columns) when you need: (1) `entity_type='pc'` filtering by `edition_id`, (2) Gamalytic-specific fields not lifted into the wide table, or (3) single-source clean semantics in the legacy/historical scenarios listed above.

**Commercial data source** providing Steam game sales and revenue estimates.

**Core tables:**
- `intelligence.game_metric_gamalytic_daily` — daily data
- `intelligence.game_metric_gamalytic_monthly` — monthly data

**Partition field:** `date` (monthly `MONTH`)

**Key fields:**

| Field | Type | Notes |
|-------|------|-------|
| `combined_id` | STRING | Game combined ID |
| `edition_id` | STRING | Game edition ID |
| `date` | DATE | Data date |
| `entity_type` | STRING | Always `pc` |
| `market` | STRING | Always `global` |
| `revenue` | INTEGER | Daily revenue delta |
| `revenue_total` | INTEGER | Cumulative revenue |
| `units_sold` | INTEGER | Daily units sold delta |
| `units_sold_total` | INTEGER | Cumulative units sold |
| `price` | FLOAT | Current game price |
| `review_total` | INTEGER | Daily review delta |
| `cumulative_review_total` | INTEGER | Cumulative review count |
| `followers_total` | INTEGER | Total followers |
| `followers` | INTEGER | Daily follower delta |
| `owners` | INTEGER | Game owner count |

## ⚠️ Gamalytic Pitfalls

1. **Cumulative fields need MAX − MIN for period increments**: `revenue_total`, `units_sold_total`, `wishlists_total`, `followers_total` are **running cumulative totals**, not per-day values. For a monthly increment use `MAX(field) − MIN(field)` over the month's date range. Never treat a single day's `revenue_total` as that day's revenue.
2. **No native DAU / MAU / PCU**: Gamalytic does not expose Steam DAU. Only `pcu` (peak concurrent users) may be derivable from Gamalytic or third-party sources. Report DAU as a data gap when specifically asked.
3. **Global-only, NOT country-partitioned**: `market` is always `global`. Country-level Steam user-scale questions (e.g. Russia scale, JP-only DAU) are unsupported — say so explicitly.
4. **No `entity_name` column**: `game_metric_gamalytic_daily` only has `edition_id` / `combined_id`. Any leaderboard must `JOIN common.app_detail d ON d.app_id = g.edition_id AND d.id_type = 'edition_id'` to retrieve game names.
5. **`wishlists_total` history starts ~mid-2024**: for many games `wishlists_total` is NULL before July 2024. Do not assume wishlist data exists for early-2024 launches; verify with `MIN(date) WHERE wishlists_total IS NOT NULL` first.
6. **Latest-day data may be stale**: `MAX(date)` may have `revenue_total` unchanged from the previous day (increment = 0) because data hasn't synced yet. For daily revenue rankings, probe `MAX(date)` first, then fall back to `date-1` vs `date-2` if the latest day shows zero deltas across all games.

## Gamalytic Common Query Patterns

### Monthly revenue trend (cumulative-diff method)

```sql
SELECT FORMAT_DATE('%Y-%m', date) AS month,
       MAX(revenue_total) - MIN(revenue_total) AS revenue_in_month
FROM intelligence.game_metric_gamalytic_daily
WHERE edition_id = ?
  AND date BETWEEN '2024-01-01' AND CURRENT_DATE()
GROUP BY month
ORDER BY month
```

### Long-range (1-2 year) two-game comparison

```sql
SELECT FORMAT_DATE('%Y-%m', date) AS month,
       edition_id,
       MAX(revenue_total) - MIN(revenue_total) AS revenue,
       MAX(units_sold_total) - MIN(units_sold_total) AS units_sold
FROM intelligence.game_metric_gamalytic_daily
WHERE edition_id IN ('eAAA...', 'eBBB...')
  AND date BETWEEN '2023-01-01' AND CURRENT_DATE()
GROUP BY month, edition_id
ORDER BY month, edition_id
```

### Daily units sold via LAG diff ("yesterday's Steam sales")

```sql
SELECT date,
       units_sold_total
         - LAG(units_sold_total) OVER (PARTITION BY edition_id ORDER BY date)
         AS units_sold
FROM intelligence.game_metric_gamalytic_daily
WHERE edition_id = ?
  AND date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY) AND CURRENT_DATE()
ORDER BY date DESC
```

### Top-N Steam games for a period (with entity_name JOIN)

```sql
SELECT g.edition_id, d.entity_name, d.publisher,
       MAX(g.revenue_total) - MIN(g.revenue_total) AS revenue,
       MAX(g.units_sold_total) - MIN(g.units_sold_total) AS units_sold
FROM intelligence.game_metric_gamalytic_daily g
LEFT JOIN common.app_detail d
  ON d.app_id = g.edition_id AND d.id_type = 'edition_id'
WHERE g.date BETWEEN ? AND ?
GROUP BY g.edition_id, d.entity_name, d.publisher
ORDER BY revenue DESC
LIMIT 20
```
