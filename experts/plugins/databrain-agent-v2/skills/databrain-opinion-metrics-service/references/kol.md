# kol — 网红/KOL 指标（创作者维度）

> ⚠️ **本文档覆盖非直播 KOL/网红场景**：发帖数、活跃 KOL 数、KOL 总观看量、KOL 总互动量、KOL 榜单、KOL 时间趋势、Earned Content 排除合作 KOL。
>
> 直播创作者（Hours Watched / Peak CCV / 主播榜单 / 主播趋势）请去 [streaming.md](streaming.md)。

---

## ⚠️ 2026-05 更新：KOL/网红指标路径拆分（重要！）

业务 UI 上的"网红"指标分布在两个 cube view 里，**底表不同、口径不同**：

| 指标族 | cube view | 物理表 / 路径 | 适用问题 |
|---|---|---|---|
| **网红发帖数** (KOL Publications) | `hotness.kol_publications` | `opinion.public_feeds` + `feeds_author` LEFT JOIN | 「`<游戏>` 在 X 平台的网红发帖数 / KOL 发帖数 / 玩家发帖数（排除官号后）」 |
| **活跃 KOL 数 / KOL 观看量 / KOL 互动量 / KOL 粉丝** | `kol_stats.influencers` / `kol.all_views` / `kol.all_engagement` / `kol.followers` | `opinion.kol` + `base_kol` 4 条硬过滤 | 「`<游戏>` 的活跃网红数 / KOL 总观看量 / KOL 总互动量 / Top N KOL」 |

**关键差异**：
- `opinion.public_feeds` 几乎覆盖所有渠道，**包括 Reddit**
- `opinion.kol` 底表**完全不采集 Reddit**（实测 30 天 0 行 Reddit 数据），cube `base_kol` view 还会再硬过滤 `channel_name != 'reddit'`

**结论**：
- "网红发帖数" 走 hotness 路径 → **支持 Reddit** ✅
- "活跃 KOL 数 / KOL 观看量 / KOL 互动量" 走 KOL 表路径 → **Reddit 一律 0**

---

## 0. 决策树（先看这里再写 SQL）

```
用户问的核心需求
  │
  ├── 包含"官号" / "官方账号" 字眼
  │   → 走 official_account_metrics.md，不是本文档
  │
  ├── "网红发帖数 / KOL 发帖数 / 创作者发帖数 / 玩家发帖数（排除官号后的主帖数）"
  │   → ✅ §2 hotness 路径（public_feeds + feeds_author）
  │
  ├── "活跃 KOL 数 / 网红人数 / 创作者人数（去重计数）"
  │   → ✅ §3 KOL 表路径（opinion.kol + 4 硬过滤）
  │
  ├── "KOL 总观看量 / KOL 总互动量 / KOL 视频观看 / 网红视频播放量"
  │   → ✅ §3 KOL 表路径
  │
  ├── "Top N KOL / 头部 KOL / 哪些网红 / KOL 榜单 / 粉丝最多的网红"
  │   → ✅ §4 KOL 榜单
  │
  ├── "已选 KOL 时间趋势"
  │   → ✅ §5 KOL timeline
  │
  ├── "Earned Content 玩家 UGC（排除官号 + 排除已合作 KOL）"
  │   → ✅ §6 Earned Content（hotness 路径变体）
  │
  └── "直播主播 / Hours Watched / Peak CCV"
      → 走 streaming.md，不是本文档
```

---

## 涉及表

| 表 | 角色 | 过滤键 | 分区/聚簇 |
|---|---|---|---|
| `tencent-databrain-prod.opinion.public_feeds` | **§2 / §6 网红发帖数 / Earned Content 主表** | `unified_edition_id` + `comment_time` 双必带 | VIEW，亿级 |
| `tencent-databrain-prod.opinion.feeds_author` | 官号/合作 KOL 身份维表（LEFT JOIN 反查） | `md5_uin` 关联 `public_feeds.anchor_md5` | 技术分桶 |
| `tencent-databrain-prod.opinion.kol` | **§3 / §4 / §5 KOL 主事实表** | `unified_edition_id` + `date` 双必带 | **PARTITION BY** `DATE_TRUNC(date, MONTH)` · **CLUSTER BY** `unified_edition_id, date` |
| `tencent-databrain-prod.opinion.kol_tag` | KOL 标签补表（`is_partnered` / `tag` join） | `unified_edition_id` + `author_md5` | 无分区 · **CLUSTER BY** `unified_edition_id, author_md5` |

---

## 1. 关键字段对照（两表）

