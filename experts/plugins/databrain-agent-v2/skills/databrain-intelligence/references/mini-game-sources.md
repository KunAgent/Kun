# Mini Game Data Sources Reference

> Coverage: WeChat Mini Games, Douyin Mini Games, Facebook Instant Games
> Data range: 2024-03-02 ~ present (daily updates)
> Database: `intelligence` schema, `database_uuid = 15000`

---

## Table of Contents

- [Source Overview](#source-overview)
- [Tables](#tables)
  - [mini_game_rank (daily rank snapshot)](#mini_game_rank)
  - [mini_game_rank_weekly (weekly aggregation)](#mini_game_rank_weekly)
  - [mini_game_rank_change (notable rank movers)](#mini_game_rank_change)
  - [mini_game_rank_top (daily top 3 per board)](#mini_game_rank_top)
  - [mini_game_rank_change_tag_daily (daily tag changes)](#mini_game_rank_change_tag_daily)
- [Key Dimensions](#key-dimensions)
- [Common Query Patterns](#common-query-patterns)
- [Pitfalls & Notes](#pitfalls--notes)

---

## Source Overview

| Source | Platform | Leaderboard Types | Rows per day (per board) |
|--------|----------|-------------------|--------------------------|
| `wechat` | 微信小游戏 | `bestseller`, `most_played`, `popularity` | ~100 |
| `douyin` | 抖音小游戏 | `bestseller`, `fresh_game`, `popularity` | ~100 |
| `facebook` | Facebook Instant Games | `most_played`, `new_releases`, `top_grossing` | ~102 |

**Leaderboard types explained:**

| Type | Meaning | Available on |
|------|---------|--------------|
| `bestseller` | 畅销榜 (revenue ranking) | wechat, douyin |
| `most_played` | 人气榜 / most played | wechat, facebook |
| `popularity` | 热度榜 (trending/popularity) | wechat, douyin |
| `fresh_game` | 新游榜 (new games) | douyin |
| `new_releases` | New releases | facebook |
| `top_grossing` | Top grossing | facebook |

---

## Tables

### mini_game_rank

**Daily rank snapshot** — the main table. Contains full top ~100 per source/leaderboard per day.

**Full table**: `intelligence.mini_game_rank`

| Field | Type | Description |
|-------|------|-------------|
| `fetch_date` | DATE | Data date |
| `source` | STRING | `wechat` / `douyin` / `facebook` |
| `leadboard_type` | STRING | `bestseller` / `most_played` / `popularity` / `fresh_game` / `new_releases` / `top_grossing` |
| `app_id` | STRING | Platform-specific app ID (`wx...` for wechat, `tt...` for douyin, numeric for facebook) |
| `app_name` | STRING | Game name |
| `app_cover` | STRING | Cover image URL |
| `app_desc` | STRING | Game description |
| `images` | STRING | Image URLs |
| `game_rank` | INT64 | Current rank position (1-based) |
| `rank_change` | STRING | Rank change from previous day (positive = up, negative = down, "0" = unchanged) |
| `is_new_rank` | BOOL | Whether the game is newly entered into the ranking |
| `consecutive_days` | INT64 | Consecutive days on the ranking |
| `consecutive_rank_days` | INT64 | Consecutive days at current rank position |
| `rank_history` | STRING | Recent rank history (JSON-like) |
| `category` | STRING | Game category (e.g. `休闲, 益智` / `角色, 卡牌` / `Games, Puzzle`) |
| `tags` | STRING | Game tags (mostly Facebook; pipe-separated, e.g. `Puzzle|Quick Play|Match`) |
| `publisher` | STRING | Publisher/developer name |
| `create_time` | DATETIME | Record creation time |

---

### mini_game_rank_weekly

**Weekly aggregation** — summarizes a week's ranking performance per game.

**Full table**: `intelligence.mini_game_rank_weekly`

| Field | Type | Description |
|-------|------|-------------|
| `week_start_date` | DATE | Week start (Monday) |
| `week_end_date` | DATE | Week end (Sunday) |
| `source` | STRING | Platform |
| `leadboard_type` | STRING | Leaderboard type |
| `app_id` | STRING | App ID |
| `app_name` | STRING | Game name |
| `app_cover` | STRING | Cover image URL |
| `app_desc` | STRING | Description |
| `category` | STRING | Category |
| `tags` | STRING | Tags |
| `publisher` | STRING | Publisher |
| `images` | STRING | Images |
| `weekly_rank` | INT64 | Rank within the week |
| `avg_rank` | FLOAT64 | Average daily rank during the week |
| `best_rank` | INT64 | Best (lowest number) rank during the week |
| `latest_rank` | INT64 | Rank on the last day of the week |
| `days_on_rank` | INT64 | Number of days on the ranking during the week |
| `rank_change_value` | FLOAT64 | Rank change value (vs previous week) |
| `rank_change` | STRING | Rank change description |
| `is_new_rank` | BOOL | Newly entered this week |
| `last_week_avg_rank` | FLOAT64 | Previous week's avg rank |
| `last_week_best_rank` | INT64 | Previous week's best rank |
| `last_week_days_on_rank` | INT64 | Previous week's days on rank |
| `avg_consecutive_rank_days` | FLOAT64 | Average consecutive days at same rank |
| `last_fetch_date` | DATE | Last data fetch date |
| `create_time` | TIMESTAMP | Record creation time |

---

### mini_game_rank_change

**Notable rank movers** — games with significant rank changes on a given day. Much smaller than `mini_game_rank` (only 5-10 rows per day).

**Full table**: `intelligence.mini_game_rank_change`

| Field | Type | Description |
|-------|------|-------------|
| `fetch_date` | DATE | Data date |
| `source` | STRING | Platform |
| `leadboard_type` | STRING | Leaderboard type |
| `app_id` | STRING | App ID |
| `app_name` | STRING | Game name |
| `app_cover` | STRING | Cover image |
| `publisher` | STRING | Publisher |
| `app_desc` | STRING | Description |
| `game_rank` | INT64 | Current rank |
| `rank_change` | STRING | Rank change magnitude |
| `consecutive_rank_days` | INT64 | Consecutive days at rank |
| `tag` | STRING | Change tag (currently NULL) |
| `tag_desc` | STRING | Change tag description (currently NULL) |

---

### mini_game_rank_top

**Daily top 3 per source/leaderboard** — quick-reference table with only the top positions.

**Full table**: `intelligence.mini_game_rank_top`

| Field | Type | Description |
|-------|------|-------------|
| `fetch_date` | DATE | Data date |
| `source` | STRING | Platform |
| `leadboard_type` | STRING | Leaderboard type |
| `app_id` | STRING | App ID |
| `app_name` | STRING | Game name |
| `app_cover` | STRING | Cover image |
| `publisher` | STRING | Publisher |
| `app_desc` | STRING | Description |
| `game_rank` | INT64 | Rank (1-3) |
| `rank_change` | STRING | Rank change |
| `consecutive_rank_days` | INT64 | Consecutive days at rank |
| `tag` | STRING | Currently NULL |
| `tag_desc` | STRING | Currently NULL |

---

### mini_game_rank_change_tag_daily

**Daily tag change tracking** — records games that appeared or changed in tagging systems.

**Full table**: `intelligence.mini_game_rank_change_tag_daily`

| Field | Type | Description |
|-------|------|-------------|
| `fetch_date` | DATE | Data date |
| `source` | STRING | Platform |
| `leadboard_type` | STRING | Leaderboard type |
| `app_id` | STRING | App ID |
| `app_name` | STRING | Game name |
| `publisher` | STRING | Publisher |
| `tag` | STRING | Currently NULL |
| `tag_desc` | STRING | Currently NULL |
| `insert_time` | TIMESTAMP | Insert time |

---

## Key Dimensions

### source values
- `wechat` — 微信小游戏
- `douyin` — 抖音小游戏
- `facebook` — Facebook Instant Games

### leadboard_type values

| Source | Available leaderboard types |
|--------|-----------------------------|
| wechat | `bestseller`, `most_played`, `popularity` |
| douyin | `bestseller`, `fresh_game`, `popularity` |
| facebook | `most_played`, `new_releases`, `top_grossing` |

### app_id format
- WeChat: `wx` prefix (e.g. `wx209b8a6bc1c08b85`)
- Douyin: `tt` prefix (e.g. `tt6f4919f4f1282b6f07`)
- Facebook: numeric string (e.g. `1172616463193662`)

### category examples
- WeChat/Douyin (Chinese): `休闲, 益智` / `休闲, 消除` / `角色, 卡牌` / `角色, ARPG` / `棋牌, 牌类` / `竞技, 对战`
- Douyin special: `1,` (default/uncategorized)
- Facebook (English): `Games, Puzzle` / `Games, Action` / `Games, Sports` / `Games, Hyper Casual`

---

## Common Query Patterns

### 1. Today's top 10 on a specific board

```sql
SELECT game_rank, app_name, rank_change, publisher, category
FROM intelligence.mini_game_rank
WHERE fetch_date = CURRENT_DATE()
  AND source = 'wechat'
  AND leadboard_type = 'bestseller'
ORDER BY game_rank
LIMIT 10
```

### 2. Track a specific game's rank history

```sql
SELECT fetch_date, game_rank, rank_change
FROM intelligence.mini_game_rank
WHERE source = 'wechat'
  AND leadboard_type = 'bestseller'
  AND app_name = '无尽冬日'
  AND fetch_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
ORDER BY fetch_date
```

### 3. Find a game by name (fuzzy)

```sql
SELECT DISTINCT app_name, app_id, source, category, publisher
FROM intelligence.mini_game_rank
WHERE LOWER(app_name) LIKE '%羊了个羊%'
  AND fetch_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
```

### 4. Weekly ranking summary

```sql
SELECT weekly_rank, app_name, avg_rank, best_rank, latest_rank, days_on_rank, rank_change
FROM intelligence.mini_game_rank_weekly
WHERE source = 'wechat'
  AND leadboard_type = 'bestseller'
  AND week_start_date = DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY))
ORDER BY weekly_rank
LIMIT 20
```

### 5. Newly entered games this week

```sql
SELECT app_name, game_rank, category, publisher, fetch_date
FROM intelligence.mini_game_rank
WHERE source = 'wechat'
  AND leadboard_type = 'bestseller'
  AND is_new_rank = TRUE
  AND fetch_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
ORDER BY fetch_date DESC, game_rank
```

### 6. Cross-platform comparison (same game on wechat vs douyin)

```sql
SELECT a.source, a.leadboard_type, a.game_rank, a.rank_change
FROM intelligence.mini_game_rank a
WHERE a.app_name = '向僵尸开炮'
  AND a.fetch_date = CURRENT_DATE()
  AND a.leadboard_type = 'bestseller'
ORDER BY a.source
```

### 7. Top movers of the day

```sql
SELECT source, leadboard_type, app_name, game_rank, rank_change, consecutive_rank_days
FROM intelligence.mini_game_rank_change
WHERE fetch_date = CURRENT_DATE()
ORDER BY CAST(rank_change AS INT64) DESC
```

---

## Pitfalls & Notes

1. **No revenue/download/DAU metrics**: Mini game tables only contain **rank data**, not absolute revenue, downloads, or user counts. They track chart positions across platforms.

2. **`rank_change` is STRING, not INT**: Always `CAST(rank_change AS INT64)` when doing numeric comparisons or sorting. Positive = moved up, negative = moved down.

3. **Date field name varies by table**:
   - Daily tables: `fetch_date`
   - Weekly table: `week_start_date` / `week_end_date`

4. **No partition column**: None of the mini_game tables have a BigQuery partition column (all `is_partitioning_column = NO`). Still always filter by `fetch_date` / `week_start_date` to avoid full table scans.

5. **Douyin category quirk**: Many Douyin games have `category = '1,'` which is effectively uncategorized. Don't rely on category for Douyin filtering.

6. **`tag` / `tag_desc` fields are mostly NULL**: In `rank_change`, `rank_top`, and `tag_daily` tables, the `tag` and `tag_desc` columns are currently unpopulated. Only `tags` in `mini_game_rank` (Facebook data) has meaningful values.

7. **Facebook `tags` format**: Pipe-separated (e.g. `Puzzle|Quick Play|Match`). Use `LIKE '%Puzzle%'` to filter.

8. **app_id is platform-specific**: WeChat uses `wx...`, Douyin uses `tt...`, Facebook uses numeric IDs. These are NOT unified_ids and cannot be cross-referenced with Sensortower/Gamalytic tables.

9. **~100 games per board per day**: Each source/leaderboard combination tracks approximately 100 games (Facebook: 102). Queries for rank > 100 will return empty.

10. **Weekly table `week_start_date` is Monday**: Use `DATE_TRUNC(target_date, WEEK(MONDAY))` to align with weekly data.
