# pr_news — 新闻 / PR 指标（intelligence.news_details）

> ⚠️ **必读**：查 `intelligence.news_details` 必须**同时**带：
> 1. **聚簇键**：`WHERE unified_edition_id = '<game_id>'`（多游戏用 `IN (...)`）
> 2. **分区键**：`AND release_time >= DATETIME('<start>') AND release_time < DATETIME('<end>')`
>    （⚠️ `release_time` 是 **DATETIME**，**不是 TIMESTAMP**——必须用 `DATETIME()` / `DATETIME_ADD()` / `DATETIME_TRUNC()`，**不要**用 `TIMESTAMP()` / `TIMESTAMP_ADD()` 包装；前者会因类型不匹配触发隐式转换、绕过分区裁剪。）
>
> 实测 DDL：`PARTITION BY DATETIME_TRUNC(release_time, MONTH)` + `CLUSTER BY unified_edition_id, release_time`。缺任一个 → 全表扫 + 必然 timeout。与 [public_feeds.md](public_feeds.md) 顶部约束等同级。

> 数据 dataset 已从历史的 `opinion.news_details` 迁移到 **`intelligence.news_details`**。
>
> Google Trends 关键词热度已拆出 → [googletrends.md](googletrends.md)。

---

## 适用问题

- 新闻数 / 正负面新闻 / 平均情感
- News Brand Health
- News Engagement
- 按 release_time 时间分布

---

## 涉及表

| 表 | 过滤键 | 分区 / 聚簇 |
|---|---|---|
| `tencent-databrain-prod.intelligence.news_details` | `unified_edition_id` + `release_time`（DATETIME，**MONTH 分区**） | **PARTITION BY** `DATETIME_TRUNC(release_time, MONTH)` · **CLUSTER BY** `unified_edition_id, release_time` |

详见 [auxiliary/id_mapping.md](auxiliary/id_mapping.md)：news_details 的过滤键是 `unified_edition_id`（接受 u.../e... 任一格式）。

---

## 0. 字段速查

| 字段 | 类型 | 说明 |
|---|---|---|
| `unified_edition_id` | STRING | **游戏 ID（聚簇键，必带）** |
| `release_time` | DATETIME | **新闻发布时间（MONTH 分区，必带时间范围）**；⚠️ 是 **DATETIME** 不是 TIMESTAMP，过滤必须用 `DATETIME()` / `DATETIME_ADD()` |
| `md5_uin` | STRING | 新闻唯一标识（去重计数） |
| `sentiment_rating` | INTEGER | 1/2 = 负面，3 = 中性，4/5 = 正面，**-1 = 未打分（必排除）** |
| `source` | STRING | 新闻来源枚举：`steam_store` / `google_news` / 其他 |
| `data_source` | STRING | 数据源（实测 3 种）：`DataBrain` / `IEGG PR` / `LevelUp`；**News Engagement 仅统计 `data_source='DataBrain'`** |
| `keywords` | ARRAY&lt;STRING&gt; | 命中关键词数组，用 `UNNEST(keywords) AS k` 展开 |
| `topics` | ARRAY&lt;STRING&gt; | 话题数组，用 `UNNEST(topics) AS t` 展开（注意大小写归一化，参考 [public_feeds.md](public_feeds.md) §7.2） |
| `comment_number` / `visit_number` / `like_number` / `unlike_number` | INTEGER | 互动量字段（**> 0 才计入 Engagement**） |
| `country` / `language` | STRING | 同 public_feeds 风格（小写 ISO-2） |

---

## 1. 核心指标公式

