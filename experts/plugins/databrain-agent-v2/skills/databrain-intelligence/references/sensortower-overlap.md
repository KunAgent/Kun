# Sensortower App Overlap

> 手游受众重叠与亲和力分析。当用户询问「两款手游的重叠用户 / 重叠度 / overlap」或「亲和力 / affinity / 亲密度」时，使用本文档。

**表名：** `intelligence.sensortower_app_overlap_uid`

---

## 数据源背景

Sensortower 基于其移动端用户行为面板（panel），统计同一用户同时使用两款 App 的情况，输出两个核心指标：

- **Overlap Rate**（重叠率）：游戏 A 的用户中，有多少比例也在使用游戏 B
- **Affinity Score**（亲和力指数）：游戏 A 的用户使用游戏 B 的概率，相对全体手游用户基准的倍数

---

## Schema

| 字段 | 类型 | 含义 |
|---|---|---|
| `start_date` | DATETIME | 月份起始日（分区键），如 `2026-05-01T00:00:00`；始终为每月 1 日 |
| `granularity` | STRING | 数据粒度，目前只有 `"monthly"` |
| `market` | STRING | 小写 ISO-2 市场代码；**无 `global` 汇总行**，未指定时默认 `'us'` |
| `platform` | STRING | `"android"` / `"ios"`（注意：**不是** `appstore`/`googleplay`） |
| `unified_id_app_a` | STRING | 主游戏 unified_id（`u` 前缀，与 `_uid` metric 表的 `id` 字段语义相同） |
| `unified_id_app_b` | STRING | 对比游戏 unified_id |
| `app_a_users_using_app_b_share` | FLOAT64 | **Overlap Rate**：app_a 用户中同时使用 app_b 的比例（0–1 小数，如 `0.0197` = 1.97%） |
| `app_a_users_likelihood_multiplier` | FLOAT64 | **Affinity Score**：app_a 用户使用 app_b 的概率倍数（相对全体用户基准；`5.8` = 是全体用户平均概率的 5.8 倍） |
| `app_a_users_using_app_b_share_previous_period` | FLOAT64 | 上月 overlap rate（首次出现的游戏对为 NULL） |
| `app_a_users_using_app_b_share_previous_period_diff` | FLOAT64 | 环比变化 = 当月 - 上月（正值=增长，负值=下降，NULL=无上期数据） |
| `insertTime` | TIMESTAMP | 数据入库时间，不用于业务过滤 |

---

## 两个核心指标的语义区别

| 指标 | 字段 | 含义 | 典型问法 |
|---|---|---|---|
| **Overlap Rate** | `app_a_users_using_app_b_share` | A 的用户里有多少 % 同时在用 B | "MLBB 用户有多少人也在玩王者荣耀？" / "两款游戏的重叠度是多少？" |
| **Affinity Score** | `app_a_users_likelihood_multiplier` | A 用户使用 B 的概率是全体用户平均水平的几倍 | "MLBB 用户对王者荣耀的亲和力有多高？" / "哪些游戏和 MLBB 最有亲和力？" |

**关键区别**：Overlap Rate 是绝对渗透率（受 B 本身体量影响，大游戏天然更高）；Affinity Score 是相对指数（剔除了 B 的体量因素，更能反映用户偏好的真实相似性）。

> 用户询问「哪些游戏和 A 最相似 / 最有亲和力」→ 优先用 **Affinity Score** 排序  
> 用户询问「A 和 B 的重叠用户占比」→ 用 **Overlap Rate**  
> 用户询问「A 的亲密度 / 亲和力」但只给了一款游戏 → 理解为「哪些游戏和 A 亲和力最高」→ 用场景 2（一对多排行）

---

## 市场（market）默认规则

**该表无 `global` 汇总行。** 市场处理规则如下，按优先级执行：

| 用户意图 | market 过滤 | 答案注明 |
|---|---|---|
| 明确指定国家（如"美国"、"日本"） | 使用对应 ISO-2 code（`us` / `jp` / ...） | 无需额外说明 |
| **未指定国家（默认）** | **`market = 'us'`** | 在答案末尾注明"数据以美国市场为准" |
| 明确要求"全球" / "多市场" | `market IN ('us','jp','kr','br','in','de','gb','fr')` + GROUP BY | 注明"以主要市场加权平均近似全球" |

