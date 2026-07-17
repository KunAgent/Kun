# multi_game — 多游戏投放素材分析（/ad_creative_multi/*）

> 本文档面向「**多个游戏（1–15 个）**」做投放素材横向对比、写竞品/大盘报告：overview 卡片 / timeline 趋势 / sum 汇总 / 国家×游戏矩阵 / dimension_summary 维度拆分占比，含 `need_link` 环比。
>
> 单游戏的总量·趋势·分布·环比·维度 TopN·素材vsDAU → [single_game.md](single_game.md)；单条素材/广告明细列表/按标签筛选 → [materials_list.md](materials_list.md)。
>
> 本模块只围绕两张**已预聚合**的分析表（都按天 + 游戏维度，已经不是素材明细）。默认项目 `tencent-databrain-prod`。验证方式：INFORMATION_SCHEMA 查 DDL + 只读抽样（2026-06-03）；环比窗口表与 `pkg/utils/util.go` 实现核对一致。

---

## 涉及表

| 表 | 用途 | 分区 / 聚簇 | 过滤键 |
|---|---|---|---|
| `intelligence.dwd_aix_gd_analysis_creatives` | 每天每游戏的创意/素材数量（4 个指标） | `PARTITION BY DATE_TRUNC(date, MONTH)`；聚簇 `game_id, date` | `game_id` + `date` |
| `intelligence.dwd_aix_gd_analysis_stats` | 每天每游戏每维度值的单指标值（渠道/国家/素材类型/互动等） | `PARTITION BY DATE_TRUNC(date, MONTH)`；聚簇 `game_id, date` | `game_id` + `date` + `metric` |
| `intelligence.dim_aix_gd_games` | 游戏名/图标/品类（不在两张分析表内） | — | `game_id`（JOIN 用） |
| `intelligence.dim_aix_market` | alpha-3 → alpha-2 / 国家名映射 | — | `country_abbr` |

> ⚠️ 两表都按月分区且聚簇 `game_id+date`，SQL 必须 `game_id IN (...) AND date >= DATE(?) AND date <= DATE(?)`，否则跨分区全扫。`game_id` = `edition_unified_id` = `scripts/game_search.py` 输出的 `game_id`。

### creatives 表字段

- `game_id`、`date`（DATE，分区键）、`domain`（应用商店包/ID，一个 game_id 可有多个 domain）、`all_creative`、`new_creative`、`all_material`、`new_material`（均 INT64）。
- 粒度：`(game_id, date, domain)` 一行。游戏级 = 跨 domain SUM（预期行为，不是重复计数）。

### stats 表字段

- `date`（DATE，分区键）、`game_id`、`metric`、`dimension_value`、`value`（FLOAT64）。
- `metric` 实际枚举值及其 `dimension_value` 含义（已实跑确认）：

| metric | dimension_value 是什么 | 典型值 | 接口里怎么用 |
|---|---|---|---|
| `creative_count_stat` | 渠道 | admob/applovin/youtube/facebook…（32 个，小写） | 渠道创意数；两种百分比 metric 的底层 |
| `impression_stat` | 渠道 | 同上 | 各渠道曝光 |
| `creative_score_stat` | 渠道 | 同上 | 各渠道创意分 |
| `creative_type_stat` | 素材类型 | video/image/playable/html/carousel | overview 卡片的类型分布（快照） |
| `engagement_stat` | 互动类型 | view/share/comment/like | 互动；timeline 会额外补一条合计 |
| `country_stat` | 国家 alpha-3 | USA/JPN/…（172 个，大写） | stats 接口的国家矩阵 |
| `platform_percent_stat` | 渠道 | 同上 | ⚠️ 存在于表，但 5 个接口未开放；直接查表可用 |

- 派生 metric（不是表里真实 metric）：`creative_count_stat_by_channel_percent`、`creative_count_stat_by_competitor_percent` 都基于 `creative_count_stat` 现算占比，详见场景 5 / 「占比口径」。

---

## 高频字段先翻译成人话

