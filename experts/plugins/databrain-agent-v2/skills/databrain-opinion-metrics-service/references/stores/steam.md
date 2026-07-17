# Steam — 商店评分

> ⚠️ **过滤键**：用 `edition_id`（**= `pc_id`**，即 `game_search.py` 输出的 `pc_id`）。手游店用 `unified_id`（不同列名）。详见 [auxiliary/id_mapping.md](../auxiliary/id_mapping.md)。
>
> ⚠️ **`create_time` 是 DATETIME 不是 TIMESTAMP**：用 `DATETIME('<today-N>')` 字面量（`today` 取注入的当前时间(UTC+8)，缺失回退 `now_beijing.py`）或字符串字面量；用 `TIMESTAMP_SUB` 报 `No matching signature for operator >= for argument types: DATETIME, TIMESTAMP`；**不要**用 `DATETIME_SUB(CURRENT_DATETIME(), ...)`（BQ 服务时钟是 UTC，与业务北京时间错位最多 8h）。

---

## 涉及表

| 表 | 用途 | 分区 | 聚簇 |
|---|---|---|---|
| `tencent-databrain-prod.opinion.store_score_steam` | **快照评分**（all_reviews / recent_reviews 累积） | `create_time` (DATETIME, **MONTH**) | `edition_id` |
| `tencent-databrain-prod.opinion.store_score_steam_daily` | **日粒度** all_reviews_score 时序 | **`date`** (DATETIME, **MONTH**) — 分区键是 `date`（非 `create_time`）；表内仍有 `create_time` 列，用于 `MAX_BY` 取同日最新 | `edition_id` |
| `tencent-databrain-prod.opinion.store_score_steam_by_language_hourly` | **按语种 × 小时**新增评论数（reviews / total_positive / total_negative / language） | **VIEW（无物理分区/聚簇）**，底层用 `create_time` 排序与 `language, edition_id` 过滤 | — |

> Steam 评论原文 + 玩家好评率（按时间窗口聚合，基于 `feeds.is_recommend`）→ [public_feeds.md](../public_feeds.md) §1（`channel_type='comments' AND channel_name='steam' AND is_recommend=1`）

---

## 0. 字段速查

### `store_score_steam`（快照表）

| 字段 | 类型 | 说明 |
|---|---|---|
| `edition_id` | STRING | **游戏 ID（必带，前缀 `e`）** |
| `create_time` | **DATETIME** | 数据快照时间（**分区字段，必带时间范围**） |
| `all_reviews_count` | INT | 累积评论数 |
| `all_reviews_score` | FLOAT | 累积好评率（0-1） |
| `recent_reviews_count` | INT | 近期（30 天）评论数；**仅游戏上线 30 天后才有** |
| `recent_reviews_score` | FLOAT | 近期好评率（0-1） |
| `entity_type` | STRING | `pc` |

### `store_score_steam_daily`（日粒度时序）

| 字段 | 说明 |
|---|---|
| `edition_id` | 游戏 ID |
| `date` | **DATETIME，分区字段（月分区），注意不是 `create_time`** |
| `create_time` | DATETIME（日粒度快照时间，用于 `MAX_BY` 取最新） |
| `all_reviews_score` | 当日好评率快照 |

### `store_score_steam_by_language_hourly`（按语种 × 小时**累计快照**）

> ⚠️ **是累计快照表，不是增量表**：每条 (edition_id, language, create_time) 行存的是**截至该小时**观测到的**累计**评论数。聚合时用 `MAX` 不是 `SUM`（详见 §3）。

| 字段 | 说明 |
|---|---|
| `edition_id` | 游戏 ID |
| `create_time` | DATETIME（小时粒度） |
| `language` | 语种代码（English / French / German / Korean / Japanese / Simplified Chinese / Traditional Chinese / Russian / Italian / Ukrainian / Spanish - Spain / Portuguese - Brazil / ...） |
| `reviews` | **累计**评论数 |
| `total_positive` | **累计**好评数 |
| `total_negative` | **累计**差评数 |

---

## 1. 场景 1：累积评分快照（最新值）

```sql
SELECT
  edition_id                                          AS game_id,
  MAX_BY(all_reviews_count,    create_time)           AS all_reviews_count,
  MAX_BY(all_reviews_score,    create_time)           AS all_reviews_score,         -- 0-1，前端展示前 *100
  MAX_BY(recent_reviews_count, create_time)           AS recent_reviews_count,
  MAX_BY(recent_reviews_score, create_time)           AS recent_reviews_score       -- 0-1，前端展示前 *100
FROM `tencent-databrain-prod.opinion.store_score_steam`
WHERE edition_id = '<pc_id>'
  AND create_time >= DATETIME('<today-30>')   -- today=注入的当前时间(UTC+8)，缺失回退 now_beijing.py；DATETIME！
GROUP BY edition_id
LIMIT 1;
```

**前端换算**（不是 SQL 输出）：
- `positive_count = CEIL(all_reviews_count * all_reviews_score)`
- `negative_count = all_reviews_count - positive_count`

⚠️ **`recent_reviews_count` 仅游戏上线 30 天后才有数据**，新游戏会得到 NULL / 0。

---

## 2. 场景 2：日粒度好评率时序

