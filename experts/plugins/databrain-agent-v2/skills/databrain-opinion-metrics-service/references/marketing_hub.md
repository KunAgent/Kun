# Hotspot Hashtag 查数手册（marketing_hub.* 全部 8 张表）

> **本 schema 全部 8 张表均不存在 `unified_edition_id` / `unified_id` / `edition_id` 等任何 game_id 字段**——**只能做"行业级 / 不绑定单一游戏"的查询**（行业视频排行、hashtag 榜单、跨游戏 KOL 等）。
>
> **按具体游戏查视频/视频播放量/视频数/视频互动 → 不走本 reference**，请改走 [`public_feeds.md` §6 场景 5：热门视频/直播](public_feeds.md)（用 `opinion.public_feeds` 的 `unified_edition_id` 聚簇键 + `media_type IN ('video','live')` + `tweets_view`）。在本表用 `LIKE '%游戏名%'` 反查标题会大量误差：标题不含名字的视频漏召、子串误命中无关视频、多语言名（"Honor of Kings" / "王者荣耀" / "ROK"）穷举不全。
>
> ⚠️ 涉及 `marketing_hub.*` 8 张表（hashtag list / details / trend / country / video / KOL / 行业视频 Feed）。按 `country` / `time_range` / `hashtag` / `platform` / `video_release_time` 等过滤。
>
> ⚠️ `marketing_hub_video` / `marketing_hub_hashtag_video` 的 `video_release_time` 是 **DATETIME 不是 TIMESTAMP**：用 `DATETIME('<today-N>')` 字面量（`today` 取注入的当前时间(UTC+8)，缺失回退 `now_beijing.py`）或字符串字面量；用 `TIMESTAMP_SUB` 报 `No matching signature for operator >= for argument types: DATETIME, TIMESTAMP`。**不要**用 `DATETIME_SUB(CURRENT_DATETIME(), ...)`（BQ 服务时钟是 UTC，与业务北京时间错位最多 8h）。
>
> 经 BigQuery 全量验证。

## 这份文档适合谁

这份文档适合：

- 不看代码、但需要查 Hotspot Hashtag 数据、写报告、解释波动的业务或分析同学
- 需要快速回忆 `hashtag` 相关查询逻辑的维护者
- 需要基于文档生成 SQL、解释结果、排查空结果的 AI Agent

这份文档服务于 **AI 查数**，不是接口文档，也不是页面手册。
本文只保留会影响“查哪张表、SQL 怎么写、结果怎么解释、哪里容易查错”的信息。
文档里会保留后端字段名，但对容易误解的字段，会在第一次出现时直接补业务语义和边界，避免只按字面猜。

本文示例 SQL 默认使用生产项目 `tencent-databrain-prod`。当前代码里的 `BuildProject` 仍是 `tencent-databrain`，但为了让 AI 查数默认落到完整生产数据，本文统一以 `prod` 为准。

---

## 核心表速览

- `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_trending_tiktok`
  - 分区字段：`date`（按 **MONTH** 分区，`DATE_TRUNC(date, MONTH)`）
  - 聚簇字段：`date, time_range, hashtag`
  - 用途：`list` 常规榜单、`details`、`trend_timelines`、`country_distribution`
- `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_trending_exolyt`
  - 分区字段：`date`（按 **MONTH** 分区，`DATE_TRUNC(date, MONTH)`）
  - 聚簇字段：`date, hashtag`
  - 用途：`list` 的 `today` 榜单
- `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_trending_tiktok_gaming`
  - 分区字段：`date`（按 **MONTH** 分区，`DATE_TRUNC(date, MONTH)`）
  - 聚簇字段：`date, time_range, country, hashtag`
  - 用途：`source=tiktok_gaming` 的 gaming 榜单
- `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_video`
  - 分区字段：`video_release_time`（按 **MONTH** 分区，`DATETIME_TRUNC(video_release_time, MONTH)`）
  - 聚簇字段：`channel_name, hashtag, country, video_id`
  - ⚠️ 字段类型是 **`DATETIME`**，不是 `TIMESTAMP`
  - 用途：`video_list`、`kol_list` 的视频子查询、榜单里的 `top_video_list`
- `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_video_info`
  - 分区字段：无
  - 聚簇字段：`channel_name, video_id`
  - ⚠️ 建议只在 `marketing_hub_hashtag_video` 已按 `video_release_time / hashtag / country` 等条件缩小范围后再做 JOIN；不要单独大范围扫描
  - 用途：补视频封面等字段
- `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_kol`
  - 分区字段：`date`（按 **MONTH** 分区，`DATE_TRUNC(date, MONTH)`）
  - 聚簇字段：`channel_name, hashtag, anchor_uid`
  - 用途：`kol_list` 主聚合表
