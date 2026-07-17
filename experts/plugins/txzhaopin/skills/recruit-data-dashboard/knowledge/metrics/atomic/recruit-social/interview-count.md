# 面试节点原子指标

> 业务过程：发起面试 → 部门内专业面试 → 通道面委面试 → 用人决策面试 → HR 资格面试
> 数据源：`T_FLOW` = `catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail`
> **强制过滤（v3.0 简化）**：`staff_type_id = '2' AND flow_id = 3`
> **运行时筛选参数**（v3.0，详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md)）：
> `:begin_date` `:end_date` `:manager_unit_name_cn`（默认 `'腾讯集团本部'`） `:location_country_name`（默认 `'%中国%'`，从固定→动态） `:post_id` `:post_name_cn` `:recruit_owner` `:mapping_position_name` `:recruit_post_org_full_name` `:is_disabled_name`
>
> 🔴 **字段口径勘误（已修订）**：StarRocks 中所有 `is_xxx` 字段的取值是 **`'是' / '否'`**（中文字符串，非数字 `1/0`）。本文件 SQL 模板已统一为 `is_xxx = '是'`。
>
> 🔄 **v3.0 口径变化**（2026-06-08 对齐 治理基线 新版）：
> - **聚合方式**：`COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)`（人次）→ **`COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)`**（按流程主键去重的人数）
> - **业务影响**：同一候选人多个流程会被去重为 1。在多数实测场景两口径结果接近（流程 ID 1:1 时完全等价），但严格按 v3.0 业务口径**应使用 DISTINCT**。
> - 下方 SQL 同时给出**两版**：`v3.0` 标准（DISTINCT，推荐）和 `v2.x` 历史（SUM(CASE)，兼容）。

11 个原子指标全景：

| ID | 中文名 | 时间字段 | 标志位 |
| --- | --- | --- | --- |
| `recruit-start-intv-cnt` | 发起面试数 | `start_intv_time` | `is_start_intv = '是'` |
| `recruit-dept-professional-intv-cnt` | 部门内专业面试通过数 | `dept_professional_intv_time` | `is_dept_professional_intv = '是'` |
| `recruit-cf-intv-cnt` | 通道面委面试通过数 | `cf_intv_time` | `is_cf_intv = '是'` |
| `recruit-dm-intv-cnt` | 用人决策面试通过数 | `dm_intv_time` | `is_dm_intv = '是'` |
| `recruit-hr-intv-cnt` | HR 资格面试通过数 | `hr_intv_time` | `is_hr_intv = '是'` |
| `recruit-start-dept-professional-intv-cnt` | 发起部门内专业面试数 | `start_dept_professional_intv_time` | `is_start_dept_professional_intv = '是'` |
| `recruit-start-dept-professional-intv-no-submit-cnt` | 发起部门内专业面试未提交数 | `start_dept_professional_intv_time` | `is_dept_professional_intv_no_submit = '是'` |
| `recruit-start-cf-intv-cnt` | 发起通道面委面试数 | `start_cf_intv_time` | `is_start_cf_intv = '是'` |
| `recruit-start-cf-intv-no-submit-cnt` | 发起通道面委面试未提交数 | `start_cf_intv_time` | `is_cf_intv_no_submit = '是'` |
| `recruit-start-dm-intv-cnt` | 发起用人决策面试数 | `start_dm_intv_time` | `is_start_dm_intv = '是'` |
| `recruit-start-dm-intv-no-submit-cnt` | 发起用人决策面试未提交数 | `start_dm_intv_time` | `is_dm_intv_no_submit = '是'` |
| `recruit-start-hr-intv-cnt` | 发起 HR 资格面试数 | `start_hr_intv_time` | `is_start_hr_intv = '是'` |
| `recruit-start-hr-intv-no-submit-cnt` | 发起 HR 资格面试未提交数 | `start_hr_intv_time` | `is_hr_intv_no_submit = '是'` |

> 说明：上表实际 13 个，以 `_README.md` 「11」是按业务节点粒度（5 类面试通过 + 总发起 + 5 类面试发起 = 11 项核心；另 5 项"未提交"是辅助），均归入本文件。

---

