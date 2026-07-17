# public_feeds — 舆情核心事实表

> ⚠️ **必读**：`opinion.public_feeds` 物理上是 VIEW（自身无 BQ partition / cluster），但底层亿级数据必须**同时**带：
> 1. **等价聚簇过滤**：`WHERE unified_edition_id = '<game_id>'`
> 2. **等价分区过滤**：`AND comment_time >= TIMESTAMP('<start>') AND comment_time < TIMESTAMP('<end>')`
>
> 缺任一个 → 亿级全表扫 + 必然 61001 timeout。详见 [SKILL.md](../SKILL.md) 顶部约束。
>
> ⚠️ **时区是 UTC+8（北京时间）**：`comment_time` 是 BQ TIMESTAMP 类型，但物理表数据按"北京时间字面量灌库当 UTC"存储，直接用 `TIMESTAMP('YYYY-MM-DD')` 字面量（`today` 取注入的当前时间(UTC+8) 自算，缺失才回退 `now_beijing.py`）即等价过滤北京时间整日；**绝对不要加 `'Asia/Shanghai'` 时区参数**（加了反而 -8h 错位）。**禁止**使用 `CURRENT_TIMESTAMP() / CURRENT_DATE() / CURRENT_DATETIME()`（BQ 服务时钟是 UTC，与业务北京时间错位最多 8h，实测 NIKKE 近 5 天声量偏差 23%）。详见 [SKILL.md](../SKILL.md) 顶部 Hard Constraints 时间过滤铁律。

---

## 适用问题

声量 / mentions / 情感 / sentiment / Brand Health / 互动 / 互动率 / 曝光 / 发帖 / 创作者 / 观看 / DoD / WoW / MoM / 玩家原话 / 主帖子帖 / 官号 / 玩家 / Earned 内容 / 热门图文帖 (TrendingPosts) / 热门视频/直播 (TrendingVideo) / 词云 / 上升话题

> KOL 创作者榜单 → [kol.md](kol.md)
> 商店评分 → [stores/](stores/)
> 直播 Hours Watched / Peak CCV → [streaming.md](streaming.md)

---

## 涉及表

- 主表：`tencent-databrain-prod.opinion.public_feeds`（物理 VIEW；业务侧必须按 `comment_time` 等价分区过滤、按 `unified_edition_id` 等价聚簇过滤）
- 关联表：`opinion.feeds_author`（`is_official_account`、`md5_uin` 关联 `anchor_md5`）/ `opinion.kol_tag`（合作创作者标记）/ `opinion.dim_media_account`（官号识别，详见 [auxiliary/social_filter_logic.md](auxiliary/social_filter_logic.md)）/ `opinion.dim_keyword`（关键词监控配置）

---

## 0. 字段速查（最常用）

| 字段 | 类型 | 说明 |
|------|------|------|
| `unified_edition_id` | STRING | **游戏ID（聚簇键，必带）**：unified_id(mobile, u...) 或 edition_id(pc/console, e...) |
| `comment_time` | TIMESTAMP | **帖子/评论时间（UTC+8 / 北京时间，物理表按北京时间字面量灌库）**，分区键，必带时间范围。**直接用 `TIMESTAMP('YYYY-MM-DD')` 字面量**（`today` 取注入的当前时间(UTC+8) 自算，缺失才回退 `now_beijing.py`），不要加 `'Asia/Shanghai'` 时区参数，更不要用 `CURRENT_TIMESTAMP()` |
| `comment_uin` | STRING | 评论唯一ID（去重计数用） |
| `comment_id` | STRING | 当前 feed 的 ID |
| `comment_parent_id` | STRING | `'-1'` = 主帖；其他 = 子贴/评论（=父帖 comment_id） |
| `channel_name` | STRING | **真实底层枚举（实测 2025-12 数据）**：`youtube_keyword`（**不是 `youtube`！**）/ `twitch_keyword` / `twitter` / `tiktok` / `facebook` / `instagram` / `reddit` / `steam` / `bilibili` / `douyin` / `kuaishou` / `xiaohongshu` / `tieba` / `nga` / `'google play'`（**带空格！**）/ `'app store'`（**带空格！**）等。一律用 `LOWER(channel_name) IN ('<value>')` 列表匹配；详见 [auxiliary/dim_tables.md](auxiliary/dim_tables.md)。 |
| `channel_type` | STRING | `social` / `comments` / `news` |
| `country` | STRING | ISO-2 小写，**`'global'` 占 70%+**（详见 [auxiliary/geo_competitor.md](auxiliary/geo_competitor.md)） |
| `language` | STRING | 小写 ISO-2，`'cn'` 用 `IN ('zh','cn')` 兼容旧值 |
| `sentiment_rating` | INTEGER | 1/2 = negative，3 = neutral，4/5 = positive，**-1 = 未打分（必排除）** |
| `isvalid` | INTEGER | 1=medium / 2=high 才是「有效数据」；算 Brand Health 必带 `isvalid IN (1,2)` |
| `tweets_view` / `tweets_like` / `tweets_reply` / `tweets_retweet` / `tweets_unlike` | INTEGER | 互动量字段，**负值要清洗为 0** |
| `follower_number` | INTEGER | 作者粉丝数（`> 0` 才计入曝光） |
| `comment_score` | INTEGER | 商店评论评分（1-5） |
| `is_recommend` | INTEGER | Steam 评论好评标记（`= 1` 好评） |
| `media_type` | STRING | `text` / `image` / `video` / `live`；空字符串当 text |
| `content` / `content_to_en` / `content_to_zh` | STRING | 原文 / 英译 / 中译（NLP 翻译，少数缺失需 `IFNULL` 兜底） |
| `content_url` | STRING | 原文链接 |
| `reviewer` | STRING | 作者用户名 |
| `topics` | ARRAY<STRING> | NLP 话题（**大小写不一致！必须 `UPPER(t)` 归一化**） |
| `keywords` | ARRAY<RECORD> | NLP 关键词（`keywords.value` / `keywords.en` / `keywords.cn`） |
| `sources` | ARRAY<RECORD> | 监控来源（`s.source IN ('account','keyword','levelup','game_store')`，`s.url` / `s.name`） |
| `anchor_md5` | STRING | 作者 MD5（关联 `kol`、`kol_tag`） |