| 指标 | 公式 |
|---|---|
| Total Articles | `COUNT(md5_uin)`（`md5_uin` 是 primary_key，与 `COUNT(DISTINCT md5_uin)` 等价） |
| Positive Articles | `COUNT(IF(sentiment_rating IN (4,5), md5_uin, NULL))` |
| Neutral Articles | `COUNT(IF(sentiment_rating = 3, md5_uin, NULL))` |
| Negative Articles | `COUNT(IF(sentiment_rating IN (1,2), md5_uin, NULL))` |
| Avg Sentiment | `ROUND(AVG(CASE WHEN sentiment_rating <= 0 THEN 3 ELSE sentiment_rating END), 4)`（**`-1` / `0` 替换为 `3` 中性，进入分母**） |
| News Brand Health | 见 §2（`SAFE_DIVIDE(pos - neg, pos + neg)`，**0–1 区间，不乘 100；不做样本兜底**） |
| News Engagement | 见 §3（**仅 `data_source='DataBrain'`**） |
| News Potential Reach | 见 §4（**仅 `data_source='IEGG PR'`**，`SUM(visit_number)` where `visit_number > 0`） |

---

## 2. News Brand Health（**0–1 区间**，无样本兜底）

```sql
SELECT
  ROUND(
    SAFE_DIVIDE(
      COUNT(IF(sentiment_rating IN (4,5), md5_uin, NULL)) -
      COUNT(IF(sentiment_rating IN (1,2), md5_uin, NULL)),
      COUNT(IF(sentiment_rating IN (4,5), md5_uin, NULL)) +
      COUNT(IF(sentiment_rating IN (1,2), md5_uin, NULL))
    ),
    4
  ) AS news_brand_health
  -- ⚠️ 公式不乘 100（结果在 -1~1）、不做 `<= 10 → -99999` 样本兜底；小样本会返回小数 / NULL。
FROM `tencent-databrain-prod.intelligence.news_details`
WHERE unified_edition_id = '<game_id>'
  AND release_time >= DATETIME('<start_date>')
  AND release_time <  DATETIME_ADD(DATETIME('<end_date>'), INTERVAL 1 DAY);
```

---

## 3. News Engagement（仅 DataBrain 数据源，单 SUM + CASE 形式）

```sql
SELECT
  SUM(
    (CASE WHEN comment_number > 0 AND data_source = 'DataBrain' THEN comment_number ELSE 0 END) +
    (CASE WHEN visit_number   > 0 AND data_source = 'DataBrain' THEN visit_number   ELSE 0 END) +
    (CASE WHEN like_number    > 0 AND data_source = 'DataBrain' THEN like_number    ELSE 0 END) +
    (CASE WHEN unlike_number  > 0 AND data_source = 'DataBrain' THEN unlike_number  ELSE 0 END)
  ) AS news_engagement
FROM `tencent-databrain-prod.intelligence.news_details`
WHERE unified_edition_id = '<game_id>'
  AND release_time >= DATETIME('<start_date>')
  AND release_time <  DATETIME_ADD(DATETIME('<end_date>'), INTERVAL 1 DAY);
-- ⚠️ `data_source='DataBrain'` 已内嵌在每个 CASE 里，所以**不要**再在 WHERE 加 `AND data_source='DataBrain'`，否则会把其它源的非互动行也一并过滤掉（影响和 §1 公式表里 Total Articles 等指标共查的语义）。
```

---

## 4. News Potential Reach（仅 IEGG PR 数据源，单 SUM + CASE 形式）

与 cube `base_news.potential_reach` 严格对齐，公式：

```sql
SELECT
  SUM(CASE WHEN visit_number > 0 AND data_source = 'IEGG PR' THEN visit_number ELSE 0 END) AS news_potential_reach
FROM `tencent-databrain-prod.intelligence.news_details`
WHERE unified_edition_id = '<game_id>'
  AND release_time >= DATETIME('<start_date>')
  AND release_time <  DATETIME_ADD(DATETIME('<end_date>'), INTERVAL 1 DAY);
-- ⚠️ data_source='IEGG PR' 内嵌在 CASE 里，不要在 WHERE 再加 `AND data_source='IEGG PR'`（同 §3 News Engagement 模式）。
-- ⚠️ 与 News Engagement 区别：News Engagement 用 `data_source='DataBrain'`，News Potential Reach 用 `data_source='IEGG PR'`；两者不交叉。
```

> 说明：`news_potential_reach` 衡量"通过媒体投放（IEGG PR 数据源）触达的访问/曝光量"。当窗口内 `data_source='IEGG PR'` 的记录全部为空或 `visit_number ≤ 0` 时，结果自然为 `0`（属合法数字，按 SKILL.md Phase 4 输出契约处理）。