- `tencent-databrain-prod.marketing_hub.marketing_hub_kol_info`
  - 分区字段：无
  - 聚簇字段：`channel_name, anchor_uid`
  - ⚠️ 建议只在 `marketing_hub_hashtag_kol` 已按 `date / hashtag / country` 等条件缩小范围后再做 JOIN；不要单独大范围扫描
  - 用途：补 KOL 头像等信息

---

## 快速判断：你现在想查什么？

- 想看某个时间范围内最热的 Hashtag 榜单 → 看“场景 1”
- 想看某个 Hashtag 的当前快照详情 → 看“场景 2”
- 想看某个 Hashtag 的时间趋势 → 看“场景 3”
- 想看某个 Hashtag 在不同国家的分布 → 看“场景 4”
- 想下钻某个 Hashtag 的具体视频 → 看“场景 5”
- 想看某个 Hashtag 关联了哪些 KOL / 作者 → 看“场景 6”
- 想解释为什么榜单、详情、趋势、视频结果对不上 → 先看“查询前先判断”和最后的“常见误区”

---

## 高频字段先翻译成人话

- `categories（榜单 source 过滤）`
  - 名字看起来像分类，但当前实现实际过滤的是榜单表里的 `source`
- `countries=['all']（全局 / 不限国家）`
  - 榜单系查询通常命中 `country='all'` 的聚合行
  - 视频 / KOL 查询通常表示“不限制国家”
- `date_type（趋势聚合粒度）`
  - 当前实际必须传有效值，推荐 `daily` / `weekly` / `monthly`
- `video_list.search_text（视频标题 / URL 关键词搜索）`
  - 当前只搜 `video_title` / `video_url`
  - **不搜** `video_title_zh` / `video_title_en`
- `kol_list.search_text（作者搜索）`
  - 当前匹配 `anchor_url` / `anchor_name`

---

## 你可以查什么数据

| 想回答什么问题 | 关键条件 | 表 | 备注 |
|---|---|---|---|
| 当前最热的 Hashtag 是哪些 | `start_time/end_time` + `time_range` + `countries` + 可选 `categories（实际过滤 source）/search_text（hashtag 模糊匹配）/newly_listed_only/source/crawl_types` | `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_trending_tiktok` / `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_trending_exolyt` / `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_trending_tiktok_gaming` | `list` 有三条分表路径；返回里的 `rank/rank_diff` 为接口层按当前排序重算 |
| 某个 Hashtag 的详情快照 | `hashtag` + `time_range` + `countries` + 可选 `categories（实际过滤 source）` | `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_trending_tiktok` | 当前只支持 tiktok 榜单表 |
| 某个 Hashtag 的趋势时间线 | `hashtag` + `time_range` + `countries` + `date_type（趋势聚合粒度）` | `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_trending_tiktok` | 返回 `tweets_posts + tweets_views` 聚合趋势 |
| 某个 Hashtag 的国家分布 | `hashtag` + `time_range` + `countries` + 可选 `categories（实际过滤 source）` | `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_trending_tiktok` | 这是榜单快照分布，不是视频事实分布 |
| 某个 Hashtag 的视频明细 | `hashtag` + `start_time/end_time` + 可选 `countries/anchor_uids/search_text（只搜 video_title/video_url）` | `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_video` + `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_video_info` | `search_text` 只搜 `video_title` / `video_url` |
| 某个 Hashtag 的 KOL 聚合 | `hashtag` + `start_time/end_time` + `countries（视频国家）` + 可选 `kol_countries（KOL 国家）/search_text（作者名 / URL 模糊搜索）` | `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_kol` + `tencent-databrain-prod.marketing_hub.marketing_hub_kol_info` + `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_video` | `countries` 过滤视频发属地，`kol_countries` 过滤 KOL 国家 |

---

## 查询前先判断

- `hashtag/list` 不是单表查询，而是三路分表：
  - `source = tiktok_gaming` → `marketing_hub_hashtag_trending_tiktok_gaming`
  - 否则若 `time_range = today` → `marketing_hub_hashtag_trending_exolyt`
  - 其余情况 → `marketing_hub_hashtag_trending_tiktok`
- `categories（榜单 source 过滤）` 这个名字**看起来像行业分类**，但当前实现实际过滤的是榜单表里的 `source` 列；`source` 参数本身主要用于切 gaming 表
- 榜单 / 详情 / 趋势 / 国家分布都会把 `start_time/end_time` 截成 **日期** 去过滤 `date`；只有 `video_list` 真正按 `video_release_time` 的 `DATETIME` 精确过滤
- `countries=['all']（全局 / 不限国家）` 的语义要分场景看：
  - 榜单 / 详情 / 趋势 / 国家分布：命中榜单表里的聚合国家行 `country='all'`
  - 视频 / KOL：表示“不限制国家”