### `opinion.public_feeds`（hotness 路径用）

| 字段 | 说明 |
|---|---|
| `unified_edition_id` | 游戏 ID（聚簇键） |
| `comment_time` | 评论/帖子时间（**UTC+8 / 北京时间**，分区键） |
| `comment_uin` | 评论唯一 ID（去重） |
| `comment_parent_id` | `'-1'` = 主帖；其他 = 子贴/评论 |
| `channel_name` | 渠道真实值（`youtube_keyword` / `twitter` / `tiktok` / `reddit` / ...） |
| `channel_type` | `social` / `comments` / `news` |
| `anchor_md5` | 作者 MD5（关联 `feeds_author.md5_uin`） |

### `opinion.kol`（KOL 表路径用）

| 字段 | 说明 |
|---|---|
| `unified_edition_id` | 游戏 ID（聚簇键） |
| `date` | DATE（分区键，**UTC+8 / 北京时间**） |
| `author_md5` | KOL 唯一 ID |
| `author_name` | KOL 用户名 |
| `author_url` | KOL 主页链接 |
| `channel_name` | 真实值（`youtube_keyword` / `twitter` / `tiktok` / `bilibili` / `instagram` / ...）⚠️ **不采集 Reddit** |
| `language` | KOL 主要语言 |
| `follower_number` | 粉丝数（取最新快照用 `MAX_BY(follower_number, insert_time)`） |
| `posts` | 当日发帖量 |
| `tweets_view` / `tweets_like` / `tweets_reply` / `tweets_retweet` / `tweets_unlike` | 互动量（**负值清洗为 0**） |
| `media_type` | `text` / `image` / `video` / `live` |
| `insert_time` | ETL 入库时间 |

---

## 2. 场景 1：网红发帖数 / KOL 发帖数（hotness 路径）

> 💡 **业务定义**：网红发帖数 = 在社媒平台、排除官号后、当时段内的去重主帖数。等价于 cube `hotness.kol_publications`。

### SQL 模板（单平台）

```sql
SELECT
  COUNT(DISTINCT CASE WHEN f.comment_parent_id='-1' THEN f.comment_uin END) AS kol_posts
FROM `tencent-databrain-prod.opinion.public_feeds` AS f
LEFT JOIN `tencent-databrain-prod.opinion.feeds_author` AS a
  ON f.unified_edition_id = a.game_id
 AND f.anchor_md5 = a.md5_uin
WHERE f.unified_edition_id = '<game_id>'
  AND f.comment_time >= TIMESTAMP('<start_date>')                      -- ⚠️ UTC
  AND f.comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
  AND f.channel_type = 'social'
  AND LOWER(f.channel_name) IN ('<channel_value>')                     -- 见 §1 channel mapping（YouTube → youtube_keyword）
  AND (a.is_official_account IS NULL OR a.is_official_account != 1);   -- 排除官号；LEFT JOIN 未命中视为非官号
```

### 跨平台（按渠道分布）

```sql
SELECT
  LOWER(f.channel_name) AS channel,
  COUNT(DISTINCT CASE WHEN f.comment_parent_id='-1' THEN f.comment_uin END) AS kol_posts
FROM `tencent-databrain-prod.opinion.public_feeds` AS f
LEFT JOIN `tencent-databrain-prod.opinion.feeds_author` AS a
  ON f.unified_edition_id = a.game_id AND f.anchor_md5 = a.md5_uin
WHERE f.unified_edition_id = '<game_id>'
  AND f.comment_time >= TIMESTAMP('<start_date>')
  AND f.comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
  AND f.channel_type = 'social'
  AND (a.is_official_account IS NULL OR a.is_official_account != 1)
GROUP BY channel
ORDER BY kol_posts DESC;
```

### 全平台合计（不分渠道）

去掉 `AND LOWER(f.channel_name) IN (...)`，只保留 `f.channel_type = 'social'`。

### 关键约束

- **必带 `channel_type = 'social'`**：cube `hotness.kol_publications` 在 measure filter 中包含此条件，少了它会把商店评论也算进来
- **`is_official_account` 必须放 ON 子句**（如果想放 WHERE）：本模板把它放在 WHERE 是因为用 `IS NULL OR != 1` 兼容 LEFT JOIN 未命中场景；如果改成 `a.is_official_account = 0`，必须放 ON
- **Reddit 支持**：`public_feeds` 中 `channel_name = 'reddit'` 有数据，所以本路径**完全支持** Reddit 网红发帖数

---

