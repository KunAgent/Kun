# 入职节点原子指标

> 业务过程：入职
> 数据源：`T_FLOW` = `catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail`
> 强制过滤：`staff_type_id = '2' AND flow_id = 3`
> **支持的运行时筛选参数**（详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md)）：
> `:begin_date` `:end_date` `:post_id` `:post_name_cn` `:recruit_owner_id` `:channel_id` `:org_full_name` `:work_location_id` `:mapping_position_id`
>
> 🔴 **字段口径勘误（2026-06-08）**：本文件 SQL 中所有 `is_xxx = '是'` 写法已修订完毕（数仓真实取值是中文 `'是'/'否'`，治理基线的 `is_xxx = 1` 在 StarRocks 直查时恒返回 0）。详见 [README 勘误章节](../../README.md)。
>
> 🔄 **v3.0 口径变化（2026-06-08，对齐 治理基线 新版）**：聚合方式从 `COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)`（人次）→ **`COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)`**（按流程主键去重的人数）。多数场景两口径结果接近，严格按 v3.0 业务口径应使用 DISTINCT。下方 SQL 模板沿用 v2.x 写法供兼容；新查询建议改用 DISTINCT。
> 🔄 **v3.0 参数变化**：管理主体改用 `manager_unit_name_cn`（中文名）；国家从「固定过滤」→「动态参数」（默认 `'%中国%'`，可切全球）。详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md) v3.0 章节。

1 个原子指标。

---

> ⚠️ **v3.1 决策（2026-06-09）**：国家筛选**不再是强制过滤**，改为动态参数 `:location_country_name`（默认 `'%中国%'`，可切 `'%亚太%'`、`'%全球%'` 等）。详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md) #6。

## 入职数 `recruit-entry-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-entry-cnt` |
| 类型 | atomic |
| 业务过程 | 入职 |
| 数据源 | `T_FLOW` |
| 关键字段 | `is_entry`、`hire_date` |
| 统计口径 | 人次（按 hire_date） |
| 时间字段 | `hire_date` |
| 强制过滤 | `staff_type_id='2' AND flow_id=3` |
| 同义词 | 社招入职数、入职人次、entry count |
| 业务负责人 | 招活产研 |

**业务定义**：在统计周期内（按 hire_date），通过社招流程实际入职的候选人人次。

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN is_entry = '是'
         AND hire_date >= :begin_date
         AND hire_date < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：
- `recruit-entry-rate`（入职率）分子
- `recruit-finish-post-onboard-cnt`（已完成需求数-入职）的核心组成（派生指标）

**注意事项**：
- 本指标**不去重**：理论上一个候选人 hire_date 只会有 1 个，但若有改派/重新入职等异常，会被多次计算
- 本指标**只统计社招分支**（`flow_id=3`）；活水分支用 `huoshui_transfer_date` 字段，属另一指标
