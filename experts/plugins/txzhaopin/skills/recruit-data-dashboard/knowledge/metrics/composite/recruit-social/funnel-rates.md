# 漏斗通过率（9 个复合指标）

> 业务过程：招聘漏斗的各环节通过率
> 数据源：依赖 `atomic/recruit-social/` 下的原子指标，无独立数据源
> 兜底：分母为 0 时返回 0
> **支持的运行时筛选参数**：与依赖的原子指标保持完全一致（**分子分母同参数同时间窗**），具体参数见对应 atomic 文件 banner；详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md)。
> ⚠️ **铁律**：复合比率指标的所有原子分量必须使用**完全相同的筛选参数**，否则会产生"率 > 100%"等异常。
>
> 🔴 **v3.4 强制参数（2026-06-10 强化，必带）**：因为本文件全部 9 个指标分子分母都用 T_FLOW 表，所以分子分母 SQL **均必须带**：
> - **`location_country_name LIKE :location_country_name`**（默认 `'%中国%'`，按 治理基线「固定查询条件」+「动态查询条件」双重要求）
> - **`manager_unit_name_cn = :manager_unit_name_cn`**（默认 `'腾讯集团本部'`）
> - `staff_type_id = '2'` AND `flow_id = 3`
>
> 例如 `recruit-hr-intv-rate` 的拼装：
> ```sql
> SELECT 
>   COUNT(DISTINCT CASE WHEN is_hr_intv = '是' AND hr_intv_time >= :begin_date AND hr_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY) THEN flow_main_id END) * 1.0
>   /
>   NULLIF(
>     COUNT(DISTINCT CASE WHEN is_start_hr_intv = '是' AND start_hr_intv_time >= :begin_date AND start_hr_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY) THEN flow_main_id END)
>     - COUNT(DISTINCT CASE WHEN is_hr_intv_no_submit = '是' AND start_hr_intv_time >= :begin_date AND start_hr_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY) THEN flow_main_id END)
>     , 0
>   ) AS hr_intv_rate
> FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
> WHERE staff_type_id = '2' 
>   AND flow_id = 3
>   AND location_country_name LIKE :location_country_name        -- 必带
>   AND manager_unit_name_cn = :manager_unit_name_cn              -- 必带
> ```

| ID | 中文名 | 公式 |
| --- | --- | --- |
| `recruit-channel-start-interview-rate` | 渠道发起面试率 | 渠道发起面试数 / (渠道收到评估数 - 评估中数) |
| `recruit-dept-professional-intv-rate` | 部门内面试通过率 | 部门内通过数 / (发起部门内 - 发起部门内未提交) |
| `recruit-cf-intv-rate` | 通道面委面试通过率 | 通道面委通过数 / (发起通道面委 - 发起通道面委未提交) |
| `recruit-dm-intv-rate` | 用人决策面试通过率 | 用人决策通过数 / (发起用人决策 - 发起用人决策未提交) |
| `recruit-hr-intv-rate` | HR 资格面试通过率 | HR 通过数 / (发起 HR - 发起 HR 未提交) |
| `recruit-hr-salary-negotiation-rate` | HR 薪资谈判通过率 | 薪谈通过数 / (HR 通过数 - 薪谈未提交数) |
| `recruit-offer-approval-rate` | 进入 offer 审批率 | offer 审批中人数 / (薪谈数 - 薪谈未提交数) |
| `recruit-send-offer-rate` | 发送 offer 率 | 发送 offer 数 / (发起 offer 审批 - offer 审批未提交) |
| `recruit-entry-rate` | 入职率 | 入职数 / 发送 offer 数 |

---

## 1. 渠道发起面试率 `recruit-channel-start-interview-rate`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-channel-start-interview-rate` |
| 类型 | composite（比率） |
| 业务过程 | 简历评估 → 发起面试 |
| 统计口径 | 百分比（0~1） |
| 兜底 | 分母为 0 → 返回 0 |
| 数据源 | 依赖原子，跨表（T_ASSESS + T_FLOW） |

**业务定义**：渠道收到的简历中，最终发起面试的比例。

**公式（v3.0 标准）**：
```
渠道发起面试率 = 渠道发起面试数 ÷ (渠道收到评估数 − 渠道收到简历未评估数)
```

