# Memes 热梗查数手册

> ⚠️ 涉及 `opinion.memes`（主档，无分区，按 `title` / `region_code` / `meme_type` 过滤）+ `opinion.meme_videos`（视频事实，按 `release_time` **MONTH 分区**）。**行业级查询，不绑定单一游戏 ID**。
>
> ⚠️ `opinion.meme_videos.release_time` 是 **TIMESTAMP**（与 `marketing_hub_video.video_release_time` 的 DATETIME 不同）。
>
> 经 BigQuery 表结构 `INFORMATION_SCHEMA` 只读核实（2026-04-10）。

## 这份文档适合谁

这份文档适合三类使用者：

- 不看代码、但需要查数、写报告、解释热梗走势的业务或分析同学
- 需要快速回忆 `memes` 相关查询逻辑的维护者
- 需要基于文档生成 SQL、解释结果、排查空结果的 AI Agent

这份文档服务于 **AI 查数**，不是接口文档，也不是页面手册。
本文只保留会影响“查哪张表、SQL 怎么写、结果怎么解释、哪里容易查错”的信息。
文档里会保留后端字段名，但对容易误解的字段，会在第一次出现时直接补业务语义和边界，避免只按字面猜。

本文示例 SQL 统一使用经过只读抽样验证的生产项目。

以下表结构 / 分区信息已于 **2026-04-10** 通过 BigQuery `INFORMATION_SCHEMA` 做过只读核实：

- `tencent-databrain-prod.opinion.meme_videos`
  - 分区字段：`release_time`（按 **MONTH** 分区）
  - 聚簇字段：`meme_title`, `url`
  - ⚠️ 绝大多数查数都应显式带 `release_time` 时间范围，否则容易扫过大范围分区
- `tencent-databrain-prod.opinion.memes`
  - 分区字段：无
  - 聚簇字段：`title`
  - ⚠️ 直接查主档时应尽量带 `title` / `region_code` / `meme_type` / `meme_elements` 等高选择性条件

---

## 快速判断：你现在想查什么？

- 想看当前时间范围里哪些 meme 最热 → 看“场景 1：想看热梗榜单，怎么查？”
- 想下钻某个 meme 的基础信息、聚合指标、Top4 视频 → 看“场景 2：想看单个 meme 详情，怎么查？”
- 想看某个 meme 在一段时间内的播放量 / 发帖量趋势 → 看“场景 3：想看趋势图，怎么查？”
- 想看某个 meme 在不同语言下的分布 → 看“场景 4：想看语言分布，怎么查？”
- 想看某个 meme 的具体视频明细，或者只看某个作者的视频 → 看“场景 5：想看视频明细，怎么查？”
- 想看某个 meme 涉及了哪些作者 / KOL → 看“场景 6：想看 KOL 聚合，怎么查？”
- 想解释为什么结果和直觉不一致 → 先看“查询前先判断”和最后的“常见误区 / 查不到结果时先看什么”

---

## 高频字段先翻译成人话

- `search_text（关键词搜索）`
  - 当前只搜 `memes.title` / `memes.title_zh`
  - **不搜** `tags`，也不搜视频标题
- `date_type（趋势聚合粒度）`
  - 只影响趋势聚合和当前页趋势补充
  - 默认 `daily`
- `related_videos（详情附带视频，不是相似推荐）`
  - 在当前时间窗口 + 当前筛选条件下，按 `views DESC` 取 Top4
- `why_hot` / `why_hot_zh（解释文案）`
  - 当前是 Go 服务层硬编码占位内容，不是 BigQuery 底表原始字段

---

## 你可以查什么数据

