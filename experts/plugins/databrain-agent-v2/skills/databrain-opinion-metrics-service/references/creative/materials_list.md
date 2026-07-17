# materials_list — 素材 / 广告明细列表（/materials/list）

> 本文档面向从「投放素材库」里查**单条条素材/广告**、按类型/平台/渠道/国家/关键词/视频标签筛选、按曝光等指标排 TopN、写报告/解释列表结果。
>
> 单个游戏的总量·趋势·分布·环比·维度 TopN → [single_game.md](single_game.md)；多游戏横向对比 → [multi_game.md](multi_game.md)。
>
> 本模块只围绕一张事实表 `intelligence.dwd_aix_gd_material`（AIX GD 素材明细层，已按最新 `fetch_date` 去重），配套一张维表 `dim_aix_market` 和两张视频标签表（仅按标签筛选时用到）。默认项目 `tencent-databrain-prod`。验证方式：INFORMATION_SCHEMA 查 DDL + 只读抽样（2026-06-03）。
>
> 列表接口本质：按 `group_by`（默认 `creative_id`）把明细行聚合成一行素材，对数值指标做 SUM、对标量做 MAX、对数组做合并去重，再排序分页。

---

## 涉及表

| 数据源 / 表 | 主要用途 | BigQuery 路径 | 分区 / 聚簇 | 备注 |
|---|---|---|---|---|
| 素材明细 | 列表主事实表，所有指标/筛选都打在这里 | `intelligence.dwd_aix_gd_material` | **无分区；CLUSTER BY `game_id`** | 必须用 `game_id` + 投放时间范围缩小扫描；表已按最新 `fetch_date` 去重 |
| 国家维表 | countries（alpha-3 码）→ 英文国家名 | `intelligence.dim_aix_market` | 无 | 后端把列表里的国家码映射成 `country_en`，映射不到时保留原始码 |
| 视频标签明细 | 仅 `search_video_tags` / `has_video_tags` 筛选时用 | `opinion.aix_gd_video_tags_detail` | 无 | 以子查询产出 `video_url` 集合，再回主表过滤 |
| 视频标签类型维表 | 区分 tag / content_summary 标签 | `opinion.dim_aix_gd_video_tags_type` | 无 | 标签筛选只认 `type='tag'` |

> ⚠️ 主表**没有日期分区**（只有 CLUSTER BY `game_id`）。不要写不带 `game_id` 和时间范围的全表 SQL，否则全表扫描成本极高。`game_id` = `edition_unified_id` = `scripts/game_search.py` 输出的 `game_id`。
>
> 注意视频标签两张表在 **`opinion`** schema（不是 intelligence）。

---

## 高频字段 / 关键字段先翻译成人话

- **`start_time` / `end_time`（投放区间交集筛选，不是创建时间）**：二者必填（缺任一返回参数错误）。实际条件是 `last_seen >= start_time AND first_seen <= end_time`——即素材的投放生命周期 `[first_seen, last_seen]` 与查询区间有交集即命中，不是「在区间内首次出现」。一个 2 月就开始、至今仍在投的素材，查 5 月也会被命中。
- **`group_by`（聚合粒度，默认 `creative_id`）**：白名单 `creative_id`（默认）/ `id`（原始行）/ `video_url`。非法值兜底回 `creative_id`。`material_count` 字段 = 该分组键下被合并的原始明细行数。
- **`countries`（国家，存的是大写 alpha-3 码）**：表里 `countries` 是 `ARRAY<STRING>`，存大写 alpha-3（如 `USA`、`ITA`、`POL`）。列表返回前会用 `dim_aix_market` 映射成英文名（`country_en`）；筛选时传 alpha-3 码即可（大小写不敏感，后端 LOWER 比较）。
- **`type`（素材类型）**：实际存值是小写 `video` / `image` / `playable`（注意：表 DDL 里「1-图片/2-视频/3-试玩」的描述已过时，以实际值为准）。筛选大小写不敏感。
- **`os`（平台）**：实际存值 `Android` / `IOS` / `PC`（筛选大小写不敏感，后端 `LOWER(os)` 比较）。
- **`search_text`（关键词，只搜文案）**：模糊匹配 `title` 或 `body`（都 LOWER 后 LIKE `%kw%`），**不搜 tags 标签 / 应用名**。
- **`impression_number`**：`INT64`，可直接聚合。但 `like_count` / `comment_count` / `share_count` / `view_count` / `interaction_count` 在表里是 **`STRING`**，必须 `SAFE_CAST(... AS INT64)` 后再 SUM（否则报错或为空）。
- **`search_video_tags` / `has_video_tags`**：走 `opinion.aix_gd_video_tags_detail` 子查询，只认 `type='tag'`，命中后回主表 `WHERE video_url IN (子查询)`。

---

## 示例 1：某游戏某时间段「在投素材」列表（默认口径）

**回答**：「这个游戏 5 月在投的素材有哪些？各自曝光/互动多少？投了多久？」

