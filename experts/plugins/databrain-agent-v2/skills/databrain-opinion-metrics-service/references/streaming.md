# streaming — 直播指标（Hours Watched / Peak CCV / 主播）

> ⚠️ 本文档覆盖**直播**全部场景：游戏级 trends / 主播榜单 / 主播趋势 / 频道维度 / 导出。
>
> 经 BigQuery 全量 SQL 验证（7/7 PASS，2026-04-15）。
>
> 非直播创作者榜单（按 posts / views / engagements 排序）→ [kol.md](kol.md)。

---

## ⚠️ ID 选择（**必读**）

直播表存在 **两套并行** 的物理表：

| 表族 | 过滤键 | 是否需要 join `common.unified_ids` | 推荐度 |
|---|---|---|---|
| **`*_uid` 后缀版**：`game_metric_streamhatchet_stream_uid` / `channel_uid` | `id`（实际是 unified_id） | 不需要 | ⭐ **优先** |
| **原版**：`game_metric_streamhatchet_stream` / `channel` / `kol` / `streamhatchet_sessions` | `app_id`（数字 / 字符串） | ✅ 需要：`WHERE app_id IN (SELECT app_id FROM common.unified_ids WHERE unified_id = '<game_id>')` | 仅当需要 KOL/Sessions 维度 |

### 默认决策：先用 `_uid` 版本

`game_search.py` 输出的 `mobile_id` / `pc_id` / `console_id` 都是 unified_id 形式（u.../e... 前缀），**直接传给 `_uid` 表的 `id` 列即可**，无需 join：

```sql
-- ✅ 推荐：_uid 版本，直接传 mobile_id / pc_id
SELECT date, platform, SUM(hours_watched) AS hoursWatched
FROM `tencent-databrain-prod.intelligence.game_metric_streamhatchet_stream_uid`
WHERE id = '<mobile_id 或 pc_id>'
  AND date BETWEEN DATE('<start_date>') AND DATE('<end_date>')
GROUP BY date, platform
ORDER BY date;
```

### 何时回退到原版表（`app_id` 模式）

下面这些表**没有 `_uid` 版本**，必须经 `common.unified_ids` 转换：

- `intelligence.game_metric_streamhatchet_kol`（直播 KOL 维度）
- `intelligence.streamhatchet_sessions`（场次明细）
- `intelligence.streamhatchet_profile`（主播资料）

```sql
-- ⚠️ 仅在需要 KOL/Sessions/Profile 维度时使用
WHERE app_id IN (
  SELECT app_id
  FROM `tencent-databrain-prod.common.unified_ids`
  WHERE unified_id = '<game_id>' OR edition_id = '<game_id>'
)
```

> 完整 ID 体系决策树和速查见 [auxiliary/id_mapping.md](auxiliary/id_mapping.md)。

---

## 涉及表

| 表 | 角色 | 过滤键 | 分区 / 聚簇 |
|---|---|---|---|
| `intelligence.game_metric_streamhatchet_stream_uid` ⭐ | 游戏级 stream 维度（**优先**） | `id` (= unified_id) + `date` (DATE) | 无分区 · **CLUSTER BY** `date` |
| `intelligence.game_metric_streamhatchet_channel_uid` ⭐ | 游戏级 channel 维度（**优先**） | `id` (= unified_id) + `date` (DATE) | 无分区 · **CLUSTER BY** `date` |
| `intelligence.game_metric_streamhatchet_stream` | 游戏级 stream（app_id 键） | `app_id` + `date` | 无分区 · **CLUSTER BY** `date, app_id` |
| `intelligence.game_metric_streamhatchet_channel` | 游戏×频道×日 | `app_id` + `date` | 无分区 · **CLUSTER BY** `date, app_id` |
| `intelligence.game_metric_streamhatchet_kol` | 游戏×主播×日（**无 _uid 版**） | `app_id` + `date` | 无分区 · **CLUSTER BY** `date, app_id` |
| `intelligence.streamhatchet_sessions` | 场次明细（**无 _uid 版**） | `app_id` + `date`（用于推导 posts） | 无分区 · **CLUSTER BY** `date, app_id` |
| `intelligence.streamhatchet_profile` | 主播资料补表 | `user_id` + `platform`（无 game 键） | 无分区 · **CLUSTER BY** `user_id` |
| `intelligence.streamhatchet_kol_tag` | 直播 KOL 标签（关联 `app_id` + `user_id`） | `app_id` | 无分区 · **CLUSTER BY** `unified_edition_id, user_name` |
| `common.unified_ids` | unified_id ↔ app_id 映射（join 用） | `unified_id` 或 `edition_id` | 技术分桶（`_p_key`）· **CLUSTER BY** `app_id` |
| `opinion.dim_media_account` | 官号识别（仅 `source='channel'` 接口受 officials 影响） | `unified_edition_id` + `category` | VIEW（无分区/聚簇） |