| 想回答什么问题 | 关键条件 | 表 | 备注 |
|---|---|---|---|
| 当前最热的 meme 是哪些 | `start_time/end_time` + 可选 `channels/meme_types/meme_elements/regions/total_views/total_likes` | `tencent-databrain-prod.opinion.memes` + `tencent-databrain-prod.opinion.meme_videos` | 列表不是单表查询，而是视频聚合后再 JOIN 主档 |
| 某个 meme 的完整详情 | `meme_title` + `start_time/end_time` + 可选 `channels` | `tencent-databrain-prod.opinion.memes` + `tencent-databrain-prod.opinion.meme_videos` | 详情主体复用列表的聚合逻辑，并额外补 `related_videos`（同条件下按 `views DESC` 取 Top4） |
| 某个 meme 的趋势图 | `meme_title` + `start_time/end_time` + 可选 `channels/languages/date_type（趋势聚合粒度）` | `tencent-databrain-prod.opinion.meme_videos` | 返回 `views + publications` 双轴趋势 |
| 某个 meme 的语言分布 | `meme_title` + `start_time/end_time` + 可选 `channels/languages` | `tencent-databrain-prod.opinion.meme_videos` | 并发返回按 `views` / 按 `videos` 的 Top5 |
| 某个 meme 的视频列表 | `meme_title` + `start_time/end_time` + 可选 `channels/languages/anchor_uid` | `tencent-databrain-prod.opinion.meme_videos` | `anchor_uid` 名字像 UID，但当前实现实际匹配 `author_url` |
| 某个 meme 的作者聚合 | `meme_title` + `start_time/end_time` + 可选 `channels/search_text（作者名 / author_url 模糊搜索）` | `tencent-databrain-prod.opinion.meme_videos` | 当前不是独立 KOL 主档，而是视频表按 `author_url` 临时聚合 |

---

## 查询前先判断

- 先分清你要的是 **meme 主档信息**，还是 **视频事实数据**
  - `memes` 表放标题、内容、类型、元素、区域、标签、素材字段、`hot_time`
  - `meme_videos` 表放 `views/likes/comments/shares/language/author/release_time` 等视频事实
- `meme_videos` 按 `release_time` 月分区；虽然请求结构没有把 `start_time/end_time` 标成 required，但查数时**应视为必传**，否则容易扫大量历史分区
- `memes/list` 不是只查一张表，而是 **先按视频表聚合，再跟主档表 JOIN**
- `search_text（关键词搜索）` 只搜 `memes.title` / `memes.title_zh`，**不搜** `tags`，也不搜视频标题
- `total_views` / `total_likes` 是 **聚合后的 meme 级范围筛选**，且支持多区间 **OR**
- `min_release_time` / `max_release_time` 不是当前时间窗口内的最早最晚视频，而是 **去掉时间条件后重新算的全量时间范围**
- 详情、趋势、语言分布、视频列表、KOL 聚合这 5 类查询，都依赖 `meme_title` **精确匹配**
- `date_type（趋势聚合粒度）` 默认 `daily`
  - `daily` → `DATETIME_TRUNC(release_time, DAY)`
  - `weekly` → `DATETIME_TRUNC(release_time, WEEK(MONDAY))`
  - `monthly` → `DATETIME_TRUNC(release_time, MONTH)`
- 这组查询当前**没有**“查空后回退到最近有数据日期”的兜底逻辑；查不到通常就是当前条件下没结果
- 本文示例 SQL 已统一使用 `tencent-databrain-prod`；如果你要严格对照当前服务运行配置，再回看代码里的 `BuildProject = "tencent-databrain"`

---

## 按场景怎么查

### 场景 1：想看热梗榜单，怎么查？

#### 适合什么场景：
- 想看某一段时间内，哪些 meme 最热
- 想按播放量、点赞量、首次出现时间、类型、元素、首发渠道等维度排序
- 想做“最近最热热梗”“某渠道 / 某区域最近最热视频梗”这类榜单

#### 你会拿它回答什么问题：
- 最近这几天最热的 meme 是哪些？
- 指定渠道 / 区域 / 热梗类型下，最值得解释的热梗有哪些？
- 某一类热梗是靠播放量高，还是靠点赞高？

#### 查哪张表：
- 主档：`tencent-databrain-prod.opinion.memes`
- 聚合来源：`tencent-databrain-prod.opinion.meme_videos`
- `meme_videos` 按 `release_time` 月分区
- `memes` 无分区