> **不要**在答案里主动解释"该表无 global 行"——直接给出美国数据，末尾加一句"数据以美国市场为准"足够。

---

## 时间范围默认规则

affinity score 和 overlap rate 是**月度快照值**，不是累计值，处理规则如下：

| 用户说法 | 处理方式 | SQL 写法 |
|---|---|---|
| 明确单月（"2024年1月"、"2026-03"） | 查该月 | `start_date = DATETIME('2024-01-01')` |
| 时间段（"2026上半年"、"Q1"、"最近3个月"） | 按月逐一展示该时间段内每个月的数据 | `BETWEEN DATETIME('<起月-01>') AND DATETIME('<末月-01>')` + `GROUP BY start_date` |
| 明确要趋势/变化（"趋势"、"每个月"、"变化情况"） | 按月展示 | 同上 |
| 未指定时间 | 直接查，返回空时用 Pitfall #11 重试模板 | — |

---

## 数据覆盖

- **时间范围**：2021-01 至今（最新为 2026-05），每月更新一次；覆盖范围因游戏对而异，早期冷门游戏对可能从较晚月份才有数据
- **粒度**：月度（`granularity = 'monthly'`），`start_date` 始终为月份第一天
- **市场覆盖**：主要国家市场（ISO-2 小写），已确认覆盖：`ru`, `in`, `tr`, `br`, `us`, `jp`, `de`, `id`, `kr`, `sa`, `pl`, `ph`, `fr`, `es`, `gb`, `it`, `mx`, `ca`, `tw`, `my` 等
- **平台**：`android` / `ios`，同一游戏对同一市场有两行
- **方向**：双向存储，`(A→B)` 和 `(B→A)` 均有行，但语义不同（见 Pitfall #4）

---

## 查询场景与 SQL 模板

### 场景 1：两款游戏的 overlap rate / affinity（一对一）

```sql
-- 单月查询；<YYYY-MM-01> 由用户指定月份决定，不要硬编码
SELECT
  o.start_date,
  o.platform,
  ROUND(o.app_a_users_using_app_b_share * 100, 2)        AS overlap_rate_pct,
  ROUND(o.app_a_users_likelihood_multiplier, 2)           AS affinity_score,
  ROUND(o.app_a_users_using_app_b_share_previous_period_diff * 100, 2) AS mom_change_pct
FROM intelligence.sensortower_app_overlap_uid o
WHERE o.unified_id_app_a = '<mobile_id_A>'
  AND o.unified_id_app_b = '<mobile_id_B>'
  AND o.market = 'us'                         -- 默认美国，用户指定时替换
  AND o.start_date = DATETIME('<YYYY-MM-01>') -- 用户指定月份
ORDER BY o.platform
```

### 场景 2：一款游戏查所有重叠对手排行（一对多，按 affinity 排序）

> 用户只提供一款游戏名 + 问「亲密度/亲和力/overlap」→ 默认走此场景，查该游戏 affinity 最高的 Top 20 对手。

```sql
-- 指定月份，iOS+Android 合并（AVG 跨平台）；<YYYY-MM-01> 由用户指定月份决定
SELECT
  o.unified_id_app_b,
  d.entity_name                                              AS game_b_name,
  ROUND(AVG(o.app_a_users_likelihood_multiplier), 2)        AS avg_affinity_score,
  ROUND(AVG(o.app_a_users_using_app_b_share) * 100, 2)      AS avg_overlap_rate_pct
FROM intelligence.sensortower_app_overlap_uid o
LEFT JOIN common.app_detail d
  ON d.app_id = o.unified_id_app_b AND d.id_type = 'unified_id'
WHERE o.unified_id_app_a = '<mobile_id_A>'
  AND o.market = 'us'
  AND o.start_date = DATETIME('<YYYY-MM-01>')
GROUP BY o.unified_id_app_b, d.entity_name
ORDER BY avg_affinity_score DESC
LIMIT 20
```

### 场景 3：哪些游戏的用户对 A 最有亲和力（反向查询）