---

## 高频字段

| 字段 | 说明 |
|---|---|
| `hours_watched` | 观看时长（小时） |
| `airtime_hours` | 直播时长（小时） |
| `peak_viewers` | 单场峰值观众；**聚合方式因接口而异**（详见下表） |
| `average_viewers` | 单场平均并发观众；同上 |
| `platform` | 直播平台：`twitch` / `ytg` / `facebook` / `chzzk` / `afreeca` 等。导出阶段会改名：`ytg → youtube`、`afreeca → sooplive` |
| `user_id` / `user_name` | 主播 ID / 用户名 |
| `entity_type` | 直播表也带 `entity_type`，过滤 mobile/pc/console |

### `peakCCV / avgCCV` 聚合口径速查

| 场景 | peakCCV | avgCCV |
|---|---|---|
| `/streaming/trends` total | `MAX(按日汇总后的 peak_viewers)` | `AVG(按日汇总后的 average_viewers)` |
| `/streaming/trends` list | `MAX(按 time+channel 汇总后)` | `AVG(同上)` |
| `/streaming/channel`（主播榜单） | `MAX(peak_viewers)` 按 `user_name` 分组 | `AVG(average_viewers)` 按 `user_name` 分组 |
| `/streaming/channel_trends`（主播 timeline） | `MAX(peak_viewers)` 按 `time+user_id` | **`MAX(average_viewers)`**（不是 AVG！） |
| `/streaming/download`（导出） | `MAX(peak_viewers)` | `MAX(average_viewers)` |

**不要把所有接口都写成同一个 SUM/AVG 口径！**

---

## 0. media_types 分流

- `media_types` 不含 `'stream'` → 走非直播 [kol.md](kol.md)
- `media_types = ['stream']` → 走本文档
- 不支持混传（`stream` + 其他值会直接返回空）

---

## 1. 场景 1：游戏整体直播趋势 + 平台分布（`/streaming/trends`）

### ✅ 优先用 _uid 版本（无需 join）

```sql
-- Total（聚合到一行）
SELECT
  MAX(peak_viewers)     AS peakCCV,
  AVG(average_viewers)  AS avgCCV,
  SUM(hours_watched)    AS hoursWatched,
  SUM(airtime_hours)    AS airtime
FROM (
  SELECT
    date,
    SUM(hours_watched)    AS hours_watched,
    SUM(airtime_hours)    AS airtime_hours,
    SUM(peak_viewers)     AS peak_viewers,
    SUM(average_viewers)  AS average_viewers
  FROM `tencent-databrain-prod.intelligence.game_metric_streamhatchet_stream_uid`
  WHERE id = '<game_id>'   -- 直接传 mobile_id 或 pc_id
    AND date BETWEEN DATE('<start_time>') AND DATE('<end_time>')
  GROUP BY date
);
```

```sql
-- List（按时间×平台分桶）
SELECT
  <time_bucket_sql>      AS time,    -- DATE_TRUNC(date, DAY/WEEK/MONTH) 等
  platform               AS channel,
  MAX(peak_viewers)      AS peakCCV,
  AVG(average_viewers)   AS avgCCV,
  SUM(hours_watched)     AS hoursWatched,
  SUM(airtime_hours)     AS airtime
FROM (
  SELECT
    date, platform,
    SUM(hours_watched)    AS hours_watched,
    SUM(airtime_hours)    AS airtime_hours,
    SUM(peak_viewers)     AS peak_viewers,
    SUM(average_viewers)  AS average_viewers
  FROM `tencent-databrain-prod.intelligence.game_metric_streamhatchet_stream_uid`
  WHERE id = '<game_id>'
    AND date BETWEEN DATE('<list_real_start_time>') AND DATE('<end_time>')
  GROUP BY date, platform
)
GROUP BY time, platform
ORDER BY time;
```

⚠️ **list 实际开始时间比 total 多前退 1 个刻度**：`hourly` 退 1 小时 / `daily` 退 1 天 / `weekly` 退 7 天 / `monthly` 退 1 个月。

### 原版（带 channel + officials 过滤）

如果需要 channel 维度的官号过滤（`source='channel'` + `officials`），需用原版表 + `common.unified_ids`：

