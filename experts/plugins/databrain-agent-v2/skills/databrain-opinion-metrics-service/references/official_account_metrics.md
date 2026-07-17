# official_account_metrics — 官号聚合数字指标

> ⚠️ **路由硬约束（与 [`../SKILL.md`](../SKILL.md) Phase 1.2 顶部红字一致）**
>
> 本文档**仅适用于**"用户**明确**要查官号内容指标 或 **明确**要剔除官号"的**聚合数字答案**。
>
> ## 触发词白名单（必须在用户原文出现至少一个才加载本文档）
>
> - **include 官号侧**：`官号` / `官方账号` / `官方号` / `official account` / `Official Account Tab` / 与指标共现的 `官方`
> - **exclude 官号侧**：`剔除官号` / `排除官号` / `排除官方` / `earned content` / `earned` / `UGC only` / `玩家发的` / 与指标共现的 `玩家声量` / `非官号` / `non-official` / `organic content`
> - **Top N 排名侧**：`Top N 官号` / `头部官号` / `最活跃官号` / `哪些官号`（自带 "官号" 前缀）
>
> ## 反例（**不要走本文档**，走 [`public_feeds.md`](public_feeds.md)）
>
> - 「`<游戏>` 在所有平台 `<日期>` 的互动量」 — 没说官号 → [`public_feeds.md` §4 场景 3](public_feeds.md)
> - 「`<游戏>` 近 7 天的总曝光量/总观看量/总发帖量」 — 没说官号 → [`public_feeds.md` §4 场景 3](public_feeds.md)
> - 「官号发了什么帖子 / 官号最热的 5 条 post / 官号视频列表」 — 要的是**列表 not 数字** → [`public_feeds.md` §5.2](public_feeds.md)
> - 「官号 vs 玩家原话差异 / 官号 vs 玩家话题分布」 — 要的是文本 / topics 分析 → [`public_feeds.md` §7](public_feeds.md)
> - 「网红/KOL 发的内容（不带"官号"字眼）」 — 走 [`kol.md`](kol.md)

---

## ⚠️ 2026-05 更新：底表切换说明

**旧版（已废弃，会导致严重数值偏差）**：用 `public_feeds + feeds_author` A 路 INNER JOIN（3 段 match_key `channel_name_reviewer_source_url`）算官号互动量/转发量/观看量/发帖量。
- 实测偏差：ROBLOX YouTube 官号互动量 = 635,883（A 路），与业务 UI 数值 7,309 偏差 **87 倍**

**新版（本文档基线）**：所有官号**汇总数字指标**改走 **`opinion.media_account_publishing` 物理表**。该表是 cube `official_account_stats` view 的唯一数据源，业务 DataBrain UI 上看到的官号互动/转发/评论/观看/发帖 数字都是从这张表 SUM 出来的。
- 物理表本身已经预聚合了"官号 × 日 × 渠道"维度，**不需要 JOIN 任何官号身份识别表**。

| 指标 | 旧路径 | 新路径 |
|---|---|---|
| 官号互动量 / 转发量 / 评论量 / 点赞量 / 观看量 / 发帖量 | `public_feeds + feeds_author A 路` | **`opinion.media_account_publishing`** ✅ |
| 官号粉丝数 | `media_account_audience` | `media_account_audience`（不变，是唯一例外）✅ |
| 官号发的帖子列表 / 单帖内容 / URL | [`public_feeds.md §5.2`](public_feeds.md) | 不变 |
| Earned Content（剔除官号后的玩家 UGC） | `public_feeds + feeds_author` LEFT JOIN + IS NULL | 不变（详见 §7） |

---

## 涉及表

| 表 | 角色 | 过滤键 | 分区/聚簇 | 用途 |
|---|---|---|---|---|
| `tencent-databrain-prod.opinion.media_account_publishing` | **官号互动/观看/发帖 主事实表** | `unified_edition_id`（物理列名，存的是 unified_id 或 edition_id） | **PARTITION BY** `date` · **CLUSTER BY** `unified_edition_id` | 互动量/观看量/发帖量/转发量/评论量/点赞量 |
| `tencent-databrain-prod.opinion.media_account_audience` | 官号粉丝数快照 | `unified_edition_id` + `date` 双必带 | 同上 | 仅用于**粉丝数指标** |
| `tencent-databrain-prod.opinion.public_feeds` | UGC + 商店 + 全部 feed 主表 | `unified_edition_id` + `comment_time` 双必带 | VIEW，亿级 | **仅 Earned Content（exclude 官号）场景**（§7），互动数字主指标不走这里 |
| `tencent-databrain-prod.opinion.feeds_author` | 官号 / 玩家 身份维表 | INNER/LEFT JOIN 用 `anchor_md5 = md5_uin`（用于 Earned Content） | 技术分桶 | 仅 §7 Earned 用 |

