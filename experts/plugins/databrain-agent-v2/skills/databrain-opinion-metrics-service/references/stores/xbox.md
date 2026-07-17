# Xbox — 商店评分（Console）

> ⚠️ **过滤键**：用 `edition_id`（**= `console_id`**）。详见 [auxiliary/id_mapping.md](../auxiliary/id_mapping.md)。
>
> ⚠️ **`create_time` 是 DATETIME 不是 TIMESTAMP**。

---

## 涉及表

`tencent-databrain-prod.opinion.store_score_xbox`

- **PARTITION BY** `DATETIME_TRUNC(create_time, MONTH)`（DATETIME, MONTH 粒度）
- **CLUSTER BY** `edition_id`

| 字段 | 说明 |
|---|---|
| `edition_id` | **游戏 ID（必带，前缀 `e`）** |
| `create_time` | DATETIME（分区字段，MONTH 粒度） |
| `store_score` | 评分（1-5） |
| `comments_number` | 累积评论数 |
| `area` | 地区代码 |
| `source` | 数据源 |

### 情感阈值映射（前端展示用）

| 区间 | 标签 |
|---|---|
| `comment_score >= 4` | Positive |
| `comment_score = 3` | Neutral |
| `comment_score <= 2` | Negative |

---

## SQL — 当前评分快照（按地区）

```sql
SELECT
  edition_id                            AS game_id,
  area,
  MAX_BY(store_score,     create_time)  AS store_score,
  MAX_BY(comments_number, create_time)  AS comments_number,
  MAX_BY(source,          create_time)  AS source
FROM `tencent-databrain-prod.opinion.store_score_xbox`
WHERE edition_id = '<console_id>'
  AND create_time >= DATETIME('<today-30>')   -- today=注入的当前时间(UTC+8)，缺失才回退 now_beijing.py
GROUP BY edition_id, area
ORDER BY comments_number DESC
LIMIT 20;
```