#### 查的时候抓住：
- 视频层时间字段用的是 `release_time`
- `release_time` 是 **`TIMESTAMP`**，按日过滤必须用**右开**窗口：`release_time >= TIMESTAMP('<start_time>') AND release_time < TIMESTAMP_ADD(TIMESTAMP('<end_time>'), INTERVAL 1 DAY)`（含 `<end_time>` 当天全天）。❌ 不要用 `<= TIMESTAMP('<end_time>')`（= `<end_time> 00:00:00`，会丢掉当天全部带时刻数据）
- `channels` 作用在 `meme_videos.channel`
- `meme_types` / `meme_elements` / `regions` / `search_text` 作用在 `memes` 主档
- `total_views` / `total_likes` 是聚合后筛选，不是视频明细筛选
- 默认 `stat_type=views`，默认 `sort_item=stat_type`，默认 `sort_model=desc`
- 排序字段白名单：
  - `views` → `total_views`
  - `likes` → `total_likes`
  - `first_seen` → `min_release_time`
  - `meme_type` / `meme_type_zh`
  - `meme_elements` / `meme_elements_zh`
  - `first_channel`
- `date_type` 只影响 `link_time` 和当前页趋势补充，不影响主列表聚合口径

```sql
WITH meme_stats AS (
  SELECT
    meme_title,
    SUM(views) AS total_views,
    SUM(likes) AS total_likes,
    SUM(comments) AS total_comments,
    SUM(shares) AS total_shares,
    COUNT(DISTINCT url) AS video_count
  FROM `tencent-databrain-prod`.opinion.meme_videos
  WHERE release_time >= TIMESTAMP('<start_time>')
    AND release_time <  TIMESTAMP_ADD(TIMESTAMP('<end_time>'), INTERVAL 1 DAY)
    -- 可选：渠道筛选
    -- AND LOWER(channel) IN ('tiktok', 'bilibili')   -- meme_videos.channel 真实值只有 tiktok / bilibili，没有 youtube
  GROUP BY meme_title
),
meme_time_range AS (
  SELECT
    meme_title,
    MIN(release_time) AS min_release_time,
    MAX(release_time) AS max_release_time
  FROM `tencent-databrain-prod`.opinion.meme_videos
  WHERE 1 = 1
    -- 这里会复用“去掉时间条件后的渠道筛选”
    -- AND LOWER(channel) IN ('tiktok', 'bilibili')   -- meme_videos.channel 真实值只有 tiktok / bilibili，没有 youtube
  GROUP BY meme_title
),
meme_details AS (
  SELECT
    title,
    title_zh,
    content,
    content_zh,
    channels,
    region_code,
    region_code_zh,
    meme_type,
    meme_type_zh,
    meme_elements,
    meme_elements_zh,
    tags,
    raw_url,
    raw_title,
    raw_cover,
    hot_time
  FROM `tencent-databrain-prod`.opinion.memes
  WHERE 1 = 1
    -- 可选：主档筛选
    -- AND LOWER(region_code) IN ('global')
    -- AND LOWER(meme_type) IN ('challenge')
    -- AND LOWER(meme_elements) IN ('music')
    -- AND (LOWER(title) LIKE '%trend%' OR LOWER(title_zh) LIKE '%趋势%')
),
main_data AS (
  SELECT
    m.title AS meme_id,
    m.title,
    m.title_zh,
    m.content,
    m.content_zh,
    ARRAY_TO_STRING(m.channels, ',') AS channels,
    m.channels[SAFE_OFFSET(0)] AS first_channel,
    m.region_code,
    m.region_code_zh,
    m.meme_type,
    m.meme_type_zh,
    m.meme_elements,
    m.meme_elements_zh,
    ARRAY_TO_STRING(
      ARRAY(
        SELECT TRIM(tag)
        FROM UNNEST(SPLIT(ARRAY_TO_STRING(m.tags, '\n'), '\n')) AS tag
        WHERE TRIM(tag) != '' AND TRIM(tag) != 'NaN'
      ),
      ','
    ) AS tags,
    FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', m.hot_time) AS hot_time,
    ms.total_views,
    ms.total_likes,
    ms.total_comments,
    ms.total_shares,
    ms.video_count,
    FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', mtr.min_release_time) AS min_release_time,
    FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', mtr.max_release_time) AS max_release_time,
    m.raw_url,
    m.raw_title,
    m.raw_cover
  FROM meme_details m
  LEFT JOIN meme_stats ms ON m.title = ms.meme_title
  LEFT JOIN meme_time_range mtr ON m.title = mtr.meme_title
)
SELECT *
FROM main_data
WHERE 1 = 1
  -- 可选：聚合后范围筛选（多区间 OR）
  -- AND ((total_views >= 1000000 AND total_views <= 10000000) OR (total_views >= 50000000))
  -- AND ((total_likes >= 100000))
ORDER BY total_views DESC
LIMIT 20 OFFSET 0;
```