```sql
-- <YYYY-MM-01> 由用户指定月份决定
SELECT
  o.unified_id_app_a,
  d.entity_name                                              AS game_a_name,
  ROUND(AVG(o.app_a_users_likelihood_multiplier), 2)        AS avg_affinity_score,
  ROUND(AVG(o.app_a_users_using_app_b_share) * 100, 2)      AS avg_overlap_rate_pct
FROM intelligence.sensortower_app_overlap_uid o
LEFT JOIN common.app_detail d
  ON d.app_id = o.unified_id_app_a AND d.id_type = 'unified_id'
WHERE o.unified_id_app_b = '<mobile_id_A>'
  AND o.market = 'us'
  AND o.start_date = DATETIME('<YYYY-MM-01>')
GROUP BY o.unified_id_app_a, d.entity_name
ORDER BY avg_affinity_score DESC
LIMIT 20
```

### 场景 4：时间段 / 趋势（按月展示）

> **必须加 Top N 限制**：时间段查询会拉出「N个月 × M个游戏对 × 2个平台」的数据，不加 LIMIT 会导致结果集过大（超过 stdout 限制后写磁盘，增加额外 read_file 开销）。
>
> **不要硬编码日期**：`<起月-01>` 和 `<末月-01>` 由用户问题决定（如"2026上半年" → 起月 `2026-01-01`，末月 `2026-06-01`）。

```sql
-- 时间段内按月逐一展示 Top 20 游戏，iOS+Android 合并
SELECT
  o.start_date,
  o.unified_id_app_b,
  d.entity_name                                              AS game_b_name,
  ROUND(AVG(o.app_a_users_likelihood_multiplier), 2)        AS avg_affinity_score,
  ROUND(AVG(o.app_a_users_using_app_b_share) * 100, 2)      AS avg_overlap_rate_pct
FROM intelligence.sensortower_app_overlap_uid o
LEFT JOIN common.app_detail d
  ON d.app_id = o.unified_id_app_b AND d.id_type = 'unified_id'
WHERE o.unified_id_app_a = '<mobile_id_A>'
  AND o.market = 'us'
  AND o.start_date BETWEEN DATETIME('<起月-01>') AND DATETIME('<末月-01>')
  AND o.unified_id_app_b IN (
    -- 动态找时间段内最新有数据的月份，取 Top 20 游戏
    SELECT unified_id_app_b
    FROM intelligence.sensortower_app_overlap_uid
    WHERE unified_id_app_a = '<mobile_id_A>'
      AND market = 'us'
      AND start_date = (
        SELECT MAX(start_date)
        FROM intelligence.sensortower_app_overlap_uid
        WHERE unified_id_app_a = '<mobile_id_A>'
          AND market = 'us'
          AND start_date <= DATETIME('<末月-01>')
      )
    GROUP BY unified_id_app_b
    ORDER BY AVG(app_a_users_likelihood_multiplier) DESC
    LIMIT 20
  )
GROUP BY o.start_date, o.unified_id_app_b, d.entity_name
ORDER BY o.start_date, avg_affinity_score DESC
```

### 场景 5：多市场对比（用户明确要求多国）

```sql
-- <YYYY-MM-01> 由用户指定月份决定，不要硬编码
SELECT
  o.market,
  ROUND(AVG(o.app_a_users_using_app_b_share) * 100, 2)      AS overlap_rate_pct,
  ROUND(AVG(o.app_a_users_likelihood_multiplier), 2)         AS affinity_score
FROM intelligence.sensortower_app_overlap_uid o
WHERE o.unified_id_app_a = '<mobile_id_A>'
  AND o.unified_id_app_b = '<mobile_id_B>'
  AND o.market IN ('us', 'jp', 'kr', 'br', 'in', 'de', 'gb', 'fr')
  AND o.start_date = DATETIME('<YYYY-MM-01>')
GROUP BY o.market
ORDER BY overlap_rate_pct DESC
```

---

## Pitfalls（必读）

1. **`start_date` 是 DATETIME，不是 DATE**：过滤必须用 `DATETIME('YYYY-MM-01')` 格式，不能用 `DATE(...)` 或裸字符串，否则类型不匹配报错。

