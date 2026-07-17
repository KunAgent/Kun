# single_game — 单游戏投放素材统计（创意/素材数量·趋势·分布·环比·维度·交叉对比）

> 本文档面向「**单个游戏**」的广告投放素材取数：某游戏（`edition_unified_id`）在一段时间内有多少广告创意/素材、新增多少、按类型/渠道/国家等维度如何分布、趋势如何变化，以及如何与 DAU/下载叠加对比。
>
> 多游戏（1–15 个）横向对比 → [multi_game.md](multi_game.md)；单条素材/广告明细列表/按标签筛选 → [materials_list.md](materials_list.md)。
>
> SQL 验证状态（`tencent-databrain-prod`，2026-06-03 只读抽样）：场景 1/2/3/4/5/5b/6/7/8 均通过（旧对比窗口无数据时聚合为 NULL 属正常口径，不代表 SQL 错）。

---

## 涉及表

| 数据源 / 表 | 主要用途 | BigQuery 路径 | 分区 / 过滤键 | 备注 |
|---|---|---|---|---|
| 素材创意四指标日表 | Total、四指标趋势、creatives_trend | `intelligence.dwd_aix_gd_analysis_creatives` | `date`（DATE，`PARTITION BY DATE_TRUNC(date, MONTH)`）· 过滤键 `game_id` | all_* 日均、new_* 累加 |
| 素材多维统计日表 | 类型/渠道/国家/曝光/评分/互动等维度分析 | `intelligence.dwd_aix_gd_analysis_stats` | `date`（DATE，按月分区）· 过滤键 `game_id` + `metric` | 维度值在 `dimension_value` |
| 国家代码映射维表 | 三字母国家码 → 两字母 market | `intelligence.dim_aix_market` | 无（维表，配合主表缩小范围后再 JOIN） | 仅交叉对比 DAU 时用 |
| 手游运营指标（daily） | 交叉对比 download / DAU | `intelligence.game_metric_sensortower_daily_uid` | `date`（按月分区）· 过滤键 `id` | 仅 `need_compare_timeline` + mobile + daily |
| 手游运营指标（weekly/monthly） | 交叉对比 download / WAU·MAU | `intelligence.game_metric_sensortower_weekly_uid` / `intelligence.game_metric_sensortower_monthly_uid` | `date`（按月分区）· 过滤键 `id` | weekly 用 weekly 表，monthly 用 monthly 表 |
| PC/Console 运营指标 | 交叉对比 DAU | `intelligence.game_metric_ampere_daily_cid` | `date`（按月分区）· 过滤键 `edition_id` + `entity_type` | 仅 `need_compare_timeline` + pc/console |

> ⚠️ 默认 BigQuery 项目 `tencent-databrain-prod`。两张素材表都按月分区且聚簇 `game_id, date`，**SQL 必须带 `game_id` + `date >= / <=` 范围**，否则跨分区全扫。

---

## ID 解析

- 素材两张表过滤键 `game_id` = `edition_unified_id` = `scripts/game_search.py` 输出的 `game_id`（也即 `unified_edition_id`，前缀 `u`/`e`）。
- 交叉对比（场景 8）按 `game_search.py` 输出的 `entity_type` 选表：
  - `mobile` → `game_metric_sensortower_*_uid`，过滤键是 **`id`** 列（传 `edition_unified_id`）
  - `pc` / `console` → `game_metric_ampere_daily_cid`，过滤键是 **`edition_id`** 列（传 `edition_unified_id`）+ `entity_type`
- mobile 游戏查 Ampere 表通常无数据（属预期），PC/Console 游戏查 SensorTower 同理。

---

## 高频字段先翻译成人话