#### 查数注意点：
- `search_text` **只查 `title/title_zh`**，不会命中 `tags`
- `total_views` / `total_likes` 是在 `GROUP BY meme_title` 之后再筛，所以和直接扫视频明细不是一回事
- `min_release_time` / `max_release_time` 会去掉时间过滤后重算，因此常常早于 / 晚于你的查询窗口
- `tags` 在底层做过一次清洗：不是直接 `UNNEST(m.tags)`，而是先 `ARRAY_TO_STRING -> SPLIT('\n') -> UNNEST`
- `memes` 表无分区字段；这类榜单查询应优先先用 `meme_videos.release_time` 缩小视频聚合范围，再 JOIN 主档，不要把主档当主过滤入口去扫
- `meme_id` 实际就是 `memes.title`，不是独立数值 ID
- `should_include_timeline=true` 时，后端只会给**当前页**的 meme 补 `video_stats_timelines` 与 `link_time`
- `RangeFilter.End <= 0` 时表示不设上界，不要误当成真值 0

#### 简短后端逻辑小结：
- 入口是 `memes.List`
- 先分别构建 `meme_videos` 过滤、去时间版 `meme_videos` 过滤、`memes` 过滤、聚合后过滤
- `GetMemesTotalCount` 先查总数，`GetMemesMainData` 再查当前页主数据
- `should_include_timeline=true` 时，只拿当前页的 `meme_title` 去补当前窗口和上一窗口的趋势
- `link_time` / `old_total` / `old_timeline` 来自 `utils.GetLinkTime(...)` 算出的上一段对比时间

### 场景 2：想看单个 meme 详情，怎么查？

#### 适合什么场景：
- 已经知道具体 meme 名称，想看它的详情卡片
- 想看该 meme 的总播放、总点赞、视频数、相关视频示例

#### 你会拿它回答什么问题：
- 这个 meme 是什么梗？
- 这个梗当前窗口里累计有多少视频、多少播放？
- 当前窗口里最能代表它的几个视频是哪几个？

#### 查哪张表：
- 主档：`tencent-databrain-prod.opinion.memes`
- 事实：`tencent-databrain-prod.opinion.meme_videos`
- `meme_videos` 按 `release_time` 月分区
- `memes` 无分区

#### 查的时候抓住：
- `meme_title` 是精确匹配，不是模糊搜索
- 详情主体复用了列表那套“主档 + 聚合”逻辑，只是固定取 1 条
- `related_videos（详情附带视频，不是相似推荐）` 是同条件下按 `views DESC` 取 Top4
- 详情只支持 `channels`，不支持 `languages`

