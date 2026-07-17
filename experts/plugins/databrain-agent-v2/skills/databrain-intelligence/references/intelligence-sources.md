# Intelligence Data Sources Reference

## Table of Contents

- [Source Overview](#source-overview) — master table of all sources
- [Mobile Sources](#mobile-sources) — Sensortower stub + Sensortower Retention stub + AppAnnie stub
  - Full Sensortower (DAU / revenue / downloads) → [`sensortower.md`](sensortower.md)
  - Full Sensortower Retention → [`sensortower-retention.md`](sensortower-retention.md)
- [PC/Console Sources](#pcconsole-sources) — pconsole / Calibration / Alinea / Gamalytic (legacy) stubs + raw MScience / GSD / Ampere / NPD inline
  - Full PC/Console Integrated Wide Tables → [`pconsole-integrated-tables.md`](pconsole-integrated-tables.md)
  - Full DataBrain Calibration → [`databrain-calibration.md`](databrain-calibration.md)
  - Full Alinea (new Steam default) → [`alinea.md`](alinea.md)
  - Full Gamalytic (legacy Steam raw) → [`gamalytic.md`](gamalytic.md)
- [Store Rankings](#store-rankings) — stub. Full reference → [`store-rankings.md`](store-rankings.md)
- [Streaming Sources](#streaming-sources) — Streamhatchet stub. Full reference → [`streamhatchet.md`](streamhatchet.md)
- [Steam User Profiles](#steam-user-profiles) — Steam Overlap (inline)
- [Key Notes / Cross-source conventions](#key-notes)
- **Deprecated tables** (AppAnnie / VG Insights / Newzoo) → [`deprecated-tables.md`](deprecated-tables.md)

---

## Source Overview

| Source | Status | Platform | Key Metrics | Update Freq | Core Table |
|--------|--------|----------|-------------|-------------|------------|
| **Sensortower** | Active | Mobile | Downloads, revenue, DAU, MAU, retention | Daily / Weekly / Monthly | Use [`sensortower.md`](sensortower.md) (`game_metric_sensortower_*` / `*_uid`) for mobile metrics |
| **Sensortower App Overlap** | Active | Mobile | Overlap Rate, Affinity Score（受众重叠率 + 亲和力指数） | Monthly | `intelligence.sensortower_app_overlap_uid` — 手游受众重叠分析；key 为 `unified_id_app_a` × `unified_id_app_b`；无 global 汇总行，**未指定国家默认 `market='us'`**。Full reference: [`sensortower-overlap.md`](sensortower-overlap.md) |
| **AppAnnie** | **DEPRECATED** | Mobile | — | — | `game_metric_appannie_*` — **DO NOT QUERY**; see [`deprecated-tables.md`](deprecated-tables.md) |
| **VG Insights** | **DEPRECATED** | PC (Steam) | — | — | `game_metric_vginsights_daily` — **DO NOT QUERY**; see [`deprecated-tables.md`](deprecated-tables.md) |
| **PC/Console Integrated** | Active | PC + Console | **Cross-source wide table**: Gamalytic + Ampere + MScience + Streamhatchet + Reviews + Mentions in one row, by `combined_id` | Daily / Weekly / Monthly | `game_metric_pconsole_daily_cid` / `_weekly_cid` / `_monthly_cid` — **recommended entry for multi-metric PC/Console queries**. Full reference: [`pconsole-integrated-tables.md`](pconsole-integrated-tables.md) |
| **DataBrain Calibration** | Active | PC / Console | **Calibrated** daily + lifetime revenue / units (high-confidence single-source number; one auto-selected method per title) | Daily | `game_metric_calibration_lifetime_daily` / `game_metric_calibration_daily` — **prefer over `pconsole_*_cid.gamalytic_*` when the answer is reported as a serious external number**. Full reference: [`databrain-calibration.md`](databrain-calibration.md) |
| **Alinea Analytics** | Active | PC (Steam) | **NEW default Steam source** — PCU / ACU / **DAU** (`alinea_dau`, unique to Alinea), daily + cumulative revenue & units, wishlists (+ country breakdown), followers; supports upcoming-game queries. **Freshness**: PCU/ACU are T-0 partial → T-1 complete (Alinea is an aggregated estimate, catalog ramps through the day); DAU / revenue / wishlists / followers = T-1 only. For guaranteed-T-0 PCU/ACU use `pconsole_*_cid.spider_steam_pcu` (real-time crawler, `segment IS NULL` slice). Covers ~141K Steam games; Gamalytic (~338K games, T-1) is the long-tail coverage fallback. | Daily | Primary: `game_metric_alinea_daily_cid` (combined_id-keyed; default for daily queries). Monthly: `game_metric_alinea_monthly_cid` (adds `mau`). Raw: `game_metric_alinea_daily` (Steam URL `app_id`; use only when no `combined_id`). Wide-table: 17 `alinea_*` columns inside `pconsole_*_cid`. Full reference: [`alinea.md`](alinea.md). |
| **Gamalytic** | Legacy + coverage fallback | PC (Steam) | Units sold, revenue, reviews, followers (no DAU). T-1 across the board. **~338K games/day catalog** — ~2× Alinea's coverage, so this is the natural fallback when a long-tail Steam title is missing from Alinea. | Daily/Monthly | Raw: `game_metric_gamalytic_daily` — legacy. Wide-table: 15 `gamalytic_*` columns inside `pconsole_*_cid` (parallel feed with `alinea_*`; **prefer `alinea_*`** as primary, fall back here for coverage gaps). Full reference: [`gamalytic.md`](gamalytic.md). |
| **MScience** | Active | PC/Console | Revenue, user count | Daily/Monthly | `game_metric_mscience_daily_uid` (the `mscience_*` columns in `pconsole_*_cid` are the canonical entry by combined_id) |
| **GSD** | Active | Console | Physical/digital units & revenue | Weekly | `game_metric_gsd_weekly_uid` (also exposed as `gsd_*` columns in `pconsole_weekly_cid` by combined_id) |
| **Ampere** | Active | Console | DAU, retention, playtime | Daily/Monthly | `game_metric_ampere_daily_cid` (raw — use this when you need T-0/T-1; `pconsole_*_cid.ampere_*` has ~12d lag) |
| **NPD** | Active | Console | Sales data | Monthly | `game_metric_npd_monthly_uid` (also as `npd_*` columns in `pconsole_monthly_cid`) |
| **Streamhatchet** | Active | Streaming | Hours watched, peak/avg viewers, airtime, unique channels | Daily | `game_metric_streamhatchet_stream_uid` (uid-keyed, default). Full reference: [`streamhatchet.md`](streamhatchet.md) |
| **Newzoo** | Retired | PC/Console | DAU/MAU | — | `game_metric_newzoo_*` retired 2023-03-01; see [`deprecated-tables.md`](deprecated-tables.md) |
| **Store Rankings (Mobile)** | Active | Mobile | App Store / Google Play / TapTap daily rank | Daily | `game_metric_rank_mobile`. Full reference: [`store-rankings.md`](store-rankings.md) |
| **Store Rankings (PC / Console)** | Active | PC / Console | Steam / PS / Xbox / Epic / Nintendo rank | Daily | `game_metric_rank_pconsole_all` (superset; prefer this over `game_metric_rank_pconsole`). Full reference: [`store-rankings.md`](store-rankings.md) |

---

## Mobile Sources

### Sensortower

Raw mobile market intelligence (Tables A `app_id` / B `_uid` / C demographics + Decision Guide + query patterns) → **[`sensortower.md`](sensortower.md)**. Do not use `game_metric_mobile_daily` / `game_metric_mobile_monthly`.

### Sensortower Retention (monthly cohort)

Retention is now **monthly cohort** across two tables: default unified `intelligence.sensortower_retention_unified_monthly` (no platform); use app_id table `intelligence.sensortower_retention_monthly` only when platform / a specific package is involved. Bridge IDs via `common.sensortower_unified_ids`; aggregate by **MAU-weighted** average. Decision tree + schema + MAU JOIN + gotchas → **[`sensortower-retention.md`](sensortower-retention.md)**. The old `game_metric_sensortower_retention` (lifetime / `all_time`) is **still queryable but legacy (source data frozen since 2025-07-01; ETL may still refresh `insert_time`)** — use it ONLY for explicit **lifetime / launch-to-date** retention; everything else goes to the monthly cohort tables.

### Sensortower App Overlap

手游受众重叠与亲和力分析 (`intelligence.sensortower_app_overlap_uid`)。月度粒度，key 为 `unified_id_app_a` × `unified_id_app_b`。两个核心指标：overlap rate + affinity score。**未指定国家时默认 `market = 'us'`**。Full reference → **[`sensortower-overlap.md`](sensortower-overlap.md)**.


---

## PC/Console Sources

### PC/Console Integrated Wide Tables (RECOMMENDED entry points)

Wide pre-join of Gamalytic + Ampere + MScience + Streamhatchet + reviews + metascore + mentions, keyed by `combined_id`. Three variants: `game_metric_pconsole_daily_cid` (74 cols) / `_weekly_cid` (63) / `_monthly_cid` (111).

Schema, coverage matrix, freshness, filter templates, 7 query patterns, 11 pitfalls → **[`pconsole-integrated-tables.md`](pconsole-integrated-tables.md)**.

> **First stop** for any PC/Console multi-metric question. The two cross-cutting traps (`combined_id`-only key + sparse-fill / 30-day window) are documented above in [Cross-source conventions § 8](#cross-source-conventions). Fall back to a raw single-source table for T-0 freshness ([Ampere](#ampere) raw DAU), `unified_id` granularity, single-source clean semantics ([DataBrain Calibration](#databrain-calibration) for calibrated revenue), or fields not in the wide table (rank → [`store-rankings.md`](store-rankings.md), price_history, etc.).

---

### DataBrain Calibration

Authoritative single-source calibrated revenue / units for PC/Console (`game_metric_calibration_lifetime_daily` + `_daily`). Country split via `market` (60+); platform split via `sub_game_type`. T-0 freshness. One auto-selected `calibration_method` per game.

Schema, dimension matrix, 6 pitfalls, 6 query patterns → **[`databrain-calibration.md`](databrain-calibration.md)**.

> Use this **instead of `pconsole_*_cid.gamalytic_*`** when the number is reported as a serious external figure — pconsole is "Integrated / trend-only", Calibration is the canonical source. Same `combined_id`-only join key trap as the rest of the `*_cid` family ([§ 8](#cross-source-conventions)).

---

### Steam (VG Insights) — DEPRECATED

Access revoked. Use [Alinea](alinea.md) (PCU / ACU / revenue / units / wishlists / followers, all keyed by Steam `app_id`). Historical schema + migration → **[`deprecated-tables.md`](deprecated-tables.md#steam-vg-insights--deprecated)**.

---

### Alinea Analytics (Steam) — NEW DEFAULT

PC-only Steam source — replaces Gamalytic as the default for Steam PCU/ACU (T-0 partial → T-1 complete), DAU / wishlists / followers / daily revenue / cumulative units (T-1 for non-PCU metrics). **Not real-time** — live PCU/ACU → `spider_steam_*` on `pconsole_*_cid` (`segment IS NULL`). Three access paths:

- **`combined_id`-keyed daily** (default): `intelligence.game_metric_alinea_daily_cid` — direct `WHERE combined_id = '...'`, no JOIN gymnastics.
- **`combined_id`-keyed monthly**: `intelligence.game_metric_alinea_monthly_cid` — pre-aggregated monthly, includes `mau`.
- **Wide-table integration**: 17 `alinea_*` columns inside `pconsole_*_cid` (joined alongside Ampere / MScience / reviews / mentions in one row). `alinea_dau` and `alinea_wishlist_countries` are exclusive to Alinea — no equivalent under `gamalytic_*`.
- Raw `intelligence.game_metric_alinea_daily` (URL-keyed `app_id`) is only used when you don't have a `combined_id` and only a Steam app_id — for every other case use one of the above.

**Freshness**: `pcu` / `acu` are T-0 partial → T-1 complete (Alinea is an aggregated estimate; catalog ramps through the day). For **guaranteed-T-0 PCU/ACU** use `pconsole_*_cid.spider_steam_pcu` / `spider_steam_acu` from the `segment IS NULL` slice — real-time Steam-API crawler. `dau` / `revenue` / `units_sold` / `wishlists_total` / `followers_total` are T-1 only — no T-0 alternative; report "not yet available, latest = yesterday".

Schema + pitfalls + **upcoming rules** → **[`alinea.md`](alinea.md)**; executable SQL → **[`examples/alinea_queries.sql`](../examples/alinea_queries.sql)**. Wide-table patterns → **[`pconsole-integrated-tables.md`](pconsole-integrated-tables.md)** (Pattern 8 Gamalytic fallback).

> **Use Alinea, not Gamalytic, for every new Steam question** unless you specifically need a Gamalytic-only column / longer pre-Alinea history. Inside `pconsole_*_cid` the `alinea_*` and `gamalytic_*` prefixes are **parallel** feeds — don't mix them into a single headline number.

---

### Gamalytic — LEGACY (also coverage fallback)

PC-only Steam source (`game_metric_gamalytic_daily` / `_monthly`, `entity_type='pc'`, `market='global'`; plus 15 `gamalytic_*` columns inside `pconsole_*_cid`). **Legacy** as the primary Steam source, but it covers **~338K games/day vs Alinea's ~141K** — so it's the natural **coverage fallback** for long-tail / niche Steam titles missing from Alinea. Has no Steam DAU column (`alinea_dau` is exclusive to Alinea). Schema, pitfalls, query patterns → **[`gamalytic.md`](gamalytic.md)**.

> **Default Steam source is now [Alinea](alinea.md)**. Reach for Gamalytic when (a) Alinea is NULL for the game (catalog coverage gap — Gamalytic covers ~2× catalog; see [`pconsole-integrated-tables.md` Pattern 8](pconsole-integrated-tables.md#pattern-8--steam-source-selection-freshness-today--coverage-long-tail)), (b) you need pre-Alinea history (probe `MIN(date)` on each provider first), (c) you're reproducing a pre-existing Gamalytic-based report, or (d) cross-validating providers (also pull `spider_steam_pcu/acu` from the `segment IS NULL` slice as a third independent reading).

---

### MScience

> **Prefer `pconsole_*_cid.mscience_*` for combined_id-keyed queries** — MScience data is exposed as `mscience_total_revenue` / `mscience_total_units` / `mscience_digital_*` columns alongside other sources, no JOIN required. Use this raw `_uid` table when you specifically need `unified_id` granularity or per-`storefront` breakdown not in the wide table.

**Commercial data source** providing PC/Console revenue and user count data.

**Core tables:**
- `intelligence.game_metric_mscience_daily` — daily data
- `intelligence.game_metric_mscience_daily_uid` — daily data by unified_id (materialized view)
- `intelligence.game_metric_mscience_monthly` — monthly data
- `intelligence.game_metric_mscience_monthly_uid` — monthly data by unified_id (materialized view)

**Key fields:**

| Field | Type | Notes |
|-------|------|-------|
| `combined_id` | STRING | Game combined ID |
| `edition_id` | STRING | Game edition ID |
| `entity_type` | STRING | Platform type |
| `date` | DATE | Data date |
| `segment` | STRING | Market segment |
| `storefront` | STRING | Store platform |
| `market` | STRING | Market / country |
| `units_sold` | INTEGER | Units sold |
| `num_users` | INTEGER | User count |
| `revenue` | FLOAT | Revenue |

**Query note:** `intelligence.game_metric_mscience_daily` commonly keys rows by `app_id`, not directly by `edition_id`. For title-specific lookups, first map `edition_id` to the actual `app_id` through `common.unified_ids`, then query MScience by that `app_id`. If the mapped `app_id` still returns zero rows, treat the title as unavailable in current MScience coverage instead of assuming revenue is zero.

---

### GSD

> **Prefer `pconsole_weekly_cid` for combined_id-keyed queries** — GSD digital/physical revenue & units are exposed there as `gsd_digital_revenue` / `gsd_digital_units` / `gsd_physical_revenue` / `gsd_physical_units` (no `gsd_` prefix in the wide table; they're top-level columns). Use this raw `_uid` table when you need by-`unified_id` granularity or per-`type`/`device` breakdown.

**Commercial data source** — Game Sales Data (Video Games Europe) — European game sales.

**Data source:** https://www.gamesalesdata.com/

**Core tables:**
- `intelligence.game_metric_gsd_weekly` — weekly data (by app_id)
- `intelligence.game_metric_gsd_weekly_uid` — weekly data (by unified_id)

**Partition field:** `date` (monthly `MONTH`)

**Key fields:**

| Field | Type | Notes |
|-------|------|-------|
| `combined_id` | STRING | Game combined ID |
| `edition_id` | STRING | Game edition ID |
| `entity_type` | STRING | Platform type |
| `date` | DATE | Data date (Monday of the week) |
| `type` | STRING | Sale type (`retail` / `network`) |
| `device` | STRING | Device |
| `segment` | STRING | Market segment |
| `market` | STRING | Market / country |
| `digital_revenue` | FLOAT | Digital edition revenue |
| `digital_units` | FLOAT | Digital edition units |
| `physical_revenue` | FLOAT | Physical edition revenue |
| `physical_units` | FLOAT | Physical edition units |

**Data lag:** ~1 week  
**Coverage:** Primarily European markets. GSD's upstream data matching uses their internal `title_name` + `platform_type` fields — these are **NOT queryable columns in BigQuery**; do not reference them in SQL.

**GSD Query Notes:**
1. **`_uid` table key is `edition_id`** (NOT `id` or `unified_id`). Use `WHERE edition_id = '...'` or JOIN on `edition_id`.
2. **`digital_revenue` / `physical_revenue` can be NULL**: some games only have digital or only physical data. Always use `IFNULL(digital_revenue, 0) + IFNULL(physical_revenue, 0)` for total revenue.
3. **No genre/category field**: JOIN `common.app_detail` on `edition_id` to get `iegg_genre` for category-based analysis. Filter `segment = 'Game'` to exclude DLC.
4. **No `title_name` / game name column in GSD tables**: to display the game's title, `LEFT JOIN common.app_detail d ON d.app_id = g.edition_id AND d.id_type = 'edition_id'` and use `d.entity_name`. Never select `title_name` directly from GSD tables.
5. **Platform column**: use `device` for platform-level breakdown (e.g. "PlayStation 4", "PlayStation 5", "Xbox One", "Xbox Series X/S", "PC"). If the user asks for a consolidated Platform label (PC / PlayStation / Xbox / Switch), derive it with a CASE expression on `device`.
6. **Format column**: `type = 'network'` → Digital; `type = 'retail'` → Physical. Use a `CASE WHEN type = 'network' THEN 'Digital' WHEN type = 'retail' THEN 'Physical' END` expression when the user requests a Format column.
7. **Territory column**: `market` holds individual GSD territory codes (e.g. `GSA`, `France`, `United Kingdom`, `Bene`, `Iberia`, `Italy`, `Nordics`, `Poland`, `Eastern Europe`, `USA & Canada`, `Asia`, `LATAM`, `Oceania`, `Middle East`). Do NOT aggregate across territories unless explicitly asked.

---

### Ampere

> **`pconsole_*_cid` exposes the same Ampere data** as `ampere_dau` / `ampere_new_users` / `ampere_bounded_N` / `ampere_unbounded_N` columns, alongside Gamalytic + reviews + mentions in one row. **BUT** `pconsole_*_cid.ampere_*` lags ~12 days behind this raw table; for **T-0 / T-1 freshness** (e.g. "yesterday's PS5 DAU") use this raw table directly. For monthly MAU / `time_spent_Nh` distribution / `d1`/`d7`/`d28` retention, use **`pconsole_monthly_cid`** which has 21 Ampere columns (vs the raw monthly which has fewer).

**Commercial data source** providing Console DAU, retention, and playtime data.

**Core tables:**
- `intelligence.game_metric_ampere_daily` — daily data (by edition_id)
- `intelligence.game_metric_ampere_daily_cid` — daily data (by combined_id)
- `intelligence.game_metric_ampere_monthly` — monthly data
- `intelligence.game_metric_ampere_monthly_cid` — monthly data (by combined_id)


**Key fields:**

| Field | Type | Notes |
|-------|------|-------|
| `combined_id` | STRING | Game combined ID |
| `edition_id` | STRING | Game edition ID |
| `entity_type` | STRING | `pc` / `console` |
| `date` | DATE | Data date |
| `platform` | STRING | PS4 / Xbox Series / PC / ... |
| `market` | STRING | Market / country (fr / us / jp / ...) |
| `device` | STRING | PlayStation 5 / PlayStation 4 / Xbox One / ... |
| `active_users` | INTEGER | Estimated DAU, USE AVG() to aggregate |
| `new_users` | INTEGER | New users |
| `hours_played` | FLOAT | Total hours played |
| `bounded_1` | INTEGER | D1 retained users (still playing on day 1) |
| `bounded_7` | INTEGER | D7 retained users |
| `bounded_14` | INTEGER | D14 retained users |
| `bounded_28` | INTEGER | D28 retained users |
| `bounded_60` | INTEGER | D60 retained users |
| `unbounded_1` | INTEGER | Users who returned on day 1 or later |
| `unbounded_7` | INTEGER | Users who returned on day 7 or later |
| `unbounded_14` | INTEGER | Users who returned on day 14 or later |
| `unbounded_28` | INTEGER | Users who returned on day 28 or later |
| `unbounded_60` | INTEGER | Users who returned on day 60 or later |

**Retention metric distinction:**
- `bounded_N`: strict day-N retention (still playing exactly on day N)
- `unbounded_N`: day-N-or-later retention (returned any time after day N)
- Denominator for retention rate: typically `new_users`

---

### NPD

**Commercial data source** providing North American game sales data.

**Core tables:**
- `intelligence.game_metric_npd_monthly` — monthly data
- `intelligence.game_metric_npd_monthly_uid` — monthly data by unified_id (materialized view)

**Update frequency:** Monthly

---

## Store Rankings

Daily storefront rankings: `game_metric_rank_mobile` (App Store / Google Play / TapTap) + `game_metric_rank_pconsole_all` (Steam / PS / Xbox / Epic / Nintendo, superset over `game_metric_rank_pconsole`).

Schema, per-store `source` catalogues, 6 query patterns (incl. **Steam Top Sellers + pconsole enrichment**), 10 pitfalls → **[`store-rankings.md`](store-rankings.md)**.

> Mobile top free / paid / grossing / popular are queried from `game_metric_rank_mobile` directly. Join through `common.unified_ids` when a mobile `unified_id` mapping is needed.

---

## Streaming Sources

### Streamhatchet

**Commercial data source** for Twitch, YouTube Gaming, and Facebook Gaming streaming data.

**Core table:** `intelligence.game_metric_streamhatchet_stream_uid` — game-level metrics keyed by `id` (unified_id value; see [Cross-source conventions §7](#cross-source-conventions)). Key metrics: `hours_watched`, `airtime_hours`, `peak_viewers`, `average_viewers`. Always filter `granularity = 'daily'` — only daily granularity exists in this table.

**Wide-table integration:** `pconsole_*_cid` exposes 4 Streamhatchet columns: `streamhatchet_hours_watched`, `streamhatchet_airtime_hours`, `streamhatchet_peak_viewers`, `streamhatchet_average_viewers` (summed across platforms; sparse-fill — use 30-day window for "latest").

Full schema, pitfalls, and query patterns → **[`streamhatchet.md`](streamhatchet.md)**.

---

## Steam User Profiles

> Source: https://iwiki.woa.com/p/4013661245

Steam user profile data built from periodically crawled user profiles, containing game libraries, wishlists, and recent play history.

### Crawl Method

- **Periodic refresh:** weekly crawl for trend analysis
- **One-time crawl:** custom crawl for specific Steam ID lists
- **Tech:** Web + cookie based (converted from API + api_key)

**Raw source table:** `t_spider_steam_member_info_daily` — daily crawled user profile data

### Data Tables

**DWD/DWM layer:**

| Table | Description | Granularity |
|-------|-------------|-------------|
| `steam_member_info` | Latest user info | Latest |
| `steam_member_base` | User basic info | Latest |
| `steam_user_game` | User game library | Latest |
| `steam_user_wish` | User wishlist | Latest |
| `steam_user_recent_play` | Recent 2-week playtime | Latest |
| `steam_user_game_daily` | Per-crawl game list | Daily |
| `steam_user_wish_daily` | Per-crawl wishlist | Daily |
| `steam_user_recent_play_daily` | Per-crawl playtime | Daily |
| `steam_user_game_weekly` | Weekly game list | Weekly (Monday) |
| `steam_user_wish_weekly` | Weekly wishlist | Weekly (Monday) |
| `steam_user_recent_play_weekly` | Weekly playtime | Weekly (Monday) |

**Aggregate tables:**
- `steam_game_count_by_country` — owner count by country
- `steam_game_count_by_region` — owner count by region

**Caveat:** Weekly crawls cannot guarantee the same users are captured every week (some users may have private profiles; crawl volume may vary). For churn analysis comparing two periods, pay close attention:
- **User not crawled last week:** cannot be used for churn analysis
- **User crawled last week but game not in list:** new purchase / active user
- **User crawled last week and game in list:** active user

---

## Key Notes

1. **DEPRECATED SOURCES:** VG Insights and AppAnnie tables must NOT be queried — access revoked. Use **Alinea** for PC/Steam data (new default; see [`alinea.md`](alinea.md)) and Sensortower for mobile data. Gamalytic raw is now legacy — only fall back to it when Alinea doesn't cover the field or the history range.
2. **ID field varies by source:** different tables use `app_id`, `edition_id`, `unified_id`, or `combined_id` — always check before querying.
3. **Partition field required:** most tables partition by `date` (monthly or yearly) — always include a time range filter.
4. **Data lag varies:** different metrics have different update frequencies (see table notes above).
5. **Newzoo historical data:** stopped updating 2023-03-01; historical records remain queryable.
6. **Ampere retention metrics:** distinguish `bounded` (strict day N) vs `unbounded` (day N or later); use `new_users` as denominator for retention rates.

### Cross-source conventions

7. **All `*_uid` tables use `id`, NOT `unified_id`**: `sensortower_daily_uid`, `sensortower_weekly_uid`, `sensortower_monthly_uid`, `mscience_*_uid`, `streamhatchet_stream_uid`, `npd_monthly_uid`, etc. all expose the unified_id value through a column literally named `id`. Writing `WHERE unified_id = '...'` raises `Unrecognized name: unified_id`. **GSD is the exception**: `game_metric_gsd_weekly_uid` uses `edition_id` (see GSD section).
8. **`*_cid` family rules** — apply to `game_metric_pconsole_daily_cid` / `_weekly_cid` / `_monthly_cid`, `game_metric_calibration_daily` / `_lifetime_daily`, `game_metric_ampere_daily_cid` / `_monthly_cid`. Two cross-cutting rules; sub-references describe table-specific details:

   **(a) JOIN / filter key = `combined_id` ONLY** — most common silent failure. `*_cid` tables have **no** `edition_id` / `unified_id` columns. Using `WHERE edition_id = 'e...'` or `WHERE unified_id = 'u...'` returns **0 rows without any error**, and the agent wrongly concludes "game has no data". Always filter on `combined_id` (the `c` prefix). If `search_entity.py` only returned `pc_id` / `mobile_id`, resolve via `common.unified_combined_ids` first:
   ```sql
   SELECT combined_id FROM common.unified_combined_ids
   WHERE edition_id = 'e9ec9568bb80051c45b5d19204249d6f0'   -- or unified_id / app_id
   LIMIT 1
   ```

   **(b) Sparse-fill — default to a 30-day window when fetching "latest"** (applies to integrated wide tables `pconsole_*_cid` specifically; calibration is dense). Each source column (`gamalytic_*` / `mscience_*` / `ampere_*` / `streamhatchet_*`) is filled on only a fraction of `(combined_id, date, slice)` rows, so a single-day filter for "today / current / latest" leaves 80%+ NULL even when the game has data.

   **Decide by the user's date intent**:

   | User asked for | Date filter | Aggregation |
   |---|---|---|
   | "current / latest / now / today" (no date specified) | `date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) AND CURRENT_DATE()` | per-column non-null aggregation (see below) |
   | A specific date or date range (e.g. "2026-03-15", "May 2026", "last week") | Honor the user's filter exactly | usually no aggregation needed; if the slice is mostly NULL, **report that as a data observation** rather than substituting a wider window |
   | "As of date X" (snapshot semantics) | Optionally `date BETWEEN DATE_SUB('X', INTERVAL 30 DAY) AND 'X'` | per-column non-null aggregation, anchored to X |

   **Aggregation rules (when using a window)**:
   - **Monotonic / cumulative-ish fields** (cumulative revenue/units, wishlists totals) → `MAX(CASE WHEN col IS NOT NULL THEN col END)`
   - **Point-in-time fields** (current price, snapshot scores) → `MAX_BY(col, CASE WHEN col IS NOT NULL THEN date END)`

   Measured (default "latest" path): a Steam Top Sellers 50-row enrichment matched only **3/50** rows on a single-day JOIN; same query with a 30-day window matched **48/50** (16× hit rate). Sub-reference query patterns assume the default-latest path unless they explicitly say "user-specified date".

   For table-specific details (per-source freshness, sparsely-vs-densely-filled sources, vestigial columns, dimension semantics) see: [`pconsole-integrated-tables.md`](pconsole-integrated-tables.md), [`databrain-calibration.md`](databrain-calibration.md).

9. **Publisher cross-platform lifetime revenue pattern (Mobile + PC)**: for franchises that span mobile and PC (e.g. Age of Empires), query **Alinea** raw (per-day `SUM(revenue)` over the window, joined via `steam_id`) for PC and Sensortower (`monthly_uid` + partial `daily_uid`) for mobile. Sum across editions and platforms. Clearly label each source and note the revenue definitions differ (mobile = IAP/ad estimate; PC = Steam gross/net sales estimate). For pre-Alinea-coverage years where only Gamalytic has data, label that segment as "Gamalytic (legacy)" and stitch the two series carefully (don't double-count any overlapping date range).
10. **When a `_uid` query returns zero rows but the ID is valid**: fall back to the non-`_uid` equivalent using `entity_name` LIKE matching. Common for older / multi-edition titles with incomplete unified mapping.

**DEPRECATED — DO NOT QUERY:**
- `intelligence.game_metric_vginsights_daily` — VG Insights access revoked
- `intelligence.game_metric_appannie_*` — AppAnnie access revoked

---

## Benchmark (对标分析层)

Industry peer benchmarks (median, top 1%, rankings) live in the **`benchmark` schema**, not in intelligence metric tables. Entry point: `benchmark.benchmark_detail` (long-format `game_id × metric → value`).

Full reference → **[`benchmark-sources.md`](benchmark-sources.md)**. Do not list benchmark tables here — route via SKILL.md §3 domain-specific sources.
