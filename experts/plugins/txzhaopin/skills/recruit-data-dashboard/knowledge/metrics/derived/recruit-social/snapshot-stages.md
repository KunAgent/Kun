# 流程状态快照（5 个派生指标）

> 业务过程：流程状态快照（任意时点的存量状态）
> 数据源：`T_FLOW` = `Report_Recruit_Flow_Detail`
> **时点语义**：截至 :end_date 当时仍处于该状态的人次（瞬时存量）
>
> 🔴 **强制过滤（v3.4 强化，必带；仅适用 `T_FLOW` 侧）**：
> - `staff_type_id = '2'`
> - **`location_country_name LIKE :location_country_name`** ⬅ **国家必带**（参数化但默认 `'%中国%'`）
> - **`manager_unit_name_cn = :manager_unit_name_cn`** ⬅ **管理主体必带**（参数化但默认 `'腾讯集团本部'`）
> - ⚠️ **不再硬性过滤 `flow_id`**（v3.11 修正）：1/3/5 项的 CASE 分支内部已显式区分 `flow_id = 3`（社招）和 `flow_id = 5`（活水），外层 WHERE 若加 `flow_id = 3` 会导致活水分支永远命中不了。
> - 🔴 **v3.9 例外（2026-06-12）**：第 2 项「评估中」的 **`T_ASSESS`（社招评估中）分量不加 `staff_type_id`、不加 `flow_id`**，详见该卡「强制过滤（按表区分）」。
>
> **支持的运行时筛选参数**（详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md)）：
> `:end_date`（必带，时点边界）
> `:location_country_name`（**必带**，默认 `'%中国%'`，可改为 `'%亚太%'` 等）
> `:manager_unit_name_cn`（**必带**，默认 `'腾讯集团本部'`，可改为具体子公司主体）
> `:post_id` `:post_name_cn` `:recruit_owner_id` `:channel_id` `:org_full_name` `:work_location_id` `:mapping_position_id`
>
> ⚠️ **关于片段 SQL 的使用**：本文件 1/2/3/5 项的"核心表达式"是**聚合表达式片段**（仅 `COUNT(...)`），靠**外层 SELECT/WHERE** 提供强制过滤。直接复制片段 SQL 时**必须**外层包装：
>
> ```sql
> SELECT <这里粘贴片段 SQL> AS <metric_name>
> FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
> WHERE staff_type_id = '2'
>   AND location_country_name LIKE :location_country_name   -- 默认 '%中国%'
>   AND manager_unit_name_cn = :manager_unit_name_cn        -- 默认 '腾讯集团本部'
>   <可选: AND recruit_post_org_full_name LIKE :org_full_name>
> ```
> 
> ⚠️ **注意**：外层 WHERE **不要加 `flow_id = 3`**。片段 SQL 内部已通过 `WHEN flow_id = 3 / 5` 区分社招/活水，外层硬性过滤会误杀活水分支。
>
> 第 4 项（offer 中）已是**完整 SQL**，自带全部强制过滤，可直接执行。
>
> 🔴 **字段口径勘误（2026-06-08）**：本文件 SQL 中所有 `is_xxx = '是'` 写法已修订完毕（数仓真实取值是中文 `'是'/'否'`，治理基线的 `is_xxx = 1` 在 StarRocks 直查时恒返回 0）。详见 [README 勘误章节](../../README.md)。

| ID | 中文名 | 业务含义 | v3.0 状态 |
| --- | --- | --- | --- |
| `recruit-flow-total-count` | **社招流程中总人数** | = 社招流程中总人数(除简历评估) + 评估中（v3.0 新增的合计指标） | 🆕 v3.0 新增 |
| `recruit-flow-active-count` | 社招流程中总人数（除简历评估） | 已发起面试且流程未结束 | ✅ |
| `recruit-flow-evaluating-count` | 评估中 | 简历评估发起 ≤ :end_date+1 天 且评估未完成 | ✅ v3.0 字段更精准 |
| `recruit-flow-interviewing-count` | 面试中 | 已发起面试且未到薪谈/调入审批 | ✅ |
| `recruit-flow-offer-stage-count` | offer 中（活水分支） | 在 offer 流转中 | ✅ |
| `recruit-flow-onboarding-count` | 入职中/调动中 | 已接 offer 但未到 hire_date | ✅ |

