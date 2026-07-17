# Channel Share Ranking（渠道份额排行榜）查数手册

> ⚠️ **必读**：查 `opinion.public_feeds` 时务必**同时**带 `unified_edition_id`（聚簇键）和 `comment_time` 时间范围（分区键），否则会触发亿级全表扫 + 61001 timeout。详见 [SKILL.md](../SKILL.md) 顶部约束。

> 又称 Market Popularity Ranking（开发端历史名称）。涉及 `opinion.public_feeds` + 重点游戏池 `opinion.top_mobile_game` / `opinion.top_pconsole_game`。

## 这份文档适合谁

这是一份 **AI 查数 reference / 查数手册**，适合要解释 Compare 页面里 Channel Share Ranking 的主榜单、分渠道下载结果、时间趋势和 `market_share_by_view` 口径的同学使用；它不是接口文档，也不是前端页面说明。

本文覆盖 3 个真实能力：
- 主榜单：`/compare/channel_share_ranking`
- 下载：`/compare/channel_share_ranking/download`
- 时间趋势：`/compare/channel_share_ranking/timeline`

默认项目是 `tencent-databrain-prod`。本文已基于**代码口径核对**完成修正，并已通过 **BigQuery 全量 SQL 验证**（2026-04-15，5/5 条 SQL 全部 PASS）。

核心表：
- 主事实表：`tencent-databrain-prod.opinion.public_feeds`
- 重点游戏池：`tencent-databrain-prod.opinion.top_mobile_game`
- 重点游戏池：`tencent-databrain-prod.opinion.top_pconsole_game`

分区信息：
- `opinion.public_feeds.comment_time`：按 `DAY` 分区（业务约定，VIEW 物理上无 partition），字段类型 `TIMESTAMP`
- `top_mobile_game` / `top_pconsole_game`：**PARTITION BY** `DATE_TRUNC(date, YEAR)` · **CLUSTER BY** `game_id, date`；只适合作为游戏池维表使用，不建议单独大范围扫描

---

## 快速判断：你现在想查什么？

- 想看当前窗口里重点游戏的 `views / impressions / engagement / publications` 排名 → 看“场景 1”
- 想看分渠道的排行榜，尤其是下载接口为什么会多出 `youtube_keyword / youtube_live` → 看“场景 2”
- 想看选中游戏的时间趋势，以及 `market_share_by_view` 为什么和主榜单分母不一样 → 看“场景 3”
- 想解释为什么当前游戏不在 Top100 里也会出现在结果第一位 → 先看“查询前先判断”

---

## 高频字段先翻译成人话

- `impressions（潜在曝光口径，不是帖子条数）`
  - 当前真实 SQL 不是 `COUNT(comment_uin)`
  - 而是：
    - `SUM(CASE WHEN follower_number > 0 THEN follower_number ELSE 0 END)`
  - 它更接近“命中内容的粉丝量求和”，不是 comments / mentions 条数

- `selected_games（手选游戏列表）`
  - 有值时：**只查这些游戏**，不走重点游戏池，也不做“当前游戏补位”
  - 无值时：从 `top_mobile_game` / `top_pconsole_game` 取重点游戏池
  - 主榜单的 `market_share_by_view` 分母也会跟着这套集合走

- `timeline_games（要画曲线的游戏列表）`
  - 它只决定 **哪些游戏出现在 timeline 曲线里**
  - **不决定** `market_share_by_view` 的时间线分母
  - 时间线分母使用：
    - 有 `selected_games` 时 → `selected_games`
    - 没有 `selected_games` 时 → 重点游戏池

- `market_share_by_view（按 views 算的份额，后端派生值）`
  - 主榜单：每个游戏 `views / NewTotalView`；old 用 `views / OldTotalView`
  - timeline：每个时间点 `views / timelineTotalViewMap[time]`
  - 这不是 BigQuery 现成字段，都是服务层内存计算

- `date_type（时间粒度与旧窗口规则）`
  - 主榜单 old 窗口规则：
    - `old_end = new_start - 1 秒`
    - `old_start` 往前回推一个与当前窗口等长的区间
    - 月粒度按“跨越月数 + 1 个月”整体前移
  - timeline 起点规则：
    - `hourly`：不自动前补历史
    - `daily`：如果请求结束时间仍落在首个日桶内，起点前补 14 天
    - `weekly`：如果请求结束时间仍落在首个 7 天桶内，起点前补 28 天
    - `monthly`：如果请求结束时间仍落在首个月桶内，起点前补 12 个月
  - **注意**：weekly 的 `market_share_by_view` 时间线分母补算存在实现缺口，见下文

