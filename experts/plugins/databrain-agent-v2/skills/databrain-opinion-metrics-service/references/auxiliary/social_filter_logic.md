# social_filter_logic — Include/Exclude/官号识别业务逻辑

> 适用：要写「排除官号看 UGC」/「只看官号」/「按 KOL 分类聚合」/「关键词包含/排除」等过滤逻辑时。
>
> 主表：`opinion.public_feeds` + `opinion.feeds_author`（官号身份）+ `opinion.dim_media_account`（监控源配置）+ `opinion.dim_keyword`（关键词配置）+ `opinion.media_account_publishing`（**官号汇总数字事实表**）。
>
> ⚠️ **本文档主要处理「官号识别 + JOIN public_feeds」**——目的是拿出"哪些 feed 来自官号"或"剔除/保留官号 feed"，配合 `public_feeds` 内容字段做帖子级别分析。

---

## ⚠️ 2026-05 更新：官号汇总数字 vs 官号帖子列表 的路径拆分（重要！）

历史版本的 react skill 把"官号互动量/转发量/观看量/发帖量"等汇总数字也用 A 路 `public_feeds + feeds_author JOIN` 算出来——这与业务 DataBrain UI 的 cube 后端口径**严重不一致**（实测偏差 1.x ~ 87 倍）。

**正确路径拆分**：

| 用户需求 | 路径 | 文档 |
|---|---|---|
| **官号互动量 / 转发量 / 观看量 / 发帖量 / 评论量 / 点赞量**（聚合数字） | 走 `opinion.media_account_publishing` 物理表（cube `official_account_stats` 的唯一数据源，**不需 JOIN**） | [`../official_account_metrics.md`](../official_account_metrics.md) §3-§6 |
| **官号粉丝数** | 走 `opinion.media_account_audience` 物理表 | [`../official_account_metrics.md`](../official_account_metrics.md) §7 |
| **官号发的帖子列表 / 单帖详情 / URL** | 走 `public_feeds + feeds_author A 路 JOIN`（本文档 §3.1 / §4） | [`../public_feeds.md`](../public_feeds.md) §5.2 |
| **Earned Content（排除官号后的 UGC 聚合）** | 走 `public_feeds LEFT JOIN feeds_author` + `a.md5_uin IS NULL`（本文档 §3.1 反向） | [`../official_account_metrics.md`](../official_account_metrics.md) §8 |
| **TrendingPosts/Video 的 "Official Account" Tab 展示** | 走 `public_feeds + feeds_author A 路 JOIN`（本文档 §3.1） | [`../public_feeds.md`](../public_feeds.md) §5.2 |

**核心原则**：
- **要数字** → `media_account_publishing`（短路径，预聚合表）
- **要内容 / 帖子明细** → `public_feeds + feeds_author A 路`（长路径，按帖子粒度过滤）

---

## ⚠️ `feeds.organization` 字段不存在！

写 `WHERE organization='official'` / `'player'` 直接报：

```
Unrecognized name: organization
```

要区分「官号 / 玩家」请通过 `feeds_author.is_official_account = 1` 反查（详见下方 §3.1 A 路），**或**直接走 `media_account_publishing`（官号汇总数字）/ Earned Content 路径。

老文档（包括 DataBrain 平台前端的"官号内容 / 玩家内容"分类逻辑）里写的是 `organization` 列，但 BigQuery 实际表 **不存在该字段**。

---

## 0. 两套官号识别机制（A 路 vs B 路，必读）

skill 里官号识别有 **两套并行** 的机制，**拼接规则、来源表、适用场景都不同**，写错就会"匹配率 0% 或匹配错"。

| 机制 | 来源表 | match_key 拼接（feeds 侧） | match_key 拼接（配置侧） | 适用场景 |
|---|---|---|---|---|
| **A 路** | `opinion.feeds_author` | `LOWER(CONCAT(channel_name, '_', reviewer, '_', source_url))` | `LOWER(CONCAT(source, '_', name, '_', url))` 取 `is_official_account = 1` | **前端 Tab 直接展示官号 / TrendingPosts / TrendingVideo Official Account Tab** |
| **B 路** | `opinion.dim_media_account` | `LOWER(CONCAT(s.url, '#_#', s.name))`（基于 `UNNEST(sources) AS s`） | `LOWER(CONCAT(account_url, '#_#', account_name))` 取 `category = 'official-accounts'` | **业务过滤 / monitor source 配置驱动 / Earned Content 排除官号 / 按 category 聚合** |

### 关键差异

