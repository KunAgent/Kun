# OpenCritic — 媒体评分

> ⚠️ **过滤键**：用 `edition_id`（**= `pc_id` 或 `console_id`**）。详见 [auxiliary/id_mapping.md](../auxiliary/id_mapping.md)。
>
> ⚠️ **`create_time` 是 DATETIME 不是 TIMESTAMP**。

---

## 涉及表

`tencent-databrain-prod.opinion.store_score_opencritic`

- **PARTITION BY** `DATETIME_TRUNC(create_time, MONTH)`（DATETIME, MONTH 粒度）
- **CLUSTER BY** `edition_id`

| 字段 | 说明 |
|---|---|
| `edition_id` | **游戏 ID（必带，前缀 `e`）** |
| `create_time` | DATETIME（分区字段，MONTH 粒度） |
| `top_critic_average_score` | 顶级评论员平均分（**0-100**） |
| `critics_recommend_score` | 评论员推荐率（百分比） |
| `platform` | PC / PS / Xbox 等 |
| 评测数量字段（按业务侧返回） | — |

### 情感阈值映射（前端展示用，与 Metacritic Critic 一致）

| Positive | Neutral | Negative |
|---|---|---|
| `>= 71` | `40-70` | `<= 39` |

---

## SQL — 当前评分快照

```sql
SELECT
  edition_id                                          AS game_id,
  platform,
  MAX_BY(top_critic_average_score, create_time)       AS top_critic_score,         -- 0-100
  MAX_BY(critics_recommend_score,  create_time)       AS critics_recommend_pct
FROM `tencent-databrain-prod.opinion.store_score_opencritic`
WHERE edition_id = '<pc_id 或 console_id>'
  AND create_time >= DATETIME('<today-30>')   -- today=注入的当前时间(UTC+8)，缺失才回退 now_beijing.py
GROUP BY edition_id, platform;
```