```sql
SELECT
  DATE(date)                                   AS date,
  MAX_BY(all_reviews_score, create_time)       AS all_reviews_score,   -- 0-1，前端展示前 *100
  COUNT(*)                                     AS snapshot_count
FROM `tencent-databrain-prod.opinion.store_score_steam_daily`
WHERE edition_id = '<pc_id>'
  AND date >= DATETIME('<start_date>')
  AND date <  DATETIME_ADD(DATETIME('<end_date>'), INTERVAL 1 DAY)
GROUP BY 1
ORDER BY 1;
```

---

## 3. 场景 3：分语种**累计**评论量（截至窗口尾的累计快照）

⚠️ **`store_score_steam_by_language_hourly` 是累计快照表**（不是新增增量表）：每条 `(edition_id, language, create_time)` 行存的是该小时观测到的**累计** reviews / total_positive / total_negative。

```sql
SELECT
  language,
  MAX(reviews)                                     AS total_reviews,       -- 累计评论数
  MAX(total_positive)                              AS positive_reviews,    -- 累计好评数
  MAX(total_negative)                              AS negative_reviews,    -- 累计差评数
  ROUND(
    SAFE_DIVIDE(MAX(total_positive), NULLIF(MAX(reviews), 0)),
    4
  )                                                AS positive_rate        -- 0-1，前端展示前 *100
FROM `tencent-databrain-prod.opinion.store_score_steam_by_language_hourly`
WHERE edition_id = '<pc_id>'
  AND create_time >= DATETIME('<start_date>')
  AND create_time <  DATETIME_ADD(DATETIME('<end_date>'), INTERVAL 1 DAY)
GROUP BY language
ORDER BY total_reviews DESC
LIMIT 50;
```

> ⚠️ **必须用 `MAX` 不是 `SUM`**：物理表是累计快照，每小时一行存的是截至那小时的累计值。`SUM(reviews)` 会把同一语种多个小时的累计值再加起来，结果会严重偏大（每小时累加），与 cube 行为完全不一致。

### 单日累计快照（如 Delta Force 2025-12-09）

```sql
SELECT
  language,
  MAX(reviews)                                     AS total_reviews,
  MAX(total_positive)                              AS positive_reviews,
  MAX(total_negative)                              AS negative_reviews
FROM `tencent-databrain-prod.opinion.store_score_steam_by_language_hourly`
WHERE edition_id = '<pc_id>'
  AND DATE(create_time) = DATE('<target_date>')
GROUP BY language
ORDER BY total_reviews DESC;
```

---

## 4. 场景 4：好评率变化率（DoD / WoW / MoM）

后端拿当前周期 + 对比周期分别跑两次，前端按 `(curr - prev) / prev * 100` 计算（这里 `*100` 是前端做的 ratio 百分比换算，与 `all_reviews_score` 本身的 0-1 范围无关）。

```sql
-- 当前周期（取窗口内最新一天的 score）
SELECT MAX_BY(all_reviews_score, create_time) AS curr_score        -- 0-1
FROM `tencent-databrain-prod.opinion.store_score_steam_daily`
WHERE edition_id = '<pc_id>'
  AND date >= DATETIME('<curr_start>')
  AND date <  DATETIME('<curr_end>');

-- 对比周期
SELECT MAX_BY(all_reviews_score, create_time) AS prev_score        -- 0-1
FROM `tencent-databrain-prod.opinion.store_score_steam_daily`
WHERE edition_id = '<pc_id>'
  AND date >= DATETIME('<prev_start>')
  AND date <  DATETIME('<prev_end>');
```

---

## 5. 注意事项 / 已知陷阱

1. **`create_time` 是 DATETIME 不是 TIMESTAMP**（顶部红字说过）：用 `DATETIME_SUB` / `DATETIME('<...>')`，不要 `TIMESTAMP_SUB`。
2. **`edition_id` 不是 `unified_edition_id`**：Steam（PC 店）用 `edition_id` 列；手游店（App Store / Google Play / TapTap）用 `unified_id` 列。**写错就 0 行无报错**。
3. **`recent_reviews_count` 仅上线 30 天后才有**：新游戏返回 NULL。
4. **Steam 双源对账偏差**：本表（`store_score_steam_daily` / `store_score_steam`，**官方好评率快照**）vs `public_feeds.is_recommend`（**已采集评论好评率**）通常差 5-10pp，差异主要来自采集覆盖率。两者同时给时要明示口径。
5. **`MAX_BY(field, create_time)` 取最新快照**：不要用 `MAX(field)` 也不要 `AVG(field)`——同一游戏在窗口内有多条快照，要的是**最新**那条。
6. **`all_reviews_score` / `recent_reviews_score` 是 0-1**（不是 0-100）：**SQL 直接返回 0-1，不做 `* 100`**，由前端展示时再 `* 100` 换算为百分比。**派生比率字段**（如 §3 `SAFE_DIVIDE(SUM(total_positive), SUM(reviews)) * 100 AS positive_pct`，是从计数派生出来的好评率）**保留 `* 100`**。
7. **三张 steam 表 `entity_type` 都固定 `pc`**：不需要再加 entity_type 过滤。

8. **分语种评论数走 `MAX` 不是 `SUM`**：`store_score_steam_by_language_hourly` 是累计快照表，每小时存截至那小时的累计 reviews / total_positive / total_negative；用 `MAX` 取窗口内最新累计值。`SUM` 会把同一语种多个小时的累计值再加起来导致严重偏大。详见 §3。