- **`date_type`（趋势粒度 / 仅影响环比与 timeline 扩窗）**：入参 `daily`/`weekly`/`monthly`（默认 daily）。timeline 分桶：daily→按天；weekly→`DATE_TRUNC(..., WEEK(MONDAY))`；monthly→按月。环比旧区间见下文「环比时间窗口」表（与 `need_link` 配套）。
- **`need_link`（是否要环比）**：`true` 时除主区间聚合外，再查一段等长前置区间，返回 `link_values` / `link_list` 与 `link_time` 四段日期；`false` 只查主区间。
- **`dimension_values`（维度值筛选，可选）**：入参会转小写；SQL 用 `lower(dimension_value) IN (...)`。渠道类 metric 传小写渠道名；`country_stat` 传 alpha-3（`usa` 可匹配表内 `USA`）。两个 `*_percent`：筛选只缩分子，分母仍用全量渠道/全游戏（保证占比 ≤ 100%）。
- **`metric`（stats 表指标名）vs 派生 metric**：表里真实值见上表；`creative_count_stat_by_channel_percent` / `..._by_competitor_percent` 仅接口层存在，底层固定查 `creative_count_stat` 再算占比。

---

## 查询前先判断（影响口径，必读）

- **「日均」是核心口径**：除累积指标外，几乎所有值都用 `ROUND(SAFE_DIVIDE(SUM(value), COUNT(DISTINCT date)), 0)` 算区间/桶内日均。单天查询时分母=1，不影响。
- creatives 4 指标里「存量」和「新增」口径不同：
  - `all_creative` / `all_material` = 区间日均存量（`SAFE_DIVIDE(SUM, COUNT(DISTINCT date))`）。
  - `new_creative` / `new_material` = 区间累积新增（直接 SUM）。
  - ⚠️ 累积口径下 `new_*` 会随区间变长线性增大，和 `all_*`（日均）量级不可比，排序时尤其注意。
- `country_stat` 的 `dimension_value` 是大写 alpha-3（`USA`），而渠道类是小写（`admob`）。筛选时对入参做小写后用 `lower(dimension_value) IN (...)` 比较；`sort_by_dimension` 入参会转大写（默认 `USA`）。
- 环比（`need_link=true`）：在与主区间相同聚合 SQL 下，只把 `date` 换成「旧区间」起止日；旧区间算法见下表。新/旧值公式一致，禁止混用不同聚合口径再比。
- overview 的 `creative_type_stat` 是「快照」不是区间聚合：只取 `actualEndDate` 当天一天（快照不能跨天 SUM）。
- timeline 查询起点可能被前推（仅接口行为，直接查表可忽略）：`daily` 约前推 14 天、weekly 约 28 天、monthly 约 12 个月——用于多画几个点。你只要用户窗口时，用请求里的 `start_time`/`end_time` 即可。

### 环比时间窗口（need_link=true 时旧区间）

设新区间为 `[start_time, end_time]`（补齐到 `YYYY-MM-DD HH:MM:SS` 后按日历日/月计算）：

| date_type | 旧区间结束 old_end | 旧区间开始 old_start |
|---|---|---|
| daily | 新区间 start 的前 1 秒 | 从 start 的日历日再往前 `dur+1` 天 的 `00:00:00`，其中 `dur = int((end−start) 的小时数 / 24)` |
| weekly | 同 daily（按天差回推） | 同 daily |
| monthly | 新区间 start 的前 1 秒 | 从 start 的日历月再往前 `months+1` 个月 的同日，其中 `months = (end年−start年)×12 + (end月−start月)` |

取日期部分写 SQL 时：`old_start_date = DATE(old_start)`，`old_end_date = DATE(old_end)`。overview 接口还会把主区间结束日截断为 `min(批内最新有数据日, 请求 end)`。

---

## 场景 1：每个游戏的创意数/素材数总量（overview 卡片）

**适合什么场景**：多游戏投放概览卡片、横向排名、带环比的 KPI 条。

**你会拿它回答什么问题**：这 N 个游戏各自有多少创意/素材？日均存量与累积新增各是多少？

**查哪张表**：`intelligence.dwd_aix_gd_analysis_creatives`

**查的时候抓住**：`game_id IN` + date 区间；`all_*` 走日均、`new_*` 走累积；按 `game_id` 分组。

