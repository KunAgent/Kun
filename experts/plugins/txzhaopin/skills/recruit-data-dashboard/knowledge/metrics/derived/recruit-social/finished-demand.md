# 已完成需求数（派生指标，2 个）

> 业务过程：需求与岗位（漏斗末端）
> 数据源：`T_FLOW`，本质是计数派生（不是简单 atomic，因为同时计入活水分支）
> 强制过滤：`staff_type_id = '2'`（**不带 `flow_id` 过滤**，因为同时算社招和活水）
> **支持的运行时筛选参数**（详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md)）：
> `:begin_date` `:end_date` `:next_date`（offer 版用） `:post_id` `:post_name_cn` `:recruit_owner_id` `:org_full_name` `:work_location_id` `:mapping_position_id`
>
> 🔴 **字段口径勘误（2026-06-08）**：本文件 SQL 中所有 `is_xxx = '是'` 写法已修订完毕（数仓真实取值是中文 `'是'/'否'`，治理基线的 `is_xxx = 1` 在 StarRocks 直查时恒返回 0）。详见 [README 勘误章节](../../README.md)。
>
> 🔄 **v3.0 口径变化（2026-06-08，对齐 治理基线 新版）**：
> - **聚合方式**：`SUM(CASE WHEN ... THEN 1 ELSE 0 END)`（人次）→ **`COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)`**（按 flow_main_id 去重）
> - **管理主体筛选**：从 `manager_unit_id = '10101'` 改为 **`manager_unit_name_cn = '腾讯集团本部'`**（中文名直接匹配）
> - **国家筛选**：从「固定过滤」→ **「动态参数」**（默认 `'%中国%'`，可切全球）
> - **`:next_date` 占位符已删除**：直接用 `DATE_ADD(:end_date, INTERVAL 1 DAY)` 表达式替代
> - 详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md) v3.0 章节

| ID | 中文名 | 区分维度 |
| --- | --- | --- |
| `recruit-finish-post-onboard-cnt` | 已完成需求数（入职） | 按 hire_date / huoshui_transfer_date |
| `recruit-finish-post-offer-cnt` | 已完成需求数（offer） | 按 take_offer_time / huoshui_in_dept_approval_time |

---

> ⚠️ **v3.1 决策（2026-06-09）**：国家筛选**不再是强制过滤**，改为动态参数 `:location_country_name`（默认 `'%中国%'`，可切 `'%亚太%'`、`'%全球%'` 等）。详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md) #6。


> 🔄 **v3.2 时点边界修订（2026-06-10）**：右端从"包含 end_date"改为"不包含 end_date 的左闭右开"或反之。当前 SQL 模板已按 治理基线 新口径修订（`< DATE_ADD(:end_date, INTERVAL 1 DAY)` → `< :end_date`；`> DATE_ADD(:end_date, INTERVAL 1 DAY)` → `>= :end_date`）。
## 1. 已完成需求数（入职）`recruit-finish-post-onboard-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-finish-post-onboard-cnt` |
| 类型 | derived（多分支计数） |
| 业务过程 | 需求与岗位 → 入职 |
| 数据源 | `T_FLOW` |
| 统计口径 | 人次 |
| 时间字段 | `hire_date` 或 `huoshui_transfer_date` |
| 同义词 | 已完成需求-入职数、已入职完成需求 |

**业务定义**：在统计周期内，社招分支按 `hire_date` 完成入职 + 活水分支按 `huoshui_transfer_date` 完成调动的总人次。

**核心表达式**：
```sql
COUNT(
  CASE
    WHEN (hire_date >= :begin_date AND hire_date <= DATE_ADD(:end_date, INTERVAL 1 DAY) AND is_entry = '是')
      OR (huoshui_transfer_date >= :begin_date AND huoshui_transfer_date <= DATE_ADD(:end_date, INTERVAL 1 DAY))
    THEN 1
    ELSE NULL
  END
)
```

**为什么归入 derived 而非 atomic**：
- 包含两个分支（社招 + 活水），不是单一原子事件
- 但本质上是 OR 条件的复合计数，可视为"准原子"

**血缘下游**：
- `recruit-total-post-count`（总需求数）加数 2

**注意事项**：
- ⚠️ 不带 `flow_id` 过滤（因为同时算社招和活水），与其他社招指标不同
- ⚠️ 与 `recruit-entry-cnt`（仅社招分支）的区别：本指标含活水

---

## 2. 已完成需求数（offer）`recruit-finish-post-offer-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-finish-post-offer-cnt` |
| 类型 | derived |
| 业务过程 | 需求与岗位 → 发送 offer |
| 数据源 | `T_FLOW` |
| 时间字段 | `take_offer_time`（社招） / `huoshui_in_dept_approval_time`（活水） |

**业务定义**：在统计周期内，候选人接受 offer（社招）或调入部门审批通过（活水）的总人次。

**核心表达式**：
```sql
COUNT(
  CASE
    WHEN (take_offer_time >= :begin_date AND take_offer_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
          AND flow_id = 3
          AND (state_id NOT IN (5, 6)
               OR (state_id IN (5, 6) AND flow_end_time > DATE_ADD(:end_date, INTERVAL 1 DAY))))   -- 🔴 v3.10：治理基线 Row 5 原档明确写 ">"（不是 ">="）
      OR (huoshui_in_dept_approval_time >= :begin_date AND huoshui_in_dept_approval_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
          AND flow_id = 5
          AND (state_id NOT IN (11)
               OR (state_id = 11 AND flow_end_time > DATE_ADD(:end_date, INTERVAL 1 DAY))))         -- 🔴 v3.10：同上
    THEN 1
    ELSE NULL
  END
)
```

> 🔴 **v3.10 修订（2026-06-11）**：把 `flow_end_time >= DATE_ADD(end,1)` 改回 `> DATE_ADD(end,1)`，与 治理基线 Row 5 原档一致（注意：A4 是少有的 治理基线 用 `>` 而非 `>=` 的场景）。之前 v3.8 误判 statistically 统一为 `>=` 是错的。recipe 卡 card-A § A4 已经是正确的 `>`，本卡跟随。

**注意事项**：
- 复杂分支语义：state_id 在"放弃"类时（5/6/11），仍算入"已完成 offer"，前提是 flow_end_time **>** :end_date（即 :end_date 之后才结束）
- 这种"放弃前已发 offer"的口径需要业务对齐
- ⚠️ `flow_end_time > end_date` 是 治理基线 故意写的 `>`（不是 `>=`），不要"统一"成 `>=`
