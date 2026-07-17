# googletrends — Google Trends 关键词热度

> 该表存的是按关键词的 Google Trends 风格热度（0-100 归一化），**不按游戏 ID 过滤**——按 `keyword` + `country` + 时间过滤。

---

## 适用问题

- 某关键词在指定时间窗口的 Google Trends 热度趋势
- 关键词 × 国家分布
- Google Trends Ratio（环比 / 比例展示）

---

## 涉及表

| 表 | 关键过滤 | 分区 / 聚簇 |
|---|---|---|
| `tencent-databrain-prod.opinion.googletrends_keyword` | `keyword`（关键词） + `country`（ISO-2 小写）+ 日期字段 | **无分区** · **CLUSTER BY** `start_time, game_id` |

> ⚠️ BigQuery DDL 实测：本表**没有 partition**，只有 cluster `start_time, game_id`。按 `start_time` 范围过滤可命中聚簇收益；不会触发 partition pruning。

---

## 0. 字段速查

| 字段 | 类型 | 说明 |
|---|---|---|
| `keyword` | STRING | 关键词（业务侧自己配置） |
| `country` | STRING | ISO-2 小写国家码（`'global'` = 全球） |
| `trend` | INTEGER | Google Trends 风格热度值（**0-100 归一化**，前端按最大值再二次归一化展示） |
| `date` | DATE / TIMESTAMP | 数据日期 |

> 该表不按 `unified_edition_id` 过滤——它的粒度是「关键词 × 国家 × 日」，不绑定单一游戏。如果用户问"某游戏的 Google Trends"，需要先确定要搜哪些 `keyword`（可能是游戏官方名 + 别名 + 缩写等）。

---

## 1. 总热度（指定关键词）

```sql
SELECT
  keyword,
  country,
  AVG(trend) AS total
FROM `tencent-databrain-prod.opinion.googletrends_keyword`
WHERE keyword IN ('<keyword_1>', '<keyword_2>')
  AND date >= DATE('<start_date>')
  AND date <= DATE('<end_date>')
  -- 可选：限定国家
  AND country IN ('<country_1>', '<country_2>')
GROUP BY keyword, country
ORDER BY total DESC
LIMIT 100;
```

---

## 2. 时序趋势

```sql
SELECT
  FORMAT_DATE('%Y-%m-%d', date) AS time,
  keyword,
  AVG(trend) AS trend_value
FROM `tencent-databrain-prod.opinion.googletrends_keyword`
WHERE keyword IN ('<keyword_1>', '<keyword_2>')
  AND date >= DATE('<start_date>')
  AND date <= DATE('<end_date>')
  AND country = '<country_code>'        -- 不同国家 trend 不可直接相加（已归一化）
GROUP BY time, keyword
ORDER BY time;
```

---

## 3. Google Trends Ratio（按 DoD / WoW / MoM 比例）

后端通常返回当前周期 `total` + 对比周期 `total`，前端按比例展示：

```sql
WITH curr AS (
  SELECT keyword, AVG(trend) AS total
  FROM `tencent-databrain-prod.opinion.googletrends_keyword`
  WHERE keyword IN ('<keyword_1>', '<keyword_2>')
    AND date >= DATE('<curr_start>')
    AND date <= DATE('<curr_end>')
  GROUP BY keyword
),
prev AS (
  SELECT keyword, AVG(trend) AS total
  FROM `tencent-databrain-prod.opinion.googletrends_keyword`
  WHERE keyword IN ('<keyword_1>', '<keyword_2>')
    AND date >= DATE('<prev_start>')
    AND date <= DATE('<prev_end>')
  GROUP BY keyword
)
SELECT
  c.keyword,
  c.total                                         AS curr_trend,
  IFNULL(p.total, 0)                              AS prev_trend,
  SAFE_DIVIDE(c.total - p.total, p.total) * 100   AS ratio_pct
FROM curr c
LEFT JOIN prev p USING (keyword)
ORDER BY ratio_pct DESC;
```

---

## 4. 注意事项

1. **`trend` 已归一化（0-100）**：不同 keyword × country 之间不可直接相加；做横比时仅比 ratio / 排名。
2. **没有 `unified_edition_id`**：要分析"某游戏"时，需要先列出该游戏的相关 keyword 集合（游戏官方名、别名、缩写、IP 名等）。
3. **`country='global'` 含义不同于 `feeds` 的"无归属"**：在 Google Trends 表里 `'global'` 通常指"跨国家归一化的全球热度"。
4. **`date` 类型按实际 schema**：执行前可用 `DESCRIBE` 或 `INFORMATION_SCHEMA.COLUMNS` 确认；DATE 类型用 `DATE('<...>')`，TIMESTAMP 用 `TIMESTAMP('<...>')`。
5. **整个表无 `unified_edition_id`/`unified_id` 等游戏 ID**：详见 [auxiliary/id_mapping.md](auxiliary/id_mapping.md)。