```sql
-- 详情主体：主档 + 聚合统计
WITH meme_stats AS (
  SELECT
    meme_title,
    SUM(views) AS total_views,
    SUM(likes) AS total_likes,
    SUM(comments) AS total_comments,
    SUM(shares) AS total_shares,
    COUNT(DISTINCT url) AS video_count
  FROM `tencent-databrain-prod`.opinion.meme_videos
  WHERE meme_title = '<meme_title>'
    AND release_time >= TIMESTAMP('<start_time>')
    AND release_time <  TIMESTAMP_ADD(TIMESTAMP('<end_time>'), INTERVAL 1 DAY)
    -- 可选：AND LOWER(channel) IN ('tiktok')
  GROUP BY meme_title
),
meme_time_range AS (
  SELECT
    meme_title,
    MIN(release_time) AS min_release_time,
    MAX(release_time) AS max_release_time
  FROM `tencent-databrain-prod`.opinion.meme_videos
  WHERE meme_title = '<meme_title>'
    -- 可选：AND LOWER(channel) IN ('tiktok')
  GROUP BY meme_title
)
SELECT
  m.title,
  m.title_zh,
  m.content,
  m.content_zh,
  FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', m.hot_time) AS hot_time,
  ms.total_views,
  ms.total_likes,
  ms.total_comments,
  ms.total_shares,
  ms.video_count,
  FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', mtr.min_release_time) AS min_release_time,
  FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', mtr.max_release_time) AS max_release_time,
  m.raw_url,
  m.raw_title,
  m.raw_cover
FROM `tencent-databrain-prod`.opinion.memes m
LEFT JOIN meme_stats ms ON m.title = ms.meme_title
LEFT JOIN meme_time_range mtr ON m.title = mtr.meme_title
WHERE m.title = '<meme_title>'
LIMIT 1;

-- Related Videos Top4
SELECT
  url,
  title,
  cover,
  views,
  author_name
FROM `tencent-databrain-prod`.opinion.meme_videos
WHERE meme_title = '<meme_title>'
  AND release_time >= TIMESTAMP('<start_time>')
  AND release_time <  TIMESTAMP_ADD(TIMESTAMP('<end_time>'), INTERVAL 1 DAY)
  -- 可选：AND LOWER(channel) IN ('tiktok')
ORDER BY views DESC
LIMIT 4;
```

#### 查数注意点：
- `meme_title` 必须对得上 `memes.title`
- `why_hot` / `why_hot_zh（解释文案）` 当前是 Go 层硬编码占位内容，**不是底表真实字段**
- `related_videos` 的 Top4 是在当前时间窗口内取的；但 `min_release_time/max_release_time` 是去掉时间条件后重算的
- 主数据为空时，服务层会直接按“meme 不存在 / 无结果”处理

#### 简短后端逻辑小结：
- 入口是 `memes.Detail`
- 主信息直接复用 `GetMemesMainData(..., 1, 1)`
- 同时并发查 `GetMemeRelatedVideos(..., 4)`
- `memes` 表筛选不是复用 `search_text`，而是直接 `title = ?`
- `why_hot/why_hot_zh` 暂时是硬编码占位，后面等底表补字段再替换

### 场景 3：想看趋势图，怎么查？

#### 适合什么场景：
- 想看某个 meme 在一段时间内的热度走势
- 想同时看播放量变化和发帖量变化
- 想做日报 / 周报里的趋势图说明

#### 你会拿它回答什么问题：
- 这个 meme 是哪几天突然爆发的？
- 播放量涨的时候，发布量有没有同步放大？
- 某个语言子集下，趋势有没有明显不同？

#### 查哪张表：
- `tencent-databrain-prod.opinion.meme_videos`
- 分区字段：`release_time`（按 MONTH 分区）

#### 查的时候抓住：
- 过滤条件来自：`meme_title + 时间窗口 + channels + languages`
- 聚合时间粒度取决于 `date_type`
  - `daily` → `DATETIME_TRUNC(release_time, DAY)`
  - `weekly` → `DATETIME_TRUNC(release_time, WEEK(MONDAY))`
  - `monthly` → `DATETIME_TRUNC(release_time, MONTH)`
- 输出两个值：
  - `views` = 该粒度下的 `SUM(views)`
  - `publications` = 该粒度下的 `COUNT(DISTINCT url)`