- **`game_id`（= `edition_unified_id`，写入 BQ 的游戏 ID）**：所有 creatives / stats 查询的主过滤键；与 `entity_type`（mobile/pc/console）一起决定交叉对比走 SensorTower 还是 Ampere。
- **`all_creative` / `all_material`（存量类，按日均）**：区间内「全部创意数 / 全部素材数」的日均值。聚合 `ROUND(SAFE_DIVIDE(SUM(col), COUNT(DISTINCT date)), 0)`。单日查询时除数为 1，等价当天值。
- **`new_creative` / `new_material`（增量类，按累计）**：区间内每日新增的直接累加，`ROUND(SUM(col), 0)`。**不要**对 `new_*` 再用日均公式，口径与 `all_*` 不同。
- **`date_type`（趋势时间粒度）**：`daily` 按天 / `weekly` 周一截断 / `monthly` 按月。影响时间线 GROUP BY 桶，也影响 DoD/SDLW 对比窗口（见场景 4）。Stats 接口若未传，后端默认按 daily。
- **`has_data_datetime`（该游戏 creatives 表最新有数据日）**：后端先查 `MAX(date)`（不限用户选的范围）。若最新有数据日 < `start_time` 所在日期 → 整接口返回空。实际查询结束日 `actual_end_date = MIN(最新有数据日, 用户 end_time 日期)`，Total / 趋势 / 类型分布都受此截断。
- **`metric`（stats 表指标类型）**：常见值 `creative_type_stat`（素材类型）、`creative_count_stat`（渠道创意数）、`impression_stat`（曝光）、`creative_score_stat`（评分）、`engagement_stat`（累计互动量）、`country_stat`（国家）、`platform_percent_stat`（表里有，但当前接口未暴露）。`creative_count_stat_by_channel_percent` 是前端指标名，底层仍查 `metric = 'creative_count_stat'`，占比在后端 Go 层重算。
- **`dimension_value`（维度取值）**：国家是 `DEU`、`JPN` 等三字母码；素材类型是 `image` / `video` / `playable` / `carousel` / `html`。SQL 匹配统一 `lower(dimension_value)`；中文名由后端映射，Agent 查 BQ 只有英文 value。
- **TopN / 分布选取口径（三种路径不要混用）**：
  - Timeline 未传 `dimension_values`：先取用户时间范围内**最新一天**各 dimension 的快照值排序取 TopN（不是日均）。
  - Stats 类型分布（`all_creative_type_list`）：只查 `actual_end_date` **单日快照**（start/end 都设为该日；单日下日均公式等价当天 SUM）。
  - DimensionValues（`country_stat`）：取用户**完整时间范围的日均值** `SAFE_DIVIDE(SUM(value), COUNT(DISTINCT date))` 排序取 TopN。
- **`need_others`（Others 聚合）**：仅在未指定 `dimension_values` 时生效；TopN 以外维度合并为 `Others`。Others 数值 Agent 可分别查，但「TopN + Others = 100%」的百分比重算发生在后端。

---

## 查询前先判断

- 先确认游戏在 creatives 表有没有数据、最新日是哪天；早于用户 `start` 则后端直接返回空，**不是 SQL 写错**。
- Total / 趋势的结束日会被截到 `MIN(最新有数据日, 用户 end_date)`，不要用用户原始 `end_date` 硬查。
- `all_*` 与 `new_*` 聚合公式不同，混用会导致 Total 与趋势点对不上。
- Stats 饼图（类型分布）查的是 `actual_end_date` 单日，不是整个 start~end 区间的日均。
- Timeline TopN 维度看范围内最新一天，DimensionValues 看全区间日均；同一国家可能在两个接口排名不同。
- `engagement_stat` 在日粒度是 SUM，周/月是日均；且后端还会额外追加一个 `engagement_stat` 汇总维度（各维度之和），该汇总行 Agent 需自行 SUM 复现。
- `creative_count_stat_by_channel_percent` 的 percentage 是后端按每个时间点 TopN+Others 重算的，**不要直接读 stats 表以为有占比字段**。
- 所有带 `date` 的表查询必须在 WHERE 中带日期范围，分区按月截断，避免全表扫描。
- `date_type` 在 DimensionValues 当前不影响 SQL（保留字段，实现未使用）。
- 交叉对比国家过滤：stats 表三字母码需经 `dim_aix_market` 转成两字母 market 再查 SensorTower / Ampere。

---

## 场景 1：查某游戏四指标总量（Total）

**适合什么场景**：汇总四个核心 KPI（全部创意、新增创意、全部素材、新增素材）。

**你会拿它回答什么问题**：选定时间段内，这个游戏广告创意/素材规模是多少？新增量累计多少？

**查哪张表**：`intelligence.dwd_aix_gd_analysis_creatives`

**查的时候抓住**：先查最新有数据日再决定 `end_date`；`all_*` → 日均、`new_*` → 区间 SUM；过滤 `game_id = <edition_unified_id>`。

```sql
-- Step 1: 最新有数据日
SELECT FORMAT_DATE('%Y-%m-%d', MAX(date)) AS has_data_date
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_creatives`
WHERE game_id = '<edition_unified_id>';

-- Step 2: Total（end_date 取 MIN(has_data_date, 用户 end_date)）
SELECT
  ROUND(SAFE_DIVIDE(SUM(all_creative), COUNT(DISTINCT date)), 0) AS all_creative,
  ROUND(SUM(new_creative), 0) AS new_creative,
  ROUND(SAFE_DIVIDE(SUM(all_material), COUNT(DISTINCT date)), 0) AS all_material,
  ROUND(SUM(new_material), 0) AS new_material
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_creatives`
WHERE game_id = '<edition_unified_id>'
  AND date >= DATE('<start_date>')
  AND date <= DATE('<actual_end_date>');
```

