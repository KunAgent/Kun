# App Store — 商店评分（手游 iOS）

> ⚠️ **过滤键**：用 `unified_id`（**= `mobile_id`**，即 `game_search.py` 输出的 `mobile_id`）。**不是 `unified_edition_id`！** 详见 [auxiliary/id_mapping.md](../auxiliary/id_mapping.md)。
>
> ⚠️ **`create_time` 是 DATETIME 不是 TIMESTAMP**：用 `DATETIME('<today-N>')` 字面量（`today` 取注入的当前时间(UTC+8)，缺失回退 `now_beijing.py`）或字符串字面量；用 `TIMESTAMP_SUB` 报 `No matching signature`；**不要**用 `DATETIME_SUB(CURRENT_DATETIME(), ...)`（BQ 服务时钟是 UTC，错位最多 8h）。

---

## ⚠️ 2026-05 更新：默认场景 = 全局加权平均（一个数）

业务 DataBrain UI 显示的"App Store 评分"是**全球加权平均一个数**（cube `appstore_score.score`）：
```sql
score = ROUND(SAFE_DIVIDE(SUM(comments_number * store_score), SUM(comments_number)), 4)
```

也就是把各地区的累计评论数作为权重，对各地区评分加权平均，输出一个 1-5 范围的数字。

旧 react skill 默认按"地区分散列出 50 行"是错的——业务同学手填 GT 时填的就是这一个加权数字。

---

## ⚠️ "新增评论数"指标走 public_feeds（不是 store_score_*_daily）

业务定义的"`<游戏>` `<日期>` 的 App Store **新增评论数**"，是该日 App Store 平台新爬到的评论数（mentions 维度），等价于：
```sql
SELECT COUNT(DISTINCT comment_uin)
FROM `tencent-databrain-prod.opinion.public_feeds`
WHERE unified_edition_id = '<game_id>'
  AND comment_time >= TIMESTAMP('<date>')
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<date>'), INTERVAL 1 DAY)
  AND channel_type = 'comments'
  AND LOWER(channel_name) = 'app store'   -- 带空格！
```

**不要**用 `store_score_app_store_daily` 的 `comments_number` 累计差去算"新增"——`comments_number` 是 App Store 商店端官方公开的累计评论数，与采集到的评论数不是一回事。详见 §3。

---

## 涉及表

| 表 | 用途 | 分区 | 聚簇 |
|---|---|---|---|
| `tencent-databrain-prod.opinion.store_score_app_store` | 全生命周期评分快照（按地区） | `create_time` (DATETIME, **MONTH**) | `unified_id` |
| `tencent-databrain-prod.opinion.store_score_app_store_daily` | 日粒度评分（含 area） | **`date`** (DATETIME, **MONTH**) — 注意是 `date` 不是 `create_time` | `unified_id, area, date` |
| `tencent-databrain-prod.opinion.public_feeds` | App Store 评论原文 + 已采集评分 + "新增评论数" | `unified_edition_id` + `comment_time` | VIEW |

---

## 0. 字段速查

| 字段 | 类型 | 说明 |
|---|---|---|
| `unified_id` | STRING | **游戏 ID（必带，前缀 `u`）** |
| `create_time` | **DATETIME** | 快照时间；快照表 `store_score_app_store` 用它分区 |
| `date` | **DATETIME** | daily 表 `store_score_app_store_daily` 的真实分区字段（不是 `create_time`） |
| `comments_number` | INT | 累计评论数（**不分国家**） |
| `store_score` | FLOAT | 1-5 评分（**分国家**） |
| `area` | STRING | 地区代码（按地区有不同评分） |
| `count_by_rating` | RECORD/STRUCT | 1-5 星评级分布 |

---

## 1. 场景 1（默认）：全球加权平均评分（**一个数**，与 cube `appstore_score.score` 一致）

适合问题：「`<游戏>` `<日期>` 的 App Store 评分是多少？」

```sql
SELECT
  unified_id AS game_id,
  ROUND(SAFE_DIVIDE(SUM(comments_number * store_score), SUM(comments_number)), 4) AS score
FROM `tencent-databrain-prod.opinion.store_score_app_store_daily`
WHERE unified_id = '<mobile_id>'
  AND date = DATETIME('<target_date>')   -- ⚠️ DATETIME 字面量
GROUP BY unified_id;
```

### 时间窗变体

