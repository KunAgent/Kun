# Meta Store — 商店评分（Meta Quest VR）

> ⚠️ **过滤键**：用 `edition_id`（**= `console_id`**，VR 设备类目）。详见 [auxiliary/id_mapping.md](../auxiliary/id_mapping.md)。
>
> ⚠️ **`create_time` 是 DATETIME 不是 TIMESTAMP**。
>
> ⚠️ **该表无 `source` 字段**：和 PlayStation 一样要有适配分支。

---

## 涉及表

`tencent-databrain-prod.opinion.store_score_meta`（注意：BQ 实际表名是 `store_score_meta`，**没有 `_store` 后缀**；以前文档误写为 `store_score_meta_store`）

- **PARTITION BY** `create_time` (DATETIME, DAY 粒度)
- **CLUSTER BY** `edition_id`

| 字段 | 说明 |
|---|---|
| `edition_id` | **游戏 ID（必带，前缀 `e`）** |
| `create_time` | DATETIME（分区字段，DAY 粒度） |
| `score` | 评分（按业务范围确认） |

---

## SQL — 当前评分快照

```sql
SELECT
  edition_id                       AS game_id,
  MAX_BY(score, create_time)       AS score
FROM `tencent-databrain-prod.opinion.store_score_meta`
WHERE edition_id = '<console_id>'
  AND create_time >= DATETIME('<today-30>')   -- today=注入的当前时间(UTC+8)，缺失才回退 now_beijing.py
GROUP BY edition_id;
```