> ⚠️ **v3.1 决策（2026-06-09）**：国家筛选**不再是强制过滤**，改为动态参数 `:location_country_name`（默认 `'%中国%'`，可切 `'%亚太%'`、`'%全球%'` 等）。详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md) #6。

## 1. 发起面试数 `recruit-start-intv-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-start-intv-cnt` |
| 类型 | atomic |
| 业务过程 | 发起面试 |
| 数据源 | `T_FLOW` |
| 关键字段 | `is_start_intv`、`start_intv_time` |
| 统计口径 | 人次（不去重） |
| 时间字段 | `start_intv_time` |
| 强制过滤 | `staff_type_id='2' AND flow_id=3` |
| 同义词 | 发起面试人次、started interview count |
| 业务负责人 | 招活产研 |
| 接入时间 | 2026-06-07 |
| 来源 治理基线 | 卡片 B-发起面试数 |

**业务定义**：在统计周期内，社招候选人发起面试流程的**人数（按 `flow_main_id` 去重）**。

**核心表达式（v3.0 推荐 - DISTINCT 口径）**：
```sql
COUNT(DISTINCT CASE
  WHEN is_start_intv = '是'
   AND start_intv_time >= :begin_date
   AND start_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
  THEN flow_main_id
END)
```

**v2.x 历史表达式（SUM CASE 人次口径，兼容保留）**：
```sql
SUM(CASE WHEN is_start_intv = '是'
         AND start_intv_time >= :begin_date
         AND start_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN 1 ELSE 0 END)
```

**实测对比**（2026-06-08，集团 YTD）：两口径结果均为 **29,052**（在该数据集 `flow_main_id` 1:1，等价）。

**血缘下游**：无（独立呈现，不被率指标引用）

---

## 2. 部门内专业面试通过数 `recruit-dept-professional-intv-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-dept-professional-intv-cnt` |
| 类型 | atomic |
| 业务过程 | 部门内专业面试 |
| 数据源 | `T_FLOW` |
| 关键字段 | `is_dept_professional_intv`、`dept_professional_intv_time` |
| 统计口径 | 人次 |
| 时间字段 | `dept_professional_intv_time` |
| 同义词 | 部门内面试通过数、dept professional pass count |

**业务定义**：在统计周期内，候选人通过"部门内专业面试"环节的人次。

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN is_dept_professional_intv = '是'
         AND dept_professional_intv_time >= :begin_date
         AND dept_professional_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：被 `recruit-dept-professional-intv-rate`（部门内面试通过率）作为分子引用。

---

## 3. 通道面委面试通过数 `recruit-cf-intv-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-cf-intv-cnt` |
| 类型 | atomic |
| 业务过程 | 通道面委面试 |
| 关键字段 | `is_cf_intv`、`cf_intv_time` |
| 同义词 | 通道面试通过数、面委面试通过数、cf pass count |

**业务定义**：候选人通过"通道（专业通道）+ 面委（面试委员会）面试"环节的人次。

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN is_cf_intv = '是'
         AND cf_intv_time >= :begin_date
         AND cf_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：被 `recruit-cf-intv-rate` 作为分子。

---

## 4. 用人决策面试通过数 `recruit-dm-intv-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-dm-intv-cnt` |
| 类型 | atomic |
| 业务过程 | 用人决策面试 |
| 关键字段 | `is_dm_intv`、`dm_intv_time` |
| 同义词 | DM 面试通过数、decision maker pass count |

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN is_dm_intv = '是'
         AND dm_intv_time >= :begin_date
         AND dm_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：被 `recruit-dm-intv-rate` 作为分子。

---

## 5. HR 资格面试通过数 `recruit-hr-intv-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-hr-intv-cnt` |
| 类型 | atomic |
| 业务过程 | HR 资格面试 |
| 关键字段 | `is_hr_intv`、`hr_intv_time` |
| 同义词 | HR 面试通过数、HR 资面通过数 |

**业务定义**：候选人通过 HR 资格审查面试的人次。HR 资面通常是社招最终环节（之后进薪谈/offer）。

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN is_hr_intv = '是'
         AND hr_intv_time >= :begin_date
         AND hr_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：