> ⚠️ `media_account_publishing` 的**过滤键物理列名是 `unified_edition_id`**（不是 `game_id`）。该表的 cube 视图层把它命名为 `game_id` 别名，但物理 SQL 必须用 `unified_edition_id`。

---

## 0. 字段速查（`opinion.media_account_publishing`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `unified_edition_id` | STRING | **聚簇过滤键，必带**（u... 手游 / e... PC/console） |
| `date` | DATE | **分区键，必带时间范围**（**UTC+8 / 北京时间**，`today` 取注入的当前时间(UTC+8) 自算字面量（缺失才回退 `now_beijing.py`）；**不要加** `'Asia/Shanghai'` 转换） |
| `channel_name` | STRING | 真实枚举（详见 §1）：YouTube 写 `youtube_keyword`，Twitter 写 `twitter`，TikTok 写 `tiktok`，Reddit 写 `reddit`，中国渠道 `douyin`/`bilibili`/`kuaishou`/`xiaohongshu`/`tieba`/`nga` |
| `channel_type` | STRING | 渠道类型（与 public_feeds 同字段） |
| `account_name` | STRING | 官方账号名称（同一渠道下同一账号一行） |
| `account_type` | STRING | `COOP`（合作官号）/ `IND`（独立官号） |
| `account_url` | STRING | 官号主页 url |
| `country` | STRING | 该官号所属国家（`global` / `jp` / `kr` / `us` / `tw` / `cn` 等） |
| `posts` | INT64 | 当日主帖数 |
| `comments` | INT64 | 当日子帖（评论）数 |
| `tweets_view` | INT64 | 视频/帖子观看数 |
| `tweets_like` | INT64 | 点赞数 |
| `tweets_reply` | INT64 | 评论数 |
| `tweets_retweet` | INT64 | 转发/分享数 |
| `unlike_number` | INT64 | **踩 / dislike 数（互动量 4 项中的第 4 项，⚠️ 不是 `tweets_unlike`）** |
| `like_number` | INT64 | 喜欢数（与 tweets_like 区分，部分渠道用此字段） |
| `insert_time` | TIMESTAMP | ETL 入库时间 |

---

## 1. channel_name 真实枚举（重要）

实测 2025 年 12 月数据，`opinion.media_account_publishing` 中实际出现的 `channel_name`（按出现量降序）：

```
facebook | twitter | instagram | youtube_keyword | tiktok | twitch_keyword
douyin   | vk      | bilibili  | reddit          | kuaishou
bistudio | tieba   | xiaohongshu | nga | pathofexile | funcom forum
bsky     | threads | mirrativ  | 3dm
```

**业务平台 → channel_name 映射规则**：

| 用户问的平台 | SQL 过滤值（`LOWER(channel_name) IN (...)`） |
|---|---|
| YouTube | `('youtube_keyword')` ⚠️ 不是 `youtube`！ |
| Twitch | `('twitch_keyword')` ⚠️ 不是 `twitch`！ |
| Twitter / X | `('twitter')` |
| TikTok | `('tiktok')` |
| Facebook | `('facebook')` |
| Instagram | `('instagram')` |
| Bilibili (B 站) | `('bilibili')` |
| 抖音 (Douyin) | `('douyin')` |
| 快手 (Kuaishou) | `('kuaishou')` |
| 小红书 (Xiaohongshu / RED) | `('xiaohongshu')` |
| 贴吧 (Tieba) | `('tieba')` |
| NGA | `('nga')` |
| Reddit | `('reddit')` |
| VK | `('vk')` |
| Bluesky | `('bsky')` |

> 💡 **统一规则**：所有平台过滤一律用 `LOWER(channel_name) IN ('<具体值>')` 列表匹配。**不要**用 `channel_name = 'youtube'` 等值匹配——`'youtube'` 在 media_account_publishing 中**不存在**任何记录。

---

## 2. 核心指标公式（与 cube `official_account_stats` 完全对齐）

> 所有指标都是 `opinion.media_account_publishing` 字段的直接 `SUM`，**不需要 JOIN feeds_author**。