2. **`platform` 值是 `android`/`ios`**，不是 `appstore`/`googleplay`。与 `sensortower_*_uid` metric 表不同；与 `game_metric_sensortower_demographics` 表一致。

3. **无 `global` market 行，默认美国**：`WHERE market = 'global'` 返回 0 行。用户未指定国家时直接用 `market = 'us'`，答案末尾加"数据以美国市场为准"即可，**不要向用户解释"该表无 global 行"**。

4. **双向不等价**：`(app_a=X, app_b=Y)` 的 `app_a_users_using_app_b_share` 是"X 用户中用 Y 的比例"；`(app_a=Y, app_b=X)` 是"Y 用户中用 X 的比例"——两个值通常不同。不要把双向值混用或取平均。

5. **同一游戏对同一市场有 ios + android 两行**：需要跨平台合并时用 `AVG`，**不要 SUM**——overlap rate 是比例值，SUM 无意义。需要分平台展示时在 SELECT 和 GROUP BY 中保留 `o.platform`。

6. **JOIN `common.app_detail` 时 `platform` 列歧义（Error 400）**：`intelligence.sensortower_app_overlap_uid` 和 `common.app_detail` **都有 `platform` 列**。JOIN 后所有 `platform` 引用必须加表别名前缀（`o.platform`），否则 BigQuery 报 `Column name platform is ambiguous`。**所有涉及 JOIN 的 SQL，`platform` 一律写 `o.platform`。**

7. **Overlap Rate 受游戏体量影响**：大游戏天然 overlap rate 高，不代表用户偏好更强。比较不同体量游戏的"相似性"时，优先用 Affinity Score。

8. **`previous_period_diff` 可为 NULL**：游戏对首次出现时无上期数据，不要把 NULL 当 0 处理。

9. **`search_entity.py` 返回结果的 ID 选取规则**：
   - 返回 `mobile_id` → 直接用作 `unified_id_app_a` / `unified_id_app_b`，无需转换
   - 返回 `combine_id` 且同时有 `mobile_id` → 用 `mobile_id`（跨平台游戏取手游版本）
   - 只有 `pc_id` / `combine_id` 无 `mobile_id` → 该游戏无手游版本，`sensortower_app_overlap_uid` 不覆盖，直接告知用户"该表仅覆盖手游，该游戏无手游版本数据"

10. **获取游戏名需 JOIN `common.app_detail`**：
    ```sql
    LEFT JOIN common.app_detail d ON d.app_id = o.unified_id_app_b AND d.id_type = 'unified_id'
    ```
    `id_type = 'unified_id'` 过滤不可省略，否则返回多行。JOIN 后所有列引用加表别名（见 Pitfall #6）。

11. **数据更新延迟约 1 个月，直接查不要 probe**：最新数据通常为上个自然月。**不要预先执行 `MIN/MAX(start_date)` 或 schema 探查**——直接用 `start_date = DATETIME('YYYY-MM-01')` 查询。若返回空，**只重试一次**，用以下固定模板找最近有数据的月份（同时返回数据，不拆成两步）：

    ```sql
    SELECT
      o.start_date,
      o.unified_id_app_b,
      d.entity_name                                          AS game_b_name,
      ROUND(AVG(o.app_a_users_likelihood_multiplier), 2)    AS avg_affinity_score,
      ROUND(AVG(o.app_a_users_using_app_b_share) * 100, 2)  AS avg_overlap_rate_pct
    FROM intelligence.sensortower_app_overlap_uid o
    LEFT JOIN common.app_detail d
      ON d.app_id = o.unified_id_app_b AND d.id_type = 'unified_id'
    WHERE o.unified_id_app_a = '<mobile_id_A>'
      AND o.market = 'us'
    GROUP BY o.start_date, o.unified_id_app_b, d.entity_name
    ORDER BY o.start_date DESC, avg_affinity_score DESC
    LIMIT 20
    ```

    直接返回最近一个月的结果，答案中注明「用户请求的 YYYY-MM 无数据，以最近可用月份 YYYY-MM 为准」。**不要再做第三次查询。**