- `channels（渠道筛选）`
  - 下载接口在 **未传 `channels`** 时，会并发查 5 组默认渠道：`youtube / tiktok / instagram / facebook / twitter`
  - 只有这条默认分支里，YouTube 才会自动展开为 `youtube / youtube_keyword / youtube_live`
  - 如果请求里已经显式传了 `channels`，后端只会返回一组 `selected_channel`，不会自动扩展 YouTube 变体

---

## 你可以查什么数据

| 想回答什么问题 | 关键条件 | 查哪张表 | 关键条件 / 备注 |
|---|---|---|---|
| 当前窗口下重点游戏的排行 | 时间、`channels`、`languages`、`game_types`、`selected_games` | `tencent-databrain-prod.opinion.public_feeds` | 固定只查 `data_sources` 包含 `levelup` |
| 主榜单 old 窗口对比 | 当前窗口 + `date_type` | `tencent-databrain-prod.opinion.public_feeds` | old 窗口是前一个等长区间 |
| 渠道下载结果 | 时间、渠道、语言、`selected_games` / 重点池 | `tencent-databrain-prod.opinion.public_feeds` | 不传 `channels` 时并发查 5 组默认渠道 |
| 选中游戏的时间趋势 | `timeline_games`、时间、`date_type` | `tencent-databrain-prod.opinion.public_feeds` | 曲线对象由 `timeline_games` 决定 |
| 时间线 `market_share_by_view` | `selected_games` 或重点池 + 时间切片 | `tencent-databrain-prod.opinion.public_feeds` | 分母集合不跟 `timeline_games` 走 |
| 重点游戏池 | `game_types` | `tencent-databrain-prod.opinion.top_mobile_game` / `top_pconsole_game` | **PARTITION BY** `DATE_TRUNC(date, YEAR)` · **CLUSTER BY** `game_id, date`；只作维表 / IN 列表来源 |

---

## 查询前先判断

1. **固定只查 `levelup` 数据源**：这不是可选条件；`PrepareTopRankingFeedsWhereAndParams()` 会把 `data_sources=['levelup']` 写死到公共过滤里。
2. **默认 `game_types = ['mobile', 'pc_console']`**：如果请求没传 `game_types`，主榜单自动全选这两个重点池。
3. **`selected_games` 与重点游戏池互斥**：有 `selected_games` 时不走重点池；没有 `selected_games` 才去查 `top_mobile_game / top_pconsole_game`。
4. **当前游戏补位只在“未传 `selected_games`”时发生**：如果当前游戏符合游戏类型，但没进 TopN，后端会额外查它并插到最前面。
5. **`timeline_games` 只控制曲线对象，不控制时间线分母**：`market_share_by_view` 的时间线分母来自 `selected_games` 或重点池，不来自 `timeline_games`。
6. **weekly timeline 的 `market_share_by_view` 不稳定**：时间线主查询能跑周粒度，但分母补算函数 `generateTimeSlices()` 没有 `week` 分支，所以周粒度 share 的补算有缺口。
7. **`impressions` 不是条数**：它是 `follower_number > 0` 的求和，别再写成 `COUNT(comment_uin)`。

---

## 按场景怎么查

### 场景 1：想看重点游戏在某时间段内的排行榜，以及 old 对比，怎么查？

#### 适合什么场景：
- 看当前窗口 TopN 排行
- 解释当前游戏补位
- 解释主榜单里的 `market_share_by_view`

#### 你会拿它回答什么问题：
- 哪些游戏在当前时间段的 views 最高？
- 为什么有的游戏不在 Top100 里，但返回结果仍然有它？
- `market_share_by_view` 的分母到底是全部重点池，还是当前返回结果？

#### 查哪张表：
- 主事实表：`tencent-databrain-prod.opinion.public_feeds`
- 重点游戏池：`tencent-databrain-prod.opinion.top_mobile_game` / `tencent-databrain-prod.opinion.top_pconsole_game`
- 分区字段：`comment_time`（按 `DAY` 分区，字段类型 `TIMESTAMP`）