## 3. 场景 2：活跃 KOL 数 / KOL 总观看量 / KOL 总互动量（opinion.kol 表路径）

> 💡 **业务定义**：从 `base_kol` cube view 派生，先在视图层用 4 条硬过滤筛出"合格 KOL"，再做聚合：
> - `LOWER(author_name) != ''`（必须有用户名）
> - `channel_name != ''`（必须有渠道）
> - `LOWER(channel_name) != 'reddit'`（不采集 Reddit）
> - `follower_number > 0`（必须有粉丝）
> - `posts > 0`（必须有发帖）
> - 排除官号 KOL（按 `unified_edition_id + LOWER(author_name)` 反查 `feeds_author.is_official_account=1`）

### 标准 CTE 模板（建议复用）

```sql
WITH kol_filtered AS (
  SELECT k.*
  FROM `tencent-databrain-prod.opinion.kol` AS k
  LEFT JOIN (
    SELECT game_id, LOWER(name) AS name
    FROM `tencent-databrain-prod.opinion.feeds_author`
    WHERE is_official_account = 1
  ) AS f
    ON k.unified_edition_id = f.game_id
   AND LOWER(k.author_name) = f.name
  WHERE k.unified_edition_id = '<game_id>'
    AND k.date BETWEEN DATE('<start_date>') AND DATE('<end_date>')   -- ⚠️ UTC+8 北京时间（today=注入的当前时间(UTC+8)，缺失回退 now_beijing.py；DATE 字面量不加时区参数）
    AND LOWER(k.author_name) != ''
    AND k.channel_name != ''
    AND LOWER(k.channel_name) != 'reddit'   -- Reddit 在 KOL 表中无数据，硬过滤
    AND k.follower_number > 0
    AND f.name IS NULL                       -- 排除官号 KOL
    AND k.posts > 0
    -- 可选：单平台过滤
    AND LOWER(k.channel_name) IN ('<channel_value>')   -- e.g. 'youtube_keyword'
)
SELECT
  COUNT(DISTINCT CONCAT(author_name, '_', channel_name))                       AS active_kol,
  SUM(IF(tweets_view < 0, 0, tweets_view))                                     AS kol_views,
  SUM((CASE WHEN tweets_retweet >= 0 THEN tweets_retweet ELSE 0 END)
    + (CASE WHEN tweets_reply   >= 0 THEN tweets_reply   ELSE 0 END)
    + (CASE WHEN tweets_like    >= 0 THEN tweets_like    ELSE 0 END)
    + COALESCE(CAST(tweets_unlike AS INT64), 0))                               AS kol_engagement,
  SUM(IF(posts < 0, 0, posts))                                                 AS kol_posts_at_kol_table  -- ⚠️ 仅供参考；正式"网红发帖数"指标走 §2 hotness 路径
FROM kol_filtered;
```

### 指标具体公式（与 cube `base_kol` measures 完全对齐）

| 指标 | 公式 | cube measure |
|---|---|---|
| **活跃网红数 (active_kol / influencers)** | `COUNT(DISTINCT CONCAT(author_name, '_', channel_name))` | `kol_stats.influencers` |
| **KOL 总观看量 (kol_views)** | `SUM(IF(tweets_view < 0, 0, tweets_view))` | `kol.all_views` |
| **KOL 总互动量 (kol_engagement)** | 见上 CTE（4 项累加，第 4 项 `COALESCE(CAST(tweets_unlike AS INT64), 0)`） | `kol.all_engagement` |
| **KOL 粉丝数（取最新快照）** | `MAX_BY(follower_number, insert_time)` GROUP BY `author_md5` | `kol.followers` |
| **KOL 条均观看量** | `SAFE_DIVIDE(SUM(tweets_view), SUM(posts))` | `kol.view_per_publication` |

### 跨平台 / 按渠道展开

在 SELECT 加 `LOWER(channel_name) AS channel`，GROUP BY `channel`。

---

## 4. 场景 3：KOL 榜单（Top N KOL by views / posts / engagement / followers）