> ℹ️ **关于 `account_type` / `country` 字段**：物理表里有 `account_type` (`IND` / `COOP`) 和 `country` 两列，但 cube `views/official_account_stats.yml` 与 `cubes/base_media_account_publishing.yml` **均未对其设置任何强制过滤**（含数据团队官方 SQL 抄录中也只是注释保留，未启用）。**本文档所有 §3-§9 SQL 模板与 cube 默认行为对齐：不引入 `account_type` / `country` 过滤**。如需按 country / account_type 切片，请在回答时主动披露分布并由调用方显式追加过滤。

| 中文指标 | 物理字段表达式 | 注释 |
|---|---|---|
| **互动量 (engagement)** | `SUM((CASE WHEN tweets_retweet>=0 THEN tweets_retweet ELSE 0 END) + (CASE WHEN tweets_reply>=0 THEN tweets_reply ELSE 0 END) + (CASE WHEN tweets_like>=0 THEN tweets_like ELSE 0 END) + (CASE WHEN unlike_number>=0 THEN unlike_number ELSE 0 END))` | ⚠️ 第 4 项是 `unlike_number`，**不是** `tweets_unlike` |
| **点赞量 (likes)** | `SUM(IF(tweets_like<0,0,tweets_like))` | |
| **评论量 / 回复数 (replies / comments)** | `SUM(IF(tweets_reply<0,0,tweets_reply))` | |
| **转发量 / 分享量 (retweets / shares)** | `SUM(IF(tweets_retweet<0,0,tweets_retweet))` | |
| **观看量 (views)** | `SUM(IF(tweets_view<0,0,tweets_view))` | |
| **发帖量 (posts)** | `SUM(IF(posts<0,0,posts))` | ⚠️ 直接 SUM(posts)，**不是** COUNT(DISTINCT comment_uin)，物理表本身已经按"官号 × 日 × 渠道"预聚合 |
| **官号数 (accounts)** | `COUNT(DISTINCT CONCAT(LOWER(channel_name),'_',LOWER(account_name)))` | ⚠️ **SKILL 自定义扩展**（cube `base_media_account_publishing.yml` 无此 measure 定义）。按 (channel_name, account_name) 去重 |

> ⚠️ **关键约束**：
> - 互动量第 4 项**必须用 `unlike_number`**（媒体官号物理表字段），**不是** `tweets_unlike`（那是 `public_feeds` 的字段）
> - 互动量必须用 CASE 形式 `SUM((CASE WHEN x>=0 ...) + (CASE WHEN x>=0 ...) + ...)`，**不要**写成 `SUM(IF(x<0,0,x) + IF(x<0,0,x) + ...)`——任一字段 NULL 会让整行变 NULL 被 SUM 跳过、数值偏小
> - 发帖量直接 `SUM(posts)`，**不要** 用 `COUNT(DISTINCT comment_uin)`（那是 public_feeds 的语义）

---

## 3. 场景 1 — 单平台官号聚合指标

### 适合什么问题

- 「`<游戏>` 在 YouTube 近 7 天的**官号互动量**是多少？」
- 「`<游戏>` `<日期>` 在 Twitter 的**官方账号**发帖量 / 观看量 / 评论量 / 转发量」

### SQL 模板

```sql
SELECT
  SUM((CASE WHEN tweets_retweet>=0 THEN tweets_retweet ELSE 0 END) +
      (CASE WHEN tweets_reply  >=0 THEN tweets_reply   ELSE 0 END) +
      (CASE WHEN tweets_like   >=0 THEN tweets_like    ELSE 0 END) +
      (CASE WHEN unlike_number >=0 THEN unlike_number  ELSE 0 END))      AS engagement,
  SUM(IF(tweets_view<0,0,tweets_view))                                   AS views,
  SUM(IF(tweets_reply<0,0,tweets_reply))                                 AS replies,
  SUM(IF(tweets_retweet<0,0,tweets_retweet))                             AS retweets,
  SUM(IF(tweets_like<0,0,tweets_like))                                   AS likes,
  SUM(IF(posts<0,0,posts))                                               AS posts,
  COUNT(DISTINCT CONCAT(LOWER(channel_name),'_',LOWER(account_name)))    AS official_accounts
FROM `tencent-databrain-prod.opinion.media_account_publishing`
WHERE unified_edition_id = '<game_id>'
  AND date BETWEEN DATE('<start_date>') AND DATE('<end_date>')   -- ⚠️ UTC+8 北京时间（today=注入的当前时间(UTC+8)，缺失回退 now_beijing.py；不带 'Asia/Shanghai'）
  AND LOWER(channel_name) IN ('<youtube_keyword 或对应值>')        -- 见 §1 平台映射表
LIMIT 1;
```

### 单日查询写法

