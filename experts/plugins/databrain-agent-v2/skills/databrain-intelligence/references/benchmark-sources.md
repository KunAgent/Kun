# Benchmark Data Reference

> Coverage: Game industry benchmark / peer comparison — distribution stats (median, top 1%, top 10%), rankings, metric discovery
> **Metric SoT**: `SELECT DISTINCT metric FROM benchmark.benchmark_detail` — no static whitelist

---

## MUST-DO for every benchmark query

1. **Always start from `benchmark.benchmark_detail`** — resolve a valid `metric` before aggregating.
2. **Never invent metric names** — every `WHERE metric = '...'` value must exist in `benchmark_detail` (verify via SQL).
3. **No `date` partition on `benchmark_detail`** — use `last_update_date` only when freshness matters; do **not** add `WHERE date = ...`.
4. **One value per game before any distribution / ranking** — `benchmark_detail` fans out by `country_code` AND `platform`, so most metrics have **multiple rows per `game_id`**. Computing `APPROX_QUANTILES` / `ORDER BY value` on raw rows double-counts games and **skews results** (esp. tail percentiles & `game_count`; e.g. `ampere_mau_m1` top 1% off by ~19%). **Default: `country_code = 'global'` + pick ONE `platform`口径 + `GROUP BY game_id`.** See [Distribution fan-out](#distribution-fan-out-must-read).
5. **Label answers** as「Benchmark 口径」— not Sensortower / Alinea native intelligence.
6. **Distribution / ranking / median** → **only** `benchmark_detail`; do **not** use `benchmark_intelligence_kpi_detail_pconsole` wide table for `APPROX_QUANTILES`


Execute:

```bash
python scripts/execute_sql.py --sql "SELECT ... FROM benchmark.benchmark_detail ... LIMIT 100"
```

**Metric discovery** — `execute_sql.py` **without `--schema`**. Use the layered Pattern A flow below; **always INNER JOIN `benchmark_detail` distinct metrics** so only valid metrics are returned. Model picks one `metric` from the result — do not ask the user.

---

## End-to-end workflow

```
Phase 0  report_log.py (once per question)

Phase 1  Route → load this file (benchmark-sources.md)
         User mentions a game name? → search_entity.py → combined_id (Phase 1.5)

Phase 2  METRIC RESOLUTION (execute_sql — before any aggregation)
         ┌─────────────────────────────────────────────────────────┐
         │ A0  User gave exact code? → verify in benchmark_detail │
         │ A+  Semantic / 中文 / 指标组? → RECOMMENDED (partial):  │
         │       dim_metric_group_info + dim_metric_info ⋈ detail  │
         │     → alignment check: any row match user intent?       │
         │        NO (0 rows OR wrong set) → downgrade ↓           │
         │ A5  dim_metric_info ⋈ detail (metric_cn LIKE, no group) │
         │ A1  detail.metric LIKE '%token%' (English / code token) │
         │     optional: benchmark_question.question_cn          │
         │ Model: pick ONE metric — never from a misaligned A+ set │
         └─────────────────────────────────────────────────────────┘

Phase 3  AGGREGATE on benchmark_detail (Pattern B / C / D / E)
         WHERE metric = '<chosen>'
         JOIN benchmark_game_info / dim_* only when needed

Phase 4  Answer — label「Benchmark 口径」; cross-intelligence = separate queries
```

---

## Table of Contents

- [Source Overview](#source-overview)
- [Metric Resolution](#metric-resolution)
- [Distribution fan-out (MUST READ)](#distribution-fan-out-must-read)
- [Tables](#tables)
- [Game ID Mapping](#game-id-mapping)
- [Common Query Patterns](#common-query-patterns)
- [Scenario Index](#scenario-index-16-examples)
- [Pitfalls & Notes](#pitfalls--notes)
- [Intelligence Boundary](#intelligence-boundary)

---

## Source Overview

| Table | Grain | Partition | Role |
|-------|-------|-----------|------|
| `benchmark.benchmark_detail` | `game_id × metric × platform × country_code × stage × source` → `value` | none (`last_update_date` metadata) | **★ Primary fact table — every query** |
| `benchmark.benchmark_game_info` | one row per `game_id` | none | Game names, genre, DataBrain IDs |
| `benchmark.dim_metric_info` | one row per `metric` (+ platform) | none | Per-metric CN/EN, `tips_cn`, `is_recommend`, `category` |
| `benchmark.dim_metric_group_info` | one row per `metric` in a product group | none | **Metric discovery** — `group_name_cn`, `label_cn`, curated taxonomy |
| `benchmark.benchmark_question` | preset Q&A → `metric` | none | NL question → metric mapping |
| `benchmark.benchmark_metric_info` | `metric × genre` | none | Metric discovery by genre |
| `benchmark.dim_platform_info` | platform code → display name | none | Platform labels |
| `benchmark.dim_country_info` | country code → display name | none | Country labels |
| `benchmark.dim_source_info` | source code → display name | none | Source labels |
| `benchmark.benchmark_genre_info` | genre / sub_genre labels | none | Genre CN names |
| `benchmark.benchmark_intelligence_live_ops_detail` | `game_id × channel × platform` | none | **Live Ops only** — not default |
| `benchmark.benchmark_intelligence_kpi_detail_pconsole` | wide KPI columns per game | none | **Multi-column KPI snapshot only** — not for distribution |

---

## Metric Resolution

Valid metrics = distinct values in `benchmark.benchmark_detail.metric` (~184 today; changes with ETL).

### Decision tree

```
User question
  │
  ├─ A0 Explicit metric code (e.g. sales_y, gaas_ratio)
  │     → verify: SELECT DISTINCT metric FROM benchmark_detail WHERE metric = '...'
  │
  ├─ A+ Semantic / 中文 / 指标组（推荐 — 但 dim_metric_group_info 是子集）
  │     → Pattern A+ : dim_metric_group_info + dim_metric_info INNER JOIN detail
  │     → filter: group_name_cn / label_cn / metric_cn LIKE user intent
  │
  ├─ Alignment check (MANDATORY after A+ — do not skip)
  │     At least one row must semantically match user intent (see table below).
  │     │
  │     ├─ YES → pick ONE from A+ rows → Pattern B/C/D/E
  │     │
  │     └─ NO — two cases, same action:
  │           • A+ returned 0 rows
  │           • A+ returned rows but correct metric not in list
  │             (e.g. user asks GaaS ratio; A+ only shows revenue_*)
  │           → do NOT pick the "closest" wrong metric
  │           → downgrade: A5 → A1 → benchmark_question (see order below)
  │
  ├─ A5 dim_metric_info ⋈ detail (no group_info — wider than A+)
  │     → metric_cn / metric_en LIKE user wording
  │     → alignment check again; if still no match → A1
  │
  ├─ A1 Fuzzy English token on detail (full SoT coverage)
  │     → detail.metric LIKE '%gaas%' / '%wishlist%' / '%pcu%'
  │
  └─ Model selects ONE metric using naming hints + is_recommend
        Do NOT ask the user; do NOT invent metric codes
```

### A+ coverage gap (why alignment check is required)

`dim_metric_group_info` is a **curated subset** — not every `benchmark_detail` metric has a group row (e.g. `gaas_ratio` may exist in detail but not in group_info). Pattern A+ **cannot return** those metrics.

| Layer | Coverage |
|-------|----------|
| `benchmark_detail` DISTINCT `metric` | **SoT — all valid metrics** |
| `dim_metric_info` | Most metrics with CN/EN labels |
| `dim_metric_group_info` | **Subset** — product-grouped metrics only |

**Failure mode to avoid**: user asks「GaaS 收入占比」→ A+ `group_name_cn LIKE '%收入%'` returns `revenue_y`, `revenue_m`, … but **not** `gaas_ratio` → model must **not** pick `revenue_y` just because A+ returned rows.

**Downgrade order** when alignment fails: **A5** (if Chinese/semantic) → **A1** (if English token in question or metric code pattern) → **`benchmark_question`** → report no match (list nearby metrics; never invent codes).

### Semantic alignment check (after A+ or A5)

Before picking from candidate rows, confirm **at least one row** matches the user intent:

| User signal | Candidate must reflect |
|-------------|------------------------|
| Specific concept (GaaS, 愿望单, Steam PCU, 退款率, 占比, ratio) | `metric`, `metric_cn`, or `group_name_cn` contains equivalent meaning — not just a broad parent category (收入 ≠ GaaS占比) |
| Time grain (首月, 次日, 首年, day-1) | Metric name or `metric_cn` matches grain (`*_m1`, `retention_rate_d2`, `sales_y`) |
| English token (gaas, wishlist, pcu) | `metric` column contains token; if A+ rows lack it → downgrade A1 immediately |
| Platform (Steam, mobile, PC) | Filter or naming consistent with user platform |

If **no row passes** → treat as「A+ misaligned」and downgrade. **Never** select the broadest partial match (e.g. `revenue_y` for「GaaS占比」).

### Pattern A1 — detail keyword (fallback — full SoT)

```sql
SELECT DISTINCT metric
FROM benchmark.benchmark_detail
WHERE LOWER(metric) LIKE '%wishlist%'
LIMIT 50
```

### Pattern A+ — semantic / group discovery (recommended)

Product-curated groups + per-metric labels; always restricted to metrics that exist in `benchmark_detail`.

```sql
SELECT
  g.metric,
  g.group_name_cn,
  g.group_name_en,
  g.label_cn,
  g.label_en,
  m.metric_cn,
  m.metric_en,
  m.is_recommend,
  m.tips_cn
FROM benchmark.dim_metric_group_info AS g
INNER JOIN benchmark.dim_metric_info AS m
  ON g.metric = m.metric
INNER JOIN (
  SELECT DISTINCT metric FROM benchmark.benchmark_detail
) AS d ON g.metric = d.metric
WHERE LOWER(g.group_name_cn) LIKE '%留存%'
   OR LOWER(g.label_cn) LIKE '%留存%'
   OR LOWER(m.metric_cn) LIKE '%首月%留存%'
ORDER BY m.is_recommend DESC, g.sort
LIMIT 30
```

**Model selection cues** — only after **alignment check passes**:

| Signal | Prefer |
|--------|--------|
| `group_name_cn` matches user topic (留存 / 收入 / Steam) | metrics in that group |
| `metric_cn` closest to user wording | e.g. 注册后第1月留存 → `retention_m1` |
| `is_recommend = true` | when multiple metrics tie |
| Naming hints table below | time grain (m1, d2, _y) |
| User said 首月 / first month | `*_m1`, not `*_m10` |

### Pattern A5 — dim_metric_info without group (between A+ and A1)

Use when A+ is empty **or misaligned**, and user wording is Chinese / semantic. Skips `dim_metric_group_info` so metrics **not in group_info** can still be found.

```sql
SELECT d.metric, m.metric_cn, m.metric_en, m.is_recommend, m.tips_cn
FROM benchmark.dim_metric_info AS m
INNER JOIN (
  SELECT DISTINCT metric FROM benchmark.benchmark_detail
) AS d ON m.metric = d.metric
WHERE LOWER(m.metric_cn) LIKE '%gaas%'
   OR LOWER(m.metric_en) LIKE '%gaas%'
ORDER BY m.is_recommend DESC
LIMIT 20
```

Run alignment check on A5 results too. If still no match and user question contains an English token → **A1** `detail.metric LIKE`.

### Verify exact metric (A0)

```sql
SELECT DISTINCT metric
FROM benchmark.benchmark_detail
WHERE metric = 'sales_y'
LIMIT 1
```

### Naming hints (not exhaustive — always verify via SQL)

| Pattern | Meaning | Examples |
|---------|---------|----------|
| `retention_mN` | Month-N retention after registration | `retention_m1` = first month |
| `retention_rate_dN` | Day-N retention | `retention_rate_d2` = day-2 (次日留存) |
| `sales_y` / `revenue_y` | First-year sales / revenue | |
| `sales_d` / `revenue_d` | First-day sales / revenue | |
| `ampere_mau_m1` | Ampere first-month MAU | not `mau_m1` |
| `vginsights_pcu_d1` | Steam PCU day-1 | PC-family; user asks PC → `LOWER(platform)='pc'`, else umbrella `PC&Console` |
| `gaas_ratio` | GaaS revenue share | |
| `wishlists_before_launch` | Pre-launch Steam wishlists | |

---

## Distribution fan-out (MUST READ)

`benchmark_detail` is keyed by `game_id × metric × platform × country_code × stage × source`. For a single `metric`, one `game_id` usually has **many rows** (different countries / platforms). Aggregating on raw rows is a **correctness bug**.

Verified fan-out (today's data):

| metric | distinct country | distinct platform | rows / game | raw-row distribution? |
|--------|------------------|-------------------|-------------|------------------------|
| `retention_m1`, `gaas_ratio`, `sales_y`, `sales_d` | 1 (`global`) | 1 | 1 | OK (coincidentally) |
| `wishlists_before_launch` | 1 (`global`) | 2 | ~2 | **WRONG — platform fan-out** |
| `vginsights_pcu_d1` | 1 (`global`) | 2 | ~2 | **WRONG — platform fan-out** |
| `ampere_mau_m1` | 1 (`global`) | 5 | ~2.7 | **WRONG — platform fan-out** |
| `retention_rate_d2` | 20 (`global` + `us`/`in`/…) | 3 | ~12.8 | **WRONG — country + platform** |

Measured impact on `retention_rate_d2` median:

| Method | Median | Verdict |
|--------|--------|---------|
| Raw rows, no dedup (counts each country/platform row) | 0.409 | ✗ biased low, weights multi-country games |
| `MAX(value)` per game **across all countries** | 0.463 | ✗ biased high — cherry-picks each game's best country |
| **`country_code='global'` + one value per game** | 0.410 | ✓ correct industry view |

### Platform scoping

Pick ONE platform口径 per query — **do not `MAX(value)` across platforms**. `platform` values are **metric-dependent**. PC-family metrics use `PC&Console` (umbrella) / `PC` / `Console` / `PlayStation` / `Xbox`; mobile-family metrics use `Mobile` (umbrella) / `iOS` / `Android`. Picking ONE platform per the user intent is clearer and more correct than `MAX(value)` across platforms (which silently picks whichever口径 is largest).

**Platform routing:**

| User asks | platform filter |
|-----------|-----------------|
| PC / Steam | `LOWER(platform) = 'pc'` |
| Console (generic) | `LOWER(platform) = 'console'` |
| PlayStation / Xbox | that exact value |
| iOS / Android | `'iOS'` / `'Android'` |
| Mobile (unspecified sub-platform) | `'Mobile'` |
| **No platform specified** | **the metric's umbrella口径**: PC-family → `PC&Console`; mobile-family → `Mobile` |

**Determine the family** in metric resolution: `GROUP BY platform` on the metric; if it has `PC&Console` → PC-family (default `PC&Console`); if it has `Mobile` → mobile-family (default `Mobile`).

**Fallback (verified necessary)**: a metric may have **no umbrella row** (only `major_updates_pcu_by_game` today — `PC` only). If neither `PC&Console` nor `Mobile` exists, fall back to the platform with the widest game coverage. Never let the default umbrella return 0 rows.

> Steam-only (`steam_*`, `wishlists_*`, `vginsights_pcu_*`, `refund_*`…) and Google-Play-only (`google_play_*`) metrics store the **same value** under both the detail platform and the umbrella (`PC`=`PC&Console`, `Android`=`Mobile`). Default umbrella is numerically correct; use the detail platform (`pc` / `Android`) when you want the口径 name to be precise.

### Canonical safe distribution (use as default Pattern B)

```sql
SELECT
  APPROX_QUANTILES(v, 100)[OFFSET(99)] AS top_1_percent,
  APPROX_QUANTILES(v, 100)[OFFSET(90)] AS top_10_percent,
  APPROX_QUANTILES(v, 2)[OFFSET(1)]    AS median,
  COUNT(*) AS game_count
FROM (
  SELECT game_id, MAX(value) AS v
  FROM benchmark.benchmark_detail
  WHERE metric = 'retention_rate_d2'
    AND country_code = 'global'   -- always when a 'global' slice exists
    AND platform = 'Mobile'       -- ONE口径: routing table above; unspecified → umbrella
  GROUP BY game_id               -- single platform ⇒ already one row; MAX is defensive
)
```

Rules:

1. **Default `country_code = 'global'`** — every benchmark metric has a `global` slice; that is the industry view. Only filter a specific country when the user explicitly asks ("US retention …").
2. **Pick ONE `platform`口径** per the routing table — never `MAX(value)` across different platforms (it silently mixes口径). Single platform + `global` is naturally one row per game.
3. **Always collapse to one row per `game_id`** via the inner `GROUP BY game_id`. Safe / defensive even when already one row. `COUNT(*)` then truly equals game count.
4. Never `MAX(value)` across countries without fixing `country_code` first (it cherry-picks each game's best country).

---

## Tables

### benchmark_detail

**Primary fact table** — long-format benchmark values.

| Field | Type | Description |
|-------|------|-------------|
| `game_id` | STRING | Game key → JOIN `benchmark_game_info.game_id` |
| `metric` | STRING | Metric code (SoT: distinct values in this table) |
| `value` | FLOAT64 | Benchmark value |
| `platform` | STRING | e.g. `pc`, `PC&Console`, `mobile` — **mixed case**, always wrap with `LOWER()` when filtering. Multiple platform rows per game ⇒ dedupe before distribution. |
| `country_code` | STRING | Country; **`'global'` is the industry-wide slice** + per-country splits (`us`, `in`, `jp`, …). **Default-filter `country_code = 'global'`** for benchmarks. |
| `stage` | STRING | Lifecycle stage |
| `source` | STRING | Data source — **only two values: `intelligence` and `ingame`**. Add `source = 'intelligence'` for intelligence-sourced benchmarks; omit only if user wants all sources. |
| `last_update_date` | DATE | Last ETL update — **not** a query partition |

### benchmark_game_info

| Field | Type | Description |
|-------|------|-------------|
| `game_id` | STRING | Benchmark internal game ID |
| `game_name` | STRING | Display name |
| `combined_id` | STRING | DataBrain cross-platform ID (`c` prefix) |
| `pc_id` | STRING | PC `edition_id` |
| `mobile_id` | STRING | Mobile `unified_id` |
| `console_id` | STRING | Console `edition_id` |
| `genre` / `sub_genre` | STRING | Genre taxonomy |
| `genre_cn` | STRING | Chinese genre |
| `entity_type` | STRING | Entity type |
| `is_free_to_play` | BOOL | F2P flag |
| `release_time` | DATETIME | Release time |
| `revenue` / `download` / `pcu` | numeric | Summary fields on game row |

### dim_metric_info

| Field | Type | Description |
|-------|------|-------------|
| `metric` | STRING | Metric code |
| `metric_cn` / `metric_en` | STRING | Chinese / English display names |
| `platform` | STRING | Applicable platform |
| `category` | STRING | Metric category |
| `value_type` / `scalar_type` | STRING | Value semantics |
| `is_recommend` | BOOL | Recommended metric flag |
| `tips_cn` / `tips_en` | STRING | Usage tips |

### benchmark_question

| Field | Type | Description |
|-------|------|-------------|
| `id` | STRING | Question ID |
| `metric` | STRING | Linked metric |
| `question_cn` / `question_en` | STRING | Preset natural-language questions |
| `platform` | STRING | Platform scope |
| `is_recommend` | BOOL | Prefer when disambiguating |
| `filter` | STRING | Filter config |

### dim_metric_group_info

**Metric group mapping** — product taxonomy for discovery (not for aggregation). **Partial coverage**: many valid `benchmark_detail` metrics are absent from this table; use **A5 / A1** when A+ cannot surface the correct metric.

| Field | Type | Description |
|-------|------|-------------|
| `metric` | STRING | Metric code → JOIN `dim_metric_info`, `benchmark_detail` |
| `group` | STRING | Group key |
| `group_name_cn` / `group_name_en` | STRING | Group display name (e.g. 留存, Revenue) |
| `label_cn` / `label_en` | STRING | Label within group |
| `sort` | INT64 | Display order |
| `status` | INT64 | Active flag |

Use in **Pattern A+** only. Never aggregate on this table. Never assume「metric not in group_info ⇒ does not exist in benchmark」.

---

## Game ID Mapping

| User has | Resolve via | Filter benchmark |
|----------|-------------|------------------|
| Game name | `search_entity.py` → `combine_id` | `benchmark_game_info.combined_id` |
| `combine_id` / `combined_id` | direct | `benchmark_game_info.combined_id` |
| `mobile_id` / `unified_id` | direct | `benchmark_game_info.mobile_id` |
| `pc_id` / `edition_id` | direct | `benchmark_game_info.pc_id` or `console_id` |
| Benchmark `game_id` | from prior query | `benchmark_detail.game_id` |

```sql
SELECT d.metric, d.value, d.platform, g.game_name
FROM benchmark.benchmark_detail d
INNER JOIN benchmark.benchmark_game_info g ON d.game_id = g.game_id
WHERE g.combined_id = 'c0000xxxx'
  AND d.metric = 'sales_y'
LIMIT 100
```

---

## Common Query Patterns

> Full copy-paste templates: [`examples/benchmark/`](../examples/benchmark/)

### Pattern B — distribution (median / top 1% / top 10%)

**Pick ONE platform口径 + `global`, then dedupe per game** (see [Platform scoping](#platform-scoping)). Below: `retention_m1` is a PC-family metric, no platform specified → umbrella `PC&Console`.

```sql
SELECT
  APPROX_QUANTILES(v, 100)[OFFSET(99)] AS top_1_percent,
  APPROX_QUANTILES(v, 100)[OFFSET(90)] AS top_10_percent,
  APPROX_QUANTILES(v, 2)[OFFSET(1)]    AS median,
  COUNT(*) AS game_count
FROM (
  SELECT game_id, MAX(value) AS v
  FROM benchmark.benchmark_detail
  WHERE metric = 'retention_m1'
    AND country_code = 'global'
    AND platform = 'PC&Console'
  GROUP BY game_id
)
```

Median only — same structure (`gaas_ratio`, PC-family → `PC&Console`):

```sql
SELECT
  APPROX_QUANTILES(v, 2)[OFFSET(1)] AS median,
  COUNT(*) AS game_count
FROM (
  SELECT game_id, MAX(value) AS v
  FROM benchmark.benchmark_detail
  WHERE metric = 'gaas_ratio'
    AND country_code = 'global'
    AND platform = 'PC&Console'
  GROUP BY game_id
)
```

Mobile-family metric (`retention_rate_d2`) → umbrella `Mobile`:

```sql
SELECT
  APPROX_QUANTILES(v, 100)[OFFSET(90)] AS top_10_percent,
  APPROX_QUANTILES(v, 2)[OFFSET(1)]    AS median,
  COUNT(*) AS game_count
FROM (
  SELECT game_id, MAX(value) AS v
  FROM benchmark.benchmark_detail
  WHERE metric = 'retention_rate_d2'
    AND country_code = 'global'
    AND platform = 'Mobile'
  GROUP BY game_id
)
```

### Pattern C — top N games

Same ONE-platform + `global` + per-game dedup, then join names:

```sql
SELECT g.game_name, t.game_id, t.value
FROM (
  SELECT game_id, MAX(value) AS value
  FROM benchmark.benchmark_detail
  WHERE metric = 'gaas_ratio'
    AND country_code = 'global'
    AND platform = 'PC&Console'
  GROUP BY game_id
) AS t
INNER JOIN benchmark.benchmark_game_info AS g ON t.game_id = g.game_id
ORDER BY t.value DESC
LIMIT 10
```

### Pattern D — user specified a platform

When the user names a platform, route to that exact口径 (not the umbrella). `vginsights_pcu_d1` is Steam → `pc`:

```sql
SELECT
  APPROX_QUANTILES(v, 100)[OFFSET(99)] AS top_1_percent,
  APPROX_QUANTILES(v, 2)[OFFSET(1)]    AS median,
  COUNT(*) AS game_count
FROM (
  SELECT game_id, MAX(value) AS v
  FROM benchmark.benchmark_detail
  WHERE metric = 'vginsights_pcu_d1'
    AND country_code = 'global'
    AND LOWER(platform) = 'pc'
  GROUP BY game_id
)
```

### Live Ops (special — only when user asks 运营 / live ops / channel)

```sql
SELECT game_id, platform, channel, revenue, download, pcu, last_update_date
FROM benchmark.benchmark_intelligence_live_ops_detail
WHERE game_id = '...'
LIMIT 100
```

---

## Scenario Index (16 examples)

> All distribution (B/D) and ranking (C) rows assume the [safe template](#distribution-fan-out-must-read): `country_code = 'global'` + ONE `platform`口径 ([routing](#platform-scoping)) + `GROUP BY game_id` before aggregating.

| # | User intent | Metric resolution | Pattern |
|---|-------------|-------------------|---------|
| 1 | Metrics related to first-month active users | `LIKE '%mau%'` or `%dau%` on detail | A |
| 2 | Top 10 games by first-month MAU | `ampere_mau_m1` (verify via detail, not `mau_m1`) | C |
| 3 | First-month MAU top 1% & median | `ampere_mau_m1` | B |
| 4 | Metrics related to Steam PCU day-1 | `LIKE '%pcu%'` + platform filter | A |
| 5 | Steam PCU day-1 top 1% & median | `vginsights_pcu_d1` + platform | B + D |
| 6 | First 6-month avg MAU benchmark | `LIKE '%mau%m6%'` on detail first | B |
| 7 | Metrics related to first-year sales | `LIKE '%sales%'` UNION question/metric_info | A |
| 8 | First-year sales top 1% & median | `sales_y` | B |
| 9 | Month-1 retention top 10% & median | `retention_m1` | B |
| 10 | Day-2 retention top 10% & median | `retention_rate_d2` | B |
| 11 | GaaS ratio median | A+ may miss → alignment fail → A1 `%gaas%` → `gaas_ratio` | B |
| 12 | GaaS ratio top 10 games | `gaas_ratio` | C |
| 13 | First-day sales top 10% & median | `sales_d` | B |
| 14 | Wishlists top 1%/10%/median | `wishlists_before_launch` | B |
| 15 | Wishlist-related metrics | `LIKE '%wishlist%'` | A |
| 16 | Wishlists top 10 games | `wishlists_before_launch` | C |

---

## Pitfalls & Notes

1. **`benchmark_detail` has no `date` column** — the skill-wide `date` filter rule does not apply. Filtering `WHERE date = ...` returns 0 rows silently.

2. **One game, multiple rows** — same `game_id × metric` fans out by `platform` AND `country_code`. For any distribution / ranking across games: **filter `country_code = 'global'`, pick ONE `platform`口径 (routing table in [Platform scoping](#platform-scoping)), then `GROUP BY game_id`**. Do **not** `MAX(value)` across countries or across platforms without fixing the dimension first (it cherry-picks each game's best slice and biases the result). See [Distribution fan-out](#distribution-fan-out-must-read).

3. **Do not guess metric codes** — e.g. `mau_m1` is wrong; run A+ / A1 → `ampere_mau_m1`. `mau_avg_m6` may not exist; always verify.

3b. **A+ non-empty ≠ resolved** — if A+ returns `revenue_*` but user asked GaaS / 占比 / wishlist / PCU, run alignment check and downgrade to A5 or A1. Do **not** pick the closest wrong metric just because A+ returned rows.

4. **`source = 'intelligence'`** — add when examples / product expect intelligence-sourced benchmark slices; omit only when user asks for all sources.

5. **`APPROX_QUANTILES` offsets** — top 1% = `[OFFSET(99)]` on 100-quantile; top 10% = `[OFFSET(90)]`; median = `[OFFSET(1)]` on 2-quantile.

6. **Avoid CTEs** — prefer inline subqueries; DataLab may treat CTE names as missing tables.

7. **`*_external` tables** — off-limits (duplicates for external systems).

8. **Wide KPI table** — `benchmark_intelligence_kpi_detail_pconsole` has pivoted columns (`sales_y`, `revenue_d`, …) per row; use only for single-game multi-KPI snapshot, not industry distribution.

9. **vginsights_* metric names** — historical naming; data comes via benchmark ETL. Note `source` in the answer.

---

## Intelligence Boundary

| Question | Where to query | Label |
|----------|----------------|-------|
| Industry median / top 1% / peer benchmark | `benchmark.benchmark_detail` | Benchmark |
| Game's actual DAU / revenue / downloads | `intelligence` (Sensortower, Alinea, …) | Source name |
| Game vs industry | Two separate queries | Two labels + caveat on comparability |