> ⚠️ **共同警示**：此 5 个指标均为**时点状态**，与"区间累计"指标语义不同。**不能简单相加**——评估中、面试中、offer 中、入职中是漏斗的不同位置存量，理论上 `flow_active_count ≈ evaluating + interviewing + offer + onboarding`，但因为口径细节，此约等关系不严格成立。

---

> ⚠️ **v3.1 决策（2026-06-09）**：国家筛选**不再是强制过滤**，改为动态参数 `:location_country_name`（默认 `'%中国%'`，可切 `'%亚太%'`、`'%全球%'` 等）。详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md) #6。


> 🔄 **v3.8 时点边界最终修订（2026-06-11，覆盖 v3.2 错误）**：基于 v3.8 核心铁律「治理基线 `:end_date` 已 +1 天」，当前 SQL 模板严格遵守 治理基线 ↔ SQL 映射规则：
> - 治理基线 `< end_date` → SQL `< DATE_ADD(:end_date, INTERVAL 1 DAY)`
> - 治理基线 `>= end_date` → SQL `>= DATE_ADD(:end_date, INTERVAL 1 DAY)`
> - 治理基线 `> end_date` → SQL `> DATE_ADD(:end_date, INTERVAL 1 DAY)`
>
> v3.2 当时的注释方向（"`<DATE_ADD(end,1)` → `<:end_date`"）基于"治理口径 end_date = 用户日期"的错误假设，**已在 v3.8 被推翻并全部回滚**。
## 1. 社招流程中总人数（除简历评估）`recruit-flow-active-count`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-flow-active-count` |
| 类型 | derived（时点快照） |
| 业务过程 | 流程状态快照 |
| 关键字段 | `start_intv_time`、`huoshui_start_intv_time`、`flow_end_time` |

**核心表达式**：
```sql
COUNT(
  CASE
    -- 社招分支：必须显式带 flow_id = 3
    WHEN flow_id = 3
     AND start_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND (flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR flow_end_time IS NULL)
    THEN 1
    -- 活水分支：必须显式带 flow_id = 5
    WHEN flow_id = 5
     AND huoshui_start_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND (flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR flow_end_time IS NULL)
    THEN 1
    ELSE NULL
  END
)
```

> 🔴 **v3.10 修订（2026-06-11）**：补全 `flow_id = 3 / 5` 显式区分（与 recipe card-A § A6 一致）。之前的实现仅靠字段差异（`start_intv_time` vs `huoshui_start_intv_time`）隐式区分，理论上若同一条记录两个字段都有值会双计数。

---

## 2. 评估中 `recruit-flow-evaluating-count`