```sql
SELECT
  date, platform,
  SUM(hours_watched)    AS hours_watched,
  SUM(peak_viewers)     AS peak_viewers,
  SUM(average_viewers)  AS average_viewers
FROM `tencent-databrain-prod.intelligence.game_metric_streamhatchet_channel`
WHERE app_id IN (
    SELECT app_id
    FROM `tencent-databrain-prod.common.unified_ids`
    WHERE unified_id = '<game_id>' OR edition_id = '<game_id>'
  )
  AND entity_type = '<entity_type>'
  AND date BETWEEN DATE('<start_time>') AND DATE('<end_time>')
  AND user_id <> ''
  AND user_name <> ''
GROUP BY date, platform;
```

---

## 2. 场景 2：某指标最晚有数据的日期（`/streaming/channel_latest_date`）

只忽略**时间过滤**；其他过滤（游戏 / 渠道 / 主播 / officials）都保留。

```sql
SELECT MAX(date) AS latest_date
FROM `tencent-databrain-prod.intelligence.game_metric_streamhatchet_channel`
WHERE app_id IN (
    SELECT app_id
    FROM `tencent-databrain-prod.common.unified_ids`
    WHERE unified_id = '<game_id>' OR edition_id = '<game_id>'
  )
  AND entity_type = '<entity_type>'
  AND user_id <> ''
  AND user_name <> ''
  AND hours_watched > 0;     -- 该指标 > 0 才算"有数据"
```

> 不是"表最新分区日期"，而是"满足当前过滤条件且该指标值大于 0 的最新日期"。

---

## 3. 场景 3：主播榜单（当前窗口 + old 对比，`/streaming/channel`）

⚠️ 只能用原版 `game_metric_streamhatchet_channel`（**对外返回的 `user_id` 是 `app_id`**，但内部过滤用 `c.user_id`，存在口径错位）。

```sql
-- 当前窗口列表
SELECT
  ANY_VALUE(user_id)    AS user_id,
  user_name,
  SUM(hours_watched)    AS hoursWatched,
  SUM(airtime_hours)    AS airtime,
  MAX(peak_viewers)     AS peakCCV,
  AVG(average_viewers)  AS avgCCV
FROM `tencent-databrain-prod.intelligence.game_metric_streamhatchet_channel`
WHERE app_id IN (
    SELECT app_id
    FROM `tencent-databrain-prod.common.unified_ids`
    WHERE unified_id = '<game_id>' OR edition_id = '<game_id>'
  )
  AND entity_type = '<entity_type>'
  AND date BETWEEN DATE('<start_time>') AND DATE('<end_time>')
  AND user_id <> ''
  AND user_name <> ''
  -- 可选：用 anchor_name 模糊搜索
  AND LOWER(user_name) LIKE CONCAT('%', LOWER('<anchor_name>'), '%')
GROUP BY user_name
LIMIT 10000;
```

```sql
-- old 窗口（对比）
SELECT
  ANY_VALUE(user_id)    AS user_id,
  user_name,
  SUM(hours_watched)    AS old_hoursWatched
FROM `tencent-databrain-prod.intelligence.game_metric_streamhatchet_channel`
WHERE app_id IN (
    SELECT app_id
    FROM `tencent-databrain-prod.common.unified_ids`
    WHERE unified_id = '<game_id>' OR edition_id = '<game_id>'
  )
  AND entity_type = '<entity_type>'
  AND date BETWEEN DATE('<old_start_time>') AND DATE('<old_end_time>')
  AND user_id <> ''
  AND user_name <> ''
GROUP BY user_name
LIMIT 1000;
```

⚠️ **当前实现不是严格排序分页榜单**：`sort_item / sort_model / page / page_size` 没真正进入 SQL；当前 topN=10000、old topN=1000、无显式 `ORDER BY`。

---

## 4. 场景 4：指定主播 timeline（`/streaming/channel_trends`）

```sql
SELECT
  <time_bucket_sql>     AS time,
  user_id,
  SUM(hours_watched)    AS hoursWatched,
  SUM(airtime_hours)    AS airtime,
  MAX(peak_viewers)     AS peakCCV,
  MAX(average_viewers)  AS avgCCV    -- 注意是 MAX 不是 AVG（与 channel 接口不同！）
FROM `tencent-databrain-prod.intelligence.game_metric_streamhatchet_channel`
WHERE app_id IN (
    SELECT app_id
    FROM `tencent-databrain-prod.common.unified_ids`
    WHERE unified_id = '<game_id>' OR edition_id = '<game_id>'
  )
  AND entity_type = '<entity_type>'
  AND date BETWEEN DATE('<timeline_start_time>') AND DATE('<end_time>')
  AND user_id IN ('<user_id_1>', '<user_id_2>')
GROUP BY time, user_id
ORDER BY time;
```