#### 查的时候抓住：
- SQL 必须带 `comment_time` 时间范围
- SQL 必须带 `data_sources` 包含 `levelup`
- 有 `selected_games` 时只查这些游戏
- 没有 `selected_games` 时查重点游戏池；如果当前游戏符合类型但没进 TopN，还会额外补一条当前游戏数据
- old 窗口与当前窗口等长，且 `old_end = new_start - 1 秒`

```sql
SELECT
  unified_edition_id,
  SUM(CASE WHEN tweets_view < 0 THEN 0 ELSE tweets_view END) AS views,
  SUM(CASE WHEN follower_number > 0 THEN follower_number ELSE 0 END) AS impressions,
  SUM(
    (CASE WHEN tweets_retweet >= 0 THEN tweets_retweet ELSE 0 END)
    + (CASE WHEN tweets_reply >= 0 THEN tweets_reply ELSE 0 END)
    + (CASE WHEN tweets_like >= 0 THEN tweets_like ELSE 0 END)
    + (CASE WHEN tweets_unlike >= 0 THEN tweets_unlike ELSE 0 END)
  ) AS engagement,
  COUNT(DISTINCT CASE WHEN comment_parent_id = '-1' THEN comment_uin END) AS publications
FROM `tencent-databrain-prod.opinion.public_feeds`
WHERE comment_time >= TIMESTAMP('<start_time>')
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_time>'), INTERVAL 1 DAY)
  AND unified_edition_id IN (<game_id_list>)
  AND EXISTS(
    SELECT 1
    FROM UNNEST(data_sources) AS element
    WHERE element IN ('levelup')
  )
GROUP BY unified_edition_id
ORDER BY views DESC
LIMIT 100;
```

```sql
SELECT
  unified_edition_id,
  SUM(CASE WHEN tweets_view < 0 THEN 0 ELSE tweets_view END) AS views,
  SUM(CASE WHEN follower_number > 0 THEN follower_number ELSE 0 END) AS impressions,
  SUM(
    (CASE WHEN tweets_retweet >= 0 THEN tweets_retweet ELSE 0 END)
    + (CASE WHEN tweets_reply >= 0 THEN tweets_reply ELSE 0 END)
    + (CASE WHEN tweets_like >= 0 THEN tweets_like ELSE 0 END)
    + (CASE WHEN tweets_unlike >= 0 THEN tweets_unlike ELSE 0 END)
  ) AS engagement,
  COUNT(DISTINCT CASE WHEN comment_parent_id = '-1' THEN comment_uin END) AS publications
FROM `tencent-databrain-prod.opinion.public_feeds`
WHERE comment_time >= TIMESTAMP('<old_start_time>')
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<old_end_time>'), INTERVAL 1 DAY)
  AND unified_edition_id IN (<linked_game_id_list>)
  AND EXISTS(
    SELECT 1
    FROM UNNEST(data_sources) AS element
    WHERE element IN ('levelup')
  )
GROUP BY unified_edition_id;
```

#### 查数注意点：
- `impressions` 当前真实口径是 `SUM(follower_number)`（仅取 `follower_number > 0`），不是帖子条数。
- 主榜单 `market_share_by_view` 的当前分母不是“全部重点池全量 views”，而是：
  - 有 `selected_games` 时：当前查询结果里这些手选游戏的 views 总和
  - 无 `selected_games` 时：当前 TopN 结果的 views 总和；如果触发当前游戏补位，还会把补位游戏的 views 一起算进分母
- old 分母 `OldTotalView` 来自 old 窗口下 `linkedGameIds` 的总 views，不一定和当前窗口分母集合完全一样。
- 如果传了 `selected_games`，后端不会再自动把“当前游戏”补到最前面；是否出现完全取决于它是否本来就在 `selected_games` 里。

#### 简短后端逻辑小结：
- 入口：`services/compare/channel_share_ranking/top_ranking.go`
- 核心函数：`GetTopRankingRes()`
- 当前窗口查询：`getMultiGameCommentsStatByFilterConBQ()`
- 旧窗口查询：同一函数换成 old 时间范围
- `market_share_by_view` 在服务层用 `CalcMarketShareByView()` 计算

---

### 场景 2：想看按渠道拆分的排行榜（下载结果），怎么查？

#### 适合什么场景：
- 想看某个渠道自己的 Top 榜单
- 想解释为什么下载接口默认会返回 5 组渠道结果
- 想解释为什么只有默认分支会自动展开 YouTube 变体