> ⚠️ **`unified_id` / `edition_id` 在 `public_feeds` 已废弃**（schema 标 "请使用 unified_edition_id"）。详见 [auxiliary/id_mapping.md](auxiliary/id_mapping.md)。
>
> ⚠️ **`organization` 字段不存在**：写 `WHERE organization='official'` 报 `Unrecognized name`。要区分官号/玩家请通过 `feeds_author.is_official_account = 1` 反查（match_key 拼接：`LOWER(CONCAT(channel_name,'_',reviewer,'_',source_url))` ↔ `LOWER(CONCAT(source,'_',name,'_',url))`），详见 [auxiliary/social_filter_logic.md](auxiliary/social_filter_logic.md) §3.1。

---

## 1. 核心聚合指标公式

| 指标 | 公式 |
|---|---|
| Mentions | `COUNT(DISTINCT comment_uin)` |
| Positive Mentions | `COUNT(DISTINCT IF(sentiment_rating IN (4,5), comment_uin, NULL))` |
| Neutral Mentions | `COUNT(DISTINCT IF(sentiment_rating = 3, comment_uin, NULL))` |
| Negative Mentions | `COUNT(DISTINCT IF(sentiment_rating IN (1,2), comment_uin, NULL))` |
| Avg Sentiment | `ROUND(SAFE_DIVIDE(5*positive_mentions + 3*neutral_mentions + 1*negative_mentions, mentions), 4)`（加权比；**分母 = `mentions`，包含 `sentiment_rating = -1`**） |
| Positive Rate | `ROUND(SAFE_DIVIDE(positive_mentions, mentions), 4)`（**分母 = `mentions`，含 -1**） |
| Negative Rate | `ROUND(SAFE_DIVIDE(negative_mentions, mentions), 4)`（同上） |
| Engagement | 4 项累加 + 负值清洗，必须 CASE 形式（见下方代码） |
| Engagement Rate | `SAFE_DIVIDE(SUM(engagement), SUM(potential_impressions))` |
| Potential Impressions | `SUM(CASE WHEN follower_number > 0 THEN follower_number ELSE 0 END)`（**严格 > 0**） |
| Views / Shares / Comments / Likes | `SUM(IF(tweets_view < 0, 0, tweets_view))` / 同形对 `tweets_retweet` / `tweets_reply` / `tweets_like` |
| Publications | 主帖去重：`COUNT(DISTINCT CASE WHEN comment_parent_id='-1' AND channel_type='social' THEN comment_uin END)`（⚠️ **必带 `channel_type='social'`** — 与 cube `hotness.publications` 一致；含 video/text 全部社媒主帖，**不含商店评论**） |
| Creators | `COUNT(DISTINCT CASE WHEN comment_parent_id='-1' AND channel_type='social' THEN CONCAT(reviewer,'-',LOWER(channel_name)) END)`（⚠️ **必带 `channel_type='social'`** — 与 cube `hotness.creators` 一致；按 reviewer + channel 去重。❌ **绝不要写成 `COUNT(DISTINCT comment_uin)`**——那是 Mentions/Publications 的"帖子/用户"口径，会把"作者数"算成"帖子数/评论用户数"。术语锚点：用户问 **发帖作者数 / 作者数 / 创作者数 / 博主数 / creators** 一律用本公式） |
| KOL Publications (网红发帖数) | hotness 路径专属：`COUNT(DISTINCT CASE WHEN f.comment_parent_id='-1' AND f.channel_type='social' THEN f.comment_uin END)` + `LEFT JOIN feeds_author a ON f.anchor_md5=a.md5_uin` + `WHERE a.is_official_account IS NULL OR a.is_official_account != 1`（即排除官号主帖；与 cube `hotness.kol_publications` 一致）|
| Official Account Publications (官号发帖数) | hotness 路径：同 KOL Publications 公式，但 `WHERE a.is_official_account = 1`（**ON 子句**）（与 cube `hotness.official_account_publications` 一致）。⚠️ 如果只需要"官号发帖数"这一个数字，**推荐改走** [`official_account_metrics.md`](official_account_metrics.md) §3（用 `media_account_publishing.posts`，数值与本路径偏差较小但 SQL 更短）|
| Steam 好评率 | `SAFE_DIVIDE(steam_recommend_mentions, steam_recommend_mentions + steam_unrecommend_mentions)`，其中 `steam_recommend_mentions = COUNTIF(channel_name='steam' AND channel_type='comments' AND is_recommend=1)`、`steam_unrecommend_mentions = COUNTIF(channel_name='steam' AND channel_type='comments' AND is_recommend=0)`（**分母只算好评+差评，不包含 `is_recommend IS NULL`**） |