```sql
WITH kol_filtered AS (
  SELECT k.*
  FROM `tencent-databrain-prod.opinion.kol` AS k
  LEFT JOIN (
    SELECT game_id, LOWER(name) AS name
    FROM `tencent-databrain-prod.opinion.feeds_author`
    WHERE is_official_account = 1
  ) AS f
    ON k.unified_edition_id = f.game_id AND LOWER(k.author_name) = f.name
  WHERE k.unified_edition_id = '<game_id>'
    AND k.date BETWEEN DATE('<start_date>') AND DATE('<end_date>')
    AND LOWER(k.author_name) != '' AND k.channel_name != ''
    AND LOWER(k.channel_name) != 'reddit'
    AND k.follower_number > 0 AND f.name IS NULL AND k.posts > 0
)
SELECT
  MAX_BY(author_name, insert_time)         AS author_name,
  MAX_BY(author_md5, insert_time)          AS author_md5,
  MAX_BY(channel_name, insert_time)        AS channel_name,
  MAX_BY(author_url, insert_time)          AS author_url,
  MAX_BY(language, insert_time)            AS language,
  MAX_BY(follower_number, insert_time)     AS follower_number,
  SUM(posts)                               AS posts,
  SUM(tweets_view)                         AS views,
  SUM((CASE WHEN tweets_retweet >= 0 THEN tweets_retweet ELSE 0 END)
    + (CASE WHEN tweets_reply   >= 0 THEN tweets_reply   ELSE 0 END)
    + (CASE WHEN tweets_like    >= 0 THEN tweets_like    ELSE 0 END)
    + COALESCE(CAST(tweets_unlike AS INT64), 0))                               AS engagements,
  SAFE_DIVIDE(SUM(tweets_view), SUM(posts)) AS view_per_post
FROM kol_filtered
GROUP BY CONCAT(author_name, '_', channel_name)
ORDER BY engagements DESC          -- 或 views DESC / follower_number DESC / posts DESC
LIMIT 10;
```

### 单平台 Top N

WHERE 加 `AND LOWER(k.channel_name) IN ('<channel_value>')`。

---

## 5. 场景 4：已选 KOL 时间趋势

```sql
WITH kol_filtered AS (
  -- 同 §3 / §4 的 CTE，但加 AND k.author_md5 IN ('<md5_1>', '<md5_2>', ...)
  SELECT k.* FROM `tencent-databrain-prod.opinion.kol` AS k
  LEFT JOIN (SELECT game_id, LOWER(name) AS name FROM `tencent-databrain-prod.opinion.feeds_author` WHERE is_official_account = 1) AS f
    ON k.unified_edition_id = f.game_id AND LOWER(k.author_name) = f.name
  WHERE k.unified_edition_id = '<game_id>'
    AND k.date BETWEEN DATE('<start_date>') AND DATE('<end_date>')
    AND LOWER(k.author_name) != '' AND k.channel_name != ''
    AND LOWER(k.channel_name) != 'reddit'
    AND k.follower_number > 0 AND f.name IS NULL AND k.posts > 0
    AND k.author_md5 IN ('<md5_1>', '<md5_2>')
)
SELECT
  FORMAT_DATE('%Y-%m-%d', date) AS time,
  MAX_BY(author_md5, insert_time)         AS author_md5,
  MAX_BY(author_name, insert_time)        AS author_name,
  MAX_BY(follower_number, insert_time)    AS followers,
  SUM(posts)                              AS posts,
  SUM(tweets_view)                        AS views,
  SUM((CASE WHEN tweets_retweet >= 0 THEN tweets_retweet ELSE 0 END)
    + (CASE WHEN tweets_reply   >= 0 THEN tweets_reply   ELSE 0 END)
    + (CASE WHEN tweets_like    >= 0 THEN tweets_like    ELSE 0 END)
    + COALESCE(CAST(tweets_unlike AS INT64), 0))                               AS engagements
FROM kol_filtered
GROUP BY CONCAT(author_name, '_', channel_name), time
ORDER BY time;
```

---

## 6. 场景 5：Earned Content（排除官号 + 可选排除已合作 KOL）

> 💡 **业务定义**：Earned Content = "玩家自发"内容（排除官号 + 排除已合作 KOL）。等价于"网红发帖数"路径再叠加"排除 partnered creators"。

### SQL 模板