- `details` / `trend_timelines` / `country_distribution` 当前都只查 `marketing_hub_hashtag_trending_tiktok`；榜单如果来自 exolyt 或 gaming，下游不会自动切过去
- list 里的 `rank/rank_diff` 是后端按当前 `sort_item` **重新算**出来的接口层结果；不要把榜单表原始 `rank/rank_diff` 直接当成 list 返回值解释。details 里的 `rank/rank_diff` 则直接取 tiktok 榜单表里的存量字段
- `trend_timelines.date_type（趋势聚合粒度）` 当前实际必须传有效值；推荐只用 `daily` / `weekly` / `monthly`
- gaming 榜单没有 `tweets_posts/source/category/is_promoted/trend` 原始字段；返回里这些内容要么缺失，要么由后端补默认值 / 转换值
- `video_list.search_text（视频标题 / URL 关键词搜索）` 当前只搜 `video_title` / `video_url`，**不搜** `video_title_zh` / `video_title_en`
- `country_distribution` 不是“自动把全球榜单拆成各国家的视频事实分布”；它只是基于 tiktok 榜单快照表按 `country` 分组取 `MAX(tweets_posts/tweets_views)`

---

## 按场景怎么查

### 场景 1：想看热门 Hashtag 榜单，怎么查？

#### 适合什么场景：
- 看 today 榜、近 7 天榜、近 30 天榜
- 看常规榜单、gaming 榜单、或“新上榜”榜单

#### 查哪张表：
- 常规榜单：`tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_trending_tiktok`
- today 榜单：`tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_trending_exolyt`
- gaming 榜单：`tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_trending_tiktok_gaming`
- 如需解释 `top_video_list`：补查 `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_video`

#### 查的时候抓住：
- 时间字段 / 分区字段：`date`
- 默认分页：`page=1`, `page_size=10`
- 默认排序：`sort_item=tweets_views`, `sort_model=desc`
- `search_text` 对榜单是 `LOWER(hashtag) LIKE '%...%'`
- `list` 接口返回里的 `rank/rank_diff` **不是直接读取原表字段**：
  - tiktok / exolyt：后端会按当前 `sort_item` 对当前结果重新排名
  - `rank_diff` = 前一天同口径排名 - 当天排名
  - 如果只是查原始榜单数据，不要把原表 `rank/rank_diff` 直接当成接口返回值解释
- `newly_listed_only` 是额外历史回看逻辑：
  - tiktok：回看近 365 天历史 Top100
  - exolyt：动态按 `sort_item` 取每天每国家 Top200 后再判断
  - gaming：动态按 `tweets_views` 取每天每国家 Top100 后再判断
- gaming 额外筛选：`crawl_types` 对应 `order_by_list ARRAY<STRING>`，多个值是 **OR**
- gaming 分支 `sort_item` **只支持** `tweets_views`

```sql
-- 常规榜单：非 today 且非 gaming 时走 tiktok 榜单表
-- 这条 SQL 用于查原始榜单数据；不直接等价于 list 接口返回里的 rank/rank_diff
SELECT
  date,
  source,
  category,
  country,
  time_range,
  hashtag,
  tweets_posts,
  tweets_views,
  TO_JSON_STRING(trend) AS trend,
  is_promoted,
  create_time
FROM `tencent-databrain-prod`.marketing_hub.marketing_hub_hashtag_trending_tiktok
WHERE date = DATE('<target_date>')
  AND LOWER(time_range) = LOWER('<time_range>')
  AND LOWER(country) = LOWER('<country_code>')
  AND LOWER(source) = LOWER('<source_name>')
ORDER BY tweets_views DESC
LIMIT 10 OFFSET 0;
```

```sql
-- today 榜单：time_range=today 且非 gaming 时走 exolyt 表
-- 这里用窗口函数给出“当前排序下的 rank 参考值”；如需 rank_diff，仍要再和前一天结果对比
SELECT
  ROW_NUMBER() OVER (ORDER BY tweets_views DESC) AS rank_for_current_sort,
  date,
  channel_name,
  source,
  category,
  country,
  region,
  time_range,
  hashtag,
  tweets_posts,
  tweets_views,
  create_time
FROM `tencent-databrain-prod`.marketing_hub.marketing_hub_hashtag_trending_exolyt
WHERE date = DATE('<target_date>')
  AND LOWER(time_range) = LOWER('today')
  AND LOWER(country) = LOWER('<country_code>')
  AND LOWER(source) = LOWER('<source_name>')
ORDER BY tweets_views DESC
LIMIT 10 OFFSET 0;
```

