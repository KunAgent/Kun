# PlayStation — 商店评分（Console）

> ⚠️ **过滤键**：用 `edition_id`（**= `console_id`**）。详见 [auxiliary/id_mapping.md](../auxiliary/id_mapping.md)。
>
> ⚠️ **`create_time` 是 DATETIME 不是 TIMESTAMP**。
>
> ⚠️ **该表无 `source` 字段**：不要在 SQL 里 SELECT `source` 列，否则报 `Unrecognized name`。

---

## 涉及表

`tencent-databrain-prod.opinion.store_score_playstation`

- **PARTITION BY** `create_time` (DATETIME, DAY 粒度)
- **CLUSTER BY** `edition_id`

| 字段 | 说明 |
|---|---|
| `edition_id` | **游戏 ID（必带，前缀 `e`）** |
| `create_time` | DATETIME（分区字段，DAY 粒度） |
| `store_score` | 评分（1-5） |
| `comments_number` | 累积评论数 |
| `area` | 地区代码 |

---

## SQL — 当前评分快照（按地区）

```sql
SELECT
  edition_id                            AS game_id,
  area,
  MAX_BY(store_score,     create_time)  AS store_score,
  MAX_BY(comments_number, create_time)  AS comments_number
FROM `tencent-databrain-prod.opinion.store_score_playstation`
WHERE edition_id = '<console_id>'
  AND create_time >= DATETIME('<today-30>')   -- today=注入的当前时间(UTC+8)，缺失才回退 now_beijing.py
GROUP BY edition_id, area
ORDER BY comments_number DESC
LIMIT 20;
```
