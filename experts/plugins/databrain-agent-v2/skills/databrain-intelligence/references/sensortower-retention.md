# Sensortower Retention

> Mobile retention for Sensortower — monthly new-user cohort (default) and legacy lifetime table. For DAU / MAU / revenue / downloads, see [`sensortower.md`](sensortower.md).

## Sensortower Retention (monthly cohort, MAU-weighted)

> **Semantics changed**: the **default** retention metric is now a **monthly new-user cohort** (`date` = cohort month, 1st; data backfilled to **2025-01-01**, actively updated). Aggregation across months / countries / packages is done by **MAU-weighted average**, not plain `AVG`.
>
> The old lifetime table `intelligence.game_metric_sensortower_retention` (`granularity='all_time'`, launch-to-date cohort) is **still queryable but legacy — source data content stopped updating after 2025-07-01** (ETL may still refresh `insert_time`; do not treat `insert_time` as data freshness). Use it **only** when the user explicitly asks for **lifetime / launch-to-date retention**; for any month-specific, trend, or "current" retention use the monthly tables below. See [Lifetime retention (legacy frozen table)](#lifetime-retention-legacy-frozen-table) at the end of this section.

### Retention day naming — unified output labels (monthly AND lifetime)

**Always output retention under these unified labels: `D2`, `D3`, `D7`, `D15`, `D31`.** They are the canonical reported checkpoints and map to Sensortower's raw days **`d1`, `d2`, `d6`, `d14`, `d30`** (label = raw day + 1, because install day counts as D1). Use the **same labels for both the monthly and lifetime tables** so results are comparable.

| Output label | Sensortower raw day | Monthly tables (`*_retention_*_monthly`) | Lifetime table (`game_metric_sensortower_retention`) |
|---|---|---|---|
| `D2` | day 1 | `est_retention_d1` | `retentions[SAFE_OFFSET(0)]` |
| `D3` | day 2 | `est_retention_d2` | `retentions[SAFE_OFFSET(1)]` |
| `D7` | day 6 | `est_retention_d6` | `retentions[SAFE_OFFSET(5)]` |
| `D15` | day 14 | `est_retention_d14` | `retentions[SAFE_OFFSET(13)]` |
| `D31` | day 30 | `est_retention_d30` | `retentions[SAFE_OFFSET(29)]` |

> ⚠️ **Lifetime sourcing**: the old table's pre-extracted columns (`retention_d2/d3/d7/d14/d30`) are a **different day set** and do NOT line up with the labels above — to stay aligned with the monthly tables, read lifetime values from the **`retentions` JSON** at the offsets shown (day-N = `SAFE_OFFSET(N-1)`), not from the pre-extracted columns.

### Two tables — pick by whether the question involves platform

| Table | Key | Has platform? | Use when |
|---|---|---|---|
| `intelligence.sensortower_retention_unified_monthly` | `unified_app_id` (Sensortower unified app = iOS+Android+all bundles already merged) | **No** | **Default / "overall" retention** — no platform mentioned. Cleanest number; ST already merged packages. |
| `intelligence.sensortower_retention_monthly` | `app_id` (raw package) | **Yes** (`appstore`/`googleplay`) | Platform mentioned (iOS / App Store / Android) or a specific package. |

**Decision tree:**

```
Platform mentioned?
├─ No  → sensortower_retention_unified_monthly
│   · single country / global  → direct read (no weighting)  → retention_unified.sql
│   · multi-country and/or multi-month → MAU-weighted→ retention_weighted_multi.sql
└─ Yes → sensortower_retention_monthly  (app_id) → retention_per_platform.sql
· single-platform retention = SUM(ret×MAU over selected platform's packages)
/ SUM(MAU over ALL platforms' packages)
```

### Shared schema (both tables)

| Field | Type | Notes |
|---|---|---|
| `date` | DATE | Cohort month, **1st of month** (e.g. `2026-03-01`) |
| `unified_app_id` *(unified table)* / `app_id` *(monthly table)* | STRING | Sensortower unified-app id / raw package id |
| `platform` *(monthly table only)* | STRING | `appstore` / `googleplay` |
| `country` | STRING | **UPPERCASE** ISO-2 country codes (`US`, `JP`); global rollup is lowercase `global`. To be safe against casing, always filter with `LOWER(r.country) = 'global'` (matches `global` / `Global` either way). |
| `region` | STRING | **UPPERCASE** region codes (`ME`, `CHN`, …); global rollup = `Global` (**capital G**); plus one special value `Other Asia` |
| `est_retention_d1 / d2 / d3 / d4 / d5 / d6 / d7 / d14 / d30 / d60 / d90 / d180 / d365` | STRING | Retention fractions (0–1) stored as **strings** → always `CAST(... AS FLOAT64)`. `d90 / d180 / d365` are often NULL. |
| `insert_time` | TIMESTAMP | Insert time |

> Neither table carries MAU — it must be **JOINed**:
> - **unified table** → bridge `unified_app_id → databrain unified_id` via `common.sensortower_unified_ids`, then JOIN `game_metric_sensortower_monthly_uid` (`SUM(mau)` across platforms) on `(id, date, market)`.
> - **monthly (app_id) table** → JOIN raw `game_metric_sensortower_monthly` on `(app_id, platform, market, date)`.

### ID chain & bridge table

Agent receives a **databrain `unified_id`**. Map it via **`common.sensortower_unified_ids`** (columns: `databrain_unified_id`, `sensortower_unified_app_id`, `app_id`, `entity_name`):
- one `databrain_unified_id` → one `sensortower_unified_app_id` → **many** `app_id`s (use `SELECT DISTINCT` of the needed mapping to avoid row fan-out).

### Critical gotchas

1. **`country` is UPPERCASE** ISO-2, but `market` in the MAU tables is **lowercase** → join/filter with `LOWER(r.country)`. The country-level global rollup is already lowercase `global`, so `LOWER('global')='global'` matches `market='global'`. (Note: the `region` column's global rollup is `Global` with a capital G, and `region` also has a special `Other Asia` value — only relevant if you slice/filter by `region`.)
2. **Retention values are STRINGS** → `CAST(est_retention_dN AS FLOAT64)` before any arithmetic.
3. **MAU-weight, never plain AVG** across packages/countries/months: `SUM(ret×MAU)/SUM(MAU)`.
4. **Req-3 denominator is literal** — single-platform = selected-platform numerator ÷ **all-platforms** MAU denominator (so the platform filter goes in the numerator `IF(...)`, not in `WHERE`).
5. **MAU only covers large markets** — small-country cohorts with NULL MAU drop out of the weighted sum; flag coverage when many small countries are involved.

### SQL files

All SQL files live in [`examples/sensortower/`](../examples/sensortower/). Copy one file at a time into `execute_sql.py --sql`; never run the whole directory.

| File | Use when |
|---|---|
| [`retention_unified.sql`](../examples/sensortower/retention_unified.sql) | Unified table, single country / global, single month (direct read; default). |
| [`retention_weighted_multi.sql`](../examples/sensortower/retention_weighted_multi.sql) | Unified table, multi-country / multi-month MAU-weighted. |
| [`retention_per_platform.sql`](../examples/sensortower/retention_per_platform.sql) | App_id table, platform-filtered MAU-weighted (Req 3 literal denominator). |
| [`retention_lifetime.sql`](../examples/sensortower/retention_lifetime.sql) | **Lifetime / launch-to-date** (legacy table; source data frozen since 2025-07-01); explicit lifetime asks only. |

### Lifetime retention (legacy frozen table)

For **explicit lifetime / launch-to-date retention only**. Table `intelligence.game_metric_sensortower_retention` is **legacy — source data content stopped updating after 2025-07-01** (ETL may still refresh `insert_time`; do not treat `insert_time` as data freshness). Never use it for month-specific / trend / "latest" retention (use the monthly tables above). It is **lifetime cohort** (`granularity='all_time'`), keyed by **raw `app_id`** (NOT `unified_id`), so resolve via `common.unified_ids` (`source='sensortower'`, `entity_type='mobile'`).

| Field | Type | Notes |
|---|---|---|
| `app_id` | STRING | Raw Sensortower app_id (bundle_id / numeric); NOT `unified_id` |
| `entity_name` | STRING | Game name from source — used for publisher / portfolio `LOWER(entity_name) LIKE '%…%'` lookups |
| `granularity` | STRING | `all_time` (lifetime) / `quarterly`; **always filter** — mixing double-counts |
| `platform` | STRING | `appstore` / `googleplay` |
| `market` | STRING | **lowercase** (`global` / `cn` / `us` / …) — unlike the monthly tables' UPPERCASE `country` |
| `confidence` | FLOAT64 | Confidence score — **informational only; do NOT use it as a weight when averaging across app_ids** |
| `retention_d2 / d3 / d7 / d14 / d30 / d60` | FLOAT64 | Pre-extracted day-N (already FLOAT64, not strings). **Different day set than unified labels — read `retentions` instead.** |
| `retentions` | STRING | JSON array of up to 90 daily values, 0-indexed at day-1 → `CAST(JSON_EXTRACT_ARRAY(retentions)[SAFE_OFFSET(N-1)] AS FLOAT64)` for day-N. D2→`OFFSET(0)`, D3→`OFFSET(1)`, D7→`OFFSET(5)`, D15→`OFFSET(13)`, D31→`OFFSET(29)` (see [Retention day naming](#retention-day-naming--unified-output-labels-monthly-and-lifetime)). |

> Old-table caveats differ from the new monthly tables: `market` is **lowercase**, there is **no MAU weighting** — aggregate across app_ids with plain `AVG` (legacy behaviour) — and ID resolution uses **`common.unified_ids`** (NOT the new `common.sensortower_unified_ids` bridge). For the **unified D2/D3/D7/D15/D31 labels**, pull from the `retentions` JSON at the offsets above (the pre-extracted `retention_dN` columns are a different day set and won't align with the monthly tables). Always state "lifetime retention; source data frozen since 2025-07-01" when answering from this table. SQL: [`retention_lifetime.sql`](../examples/sensortower/retention_lifetime.sql).
