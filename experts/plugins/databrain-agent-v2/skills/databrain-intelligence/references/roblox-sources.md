# Roblox Data Reference

> Coverage: Roblox top-games CCU rankings, anomaly detection, and gameplay classification tags
> Database: `intelligence` schema, `database_uuid = 15000`

---

## Table of Contents

- [Source Overview](#source-overview)
- [Tables](#tables)
  - [game_change_report_top_roblox](#game_change_report_top_roblox)
  - [game_change_report_anomaly_roblox](#game_change_report_anomaly_roblox)
  - [game_change_report_roblox_grc_tags](#game_change_report_roblox_grc_tags)
- [Key Dimensions](#key-dimensions)
- [Common Query Patterns](#common-query-patterns)
- [Pitfalls & Notes](#pitfalls--notes)

---

## Source Overview

| Table | Grain | Partition |
|-------|-------|-----------|
| `intelligence.game_change_report_top_roblox` | Daily Top-N by peak CCU | `date` |
| `intelligence.game_change_report_anomaly_roblox` | Daily anomaly flags (new entries, big swings) | `date` |
| `intelligence.game_change_report_roblox_grc_tags` | Latest gameplay classification tags per game | none |

---

## Tables

### game_change_report_top_roblox

**Roblox top games daily ranking** — snapshot of top Roblox experiences by peak CCU (concurrent users), with rank changes vs. the previous period.

**Full table**: `intelligence.game_change_report_top_roblox`

| Field | Type | Description |
|-------|------|-------------|
| `date` | DATE | Data date — partition field |
| `game_id` | STRING | Roblox experience/game ID |
| `game_name` | STRING | Game name |
| `ccu_rank` | INT64 | Current CCU rank position (1-based) |
| `peak_ccu` | INT64 | Peak concurrent users on this date |
| `prev_ccu` | INT64 | Previous period's CCU |
| `ccu_change` | INT64 | CCU change (current − previous) |
| `change_type` | STRING | Change type description (or `None`) |
| `is_new_online` | INT64 | Newly launched flag (1 = new, 0 = existing) |
| `insert_time` | TIMESTAMP | Row insert time |

**Use cases**: Roblox top-N by CCU for a given day/week, biggest CCU jumpers, newly launched experiences that broke into the chart, per-game CCU ranking trend.

---

### game_change_report_anomaly_roblox

**Roblox anomaly flags** — games flagged with unusual ranking behavior (new entries, sudden jumps/drops).

**Full table**: `intelligence.game_change_report_anomaly_roblox`

| Field | Type | Description |
|-------|------|-------------|
| `date` | DATE | Data date — partition field |
| `game_id` | STRING | Roblox game ID |
| `change_type` | STRING | Anomaly type (e.g. `新上榜` = newly charted) |
| `insert_time` | TIMESTAMP | Row insert time |

**Use cases**: "Which Roblox games newly entered the chart this week?", anomaly detection feeds.

---

### game_change_report_roblox_grc_tags

**Roblox game classification tags** — gameplay and element tags for top Roblox games. Latest snapshot only (no date column).

**Full table**: `intelligence.game_change_report_roblox_grc_tags`

| Field | Type | Description |
|-------|------|-------------|
| `game_name` | STRING | Game name |
| `game_id` | STRING | Roblox game ID |
| `primary_gameplay` | STRING | Primary gameplay type (e.g. `RPG`, `经营养成`, `轻竞技`, `轻SOC`) |
| `main_element` | STRING | Main game element (e.g. `RNG`, or `None`) |
| `new_ranking_time` | STRING | Time when the game first entered the ranking (or `None`) |

**Use cases**: distribution of Roblox top games by gameplay type, RPG / RNG / social subsets, joining tags onto the ranking table.

---

## Key Dimensions

### `change_type` values (anomaly table)

- `新上榜` — newly charted
- Other values may exist for rank jumps/drops — treat as opaque STRING

### `primary_gameplay` values (tags table)

- `RPG`
- `经营养成` (management / nurture)
- `轻竞技` (casual competitive)
- `轻SOC` (light social)
- Others may exist — enumerate with `GROUP BY primary_gameplay`

### `is_new_online` flag (top table)

- `1` — newly launched experience
- `0` — existing experience

---

## Common Query Patterns

### 1. Roblox Top 10 by CCU for the latest date

```sql
SELECT date, game_name, ccu_rank, peak_ccu, ccu_change
FROM intelligence.game_change_report_top_roblox
WHERE date = (
  SELECT MAX(date) FROM intelligence.game_change_report_top_roblox
  WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
)
ORDER BY ccu_rank
LIMIT 10
```

### 2. Newly launched games entering the chart (last 7 days)

```sql
SELECT date, game_name, peak_ccu, ccu_rank
FROM intelligence.game_change_report_top_roblox
WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
  AND is_new_online = 1
ORDER BY date DESC, ccu_rank
LIMIT 20
```

### 3. Anomaly list + top chart (attach game names to anomaly rows)

```sql
SELECT a.date, a.game_id, a.change_type,
       t.game_name, t.peak_ccu, t.ccu_rank
FROM intelligence.game_change_report_anomaly_roblox a
LEFT JOIN intelligence.game_change_report_top_roblox t
  ON a.game_id = t.game_id AND a.date = t.date
WHERE a.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
ORDER BY a.date DESC
LIMIT 20
```

### 4. Tags + top chart (enrich ranking with gameplay classification)

```sql
SELECT r.date, r.game_name, r.ccu_rank, r.peak_ccu,
       g.primary_gameplay, g.main_element
FROM intelligence.game_change_report_top_roblox r
LEFT JOIN intelligence.game_change_report_roblox_grc_tags g
  ON r.game_id = g.game_id
WHERE r.date = (
  SELECT MAX(date) FROM intelligence.game_change_report_top_roblox
  WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
)
ORDER BY r.ccu_rank
LIMIT 20
```

### 5. Gameplay distribution across top games

```sql
SELECT primary_gameplay, COUNT(*) AS cnt
FROM intelligence.game_change_report_roblox_grc_tags
WHERE primary_gameplay IS NOT NULL
GROUP BY primary_gameplay
ORDER BY cnt DESC
LIMIT 20
```

### 6. Per-game CCU trend

```sql
SELECT date, ccu_rank, peak_ccu, ccu_change
FROM intelligence.game_change_report_top_roblox
WHERE game_id = ?
  AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
ORDER BY date
```

---

## Pitfalls & Notes

1. **Anomaly table has no `game_name`**: always JOIN `game_change_report_top_roblox` on `game_id` (and `date` when available) to get readable names.

2. **Tags table has no date partition**: `game_change_report_roblox_grc_tags` is a latest-snapshot table — do not filter or join by `date`. Tags may lag behind new entries on the ranking.

3. **Always filter `date` on partitioned tables**: `game_change_report_top_roblox` and `game_change_report_anomaly_roblox` are `date`-partitioned — unbounded queries scan everything.

4. **"Latest date" requires a bounded subquery**: wrap `SELECT MAX(date)` with a date floor (e.g. `WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)`) to keep the partition scan cheap.

5. **Roblox `game_id` is NOT a DataBrain unified/combined ID**: it is the Roblox-native experience ID and cannot be joined to `common.app_detail` / `common.combined_detail` / Sensortower / Gamalytic tables.

6. **`change_type` is mostly Chinese text**: filter with `LIKE '%新上榜%'` or enumerate with `GROUP BY change_type` before assuming values.

7. **`peak_ccu` is a daily peak, not an average**: comparing `peak_ccu` across dates represents peak-vs-peak, not sustained user base.