#### 你会拿它回答什么问题：
- YouTube / TikTok / Instagram 的排名差异是什么？
- 为什么我请求里没传 `channels`，返回里却有多个渠道结果？
- 为什么传 `channels=['youtube']` 时，不会自动把 `youtube_keyword / youtube_live` 也并进去？

#### 查哪张表：
- 主事实表仍然是 `tencent-databrain-prod.opinion.public_feeds`
- 分区字段仍然是 `comment_time`

#### 查的时候抓住：
- 有 `channels` 时：后端只调用一次主榜单逻辑，返回 `selected_channel`
- 没有 `channels` 时：后端并发调用 5 次主榜单逻辑
- 只有“默认没传渠道”的 YouTube 分支，才会把渠道列表写成 `youtube / youtube_keyword / youtube_live`

```sql
SELECT
  unified_edition_id,
  SUM(CASE WHEN tweets_view < 0 THEN 0 ELSE tweets_view END) AS views,
  SUM(CASE WHEN follower_number > 0 THEN follower_number ELSE 0 END) AS impressions,
  SUM(
    (CASE WHEN tweets_retweet >= 0 THEN tweets_retweet ELSE 0 END)
    + (CASE WHEN tweets_reply >= 0 THEN tweets_reply ELSE 0 END)
    + (CASE WHEN tweets_like >= 0 THEN tweets_like ELSE 0 END)
    + (CASE WHEN tweets_unlike >= 0 THEN tweets_unlike ELSE 0 END)
  ) AS engagement,
  COUNT(DISTINCT CASE WHEN comment_parent_id = '-1' THEN comment_uin END) AS publications
FROM `tencent-databrain-prod.opinion.public_feeds`
WHERE comment_time >= TIMESTAMP('<start_time>')
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_time>'), INTERVAL 1 DAY)
  AND unified_edition_id IN (<game_id_list>)
  AND LOWER(channel_name) IN ('youtube_keyword', 'youtube_live')   -- ⚠️ public_feeds 中无 'youtube' 单值；YouTube 的真实底层枚举见 auxiliary/dim_tables.md §3
  AND EXISTS(
    SELECT 1
    FROM UNNEST(data_sources) AS element
    WHERE element IN ('levelup')
  )
GROUP BY unified_edition_id
ORDER BY views DESC
LIMIT 100;
```

#### 查数注意点：
- **只在默认分支**，YouTube 才会自动扩展成 `youtube / youtube_keyword / youtube_live`；如果请求已经显式传了 `channels`，后端不会帮你扩展。
- 下载结果里的每个渠道都有自己独立的 `market_share_by_view` 分母；不是全渠道共用一个总分母。
- 下载接口本质上没有单独的底层查询逻辑，它只是多次调用主榜单逻辑 `TopRanking()`。

#### 简短后端逻辑小结：
- 入口：`services/compare/channel_share_ranking/top_ranking_download.go`
- 有 `channels`：只跑一次 `TopRanking()`，结果放到 `selected_channel`
- 无 `channels`：并发跑 `youtube / tiktok / instagram / facebook / twitter` 五组

---

### 场景 3：想看选中游戏的时间趋势，以及每个时间点的 `market_share_by_view`，怎么查？

#### 适合什么场景：
- 已有一组待观察游戏，想看时间趋势
- 想解释 timeline 里的 `market_share_by_view`
- 想解释为什么周粒度 share 有时不稳定

#### 你会拿它回答什么问题：
- 某几个游戏在最近一段时间里 views 怎么变化？
- timeline 上的份额分母到底来自谁？
- 为什么 `timeline_games` 和 `selected_games` 传了不同集合后，份额会和直觉不一样？

#### 查哪张表：
- 主事实表：`tencent-databrain-prod.opinion.public_feeds`
- 分区字段：`comment_time`（`TIMESTAMP`）

#### 查的时候抓住：
- 曲线对象来自 `timeline_games`
- 时间线分母来自：
  - 有 `selected_games` 时 → `selected_games`
  - 无 `selected_games` 时 → 重点游戏池
- weekly 的 `market_share_by_view` 分母补算存在缺口，因为 `generateTimeSlices()` 没有 `week` 分支