```sql
-- 如果你要近似复现常规 tiktok 榜单 list 接口的 rank/rank_diff（默认按当前 sort_item 排名）
-- 将 <sort_field> 替换为实际排序字段，例如 tweets_views / tweets_posts
WITH current_day AS (
  SELECT
    hashtag,
    country,
    tweets_posts,
    tweets_views,
    ROW_NUMBER() OVER (ORDER BY <sort_field> DESC) AS rank
  FROM `tencent-databrain-prod`.marketing_hub.marketing_hub_hashtag_trending_tiktok
  WHERE date = DATE('<target_date>')
    AND LOWER(time_range) = LOWER('<time_range>')
    AND LOWER(country) = LOWER('<country_code>')
    AND LOWER(source) = LOWER('<source_name>')
),
previous_day AS (
  SELECT
    hashtag,
    country,
    tweets_posts AS previous_tweets_posts,
    tweets_views AS previous_tweets_views,
    ROW_NUMBER() OVER (ORDER BY <sort_field> DESC) AS previous_rank
  FROM `tencent-databrain-prod`.marketing_hub.marketing_hub_hashtag_trending_tiktok
  WHERE date = DATE_SUB(DATE('<target_date>'), INTERVAL 1 DAY)
    AND LOWER(time_range) = LOWER('<time_range>')
    AND LOWER(country) = LOWER('<country_code>')
    AND LOWER(source) = LOWER('<source_name>')
)
SELECT
  c.hashtag,
  c.country,
  c.tweets_posts,
  c.tweets_views,
  c.rank,
  IFNULL(p.previous_rank - c.rank, 0) AS rank_diff,
  IFNULL(p.previous_tweets_posts, 0) AS previous_tweets_posts,
  IFNULL(p.previous_tweets_views, 0) AS previous_tweets_views
FROM current_day AS c
LEFT JOIN previous_day AS p
  ON c.hashtag = p.hashtag AND c.country = p.country
ORDER BY c.rank
LIMIT 10 OFFSET 0;
```

```sql
-- gaming 榜单：source=tiktok_gaming 时走 gaming 表
SELECT
  date,
  country,
  region,
  time_range,
  hashtag,
  tweets_views,
  TO_JSON_STRING(tweets_views_trend) AS tweets_views_trend,
  order_by_list,
  create_time
FROM `tencent-databrain-prod`.marketing_hub.marketing_hub_hashtag_trending_tiktok_gaming
WHERE date = DATE('<target_date>')
  AND LOWER(time_range) = LOWER('<time_range>')
  AND LOWER(country) = LOWER('<country_code>')
  AND EXISTS (
    SELECT 1
    FROM UNNEST(order_by_list) AS ob
    WHERE ob = LOWER('<crawl_type>')
  )
ORDER BY tweets_views DESC
LIMIT 10 OFFSET 0;
```

#### 查数注意点：
- `categories` 实际过滤 `source`，不是过滤 `category`
- `source` 主要是选表，不是普通榜单字段过滤
- tiktok / exolyt 原表里即使存在或能算出排名字段，也不要直接把它解释成 list 接口最终返回；接口层会按当前排序口径重算 `rank/rank_diff`
- exolyt today 分支如果还带 `newly_listed_only=true`，需要再叠加按 `sort_item` 动态取每天每国家 Top200 的 CTE / `QUALIFY` 逻辑；不要只套最基础主查询
- 返回字段会因分支不同而变化：
  - tiktok：有 `trend/is_promoted/source/category`
  - exolyt：有 `channel_name/source/category`
  - gaming：没有 `source/category/tweets_posts/is_promoted/trend` 原始字段，且 `tweets_posts=0`、`is_promoted=0`
- `top_video_list` 当前只会在：
  - tiktok 分支且 `time_range=last_7_days`
  - gaming 分支
  exolyt 当前 today 分支不会补 `top_video_list`

#### 简短后端逻辑小结：
- 入口：`services/hotspot/hashtag/list.go#List`
- 公共过滤：`services/common/comm_hotspot_hashtag_filter.go#CommonHotspotHashtagFilter`
- 三条分表路径：`list_source_tiktok.go` / `list_source_exolyt.go` / `list_source_tiktok_gaming.go`
- `newly_listed_only` 的 CTE 在 `services/tables/bq_marketing_hub_hashtag_trending_*.go`

---

### 场景 2：想看单个 Hashtag 详情，怎么查？

#### 适合什么场景：
- 看某个 Hashtag 的当前快照
- 看 `rank/rank_diff/tweets_posts/tweets_views/trend`
- 看这个 Hashtag 最早什么时候开始有数据

#### 查哪张表：
- `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_trending_tiktok`

#### 查的时候抓住：
- 时间字段 / 分区字段：`date`
- `hashtag` 是精确匹配：`LOWER(hashtag) = LOWER(?)`
- 主详情按 `create_time DESC` 取最新一条
- `first_available_time` 是另一条查询：忽略时间条件后按 `date ASC` 取最早一条

```sql
SELECT
  date,
  source,
  category,
  country,
  region,
  time_range,
  rank,
  hashtag,
  rank_diff,
  is_promoted,
  tweets_posts,
  tweets_views,
  TO_JSON_STRING(trend) AS trend,
  create_time
FROM `tencent-databrain-prod`.marketing_hub.marketing_hub_hashtag_trending_tiktok
WHERE date >= DATE('<start_date>')
  AND date <= DATE('<end_date>')
  AND LOWER(time_range) = LOWER('<time_range>')
  AND LOWER(country) = LOWER('<country_code>')
  AND LOWER(source) = LOWER('<source_name>')
  AND LOWER(hashtag) = LOWER('<hashtag>')
ORDER BY create_time DESC
LIMIT 1;
```