**查数注意点**：
- 若 `has_data_date < start_date`，后端返回空 Total，不是零值。
- 后端对纯日期字符串会自动补 `00:00:00` / `23:59:59`，但写入 BQ 条件的是日期部分。
- creatives 表虽有 `metric` 列，Total 查询未按 metric 过滤。

**简短后端逻辑小结**：入口 `services/ad_creative/stats.go → Stats`；先 `GetAdCreativesHasDataDate`，再 `GetAdCreativesTotal`；`actual_end_date` 截断逻辑决定 Total 时间窗。

---

## 场景 2：查四指标时间趋势（creatives_trend / Stats.timeline）

**适合什么场景**：观察创意/素材数量随时间的升降变化。

**你会拿它回答什么问题**：按天/周/月，all/new 四类指标如何变化？

**查哪张表**：`intelligence.dwd_aix_gd_analysis_creatives`

**查的时候抓住**：
- 时间桶：`daily` = 按天；`weekly` = `DATE_TRUNC(date, WEEK(MONDAY))`；`monthly` = `DATE_TRUNC(date, MONTH)`。
- 后端可能把查询起点向前扩展（daily 最多 14 天、weekly 28 天、monthly 12 个月），但 end 仍受 `actual_end_date` 截断。
- 聚合口径与 Total 一致。

```sql
-- daily
SELECT
  FORMAT_DATE('%Y-%m-%d', date) AS time,
  ROUND(SAFE_DIVIDE(SUM(all_creative), COUNT(DISTINCT date)), 0) AS all_creative,
  ROUND(SUM(new_creative), 0) AS new_creative,
  ROUND(SAFE_DIVIDE(SUM(all_material), COUNT(DISTINCT date)), 0) AS all_material,
  ROUND(SUM(new_material), 0) AS new_material
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_creatives`
WHERE game_id = '<edition_unified_id>'
  AND date >= DATE('<timeline_start_date>')
  AND date <= DATE('<actual_end_date>')
GROUP BY time
ORDER BY time;

-- weekly（周一为桶起点）
SELECT
  FORMAT_DATE('%Y-%m-%d', DATE_TRUNC(date, WEEK(MONDAY))) AS time,
  ROUND(SAFE_DIVIDE(SUM(all_creative), COUNT(DISTINCT date)), 0) AS all_creative,
  ROUND(SUM(new_creative), 0) AS new_creative,
  ROUND(SAFE_DIVIDE(SUM(all_material), COUNT(DISTINCT date)), 0) AS all_material,
  ROUND(SUM(new_material), 0) AS new_material
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_creatives`
WHERE game_id = '<edition_unified_id>'
  AND date >= DATE('<timeline_start_date>')
  AND date <= DATE('<actual_end_date>')
GROUP BY time
ORDER BY time;

-- monthly
SELECT
  FORMAT_DATE('%Y-%m-%d', DATE_TRUNC(date, MONTH)) AS time,
  ROUND(SAFE_DIVIDE(SUM(all_creative), COUNT(DISTINCT date)), 0) AS all_creative,
  ROUND(SUM(new_creative), 0) AS new_creative,
  ROUND(SAFE_DIVIDE(SUM(all_material), COUNT(DISTINCT date)), 0) AS all_material,
  ROUND(SUM(new_material), 0) AS new_material
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_creatives`
WHERE game_id = '<edition_unified_id>'
  AND date >= DATE('<timeline_start_date>')
  AND date <= DATE('<actual_end_date>')
GROUP BY time
ORDER BY time;
```

**查数注意点**：
- Stats 接口返回的 timeline 与 Timeline 接口 `metric=creatives_trend` 查同一张表，但 Timeline 把四个指标拆成 `dimension_value` 字段。
- 时间线展示起点看 `timeline_of_start_time`，不一定等于用户传入的 `start_time`。

**简短后端逻辑小结**：Stats：`GetTimeOfLineStartTime` + `GetAdCreativesTimeline`；Timeline：`metric=creatives_trend → timelineFromCreatives`。

---

## 场景 3：查素材类型分布（Stats 饼图 / all_creative_type_list）

**适合什么场景**：看最新有数据日各素材类型（图片/视频/试玩等）的数量构成。

**你会拿它回答什么问题**：在最新有数据日，各素材类型数量是多少？

**查哪张表**：`intelligence.dwd_aix_gd_analysis_stats`

**查的时候抓住**：只查 `actual_end_date` 单日（不是用户整个区间）；`metric = 'creative_type_stat'`；单日下 `SAFE_DIVIDE(SUM, COUNT(DISTINCT date))` 等价于 `SUM(value)`。

```sql
SELECT
  dimension_value,
  ROUND(SAFE_DIVIDE(SUM(value), COUNT(DISTINCT date)), 0) AS total_value
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_stats`
WHERE game_id = '<edition_unified_id>'
  AND date = DATE('<actual_end_date>')
  AND metric = 'creative_type_stat'
GROUP BY dimension_value
ORDER BY total_value DESC;
```