```sql
SELECT
  unified_edition_id,
  FORMAT_DATE('%Y-%m-%d', DATE(comment_time)) AS time,
  SUM(CASE WHEN tweets_view < 0 THEN 0 ELSE tweets_view END) AS views,
  SUM(CASE WHEN follower_number > 0 THEN follower_number ELSE 0 END) AS impressions,
  SUM(
    (CASE WHEN tweets_retweet >= 0 THEN tweets_retweet ELSE 0 END)
    + (CASE WHEN tweets_reply >= 0 THEN tweets_reply ELSE 0 END)
    + (CASE WHEN tweets_like >= 0 THEN tweets_like ELSE 0 END)
    + (CASE WHEN tweets_unlike >= 0 THEN tweets_unlike ELSE 0 END)
  ) AS engagement,
  COUNT(DISTINCT CASE WHEN comment_parent_id = '-1' THEN comment_uin END) AS publications
FROM `tencent-databrain-prod.opinion.public_feeds`
WHERE comment_time >= TIMESTAMP('<timeline_start_time>')
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_time>'), INTERVAL 1 DAY)
  AND unified_edition_id IN (<timeline_game_ids>)
  AND EXISTS(
    SELECT 1
    FROM UNNEST(data_sources) AS element
    WHERE element IN ('levelup')
  )
GROUP BY unified_edition_id, time
ORDER BY time;
```

```sql
SELECT
  SUM(CASE WHEN tweets_view < 0 THEN 0 ELSE tweets_view END) AS total_views
FROM `tencent-databrain-prod.opinion.public_feeds`
WHERE comment_time >= TIMESTAMP('<bucket_start_time>')
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<bucket_end_time>'), INTERVAL 1 DAY)
  AND unified_edition_id IN (<denominator_game_ids>)
  AND EXISTS(
    SELECT 1
    FROM UNNEST(data_sources) AS element
    WHERE element IN ('levelup')
  );
```

#### 查数注意点：
- `timeline_games` 只决定曲线里有哪些游戏；它**不决定** `market_share_by_view` 分母集合。
- 有 `selected_games` 时，时间线分母只看 `selected_games`；没有 `selected_games` 时，分母看重点游戏池。
- weekly 场景下，时间线主值可以有周粒度结果，但 share 分母补算函数没有 `week` 分支，所以 `market_share_by_view` 的周粒度时间线可能缺失、为 0，或不稳定。
- 如果你要完全复现主榜单/时间线的“前补起点”行为，不能只拿原始 `start_time` 去查；`daily / weekly / monthly` 可能会分别前补 14 天 / 28 天 / 12 个月。

#### 简短后端逻辑小结：
- 入口：`services/compare/channel_share_ranking/top_ranking_timeline.go`
- timeline 主值查询：`tables.GetCommentsStatTimelineByFilterConBQ()`
- 分母补算：`getTimelineTotalViewMap()`
- 时间切片生成：`generateTimeSlices()`（当前没有 `week` 分支）

---

## Agent 不可直接查的数据

| 数据 | 为什么不可直接查 | 替代方案 |
|---|---|---|
| `market_share_by_view` | 服务层用 `views / total_views` 二次计算 | 先查 views，再按同一分母集合手工计算 |
| 当前游戏是否触发补位 | 是服务层基于 TopN 结果和游戏类型判断的布尔逻辑 | 先查 TopN，再检查当前游戏是否缺席且符合游戏类型 |
| 游戏详情（名称 / 封面 / publisher 等） | 由游戏详情服务补齐，不是 `feeds` 事实表字段 | 可查 `tencent-databrain-prod.common.app_detail` 或走游戏服务 |

---

## 常见误区 / 查不到结果时先看什么

1. **把 `impressions` 写成 `COUNT(comment_uin)`**：当前真实口径是 `SUM(follower_number)`（仅取正值）。
2. **把 `selected_games` 和 `timeline_games` 当成一回事**：前者控制主榜单 / 时间线分母集合，后者只控制曲线对象。
3. **误以为没传 `selected_games` 时一定只返回重点池 Top100**：如果当前游戏符合类型但没进 TopN，后端会补位到结果最前面。
4. **误以为显式传 `channels=['youtube']` 会自动扩展 YouTube 变体**：只有默认下载分支才会自动扩展。
5. **把 timeline 的 share 分母理解成 `timeline_games` 总 views**：实际不是；它跟 `selected_games` / 重点池走。
6. **把 weekly timeline share 当成稳定实现**：当前周粒度分母补算存在明确缺口。
7. **漏掉 `levelup` 数据源过滤**：漏掉后结果会偏大，而且不是页面真实口径。