> 🔄 **v3.7 重大修订（2026-06-11）**：之前的实现只用了 T_FLOW 的活水字段，标注"BI 实测覆盖社招"是**错误判断**。
> 严格按 治理基线（Row 9）：评估中 = 社招评估中（T_ASSESS 表）+ 活水评估中（T_FLOW 表），两张表分别查再加和。
> 之前的版本会**完全漏算社招简历评估漏斗最前端的所有候选人**（量级很大），修订后才符合业务真实口径。

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-flow-evaluating-count` |
| 类型 | derived（两套子逻辑加和） |
| 业务过程 | 简历评估阶段快照 |
| 数据源 | T_ASSESS = `Report_Recruit_Resume_Assessment`（社招）+ T_FLOW = `Report_Recruit_Flow_Detail`（活水） |
| 时点语义 | 截至 :end_date 当时仍处于评估中的人次（瞬时存量） |
| 同义词 | 评估中、评估中人数、评估阶段、简历评估中、resume-evaluating |

### 业务定义（严格按 治理基线 Row 9）

```
评估中人数 = 社招评估中人数 + 活水评估中人数
```

| 子分量 | 来源表 | 关键时间字段 | 筛选条件 |
| --- | --- | --- | --- |
| 社招评估中 | T_ASSESS = `Report_Recruit_Resume_Assessment` | `arrive_time`、`process_time` | `arrive_time < :end_date` AND (`process_time >= :end_date` OR IS NULL) |
| 活水评估中 | T_FLOW = `Report_Recruit_Flow_Detail` | `start_huoshui_resume_assess_time`、`huoshui_resume_assess_time` | `start_huoshui_resume_assess_time < :end_date` AND (`huoshui_resume_assess_time >= :end_date` OR IS NULL) |

每套都对 `flow_main_id` 去重计数，最后 2 个数加和。

**强制过滤（按表区分，🔴 v3.9 纠偏 2026-06-12）**：
- **`T_ASSESS`（社招评估中）侧**：
  - **不加** `staff_type_id`、**不加** `flow_id`（README 勘误 B）
  - `location_country_name LIKE :location_country_name`（默认 `'%中国%'`）
  - `manager_unit_name_cn = :manager_unit_name_cn`（默认 `'腾讯集团本部'`）
- **`T_FLOW`（活水评估中）侧**：
  - `flow_id = 5`（🔴 v3.12：活水显式带 flow_id；`huoshui_*` 字段仅活水有值，不改结果）
  - `staff_type_id = '2'`
  - `location_country_name LIKE :location_country_name`（默认 `'%中国%'`）
  - `manager_unit_name_cn = :manager_unit_name_cn`（默认 `'腾讯集团本部'`）
- ⚠️ 🔴 **v3.9（2026-06-12）：T_ASSESS 表去掉 `staff_type_id` 过滤**，仅靠时间窗 + 国家 + 管理主体过滤（与原子卡 `resume-assess-count.md` 口径一致）。

---

### 完整 SQL（v3.7，严格按 治理基线）

```sql
SELECT
  -- 社招评估中（T_ASSESS）
  COALESCE((
    SELECT COUNT(DISTINCT flow_main_id)
    FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Resume_Assessment
    WHERE arrive_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
      AND (process_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR process_time IS NULL)
      AND location_country_name LIKE :location_country_name      -- 默认 '%中国%'
      AND manager_unit_name_cn = :manager_unit_name_cn            -- 默认 '腾讯集团本部'
  ), 0)
  +
  -- 活水评估中（T_FLOW）
  COALESCE((
    SELECT COUNT(DISTINCT flow_main_id)
    FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
    WHERE flow_id = 5                                                         -- 🔴 v3.12（2026-06-12）：活水评估中显式带 flow_id = 5（与 line 11 设计一致；huoshui_* 字段仅活水有值，不改结果，仅满足强制过滤铁律）
      AND start_huoshui_resume_assess_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
      AND (huoshui_resume_assess_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR huoshui_resume_assess_time IS NULL)
      AND staff_type_id = '2'
      AND location_country_name LIKE :location_country_name
      AND manager_unit_name_cn = :manager_unit_name_cn
  ), 0)
  AS recruit_flow_evaluating_count;
```

### 注意事项

⚠️ **敏感字段**：`start_huoshui_resume_assess_time` 和 `huoshui_resume_assess_time` 是敏感字段（活水简历评估开始/结束时间），外部模型查询会被拦截。按 SKILL.md § Step 4 规则 B 处理（任务终止 + 提示切内部模型）。

⚠️ **片段卡使用提醒**：本卡是**完整 SQL 卡**（自带 SELECT FROM WHERE），可以直接执行。如果其他场景需要拆分使用（如 card-A 大 SQL），需要把社招分量拆成独立 SQL（参见 `card-A-demand-overview.md § A7`）。

---

## 3. 面试中 `recruit-flow-interviewing-count`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-flow-interviewing-count` |
| 类型 | derived |

**核心表达式**：
```sql
COUNT(
  CASE
    -- 社招分支：必须显式带 flow_id = 3
    WHEN flow_id = 3
     AND start_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND (flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR flow_end_time IS NULL)
     AND (hr_salary_negotiation_arrive_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR hr_salary_negotiation_arrive_time IS NULL)
    THEN 1
    -- 活水分支：必须显式带 flow_id = 5
    WHEN flow_id = 5
     AND huoshui_start_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND (flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR flow_end_time IS NULL)
     AND (huoshui_in_dept_approval_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR huoshui_in_dept_approval_time IS NULL)
    THEN 1
    ELSE NULL
  END
)
```