> `positive_mentions / neutral_mentions / negative_mentions` 用 `IN (...)` 显式枚举打分值，自然排除 `-1`；而 `mentions / positive_rate / negative_rate / avg_sentiment` 的分母 = `mentions`，**包含未打分样本 `sentiment_rating = -1`**——所以**默认不要在 WHERE 排除 `sentiment_rating = -1`**。

> ### ⚠️ 易混三指标对照：Mentions vs Publications vs Creators（**去重维度不同，写错口径就答错**）
>
> 三者都是"DISTINCT 计数"，极易混用。**关键：`comment_uin` 是"帖子/评论"维度，`reviewer + channel` 才是"作者"维度——作者数 ≠ 帖子数。**
>
> | 指标（中文别名） | 去重表达式 | 额外过滤 | 语义 |
> |---|---|---|---|
> | **Mentions**（声量 / 提及量） | `COUNT(DISTINCT comment_uin)` | 无（全部帖+评论） | 按评论/帖子唯一ID去重 = 声量 |
> | **Publications**（发帖数 / 帖子数） | `COUNT(DISTINCT comment_uin)` | `comment_parent_id='-1' AND channel_type='social'` | 社媒主帖去重 = **帖子数** |
> | **Creators**（发帖作者数 / 作者数 / 创作者数 / 博主数） | `COUNT(DISTINCT CONCAT(reviewer,'-',LOWER(channel_name)))` | `comment_parent_id='-1' AND channel_type='social'` | 按 reviewer+渠道去重 = **作者数** |
>
> 把 **Creators / 发帖作者数 / 作者数** 写成 `COUNT(DISTINCT comment_uin)` 是最常见错误——一个作者一天可发多帖，用 comment_uin 实际数的是"帖子/评论"而非"作者"，与业务 GT 偏差。

### Engagement 标准写法（4 项累加 + 负值清洗，CASE 形式）

```sql
SUM(
  (CASE WHEN tweets_retweet >= 0 THEN tweets_retweet ELSE 0 END) +
  (CASE WHEN tweets_reply   >= 0 THEN tweets_reply   ELSE 0 END) +
  (CASE WHEN tweets_like    >= 0 THEN tweets_like    ELSE 0 END) +
  (CASE WHEN tweets_unlike  >= 0 THEN tweets_unlike  ELSE 0 END)
) AS engagement
-- ⚠️ 不要写成 SUM(IF(x<0,0,x) + IF(x<0,0,x) + ...)：任一字段 NULL 会让整行变 NULL 被 SUM 跳过，数值偏小。
```

### Brand Health 公式（社媒 + 商店双源 + 动态权重 W）

```sql
WITH base AS (
  SELECT
    -- ⚠️ social 子统计必须排除"视频/直播主帖"：与 cube `base_feeds.positive_social/negative_social`
    --    严格对齐——`media_type='video'/'live'` 且 `comment_parent_id='-1'`（即视频主帖）不计入 brand_health。
    --    评论（`comment_parent_id != '-1'`）一律计入；图文/text/空 media_type 主帖也一律计入。
    COUNT(DISTINCT CASE
      WHEN channel_type='social' AND sentiment_rating IN (4,5)
       AND (media_type IN ('','text','image') OR comment_parent_id != '-1')
      THEN comment_uin END) AS pos_s,
    COUNT(DISTINCT CASE
      WHEN channel_type='social' AND sentiment_rating IN (1,2)
       AND (media_type IN ('','text','image') OR comment_parent_id != '-1')
      THEN comment_uin END) AS neg_s,
    COUNT(DISTINCT CASE
      WHEN channel_type='comments' AND sentiment_rating IN (4,5)
      THEN comment_uin END) AS pos_c,
    COUNT(DISTINCT CASE
      WHEN channel_type='comments' AND sentiment_rating IN (1,2)
      THEN comment_uin END) AS neg_c
  FROM `tencent-databrain-prod.opinion.public_feeds`
  WHERE unified_edition_id = '<game_id>'
    AND comment_time >= TIMESTAMP('<start>')
    AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end>'), INTERVAL 1 DAY)
),
w AS (
  SELECT
    pos_s, neg_s, pos_c, neg_c,
    -- 动态权重 W = social 数据量 / store 数据量；缺一边时退化为 0/1
    CASE
      WHEN pos_s + neg_s = 0 THEN 1
      WHEN pos_c + neg_c = 0 THEN 0
      ELSE ROUND(SAFE_DIVIDE(pos_s + neg_s, pos_c + neg_c), 4)
    END AS brand_health_w
  FROM base
)
SELECT
  ROUND(
    SAFE_DIVIDE(
      (pos_s - neg_s) + brand_health_w * (pos_c - neg_c),
      (pos_s + neg_s) + brand_health_w * (pos_c + neg_c)
    ) * 100,
    4
  ) AS brand_health
FROM w;
```

