# Steam ext_json 字段完整参考

## 字段一览

| 字段 | 类型 | 含义 | 使用场景 |
|------|------|------|---------|
| `user_id` | string | Steam玩家数字ID | 追踪同一用户改评 |
| `review_duration` | float | 写评论时的游玩时长（小时） | **核心字段**，时长画像首选 |
| `record_duration` | float | 累计总游玩时长（小时） | review_duration缺失时备选 |
| `last2week_duration` | int | 过去两周游玩时长（分钟） | 判断赛季活跃度 |
| `last_play_time` | timestamp | 最后一次游玩时间 | 判断是否放弃游戏 |
| `helpful_num` | int | "有用"投票数 | 社区共识权重排序 |
| `funny_num` | int | "有趣"投票数 | 辅助判断 |
| `early_access` | int | 是否EA玩家 (1/0) | 筛选EA期间评测 |
| `received_free` | int | 是否免费获得 (1/0) | 标记免费key用户 |
| `refunded` | int | 是否退款 (1/0) | 退款玩家专项分析 |
| `steam_purchase` | int | 是否Steam购买 (1/0) | 区分购买渠道 |
| `unstarred` | int | 不计入总评分 (1/0) | 1=key激活/礼物/临时许可 |
| `hardware` | string | CPU/GPU/Memory信息 | 性能差评归因 |
| `steam_deck` | int | 是否Steam Deck (1/0) | 设备兼容性分析 |
| `comment_update_time` | timestamp | 评论更新时间 | 判断是否修改过评测 |

## SQL 提取模板

```sql
SELECT
  JSON_EXTRACT_SCALAR(ext_json, '$.user_id') AS steam_user_id,
  CAST(JSON_EXTRACT_SCALAR(ext_json, '$.review_duration') AS FLOAT64) AS review_duration_h,
  CAST(JSON_EXTRACT_SCALAR(ext_json, '$.record_duration') AS FLOAT64) AS record_duration_h,
  CAST(JSON_EXTRACT_SCALAR(ext_json, '$.last2week_duration') AS INT64) AS last2week_min,
  JSON_EXTRACT_SCALAR(ext_json, '$.last_play_time') AS last_play_time,
  CAST(JSON_EXTRACT_SCALAR(ext_json, '$.helpful_num') AS INT64) AS helpful_num,
  CAST(JSON_EXTRACT_SCALAR(ext_json, '$.funny_num') AS INT64) AS funny_num,
  CAST(JSON_EXTRACT_SCALAR(ext_json, '$.early_access') AS INT64) AS early_access,
  CAST(JSON_EXTRACT_SCALAR(ext_json, '$.received_free') AS INT64) AS received_free,
  CAST(JSON_EXTRACT_SCALAR(ext_json, '$.refunded') AS INT64) AS refunded,
  CAST(JSON_EXTRACT_SCALAR(ext_json, '$.steam_purchase') AS INT64) AS steam_purchase,
  CAST(JSON_EXTRACT_SCALAR(ext_json, '$.unstarred') AS INT64) AS unstarred,
  JSON_EXTRACT_SCALAR(ext_json, '$.hardware') AS hardware,
  CAST(JSON_EXTRACT_SCALAR(ext_json, '$.steam_deck') AS INT64) AS steam_deck
FROM `{project}.opinion.feeds`
WHERE channel_name = 'steam'
  AND unified_edition_id = "{uid}"
  AND comment_time BETWEEN "{start}" AND "{end}"
  AND isvalid >= 1
  AND ext_json IS NOT NULL
```

## 自适应时长分段

```sql
-- 先查分位数
SELECT
  APPROX_QUANTILES(CAST(JSON_EXTRACT_SCALAR(ext_json, '$.review_duration') AS FLOAT64), 100)[OFFSET(25)] AS p25,
  APPROX_QUANTILES(CAST(JSON_EXTRACT_SCALAR(ext_json, '$.review_duration') AS FLOAT64), 100)[OFFSET(50)] AS p50,
  APPROX_QUANTILES(CAST(JSON_EXTRACT_SCALAR(ext_json, '$.review_duration') AS FLOAT64), 100)[OFFSET(75)] AS p75,
  APPROX_QUANTILES(CAST(JSON_EXTRACT_SCALAR(ext_json, '$.review_duration') AS FLOAT64), 100)[OFFSET(90)] AS p90
FROM `{project}.opinion.feeds`
WHERE channel_name = 'steam'
  AND unified_edition_id = "{uid}"
  AND comment_time BETWEEN "{start}" AND "{end}"
  AND isvalid >= 1
  AND CAST(JSON_EXTRACT_SCALAR(ext_json, '$.review_duration') AS FLOAT64) > 0
```

## 放弃游戏判定（方法B）

```sql
-- 写完评论后基本没再玩（record - review <= 2h）
SELECT *,
  CAST(JSON_EXTRACT_SCALAR(ext_json, '$.record_duration') AS FLOAT64) 
    - CAST(JSON_EXTRACT_SCALAR(ext_json, '$.review_duration') AS FLOAT64) AS post_review_hours
FROM ...
WHERE (CAST(JSON_EXTRACT_SCALAR(ext_json, '$.record_duration') AS FLOAT64) 
       - CAST(JSON_EXTRACT_SCALAR(ext_json, '$.review_duration') AS FLOAT64)) <= 2
```

## 注意事项

- 字段不一定每条都存在，需统计有效数据量
- 报告中注明覆盖率（如"82%的评测包含有效时长数据"）
- `unstarred=1` 的评论不影响Steam总评分，分析时注意区分
- `hardware` 字段内容为自由文本，需正则提取GPU型号