> 🔴 **v3.10 修订（2026-06-11）**：补全 `flow_id = 3 / 5` 显式区分（与 recipe card-A § A8 一致）。

**业务含义**：发起面试 → 但未到薪谈（社招）/ 未到调入审批（活水）的存量人次。

---

## 4. offer 中 `recruit-flow-offer-stage-count`

> 🔄 **v3.3 补全（2026-06-10，对齐 治理基线）**：原卡只有活水分支、社招分支被标记 TODO。本次根据 治理基线「社招在招需求 + 活水在招需求」的合并 offer 中口径，把社招两套子逻辑 + 活水两套子逻辑全部补齐。

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-flow-offer-stage-count` |
| 类型 | derived（4 套子逻辑加和） |
| 业务过程 | offer 阶段快照 |
| 数据源 | `T_FLOW` = `Report_Recruit_Flow_Detail` |
| 时点语义 | 截至 :end_date 的瞬时 offer 中人数 |
| 同义词 | offer中、offer中人数、offer 阶段人数、offer-pending、offer 中候选人 |
| 业务负责人 | 招活产研 |
| 接入时间 | 2026-06-10 |

**业务定义**（严格按 治理基线 Row 11）：

```
offer 中人数 = 社招 offer 中人数 + 活水 offer 中人数
```

| 子分量 | 含义 | flow_id | 关键时间字段 |
| --- | --- | --- | --- |
| 社招逻辑1 | 已过薪资谈判、未发 offer 或未到 send_offer_time，且流程未结束 | 3 | `start_hr_salary_negotiation_time < :end_date` AND `send_offer_time >= :end_date OR NULL` AND `flow_end_time >= :end_date OR NULL` AND `state_id NOT IN (5,6)` |
| 社招逻辑2 | 已发 offer 已放弃但流程未结束 | 3 | `start_hr_salary_negotiation_time < :end_date` AND `send_offer_time IS NULL` AND `flow_end_time >= :end_date` AND `state_id IN (5,6)` |
| 活水逻辑1 | 已过部门审批、未到入职到岗，且流程未结束 | 5 | `huoshui_in_dept_approval_time < :end_date` AND `huoshui_hire_arrive_time >= :end_date OR NULL` AND `flow_end_time >= :end_date OR NULL` AND `state_id NOT IN (11)` |
| 活水逻辑2 | 已部门审批、流程未结束、放弃前的状态 11 | 5 | `huoshui_in_dept_approval_time < :end_date` AND `flow_end_time >= :end_date` AND `state_id = 11` |

每套都对 `flow_main_id` 去重计数，最后 4 个数加和。

**强制过滤（共用）**：
- `staff_type_id = '2'` (T_FLOW 侧)
- `location_country_name LIKE '%中国%'`
- 默认 `manager_unit_name_cn = '腾讯集团本部'`

---

### 完整 SQL（v3.3，严格按 治理基线）

```sql
SELECT
  -- 社招逻辑 1：已过薪资谈判，未发 offer 或 send_offer 在未来，且流程未结束
  COALESCE((
    SELECT COUNT(DISTINCT flow_main_id)
    FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
    WHERE flow_id = 3
      AND state_id NOT IN (5, 6)
      AND start_hr_salary_negotiation_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
      AND (send_offer_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR send_offer_time IS NULL)
      AND (flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR flow_end_time IS NULL)
      AND staff_type_id = '2'
      AND location_country_name LIKE :location_country_name      -- 默认 '%中国%'
      AND manager_unit_name_cn = :manager_unit_name_cn            -- 默认 '腾讯集团本部'
  ), 0)
  +
  -- 社招逻辑 2：已过薪资谈判，已放弃但流程未结束
  COALESCE((
    SELECT COUNT(DISTINCT flow_main_id)
    FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
    WHERE flow_id = 3
      AND state_id IN (5, 6)
      AND start_hr_salary_negotiation_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
      AND send_offer_time IS NULL
      AND flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY)
      AND staff_type_id = '2'
      AND location_country_name LIKE :location_country_name
      AND manager_unit_name_cn = :manager_unit_name_cn
  ), 0)
  +
  -- 活水逻辑 1：已部门审批，未到入职到岗，且流程未结束
  COALESCE((
    SELECT COUNT(DISTINCT flow_main_id)
    FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
    WHERE flow_id = 5
      AND state_id NOT IN (11)
      AND huoshui_in_dept_approval_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
      AND (huoshui_hire_arrive_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR huoshui_hire_arrive_time IS NULL)
      AND (flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR flow_end_time IS NULL)
      AND staff_type_id = '2'
      AND location_country_name LIKE :location_country_name
      AND manager_unit_name_cn = :manager_unit_name_cn
  ), 0)
  +
  -- 活水逻辑 2：已部门审批，state=11，流程未结束
  COALESCE((
    SELECT COUNT(DISTINCT flow_main_id)
    FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
    WHERE flow_id = 5
      AND state_id = 11
      AND huoshui_in_dept_approval_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
      AND flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY)
      AND staff_type_id = '2'
      AND location_country_name LIKE :location_country_name
      AND manager_unit_name_cn = :manager_unit_name_cn
  ), 0)
  AS recruit_flow_offer_stage_count;