如果用户问"`<日期>` 当天"，可以更精简：

```sql
WHERE unified_edition_id = '<game_id>'
  AND date = DATE('<target_date>')
  AND LOWER(channel_name) IN ('<channel_value>')
```

---

## 4. 场景 2 — 跨平台官号聚合（"全平台"/"所有平台"问题）

### 适合什么问题

- 「`<游戏>` `<日期>` **全平台官号互动量** / 转发量 / 评论量 / 观看量」
- 「`<游戏>` 哪个渠道的**官号**最活跃」

### SQL 模板（不带 channel_name filter，按渠道维度展开）

```sql
SELECT
  LOWER(channel_name) AS channel,
  SUM((CASE WHEN tweets_retweet>=0 THEN tweets_retweet ELSE 0 END) +
      (CASE WHEN tweets_reply  >=0 THEN tweets_reply   ELSE 0 END) +
      (CASE WHEN tweets_like   >=0 THEN tweets_like    ELSE 0 END) +
      (CASE WHEN unlike_number >=0 THEN unlike_number  ELSE 0 END))      AS engagement,
  SUM(IF(tweets_view<0,0,tweets_view))                                   AS views,
  SUM(IF(posts<0,0,posts))                                               AS posts,
  COUNT(DISTINCT CONCAT(LOWER(channel_name),'_',LOWER(account_name)))    AS official_accounts
FROM `tencent-databrain-prod.opinion.media_account_publishing`
WHERE unified_edition_id = '<game_id>'
  AND date = DATE('<target_date>')
GROUP BY channel
ORDER BY engagement DESC
LIMIT 30;
```

### 全平台一次拿全 6 个核心数字（推荐：单日 / 短窗口高频用法）

> 适合「`<游戏>` `<日期>` **全平台官号发帖量 / 互动量 / 观看量 / 评论量 / 转发量** 是多少？」这类问题——一次 SQL 拿全 6 个核心数字 + 官号数，避免多次跑表。
>
> ⚠️ 这是 PUBG MOBILE 12-10 全平台官号发帖 bad case 的标准修复模板。

```sql
SELECT
  SUM((CASE WHEN tweets_retweet>=0 THEN tweets_retweet ELSE 0 END) +
      (CASE WHEN tweets_reply  >=0 THEN tweets_reply   ELSE 0 END) +
      (CASE WHEN tweets_like   >=0 THEN tweets_like    ELSE 0 END) +
      (CASE WHEN unlike_number >=0 THEN unlike_number  ELSE 0 END))      AS engagement,
  SUM(IF(tweets_view <0,0,tweets_view))                                  AS views,
  SUM(IF(posts       <0,0,posts))                                        AS posts,
  SUM(IF(tweets_reply<0,0,tweets_reply))                                 AS comments,
  SUM(IF(tweets_retweet<0,0,tweets_retweet))                             AS shares,
  COUNT(DISTINCT CONCAT(LOWER(channel_name),'_',LOWER(account_name)))    AS official_accounts
FROM `tencent-databrain-prod.opinion.media_account_publishing`
WHERE unified_edition_id = '<game_id>'
  AND date = DATE('<target_date>')
LIMIT 1;
```

### 全平台合计（一个数）

```sql
SELECT
  SUM((CASE WHEN tweets_retweet>=0 THEN tweets_retweet ELSE 0 END) +
      (CASE WHEN tweets_reply  >=0 THEN tweets_reply   ELSE 0 END) +
      (CASE WHEN tweets_like   >=0 THEN tweets_like    ELSE 0 END) +
      (CASE WHEN unlike_number >=0 THEN unlike_number  ELSE 0 END))      AS total_engagement
FROM `tencent-databrain-prod.opinion.media_account_publishing`
WHERE unified_edition_id = '<game_id>'
  AND date = DATE('<target_date>');
```

> ⚠️ **多 country 同一渠道下多个官号**：某些游戏（如 Uma Musume / Genshin Impact）会同时有 global 主官号 + jp/kr/cn 等地区分号。cube 默认全部累加。
> - 如果业务答案是"按主官号"或"按特定 country" → 可能要加 `AND country = 'jp'` 等过滤
> - **回答时主动披露 country 分布**，让用户判断口径

---

## 5. 场景 3 — 日趋势（官号 only 时间序列）