#### 查数注意点：
- 当前详情只查 **tiktok 榜单表**；如果你是从 exolyt today 榜或 gaming 榜点进来，不会自动切表
- 这里的 `trend` 是榜单表里的存量字段，不是 `trend_timelines` 那条接口重新聚合出来的时间线
- details 里的 `rank/rank_diff` 和 list 里后端重算的排名不一定完全一致

#### 简短后端逻辑小结：
- 入口：`services/hotspot/hashtag/details.go#Details`
- 主查询：`GetHashtagDetailsBQ`
- 最早可用时间：`getFirstAvailableTime`

---

### 场景 3：想看 Hashtag 趋势时间线，怎么查？

#### 适合什么场景：
- 看某个 Hashtag 在一段时间内的 `tweets_posts/tweets_views` 变化
- 按 `daily/weekly/monthly` 聚合趋势

#### 查哪张表：
- `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_trending_tiktok`

#### 查的时候抓住：
- 时间字段 / 分区字段：`date`
- `date_type` 当前实际必须传有效值，推荐 `daily` / `weekly` / `monthly`
- 接口会先跑 `GetTimeOfLineStartTime`，在“只选一个刻度”时向前补窗口：
  - `daily` 约 14 天
  - `weekly` 约 28 天
  - `monthly` 约 12 个月

```sql
SELECT
  DATETIME_TRUNC(date, DAY) AS time,
  SUM(tweets_posts) AS tweets_posts,
  SUM(tweets_views) AS tweets_views,
  MAX(hashtag) AS hashtag
FROM `tencent-databrain-prod`.marketing_hub.marketing_hub_hashtag_trending_tiktok
WHERE date >= DATE('<start_date>')
  AND date <= DATE('<end_date>')
  AND LOWER(time_range) = LOWER('<time_range>')
  AND LOWER(country) = LOWER('<country_code>')
  AND LOWER(source) = LOWER('<source_name>')
  AND LOWER(hashtag) = LOWER('<hashtag>')
GROUP BY time
ORDER BY time;
```

#### 查数注意点：
- 当前实现只查 tiktok 榜单表，不支持 exolyt / gaming 详情下钻趋势
- 这里返回的是按时间桶聚合后的 `tweets_posts/tweets_views`，不是详情页存量 `trend`
- `hourly` 在这张天级表上通常没有稳定分析价值

#### 简短后端逻辑小结：
- 入口：`services/hotspot/hashtag/trend_timelines.go#TrendTimelines`
- 时间桶：`GetRealDateType` + `GetDateSqlStr`
- 时间线补窗：`GetTimeOfLineStartTime`
- 聚合查询：`GetHashtagTrendTimelineBQ`

---

### 场景 4：想看国家分布，怎么查？

#### 适合什么场景：
- 看某个 Hashtag 在不同国家上的榜单快照分布
- 对比几个国家的 `tweets_posts/tweets_views`

#### 查哪张表：
- `tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_trending_tiktok`

#### 查的时候抓住：
- 时间字段 / 分区字段：`date`
- `hashtag` 精确匹配
- 当前查询是 **按 `country` 分组后取 `MAX(tweets_posts/tweets_views)`**，不是视频事实汇总
- 默认排序是 `tweets_posts DESC`

```sql
SELECT
  MAX(hashtag) AS hashtag,
  country,
  MAX(tweets_posts) AS tweets_posts,
  MAX(tweets_views) AS tweets_views
FROM `tencent-databrain-prod`.marketing_hub.marketing_hub_hashtag_trending_tiktok
WHERE date >= DATE('<start_date>')
  AND date <= DATE('<end_date>')
  AND LOWER(time_range) = LOWER('<time_range>')
  AND LOWER(source) = LOWER('<source_name>')
  AND LOWER(hashtag) = LOWER('<hashtag>')
  AND LOWER(country) IN (LOWER('<country_code_1>'), LOWER('<country_code_2>'))
GROUP BY country
ORDER BY tweets_posts DESC;
```

#### 查数注意点：
- 这是 **榜单快照分布**，不是视频事实表维度下的国家分布
- 如果你只传 `countries=['all']`，通常只会看到一条 `all`，不会自动拆成真实各国家分布
- 想看真实多国家对比，最好明确传一组国家代码

#### 简短后端逻辑小结：
- 入口：`services/hotspot/hashtag/country_distribution.go#CountryDistribution`
- 查询逻辑：`GetHashtagCountryDistributionBQ`
- 默认排序：`tweets_posts DESC`

---

### 场景 5：想看视频明细，怎么查？

#### 适合什么场景：
- 看某个 Hashtag 对应的具体视频
- 按发布时间查最近视频，或按作者 UID 下钻
- 拿到标题、封面、作者、互动指标等明细字段

#### 查哪张表：
- 主表：`tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_video`
- 补充表：`tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_video_info`

