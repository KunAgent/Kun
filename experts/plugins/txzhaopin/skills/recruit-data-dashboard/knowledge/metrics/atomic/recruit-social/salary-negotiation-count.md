# HR 薪资谈判节点原子指标

> 业务过程：HR 薪资谈判
> 数据源：`T_FLOW` = `catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail`
> 强制过滤：`staff_type_id = '2' AND flow_id = 3`
> **支持的运行时筛选参数**（详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md)）：
> `:begin_date` `:end_date` `:post_id` `:post_name_cn` `:recruit_owner_id` `:channel_id` `:org_full_name` `:work_location_id` `:mapping_position_id`
>
> 🔴 **v3.4 强制参数（2026-06-10 强化，必带，按 治理基线）**：
> - **`:location_country_name`**（默认 `'%中国%'`，可改 `'%亚太%'` 等；治理基线列在「固定查询条件」+「动态查询条件」双重声明，**必带**）
> - **`:manager_unit_name_cn`**（默认 `'腾讯集团本部'`，可改具体子公司主体；治理基线列在「动态查询条件」默认必带）
>
> ⚠️ **使用片段 SQL 时**：本卡的"核心表达式"是聚合表达式片段（`COUNT(DISTINCT CASE...)`），靠**外层 SELECT/WHERE** 提供强制过滤。直接复制时**必须**在外层 WHERE 中加：
> ```sql
> WHERE staff_type_id = '2' AND flow_id = 3
>   AND location_country_name LIKE :location_country_name      -- 默认 '%中国%'
>   AND manager_unit_name_cn = :manager_unit_name_cn            -- 默认 '腾讯集团本部'
> ```
>
> 🔴 **字段口径勘误（2026-06-08）**：本文件 SQL 中所有 `is_xxx = '是'` 写法已修订完毕（数仓真实取值是中文 `'是'/'否'`，治理基线的 `is_xxx = 1` 在 StarRocks 直查时恒返回 0）。详见 [README 勘误章节](../../README.md)。

3 个原子指标：

| ID | 中文名 | 时间字段 | 标志位 |
| --- | --- | --- | --- |
| `recruit-hr-salary-negotiation-pass-cnt` | 薪资谈判通过数 | `hr_salary_negotiation_time` | （非空判断） |
| `recruit-start-hr-salary-negotiation-cnt` | 发起薪资谈判数 | `hr_salary_negotiation_time` | `is_hr_salary_negotiation = '是'` |
| `recruit-start-hr-salary-negotiation-no-submit-cnt` | 发起薪资谈判未提交数 | `hr_salary_negotiation_time` | `is_hr_salary_negotiation_no_submit = '是'` |

> ⚠️ **B7 别名说明**：治理口径原文中 SELECT 别名为 `hr_salary_negotiation_cnt`，但 C6 公式引用为 `hr_salary_negotiation_pass_cnt`。本治理库**统一标准为 `recruit-hr-salary-negotiation-pass-cnt`**（"通过数"语义更清晰），并在 SQL 模板中显式 `AS hr_salary_negotiation_pass_cnt`。
>
> 🔄 **v3.0 口径变化（2026-06-08，对齐 治理基线 新版）**：聚合方式从 `COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)`（人次）→ **`COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)`**（按流程主键去重的人数）。多数场景两口径结果接近，严格按 v3.0 业务口径应使用 DISTINCT。下方 SQL 模板沿用 v2.x 写法供兼容；新查询建议改用 DISTINCT。
> 🔄 **v3.0 参数变化**：管理主体改用 `manager_unit_name_cn`（中文名）；国家从「固定过滤」→「动态参数」（默认 `'%中国%'`，可切全球）。详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md) v3.0 章节。

---

> ⚠️ **v3.1 决策（2026-06-09）**：国家筛选**不再是强制过滤**，改为动态参数 `:location_country_name`（默认 `'%中国%'`，可切 `'%亚太%'`、`'%全球%'` 等）。详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md) #6。

## 1. 薪资谈判通过数 `recruit-hr-salary-negotiation-pass-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-hr-salary-negotiation-pass-cnt` |
| 类型 | atomic |
| 业务过程 | HR 薪资谈判 |
| 数据源 | `T_FLOW` |
| 关键字段 | `hr_salary_negotiation_time` |
| 统计口径 | 人次 |
| 时间字段 | `hr_salary_negotiation_time` |
| 同义词 | HR 薪谈通过数、薪谈通过数、salary negotiation pass count |

**业务定义**：候选人完成 HR 薪资谈判（即 `hr_salary_negotiation_time` 非空）的人次。

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN hr_salary_negotiation_time IS NOT NULL
         AND hr_salary_negotiation_time >= :begin_date
         AND hr_salary_negotiation_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：被 `recruit-hr-salary-negotiation-rate`（HR 薪资谈判通过率）作为分子。

---

## 2. 发起薪资谈判数 `recruit-start-hr-salary-negotiation-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-start-hr-salary-negotiation-cnt` |
| 类型 | atomic |
| 关键字段 | `is_hr_salary_negotiation`、`hr_salary_negotiation_time` |

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN is_hr_salary_negotiation = '是'
         AND hr_salary_negotiation_time >= :begin_date
         AND hr_salary_negotiation_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：被 `recruit-offer-approval-rate`（进入 offer 审批率）作为分母基数。

---

## 3. 发起薪资谈判未提交数 `recruit-start-hr-salary-negotiation-no-submit-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-start-hr-salary-negotiation-no-submit-cnt` |
| 类型 | atomic |
| 关键字段 | `is_hr_salary_negotiation_no_submit`、`hr_salary_negotiation_time` |

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN is_hr_salary_negotiation_no_submit = '是'
         AND hr_salary_negotiation_time >= :begin_date
         AND hr_salary_negotiation_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：作为 `recruit-hr-salary-negotiation-rate` 和 `recruit-offer-approval-rate` 的分母扣除项。