```sql
SELECT game_id,
  ROUND(SAFE_DIVIDE(SUM(all_creative), COUNT(DISTINCT date)), 0) AS all_creative,   -- 日均存量
  ROUND(SUM(new_creative), 0)                                     AS new_creative,  -- 累积新增
  ROUND(SAFE_DIVIDE(SUM(all_material), COUNT(DISTINCT date)), 0)  AS all_material,
  ROUND(SUM(new_material), 0)                                     AS new_material
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_creatives`
WHERE game_id IN (<game_id_1>, <game_id_2>)
  AND date >= DATE('<start_date>')   -- 例 '2026-05-01'
  AND date <= DATE('<end_date>')     -- 例 '2026-06-02'（接口会取 min(最新有数日, end)）
GROUP BY game_id
ORDER BY all_creative DESC;          -- 可选，白名单仅 all_*/new_*
```

类型分布卡片（overview 里的 video/image/playable）单独取最新一天快照：

```sql
SELECT game_id, dimension_value, ROUND(SAFE_DIVIDE(SUM(value), COUNT(DISTINCT date)), 0) AS total_value
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_stats`
WHERE game_id IN (<game_ids>) AND metric = 'creative_type_stat'
  AND date = DATE('<actual_end_date>')   -- 单天快照，起止同一天
GROUP BY game_id, dimension_value;
```

**查数注意点**：
- 接口实际结束日 = `min(该批游戏最新有数据日, 请求 end)`；若请求区间整体早于最新有数日之外/晚于全部数据，接口直接返回空。直接查表时自己决定区间即可。
- `new_*` 与 `all_*` 不可同量级比较（见「查询前先判断」第 2 条）。

**简短后端逻辑小结**：入口 `services/gaming_content_trends/ad_creative_multi/overview.go: Overview`；4 指标走 `tables.GetAdCreativesMultiTotal`，类型快照走 `GetAdCreativeStatsDistribution`（单天）。游戏名/图标/品类不在本接口返回，需另查 `intelligence.dim_aix_gd_games`。

---

## 场景 2：某指标的时间趋势曲线（timeline）

**适合什么场景**：折线图、堆叠面积图，看渠道/国家/类型/互动随时间变化。

**你会拿它回答什么问题**：creative_count / 曝光 / 互动等随日/周/月怎么变？渠道占比曲线怎么变？

**查哪张表**：`metric=creatives_trend` → `intelligence.dwd_aix_gd_analysis_creatives`；其余 → `intelligence.dwd_aix_gd_analysis_stats`。

**查的时候抓住**：按 `date_type` 分桶（`DATE_TRUNC`），桶内仍是日均；stats 按 `(time, game_id, dimension_value)` 分组。

```sql
-- 通用 metric（如 creative_count_stat），按天分桶：
SELECT FORMAT_DATE('%Y-%m-%d', date) AS time, game_id, dimension_value,
  ROUND(SAFE_DIVIDE(SUM(value), COUNT(DISTINCT date)), 0) AS total_value
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_stats`
WHERE game_id IN (<game_ids>)
  AND date >= DATE('<start_date>') AND date <= DATE('<end_date>')
  AND metric = 'creative_count_stat'
  -- 可选维度筛选： AND lower(dimension_value) IN ('admob','applovin')
GROUP BY time, game_id, dimension_value
ORDER BY time, game_id, total_value DESC;
```

分桶表达式按 `date_type` 切换：
- daily：`FORMAT_DATE('%Y-%m-%d', date)`
- weekly：`FORMAT_DATE('%Y-%m-%d', DATE_TRUNC(date, WEEK(MONDAY)))`
- monthly：`FORMAT_DATE('%Y-%m-%d', DATE_TRUNC(date, MONTH))`

`metric=creatives_trend` 时改查 creatives 表，每个 `(time, game)` 展开为 4 个 `dimension_value`（`all_creative`/`new_creative`/`all_material`/`new_material`），口径同场景 1（`all_*` 桶内日均、`new_*` 桶内累积）。

渠道占比 timeline 示例（`creative_count_stat_by_channel_percent`，按天分桶；`dimension_values` 为空则分子=全渠道、占比=100%）：

```sql
SELECT time, game_id, dimension_value, g_value AS total_value,
  CASE WHEN total > 0 THEN ROUND(g_value / total, 4) ELSE 0 END AS percentage