```

### 注意事项

⚠️ **敏感字段**：本 SQL 含 `start_hr_salary_negotiation_time`、`huoshui_in_dept_approval_time`、`huoshui_hire_arrive_time` 等时间字段，外部模型查询会被拦截（按 SKILL.md § Step 4 规则 B 处理 — 任务终止 + 提示切内部模型）。

⚠️ **state_id 编码**：
- 社招分支：`5/6` = 已发 offer 已放弃 / 流程已放弃
- 活水分支：`11` = 活水流程已放弃

详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md) #state_id 章节。

---

## 5. 入职中/调动中 `recruit-flow-onboarding-count`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-flow-onboarding-count` |
| 类型 | derived |

**业务定义**：截至 :next_date，已接 offer（或活水已调入审批）但 hire_date（或 flow_end_time）尚未到达的存量。

**核心表达式**：
```sql
COUNT(
  CASE
    WHEN take_offer_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND (hire_date >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR hire_date IS NULL)
     AND flow_id = 3
     AND (state_id NOT IN (5, 6) OR (state_id IN (5, 6) AND flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY)))
    THEN 1
    WHEN huoshui_out_first_approval_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND (flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR flow_end_time IS NULL)
     AND flow_id = 5
     AND (state_id NOT IN (11) OR (state_id IN (11) AND flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY)))    -- 🔴 v3.10：state_id = 11 → IN (11) 风格统一
    THEN 1
    ELSE NULL
  END
)
```

---

## 6. 社招流程中总人数 `recruit-flow-total-count` 🆕 **v3.0 新增**

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-flow-total-count` |
| 类型 | derived（合计派生） |
| 业务过程 | 流程状态快照（合计版，含简历评估） |
| 同义词 | 流程中总人数 |

**业务定义**（v3.0 新增）：截至 :end_date+1 天时点，处于招聘漏斗任一环节（含简历评估）的存量人数。

**公式**：
```
社招流程中总人数 = 社招流程中总人数(除简历评估) + 评估中
```

**depends_on**：
- 加数 1：`recruit-flow-active-count`（社招流程中总人数除简历评估）
- 加数 2：`recruit-flow-evaluating-count`（评估中）

**实现方式**：
- ✅ **推荐：前端层做加法**（无需独立 SQL）
- ❌ 不推荐 SQL 重复定义（同 `recruit-total-post-count` 处理方式）

**v2.x vs v3.0**：
- v2.x：只有"社招流程中总人数(除简历评估)"`recruit-flow-active-count`
- v3.0：新增了**含简历评估**的合计版本，区分"是否包含尚未发起面试的简历评估阶段"