- `recruit-hr-intv-rate`（HR 资格面试通过率）作分子
- `recruit-hr-salary-negotiation-rate`（HR 薪资谈判通过率）作**分母基数**（薪谈通过 / HR 资面通过）

---

## 6. 发起部门内专业面试数 `recruit-start-dept-professional-intv-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-start-dept-professional-intv-cnt` |
| 类型 | atomic |
| 业务过程 | 部门内专业面试 |
| 关键字段 | `is_start_dept_professional_intv`、`start_dept_professional_intv_time` |

**业务定义**：在统计周期内，候选人发起"部门内专业面试"环节的人次（发起≠通过，是分母）。

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN is_start_dept_professional_intv = '是'
         AND start_dept_professional_intv_time >= :begin_date
         AND start_dept_professional_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：作为 `recruit-dept-professional-intv-rate` 的分母基数（分母 = 发起数 - 未提交数）。

---

## 7. 发起部门内专业面试未提交数 `recruit-start-dept-professional-intv-no-submit-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-start-dept-professional-intv-no-submit-cnt` |
| 类型 | atomic |
| 业务过程 | 部门内专业面试 |
| 关键字段 | `is_dept_professional_intv_no_submit`、`start_dept_professional_intv_time` |

**业务定义**：发起了"部门内专业面试"但**面试官尚未提交评价**的人次。比率分母里需扣除这部分。

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN is_dept_professional_intv_no_submit = '是'
         AND start_dept_professional_intv_time >= :begin_date
         AND start_dept_professional_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：从 `recruit-dept-professional-intv-rate` 的分母中**减去**。

---

## 8. 发起通道面委面试数 `recruit-start-cf-intv-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-start-cf-intv-cnt` |
| 类型 | atomic |
| 关键字段 | `is_start_cf_intv`、`start_cf_intv_time` |

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN is_start_cf_intv = '是'
         AND start_cf_intv_time >= :begin_date
         AND start_cf_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：`recruit-cf-intv-rate` 分母基数。

---

## 9. 发起通道面委面试未提交数 `recruit-start-cf-intv-no-submit-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-start-cf-intv-no-submit-cnt` |
| 类型 | atomic |
| 关键字段 | `is_cf_intv_no_submit`、`start_cf_intv_time` |

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN is_cf_intv_no_submit = '是'
         AND start_cf_intv_time >= :begin_date
         AND start_cf_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：`recruit-cf-intv-rate` 分母扣除项。

---

## 10. 发起用人决策面试数 `recruit-start-dm-intv-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-start-dm-intv-cnt` |
| 类型 | atomic |
| 关键字段 | `is_start_dm_intv`、`start_dm_intv_time` |

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN is_start_dm_intv = '是'
         AND start_dm_intv_time >= :begin_date
         AND start_dm_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：`recruit-dm-intv-rate` 分母基数。

---

## 11. 发起用人决策面试未提交数 `recruit-start-dm-intv-no-submit-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-start-dm-intv-no-submit-cnt` |
| 类型 | atomic |
| 关键字段 | `is_dm_intv_no_submit`、`start_dm_intv_time` |

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN is_dm_intv_no_submit = '是'
         AND start_dm_intv_time >= :begin_date
         AND start_dm_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：`recruit-dm-intv-rate` 分母扣除项。

---

## 12. 发起 HR 资格面试数 `recruit-start-hr-intv-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-start-hr-intv-cnt` |
| 类型 | atomic |
| 关键字段 | `is_start_hr_intv`、`start_hr_intv_time` |

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN is_start_hr_intv = '是'
         AND start_hr_intv_time >= :begin_date
         AND start_hr_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：`recruit-hr-intv-rate` 分母基数。

---

## 13. 发起 HR 资格面试未提交数 `recruit-start-hr-intv-no-submit-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-start-hr-intv-no-submit-cnt` |
| 类型 | atomic |
| 关键字段 | `is_hr_intv_no_submit`、`start_hr_intv_time` |

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN is_hr_intv_no_submit = '是'
         AND start_hr_intv_time >= :begin_date
         AND start_hr_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：`recruit-hr-intv-rate` 分母扣除项。