**查哪张表**：`intelligence.dwd_aix_gd_material`（单表）。

**查的时候抓住**：
- 必带 `game_id IN (...)`（聚簇键，缩小扫描）。
- 投放区间交集：`last_seen >= <start> AND first_seen <= <end>`。
- 默认按 `creative_id` 聚合；数值指标 SUM，STRING 型指标先 `SAFE_CAST`。
- 默认排序 `impression_number DESC`。

```sql
SELECT
  group_key,                       -- = creative_id（聚合键）
  app_logo, type, os,
  ARRAY_TO_STRING(ARRAY(SELECT DISTINCT c FROM UNNEST(countries_arr) AS c WHERE c IS NOT NULL), ',') AS countries,
  impression_number, like_count, comment_count, share_count, view_count, interaction_count,
  first_seen, last_seen, days, material_count
FROM (
  SELECT
    creative_id AS group_key,
    MAX(cover) AS app_logo,        -- 用 cover 当 logo（表里 app_logo 与情报数据不一致）
    ARRAY_TO_STRING(ARRAY_AGG(DISTINCT type IGNORE NULLS), ',') AS type,
    ARRAY_TO_STRING(ARRAY_AGG(DISTINCT os IGNORE NULLS), ',') AS os,
    ARRAY_CONCAT_AGG(countries) AS countries_arr,
    SUM(SAFE_CAST(impression_number AS INT64)) AS impression_number,
    SUM(SAFE_CAST(like_count AS INT64)) AS like_count,
    SUM(SAFE_CAST(comment_count AS INT64)) AS comment_count,
    SUM(SAFE_CAST(share_count AS INT64)) AS share_count,
    SUM(SAFE_CAST(view_count AS INT64)) AS view_count,
    SUM(SAFE_CAST(interaction_count AS INT64)) AS interaction_count,
    FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', MIN(first_seen)) AS first_seen,
    FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', MAX(last_seen)) AS last_seen,
    MAX(days) AS days,
    COUNT(*) AS material_count
  FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_material`
  WHERE game_id IN (<game_id>)
    AND last_seen >= '<start_time>'   -- 例：'2026-05-01 00:00:00'
    AND first_seen <= '<end_time>'    -- 例：'2026-06-02 23:59:59'
  GROUP BY creative_id
)
ORDER BY impression_number DESC
LIMIT <page_size> OFFSET <offset>;
```

**查数注意点**：
- `countries` 出来是 alpha-3 码（`USA,ITA,...`），要英文名需再 JOIN/映射 `dim_aix_market`（见示例 4）。
- 一个 `game_id` 在表里可能对应多条 `creative_id` / 多平台行；`material_count` 表示该分组下原始行数。
- 切到 `group_by=video_url` 时，`video_url` 直接作为分组键引用（不再 `MAX(video_url)`）。

---

## 示例 2：按类型 / 平台 / 国家 / 关键词过滤

在示例 1 的 WHERE 上叠加过滤段（全部大小写不敏感）：

```sql
-- 素材类型多选（实际值 video/image/playable）
AND LOWER(type) IN ('video','image')
-- 平台多选（实际值 Android/IOS/PC）
AND LOWER(os) IN ('android','ios')
-- 渠道多选
AND LOWER(channel) IN ('applovin','admob')
-- 国家多选：countries 是 ARRAY，用 UNNEST 命中（传 alpha-3）
AND EXISTS (SELECT 1 FROM UNNEST(countries) AS c WHERE LOWER(c) IN ('usa','jpn'))
-- 关键词只搜 title / body
AND (LOWER(title) LIKE '%puzzle%' OR LOWER(body) LIKE '%puzzle%')
-- 曝光量区间（多区间 OR）
AND (impression_number >= 100000 AND impression_number <= 1000000)
-- 活跃天数区间
AND (days >= 30)
```

**查数注意点**：
- `99999` 是前端「全选」哨兵值——筛选数组里含 `99999` 时后端跳过该维度过滤（视为不限）；直接查表时不要把 `99999` 当真实枚举值传进 IN。
- 关键词不要指望命中应用名/标签，它只打 `title`/`body`。

按视频标签筛选（`search_video_tags` / `has_video_tags`）——子查询只认 `type='tag'`，多个关键词之间为 AND（每个词需命中一级或二级标签的任一列）：

```sql
-- 示例：search_video_tags = ['action']，game_ids = ['<game_id>']
SELECT DISTINCT vtd.video_url
FROM `tencent-databrain-prod.opinion.aix_gd_video_tags_detail` AS vtd
LEFT JOIN `tencent-databrain-prod.opinion.dim_aix_gd_video_tags_type` AS dt
  ON dt.game_id = vtd.game_id
  AND (
    (dt.type = 'tag' AND dt.primary_label_en = vtd.primary_label_en AND dt.secondary_label_en = vtd.secondary_label_en)
    OR (dt.type = 'content_summary' AND dt.primary_label_en = vtd.primary_label_en)
  )