合法 `dimension_value`：`image`、`video`、`playable`、`carousel`、`html`。

**查数注意点**：
- 中文标签（图片/视频等）只在后端 `mapping.MaterialTypeOptions` 映射，BQ 无 zh 字段。
- 与 Timeline `metric=creative_type_stat` 不同：Timeline 看时间范围内 TopN 维度的日均趋势，本场景看单日快照。

**简短后端逻辑小结**：Stats 并发分支 `GetAdCreativeStatsDistribution`，filter 的 start/end 都设为 `actualEndDate`。

---

## 场景 4：DoD / SDLW 四指标对比

**适合什么场景**：对比当前周期与上一周期（DoD）或同期（SDLW）的四指标变化。

**你会拿它回答什么问题**：当前窗口 vs 上一窗口，四指标分别是多少？

**查哪张表**：`intelligence.dwd_aix_gd_analysis_creatives`（现值与旧值各查一次 Total SQL）。

**查的时候抓住**：
- 现值窗口：用户 `start_date` ~ `actual_end_date`（结束日受 has_data 截断）。
- DoD（`need_dod=true`）旧值窗口：
  - daily / weekly：与现值等长，整体平移到现值开始前一秒结束（`old_start = start + (start - end) - 1s`，`old_end = end + (start - end) - 1s`）。
  - monthly：向前推 N 个完整月（N = 现值跨越月数），`old_end = start - 1s`。
- SDLW（`need_sdlw=true`）旧值窗口（名字含 Last Week，但随粒度变化）：
  - daily：整体 -7 天；weekly：整体 -28 天（4 周）；monthly：start -1 年，end 取「去年同月的最后一天 23:59:59」。
- 现值与旧值均使用场景 1 的 Total 聚合口径；旧值窗口不受 `actual_end_date` 截断。

```sql
-- 现值：daily 示例，用户选 2026-05-26 ~ 2026-06-01，actual_end_date = 2026-06-01
SELECT
  ROUND(SAFE_DIVIDE(SUM(all_creative), COUNT(DISTINCT date)), 0) AS all_creative,
  ROUND(SUM(new_creative), 0) AS new_creative,
  ROUND(SAFE_DIVIDE(SUM(all_material), COUNT(DISTINCT date)), 0) AS all_material,
  ROUND(SUM(new_material), 0) AS new_material
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_creatives`
WHERE game_id = '<edition_unified_id>'
  AND date >= DATE('2026-05-26')
  AND date <= DATE('2026-06-01');

-- DoD 旧值：daily，与上例现值等长 7 天（old_start = 2026-05-19, old_end = 2026-05-25）
SELECT
  ROUND(SAFE_DIVIDE(SUM(all_creative), COUNT(DISTINCT date)), 0) AS all_creative,
  ROUND(SUM(new_creative), 0) AS new_creative,
  ROUND(SAFE_DIVIDE(SUM(all_material), COUNT(DISTINCT date)), 0) AS all_material,
  ROUND(SUM(new_material), 0) AS new_material
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_creatives`
WHERE game_id = '<edition_unified_id>'
  AND date >= DATE('2026-05-19')
  AND date <= DATE('2026-05-25');

-- SDLW 旧值：daily，与上例现值整体 -7 天（本例与 DoD 旧窗口日期相同，但计算规则不同）
SELECT
  ROUND(SAFE_DIVIDE(SUM(all_creative), COUNT(DISTINCT date)), 0) AS all_creative,
  ROUND(SUM(new_creative), 0) AS new_creative,
  ROUND(SAFE_DIVIDE(SUM(all_material), COUNT(DISTINCT date)), 0) AS all_material,
  ROUND(SUM(new_material), 0) AS new_material
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_creatives`
WHERE game_id = '<edition_unified_id>'
  AND date >= DATE('2026-05-19')
  AND date <= DATE('2026-05-25');