**depends_on**（v3.0）：
- 分子：`recruit-resume-assess-intv-cnt`（来自 T_FLOW）
- 分母：`recruit-channel-resume-assess-cnt` − `recruit-channel-resume-not-assessed-cnt`（**v3.0 新增**："渠道收到简历未评估数"作为独立原子指标，详见 [`atomic/recruit-social/resume-assess-count.md`](../../atomic/recruit-social/resume-assess-count.md)）

> 🔄 **v3.0 vs v2.x**：v2.x 用"评估中"派生指标作为分母扣除项；v3.0 改用专门的"渠道收到简历未评估数"原子指标，定义更清晰。

**口径表达式**：
```sql
COALESCE(
  CASE
    WHEN <channel_cnt> - <resume_assessing_cnt> <> 0
      THEN CAST(<resume_assess_intv_cnt> AS DECIMAL)
           / (<channel_cnt> - <resume_assessing_cnt>)
    ELSE 0
  END, 0
) AS recruit_channel_start_interview_rate
```

**注意**：本指标涉及跨表 JOIN，"评估中"派生指标在 治理基线中未单独定义，使用前需对齐口径（详见 derived/）。

---

## 2. 部门内面试通过率 `recruit-dept-professional-intv-rate`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-dept-professional-intv-rate` |
| 类型 | composite（比率） |
| 业务过程 | 部门内专业面试 |

**公式**：
```
部门内面试通过率 = 部门内通过数 / (发起部门内 - 发起部门内未提交)
```

**depends_on**：
- 分子：`recruit-dept-professional-intv-cnt`
- 分母：`recruit-start-dept-professional-intv-cnt` − `recruit-start-dept-professional-intv-no-submit-cnt`

**口径表达式**：
```sql
COALESCE(
  CASE WHEN <start_dept_professional_intv_cnt> - <start_dept_professional_intv_no_submit_cnt> <> 0
    THEN CAST(<dept_professional_intv_cnt> AS DECIMAL)
         / (<start_dept_professional_intv_cnt> - <start_dept_professional_intv_no_submit_cnt>)
    ELSE 0
  END, 0
)
```

---

## 3. 通道面委面试通过率 `recruit-cf-intv-rate`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-cf-intv-rate` |
| 类型 | composite |
| 业务过程 | 通道面委面试 |

**depends_on**：
- 分子：`recruit-cf-intv-cnt`
- 分母：`recruit-start-cf-intv-cnt` − `recruit-start-cf-intv-no-submit-cnt`

**口径表达式**：
```sql
COALESCE(
  CASE WHEN <start_cf_intv_cnt> - <start_cf_intv_no_submit_cnt> <> 0
    THEN CAST(<cf_intv_cnt> AS DECIMAL)
         / (<start_cf_intv_cnt> - <start_cf_intv_no_submit_cnt>)
    ELSE 0
  END, 0
)
```

---

## 4. 用人决策面试通过率 `recruit-dm-intv-rate`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-dm-intv-rate` |
| 类型 | composite |
| 业务过程 | 用人决策面试 |

**depends_on**：
- 分子：`recruit-dm-intv-cnt`
- 分母：`recruit-start-dm-intv-cnt` − `recruit-start-dm-intv-no-submit-cnt`

**口径表达式**：
```sql
COALESCE(
  CASE WHEN <start_dm_intv_cnt> - <start_dm_intv_no_submit_cnt> <> 0
    THEN CAST(<dm_intv_cnt> AS DECIMAL)
         / (<start_dm_intv_cnt> - <start_dm_intv_no_submit_cnt>)
    ELSE 0
  END, 0
)
```

---

## 5. HR 资格面试通过率 `recruit-hr-intv-rate`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-hr-intv-rate` |
| 类型 | composite |
| 业务过程 | HR 资格面试 |

**depends_on**：
- 分子：`recruit-hr-intv-cnt`
- 分母：`recruit-start-hr-intv-cnt` − `recruit-start-hr-intv-no-submit-cnt`

**口径表达式**：
```sql
COALESCE(
  CASE WHEN <start_hr_intv_cnt> - <hr_intv_no_submit_cnt> <> 0
    THEN CAST(<hr_intv_cnt> AS DECIMAL)
         / (<start_hr_intv_cnt> - <hr_intv_no_submit_cnt>)
    ELSE 0
  END, 0
)
```

