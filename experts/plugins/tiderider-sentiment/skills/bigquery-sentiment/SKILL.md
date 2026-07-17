---
name: bigquery-sentiment
description: |
  游戏舆情查询与分析核心技能。连接BigQuery执行多维度舆情分析。
  触发词：舆情分析、评论查询、好评率、差评归因、话题分析、版本对比、KOL分析、渠道分析
---

# BigQuery 舆情查询

## 功能说明

连接 Google BigQuery 查询游戏玩家评论数据，执行多维度舆情分析。

## 前置条件

1. 用户已配置 BigQuery Service Account JSON 密钥路径（凭证中已包含 project_id，无需用户额外提供）
2. 密钥对应的 SA 有相关表的读取权限
3. 连接时通过 `client = bigquery.Client()` 自动从凭证读取 project，代码中用 `client.project` 获取

## 数据表优先级

### 评论数据
| 优先级 | 表 | 说明 |
|--------|---|------|
| **1** | `tiderider.opinion_feeds` | 清洗后数据（目前仅覆盖 Subway Surfers / SSC） |
| 2 | `opinion.feeds` | 原始数据，其他游戏使用此表 |

⚠️ 两表字段**完全不同**，不能复用 SQL 模板！详见 @references/query-rules.md

### 异动分析
用户问异动/舆情波动时，**第一优先**查 `tiderider.anomaly_details`（含 Remark 四模块归因），无数据才回退 `opinion.feeds` 手动归因。

### 舆情总结
优先引用 `tiderider.key_document_collection_extra`（官方/大V内容）作为主线，再用高互动评论佐证。

## 核心查询模板

> **注意**：SQL 中的 `{project}` 通过 `client.project` 自动获取（来自凭证 JSON），无需向用户询问。

### 基础舆情概览
```sql
SELECT
  COUNT(*) as total_reviews,
  COUNTIF(sentiment_rating >= 4) as positive,
  COUNTIF(sentiment_rating < 2) as negative,
  ROUND(COUNTIF(sentiment_rating >= 4) * 100.0 / COUNT(*), 1) as pos_rate
FROM `{project}.opinion.feeds`
WHERE unified_edition_id = "{uid}"
  AND comment_time BETWEEN "{start}" AND "{end}"
  AND isvalid >= 1
```

### Steam 好评率（仅限Steam渠道）
```sql
SELECT
  COUNT(*) as total,
  COUNTIF(is_recommend = 1) as positive,
  ROUND(COUNTIF(is_recommend = 1) * 100.0 / COUNT(*), 1) as recommend_rate
FROM `{project}.opinion.feeds`
WHERE unified_edition_id = "{uid}"
  AND channel_name = "steam"
  AND comment_time BETWEEN "{start}" AND "{end}"
  AND isvalid >= 1
```

### 每日走势
```sql
SELECT
  DATE(comment_time) as dt,
  COUNT(*) as total,
  COUNTIF(sentiment_rating < 2) as neg,
  ROUND(COUNTIF(sentiment_rating >= 4) * 100.0 / COUNT(*), 1) as pos_rate
FROM `{project}.opinion.feeds`
WHERE unified_edition_id = "{uid}"
  AND comment_time BETWEEN "{start}" AND "{end}"
  AND isvalid >= 1
GROUP BY dt
ORDER BY dt
```

### 渠道分布
```sql
SELECT
  channel_name,
  COUNT(*) as cnt,
  ROUND(COUNTIF(sentiment_rating >= 4) * 100.0 / COUNT(*), 1) as pos_rate
FROM `{project}.opinion.feeds`
WHERE unified_edition_id = "{uid}"
  AND comment_time BETWEEN "{start}" AND "{end}"
  AND isvalid >= 1
GROUP BY channel_name
ORDER BY cnt DESC
```

### 语言分布
```sql
SELECT
  language,
  COUNT(*) as cnt,
  COUNTIF(sentiment_rating < 2) as neg
FROM `{project}.opinion.feeds`
WHERE unified_edition_id = "{uid}"
  AND comment_time BETWEEN "{start}" AND "{end}"
  AND isvalid >= 1
GROUP BY language
ORDER BY cnt DESC
LIMIT 15
```

### 关键词搜索（双字段规则）
```sql
-- 英文关键词：必须同时搜 content_to_zh + content_to_en
SELECT ...
WHERE ...
  AND (
    REGEXP_CONTAINS(LOWER(IFNULL(content_to_en, '')), r'{en_pattern}')
    OR REGEXP_CONTAINS(LOWER(IFNULL(content_to_zh, '')), r'{zh_pattern}')
  )
```

### KOL 发现（高粉丝差评）
```sql
SELECT
  reviewer, follower_number, content_to_zh, channel_name, comment_time
FROM `{project}.opinion.feeds`
WHERE unified_edition_id = "{uid}"
  AND comment_time BETWEEN "{start}" AND "{end}"
  AND isvalid >= 1
  AND sentiment_rating < 2
  AND follower_number > 10000
ORDER BY follower_number DESC
LIMIT 20
```

## 参考资料

- 游戏 UID 映射表：@references/games.json
- 查询注意事项：@references/query-rules.md

## 数据量分级建议

| 级别 | 日评论量 | 建议时间窗口 |
|------|---------|-------------|
| HIGH (>30K/天) | Roblox, NIKKE, DeltaForce | <=7天 |
| MID (5K-30K) | Brawl Stars, POE2 | <=14天 |
| OK (<5K) | BF6, Subway, EFT | 正常查询 |