```sql
SELECT
  date,
  SUM((CASE WHEN tweets_retweet>=0 THEN tweets_retweet ELSE 0 END) +
      (CASE WHEN tweets_reply  >=0 THEN tweets_reply   ELSE 0 END) +
      (CASE WHEN tweets_like   >=0 THEN tweets_like    ELSE 0 END) +
      (CASE WHEN unlike_number >=0 THEN unlike_number  ELSE 0 END))      AS engagement,
  SUM(IF(tweets_view<0,0,tweets_view))                                   AS views,
  SUM(IF(posts<0,0,posts))                                               AS posts
FROM `tencent-databrain-prod.opinion.media_account_publishing`
WHERE unified_edition_id = '<game_id>'
  AND date BETWEEN DATE('<start_date>') AND DATE('<end_date>')
  AND LOWER(channel_name) IN ('<channel_value>')   -- 可选；省略则跨平台合计
GROUP BY date
ORDER BY date
LIMIT 60;
```

---

## 6. 场景 4 — Top N 官号排名（账号粒度）

### 适合什么问题

- 「`<游戏>` 全平台 **Top 10 官号**是哪些」
- 「`<游戏>` **互动量最高的 5 个官号** + 它们在哪个平台」

```sql
SELECT
  LOWER(channel_name)                                  AS channel,
  account_name,
  ANY_VALUE(account_url)                               AS account_url,
  ANY_VALUE(country)                                   AS country,
  ANY_VALUE(account_type)                              AS account_type,
  SUM((CASE WHEN tweets_retweet>=0 THEN tweets_retweet ELSE 0 END) +
      (CASE WHEN tweets_reply  >=0 THEN tweets_reply   ELSE 0 END) +
      (CASE WHEN tweets_like   >=0 THEN tweets_like    ELSE 0 END) +
      (CASE WHEN unlike_number >=0 THEN unlike_number  ELSE 0 END))      AS engagement,
  SUM(IF(tweets_view<0,0,tweets_view))                                   AS views,
  SUM(IF(posts<0,0,posts))                                               AS posts
FROM `tencent-databrain-prod.opinion.media_account_publishing`
WHERE unified_edition_id = '<game_id>'
  AND date BETWEEN DATE('<start_date>') AND DATE('<end_date>')
GROUP BY channel, account_name
ORDER BY engagement DESC
LIMIT 10;
```

---

## 7. 场景 5 — 粉丝数快照（**唯一保留 `media_account_audience` 的例外指标**）

> ⚠️ **粉丝数指标例外**：互动 / 观看 / 发帖 / 转发 / 评论 / 点赞 都走 `media_account_publishing`，**唯独粉丝数** 不在该表，必须走 `opinion.media_account_audience`。

### 适合什么问题

- 「`<游戏>` 全平台**官号粉丝总数**」
- 「`<游戏>` 哪个平台**官号粉丝**最多 / 增长最快」

```sql
WITH latest AS (
  SELECT
    LOWER(channel_name)                                                 AS channel,
    account_url,
    MAX_BY(account_name, date)                                          AS account_name,
    MAX(CASE WHEN follower_number >= 0 THEN follower_number ELSE 0 END) AS max_followers,
    MAX(date)                                                           AS snapshot_date
  FROM `tencent-databrain-prod.opinion.media_account_audience`
  WHERE unified_edition_id = '<game_id>'
    AND date >= DATE('<today-30>')   -- ⚠️ today=注入的当前时间(UTC+8)，缺失回退 now_beijing.py，再算近 30 天起点
    AND date <= DATE('<today>')
  GROUP BY channel_name, account_url
)
SELECT
  channel,
  SUM(max_followers)  AS total_followers,
  COUNT(*)            AS account_cnt,
  MAX(snapshot_date)  AS max_snapshot_date
FROM latest
GROUP BY channel
ORDER BY total_followers DESC
LIMIT 30;
```

> 关键点：
> - 必须先 `MAX(follower_number) GROUP BY (channel_name, account_url)` 去重每日重复行，否则外层 SUM 按天数膨胀
> - 30 天窗口兜底"最近一次有快照"边界；想严格"今天"用 `INTERVAL 1 DAY`

---

## 8. 场景 6 — Earned Content 聚合（**exclude 官号 = 仅玩家 UGC**）

> ⚠️ **场景 6 是唯一仍走 `public_feeds + feeds_author A 路` 的指标**——因为 `media_account_publishing` 只覆盖官号，要排除官号后聚合 UGC 必须回到 `public_feeds` 全量再 LEFT JOIN feeds_author 反查。

### 适合什么问题

- 「`<游戏>` 近 7 天**剔除官号**后的玩家互动量 / 玩家观看量」
- 「`<游戏>` **Earned Content** 总声量 / 总曝光」
- 「`<游戏>` **非官号 UGC** 发帖量」