> ⚠️ **重要约束**：
> - **不**在 brand_health 计算里强制 `isvalid IN (1,2)`（如业务侧需要，请单独在 WHERE 加）
> - **不**做 `<= 10 → -99999` 样本兜底（小样本会直接返回小数 / NULL）
> - **必须**用 `COUNT(DISTINCT CASE WHEN ... THEN comment_uin END)` 写法，**不要**用 `COUNTIF(...)`：cube `base_feeds.positive_social/negative_social` 是按 `comment_uin` 去重计数（一个用户一日多帖只算 1）；用 `COUNTIF` 会按行数计偏大
> - **必须**给 social 子统计加 `(media_type IN ('','text','image') OR comment_parent_id != '-1')` 限制；否则会把视频/直播主帖（`media_type='video'/'live'` 且 `comment_parent_id='-1'`）算进来，与 cube 后端口径不一致

### DoD / WoW / MoM

后端拿当前周期值 + 对比周期值，前端按 `(current - previous) / previous * 100` 算。**两值分别一条 SQL 跑**，时间窗收紧到当窗口。

---

## 2. 场景 1：声量 / 情感 趋势

```sql
SELECT
  FORMAT_DATE('%Y-%m-%d', DATE(comment_time)) AS date,
  COUNT(DISTINCT comment_uin)                                                AS mentions,
  COUNT(DISTINCT IF(sentiment_rating IN (4,5), comment_uin, NULL))           AS positive,
  COUNT(DISTINCT IF(sentiment_rating = 3,     comment_uin, NULL))            AS neutral,
  COUNT(DISTINCT IF(sentiment_rating IN (1,2), comment_uin, NULL))           AS negative,
  ROUND(
    SAFE_DIVIDE(
      COUNT(DISTINCT IF(sentiment_rating IN (4,5), comment_uin, NULL)),
      COUNT(DISTINCT comment_uin)                                              -- 分母 = mentions（含 -1）
    ) * 100,
    4
  )                                                                          AS positive_pct
FROM `tencent-databrain-prod.opinion.public_feeds`
WHERE unified_edition_id = '<game_id>'
  AND comment_time >= TIMESTAMP('<start_date>')
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
  -- ⚠️ 默认不要加 `AND sentiment_rating > 0`：positive/negative/avg_sentiment 分母 = mentions（含 -1）。
GROUP BY date
ORDER BY date
LIMIT 1000;
```

---

## 3. 场景 2：Brand Health（社媒+商店双源 + 动态权重）

```sql
WITH base AS (
  SELECT
    -- ⚠️ social 子统计必须排除"视频/直播主帖"（media_type='video'/'live' 且 comment_parent_id='-1'），
    --    与 cube `base_feeds.positive_social/negative_social` 严格对齐；评论一律计入。
    COUNT(DISTINCT CASE
      WHEN channel_type='social' AND sentiment_rating IN (4,5)
       AND (media_type IN ('','text','image') OR comment_parent_id != '-1')
      THEN comment_uin END) AS pos_s,
    COUNT(DISTINCT CASE
      WHEN channel_type='social' AND sentiment_rating IN (1,2)
       AND (media_type IN ('','text','image') OR comment_parent_id != '-1')
      THEN comment_uin END) AS neg_s,
    COUNT(DISTINCT CASE
      WHEN channel_type='comments' AND sentiment_rating IN (4,5)
      THEN comment_uin END) AS pos_c,
    COUNT(DISTINCT CASE
      WHEN channel_type='comments' AND sentiment_rating IN (1,2)
      THEN comment_uin END) AS neg_c
  FROM `tencent-databrain-prod.opinion.public_feeds`
  WHERE unified_edition_id = '<game_id>'
    AND comment_time >= TIMESTAMP('<start_date>')
    AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
  -- ⚠️ brand_health 计算默认不带 `isvalid IN (1,2)` 过滤；若业务侧要求，请在此独立加。
),
w AS (
  SELECT
    pos_s, neg_s, pos_c, neg_c,
    -- 动态权重 W = social / store 量比；缺一边时退化为 0 或 1
    CASE
      WHEN pos_s + neg_s = 0 THEN 1
      WHEN pos_c + neg_c = 0 THEN 0
      ELSE ROUND(SAFE_DIVIDE(pos_s + neg_s, pos_c + neg_c), 4)
    END AS brand_health_w
  FROM base
)
SELECT
  ROUND(
    SAFE_DIVIDE(
      (pos_s - neg_s) + brand_health_w * (pos_c - neg_c),
      (pos_s + neg_s) + brand_health_w * (pos_c + neg_c)
    ) * 100,
    4
  ) AS brand_health
  -- ⚠️ 不做 `<= 10 → -99999` 样本兜底；小样本会直接返回小数 / NULL。
FROM w;
```

