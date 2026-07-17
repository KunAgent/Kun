# v3.2 变更日志（2026-06-10）

> 基于 治理基线 二次更新（2026-06-10），全部按 治理基线 新口径采纳

## 决策回顾

| 决策 | 内容 | 影响 |
| --- | --- | --- |
| **N1** | 时点边界：`<=`/`>` → `<`/`>=`（右端开闭翻转） | 7 个时点快照类指标 |
| **N2** | 占位符规范化："查询日期" → `end_date` | 1 个指标（社招在招需求数，仅文案） |
| **N3** | 渠道收到评估数：取值逻辑大改（`arrive_time` → `flow_create_time` + `flow_end_time` 双条件） | 1 个原子指标 |
| **N4** | 笔误修正：`= 是` 缺空格 → 自动统一为带空格 | 1 个指标，无业务影响 |

## 变更明细

### N1：时点边界翻转

**SQL 模板修订**：所有 `< DATE_ADD(:end_date, INTERVAL 1 DAY)` → `< :end_date`；所有 `> DATE_ADD(:end_date, INTERVAL 1 DAY)` → `>= :end_date`。

**业务影响**：
- `end_date` 当天已发生的事件**不再算入**（左端不含）
- `end_date` 当天还在跑的流程**算入**（右端含）

**修订文件**：
| 文件 | 修订处数 |
| --- | --- |
| `.knowledge/metrics/derived/recruit-social/snapshot-stages.md` | 20 处（7 < + 13 >） |
| `.knowledge/metrics/derived/recruit-social/finished-demand.md` | 4 处 |
| `.knowledge/metrics/derived/recruit-social/on-going-post.md` | 3 处 |

**修订前后对比**（以"入职中/调动中"为例）：
```sql
-- 修订前（v3.1）
WHEN take_offer_time < DATE_ADD(:end_date, INTERVAL 1 DAY)    -- 等价于 <= end_date
 AND (hire_date > DATE_ADD(:end_date, INTERVAL 1 DAY) OR hire_date IS NULL)  -- 比 治理基线 还严格

-- 修订后（v3.2）
WHEN take_offer_time < :end_date
 AND (hire_date >= :end_date OR hire_date IS NULL)
```

⚠️ **重要发现**：v3.1 的 `hire_date > DATE_ADD(:end_date, INTERVAL 1 DAY)` 等价于 `hire_date > end_date+1天`，比 治理基线 v3.1 的 `> end_date` 还严格一天。v3.2 修订一次性纠正了这个 bug。

### N3：渠道收到评估数 - 业务口径大改

**修订位置**：`.knowledge/metrics/atomic/recruit-social/resume-assess-count.md` § 2

**口径变化**：
| 维度 | v3.1 旧 | v3.2 新 |
| --- | --- | --- |
| 时间字段 | `arrive_time`（简历到达时间）| `flow_create_time`（流程创建时间）|
| 时间窗 | `arrive_time` 落在 [begin, end+1天) 区间 | `flow_create_time >= begin_date` |
| 流程状态 | 不区分 | 区分两类：`flow_end_time` 在窗内已结束 / 仍在跑（`IS NULL`）|

**新 SQL**：
```sql
COUNT(DISTINCT CASE
  WHEN flow_create_time >= :begin_date
   AND (
        (flow_end_time IS NOT NULL AND flow_end_time < :end_date)
     OR (flow_end_time IS NULL)
   )
  THEN flow_main_id
END)
```

**对存量看板的影响**：
- 旧 BI 报表用 `arrive_time` 算 → 数值会**显著不同**（流程创建到简历到达可能有时差）
- 业务方需重新对账确认

### N2/N4：文案级（无业务影响）

- N2：取值逻辑里的"查询日期"统一改成 `end_date` —— 仅文案统一，SQL 模板里早就是 `:end_date`
- N4：`is_send_offer = 是` vs `=是`（缺空格） —— 治理基线 笔误，SQL 等价

## 已知勘误（自动跳过）

51 处自动识别为已知勘误，无需用户拍板：
- `is_xxx = 1` → `is_xxx = 是`（19 处）
- groupby 字段前缀化简（31 处）
- 取值逻辑文案 `is_xxx = 1` → `= 是`（1 处）

## 下次同步

```bash
python3 Recruit_data_dashboard/scripts/sync_knowledge.py
```

将本次 .knowledge/ 修订同步到 Recruit_data_dashboard/knowledge/。