#### 查的时候抓住：
- 时间字段 / 分区字段：`video_release_time`
- `video_release_time` 是 **`DATETIME`**，示例 SQL 要用 `DATETIME(...)`
- `hashtag` 精确匹配
- `countries=['all']` 时当前实现会跳过国家过滤
- `anchor_uids` 是 `IN (...)` 精确过滤
- 默认分页：`page=1`, `page_size=10`
- 默认排序：`sort_item=video_release_time`, `sort_model=DESC`
- `engagement` 是后端计算字段：
  - `max(tweets_retweet,0) + max(tweets_comment,0) + max(tweets_like,0) + max(tweets_unlike,0)`

```sql
SELECT
  (CASE WHEN hv.tweets_retweet >= 0 THEN hv.tweets_retweet ELSE 0 END)
    + (CASE WHEN hv.tweets_comment >= 0 THEN hv.tweets_comment ELSE 0 END)
    + (CASE WHEN hv.tweets_like >= 0 THEN hv.tweets_like ELSE 0 END)
    + (CASE WHEN hv.tweets_unlike >= 0 THEN hv.tweets_unlike ELSE 0 END) AS engagement,
  hv.channel_name,
  hv.hashtag,
  hv.video_id,
  hv.video_url,
  hv.video_title,
  hv.video_title_en,
  hv.video_title_zh,
  video_info.video_image,
  hv.video_duration,
  hv.video_release_time,
  hv.country,
  hv.region,
  hv.anchor_name,
  hv.anchor_uid,
  hv.anchor_url,
  hv.tweets_comment,
  hv.tweets_retweet,
  hv.tweets_like,
  hv.tweets_view,
  hv.tweets_unlike
FROM `tencent-databrain-prod`.marketing_hub.marketing_hub_hashtag_video AS hv
JOIN `tencent-databrain-prod`.marketing_hub.marketing_hub_hashtag_video_info AS video_info
  ON hv.video_id = video_info.video_id
WHERE hv.video_release_time >= DATETIME('<start_time>')
  AND hv.video_release_time <  DATETIME_ADD(DATETIME('<end_time>'), INTERVAL 1 DAY)
  AND LOWER(hv.hashtag) = LOWER('<hashtag>')
  AND hv.anchor_uid IN ('<anchor_uid>')
ORDER BY hv.video_release_time DESC
LIMIT 10 OFFSET 0;
```

#### 查数注意点：
- `video_list.search_text` 当前支持模糊匹配，但只搜 `video_title` / `video_url`，**不搜** `video_title_zh` / `video_title_en`
- `countries=['all']` 时依然会跳过国家过滤；`search_text` 只是在此基础上追加标题 / URL 模糊匹配
- `marketing_hub_hashtag_video_info` 无分区字段，建议只在 `marketing_hub_hashtag_video` 已按 `video_release_time / hashtag / country / anchor_uid` 等缩小范围后再 JOIN
- 视频明细查的是事实表，不是榜单快照表；不要和 list/details/trend 的数值口径混在一起

#### 简短后端逻辑小结：
- 入口：`services/hotspot/hashtag/video_list.go#VideoList`
- 过滤逻辑：`HashtagVideoFilter`
- 主查询：`GetHashtagVideoList`
- 计数：`GetHashtagVideoTotal`

---

### 场景 6：想看 KOL 聚合，怎么查？

#### 适合什么场景：
- 看某个 Hashtag 关联了哪些作者 / KOL
- 按粉丝量、点赞量排序看这个 Hashtag 下最值得关注的账号

#### 查哪张表：
- 主表：`tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_kol`
- 补充表：`tencent-databrain-prod.marketing_hub.marketing_hub_kol_info`
- 视频子查询：`tencent-databrain-prod.marketing_hub.marketing_hub_hashtag_video`

#### 查的时候抓住：
- `countries` 过滤的是 **视频发属地**
- `kol_countries` 过滤的是 **KOL 国家**
- `search_text` 匹配 `anchor_url` / `anchor_name`
- 主聚合按 `anchor_uid` 分组，`MAX_BY(..., date)` 取最新值
- 默认分页：`page=1`, `page_size=10`
- 默认排序：`sort_item=followers_number`, `sort_model=DESC`