### SQL 模板

```sql
SELECT
  SUM((CASE WHEN f.tweets_retweet >= 0 THEN f.tweets_retweet ELSE 0 END) +
      (CASE WHEN f.tweets_reply   >= 0 THEN f.tweets_reply   ELSE 0 END) +
      (CASE WHEN f.tweets_like    >= 0 THEN f.tweets_like    ELSE 0 END) +
      (CASE WHEN f.tweets_unlike  >= 0 THEN f.tweets_unlike  ELSE 0 END))    AS engagement_ugc,
  SUM(IF(f.tweets_view<0,0,f.tweets_view))                                   AS views_ugc,
  SUM(CASE WHEN f.follower_number>0 THEN f.follower_number ELSE 0 END)       AS potential_impressions_ugc,
  COUNT(DISTINCT IF(f.comment_parent_id='-1', f.comment_uin, NULL))          AS posts_ugc,
  COUNT(DISTINCT f.comment_uin)                                              AS mentions_ugc
FROM `tencent-databrain-prod.opinion.public_feeds` AS f
LEFT JOIN `tencent-databrain-prod.opinion.feeds_author` AS a
  ON f.unified_edition_id = a.game_id
 AND f.anchor_md5 = a.md5_uin
 AND a.is_official_account = 1                  -- ⚠️ 必须放 ON 子句
WHERE f.unified_edition_id = '<game_id>'
  AND f.comment_time >= TIMESTAMP('<start_date>')
  AND f.comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
  AND a.md5_uin IS NULL                         -- 没 join 上官号 → 是 UGC
  AND f.channel_type = 'social'                 -- 仅社媒 UGC（商店评论不算 earned content）
LIMIT 1;
```

> ⚠️ **关键陷阱**：`a.is_official_account = 1` **必须放 ON 子句**，**绝不能放 WHERE**。
> - INNER JOIN 路径：放 ON / WHERE 都等价（无差）
> - LEFT JOIN 路径：放 WHERE 把 LEFT 退化成 INNER，`a.md5_uin IS NULL` 永远不成立 → 反而**只剩官号**，与意图完全相反

### 严格版 Earned Content（再排除已合作创作者）

参考 [`auxiliary/social_filter_logic.md §3.1`](auxiliary/social_filter_logic.md) 的 `partnered_creators` CTE，把 `AND f.anchor_md5 NOT IN (SELECT anchor_md5 FROM partnered_creators)` 加进 WHERE。

---

## 9. 场景 7 — 官号 vs 玩家对比（一次聚合两路）

### 适合什么问题

- 「`<游戏>` 近 7 天**官号互动量 vs 玩家互动量**对比」
- 「`<游戏>` 各渠道**官号占比 / Earned 占比**」

### SQL 模板（两条独立 SQL UNION）

```sql
-- 官号侧（走 media_account_publishing）
SELECT
  'official' AS audience,
  LOWER(channel_name) AS channel,
  SUM((CASE WHEN tweets_retweet>=0 THEN tweets_retweet ELSE 0 END) +
      (CASE WHEN tweets_reply  >=0 THEN tweets_reply   ELSE 0 END) +
      (CASE WHEN tweets_like   >=0 THEN tweets_like    ELSE 0 END) +
      (CASE WHEN unlike_number >=0 THEN unlike_number  ELSE 0 END))   AS engagement,
  SUM(IF(tweets_view<0,0,tweets_view))                                AS views,
  SUM(IF(posts<0,0,posts))                                            AS posts
FROM `tencent-databrain-prod.opinion.media_account_publishing`
WHERE unified_edition_id = '<game_id>'
  AND date BETWEEN DATE('<start_date>') AND DATE('<end_date>')
GROUP BY channel

UNION ALL

-- UGC 侧（走 public_feeds LEFT JOIN feeds_author 排除官号）
SELECT
  'ugc' AS audience,
  LOWER(f.channel_name) AS channel,
  SUM((CASE WHEN f.tweets_retweet >= 0 THEN f.tweets_retweet ELSE 0 END) +
      (CASE WHEN f.tweets_reply   >= 0 THEN f.tweets_reply   ELSE 0 END) +
      (CASE WHEN f.tweets_like    >= 0 THEN f.tweets_like    ELSE 0 END) +
      (CASE WHEN f.tweets_unlike  >= 0 THEN f.tweets_unlike  ELSE 0 END))  AS engagement,
  SUM(IF(f.tweets_view<0,0,f.tweets_view))                                 AS views,
  COUNT(DISTINCT IF(f.comment_parent_id='-1', f.comment_uin, NULL))        AS posts
FROM `tencent-databrain-prod.opinion.public_feeds` AS f
LEFT JOIN `tencent-databrain-prod.opinion.feeds_author` AS a
  ON f.unified_edition_id = a.game_id
 AND f.anchor_md5 = a.md5_uin
 AND a.is_official_account = 1
WHERE f.unified_edition_id = '<game_id>'
  AND f.comment_time >= TIMESTAMP('<start_date>')
  AND f.comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
  AND a.md5_uin IS NULL
  AND f.channel_type = 'social'
GROUP BY channel
ORDER BY audience, engagement DESC;
```