```sql
SELECT
  DATETIME_TRUNC(release_time, DAY) AS time,
  SUM(views) AS views,
  COUNT(DISTINCT url) AS publications
FROM `tencent-databrain-prod`.opinion.meme_videos
WHERE meme_title = '<meme_title>'
  AND release_time >= TIMESTAMP('<start_time>')
  AND release_time <  TIMESTAMP_ADD(TIMESTAMP('<end_time>'), INTERVAL 1 DAY)
  -- 可选：AND LOWER(channel) IN ('tiktok')
  -- 可选：AND LOWER(language) IN ('en', 'es')
GROUP BY time
ORDER BY time;
```

#### 查数注意点：
- 趋势不是查主档，而是纯视频表聚合
- `languages` 会直接参与过滤，所以你传了语言后，看到的是“指定语言子集”的趋势，不是全量趋势
- 后端会先调用 `GetTimeOfLineStartTime(...)` 对齐时间线；返回里的 `timeline_of_start_time` 可能早于你原始请求里的 `start_time`
- `publications` 是 `COUNT(DISTINCT url)`，不是账号数，也不是未去重的视频行数
- 如果查询范围太短，时间线起点可能被后端向前对齐，以保证图表展示窗口更稳定

#### 简短后端逻辑小结：
- 入口是 `memes.Trend`
- 默认 `date_type=daily`
- 先用 `GetTimeOfLineStartTime(...)` 对齐起始时间，再用 `GetDateSqlStr(...)` 生成时间粒度 SQL
- 最后由 `GetMemeDetailTrend` 从 `meme_videos` 聚合出 `views + publications`

### 场景 4：想看语言分布，怎么查？

#### 适合什么场景：
- 想知道一个 meme 主要在哪些语言里传播
- 想区分“哪个语言播放量高”和“哪个语言视频数多”

#### 你会拿它回答什么问题：
- 这个 meme 是英语区更火，还是多语言扩散更明显？
- 某个语言虽然视频不多，但单视频播放是否特别高？

#### 查哪张表：
- `tencent-databrain-prod.opinion.meme_videos`
- 分区字段：`release_time`（按 MONTH 分区）

#### 查的时候抓住：
- 过滤条件同样来自：`meme_title + 时间窗口 + channels + languages`
- 后端会并发跑两套 Top5：
  - 按 `SUM(views)` 排序
  - 按 `COUNT(DISTINCT url)` 排序
- `percentage` 不是 SQL 算出来的，而是在 Go 层对返回结果再计算

```sql
-- 按 views 排的 Top5 语言
WITH lang_stats AS (
  SELECT
    language,
    SUM(views) AS total_views,
    COUNT(DISTINCT url) AS video_count
  FROM `tencent-databrain-prod`.opinion.meme_videos
  WHERE meme_title = '<meme_title>'
    AND release_time >= TIMESTAMP('<start_time>')
    AND release_time <  TIMESTAMP_ADD(TIMESTAMP('<end_time>'), INTERVAL 1 DAY)
    -- 可选：AND LOWER(channel) IN ('tiktok')
    -- 可选：AND LOWER(language) IN ('en', 'es')
  GROUP BY language
)
SELECT language, total_views, video_count
FROM lang_stats
WHERE language IS NOT NULL AND language != ''
ORDER BY total_views DESC
LIMIT 5;

-- 按 videos 排的 Top5 语言
WITH lang_stats AS (
  SELECT
    language,
    SUM(views) AS total_views,
    COUNT(DISTINCT url) AS video_count
  FROM `tencent-databrain-prod`.opinion.meme_videos
  WHERE meme_title = '<meme_title>'
    AND release_time >= TIMESTAMP('<start_time>')
    AND release_time <  TIMESTAMP_ADD(TIMESTAMP('<end_time>'), INTERVAL 1 DAY)
    -- 可选：AND LOWER(channel) IN ('tiktok')
    -- 可选：AND LOWER(language) IN ('en', 'es')
  GROUP BY language
)
SELECT language, total_views, video_count
FROM lang_stats
WHERE language IS NOT NULL AND language != ''
ORDER BY video_count DESC
LIMIT 5;
```