---

## 6. HR 薪资谈判通过率 `recruit-hr-salary-negotiation-rate`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-hr-salary-negotiation-rate` |
| 类型 | composite |
| 业务过程 | HR 薪资谈判 |

**业务定义**：HR 资格面试通过的人中，最终通过 HR 薪资谈判的比例。

**depends_on**：
- 分子：`recruit-hr-salary-negotiation-pass-cnt`
- 分母：`recruit-hr-intv-cnt` − `recruit-start-hr-salary-negotiation-no-submit-cnt`

**口径表达式**：
```sql
COALESCE(
  CASE
    WHEN <hr_intv_cnt> - <hr_salary_negotiation_no_submit_cnt> = 0 THEN 0
    WHEN <hr_intv_cnt> - <hr_salary_negotiation_no_submit_cnt> <> 0
      THEN CAST(<hr_salary_negotiation_pass_cnt> AS DECIMAL)
           / (<hr_intv_cnt> - <hr_salary_negotiation_no_submit_cnt>)
    ELSE 0
  END, 0
)
```

**注意**：分母用的是 `hr_intv_cnt`（HR 资面通过数）而非"发起薪谈数"，是 治理基线明确定义。

---

## 7. 进入 offer 审批率 `recruit-offer-approval-rate` ⚠️ **v3.0 已废弃**

> 🚫 **v3.0 移除（2026-06-08）**：本指标在新版 治理基线 中已被移除（其分子 `recruit-offer-approval-cnt` 也一并移除）。下方 SQL 仍保留供兼容历史看板使用，但**不应在新业务中引用**。如需类似漏斗指标，请用 `recruit-send-offer-rate`（发送 offer 率）替代。

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-offer-approval-rate` |
| 类型 | composite（v3.0 废弃） |
| 业务过程 | Offer 审批 |

**depends_on**：
- 分子：`recruit-offer-approval-cnt`
- 分母：`recruit-start-hr-salary-negotiation-cnt` − `recruit-start-hr-salary-negotiation-no-submit-cnt`

**口径表达式**：
```sql
COALESCE(
  CASE WHEN <hr_salary_negotiation_time_cnt> - <hr_salary_negotiation_no_submit_cnt> <> 0
    THEN CAST(<offer_approval_cnt> AS DECIMAL)
         / (<hr_salary_negotiation_time_cnt> - <hr_salary_negotiation_no_submit_cnt>)
    ELSE 0
  END, 0
)
```

---

## 8. 发送 offer 率 `recruit-send-offer-rate`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-send-offer-rate` |
| 类型 | composite |
| 业务过程 | 发送 Offer |

**depends_on**：
- 分子：`recruit-send-offer-cnt`
- 分母：`recruit-start-offer-approval-cnt` − `recruit-offer-approval-no-submit-cnt`

**口径表达式**：
```sql
COALESCE(
  CASE WHEN <send_offer_approval_cnt> - <offer_approval_no_submit_cnt> <> 0
    THEN CAST(<send_offer_cnt> AS DECIMAL)
         / (<send_offer_approval_cnt> - <offer_approval_no_submit_cnt>)
    ELSE 0
  END, 0
)
```

---

## 9. 入职率 `recruit-entry-rate`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-entry-rate` |
| 类型 | composite |
| 业务过程 | 入职 |
| 同义词 | 社招入职率 |

**业务定义**：在统计周期内，已发 offer 的候选人中最终入职的比例。

**depends_on**：
- 分子：`recruit-entry-cnt`
- 分母：`recruit-send-offer-cnt`

**口径表达式**：
```sql
COALESCE(
  CASE WHEN <send_offer_cnt> <> 0
    THEN CAST(<entry_cnt> AS DECIMAL) / <send_offer_cnt>
    ELSE 0
  END, 0
)
```

**注意事项**：
- ⚠️ 分子分母**必须用同一时间窗 + 同一过滤条件**，否则可能出现"率 > 100%"
- ⚠️ 不同维度的展开（按组织/岗位/招聘经理）需在 GROUP BY 上保持一致