⚠️ **timeline 直播侧无 `growth_of_followers`**（仅非直播 timeline 有，详见 [kol.md](kol.md) §3）。

---

## 5. 场景 5：直播主播 KOL 榜单（含 sessions/posts 推导）

直播 KOL 榜单需要 4 张表 join，因为 `posts` 是从 `sessions` 通过 `stream_begins+stream_ends+date+user_name+platform+user_id` 去重推导的：

```sql
WITH session_posts AS (
  SELECT
    date, platform, user_name,
    ARRAY_AGG(DISTINCT CONCAT(
      stream_begins, '_', stream_ends, '_', date, '_', user_name, '_', platform, '_', user_id
    )) AS posts
  FROM `tencent-databrain-prod.intelligence.streamhatchet_sessions`
  WHERE stream_begins IS NOT NULL
  GROUP BY date, platform, user_name
),
creator_base AS (
  SELECT
    LOWER(ANY_VALUE(f.country))             AS country,
    MAX(k.app_id)                           AS app_id,
    ARRAY_AGG(DISTINCT c.user_id)           AS user_ids,
    MAX(c.platform)                         AS platform,
    MAX(c.user_name)                        AS user_name,
    SUM(c.hours_watched)                    AS hoursWatched,
    SUM(c.airtime_hours)                    AS airtime,
    MAX(c.peak_viewers)                     AS peakCCV,
    AVG(c.average_viewers)                  AS avgCCV,
    ARRAY_LENGTH(ARRAY_AGG(DISTINCT post))  AS posts,
    MAX(k.followers)                        AS followers
  FROM `tencent-databrain-prod.intelligence.game_metric_streamhatchet_kol` AS k
  INNER JOIN `tencent-databrain-prod.intelligence.game_metric_streamhatchet_channel` AS c
    ON  LOWER(k.platform)  = LOWER(c.platform)
    AND LOWER(k.user_name) = LOWER(c.user_name)
    AND k.date             = c.date
  INNER JOIN session_posts AS s
    ON  LOWER(c.platform)  = LOWER(s.platform)
    AND LOWER(c.user_name) = LOWER(s.user_name)
    AND c.date             = s.date
  LEFT JOIN `tencent-databrain-prod.intelligence.streamhatchet_profile` AS f
    ON  LOWER(f.platform)  = LOWER(c.platform)
    AND LOWER(f.user_name) = LOWER(c.user_name)
  , UNNEST(s.posts) AS post
  WHERE c.app_id IN (
      SELECT app_id
      FROM `tencent-databrain-prod.common.unified_ids`
      WHERE unified_id = '<game_id>' OR edition_id = '<game_id>'
    )
    AND c.date BETWEEN DATE('<start_date>') AND DATE('<end_date>')
  GROUP BY CONCAT(c.user_name, '_', c.platform)
)
SELECT
  country, user_id, app_id, platform, user_name,
  hoursWatched, airtime, peakCCV, avgCCV, posts, followers
FROM creator_base
LEFT JOIN UNNEST(user_ids) AS user_id
WHERE followers > 0 AND posts > 0
ORDER BY <sort_item> <sort_model>, user_name ASC
LIMIT <page_size> OFFSET <offset>;
```

⚠️ **直播 KOL 榜单口径错位**：
- 对外返回 `user_id = app_id`（接口契约）
- 但内部 `user_infos` 补齐、`ext_tags` 查询、old/old_plus 反查用的是 `c.user_id`
- 列表 SQL 先聚成 creator，再 `UNNEST(user_ids)`：一个 `app_id` 下挂多个 `c.user_id` → `total` 和分页可能被放大

⚠️ **直播 KOL 稳定支持的指标只有**：`posts / followers / hoursWatched / airtime / peakCCV / avgCCV`。不要把非直播的 `views / engagements / likes / comments / shares` 写成直播也支持。

---

### 5.1 排除已合作直播主播（Earned Streaming，对标非直播 Earned Content）

业务定义：分析"自然流量直播主播"时，需要把已与发行 / 公司合作的主播（`is_partnered = TRUE`）排除掉。直播侧用 `intelligence.streamhatchet_kol_tag` 反查（与非直播 `opinion.kol_tag` 同义字段）。