#### 查数注意点：
- 返回的 `percentage` 分母不是全量语言总和，而是 **当前 Top5 结果本身的合计**
- 也就是说，看到的百分比加起来会是 100%，但那是 Top5 内部的 100%
- 如果你传了 `languages` 过滤，返回的是“过滤后的语言集合里再做 Top5”，不是全量语言盘子
- 空字符串 / NULL 语言会被过滤掉，不进入返回结果

#### 简短后端逻辑小结：
- 入口是 `memes.LanguageDistribution`
- 复用 detail 场景那套 `meme_videos` filter
- 并发调用 `GetMemeLanguageDist(..., "views", 5)` 和 `GetMemeLanguageDist(..., "videos", 5)`
- `percentage` 在 Go 层基于返回的 Top5 结果再计算

### 场景 5：想看视频明细，怎么查？

#### 适合什么场景：
- 想拉出某个 meme 的所有视频明细
- 想只看某种语言、某个渠道、某个作者的相关视频
- 想检查“这个梗到底是哪条视频带起来的”

#### 你会拿它回答什么问题：
- 这个 meme 在当前窗口里有哪些具体视频？
- 哪些视频播放最高 / 点赞最高 / 发布时间最新？
- 某个作者在这个 meme 下发过哪些视频？

#### 查哪张表：
- `tencent-databrain-prod.opinion.meme_videos`
- 分区字段：`release_time`（按 MONTH 分区）

#### 查的时候抓住：
- 基础过滤：`meme_title + 时间窗口 + channels + languages`
- 额外过滤：`anchor_uid` 实际落到 `author_url = ?`
- 可排序字段白名单：`views / likes / comments / shares / release_time`
- 默认 `page=1`、`page_size=20`，最大 `100`

```sql
SELECT
  url,
  title,
  title_zh,
  cover,
  FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', release_time) AS release_time,
  language,
  channel,
  author_name,
  author_url,
  author_avatar,
  views,
  likes,
  comments,
  shares
FROM `tencent-databrain-prod`.opinion.meme_videos
WHERE meme_title = '<meme_title>'
  AND release_time >= TIMESTAMP('<start_time>')
  AND release_time <  TIMESTAMP_ADD(TIMESTAMP('<end_time>'), INTERVAL 1 DAY)
  -- 可选：AND LOWER(channel) IN ('tiktok')
  -- 可选：AND LOWER(language) IN ('en')
  -- 可选：AND author_url = '<author_url>'
ORDER BY views DESC
LIMIT 20 OFFSET 0;
```

#### 查数注意点：
- `anchor_uid` 名字看起来像 UID，但实现里实际比对的是 `author_url`
- 如果你是从作者聚合结果继续下钻，最好直接复用作者聚合返回的 `author_url`
- 当前响应只返回 `title` / `title_zh`，**不返回** `title_en`；如需英文标题，只能直接查底表 `title_en`
- 当前不支持 `search_text`
- 分页上限是 100，想一次全拉要自己翻页

#### 简短后端逻辑小结：
- 入口是 `memes.VideoList`
- 先用通用 filter 拼出 `meme_videos` 条件，再额外补 `author_url = ?`
- 并发跑 `GetMemeVideoTotal` 和 `GetMemeVideoList`
- 排序字段有白名单保护，非法值会回退到默认 `views`

### 场景 6：想看 KOL / 作者聚合，怎么查？

#### 适合什么场景：
- 想看某个 meme 主要是哪些作者在发
- 想快速枚举参与这个梗的账号，并按发文数排序

#### 你会拿它回答什么问题：
- 当前时间窗口里，哪些作者发这个 meme 最多？
- 我想从作者维度往下钻视频，应该先拿什么字段？