-- DoD 旧值：monthly 示例，用户选 2026-04-01 ~ 2026-06-30（跨 3 个月）
-- old_start = 2026-01-01, old_end = 2026-03-31（向前推 3 个月，结束于现值 start 前一日）
SELECT
  ROUND(SAFE_DIVIDE(SUM(all_creative), COUNT(DISTINCT date)), 0) AS all_creative,
  ROUND(SUM(new_creative), 0) AS new_creative,
  ROUND(SAFE_DIVIDE(SUM(all_material), COUNT(DISTINCT date)), 0) AS all_material,
  ROUND(SUM(new_material), 0) AS new_material
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_creatives`
WHERE game_id = '<edition_unified_id>'
  AND date >= DATE('2026-01-01')
  AND date <= DATE('2026-03-31');

-- SDLW 旧值：weekly 示例，用户选 2026-05-05 ~ 2026-06-01
-- old_start = 2026-04-07, old_end = 2026-05-04（整体 -28 天）
SELECT
  ROUND(SAFE_DIVIDE(SUM(all_creative), COUNT(DISTINCT date)), 0) AS all_creative,
  ROUND(SUM(new_creative), 0) AS new_creative,
  ROUND(SAFE_DIVIDE(SUM(all_material), COUNT(DISTINCT date)), 0) AS all_material,
  ROUND(SUM(new_material), 0) AS new_material
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_creatives`
WHERE game_id = '<edition_unified_id>'
  AND date >= DATE('2026-04-07')
  AND date <= DATE('2026-05-04');

-- SDLW 旧值：monthly 示例，用户选 2026-04-01 ~ 2026-06-30
-- old_start = 2025-04-01, old_end = 2025-06-30（start -1 年；end 为去年同月最后一天）
SELECT
  ROUND(SAFE_DIVIDE(SUM(all_creative), COUNT(DISTINCT date)), 0) AS all_creative,
  ROUND(SUM(new_creative), 0) AS new_creative,
  ROUND(SAFE_DIVIDE(SUM(all_material), COUNT(DISTINCT date)), 0) AS all_material,
  ROUND(SUM(new_material), 0) AS new_material
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_creatives`
WHERE game_id = '<edition_unified_id>'
  AND date >= DATE('2025-04-01')
  AND date <= DATE('2025-06-30');
```

**查数注意点**：
- 后端返回的是旧窗口四指标**绝对值**，不是涨跌幅；增长率需自行 `(new-old)/old`。
- Stats 还会在 `need_sdlw=true` 时额外查去年同期四指标时间线（`old_timeline`），窗口与 SDLW 旧值一致但按趋势粒度聚合。

**简短后端逻辑小结**：DoD：`utils.GetDoDTime → 两次 GetAdCreativesTotal`；SDLW：`utils.GetSamePeriodLastDateTypeTime → GetAdCreativesTotal + 可选 GetAdCreativesTimeline`。

---

## 场景 5：多维度 TopN 时间趋势（Timeline，除 creatives_trend 外）

**适合什么场景**：渠道创意数、曝光、评分、国家、互动量等维度的多线趋势分析。

**你会拿它回答什么问题**：哪些渠道/国家/类型贡献最大？随时间如何变化？

**查哪张表**：`intelligence.dwd_aix_gd_analysis_stats`

**查的时候抓住**：基础条件 `game_id` + 日期范围 + `metric = '<metric>'`；未传 `dimension_values` 时，先用范围内**最新一天**快照选 TopN。