```sql
WITH partnered AS (
  SELECT DISTINCT anchor_md5
  FROM `tencent-databrain-prod.opinion.kol_tag`
  WHERE is_partnered = TRUE
    AND unified_edition_id = '<game_id>'
)
SELECT
  COUNT(DISTINCT CASE WHEN f.comment_parent_id='-1' THEN f.comment_uin END)            AS earned_posts,
  COUNT(DISTINCT f.comment_uin)                                                        AS earned_mentions,
  SUM(IF(f.tweets_view<0,0,f.tweets_view))                                             AS earned_views,
  SUM((CASE WHEN f.tweets_retweet >= 0 THEN f.tweets_retweet ELSE 0 END)
    + (CASE WHEN f.tweets_reply   >= 0 THEN f.tweets_reply   ELSE 0 END)
    + (CASE WHEN f.tweets_like    >= 0 THEN f.tweets_like    ELSE 0 END)
    + (CASE WHEN f.tweets_unlike  >= 0 THEN f.tweets_unlike  ELSE 0 END))              AS earned_engagement,
  SUM(CASE WHEN f.follower_number>0 THEN f.follower_number ELSE 0 END)                 AS earned_potential_impressions
FROM `tencent-databrain-prod.opinion.public_feeds` AS f
LEFT JOIN `tencent-databrain-prod.opinion.feeds_author` AS a
  ON f.unified_edition_id = a.game_id
 AND f.anchor_md5 = a.md5_uin
 AND a.is_official_account = 1            -- ⚠️ 必须放 ON 子句
WHERE f.unified_edition_id = '<game_id>'
  AND f.comment_time >= TIMESTAMP('<start_date>')
  AND f.comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
  AND f.channel_type = 'social'
  AND a.md5_uin IS NULL                   -- 未命中官号
  AND f.anchor_md5 NOT IN (SELECT anchor_md5 FROM partnered)  -- 排除已合作 KOL
LIMIT 1;
```

---

## 7. 注意事项 / 已知陷阱

1. **路径选择**：
   - "发帖数" 走 §2 hotness 路径（**支持 Reddit**）
   - "活跃数 / 观看量 / 互动量" 走 §3 KOL 表路径（**不支持 Reddit**）
   - 错路径会导致严重偏差。详见 §0 决策树。

2. **Reddit 不支持的边界**：`opinion.kol` 表中**完全没有** Reddit 数据。如果用户问 "Reddit 上的活跃网红数 / KOL 观看量 / KOL 互动量"，本 skill 无法回答（cube UI 也没有）。如果用户问 "Reddit 网红发帖数"，走 §2 hotness 路径**有数据**。

3. **时区是 UTC+8（北京时间）**：
   - `today` 取注入的当前时间(UTC+8 北京时间日期)，缺失才回退 `python scripts/now_beijing.py`
   - `opinion.kol.date` 是 DATE 类型，直接 `BETWEEN DATE('<start>') AND DATE('<end>')`（字面量按业务语义北京时间整日）
   - `opinion.public_feeds.comment_time` 是 BQ TIMESTAMP 但数据按"北京时间字面量灌库当 UTC"存储，`TIMESTAMP('<date>')` 已等价北京时间整日，**不要加** `'Asia/Shanghai'`，更**不要**用 `CURRENT_TIMESTAMP() / CURRENT_DATE()`（BQ 服务时钟是 UTC，错位最多 8h）

4. **过滤键 `unified_edition_id`**：对多平台游戏（Fortnite/Naraka/Apex/Forza/Diablo/Warframe/HELLDIVERS 2/Dying Light 2/FragPunk 等），舆情数据通常只存在 PC id 下，mobile id 下为空。详见 [auxiliary/id_mapping.md](auxiliary/id_mapping.md)。

5. **互动量负值清洗**：`tweets_*` 字段可能 < 0，必须 `IF(x<0,0,x)` 或 CASE 形式清洗

6. **粉丝数取最新快照**：`MAX_BY(follower_number, insert_time)` GROUP BY `author_md5`，不要 `SUM` 也不要 `MAX`（同一 KOL 在窗口内不同日的粉丝数会重复）

7. **`kol_tag.is_partnered` 可能为 NULL**：用 `COALESCE(t.is_partnered, FALSE)` 兜底，或在 NOT IN 子查询里只取 TRUE

8. **channel_name 真实枚举**（实测 2025-12 数据）：
   - YouTube = `youtube_keyword`（不是 `youtube`）
   - Twitter = `twitter`
   - TikTok = `tiktok`
   - Bilibili = `bilibili`
   - Instagram = `instagram`
   - Facebook = `facebook`
   - Reddit = `reddit`（仅 public_feeds 有；opinion.kol 无）
   - 一律用 `LOWER(channel_name) IN ('<value>')` 列表匹配

9. **不能跨 media_types 混查**（`stream` + 非 `stream`）：返回空成功

10. **`feeds_author` 对单个 `md5_uin` 可能有多条快照**：本文档 §2 / §6 用 `LEFT JOIN ... a.md5_uin IS NULL` 反查，等价"不存在任何 is_official_account=1 的快照"，自然过滤；§3 / §4 / §5 用 `game_id + LOWER(author_name)` 反查官号集合 CTE，CTE 已用 `WHERE is_official_account=1` 收紧。