1. **分隔符**：A 用 `_`（下划线），B 用 `#_#`（井号下划线井号）—— **写错就 0 行匹配**
2. **拼接顺序**：A 是 `channel + reviewer + url`（3 段），B 是 `url + name`（2 段）—— **顺序不能反**
3. **来源**：A 看 `feeds_author.is_official_account` 这个布尔字段（字段级权威），B 看 `dim_media_account.category='official-accounts'` 这个枚举（业务配置维护）
4. **粒度**：A 直接对 feeds 行做 hash 比对（无需 UNNEST sources），B 走 `UNNEST(sources) AS s` 后比对每条 source

### 优先级建议

> **业务代码事实标准 = A 路**：`tools/opinion/summary_tool_v2.py` 暴露给 LLM 的参数 `is_official_account` 直接读 `feeds_author.is_official_account`；所有「官号 include / exclude」业务路径都用 `feeds_author.is_official_account = 1` 作为唯一识别字段。**没有任何业务代码用 `dim_media_account.category='official-accounts'` 来定义"官号"**。
>
> **B 路 ≠ 官 vs 玩二元划分**：`category` 是 monitor source 配置维度（9 种有效值，见 [dim_tables.md](dim_tables.md) §1），跟 `feeds_author.is_official_account` 不是 1:1 关系。例如 `kol-monitoring` 下的账号 `is_official_account` 既可能 = 1（官方维护的 KOL）也可能 = 0（外部 KOL）。

- **"官号 vs 玩家"二元过滤** → **A 路**（业务事实标准；§3.1 / §4 都用 A 路）
- **要还原 TrendingPosts/Video 的"Official Account" Tab 展示口径** → **A 路**（业务规则就是这样写的）
- **按 monitor source 配置过滤场景**（如 DataBrain 平台配置驱动的 dashboard / 报表，按 category 聚合） → **B 路**（§3.2 / §5）

> 本文档 §3.1 / §4 用 A 路；§3.2 / §5 / §6 用 B 路。TrendingPosts §5.2 / TrendingVideo §6 的 SQL 模板用 **A 路**（详见 [public_feeds.md](../public_feeds.md)）。

---

## 1. 相关表

| 类型 | 表 |
|---|---|
| 主数据 | `tencent-databrain-prod.opinion.public_feeds` |
| 账号配置 | `tencent-databrain-prod.opinion.dim_media_account` |
| 关键词配置 | `tencent-databrain-prod.opinion.dim_keyword` |

`dim_media_account` 的 9 种有效 `category` + `match_key` 拼接规则见 [dim_tables.md](dim_tables.md)。

---

## 2. Monitor Source 基础机制

- `feeds.sources` 是数组结构（每条 feed 可能命中多个 source）
- 过滤时通过 `UNNEST(sources) AS s` 逐条 source 匹配
- **账号维度**通过 `dim_media_account` 做映射：
  - 前端传入：`channel#_#account_name`
  - feeds 匹配：`LOWER(CONCAT(s.url, '#_#', s.name))`
  - 配置映射：`LOWER(CONCAT(account_url, '#_#', account_name))`
- **关键词维度**直接匹配 `LOWER(s.name)` 与 `dim_keyword.keyword`

---

## 3. 排除官号 feeds（**Earned Content** 标准 CTE 模板）

> 业务定义：分析"自然 UGC / 玩家声量"时，需要把官方账号发的内容剔除掉。**官号识别有两套机制**：
>
> - **§3.1 A 路（业务代码事实标准，默认推荐）** — 基于 `feeds_author.is_official_account`
> - **§3.2 B 路（按 monitor source 配置过滤场景）** — 基于 `dim_media_account.category='official-accounts'`
>
> 不确定走哪套 → **优先 §3.1 A 路**（与 `tools/opinion/` 业务代码一致）。

### 3.1 A 路 — 基于 `feeds_author.is_official_account`（**业务事实标准，默认推荐**）

```sql
SELECT f.*
FROM `tencent-databrain-prod.opinion.public_feeds` AS f
LEFT JOIN `tencent-databrain-prod.opinion.feeds_author` AS a
  ON f.unified_edition_id = a.game_id
  AND LOWER(CONCAT(f.channel_name, '_', f.reviewer, '_', f.source_url))
      = LOWER(CONCAT(a.source, '_', a.name, '_', a.url))
  AND a.is_official_account = 1                       -- ⚠️ 必须放 ON 子句内，不能放 WHERE
WHERE f.unified_edition_id = '<game_id>'
  AND f.comment_time >= TIMESTAMP('<start_date>')
  AND f.comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
  AND a.game_id IS NULL                               -- 没 join 上 → 不是官号
ORDER BY (
  (CASE WHEN f.tweets_retweet >= 0 THEN f.tweets_retweet ELSE 0 END) +
  (CASE WHEN f.tweets_reply   >= 0 THEN f.tweets_reply   ELSE 0 END) +
  (CASE WHEN f.tweets_like    >= 0 THEN f.tweets_like    ELSE 0 END) +
  (CASE WHEN f.tweets_unlike  >= 0 THEN f.tweets_unlike  ELSE 0 END)
) DESC
LIMIT 50;
```