```sql
-- Step 1: 取 TopN 维度（默认 N=10）
WITH latest_date AS (
  SELECT MAX(date) AS max_date
  FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_stats`
  WHERE game_id = '<edition_unified_id>'
    AND date >= DATE('<start_date>')
    AND date <= DATE('<end_date>')
    AND metric = '<metric>'
)
SELECT dimension_value
FROM (
  SELECT
    dimension_value,
    SUM(value) AS total_value,
    ROW_NUMBER() OVER (ORDER BY SUM(value) DESC, dimension_value) AS rn
  FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_stats` t, latest_date ld
  WHERE game_id = '<edition_unified_id>'
    AND date >= DATE('<start_date>')
    AND date <= DATE('<end_date>')
    AND metric = '<metric>'
    AND t.date = ld.max_date
  GROUP BY dimension_value, t.date
)
WHERE rn <= 10;

-- Step 2: TopN 维度的时间线（daily 日均口径；engagement_stat 见场景 5b）
SELECT
  FORMAT_DATE('%Y-%m-%d', date) AS time,
  dimension_value,
  ROUND(SAFE_DIVIDE(SUM(value), COUNT(DISTINCT date)), 0) AS total_value
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_stats`
WHERE game_id = '<edition_unified_id>'
  AND date >= DATE('<timeline_start_date>')
  AND date <= DATE('<end_date>')
  AND metric = '<metric>'
  AND lower(dimension_value) IN ('<dim1>', '<dim2>')  -- Step 1 结果
GROUP BY time, dimension_value
ORDER BY time, total_value DESC;
```

支持的 `<metric>`（Timeline 接口）：`creative_count_stat`、`impression_stat`、`creative_score_stat`、`creative_type_stat`、`engagement_stat`、`country_stat`。

**查数注意点**：
- 用户传入 `dimension_values` 时跳过 TopN 选取，直接查指定维度（小写匹配）。
- `latest_snapshot`（最新时间快照）由后端判断 `end_time` 是否落在最后一个时间桶内，Agent 需按同样区间规则自行判断。

**简短后端逻辑小结**：`timelineFromStats → GetAdCreativeStatsTopN + GetAdCreativeStatsTimelineGrouped`（或 engagement / byChannel 变体）。

---

## 场景 5b：engagement_stat（累计互动量）特殊口径

**适合什么场景**：各渠道/维度累计互动量随时间的变化。

**你会拿它回答什么问题**：各 dimension 的累计互动量趋势是多少？同一时间点合计多少？

**查哪张表**：`intelligence.dwd_aix_gd_analysis_stats`（`metric = 'engagement_stat'`）。

**查的时候抓住**：
- daily：`SUM(value)` — 每天桶内直接求和（value 本身是当日累计互动量）。
- weekly / monthly：`SAFE_DIVIDE(SUM(value), COUNT(DISTINCT date))` — 桶内日均。
- 后端还会在每条时间点追加 `dimension_value='engagement_stat'` 的汇总行（= 同时间点其他维度之和）。

```sql
-- daily
SELECT
  FORMAT_DATE('%Y-%m-%d', date) AS time,
  dimension_value,
  SUM(value) AS total_value
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_stats`
WHERE game_id = '<edition_unified_id>'
  AND date >= DATE('<start_date>')
  AND date <= DATE('<end_date>')
  AND metric = 'engagement_stat'
  AND lower(dimension_value) IN ('<dim1>', '<dim2>')
GROUP BY time, dimension_value
ORDER BY time;

-- weekly（桶内日均累计互动量）
SELECT
  FORMAT_DATE('%Y-%m-%d', DATE_TRUNC(date, WEEK(MONDAY))) AS time,
  dimension_value,
  ROUND(SAFE_DIVIDE(SUM(value), COUNT(DISTINCT date)), 0) AS total_value
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_stats`
WHERE game_id = '<edition_unified_id>'
  AND date >= DATE('<start_date>')
  AND date <= DATE('<end_date>')
  AND metric = 'engagement_stat'
  AND lower(dimension_value) IN ('<dim1>', '<dim2>')
GROUP BY time, dimension_value
ORDER BY time;
```

**查数注意点**：
- 不要把 engagement 与日均口径的其他 metric 混在同一 SQL 模板里。
- 汇总维度行 `engagement_stat` 需对同 time 的各 dimension 自行 SUM 复现。

**简短后端逻辑小结**：入口 `services/ad_creative/timeline.go → GetAdCreativeStatsEngagementTimeline`；daily 走 SUM，weekly/monthly 走 SAFE_DIVIDE；汇总行在 Go 层追加。

---

## 场景 6：渠道创意数占比（creative_count_stat_by_channel_percent）

**适合什么场景**：各渠道创意数占当日/当周/当月总量的百分比。

**你会拿它回答什么问题**：Facebook / Google / TikTok 等渠道创意数占比随时间如何变？

**查哪张表**：`intelligence.dwd_aix_gd_analysis_stats`（`metric = 'creative_count_stat'`）。

**查的时候抓住**：
- 先按场景 5 取 TopN 绝对值时间线。
- 每个 time 桶内：`percentage = channel_value / SUM(channel_value)`，保留 4 位小数。
- 若 `need_others=true`，Others = TopN 以外维度按时间聚合，再与 TopN 一起重算占比使总和为 100%。

```sql
SELECT
  time,
  dimension_value,
  channel_value AS total_value,
  CASE WHEN total_all > 0 THEN ROUND(channel_value / total_all, 4) ELSE 0 END AS percentage
FROM (
  SELECT
    time,
    dimension_value,
    channel_value,
    SUM(channel_value) OVER (PARTITION BY time) AS total_all
  FROM (
    SELECT
      FORMAT_DATE('%Y-%m-%d', date) AS time,
      dimension_value,
      ROUND(SAFE_DIVIDE(SUM(value), COUNT(DISTINCT date)), 0) AS channel_value
    FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_stats`
    WHERE game_id = '<edition_unified_id>'
      AND date >= DATE('<start_date>')
      AND date <= DATE('<end_date>')
      AND metric = 'creative_count_stat'
      AND lower(dimension_value) IN ('<dim1>', '<dim2>')
    GROUP BY time, dimension_value
  )
)
ORDER BY time, total_value DESC;
```

**查数注意点**：
- 后端最终展示的 value 是百分比（0~1 小数），`raw_value` 才是绝对数量；Agent 查 BQ 需自行两阶段计算。
- Others 占比失败时后端不阻塞主时间线。

**简短后端逻辑小结**：入口 `services/ad_creative/timeline.go → timelineFromStats`（`isByChannelPercent` 分支）；底层查 `metric='creative_count_stat'`，占比在 Go 层按每个 time 桶重算。

---

## 场景 7：国家维度日均值列表（DimensionValues / country_stat）

**适合什么场景**：按国家维度列出日均值排行，用于地图或筛选项。

**你会拿它回答什么问题**：哪些国家素材相关指标最高？各国家日均值多少？

**查哪张表**：`intelligence.dwd_aix_gd_analysis_stats`

**查的时候抓住**：目前接口仅支持 `metric = 'country_stat'`；取用户**完整时间范围的日均值**（不是最新日快照）；默认 TopN=10；`need_others=true` 时追加 Others 日均。

```sql
SELECT dimension_value, total_value
FROM (
  SELECT
    dimension_value,
    ROUND(SAFE_DIVIDE(SUM(value), COUNT(DISTINCT date)), 0) AS total_value,
    ROW_NUMBER() OVER (
      ORDER BY ROUND(SAFE_DIVIDE(SUM(value), COUNT(DISTINCT date)), 0) DESC, dimension_value
    ) AS rn
  FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_stats`
  WHERE game_id = '<edition_unified_id>'
    AND date >= DATE('<start_date>')
    AND date <= DATE('<end_date>')
    AND metric = 'country_stat'
  GROUP BY dimension_value
)
WHERE rn <= 10;

-- Others 日均（排除 TopN 国家）
SELECT
  'Others' AS dimension_value,
  ROUND(SAFE_DIVIDE(SUM(value), COUNT(DISTINCT date)), 0) AS total_value
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_stats`
WHERE game_id = '<edition_unified_id>'
  AND date >= DATE('<start_date>')
  AND date <= DATE('<end_date>')
  AND metric = 'country_stat'
  AND lower(dimension_value) NOT IN ('<top1>', '<top2>');
```

**查数注意点**：
- `date_type` 字段当前不影响 DimensionValues 聚合（实现未读取）。
- `dimension_value` 为三字母国家码（如 `USA`、`DEU`），不是两字母 ISO。

**简短后端逻辑小结**：入口 `services/ad_creative/dimension_values.go → DimensionValues`；仅支持 `metric=country_stat`；TopN 按区间日均排序，Others 可选追加。

---

## 场景 8：交叉对比时间线（素材 vs DAU / 下载）

**适合什么场景**：将素材趋势与游戏运营指标（DAU、下载）放在同一时间轴上对比。

**你会拿它回答什么问题**：素材增长是否伴随 DAU / 下载变化？

**查哪张表**：
- 手游 daily：`intelligence.game_metric_sensortower_daily_uid`
- 手游 weekly：`intelligence.game_metric_sensortower_weekly_uid`
- 手游 monthly：`intelligence.game_metric_sensortower_monthly_uid`
- PC/Console：`intelligence.game_metric_ampere_daily_cid`
- 国家映射：`intelligence.dim_aix_market`

**查的时候抓住**：
- 仅在 `need_compare_timeline=true` 时返回；与素材 stats/creatives 无 JOIN，时间窗对齐而已。
- mobile 默认 `market IN ('global')`；若 Timeline 指定了 `country_stat` 的 `dimension_values`，需先映射 market。
- `date_type=daily` 查 daily 表返回 dau；weekly 查 weekly 表返回 wau；monthly 查 monthly 表返回 mau。

```sql
-- 三字母 → 两字母 market
SELECT country_abbr, LOWER(country_en) AS market
FROM `tencent-databrain-prod.intelligence.dim_aix_market`
WHERE country_abbr IN ('DEU', 'JPN');

-- 手游 daily：download + dau（global）
SELECT
  FORMAT_DATE('%Y-%m-%d', date) AS time,
  SUM(download) AS download,
  AVG(dau) AS dau
FROM (
  SELECT id, date, SUM(download) AS download, SUM(dau) AS dau
  FROM `tencent-databrain-prod.intelligence.game_metric_sensortower_daily_uid`
  WHERE id = '<edition_unified_id>'
    AND date >= DATE('<start_date>')
    AND date <= DATE('<end_date>')
    AND platform IN ('appstore', 'googleplay')
    AND market IN ('global')
  GROUP BY id, date
)
GROUP BY time
ORDER BY time;

-- 手游 weekly：download + wau（global）
SELECT
  FORMAT_DATE('%Y-%m-%d', date) AS time,
  AVG(download) AS download,
  AVG(wau) AS wau
FROM (
  SELECT id, date, SUM(download) AS download, SUM(wau) AS wau
  FROM `tencent-databrain-prod.intelligence.game_metric_sensortower_weekly_uid`
  WHERE id = '<edition_unified_id>'
    AND date >= DATE('<start_date>')
    AND date <= DATE('<end_date>')
    AND platform IN ('appstore', 'googleplay')
    AND market IN ('global')
  GROUP BY id, date
)
GROUP BY time
ORDER BY time;

-- PC daily：dau（global）
SELECT
  FORMAT_DATE('%Y-%m-%d', date) AS time,
  SAFE_DIVIDE(SUM(active_users), COUNT(DISTINCT date)) AS dau
FROM `tencent-databrain-prod.intelligence.game_metric_ampere_daily_cid`
WHERE edition_id = '<edition_unified_id>'
  AND entity_type = '<pc|console>'
  AND date >= DATE('<start_date>')
  AND date <= DATE('<end_date>')
  AND market = 'global'
GROUP BY time
ORDER BY time;

-- PC weekly：dau 按周聚合（与后端 DATE_TRUNC 口径一致）
SELECT
  FORMAT_DATE('%Y-%m-%d', DATE_TRUNC(date, WEEK(MONDAY))) AS time,
  SAFE_DIVIDE(SUM(active_users), COUNT(DISTINCT date)) AS dau
FROM `tencent-databrain-prod.intelligence.game_metric_ampere_daily_cid`
WHERE edition_id = '<edition_unified_id>'
  AND entity_type = '<pc|console>'
  AND date >= DATE('<start_date>')
  AND date <= DATE('<end_date>')
  AND market = 'global'
GROUP BY time
ORDER BY time;
```

**查数注意点**：
- weekly 时 mobile 返回 wau，monthly 返回 mau，需换表且字段名不同。
- PC/Console 交叉对比必须用对应 `entity_type` 的游戏 ID；mobile 游戏查 Ampere 表通常无数据。
- 这是独立运营数据源，与素材表数据延迟、覆盖范围可能不一致。

**简短后端逻辑小结**：入口 `services/ad_creative/timeline.go → getCompareTimeline`；mobile → `MobileSensortowerStats`；pc/console → `GetAmpereDailyDAU`。

---

## Agent 不可直接查的数据（接口形态差异）

| 内容 | 原因 | 替代方案 |
|---|---|---|
| 素材类型中文名 `dimension_value_zh` | 后端 `mapping.MaterialTypeOptions` 内存映射 | 查 BQ 英文 value，对照 `image`/`video`/`playable`/`carousel`/`html` |
| `creative_count_stat_by_channel_percent` 最终占比 | Go 层按 TopN+Others 重算百分比 | 先查绝对值再自行除（场景 6） |
| `engagement_stat` 汇总维度行 | Go 层对各维度求和追加 | 对同 time 的 dimension 自行 SUM（场景 5b） |
| `latest_snapshot` 是否为空 | 后端判断 `end_time` 是否落在最后时间桶 | 按 daily/weekly/monthly 区间规则自行判断 |
| DoD/SDLW 涨跌幅百分比 | 后端只返回 old 绝对值 | 用现值/old 值自行计算 |
| Redis 路由缓存（10 分钟） | 非数据源 | 直接查 BQ |

---

## 常见误区 / 查不到结果时先看什么

- 没查最新有数据日 — 游戏无数据或 `has_data_date` 早于 start，后端整包为空。
- Total 用了用户 `end_date` 而非 `actual_end_date` — 未来日期会导致与后端结果不一致。
- 对 `new_creative` 用了日均公式 — 增量指标应 SUM，不是 SAFE_DIVIDE。
- 类型分布用了整个区间日均 — Stats 饼图只查 `actual_end_date` 单日。
- Timeline TopN 与 DimensionValues 排名口径混用 — 前者看最新日快照，后者看区间日均。
- country 三字母码直接写入 SensorTower market — 需经 `dim_aix_market` 转两字母。
- `engagement_stat` 周月仍用 SUM — weekly/monthly 应日均。
- 漏写 `date` 分区过滤 — 两表均为按月分区，必须带 `date >= / <=`。
- 以为 `platform_percent_stat` 可查 — 表里有该 metric，但当前三个接口均未暴露。
- 把交叉对比线当成素材表字段 — DAU/download 来自独立 intelligence 表，需分开查再对齐时间。