WHERE IFNULL(dt.type, 'tag') = 'tag'
  AND vtd.game_id IN (<game_id>)
  AND (
    LOWER(vtd.primary_label_en) LIKE '%action%'
    OR LOWER(vtd.secondary_label_en) LIKE '%action%'
    OR LOWER(vtd.primary_label) LIKE '%action%'
    OR LOWER(vtd.secondary_label) LIKE '%action%'
  );
-- 主查询叠加：AND video_url IN (上述子查询)
-- has_video_tags=true 时子查询改为 INNER JOIN 维表且 dt.type='tag'，不传 search 关键词
```

---

## 示例 3：当前筛选下各指标的最大值（前端条形比例用）

对「分组 SUM 后的每行」再取各指标 MAX：

```sql
SELECT
  MAX(impression_number) AS max_impression_number,
  MAX(like_count) AS max_like_count,
  MAX(view_count) AS max_view_count,
  MAX(interaction_count) AS max_interaction_count
FROM (
  SELECT
    SUM(SAFE_CAST(impression_number AS INT64)) AS impression_number,
    SUM(SAFE_CAST(like_count AS INT64)) AS like_count,
    SUM(SAFE_CAST(view_count AS INT64)) AS view_count,
    SUM(SAFE_CAST(interaction_count AS INT64)) AS interaction_count
  FROM `tencent-databrain-prod.intelligence.dwd_aix_gd_material`
  WHERE game_id IN (<game_id>)
    AND last_seen >= '<start_time>' AND first_seen <= '<end_time>'
  GROUP BY creative_id
);
```

---

## 示例 4：国家码 → 英文名映射

```sql
SELECT DISTINCT country_abbr, country_en
FROM `tencent-databrain-prod.intelligence.dim_aix_market`
WHERE country_abbr IS NOT NULL AND country_abbr != ''
  AND country_en IS NOT NULL AND country_en != '';
-- country_abbr=alpha-3（USA），country_en=英文名（US / United States）；映射不到时列表保留原始 alpha-3
```

---

## 排序字段白名单

`sort_item` 仅支持：`impression_number`（默认）、`first_seen`、`last_seen`、`days`、`material_count`、`view_count`、`like_count`、`comment_count`、`share_count`、`interaction_count`。不在白名单的值会兜底成 `last_seen`。`sort_model` 为 `asc`/`desc`（默认 `desc`）。

---

## Agent 不可直接查的数据（经列表接口形态）

以下不是 BigQuery 里没有，而是列表接口返回形态与底表不一致；Agent 复刻接口展示时需知：

| 内容 | 原因 | 替代方案 |
|---|---|---|
| 列表里的 countries 英文名 | Go 层用 `dim_aix_market` 把 alpha-3 映射为 `country_en` | 主表查 alpha-3，再 JOIN `intelligence.dim_aix_market`（见示例 4） |
| `app_logo` 展示图 | 接口取 `cover` 而非表字段 `app_logo` | SQL 用 `MAX(cover) AS app_logo`（与示例 1 一致） |
| max 各指标全局最大值 | 接口对分组结果再算 MAX，非底表单列 | 用示例 3 SQL |

视频标签明细（`ext_info` 接口）不在 `/materials/list` 正文，但标签筛选子查询所依表均可直接查。

---

## 常见误区 / 查不到结果时先看什么

- 把时间条件当成「创建时间」：实际是投放区间交集（`last_seen >= start AND first_seen <= end`）；查不到时先确认素材投放周期是否真的与你的区间重叠。
- 直接 `SUM(view_count)` 报错/为空：`view_count` 等是 STRING，必须 `SAFE_CAST(... AS INT64)`；只有 `impression_number` 是原生 INT64。
- 国家筛选传英文名：表里存的是 alpha-3 码（`USA`），且是 ARRAY，要用 `UNNEST + LOWER(c) IN (...)`，传英文名查不到。
- 关键词搜不到应用名：`search_text` 只打 `title`/`body`。
- `type` 用 1/2/3 数字：实际值是 `video`/`image`/`playable` 字符串（DDL 描述已过时）。
- 不带 `game_id` 全表扫：表无日期分区，务必用 `game_id` + 时间范围缩小。
- 把 `99999` 当真实枚举：它是前端「全选」占位，后端遇到会跳过该维度，不要直接塞进 IN。

---

## 简短后端逻辑小结（维护者定位用）

- 入口：`controller/gaming_content_trends/materials/list.go → services/gaming_content_trends/materials/list.go: List`
- WHERE 构建：同文件 `BuildMaterialsFilter`（与 `/creative_trends/detail`、`related_creatives` 共用一份口径）
- SQL：`services/tables/bq_dwd_aix_gd_material.go`（`GetMaterialsTotal` / `GetMaterialsList` / `GetMaterialsMax`）
- 并发：list / 国家映射 / max 三路并发，映射与 max 失败降级不阻断主流程