---

## 5. 综合 PR 报表（一锅查）

```sql
SELECT
  COUNT(md5_uin)                                                              AS total_articles,
  COUNT(IF(sentiment_rating IN (4,5), md5_uin, NULL))                         AS positive_articles,
  COUNT(IF(sentiment_rating = 3,      md5_uin, NULL))                         AS neutral_articles,
  COUNT(IF(sentiment_rating IN (1,2), md5_uin, NULL))                         AS negative_articles,
  ROUND(AVG(CASE WHEN sentiment_rating <= 0 THEN 3 ELSE sentiment_rating END), 4) AS avg_sentiment,
  -- News Engagement（仅 DataBrain，单 SUM + CASE 形式）
  SUM(
    (CASE WHEN comment_number > 0 AND data_source = 'DataBrain' THEN comment_number ELSE 0 END) +
    (CASE WHEN visit_number   > 0 AND data_source = 'DataBrain' THEN visit_number   ELSE 0 END) +
    (CASE WHEN like_number    > 0 AND data_source = 'DataBrain' THEN like_number    ELSE 0 END) +
    (CASE WHEN unlike_number  > 0 AND data_source = 'DataBrain' THEN unlike_number  ELSE 0 END)
  )                                                                           AS news_engagement,
  -- News Potential Reach（仅 IEGG PR）
  SUM(CASE WHEN visit_number > 0 AND data_source = 'IEGG PR' THEN visit_number ELSE 0 END) AS news_potential_reach
FROM `tencent-databrain-prod.intelligence.news_details`
WHERE unified_edition_id = '<game_id>'
  AND release_time >= DATETIME('<start_date>')
  AND release_time <  DATETIME_ADD(DATETIME('<end_date>'), INTERVAL 1 DAY)
LIMIT 1;
```

---

## 6. 注意事项

1. **`release_time` 是 DATETIME**（不是 TIMESTAMP）：必须用 `DATETIME('<date>')` / `DATETIME_ADD(DATETIME('<date>'), INTERVAL 1 DAY)` / `DATETIME_TRUNC(release_time, MONTH)`；**不要**用 `TIMESTAMP()` / `TIMESTAMP_ADD()` 包装（会触发隐式类型转换、可能绕过分区裁剪）。如需"最近 N 天"，`today` 取注入的当前时间(UTC+8)（缺失回退 `now_beijing.py`），再写 `release_time >= DATETIME('<today-N>')`；**不要**用 `DATETIME_SUB(CURRENT_DATETIME(), INTERVAL N DAY)`（BQ 服务时钟是 UTC，与业务北京时间错位最多 8h）。
2. **三种 `data_source` 各管各**：
   - `data_source='DataBrain'` → News Engagement 互动量（comment / visit / like / unlike 求和）
   - `data_source='IEGG PR'` → News Potential Reach（仅取 `visit_number`）
   - `data_source='LevelUp'` → 暂未在此文档建公式
   - 三者口径不交叉；按 §3 / §4 模式都是把 `data_source = '<X>'` 内嵌到 CASE 里，**不要**再在 WHERE 加 `AND data_source='<X>'`，否则会把其它源的非互动行也一并过滤掉、影响一锅查里其它指标的计数。
3. **`sentiment_rating = -1` 表示未打分**：`avg_sentiment` 公式把 `<= 0` 替换为 `3`（中性）再求平均，未打分样本会进入分母；Brand Health 用 `IN (4,5) / IN (1,2)` 显式枚举自然排除 -1。**默认不要在 WHERE 加 `sentiment_rating > 0`**。
4. **Brand Health 无样本兜底也不乘 100**：结果在 -1~1 区间；旧文档 `<= 10 → -99999`、`* 100` 的写法已删除。
5. **dataset 已迁移**：旧文档 / 旧代码可能写成 `opinion.news_details`，**实际是 `intelligence.news_details`**。
6. 分区粒度是 **MONTH**（不是 DAY），跨月查询时分区扫描成本相对较高。