```sql
WITH related_anchor AS (
  SELECT DISTINCT hv.anchor_uid
  FROM `tencent-databrain-prod`.marketing_hub.marketing_hub_hashtag_video AS hv
  WHERE hv.video_release_time >= DATETIME('<start_time>')
    AND hv.video_release_time <  DATETIME_ADD(DATETIME('<end_time>'), INTERVAL 1 DAY)
    AND LOWER(hv.hashtag) = LOWER('<hashtag>')
    AND LOWER(hv.country) = LOWER('<video_country_code>')
)
SELECT
  MAX(hk.date) AS date,
  MAX_BY(hk.channel_name, hk.date) AS channel_name,
  MAX_BY(hk.hashtag, hk.date) AS hashtag,
  hk.anchor_uid,
  MAX_BY(hk.anchor_url, hk.date) AS anchor_url,
  MAX_BY(hk.anchor_name, hk.date) AS anchor_name,
  MAX(ki.anchor_image) AS anchor_image,
  MAX_BY(hk.country, hk.date) AS country,
  MAX_BY(hk.region, hk.date) AS region,
  MAX_BY(hk.followers_number, hk.date) AS followers_number,
  MAX_BY(hk.likes_number, hk.date) AS likes_number
FROM `tencent-databrain-prod`.marketing_hub.marketing_hub_hashtag_kol AS hk
JOIN `tencent-databrain-prod`.marketing_hub.marketing_hub_kol_info AS ki
  ON hk.anchor_uid = ki.anchor_uid
JOIN related_anchor AS ra
  ON hk.anchor_uid = ra.anchor_uid
WHERE hk.date >= DATE('<start_date>')
  AND hk.date <= DATE('<end_date>')
  AND LOWER(hk.hashtag) = LOWER('<hashtag>')
  AND LOWER(hk.country) = LOWER('<kol_country_code>')
GROUP BY hk.anchor_uid
ORDER BY followers_number DESC
LIMIT 10 OFFSET 0;
```

#### 查数注意点：
- 这个列表不是单纯扫 `hashtag_kol`，而是**先从视频表筛相关 `anchor_uid`，再反查 KOL 表**
- `countries` 和 `kol_countries` 含义不同，不要混
- `kol_countries=['all']` 时会跳过 KOL 国家过滤
- `marketing_hub_kol_info` 无分区字段，建议只在 `marketing_hub_hashtag_kol` 已按 `date / hashtag / country` 缩小范围后再 JOIN

#### 简短后端逻辑小结：
- 入口：`services/hotspot/hashtag/kol_list.go#KolList`
- KOL 主过滤：`HashtagKolFilter`
- 视频子查询：`HashtagVideoFilter`
- 聚合查询：`GetHashtagKolList`

---

## 常见误区 / 查不到结果时先看什么

- 是否把 `categories` 当成真正的 `category` 过滤了；当前实现实际过滤的是榜单表 `source`
- 是否把 `source` 当成普通过滤字段用了；当前它主要只是决定是否切到 `tiktok_gaming`
- 是否把榜单里的 `countries=['all']`，和视频 / KOL 里的 `countries=['all']` 理解成同一种语义
- 是否拿 exolyt / gaming 榜单结果，直接套到 `details/trend_timelines/country_distribution`；这 3 个场景当前只有 tiktok 表实现
- 是否用 list 的 `rank_diff` 去强行对齐 details 的 `rank_diff`；前者是后端重算，后者是表里存量值
- 是否在 `trend_timelines` 里漏传了有效 `date_type`
- 是否把 `video_release_time` 当成 `TIMESTAMP` 来写；真实字段类型是 `DATETIME`
- 是否把 `video_list.search_text` 误理解成“搜全部标题字段”；它当前只搜 `video_title` / `video_url`
- 是否把 `country_distribution` 理解成“自动拆全球”；如果你只传 `countries=['all']`，通常只会看到一条 `all`
- 是否忘了给分区表加时间条件：榜单表要带 `date`，视频表要带 `video_release_time`

---

## 场景 7：行业视频 Feed（不绑定 hashtag）

> **不要用本表按具体游戏查视频**：本表**无 `unified_edition_id` / `unified_id` / `edition_id` 任一 game_id 字段**，按游戏 `LIKE '%游戏名%'` 反查标题的覆盖率不可控（漏召 + 误召 + 多语言名穷举不全）。
>
> "<某游戏> 在 X 平台的视频/视频播放量/视频数/视频互动" → 走 [`public_feeds.md` §6 场景 5：热门视频/直播](public_feeds.md)，用 `opinion.public_feeds` 的 `unified_edition_id` + `media_type IN ('video','live')` + `tweets_view`。
>
> 本表只在以下场景使用：(1) **行业级排行**（"近 30 天 us 地区 TikTok 最热视频 Top50"，不限定具体游戏）；(2) **跨游戏内容榜单**（不按 game_id 聚合）。

> 适用：看某国家/平台/时间段的**所有**行业视频排行（不限定特定 hashtag）。

### 查哪张表

`tencent-databrain-prod.marketing_hub.marketing_hub_video`
- 分区字段：**无**（与 `marketing_hub_hashtag_video` 不同——后者按 `video_release_time` MONTH 分区，本表实测 DDL 无 partition）
- 聚簇字段：`video_url`
- ⚠️ 字段 `video_release_time` 类型是 **`DATETIME`**（不是 TIMESTAMP）；由于无分区，按 `video_release_time` 过滤 **不会触发 partition pruning**，建议尽量收窄其它聚簇/筛选条件（`platform` / `anchor_uid` / `video_url` 等）控制扫描量
- 数据源：TikTok + YouTube 两端的行业视频 Feed