⚠️ **关键约束**：
- `a.is_official_account = 1` **必须放 ON 子句内**，不能放 WHERE，否则 LEFT JOIN 退化为 INNER JOIN，反而只剩官号
- match_key 是 **3 段拼接** `channel_name + '_' + reviewer + '_' + source_url`（A 路），分隔符是单个 `_`
- 该 join 模板是「官号 include / exclude」业务路径的统一标准

### 3.2 B 路 — 基于 `dim_media_account.category='official-accounts'`（**按 monitor source 配置过滤场景**）

> ⚠️ 适用场景：**按 DataBrain 平台 monitor source 配置过滤**（如配置驱动的 dashboard / 报表、按 category 聚合）。**不是业务事实"官号 vs 玩家"二元划分** —— 通用 Earned Content 用 §3.1 A 路。
>
> B 路语义：一条 feed 只要有官号 source，即使同时有关键词 source 也认为是官号 feed。所以要先找出官号 feeds 的 `comment_uin`，再用 `NOT IN` 排除。

```sql
WITH official_keys AS (
  -- Step 1: 取官号 match_key 集合
  SELECT DISTINCT
    LOWER(CONCAT(account_url, '#_#', account_name)) AS k
  FROM `tencent-databrain-prod.opinion.dim_media_account`
  WHERE unified_edition_id = '<game_id>'
    AND category = 'official-accounts'              -- 官方运营账号
    AND category != 'string'                        -- 排除脏数据
    AND LOWER(visibility) != 'hidden'
    AND crawler_state = 1
    AND account_name != ''
),
official_feeds AS (
  -- Step 2: 找出命中官号的 feeds 主键集合
  SELECT DISTINCT comment_uin
  FROM `tencent-databrain-prod.opinion.public_feeds`,
       UNNEST(sources) AS s
  JOIN official_keys ok
    ON LOWER(CONCAT(s.url, '#_#', s.name)) = ok.k
  WHERE unified_edition_id = '<game_id>'
    AND comment_time >= TIMESTAMP('<start_date>')
    AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
)
-- Step 3: 主查询排除官号 feeds
SELECT *
FROM `tencent-databrain-prod.opinion.public_feeds` AS f
WHERE f.unified_edition_id = '<game_id>'
  AND f.comment_time >= TIMESTAMP('<start_date>')
  AND f.comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
  AND f.comment_uin NOT IN (SELECT comment_uin FROM official_feeds)
ORDER BY (
  IF(f.tweets_retweet<0,0,f.tweets_retweet) +
  IF(f.tweets_reply  <0,0,f.tweets_reply)   +
  IF(f.tweets_like   <0,0,f.tweets_like)
) DESC
LIMIT 50;
```

> 进一步排除已合作创作者（Earned Content 严格版）见 [public_feeds.md](../public_feeds.md) §5.3。

---

## 4. 只看官号 feeds（**Official Account** Tab）

**用 A 路** —— `feeds_author.is_official_account = 1` + 3 段 match_key（`channel_name + '_' + reviewer + '_' + source_url`）。这是业务事实标准，与 §3.1 / TrendingPosts §5.2 / TrendingVideo §6 完全一致。

```sql
WITH official_keys AS (
  SELECT DISTINCT
    LOWER(CONCAT(source, '_', name, '_', url)) AS k
  FROM `tencent-databrain-prod.opinion.feeds_author`
  WHERE is_official_account = 1
)
SELECT
  f.comment_uin, f.content, f.content_url, f.reviewer,
  f.channel_name, f.country, f.comment_time
FROM `tencent-databrain-prod.opinion.public_feeds` AS f
JOIN official_keys ok
  ON LOWER(CONCAT(f.channel_name, '_', f.reviewer, '_', f.source_url)) = ok.k
WHERE f.unified_edition_id = '<game_id>'
  AND f.comment_time >= TIMESTAMP('<start_date>')
  AND f.comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
ORDER BY f.comment_time DESC
LIMIT 50;
```