```sql
WITH partnered_streamers AS (
  -- 取该游戏下已合作的直播主播 user_id 集合
  SELECT DISTINCT t.user_id
  FROM `tencent-databrain-prod.intelligence.streamhatchet_kol_tag` AS t
  WHERE t.app_id IN (
      SELECT app_id
      FROM `tencent-databrain-prod.common.unified_ids`
      WHERE unified_id = '<game_id>' OR edition_id = '<game_id>'
    )
    AND t.is_partnered = TRUE
)
SELECT
  ANY_VALUE(c.user_id)   AS user_id,
  c.user_name,
  SUM(c.hours_watched)   AS hoursWatched,
  SUM(c.airtime_hours)   AS airtime,
  MAX(c.peak_viewers)    AS peakCCV,
  AVG(c.average_viewers) AS avgCCV
FROM `tencent-databrain-prod.intelligence.game_metric_streamhatchet_channel` AS c
WHERE c.app_id IN (
    SELECT app_id
    FROM `tencent-databrain-prod.common.unified_ids`
    WHERE unified_id = '<game_id>' OR edition_id = '<game_id>'
  )
  AND c.entity_type = '<entity_type>'
  AND c.date BETWEEN DATE('<start_date>') AND DATE('<end_date>')
  AND c.user_id <> ''
  AND c.user_name <> ''
  -- 排除已合作主播
  AND c.user_id NOT IN (SELECT user_id FROM partnered_streamers)
GROUP BY c.user_name
ORDER BY hoursWatched DESC
LIMIT 100;
```

⚠️ **关键约束**：
- `streamhatchet_kol_tag` 的过滤键是 `app_id`（不是 `unified_edition_id`），必须先经 `common.unified_ids` 转 `app_id`（与原版直播表一致）
- 关联粒度是 `app_id + user_id`（不是 `app_id + user_name`）；`user_name` 可能跨平台重名
- 与非直播 `opinion.kol_tag` 的 `anchor_md5` 不同：直播侧用 `user_id` 关联（直播平台原始账号 ID）
- `is_partnered` 实测类型 = **BOOL**（不是 INT64）；写 `is_partnered = TRUE` 正确，建议用 `is_partnered IS TRUE` 防 NULL 隐式过滤歧义

---

## 6. 场景 6：导出（`/streaming/download`）

```sql
SELECT
  DATE(date)            AS time,
  platform              AS channel,
  SUM(hours_watched)    AS hoursWatched,
  SUM(airtime_hours)    AS airtime,
  MAX(peak_viewers)     AS peakCCV,
  MAX(average_viewers)  AS avgCCV    -- 导出口径用 MAX
FROM `tencent-databrain-prod.intelligence.game_metric_streamhatchet_channel`
WHERE app_id IN (
    SELECT app_id
    FROM `tencent-databrain-prod.common.unified_ids`
    WHERE unified_id = '<game_id>' OR edition_id = '<game_id>'
  )
  AND entity_type = '<entity_type>'
  AND date BETWEEN DATE('<start_time>') AND DATE('<end_time>')
GROUP BY time, channel
ORDER BY time ASC, channel ASC, hoursWatched DESC, airtime DESC;
```

⚠️ **`group_by` 只在 download 生效，且只支持 `date / channel`**。其他 streaming 接口不要写成也支持 group_by。

⚠️ Excel 输出阶段会做展示层改名：`ytg → youtube`、`afreeca → sooplive`（不是底表原值）。

---

## 7. 注意事项 / 已知陷阱

1. **优先用 `_uid` 版本**（`stream_uid` / `channel_uid`），传 unified_id 即可，省一次 join。
2. **`streamhatchet_kol` / `_sessions` / `_profile` 没有 `_uid` 版**：必须经 `common.unified_ids` 转 `app_id`。
3. **`peakCCV / avgCCV` 不同接口聚合口径不同**（详见 §高频字段表）：channel 用 AVG，channel_trends/download 用 MAX。
4. **`/streaming/trends` 的 total 和 list 不是同一时间窗**：list 多前退 1 个刻度。
5. **直播 KOL 接口对外 `user_id = app_id` 但内部用 `c.user_id`**：补齐 / ext_tags / old 反查很容易对不上。
6. **直播 timeline 没有 `growth_of_followers`**：仅 [kol.md](kol.md) 非直播侧实现。
7. **`officials` 不只影响 `/streaming/channel`**：所有 `source='channel'` 且走公共 streaming filter 的接口都受影响（trends / channel_latest_date / channel / channel_trends / download）；`source='stream'` 不受影响。
8. **`sort_item / sort_model / page / page_size` 在 `/streaming/channel` 不进 SQL**：当前是无显式排序 + topN 固定 10000。
9. **`/streaming/channel_latest_date` 只忽略时间过滤**：其他过滤都保留。
10. **`is_recommend` Reddit 默认排除规则不适用直播**（这是 social 侧约束，列在这里防误用）。