---

## 4. 场景 3：Engagement / Impressions / Views / Publications / Creators 一锅查

```sql
SELECT
  COUNT(DISTINCT comment_uin) AS mentions,
  -- Engagement 4 项累加 + 负值清洗（CASE 形式）
  SUM(
    (CASE WHEN tweets_retweet >= 0 THEN tweets_retweet ELSE 0 END) +
    (CASE WHEN tweets_reply   >= 0 THEN tweets_reply   ELSE 0 END) +
    (CASE WHEN tweets_like    >= 0 THEN tweets_like    ELSE 0 END) +
    (CASE WHEN tweets_unlike  >= 0 THEN tweets_unlike  ELSE 0 END)
  ) AS engagement,
  -- Potential Impressions 严格 > 0
  SUM(CASE WHEN follower_number > 0 THEN follower_number ELSE 0 END)  AS potential_impressions,
  -- Views：负值清零
  SUM(IF(tweets_view < 0, 0, tweets_view))                            AS views,
  -- Publications：主帖去重 + 必带 channel_type='social'（与 cube hotness.publications 一致）
  COUNT(DISTINCT CASE WHEN comment_parent_id='-1' AND channel_type='social' THEN comment_uin END)                                AS publications,
  -- Creators：reviewer + channel 去重 + 必带 channel_type='social'（与 cube hotness.creators 一致）
  COUNT(DISTINCT CASE WHEN comment_parent_id='-1' AND channel_type='social' THEN CONCAT(reviewer,'-',LOWER(channel_name)) END)   AS creators
FROM `tencent-databrain-prod.opinion.public_feeds`
WHERE unified_edition_id = '<game_id>'
  AND comment_time >= TIMESTAMP('<start_date>')                       -- ⚠️ UTC
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
LIMIT 1;
```

---

## 5. 场景 4：热门图文帖（TrendingPosts）

页面默认筛选：`channel_type='social'` + `media_type IN ('','text','image')` + `comment_parent_id='-1'`。

> 💡 **业务默认时间窗口：近 7 天**（与 DataBrain TrendingPosts 页面默认行为一致）。用户没指定时间时，`today` 取注入的当前时间(UTC+8)（缺失才回退 `now_beijing.py`），再算 `comment_time >= TIMESTAMP('<today-6>') AND comment_time < TIMESTAMP_ADD(TIMESTAMP('<today>'), INTERVAL 1 DAY)`（右开，含今天全天的 7 天窗口；❌ 不要用 `<= TIMESTAMP('<today>')`，会丢掉今天全部带时刻数据）。

### 5.1 Total Tab（不区分官方/玩家）

```sql
SELECT
  comment_uin, content, content_url, reviewer,
  -- channel_name 仅在 SELECT 投影时聚合成展示名（仍然保留底层枚举如 youtube_keyword 用于 WHERE filter）
  CASE
    WHEN channel_name IN ('twitch_keyword','twitch_live')   THEN 'twitch'
    WHEN channel_name IN ('youtube_keyword','youtube_live') THEN 'youtube'
    WHEN channel_name = 'cafe'                              THEN 'navercafe'
    ELSE channel_name
  END AS channel,
  language, country, comment_time,
  IF(tweets_view < 0, 0, tweets_view) AS views,
  -- per-row engagement，CASE 形式（与 §1 公式一致）
  (CASE WHEN tweets_retweet >= 0 THEN tweets_retweet ELSE 0 END) +
    (CASE WHEN tweets_reply   >= 0 THEN tweets_reply   ELSE 0 END) +
    (CASE WHEN tweets_like    >= 0 THEN tweets_like    ELSE 0 END) +
    (CASE WHEN tweets_unlike  >= 0 THEN tweets_unlike  ELSE 0 END) AS engagement,
  CASE WHEN follower_number > 0 THEN follower_number ELSE 0 END AS subscribe,
  sentiment_rating
FROM `tencent-databrain-prod.opinion.public_feeds`
WHERE unified_edition_id = '<game_id>'
  AND comment_time >= TIMESTAMP('<start_date>')
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
  AND channel_type = 'social'
  AND COALESCE(media_type, '') IN ('', 'text', 'image')
  AND comment_parent_id = '-1'
ORDER BY engagement DESC
LIMIT 50;
```

### 5.2 Official Account Tab（仅官号）

> ⚠️ **如果你要的是「官号聚合指标」（互动量/发帖量/观看量/粉丝数等数字答案），不要走本节模板**——
> 改走 [`official_account_metrics.md`](official_account_metrics.md)，里面用 `opinion.media_account_publishing` / `media_account_audience` 预聚合表，一条 SQL 就能拿到结果。
> 本节只适用于「需要拿出官号**帖子内容/列表/单帖详情**」的场景。
>
> ⚠️ **本节的 A 路和预聚合表都仅覆盖海外渠道**（facebook/twitter/youtube/instagram/tiktok/vk）。
> 用户问 douyin/bilibili/weibo 等中国渠道的官号 → 直接告知数据不覆盖（实测 douyin 7d count=0）。