FROM (
  SELECT time, game_id, dimension_value, g_value,
    SUM(g_value) OVER (PARTITION BY time, game_id) AS total  -- 分母=全渠道日均之和
  FROM (
    SELECT FORMAT_DATE('%Y-%m-%d', date) AS time, game_id, dimension_value,
      ROUND(SAFE_DIVIDE(SUM(value), COUNT(DISTINCT date)), 0) AS g_value
    FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_stats`
    WHERE game_id IN (<game_ids>)
      AND date >= DATE('<start_date>') AND date <= DATE('<end_date>')
      AND metric = 'creative_count_stat'
    GROUP BY time, game_id, dimension_value
  )
)
-- 有 dimension_values 时在此最外层加筛选（只筛分子，分母仍为全渠道）： WHERE lower(dimension_value) IN ('<dim1>','<dim2>')
ORDER BY time, game_id, total_value DESC;
```

**查数注意点**：
- `engagement_stat`：接口会在每个 `(time, game)` 额外补一条 `dimension_value='engagement_stat'` = 该桶各互动类型之和（view+share+comment+like），表里没有这条，是接口合成的。
- 两个 `*_percent` metric 的占比在 SQL 层算，底层查 `creative_count_stat`；在场景 2 只需把场景 5 的占比 CTE 里 `game_id, dimension_value` 再按 `date_trunc` 加 time 分组（与 `GetAdCreativeStatsTimelineByChannel` / `...ByCompetitor` 一致）。
- 接口可能前推 `start_time` 多画历史点；直接查表用用户区间即可。

**简短后端逻辑小结**：入口 `timeline.go: Timeline → timelineFromCreatives / timelineFromStats`；表函数 `GetAdCreativesMultiTimeline` / `GetAdCreativeStatsTimelineGrouped` / `...ByChannel` / `...ByCompetitor`。

---

## 场景 3：区间多指标汇总数字（sum）

**适合什么场景**：仪表盘 KPI 数字、多 metric 一次拉齐，不要时间序列。

**你会拿它回答什么问题**：这段时间每个游戏的 creative_count / 曝光 / 互动各是多少？（一个数）

**查哪张表**：`intelligence.dwd_aix_gd_analysis_stats`（绝对值类）；四指标走 `intelligence.dwd_aix_gd_analysis_creatives`。

**口径关键**：先按 `(game, metric, dimension_value)` 算维度内日均，再 SUM 到 `(game, metric)`——保证 `sum == Σ(timeline 单桶各 dim) == Σ(dimension_summary 各 dim)`。

```sql
SELECT game_id, metric, SUM(dim_value) AS total_value
FROM (
  SELECT game_id, metric, dimension_value,
    ROUND(SAFE_DIVIDE(SUM(value), COUNT(DISTINCT date)), 0) AS dim_value
  FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_stats`
  WHERE game_id IN (<game_ids>)
    AND date >= DATE('<start_date>') AND date <= DATE('<end_date>')
    AND metric IN ('creative_count_stat','impression_stat')
    -- 可选： AND lower(dimension_value) IN ('admob','applovin')
  GROUP BY game_id, metric, dimension_value
)
GROUP BY game_id, metric;
```

**查数注意点**：
- 为什么「先按 dim 日均再求和」而不是「游戏级 ΣSUM/天数」：各 dim 不一定天天有数据，分母不同会产生整数级偏差；按 dim 算再加和才能和 timeline / dimension_summary 对齐。
- 百分比指标见场景 5。

**简短后端逻辑小结**：入口 `sum.go: Sum → tables.GetAdCreativeStatsSumMulti`（绝对值）/ `GetAdCreativeStatsSumByChannel` / `...ByCompetitor`（占比）。

---

## 场景 4：国家 × 游戏矩阵 / 单游戏国家分布（stats，仅 country_stat）

**适合什么场景**：国家×游戏矩阵表、单游戏国家详情、带环比的国家榜。

**你会拿它回答什么问题**：各国家下这些游戏投放强度如何排名？某游戏在哪些国家更强？

**查哪张表**：`intelligence.dwd_aix_gd_analysis_stats`，`metric='country_stat'`。

```sql
SELECT game_id, dimension_value AS country_alpha3,
  ROUND(SAFE_DIVIDE(SUM(value), COUNT(DISTINCT date)), 0) AS total_value
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_stats`
WHERE game_id IN (<game_ids>)
  AND date >= DATE('<start_date>') AND date <= DATE('<end_date>')
  AND metric = 'country_stat'
  -- 可选筛国家（大写 alpha-3）： AND lower(dimension_value) IN ('usa','jpn')
GROUP BY game_id, dimension_value
ORDER BY game_id, total_value DESC;
```

**查数注意点**：
- `group_by=game_id`：外层游戏 → 内层国家；`group_by=dimension_value`：外层国家 → 内层游戏对比矩阵。两者都是上面这条 SQL 的结果在 Go 层重新组织 + 补零 + 排序。
- 排序：`group_by=dimension_value` 时默认按 `sort_by_dimension='USA'` 那一组的 value 决定游戏顺序，USA 组置顶，其余组按组内 total 降序——这是接口层排序，SQL 只负责出聚合值。
- `display_country_code`（alpha-2，如 `US`）由 `dim_aix_market` 把 alpha-3 映射而来，不在 stats 表里。

**简短后端逻辑小结**：入口 `stats.go: Stats → tables.GetAdCreativeStatsDistribution`；alpha-3→alpha-2 用 `GetMaterialsConfigRegionCountries`。

---

## 场景 5：某指标在各维度值上的拆分 / 占比（dimension_summary）

**适合什么场景**：渠道/类型分布饼图、竞品间占比、无时间轴的维度排行榜。

**你会拿它回答什么问题**：某游戏各渠道创意数多少？各渠道占该游戏总量的比例？竞品间某渠道占比？

**查哪张表**：`intelligence.dwd_aix_gd_analysis_stats`；`metric=creatives_trend` 时 → `intelligence.dwd_aix_gd_analysis_creatives`。

绝对值（如各渠道创意数）：

```sql
SELECT game_id, dimension_value,
  ROUND(SAFE_DIVIDE(SUM(value), COUNT(DISTINCT date)), 0) AS total_value
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_stats`
WHERE game_id IN (<game_ids>)
  AND date >= DATE('<start_date>') AND date <= DATE('<end_date>')
  AND metric = 'creative_count_stat'
GROUP BY game_id, dimension_value
ORDER BY game_id, total_value DESC;
```

占比口径（两种派生 metric，分子分母都从同一份日均派生）：

```sql
-- 渠道占比 by_channel_percent：某渠道日均 / 该游戏全渠道日均之和（同游戏内各渠道相加≈100%）
SELECT game_id, dimension_value, g_value AS total_value,
  CASE WHEN total > 0 THEN ROUND(g_value / total, 4) ELSE 0 END AS percentage
FROM (
  SELECT game_id, dimension_value, g_value,
    SUM(g_value) OVER (PARTITION BY game_id) AS total
  FROM (
    SELECT game_id, dimension_value,
      ROUND(SAFE_DIVIDE(SUM(value), COUNT(DISTINCT date)), 0) AS g_value
    FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_stats`
    WHERE game_id IN (<game_ids>)
      AND date >= DATE('<start_date>') AND date <= DATE('<end_date>')
      AND metric = 'creative_count_stat'          -- 底层固定 creative_count_stat
    GROUP BY game_id, dimension_value
  )
)
ORDER BY game_id, total_value DESC;
```

`by_competitor_percent`（竞品间占比）：把分母换成「同一渠道下所有选中游戏的日均之和」（每个 `dimension_value` 下所有 game 的 percentage 相加 ≈ 1.0）。

占比 metric 始终基于 `creative_count_stat`；`dimension_values` 筛选只作用于分子，分母用全量（保证占比 ≤ 100%）。

**查数注意点**：
- `total_value` 是和 percentage 同源的原始日均值（前端可心算对上）。
- `metric=creatives_trend` 时不查 stats，而是从 creatives 表取 4 指标作为 4 个 `dimension_value`。

**简短后端逻辑小结**：入口 `dimension_summary.go: DimensionSummary → GetAdCreativeStatsDistribution` / `GetAdCreativeStatsDimSummaryByChannel` / `...ByCompetitor`。

---

## 环比（need_link）怎么查

- 按上文「环比时间窗口」表，由 `start_time`、`end_time`、`date_type` 算出 `old_start_date`、`old_end_date`。
- 用与主区间**完全相同**的聚合 SQL，仅替换 `date >= DATE(old_start_date) AND date <= DATE(old_end_date)`。
- 接口返回的 `link_time` 含 `new_start_date` / `new_end_date` / `old_start_date` / `old_end_date`（日期部分），可与手算核对。

示例：overview 四指标 — 新区间 vs 旧区间（`date_type=daily`）：

```sql
-- 新区间（例 2026-05-01 ~ 2026-06-02）
SELECT game_id,
  ROUND(SAFE_DIVIDE(SUM(all_creative), COUNT(DISTINCT date)), 0) AS all_creative,
  ROUND(SUM(new_creative), 0) AS new_creative,
  ROUND(SAFE_DIVIDE(SUM(all_material), COUNT(DISTINCT date)), 0) AS all_material,
  ROUND(SUM(new_material), 0) AS new_material
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_creatives`
WHERE game_id IN (<game_ids>)
  AND date >= DATE('2026-05-01') AND date <= DATE('2026-06-02')
GROUP BY game_id;

-- 旧区间（同上 date_type=daily：dur=32 天 → old_start ≈ 2026-03-29，old_end 日 = 2026-04-30）
SELECT game_id,
  ROUND(SAFE_DIVIDE(SUM(all_creative), COUNT(DISTINCT date)), 0) AS all_creative,
  ROUND(SUM(new_creative), 0) AS new_creative,
  ROUND(SAFE_DIVIDE(SUM(all_material), COUNT(DISTINCT date)), 0) AS all_material,
  ROUND(SUM(new_material), 0) AS new_material
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_creatives`
WHERE game_id IN (<game_ids>)
  AND date >= DATE('<old_start_date>') AND date <= DATE('<old_end_date>')
GROUP BY game_id;
```

示例：stats 类 metric（如 `creative_count_stat`）旧区间：

```sql
SELECT game_id, dimension_value,
  ROUND(SAFE_DIVIDE(SUM(value), COUNT(DISTINCT date)), 0) AS total_value
FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_analysis_stats`
WHERE game_id IN (<game_ids>)
  AND date >= DATE('<old_start_date>') AND date <= DATE('<old_end_date>')
  AND metric = 'creative_count_stat'
GROUP BY game_id, dimension_value;
```

环比变化率由前端或报告层用 `(新−旧)/旧` 计算；底表不存环比百分比字段。

---

## Agent 不可直接（在本两表）查的数据

- 游戏名称 / 图标 / 发行日期 / 品类：不在这两张表，需查 `intelligence.dim_aix_gd_games`（按 `game_id` JOIN）。
- `display_country_code`（alpha-2）/ 国家中英文名：来自 `intelligence.dim_aix_market` 映射，stats 表只有 alpha-3。
- 接口合成字段：overview 的 `max`（各指标跨游戏最大值+对应 game_id）、timeline 的 `engagement_stat` 合计行、stats 的外层排序/置顶/补零、环比无数据时的空占位——这些是 Go 层组装结果，表里没有，可按上面 SQL 自行复算。
- `platform_percent_stat`：表里存在（32 渠道），但 5 个接口的 metric 白名单未开放；直接查表可用，经接口查不到。

---

## 常见误区 / 查不到结果时先看什么

- 把 `new_*` 当存量：`new_creative`/`new_material` 是累积新增（SUM），区间越长越大；`all_*` 才是日均存量。两者别同框比大小。
- 忘了日均除法：绝对值都要 `SAFE_DIVIDE(SUM(value), COUNT(DISTINCT date))`，直接 `SUM(value)` 会得到「区间总和」，和接口对不上。
- 国家用小写/英文名筛：`country_stat` 的 `dimension_value` 是大写 alpha-3（`USA`）；后端比较时 `lower(dimension_value) IN (lower(入参))`，传英文名/全名查不到。
- 渠道大小写：渠道类 `dimension_value` 是小写（`admob`），传 `AdMob` 需注意（接口会 LOWER，直接查表请用小写或 `lower()`）。
- overview 类型分布跨天 SUM：`creative_type_stat` 是快照，overview 只取最新一天；跨区间 SUM 语义不对。
- 占比基于 `creative_count_stat`：两个 `*_percent` 不是独立 metric，底层永远查 `creative_count_stat`。
- 不带 date 区间全扫：两表按月分区，必须给 `game_id IN` + date 范围。
- sum/timeline/dimension_summary 数字对不上：确认都用「先按 dim 日均、再求和」的口径（场景 3 说明）；游戏级整除会有偏差。
