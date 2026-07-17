# TapTap — 商店评分（手游中国）

> ⚠️ **过滤键**：用 `unified_id`（**= `mobile_id`**）。详见 [auxiliary/id_mapping.md](../auxiliary/id_mapping.md)。
>
> ⚠️ **`create_time` 是 DATETIME 不是 TIMESTAMP**：用 `DATETIME_SUB`，不要 `TIMESTAMP_SUB`。

---

## 涉及表

`tencent-databrain-prod.opinion.store_score_taptap`

- **PARTITION BY** `DATETIME_TRUNC(create_time, MONTH)`（DATETIME, MONTH 粒度）
- **CLUSTER BY** `unified_id`

| 字段 | 说明 |
|---|---|
| `unified_id` | **游戏 ID（必带）** |
| `create_time` | DATETIME（分区字段，MONTH 粒度） |
| `score` | 评分（业务侧确认范围，常见 1-10） |
| `comments_number` | 累积评论数 |

---

## SQL — 当前评分快照

```sql
SELECT
  unified_id                            AS game_id,
  MAX_BY(score,           create_time)  AS score,
  MAX_BY(comments_number, create_time)  AS comments_number
FROM `tencent-databrain-prod.opinion.store_score_taptap`
WHERE unified_id = '<mobile_id>'
  AND create_time >= DATETIME('<today-30>')   -- today=注入的当前时间(UTC+8)，缺失才回退 now_beijing.py
GROUP BY unified_id;
```