利用 `feeds_author.is_official_account = 1` 反查（**注意 match_key 拼接规则**：`channel_name + '_' + reviewer + '_' + source_url` vs `feeds_author.source + '_' + name + '_' + url`）：

```sql
WITH official_keys AS (
  SELECT DISTINCT
    LOWER(CONCAT(source, '_', name, '_', url)) AS k
  FROM `tencent-databrain-prod.opinion.feeds_author`
  WHERE is_official_account = 1
)
SELECT f.comment_uin, f.content, f.content_url, f.reviewer, f.channel_name, f.country, f.comment_time
FROM `tencent-databrain-prod.opinion.public_feeds` AS f
JOIN official_keys ok
  ON LOWER(CONCAT(f.channel_name, '_', f.reviewer, '_', f.source_url)) = ok.k
WHERE f.unified_edition_id = '<game_id>'
  AND f.comment_time >= TIMESTAMP('<start_date>')
  AND f.comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
  AND f.channel_type = 'social'
  AND COALESCE(f.media_type, '') IN ('', 'text', 'image')
  AND f.comment_parent_id = '-1'
ORDER BY f.comment_time DESC
LIMIT 50;
```

> 完整官号识别 + 排除合作创作者的 CTE 模板见 [auxiliary/social_filter_logic.md](auxiliary/social_filter_logic.md)。

### 5.3 Earned Content Tab（排除官号 + 可选排除已合作创作者）

```sql
WITH official_keys AS (
  SELECT DISTINCT LOWER(CONCAT(source, '_', name, '_', url)) AS k
  FROM `tencent-databrain-prod.opinion.feeds_author`
  WHERE is_official_account = 1
),
partnered_creators AS (
  SELECT DISTINCT anchor_md5
  FROM `tencent-databrain-prod.opinion.kol_tag`
  WHERE is_partnered = TRUE
    AND unified_edition_id = '<game_id>'
)
SELECT f.comment_uin, f.content, f.content_url, f.reviewer, f.channel_name, f.country, f.comment_time
FROM `tencent-databrain-prod.opinion.public_feeds` AS f
WHERE f.unified_edition_id = '<game_id>'
  AND f.comment_time >= TIMESTAMP('<start_date>')
  AND f.comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
  AND f.channel_type = 'social'
  AND COALESCE(f.media_type, '') IN ('', 'text', 'image')
  AND f.comment_parent_id = '-1'
  -- 排除官号
  AND LOWER(CONCAT(f.channel_name, '_', f.reviewer, '_', f.source_url))
      NOT IN (SELECT k FROM official_keys)
  -- 可选：排除已合作创作者
  AND f.anchor_md5 NOT IN (SELECT anchor_md5 FROM partnered_creators)
ORDER BY (
  (CASE WHEN f.tweets_retweet >= 0 THEN f.tweets_retweet ELSE 0 END) +
  (CASE WHEN f.tweets_reply   >= 0 THEN f.tweets_reply   ELSE 0 END) +
  (CASE WHEN f.tweets_like    >= 0 THEN f.tweets_like    ELSE 0 END) +
  (CASE WHEN f.tweets_unlike  >= 0 THEN f.tweets_unlike  ELSE 0 END)
) DESC
LIMIT 50;
```

---

## 6. 场景 5：热门视频/直播（TrendingVideo）

> ✅ **按具体游戏查视频/视频播放量/视频数/视频互动一律走本场景**——`opinion.public_feeds` 已经把 NLP 关联到 `unified_edition_id`，覆盖 tiktok / youtube / twitter / facebook / reddit / bilibili 全平台。
>
> **不要用 `marketing_hub.marketing_hub_video`** 按游戏 `LIKE '%游戏名%'` 反查——那是行业级表，**无任何 game_id 字段**（详见 [`marketing_hub.md` §场景 7 警告](marketing_hub.md)）。
>
> 关键三件套：`unified_edition_id = '<game_id>'`（聚簇键）+ `comment_time` 范围（分区键）+ `media_type IN ('video','live')`；播放量用 `SUM(IF(tweets_view < 0, 0, tweets_view))`（与 §1 Views 公式一致）。

页面默认筛选：`channel_type='social'` + `media_type IN ('video','live')` + `comment_parent_id='-1'`。

> 💡 **业务默认时间窗口：近 7 天**（与 DataBrain TrendingVideo 页面默认行为一致）。用户没指定时间时，`today` 取注入的当前时间(UTC+8)（缺失才回退 `now_beijing.py`），再算 `comment_time >= TIMESTAMP('<today-6>') AND comment_time < TIMESTAMP_ADD(TIMESTAMP('<today>'), INTERVAL 1 DAY)`（右开，含今天全天；❌ 不要用 `<= TIMESTAMP('<today>')`）。

三个 Tab 与 TrendingPosts 完全相同（Total / Official Account / Earned Content），把 5.x SQL 里的：

