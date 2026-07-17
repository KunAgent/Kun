# Metacritic — 媒体评分

> ⚠️ **过滤键**：用 `edition_id`（**= `pc_id` 或 `console_id`**，看具体平台）。详见 [auxiliary/id_mapping.md](../auxiliary/id_mapping.md)。
>
> ⚠️ **`create_time` 是 DATETIME 不是 TIMESTAMP**。

---

## 涉及表

`tencent-databrain-prod.opinion.store_score_metacritic`

- **PARTITION BY** `DATETIME_TRUNC(create_time, MONTH)`（DATETIME, MONTH 粒度）
- **CLUSTER BY** `edition_id`

| 字段 | 说明 |
|---|---|
| `edition_id` | **游戏 ID（必带，前缀 `e`）** |
| `create_time` | DATETIME（分区字段，MONTH 粒度） |
| `meta_score` | 媒体评分（**0-100**，记者评分） |
| `user_score` | 用户评分（**0-10**，玩家评分） |
| `platform` | PC / PS / Xbox / Switch 等 |
| 评测数量字段（按业务侧返回） | — |

### 情感阈值映射（前端展示用）

| 类别 | Positive | Neutral | Negative |
|---|---|---|---|
| **Critic** (`meta_score`，0-100) | `>= 71` | `40-70` | `<= 39` |
| **User** (`user_score`，0-10) | `>= 8` | `5-7` | `<= 4` |

---

## SQL — 当前评分快照（按平台）

```sql
SELECT
  edition_id                            AS game_id,
  platform,
  MAX_BY(meta_score, create_time)       AS meta_score,        -- 0-100
  MAX_BY(user_score, create_time)       AS user_score         -- 0-10
FROM `tencent-databrain-prod.opinion.store_score_metacritic`
WHERE edition_id = '<pc_id 或 console_id>'
  AND create_time >= DATETIME('<today-30>')   -- today=注入的当前时间(UTC+8)，缺失才回退 now_beijing.py
GROUP BY edition_id, platform;
```