> ⚠️ **`feeds_author` 是 NLP/采集打标 + 业务代码事实标准**；而 `dim_media_account.category='official-accounts'`（B 路）是 monitor source 配置维度，与"官号 vs 玩家"二元划分不是 1:1 关系（详见 §0）。
>
> **官号识别一律走 A 路**，B 路仅保留用于 monitor source 配置过滤场景（如 DataBrain 平台配置驱动的 dashboard / 报表，按 category 聚合，见 §3.2 / §5）。

---

## 5. 按特定 category 聚合（如 KOL / 直播采集）

```sql
WITH cat AS (
  SELECT DISTINCT LOWER(CONCAT(account_url, '#_#', account_name)) AS k
  FROM `tencent-databrain-prod.opinion.dim_media_account`
  WHERE unified_edition_id = '<game_id>'
    AND category = 'kol-monitoring'        -- 替换为目标 category（9 种有效值见 dim_tables.md）
    AND category != 'string'               -- 排除脏数据
    AND LOWER(visibility) != 'hidden'
    AND crawler_state = 1
)
SELECT COUNT(DISTINCT f.comment_uin) AS mentions
FROM `tencent-databrain-prod.opinion.public_feeds` AS f, UNNEST(f.sources) AS s
JOIN cat ON LOWER(CONCAT(s.url, '#_#', s.name)) = cat.k
WHERE f.unified_edition_id = '<game_id>'
  AND f.comment_time >= TIMESTAMP('<start_date>')
  AND f.comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY);
```

⚠️ **必须用 JOIN 形式，不要写成 `EXISTS+UNNEST+IN(CTE)`**：DataLab API 报 **61007 correlated subquery** 错误。

---

## 6. 关键词过滤（包含 / 排除）

### Include（命中关键词）

```sql
SELECT f.*
FROM `tencent-databrain-prod.opinion.public_feeds` AS f, UNNEST(f.sources) AS s
JOIN (
  SELECT DISTINCT LOWER(keyword) AS k
  FROM `tencent-databrain-prod.opinion.dim_keyword`
  WHERE unified_edition_id = '<game_id>'
    AND LOWER(visibility) != 'hidden'
    AND crawler_state = 1
) kw ON s.source = 'keyword' AND LOWER(s.name) = kw.k
WHERE f.unified_edition_id = '<game_id>'
  AND f.comment_time >= TIMESTAMP('<start_date>')
  AND f.comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY);
```

### only_include 严格模式（业务术语）

业务上"only_include"语义：一条 feed 只要存在**任意一个 source 不在白名单里**，就被过滤掉。SQL 写法（仅作参考，业务侧封装在 builder 里）：

```sql
WHERE NOT EXISTS (
  SELECT 1
  FROM UNNEST(f.sources) AS s
  WHERE NOT (
    -- 这里是白名单条件（account/keyword/external）
    LOWER(CONCAT(s.url, '#_#', s.name)) IN (SELECT k FROM whitelist_accounts)
    OR LOWER(s.name) IN (SELECT k FROM whitelist_keywords)
    OR s.source IN ('levelup')
    OR (s.source = 'game_store' AND f.channel_type = 'comments')   -- account+keyword+external 全选时放行
  )
)
```

---

## 7. 特殊值语义

| 值 | 语义 |
|---|---|
| `99999` / `'public'` | 全选（按维度） |
| `-99999` | 排除全部（该维度） |

---

## 8. 其他常用过滤字段

- `f.channel_type` / `f.channel_types`
- `f.media_type`（`text` / `image` / `video` / `live`）
- `f.reviewer`（按作者用户名）
- `f.isvalid`（`IN (1,2)` 才是有效数据；算 Brand Health 必带）
- `f.monitor_source`（评论源类型，如 user/critic review）

这些与 monitor source CTE 一起进入同一个 BigQuery WHERE。

---

## 9. 注意事项

1. **顶部红字**：`feeds.organization` 字段不存在，要走 `feeds_author.is_official_account = 1` 反查（A 路，见 §3.1）。
2. **3 条件必带**：`crawler_state=1` + `LOWER(visibility)!='hidden'` + `account_name!=''` 三条件用于过滤掉无效配置。
3. **JOIN 形式 vs `EXISTS+UNNEST+IN(CTE)`**：DataLab 报 61007 时改 JOIN。
4. **官号识别 vs Earned Content**：「Earned」是排除官号 + 可选排除已合作创作者；「Official Account」是只看官号。
5. **`match_key` 拼接顺序固定** `url + '#_#' + name`，不要写反。
6. **多种 match key 形式同时存在**：详见 §4 注释。
