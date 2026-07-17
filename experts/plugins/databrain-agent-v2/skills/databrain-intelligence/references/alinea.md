# Alinea Analytics (Steam)

> Single-source Steam intelligence — **new default** for Steam PCU/ACU (T-0 partial → T-1 complete), DAU / revenue / units / wishlists / followers / upcoming games (T-1 for all non-PCU metrics), replacing Gamalytic. **Not real-time** — for live / 实时 CCU use [`steam-ccu.md`](steam-ccu.md) (`fetch_steam_ccu.py` + `spider_steam_*` on `segment IS NULL`; see Freshness below).
>
> **Primary tables (`_cid` variants — keyed by `combined_id`, no JOIN gymnastics):**
>
> | Table | Cycle | Use when |
> |---|---|---|
> | `intelligence.game_metric_alinea_daily_cid` | DAY | Default for daily questions. Includes `pcu`, `acu`, **`dau`**, `revenue`, `units_sold`, `wishlists*`, `followers*`, `price`, `players`, etc. — see schema below. |
> | `intelligence.game_metric_alinea_monthly_cid` | MONTH | Default for monthly aggregations. Replaces `dau` with **`mau`**; no `positive` columns. |
>
> The raw `intelligence.game_metric_alinea_daily` table (keyed by Steam URL `app_id`) is the underlying source — only reach for it when you don't have a `combined_id` / `edition_id` and only have a Steam app_id; for every other case use the `_cid` variants.
>
> **Also accessible via the multi-source wide table** `intelligence.game_metric_pconsole_daily_cid` (`alinea_*` 17-column prefix) when you need Alinea data joined with Ampere / MScience / reviews / mentions in one row — see [`pconsole-integrated-tables.md`](pconsole-integrated-tables.md). The plain `_daily_cid` table here is the simpler single-source path: smaller, no `(platform, segment, market)` slicing overhead, same Alinea numbers.

## Schema — `game_metric_alinea_daily_cid`

| Field | Type | Notes |
|---|---|---|
| `combined_id` | STRING | **Primary key.** Direct filter target; no JOIN needed. |
| `edition_id` | STRING | Single-platform Steam edition ID (also populated). |
| `app_id` | STRING | Steam URL form (`/app/<id>` or full URL) — kept for back-compat with the raw table. |
| `date` | DATE | Partition field — always filter. |
| `market` | STRING | Always `'global'` (Steam single market — no country split). |
| `entity_type` | STRING | Always `'pc'`. |
| `pcu` | INT64 | Peak concurrent users on `date` — **T-0 partial / T-1 complete** (aggregated estimate; **not real-time**). |
| `acu` | INT64 | Average concurrent users on `date` — same lag as `pcu`; **not real-time**. |
| `dau` | FLOAT64 | Estimated Steam DAU on `date` — **T-1 fresh**. **Only Steam DAU column in the intelligence layer.** |
| `revenue` | INT64 | Daily revenue (delta) — **T-1 fresh**. Prefer summing this over `MAX(revenue_total) − MIN(...)`. |
| `units_sold` | INT64 | Daily units sold (delta) — T-1. Same rule. |
| `revenue_total` | INT64 | Cumulative revenue at end of `date`. |
| `units_sold_total` | INT64 | Cumulative units sold at end of `date`. |
| `wishlists` | INT64 | Daily wishlist delta. |
| `wishlists_total` | INT64 | Cumulative wishlist snapshot — T-1. Use `MAX_BY(field, date)`, **don't `SUM` snapshots**. |
| `wishlist_countries` | STRING | Country breakdown of wishlists (JSON / text). Alinea-exclusive. |
| `followers` | INT64 | Daily follower delta. |
| `followers_total` | INT64 | Cumulative follower snapshot — T-1. Snapshot rule applies. |
| `top_countries` | STRING | Country breakdown of revenue/units. |
| `price` | FLOAT64 | Current Steam price. `> 0` = premium; `= 0` = F2P. |
| `origin_price` | FLOAT64 | Original (pre-discount) price. |
| `players` | INT64 | Total estimated players. |
| `avg_playtime` | FLOAT64 | Average playtime (units per Alinea spec). |
| `review_total` | INT64 | Daily review delta. |
| `cumulative_review_total` | INT64 | Cumulative review count. |
| `positive` | INT64 | Daily positive-review delta. |
| `cumulative_positive_total` | INT64 | Cumulative positive reviews. |

**`game_metric_alinea_monthly_cid`** has the same columns minus `dau`, `positive`, `cumulative_positive_total`, `origin_price`, and **adds `mau FLOAT64`** as the monthly active users metric. Cycle is `MONTH`.

## Freshness

| Column class | Latest `date` | Lag |
|---|---|---|
| `pcu`, `acu` | Today (partial) → Yesterday (complete) | **T-0 partial, T-1 complete** — Alinea is an aggregated estimate; same-day rows exist but the catalog is still ramping (e.g. ~24K games filled by midday vs ~141K at steady-state T-1) |
| `dau`, `revenue`, `units_sold`, `wishlists_total`, `followers_total` | Yesterday | **T-1** — no T-0 path |
| `mau` (`_monthly_cid` only) | Latest closed month | Monthly close |

