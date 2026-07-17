# Deprecated Tables — DO NOT QUERY

> Consolidated reference for retired / revoked DataBrain intelligence tables (AppAnnie / VG Insights / Newzoo).
>
> **Agents must not write SQL against any table on this page.** When the user asks for a metric only available from one of these sources, first reach for the live alternative in the migration table, then explicitly tell the user the requested data is unavailable and label the cause (e.g. "Steam DAU/MAU was a VG Insights field; access has been revoked, no current substitute").

## Migration cheat sheet

| Deprecated source | Status | Replacement live source(s) |
|-------------------|--------|----------------------------|
| **AppAnnie** (mobile) | Access revoked | [Sensortower](sensortower.md) — downloads, revenue, DAU, MAU; [Sensortower Retention](sensortower-retention.md) — retention. Use `_uid` tables for unified_id-keyed mobile metrics. |
| **Steam (VG Insights)** (PC) | Access revoked | [Gamalytic](gamalytic.md) for revenue / units sold / wishlists / followers / reviews. **DAU / MAU / PCU / ACU have no current substitute** — report as a data gap. |
| **Newzoo** (PC/Console) | Retired 2023-03-01 | None — historical data is no longer maintained. For current PC/Console DAU use [Ampere](intelligence-sources.md#ampere); for sales use [DataBrain Calibration](databrain-calibration.md) or [Gamalytic](gamalytic.md). |

---

## AppAnnie — DEPRECATED

Access to all AppAnnie tables has been revoked. For mobile downloads / revenue / DAU, use **Sensortower** exclusively.

**Deprecated tables (DO NOT USE):**

- `intelligence.game_metric_appannie_daily`
- `intelligence.game_metric_appannie_weekly`
- `intelligence.game_metric_appannie_monthly`
- `intelligence.game_metric_appannie_daily_uid`

**Migration**: any AppAnnie query → equivalent Sensortower table in [sensortower.md](sensortower.md) (metrics) or [sensortower-retention.md](sensortower-retention.md) (retention). The `_uid` and granularity conventions are the same; field names are mostly identical (`revenue`, `download`, `dau`, etc.).

---

## Steam (VG Insights) — DEPRECATED

Access to VG Insights has been revoked. For all Steam / PC data (revenue, units sold, wishlists, reviews, followers), use **[Gamalytic](gamalytic.md)** exclusively.

**Deprecated table (DO NOT USE):** `intelligence.game_metric_vginsights_daily`

<details>
<summary>Historical reference (schema kept for migration awareness only)</summary>

**Key fields that were available:**

| Field | Type | Notes | Update Freq |
|-------|------|-------|-------------|
| `date` | DATE | Data date | — |
| `app_id` | STRING | Steam App ID (full URL) | — |
| `revenue` | FLOAT | Daily revenue (USD) | Daily |
| `units_sold` | INTEGER | Daily units sold | Daily |
| `price` | FLOAT | Current price (USD) | Daily |
| `revenue_total` | FLOAT | Cumulative revenue | Daily |
| `units_sold_total` | INTEGER | Cumulative units sold | Daily |
| `owners` | INTEGER | Owner count | Daily |
| `dau` | INTEGER | Daily active users | Daily (t-1 delay) |
| `mau` | INTEGER | Monthly active users | Daily |
| `acu` | FLOAT | Average concurrent users | Daily (t-1 delay) |
| `pcu` | INTEGER | Peak concurrent users | Daily (t-1 delay) |
| `wishlists` | INTEGER | New wishlists added | Daily (t-2 delay) |
| `wishlists_total` | INTEGER | Cumulative wishlists | Daily (t-2 delay) |
| `followers` | INTEGER | New followers | Daily |
| `followers_total` | INTEGER | Cumulative followers | Daily |
| `review_positive` | INTEGER | New positive reviews | Daily |
| `review_negative` | INTEGER | New negative reviews | Daily |
| `review_total` | INTEGER | New total reviews | Daily |
| `cumulative_review_total` | INTEGER | Cumulative total reviews | Semi-monthly (~7th, 23rd) |
| `cumulative_review_positive` | INTEGER | Cumulative positive reviews | Semi-monthly |
| `cumulative_review_negative` | INTEGER | Cumulative negative reviews | Semi-monthly |
| `rating` | FLOAT | Positive rating % (0-100) | Daily |
| `avg_playtime` | INTEGER | Average playtime (minutes) | Twice/month (~7th, 23rd) |
| `median_playtime` | INTEGER | Median playtime (minutes) | Twice/month (~7th, 23rd) |
| `top_countries` | STRING | Top country distribution | 2-4×/month (~8, 14, 21, 27) |
| `steam_genre` | STRING | Steam genre | — |
| `steam_sub_genre` | STRING | Steam sub-genre | — |

**⚠️ Note:** `app_id` in VG Insights was the full Steam URL (`https://store.steampowered.com/app/...`). Used `common.unified_ids` to convert from `edition_id`.

</details>

**Migration note:** Gamalytic covers revenue, units_sold, reviews, followers, wishlists. **DAU / MAU / PCU / ACU are NOT available in Gamalytic** — report as a data gap when specifically asked. For PC concurrent-user metrics, the closest live alternative is `pconsole_*_cid.gamalytic_acu` / `gamalytic_pcu` (where populated) — see [pconsole-integrated-tables.md](pconsole-integrated-tables.md).

---

## Newzoo — RETIRED 2023-03-01

Newzoo was a third-party PC / Console DAU / MAU / engagement source. Updates stopped on 2023-03-01; historical rows may still exist but are not maintained and should not be cited as current.

**Retired tables:** `intelligence.game_metric_newzoo_*`

**Migration**:

- For Console DAU / retention → [Ampere](intelligence-sources.md#ampere) (raw) or `pconsole_*_cid.ampere_*` (integrated)
- For PC engagement → [Gamalytic](gamalytic.md) `pcu` / `acu`, or `pconsole_*_cid.gamalytic_acu` / `gamalytic_pcu`
- For PC/Console calibrated revenue / units → [DataBrain Calibration](databrain-calibration.md)