```sql
AND COALESCE(media_type, '') IN ('', 'text', 'image')
```

替换为：

```sql
AND media_type IN ('video', 'live')
```

即可。其他完全一致。

> 与 TrendingPosts 的差异：TrendingVideo 不支持 EN/ZH 语言切换、无情感编辑日志覆盖、无 `tweets_reply` 字段单独展示。

---

## 7. 场景 6：玩家原话检索（按关键词 / 话题 / 情感过滤）

### 7.1 关键词搜索（多语言）

```sql
SELECT
  comment_uin, comment_time, channel_name, country, language,
  IFNULL(content_to_en, content) AS content_en,
  content                        AS content_origin,
  content_url, sentiment_rating
FROM `tencent-databrain-prod.opinion.public_feeds`
WHERE unified_edition_id = '<game_id>'
  AND comment_time >= TIMESTAMP('<start_date>')
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
  -- 优先用英文翻译扩大搜索面（中日韩文同时匹配 content_to_zh 更准）
  AND REGEXP_CONTAINS(LOWER(IFNULL(content_to_en, content)), r'\b(monetization|gacha|p2w)\b')
ORDER BY comment_time DESC
LIMIT 100;
```

⚠️ **多语言排除过滤双检陷阱**：用 `IFNULL(content_to_en, content)` 排除中文词时不生效（content_to_en 已翻译为英文）。要分开检查：

```sql
-- BAD：中文排除词在 content_to_en 不生效
AND NOT REGEXP_CONTAINS(LOWER(IFNULL(content_to_en, content)), r'皮肤|联动|skin|collab')

-- ✅ GOOD：英文词查翻译字段，中文词查原文
AND NOT REGEXP_CONTAINS(LOWER(IFNULL(content_to_en, content)), r'\b(skin|collab|crossover)\b')
AND NOT REGEXP_CONTAINS(IFNULL(content, ''),                   r'联动|皮肤|造型')
```

⚠️ **BigQuery RE2 正则限制**：不支持 `(?<!...)` / `(?!...)` lookbehind/lookahead，会报 `invalid perl operator`。用 `\b` 词边界（仅 Latin 有效），中日韩文用本地翻译名（如 `阿塔` / `อาต้า`）匹配 `content_to_zh` 更精准。

⚠️ **61003 关键词规避**：`CALL` / `UPDATE` / `DROP` / `GRANT` / `EXECUTE` 等关键字出现在正则字符串里也会被拦：
- 搜 "Call of Duty" → 用 `'codm'` / `'cod mobile'` / `'warzone'`
- 搜 "patch update" → 用 `'patch notes?'` / `'released'` / `'now live'` / `'version \\d'` / `'v\\d+\\.\\d+'`
- 搜 "price drop" → 用 `'price (cut|reduction|slash)'` / `'discount'`

### 7.2 NLP 话题过滤（**topics 大小写归一化必带**）

```sql
SELECT
  UPPER(t)              AS topic,        -- 必须归一化！否则 'AI' vs 'Ai' 拆两行漏 30-50%
  COUNT(comment_uin)    AS mentions,
  AVG(sentiment_rating) AS avg_sentiment
FROM `tencent-databrain-prod.opinion.public_feeds`,
     UNNEST(topics) AS t
WHERE unified_edition_id = '<game_id>'
  AND comment_time >= TIMESTAMP('<start_date>')
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
  AND sentiment_rating > 0
GROUP BY topic
ORDER BY mentions DESC
LIMIT 50;
```

### 7.3 NLP 关键词词云

```sql
SELECT
  k.value                   AS keyword,
  ANY_VALUE(k.en)           AS keyword_en,    -- 翻译展示
  ANY_VALUE(k.cn)           AS keyword_cn,
  COUNT(comment_uin)        AS count,
  AVG(sentiment_rating)     AS avg_sentiment  -- 极性着色
FROM `tencent-databrain-prod.opinion.public_feeds`,
     UNNEST(keywords) AS k
WHERE unified_edition_id = '<game_id>'
  AND comment_time >= TIMESTAMP('<start_date>')
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
  AND sentiment_rating > 0
GROUP BY keyword
ORDER BY count DESC
LIMIT 200;
```

---

## 8. 场景 7：上升话题 / 上升关键词（当前 vs 上一周期对比）

```sql
WITH curr AS (
  SELECT UPPER(t) AS topic, COUNT(comment_uin) AS curr_count
  FROM `tencent-databrain-prod.opinion.public_feeds`, UNNEST(topics) AS t
  WHERE unified_edition_id = '<game_id>'
    AND comment_time >= TIMESTAMP('<curr_start>')
    AND comment_time <  TIMESTAMP('<curr_end>')
  GROUP BY topic
),
prev AS (
  SELECT UPPER(t) AS topic, COUNT(comment_uin) AS prev_count
  FROM `tencent-databrain-prod.opinion.public_feeds`, UNNEST(topics) AS t
  WHERE unified_edition_id = '<game_id>'
    AND comment_time >= TIMESTAMP('<prev_start>')
    AND comment_time <  TIMESTAMP('<prev_end>')
  GROUP BY topic
)
SELECT
  c.topic, c.curr_count, IFNULL(p.prev_count, 0) AS prev_count,
  -- 旧周期为 0 时给出"+∞"（前端识别），否则按比例
  CASE
    WHEN IFNULL(p.prev_count, 0) = 0 THEN 99999.0
    ELSE SAFE_DIVIDE(c.curr_count - p.prev_count, p.prev_count) * 100
  END AS rise_pct
FROM curr c
LEFT JOIN prev p USING (topic)
ORDER BY rise_pct DESC, c.curr_count DESC
LIMIT 20;
```