```sql
-- 最近 30 天某一天的快照（如果用户只问游戏目前评分）— today=注入的当前时间(UTC+8)，缺失回退 now_beijing.py
AND date >= DATETIME('<today-30>')
AND date <= DATETIME('<today>')

-- 某个时间段（取该段内最后一天作代表）
AND date = DATETIME('<target_date>')
```

---

## 2. 场景 2：当日评分快照按地区分布

适合问题：「`<游戏>` `<日期>` 在主要地区的 App Store 评分分布如何？」

```sql
SELECT
  unified_id AS game_id,
  area,
  MAX_BY(store_score,     date) AS store_score,        -- 1-5 范围
  MAX_BY(comments_number, date) AS comments_number
FROM `tencent-databrain-prod.opinion.store_score_app_store_daily`
WHERE unified_id = '<mobile_id>'
  AND date = DATETIME('<target_date>')
GROUP BY unified_id, area
ORDER BY comments_number DESC
LIMIT 50;
```

---

## 3. 场景 3：新增评论数（采集口径，走 public_feeds）

适合问题：「`<游戏>` `<日期>` 的 App Store 新增评论数是多少？」「`<游戏>` 近 7 天 App Store 新增了多少评论？」

```sql
SELECT
  COUNT(DISTINCT comment_uin) AS new_reviews
FROM `tencent-databrain-prod.opinion.public_feeds`
WHERE unified_edition_id = '<game_id>'                        -- 注意是 unified_edition_id（即 mobile_id）
  AND comment_time >= TIMESTAMP('<start_date>')               -- ⚠️ UTC
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
  AND channel_type = 'comments'
  AND LOWER(channel_name) = 'app store';                      -- 带空格！
```

### 按地区分布

```sql
SELECT
  country,
  COUNT(DISTINCT comment_uin) AS new_reviews
FROM `tencent-databrain-prod.opinion.public_feeds`
WHERE unified_edition_id = '<game_id>'
  AND comment_time >= TIMESTAMP('<start_date>')
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
  AND channel_type = 'comments'
  AND LOWER(channel_name) = 'app store'
GROUP BY country
ORDER BY new_reviews DESC
LIMIT 30;
```

---

## 4. 场景 4：日粒度评分时序

```sql
SELECT
  DATE(date) AS date,
  area,
  MAX_BY(store_score,     date) AS store_score,
  MAX_BY(comments_number, date) AS comments_number
FROM `tencent-databrain-prod.opinion.store_score_app_store_daily`
WHERE unified_id = '<mobile_id>'
  AND date >= DATETIME('<start_date>')
  AND date <  DATETIME_ADD(DATETIME('<end_date>'), INTERVAL 1 DAY)
  AND LOWER(area) IN ('us', 'jp', 'kr')   -- 可选地区
GROUP BY 1, area
ORDER BY 1, area;
```

---

## 5. 场景 5：评分变化率（DoD / WoW / MoM）

后端跑两次场景 1（当前周期 + 对比周期），前端按 `(curr - prev) / prev * 100` 算 ratio。

---

## 6. 注意事项

1. **`create_time` 是 DATETIME 不是 TIMESTAMP**：用 `DATETIME_SUB` 不是 `TIMESTAMP_SUB`
2. **`unified_id` 不是 `unified_edition_id`**：store_score_* 表的物理列名就叫 `unified_id`，**写错就 0 行无报错**
3. **`comments_number` 不分国家**：是全球累计评论数；`store_score` / `count_by_rating` 分国家
4. **`store_score` 是 1-5 范围**（不是 0-1 / 不是 0-100）
5. **取最新快照用 `MAX_BY`**：daily 表（场景 2/4）排序键用 `date`（该表**无 `create_time` 列**），不要 `AVG` 同一地区多条快照
6. **"新增评论数"必走 §3 public_feeds 路径**：业务平台 UI 显示的"新增评论数"是从 public_feeds 计 mentions 出来的，不是 `comments_number` 的累计差
7. **时区是 UTC+8（北京时间）**：`today` 取注入的当前时间(UTC+8)，缺失才回退 `python scripts/now_beijing.py`；所有时间窗用 `DATETIME('YYYY-MM-DD')` 或 `TIMESTAMP('YYYY-MM-DD')` 字面量，**不要加** `'Asia/Shanghai'`，更**不要**用 `CURRENT_DATETIME() / CURRENT_TIMESTAMP() / CURRENT_DATE()`（BQ 服务时钟是 UTC，错位最多 8h）。