---

## 10. 何时走本表 vs 何时走 public_feeds.md（决策树）

```
用户问的核心需求
  │
  ├── 原文出现 "官号 / 官方账号 / official account / Top N 官号" 等 include 触发词
  │   │
  │   ├── 问聚合数字（互动量/观看量/发帖量/转发量/评论量/点赞量）→ ✅ 本文档 §3 / §4 / §5
  │   ├── 问 Top N 官号排名                                     → ✅ 本文档 §6
  │   ├── 问粉丝数                                             → ✅ 本文档 §7（唯一例外，走 media_account_audience）
  │   ├── 问帖子列表 / 单帖详情 / URL                            → 本文档不适用 → public_feeds.md §5.2
  │   └── 问内容文本 / 话题 / 关键词                              → 本文档不适用 → public_feeds.md §7
  │
  ├── 原文出现 "剔除官号 / 排除官号 / Earned / UGC only / 玩家发的" 等 exclude 触发词
  │   → ✅ 本文档 §8（Earned Content 聚合，走 public_feeds + LEFT JOIN feeds_author）
  │
  ├── 原文同时出现 include + exclude（"官号 vs 玩家对比"）
  │   → ✅ 本文档 §9
  │
  ├── 原文未出现任何上述触发词，问的是通用 "互动量/曝光量/观看量/发帖量/创作者数" 聚合数字
  │   → 本文档不适用 → public_feeds.md §4 场景 3（含官号 + UGC 合计）
  │
  └── 用户要的是 "网红/KOL/创作者" 数据（不带"官号"字眼）
      → 本文档不适用 → kol.md
```

---

## 11. 注意事项 / 已知陷阱

1. **路由触发词必带**：本文档**仅**在用户原文出现 §0 触发词白名单之一时加载；用户问"全平台互动量"没说官号 → 必走 `public_feeds.md §4`，**不要**因为本文档里"互动量"出现频繁就误以为本文档是"通用互动量"文档。

2. **时区是 UTC+8（北京时间）**：`today` 取注入的当前时间(UTC+8)，缺失才回退 `python scripts/now_beijing.py`；`opinion.media_account_publishing.date` 比较时用 `DATE('YYYY-MM-DD')` 字面量（从 `today` 自算），**不要加** `'Asia/Shanghai'` 时区参数，更**不要**用 `CURRENT_DATE() / CURRENT_TIMESTAMP() / CURRENT_DATETIME()`（BQ 服务时钟是 UTC，与业务北京时间错位最多 8h，实测偏差可达 23%）。业务 UI 看到的日期就是北京时间。

3. **过滤键物理列名 `unified_edition_id`**：cube 视图里把它别名为 `game_id`，但物理 SQL 必须用 `unified_edition_id`。手游用 unified_id（前缀 `u`），PC/console 用 edition_id（前缀 `e`）。**对存在多平台的游戏**（Fortnite/Naraka/Apex/Forza/Diablo/Warframe/HELLDIVERS 2/Dying Light 2/FragPunk 等），舆情数据通常只存在 PC id 下，mobile id 下为空——详见 [auxiliary/id_mapping.md](auxiliary/id_mapping.md) "PC vs mobile id 决策"。

4. **engagement 第 4 项字段名是 `unlike_number`，不是 `tweets_unlike`**：实测 DDL 如此。`tweets_unlike` 是 `public_feeds` 的字段名，两表字段名不同，**写错就 0 行 / 数值偏小**。

5. **`is_official_account = 1` 必须放 ON 子句**（§8 / §9 LEFT JOIN exclude 路径中）：放 WHERE 会让结果**反向**（变成只剩官号）。

6. **channel_name 真实枚举**：YouTube=`youtube_keyword`，Twitch=`twitch_keyword`，**不存在** `'youtube'` / `'twitch'` 单值。一律用 `LOWER(channel_name) IN ('<value>')` 列表匹配。