#### 查哪张表：
- 当前实现只查：`tencent-databrain-prod.opinion.meme_videos`
- 分区字段：`release_time`（按 MONTH 分区）

#### 查的时候抓住：
- 过滤条件来自：`meme_title + 时间窗口 + channels`
- 额外搜索：`search_text` 会模糊匹配 `author_name` 或 `author_url`
- 只统计 `author_url` 非空的记录
- 当前唯一有效排序字段：`video_count`

```sql
SELECT
  author_url,
  MAX(author_name) AS author_name,
  MAX(author_avatar) AS author_avatar,
  COUNT(DISTINCT url) AS video_count
FROM `tencent-databrain-prod`.opinion.meme_videos
WHERE meme_title = '<meme_title>'
  AND release_time >= TIMESTAMP('<start_time>')
  AND release_time <  TIMESTAMP_ADD(TIMESTAMP('<end_time>'), INTERVAL 1 DAY)
  -- 可选：AND LOWER(channel) IN ('tiktok')
  AND author_url IS NOT NULL
  AND author_url != ''
  -- 可选：AND (LOWER(author_name) LIKE '%<keyword>%' OR LOWER(author_url) LIKE '%<keyword>%')
GROUP BY author_url
ORDER BY video_count DESC
LIMIT 20 OFFSET 0;
```

#### 查数注意点：
- 这不是独立的 KOL 主档表结果，而是 **基于视频表临时聚合** 的作者结果
- `followers_count` 当前固定返回 `0`，不能拿来分析账号体量
- `author_name` / `author_avatar` 也是从视频表里 `MAX(...)` 取的，不是权威 KOL 档案
- 如果后续接入 `meme_kol` 表，这个口径会变
- 如果要往视频列表继续下钻，最稳定的字段是 `author_url`

#### 简短后端逻辑小结：
- 入口是 `memes.KolList`
- 复用 detail 场景下的视频过滤条件，再额外拼 KOL 搜索条件
- 并发跑 `GetMemeKolTotal` 和 `GetMemeKolList`
- 当前底层是 `GROUP BY author_url`
- 代码里已经留了 TODO：后续改成 JOIN 真正的 `meme_kol` 表

---

## Agent 不可直接查的数据（如有）

以下内容不适合被 AI 当成“可直接从 BigQuery 查出来的事实”：

- `why_hot` / `why_hot_zh`
  - 当前来源：Go 服务层硬编码占位文本
  - 不是 `memes` 或 `meme_videos` 表字段
- `followers_count`
  - 当前来源：Go 服务层直接写死为 `0`
  - 原因：真正的 `meme_kol` 表尚未接入
- `video_stats_timelines.old_total` / `old_timeline` / `link_time`
  - 这些可以由 AI 按当前窗口 + 上一窗口再算出来
  - 但不是底表单字段，属于服务层基于 `GetLinkTime(...)` 的派生结果

如果用户要的是这些值的最终展示口径，应优先解释其生成逻辑，而不是误说“某张表里本来就有这个字段”。

---

## 常见误区 / 查不到结果时先看什么

- 是否把 `search_text` 当成“全字段搜索”；它只搜 `memes.title` 和 `memes.title_zh`
- 是否把 `total_views` / `total_likes` 误当成视频级字段；它们其实是 `meme_videos` 聚合到 `meme_title` 后的结果
- 是否把 `min_release_time` / `max_release_time` 当成当前窗口边界；它们其实是去时间条件后重算的全量范围
- 是否忘了 `meme_videos` 的时间条件；`release_time` 是月分区字段，不带时间范围容易扫太多分区
- 是否把 `anchor_uid` 误当成真实 UID；当前实现实际匹配的是 `author_url`
- 是否把 `kol_list` 当成正式 KOL 主档；当前只是视频表聚合，所以 `followers_count=0`
- 是否把语言分布里的 `percentage` 当成全量盘子占比；它其实是 Top5 内部占比
- 是否误以为这组查询有“最近有数据日期兜底”；当前没有，查空通常只能回到筛选条件逐项排查