> **For "today's PCU / ACU" specifically** — prefer `pconsole_daily_cid.spider_steam_pcu` / `spider_steam_acu` on the `segment IS NULL` slice. Spider is a real-time Steam-API crawler (guaranteed T-0), while this table's Alinea PCU/ACU may not yet include the title at the moment you query. See [`pconsole-integrated-tables.md` Pattern 8](pconsole-integrated-tables.md#pattern-8--steam-source-selection-freshness-today--coverage-long-tail) for the full source-selection decision matrix.
>
> For DAU / revenue / wishlists / followers there is **no T-0 alternative** — spider only carries PCU/ACU. Either query yesterday or report "not yet available".
>
> **Do not label Alinea as 实时 / real-time** in answers or source footnotes. It is third-party batch aggregation (catalog still ramping on T-0); only `spider_steam_*` is the documented real-time Steam-API crawler.

## ⚠️ Pitfalls

1. **Not real-time.** Never describe Alinea PCU/ACU as 实时数据. Same-day rows are partial estimates with incomplete catalog (~24K games by midday vs ~141K at T-1). For 实时 / "right now" Steam concurrent players → `pconsole_*_cid.spider_steam_pcu` / `spider_steam_acu`, `segment IS NULL` (see [`pconsole-integrated-tables.md` Pattern 8](pconsole-integrated-tables.md#pattern-8--steam-source-selection-freshness-today--coverage-long-tail)).
2. **`combined_id` is the join key.** `_daily_cid` has `combined_id` + `edition_id` + `app_id` — all three are populated for Steam titles. Always filter by `combined_id` for cross-platform franchises; use `edition_id` only when you specifically need a single-platform slice.
3. **Cumulative fields are running totals**: `revenue_total`, `units_sold_total`, `wishlists_total`, `followers_total`. For a period increment prefer summing the per-day delta column (`revenue` / `units_sold` etc.). If only a `_total` column is meaningful, use `MAX(field) − MIN(field)` over the window, **never `MAX − ON start_date`** (you'd lose the start-day contribution).
4. **`wishlists_total` / `followers_total` are snapshots, not deltas** — do **not** `SUM` them across days. Use `MAX_BY(field, date)` to pick the latest non-null within a window.
5. **Global-only**: `market` is always `'global'`. Country-level Steam questions ("JP-only PCU", "Russia revenue") are unsupported — say so explicitly.
6. **Date-coverage matters more than column coverage**: Steam launched 2003; the table goes back to 1998 (a few pre-Steam-platform titles) but most rows are dense from 2018+. For long historical windows, probe `MIN(date) WHERE pcu IS NOT NULL` per `combined_id`.
7. **Daily edge stalemate**: on the very latest `date`, `*_total` columns can lag a day (delta = 0). When ranking by today's per-day delta and everything is zero, fall back to `date - 1`.

## Query patterns (SQL in examples/)

**When you need executable SQL**, load **[`examples/alinea_queries.sql`](../examples/alinea_queries.sql)** and copy **one** `-- Pattern N` block. **Do not** pass the whole file to `execute_sql.py --sql_file` (BigQuery rejects multiple `SELECT`s). Run a single block via `--sql "$(sed -n '…p' examples/alinea_queries.sql)"` or paste into `--sql '…'`. **Do not use `WITH` CTEs** in SQL sent through `execute_sql.py` — the API mis-resolves CTE names as `schema.cte_name` tables (404, e.g. `intelligence.params`); Patterns 5–6 use nested subqueries instead.

| Pattern | `alinea_queries.sql` section | Use when |
|---|---|---|
| 1 | Single game snapshot | One `combined_id`, last few days headline metrics |
| 2 | Daily trend | 30-day series + PCU DoD |
| 3 | Monthly | Use `_monthly_cid`, need **MAU** |
| 4 | Top-N by PCU | Leaderboard + `combined_detail` for names (T-1 PCU) |
| 5 | Dashboard + DoD | Multi-metric snapshot at `query_date` vs T-1 |
| 6 | **Upcoming / 未上线** | fuzzy `combined_detail.release_date` |

> Pattern 3 note: daily → monthly via `_daily_cid` (`SUM(revenue)` etc.) works, but `_monthly_cid` is pre-aggregated and adds `mau`.

---

## Upcoming games & release_date (取 "未上线" 数据)

A game is **upcoming** iff:

- **no concurrent players** at the query date — `pcu IS NULL OR pcu = 0` (use latest Alinea reading in the signal window), **AND**
- the normalized release_date is **unknown OR strictly later than** the query date.

The release_date itself lives on `common.combined_detail` (not on this table), and may be fuzzy: `2026-05-28` / `2026-Q3` / `2026` / `Coming Soon` / `TBA` / `TBD` / `待定` / `即将推出` / `''`. Normalize to ISO before comparing:

| Raw value | Normalized end-date |
|---|---|
| `2026-05-28` / `2026-05-28 00:00:00` | `2026-05-28` (`SUBSTR(raw, 1, 10)`) |
| `2026-Q3` | `2026-09-30` (quarter end) |
| `2026` | `2026-12-31` (year end) |
| `Coming Soon` / `TBA` / `TBD` / `待定` / `即将推出` | NULL |
| `''` / NULL | NULL |

> **Do not substitute `pconsole_*_cid.release_date` (DATE) for upcoming filters.** The wide table stores a resolved launch anchor; `combined_detail` keeps fuzzy strings. See [`pconsole-integrated-tables.md` Pitfall #11](pconsole-integrated-tables.md).

**Full SQL** → [`examples/alinea_queries.sql`](../examples/alinea_queries.sql) **Pattern 6**.