7. **多 country 同一渠道下多个官号 (account_name 不同)**：cube `views/official_account_stats.yml` 与 `cubes/base_media_account_publishing.yml` 默认把所有 country / 所有 account_type 累加，**SKILL §3-§9 与 cube 默认行为对齐，不引入 `account_type` / `country` 过滤**。**回答时建议主动披露 country / account_type 分布**让用户判断（少数业务 GT 按"单一 country 主官号"或排除 `COOP × non-global` 等子集计算的边缘场景，可由调用方在追问中显式追加过滤；本 SKILL 不做隐式过滤）。

8. **NULL 兜底 + CASE vs IF**：`tweets_reply` 实测可能为 `-1`（部分渠道）；**互动量 4 项累加必须用 CASE 形式**，写成 `SUM(IF(x<0,0,x) + IF(x<0,0,x) + ...)` 会因任一字段 NULL 让整行变 NULL 被 SUM 跳过；单字段 `SUM(IF(x<0,0,x))` 形式（点赞 / 评论 / 分享 / 观看）则与 CASE 等价。

9. **`opinion.media_account_publishing` 主键去重**：cube primary_key = `CONCAT(unified_edition_id, '-', lower(channel_name), '-', lower(account_name))`。**同一游戏 + 同一渠道 + 同一账号 + 同一日期**应该只有一行；如果发现多行，可能是 ETL 重复入库的脏数据。

10. **采集稳定性**：付费 API 渠道（TikHub 等）稳定，cookie 爬取渠道（部分中国渠道）失效会断采，长期趋势中的"凹陷"有可能是采集侧问题。**对时间范围聚合 / 跨日趋势**类查询，回答时若 `MAX(date)` 早于用户问的窗口尾，要明示数据覆盖度。⚠️ **对单日点查**（X 游戏 在 Y 平台 在 Z 日 的 <metric>），**不允许**用 `MAX(date) < 用户问日期` 推断"未来未入库"——`media_account_publishing` 是事件型稀疏表，没行 = 该日真实未发帖，主答案必须给 `0`，详见 [§12 media_account_publishing 是事件型稀疏表](#12-media_account_publishing-是事件型稀疏表) + [SKILL.md 单日点查严格契约](../SKILL.md#-gt0-全局输出契约-数字-0-是合法答案)。

11. **Phase 4 输出契约**：每次回答必须按 SKILL.md §Phase 4 五件套披露：指标定义 / 时间窗口（**UTC+8 北京时间**）/ 过滤范围（**写明 include 官号 / exclude 官号 / 通用** + 渠道清单）/ 数据覆盖度（`MAX(date)`）/ 采集稳定性。回答末尾必须单独成行："**数据时区：UTC+8（北京时间）**"。

---

## 12. `media_account_publishing` 是事件型稀疏表

> ⚠️ **关键语义说明，影响 GT=0 输出契约**。本节是 [SKILL.md 单日点查严格契约](../SKILL.md#-gt0-全局输出契约-数字-0-是合法答案) 的局部释义。

### 12.1 表语义

`opinion.media_account_publishing` 是**事件型稀疏事实表**（event-driven sparse fact table）：

- 每一行代表一个**事件**："某游戏 × 某官号 × 某日 × 某渠道 当天发了帖（含发帖量 posts、互动量 engagement、观看量 views 等）"
- **当日没发帖事件 = 该游戏 × 该日 × 该渠道无任何行**（不是有行 value=0；不是采集未到；不是未入库）
- 与 `dim_*` 维表（每天必有 1 行）、`public_feeds`（comment_time 连续型）的语义**完全不同**

### 12.2 `MAX(date)` 字段的正确语义

- `MAX(date)` 只反映"目前为止有发帖事件的最近一天"
- **不是**"数据覆盖边界"
- **不允许**用 `MAX(date) < 用户问的日期` 推断"未来日期未入库" —— 这是事实表语义错误

### 12.3 单日点查 GT=0 输出契约（不展开，详见 SKILL.md）

简化版：当用户问「`<游戏>` 在 `<平台>` 在 `<YYYY-MM-DD>` 的 `<指标>` 量」且 SQL 跑出 0 / 空 / NULL 时：

- ✅ 主答案必须是数字 `0`
- 禁止"未入库 / 数据未覆盖 / 暂无记录 / 无入库 / 尚未入库"
- 禁止把 `MAX(date)` 那一天的旧数据塞过来当答案
- 完整规则与输出模板见 [SKILL.md 单日点查严格契约](../SKILL.md#-gt0-全局输出契约-数字-0-是合法答案)