---

## 9. 场景 8：维度拆分（按渠道 / 国家 / 语种）

```sql
SELECT
  -- channel_name 仅在 SELECT 投影时聚合成展示名（仍然保留底层枚举如 youtube_keyword 用于 WHERE filter）
  CASE
    WHEN channel_name IN ('twitch_keyword','twitch_live')   THEN 'twitch'
    WHEN channel_name IN ('youtube_keyword','youtube_live') THEN 'youtube'
    WHEN channel_name = 'cafe'                              THEN 'navercafe'
    ELSE channel_name
  END AS channel,
  -- 用 country IN ('<target>','global') 兜住 80%+ 数据，详见 auxiliary/geo_competitor.md
  country,
  language,
  COUNT(DISTINCT comment_uin)                                                AS mentions,
  COUNT(DISTINCT IF(sentiment_rating IN (4,5), comment_uin, NULL))           AS positive,
  COUNT(DISTINCT IF(sentiment_rating IN (1,2), comment_uin, NULL))           AS negative
FROM `tencent-databrain-prod.opinion.public_feeds`
WHERE unified_edition_id = '<game_id>'
  AND comment_time >= TIMESTAMP('<start_date>')
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
GROUP BY channel, country, language
ORDER BY mentions DESC
LIMIT 1000;
```

---

## 10. 注意事项 / 已知陷阱

1. **AoV (Arena of Valor) 的 unified_edition_id `u539c87...` 下，YouTube/TikTok keyword 渠道大量抓到王者荣耀(HOK) 内容**（同 IP 游戏交叉污染）。按英雄名搜索时务必加二次过滤或换中文翻译名匹配 `content_to_zh`。

2. **`country='global'` 占 70%+，YouTube/TikTok 等渠道的 country 大量标 'global'**：按特定国家查时**必须** `country IN ('<target>','global') AND language=...`，否则漏 80%+ 数据。详见 [auxiliary/geo_competitor.md](auxiliary/geo_competitor.md)。

3. **NLP `topics` 大小写不一致**：`'AI'` vs `'Ai'`、`'BUG'` vs `'Bug'` 同时存在。聚合时一律 `UPPER(t)` 或 `LOWER(t)`，不归一化漏 30-50%。

4. **多语言排除过滤双检陷阱**：见 §7.1 中段说明。

5. **BigQuery RE2 正则不支持 lookbehind/lookahead**：用 `\b` 替代（中日韩文需本地翻译名匹配）。

6. **61003 关键词字面量陷阱**：`CALL` / `UPDATE` / `DROP` / `GRANT` 等关键字在正则字符串里也会被拦。规避词见 §7.1。

7. **采集稳定性**：中高优先级官号走 TikHub 付费 API（稳定）；其他靠 cookie 爬取，cookie 失效会断采。**长期趋势中的"凹陷"有可能是采集侧问题，不一定是舆情真实变化**——回答时要带提醒。

8. **`channel_name` 真实底层枚举**（实测 2025-12 数据）：YouTube = `youtube_keyword`（**不是** `youtube`！）；Twitch = `twitch_keyword`（**不是** `twitch`）；其他平台保持字面名：`twitter` / `tiktok` / `facebook` / `instagram` / `bilibili` / `reddit` / `douyin` / `kuaishou` 等；商店渠道带空格：`'google play'` / `'app store'`。**所有平台过滤一律用 `LOWER(channel_name) IN ('<value>')` 列表匹配**，**禁止** `= 'youtube'` 等值匹配——`'youtube'` 在 public_feeds 中**不存在**任何记录。详见 [auxiliary/dim_tables.md](auxiliary/dim_tables.md)。

9. **`sentiment_rating = -1` 表示未打分**：`positive_mentions / neutral_mentions / negative_mentions / positive_rate / negative_rate / avg_sentiment` 都通过 `IN (...)` 显式枚举打分值，自然排除 -1，**分母仍为 `mentions`（含 -1）**，所以**默认不要在 WHERE 加 `sentiment_rating > 0`**。线上实测 `sentiment_rating` 仅出现 1/3/5，写 SQL 仍用区间式（`IN (1,2) / =3 / IN (4,5)`）兼容历史。

10. **Steam 评分双源对账偏差**：`store_score_steam_daily`（官方好评率快照）vs `feeds.is_recommend`（已采集评论好评率）通常差 5-10pp，差异主要来自采集覆盖率。两者同时给时要明示口径。
