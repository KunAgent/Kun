# Google Play — 商店评分（手游 Android）

> ⚠️ **过滤键**：用 `unified_id`（**= `mobile_id`**）。**不是 `unified_edition_id`！** 详见 [auxiliary/id_mapping.md](../auxiliary/id_mapping.md)。
>
> ⚠️ **`create_time` 是 DATETIME 不是 TIMESTAMP**：用 `DATETIME_SUB` 或字符串字面量。

---

## ⚠️ 2026-05 更新：默认场景 = 全局加权平均（一个数）

业务 DataBrain UI 显示的"Google Play 评分"是**全球加权平均一个数**（cube `googleplay_score.score`）：
```sql
score = ROUND(SAFE_DIVIDE(SUM(comments_number * store_score), SUM(comments_number)), 4)
```

把各地区累计评论数作为权重，对各地区评分加权平均，输出一个 1-5 范围的数字。**这才是业务期待的答案形态**——按地区列出 50 行评分是错的口径。

---

## ⚠️ "新增评论数"指标走 public_feeds（不是 store_score_*_daily）

业务定义的"Google Play 新增评论数"等价于：
```sql
SELECT COUNT(DISTINCT comment_uin)
FROM `tencent-databrain-prod.opinion.public_feeds`
WHERE unified_edition_id = '<game_id>'
  AND comment_time >= TIMESTAMP('<date>')
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<date>'), INTERVAL 1 DAY)
  AND channel_type = 'comments'
  AND LOWER(channel_name) = 'google play'   -- 带空格！
```

详见 §3。

---

## 涉及表

| 表 | 用途 | 分区 | 聚簇 |
|---|---|---|---|
| `tencent-databrain-prod.opinion.store_score_google_play` | 分区域快照（含 `count_by_rating`） | `create_time` (DATETIME, **MONTH**) | `unified_id` |
| `tencent-databrain-prod.opinion.store_score_google_play_daily` | 日粒度评分（含 area） | **`date`** (DATETIME, **MONTH**) — 注意是 `date` 不是 `create_time` | `area, date, unified_id` |
| `tencent-databrain-prod.opinion.public_feeds` | Google Play 评论原文 / 已采集评分 / "新增评论数" | `unified_edition_id` + `comment_time` | VIEW |

---

## 0. 字段速查

| 字段 | 类型 | 说明 |
|---|---|---|
| `unified_id` | STRING | **游戏 ID（必带，前缀 `u`）** |
| `create_time` | **DATETIME** | 快照时间；快照表 `store_score_google_play` 用它分区 |
| `date` | **DATETIME** | daily 表 `store_score_google_play_daily` 的真实分区字段（不是 `create_time`） |
| `comments_number` | INT | 累积评论数（**不分国家**） |
| `store_score` | FLOAT | 1-5 评分（**分国家**） |
| `area` | STRING | 地区代码 |
| `count_by_rating` | RECORD/STRUCT | 1-5 星评级分布（**分国家，比例准、绝对数不准**） |

---

## 1. 场景 1（默认）：全球加权平均评分（**一个数**，与 cube `googleplay_score.score` 一致）

适合问题：「`<游戏>` `<日期>` 的 Google Play 评分是多少？」

```sql
SELECT
  unified_id AS game_id,
  ROUND(SAFE_DIVIDE(SUM(comments_number * store_score), SUM(comments_number)), 4) AS score
FROM `tencent-databrain-prod.opinion.store_score_google_play_daily`
WHERE unified_id = '<mobile_id>'
  AND date = DATETIME('<target_date>')
GROUP BY unified_id;
```

---

## 2. 场景 2：当日评分快照按地区分布

适合问题：「`<游戏>` `<日期>` 在主要地区的 Google Play 评分分布如何？」

```sql
SELECT
  unified_id AS game_id,
  area,
  MAX_BY(store_score,     date) AS store_score,
  MAX_BY(comments_number, date) AS comments_number
FROM `tencent-databrain-prod.opinion.store_score_google_play_daily`
WHERE unified_id = '<mobile_id>'
  AND date = DATETIME('<target_date>')
GROUP BY unified_id, area
ORDER BY comments_number DESC
LIMIT 50;
```

---

## 3. 场景 3：新增评论数（采集口径，走 public_feeds）

适合问题：「`<游戏>` `<日期>` 的 Google Play 新增评论数是多少？」

```sql
SELECT
  COUNT(DISTINCT comment_uin) AS new_reviews
FROM `tencent-databrain-prod.opinion.public_feeds`
WHERE unified_edition_id = '<game_id>'
  AND comment_time >= TIMESTAMP('<start_date>')
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
  AND channel_type = 'comments'
  AND LOWER(channel_name) = 'google play';   -- 带空格！
```

按地区分布：加 `GROUP BY country`。

---

## 4. 场景 4：日粒度评分时序

```sql
SELECT
  DATE(date) AS date,
  area,
  MAX_BY(store_score,     date) AS store_score,
  MAX_BY(comments_number, date) AS comments_number
FROM `tencent-databrain-prod.opinion.store_score_google_play_daily`
WHERE unified_id = '<mobile_id>'
  AND date >= DATETIME('<start_date>')
  AND date <  DATETIME_ADD(DATETIME('<end_date>'), INTERVAL 1 DAY)
  AND LOWER(area) IN ('us', 'br', 'in')  -- 可选地区
GROUP BY 1, area
ORDER BY 1, area;
```

---

## 5. 场景 5：1-5 星评级分布（按地区）

```sql
SELECT
  unified_id AS game_id,
  area,
  MAX_BY(count_by_rating, create_time) AS rating_breakdown
FROM `tencent-databrain-prod.opinion.store_score_google_play`
WHERE unified_id = '<mobile_id>'
  AND create_time >= DATETIME('<today-30>')   -- today=注入的当前时间(UTC+8)，缺失才回退 now_beijing.py
GROUP BY unified_id, area;
```

---

## 6. 注意事项

1. **`create_time` 是 DATETIME 不是 TIMESTAMP**
2. **`unified_id` 不是 `unified_edition_id`**：写错 0 行无报错
3. **`store_score` 是 1-5 范围**（不是 0-1）
4. **`comments_number` 不分国家**；`store_score` / `count_by_rating` 分国家
5. **Google Play `count_by_rating` 比例准、绝对数不准**：算分级比例 OK，算绝对评分人数用 `comments_number`
6. **取最新快照用 `MAX_BY`**：daily 表（场景 2/4）排序键用 `date`（该表**无 `create_time` 列**）；仅快照表 `store_score_google_play`（场景 5）用 `create_time`。同一地区窗口内多条快照，要的是最新那条
7. **"新增评论数"必走 §3 public_feeds 路径**：业务平台 UI 显示的"新增评论数"是从 public_feeds 计 mentions 出来的，不是 `comments_number` 的累计差
8. **时区是 UTC+8（北京时间）**：`today` 取注入的当前时间(UTC+8)，缺失才回退 `python scripts/now_beijing.py`；所有时间窗用 `DATETIME('YYYY-MM-DD')` 或 `TIMESTAMP('YYYY-MM-DD')` 字面量，**不要加** `'Asia/Shanghai'`，更**不要**用 `CURRENT_DATETIME() / CURRENT_TIMESTAMP() / CURRENT_DATE()`（BQ 服务时钟是 UTC，错位最多 8h）。