### SQL 模板

```sql
SELECT
  v.video_id,
  v.video_title,
  v.video_url,
  v.video_release_time,
  v.country,
  v.platform,                       -- tiktok / youtube
  v.video_views,
  v.video_likes,
  v.video_comments,
  v.video_shares,
  v.anchor_uid,
  v.anchor_name,
  v.anchor_url
FROM `tencent-databrain-prod.marketing_hub.marketing_hub_video` AS v
WHERE v.video_release_time >= DATETIME('<start_time>')
  AND v.video_release_time <  DATETIME_ADD(DATETIME('<end_time>'), INTERVAL 1 DAY)
  -- 可选：按平台
  AND v.platform = '<platform>'        -- tiktok / youtube
  -- 可选：按国家
  AND LOWER(v.country) = LOWER('<country_code>')
ORDER BY v.video_views DESC
LIMIT 50;
```

### 字段规范

| 字段 | 规范 | 备注 |
|---|---|---|
| `country` | **ISO 3166-1 alpha-2 小写**（`us` / `gb` / `jp` / `de` 等） | 与 `feeds.country` 同规范；过滤时一律 `LOWER(country) = LOWER('<code>')`；本表通常**不出现 `'global'`**（与 `feeds` 不同）—— 如果实测需要兜底再加 |
| `platform` | 已知枚举值：**`tiktok`** / **`youtube`** | TikTok + YouTube 两端的行业视频 Feed；其他取值（如 `bilibili`）暂未在本表确认（C2 阶段实测因 `marketing_hub` schema 权限不足 403，未能穷举）。写 SQL 前可先 `SELECT DISTINCT platform FROM marketing_hub_video LIMIT 100` 探一下 |
| `anchor_uid` | 作者唯一 ID | 与 `marketing_hub.marketing_hub_hashtag_video.anchor_uid` 是 **同一作者唯一 ID 字段**（命名一致，可跨两表 join） |
| `anchor_url` / `anchor_name` | 作者主页 / 用户名 | 与 hashtag_video 一致，可作为展示字段或 fallback 比对 |

### 注意事项

1. **DATETIME 不是 TIMESTAMP**：用 `DATETIME('<today-N>')` 字面量（`today` 取注入的当前时间(UTC+8)，缺失回退 `now_beijing.py`），**不要**用 `TIMESTAMP_SUB`，否则报 `No matching signature for operator >= for argument types: DATETIME, TIMESTAMP`；**不要**用 `DATETIME_SUB(CURRENT_DATETIME(), ...)`（BQ 服务时钟是 UTC，与业务北京时间错位最多 8h）。
2. **MONTH 分区**：跨月查询会扫多个月分区，时间窗尽量收紧。
3. **不绑定 hashtag**：要按 hashtag 筛选行业视频，应走 §5「Hashtag 视频明细」（用 `marketing_hub_hashtag_video`）。
4. **行业级查询，不需要 `unified_edition_id`**：本表无游戏 ID 字段，按 `country / platform / time` 过滤。

---

## 场景 8：KOL 资料补齐（marketing_hub_kol_info）

`tencent-databrain-prod.marketing_hub.marketing_hub_kol_info` 是 KOL 展示属性补表（头像、URL 等），无分区。**只在 `marketing_hub_hashtag_kol` 已按 `date / hashtag / country` 缩小范围后再 JOIN**，不要单独大范围扫描——详细 join 模板见 §6（Hashtag KOL 聚合）。

---

## 总览：marketing_hub.* 8 张表速查

| 表 | 角色 | 分区 | 聚簇 | 时间字段类型 |
|---|---|---|---|---|
| `marketing_hub_hashtag_trending_tiktok` | TikTok Hashtag 主榜（list/details/trend/country 都查它） | `date` (MONTH) | `date, time_range, hashtag` | DATE |
| `marketing_hub_hashtag_trending_exolyt` | `time_range='today'` 时的 list | `date` (MONTH) | `date, hashtag` | DATE |
| `marketing_hub_hashtag_trending_tiktok_gaming` | gaming 类目 list | `date` (MONTH) | `date, time_range, country, hashtag` | DATE |
| `marketing_hub_hashtag_video` | Hashtag 关联视频明细 | `video_release_time` (MONTH) | `channel_name, hashtag, country, video_id` | **DATETIME** |
| `marketing_hub_hashtag_video_info` | 视频补表（封面） | 无 | `channel_name, video_id` | — |
| `marketing_hub_hashtag_kol` | Hashtag × KOL 聚合 | `date` (MONTH) | `channel_name, hashtag, anchor_uid` | DATE |
| `marketing_hub_kol_info` | KOL 补表（头像） | 无 | `channel_name, anchor_uid` | — |
| `marketing_hub_video` | 行业视频 Feed（不绑定 hashtag） | **无**（实测 DDL 无 partition） | `video_url` | **DATETIME** |
