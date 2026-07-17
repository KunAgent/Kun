# 放弃/拒绝节点原子指标

> 业务过程：放弃/拒绝（含 turndown 和 拒 offer 两类）
> 数据源：`T_FLOW` = `catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail`
> 强制过滤：`staff_type_id = '2' AND flow_id = 3`
> **支持的运行时筛选参数**（详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md)）：
> `:begin_date` `:end_date` `:next_date`（A11/A12 用 `:next_date` 边界） `:post_id` `:post_name_cn` `:recruit_owner_id` `:org_full_name` `:work_location_id` `:mapping_position_id`
>
> 🔴 **字段口径勘误（2026-06-08）**：本文件 SQL 中所有 `is_xxx = '是'` 写法已修订完毕（数仓真实取值是中文 `'是'/'否'`，治理基线的 `is_xxx = 1` 在 StarRocks 直查时恒返回 0）。详见 [README 勘误章节](../../README.md)。
>
> 🔄 **v3.0 口径变化（2026-06-08，对齐 治理基线 新版）**：聚合方式从 `COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)`（人次）→ **`COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)`**（按流程主键去重的人数）。多数场景两口径结果接近，严格按 v3.0 业务口径应使用 DISTINCT。下方 SQL 模板沿用 v2.x 写法供兼容；新查询建议改用 DISTINCT。
> 🔄 **v3.0 参数变化**：管理主体改用 `manager_unit_name_cn`（中文名）；国家从「固定过滤」→「动态参数」（默认 `'%中国%'`，可切全球）。详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md) v3.0 章节。

2 个原子指标：

| ID | 中文名 | 业务节点 | 时间字段 |
| --- | --- | --- | --- |
| `recruit-turndown-cnt` | 口头 turndown | 薪谈环节放弃 / 通过薪谈但未发 offer | `hr_salary_negotiation_process_time` / `flow_end_time` |
| `recruit-offer-giveup-cnt` | 拒绝 offer | 已发 offer 但候选人放弃 | `offer_giveup_time` |

---

> ⚠️ **v3.1 决策（2026-06-09）**：国家筛选**不再是强制过滤**，改为动态参数 `:location_country_name`（默认 `'%中国%'`，可切 `'%亚太%'`、`'%全球%'` 等）。详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md) #6。

## 1. 口头 turndown `recruit-turndown-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-turndown-cnt` |
| 类型 | atomic |
| 业务过程 | 放弃/拒绝 → 薪谈阶段 |
| 关键字段 | `hr_salary_negotiation_process_time`、`hr_salary_negotiation_state`、`is_know_salary_data`、`send_offer_time`、`flow_end_time` |
| 同义词 | turndown、口头放弃 |

**业务定义**：候选人在 HR 薪资谈判阶段口头表示放弃，或薪谈通过但最终未发出 offer 的人次。

**核心表达式**：
```sql
SUM(
  CASE
    WHEN hr_salary_negotiation_process_time >= :begin_date
     AND hr_salary_negotiation_process_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND hr_salary_negotiation_state = '放弃'
     AND is_know_salary_data = '是'
    THEN 1
    WHEN hr_salary_negotiation_state = '通过'
     AND send_offer_time IS NULL
     AND flow_end_time >= :begin_date
     AND flow_end_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN 1
    ELSE 0
  END
)
```

**血缘下游**：无（独立呈现）

**业务说明**：包含两种场景：
1. 薪谈阶段直接表示放弃
2. 薪谈通过但最终没发 offer（候选人原因导致流程结束）

---

## 2. 拒绝 offer `recruit-offer-giveup-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-offer-giveup-cnt` |
| 类型 | atomic |
| 业务过程 | 放弃/拒绝 → offer 后 |
| 关键字段 | `offer_giveup_time`、`huoshui_giveup_time` |
| 同义词 | offer 放弃、放弃 offer、offer giveup count |

**业务定义**：HR 已发出 offer 后，候选人正式拒绝（或活水放弃）的人次。

**核心表达式**：
```sql
SUM(
  CASE
    WHEN offer_giveup_time >= :begin_date AND offer_giveup_time < DATE_ADD(:end_date, INTERVAL 1 DAY) THEN 1
    WHEN huoshui_giveup_time >= :begin_date AND huoshui_giveup_time < DATE_ADD(:end_date, INTERVAL 1 DAY) THEN 1
    ELSE 0
  END
)
```

**血缘下游**：无（独立呈现）
