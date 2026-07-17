# A 卡片：需求与漏斗概览（v3.0 SQL 拼装）

> **本卡片对应指标**：A1-A12（来自 治理基线「社招需求进展(环节时间)」+「需求量」类）
> **指标层归类**：1 个派生（A1）+ 2 个复合（A2、A5）+ 2 个派生（A3、A4 已完成需求数）+ 5 个派生（A6-A10 流程状态快照）+ 2 个原子（A11、A12 放弃类）
>
> 🚀 **v3.0 SQL 范式（2026-06-08）**：
> 1. 聚合：`COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)`（按流程主键去重）
> 2. 标志位：`is_xxx = '是'`（中文枚举）
> 3. 管理主体：`manager_unit_name_cn = :manager_unit_name_cn`（默认 `'腾讯集团本部'`）
> 4. 国家：`location_country_name LIKE :location_country_name`（默认 `'%中国%'`，可切全球）
> 5. 岗位状态：`is_disabled_name = '在招'`（v3.0 起 WHERE 安全，无拦截）
> 6. **跨表 JOIN 必须用子查询模式**（实测 2026-06-08）：直接 `T_FLOW JOIN T_POST` 会触发 `Column 'dos_current_user' is ambiguous` 错误；解决方案是先用子查询各自过滤，再 JOIN（详见 [README 勘误 A](../../README.md)）
> 7. 时点字段：`< DATE_ADD(:end_date, INTERVAL 1 DAY)`（替代 v2.x 的 `:next_date` 占位符）

| 卡片项 | 中文名 | 指标 ID | 类型 | 详细定义 |
| --- | --- | --- | --- | --- |
| A1 | 社招在招需求数 | `recruit-on-going-post-count` | derived | [derived/recruit-social/on-going-post.md](../../derived/recruit-social/on-going-post.md) |
| A2 | 社招总需求数 | `recruit-total-post-count` | composite | [composite/recruit-social/total-demand.md](../../composite/recruit-social/total-demand.md) |
| A3 | 社招已完成需求数（入职） | `recruit-finish-post-onboard-cnt` | derived | [derived/recruit-social/finished-demand.md](../../derived/recruit-social/finished-demand.md) |
| A4 | 社招已完成需求数（offer） | `recruit-finish-post-offer-cnt` | derived | 同上 |
| A5 | 社招平均招聘天数 | `recruit-avg-recruit-days` | composite | [composite/recruit-social/avg-recruit-days.md](../../composite/recruit-social/avg-recruit-days.md) |
| A6 | 社招流程中总人数（除简历评估） | `recruit-flow-active-count` | derived | [derived/recruit-social/snapshot-stages.md](../../derived/recruit-social/snapshot-stages.md) |
| A6.5 🆕 | **社招流程中总人数**（v3.0 新增，含简历评估） | `recruit-flow-total-count` | derived | 同上 |
| A7 | 评估中 | `recruit-flow-evaluating-count` | derived | 同上 |
| A8 | 面试中 | `recruit-flow-interviewing-count` | derived | 同上 |
| A9 | offer 中 | `recruit-flow-offer-stage-count` | derived | 同上 |
| A10 | 入职中/调动中 | `recruit-flow-onboarding-count` | derived | 同上 |
| A11 | 口头 turndown | `recruit-turndown-cnt` | atomic | [atomic/recruit-social/giveup-count.md](../../atomic/recruit-social/giveup-count.md) |
| A12 | 拒绝 offer | `recruit-offer-giveup-cnt` | atomic | 同上 |

---

## A1 单独 SQL（社招在招需求数）

> 🔴 **v3.10 重大修订（2026-06-11）**：本卡 v3.0~v3.9 的实现（LEFT JOIN + `person_count + register_cnt`）存在 3 个根本错误，已**完全替换为派生指标卡 `derived/on-going-post.md` v3.3 标准 SQL**（两个独立标量子查询 SUM 相加）。
>
> **修订前的 3 个错误**：
> 1. **业务语义错** — `send_offer_time < end` AND `flow_end_time >= end` 表示"已发 offer 但流程未结束"，但 治理基线 Row 7 原档要求的是"截至 end_date 还**没**发 offer 的"，方向完全相反
> 2. **单位错位** — `person_count（岗位人数字段）+ register_cnt（流程数）`两个不同单位相加
> 3. **架构错** — 治理基线 Row 7 明确写"在招需求数 = 当前在招 + 历史在招"是**加法关系**，而本卡用 LEFT JOIN 模式（v3.0~v3.2 旧错误，v3.3 已在 source 卡修订，但 recipe 卡未跟进，潜伏 7 个版本至 v3.10 才修）

### 完整 SQL（v3.10，对齐 derived/on-going-post.md v3.3 标准）

```sql
SELECT
  -- 1. 当前在招分量（T_POST）：当前状态为"在招"的岗位的 person_count 求和
  COALESCE((
    SELECT SUM(person_count)
    FROM catalog_dos_da_mcp.hrdw.Report_Position_Management_Recruitment_P_I_Daily_Slice
    WHERE is_disabled_name = '在招'                                       -- 强制：岗位状态在招
      AND last_update_time <= DATE_ADD(:end_date, INTERVAL 1 DAY)         -- 时点：截至 end_date
      AND recruit_staff_type_name = '正式'                                -- 强制：正式岗位
      AND manager_unit_name_cn = :manager_unit_name_cn                    -- 默认 = '腾讯集团本部'
      /* if :recruit_post_belong_org_full_name */ AND recruit_post_belong_org_full_name LIKE CONCAT('%', :recruit_post_belong_org_full_name, '%')
      /* if :post_id */ AND recruit_post_id = :post_id
      /* if :post_name_cn */ AND post_name_cn LIKE CONCAT('%', :post_name_cn, '%')
      /* if :recruit_owner */ AND recruit_owner = :recruit_owner
      /* if :mapping_position_name */ AND mapping_position_name = :mapping_position_name
      -- ⚠️ T_POST 表无 location_country_name 字段，国家过滤只在 T_FLOW 侧生效
  ), 0)
  +
  -- 2. 历史在招分量（T_FLOW）：截至 end_date 还没发 offer 的活跃流程
  COALESCE((
    SELECT COUNT(DISTINCT flow_main_id)
    FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
    WHERE send_offer_time >= DATE_ADD(:end_date, INTERVAL 1 DAY)          -- 🔴 严格按 治理基线：截至 end_date 还没发 offer（>= 而非 <）
      AND (flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR flow_end_time IS NULL)
      AND flow_id = 3                                                     -- 仅社招（活水另算）
      AND state_id NOT IN (5, 6)                                          -- 排除"已发 offer 已放弃"
      AND staff_type_id = '2'                                             -- 强制：正式员工
      AND location_country_name LIKE :location_country_name               -- 默认 = '%中国%'
      AND manager_unit_name_cn = :manager_unit_name_cn                    -- 默认 = '腾讯集团本部'
      /* if :recruit_post_org_full_name */ AND recruit_post_org_full_name LIKE CONCAT('%', :recruit_post_org_full_name, '%')
      /* if :post_id */ AND post_id = :post_id
      /* if :post_name_cn */ AND post_name_cn LIKE CONCAT('%', :post_name_cn, '%')
      /* if :recruit_owner */ AND recruit_owner = :recruit_owner
      /* if :mapping_position_name */ AND mapping_position_name = :mapping_position_name
  ), 0)
  AS on_going_post_count;
```

**实测对照（来自 derived/on-going-post.md v3.3）**：

| 范围 | 结果 |
| --- | --- |
| TEG (`recruit_post_belong_org_full_name LIKE '%TEG技术工程事业群%'`) + 集团本部 + 中国 | **336** ✅（与业务方预期一致）|

### 参数说明

| 参数 | 默认值 | 作用 |
| --- | --- | --- |
| `:end_date` | 用户原始日期（如未指定 = 昨天）| SQL 内 `DATE_ADD(:end_date, 1)` 后即 治理基线 的 end_date（即昨天+1 = 今天）|
| `:manager_unit_name_cn` | `'腾讯集团本部'` | 强制默认，避免混入子公司 |
| `:location_country_name` | `'%中国%'` | T_FLOW 侧国家过滤 |
| `:recruit_post_belong_org_full_name` | 不带 | T_POST 侧组织过滤（注意：这里参数名与 T_FLOW 不同）|
| `:recruit_post_org_full_name` | 不带 | T_FLOW 侧组织过滤 |

> ⚠️ **A1 SQL 两侧的组织参数名不一样**：T_POST 用 `:recruit_post_belong_org_full_name`，T_FLOW 用 `:recruit_post_org_full_name`。这是 治理基线字段差异。如果同时筛选两侧，必须传入两个参数（或都不传走默认 `%`）。

> ⚠️ **v3.0~v3.9 旧 LEFT JOIN 实现已彻底废弃**（参见 derived/on-going-post.md § ⚠️ 字段使用注意事项 #1）。在所有 sub-skill 调用本 SQL 时**禁止使用 LEFT JOIN 模式**。

---

## A3-A12 拼装 SQL（T_FLOW INNER JOIN T_POST，子查询模式）

> 🔴 **v3.8 全量修订（2026-06-11）**：严格按 治理基线 Row 4-14 重写，应用 v3.8 核心铁律「治理基线 `:end_date` 已 +1 天，SQL `< end_date` 等价于 `< DATE_ADD(:end_date, 1)`」。
>
> 主要修订点：
> 1. **`OR NULL` 字段方向修正**：所有 治理基线 写 `XXX_time >= end_date OR NULL` 的字段，SQL 从 `> DATE_ADD(end,1)` 改为 `>= DATE_ADD(end,1)`（A6/A7/A8/A10）
> 2. **加 flow_id 区分**：A6/A8/A10 在 CASE WHEN 内显式带 `flow_id = 3` / `flow_id = 5`（之前靠字段差异区分，可能双计数）
> 3. **A9 整段重写**：补全 治理基线 4 套子逻辑（社招 2 + 活水 2），关键字段从误用的 `start_huoshui_out_first_approval_time` 改回正确的 `huoshui_in_dept_approval_time`
> 4. **t1 子查询字段**：补 `start_hr_salary_negotiation_time`（A9 社招分支需要）

```sql
SELECT
  -- ━━━ A3 已完成需求数（入职）━━━ 治理基线 Row 4
  -- 社招：hire_date >= begin AND <= end AND is_entry='是'
  -- 活水：huoshui_transfer_date >= begin AND <= end
  -- 🔴 v3.8 修订：治理基线 "end_date" 已 +1 天，SQL "<= :end_date" 漏算 1 天，改为 "<= DATE_ADD(:end_date, 1)"
  COUNT(DISTINCT CASE
    WHEN (t1.hire_date >= :begin_date
          AND t1.hire_date <= DATE_ADD(:end_date, INTERVAL 1 DAY)
          AND t1.is_entry = '是')
      OR (t1.huoshui_transfer_date >= :begin_date
          AND t1.huoshui_transfer_date <= DATE_ADD(:end_date, INTERVAL 1 DAY))
    THEN t1.flow_main_id
  END) AS finish_post_onboard_cnt,

  -- ━━━ A4 已完成需求数（offer）━━━ 治理基线 Row 5
  -- 社招(2套)：take_offer_time >= begin AND <= end AND flow_id=3
  --   逻辑1：state_id NOT IN (5,6)
  --   逻辑2：state_id IN (5,6) AND flow_end_time > end_date  ← 治理基线 写 ">"，不是 ">="
  -- 活水(2套)：huoshui_in_dept_approval_time >= begin AND <= end AND flow_id=5
  --   逻辑1：state_id NOT IN (11)
  --   逻辑2：state_id = 11 AND flow_end_time > end_date  ← 治理基线 写 ">"
  COUNT(DISTINCT CASE
    WHEN (t1.take_offer_time >= :begin_date
          AND t1.take_offer_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
          AND t1.flow_id = 3
          AND (t1.state_id NOT IN (5, 6)
               OR (t1.state_id IN (5, 6) AND t1.flow_end_time > DATE_ADD(:end_date, INTERVAL 1 DAY))))
      OR (t1.huoshui_in_dept_approval_time >= :begin_date
          AND t1.huoshui_in_dept_approval_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
          AND t1.flow_id = 5
          AND (t1.state_id NOT IN (11)
               OR (t1.state_id = 11 AND t1.flow_end_time > DATE_ADD(:end_date, INTERVAL 1 DAY))))
    THEN t1.flow_main_id
  END) AS finish_post_offer_cnt,

  -- ━━━ A5 社招平均招聘天数 ━━━ 治理基线 Row 6
  -- 🔴 v4.0 修订：回退 v3.9「岗位等权」，恢复「流程加权直接 AVG」。
  --    流程加权与本大 SQL「按流程行直接 AVG」架构一致，已内联回大 SQL（不再独立拆分 + 占位）。
  -- 社招：flow_id=3 AND is_entry='是' → DATEDIFF(hire_date, publish)
  -- 活水：flow_id=5 → DATEDIFF(huoshui_transfer_date, publish)；均过滤 recruit_days >= 0
  ROUND(AVG(CASE
    WHEN t1.flow_id = 3 AND t1.is_entry = '是'
         AND t1.hire_date >= :begin_date
         AND t1.hire_date < DATE_ADD(:end_date, INTERVAL 1 DAY)
         AND DATEDIFF(t1.hire_date, CAST(t2.publish_time AS DATE)) >= 0
      THEN DATEDIFF(t1.hire_date, CAST(t2.publish_time AS DATE))
    WHEN t1.flow_id = 5
         AND t1.huoshui_transfer_date >= :begin_date
         AND t1.huoshui_transfer_date < DATE_ADD(:end_date, INTERVAL 1 DAY)
         AND DATEDIFF(t1.huoshui_transfer_date, CAST(t2.publish_time AS DATE)) >= 0
      THEN DATEDIFF(t1.huoshui_transfer_date, CAST(t2.publish_time AS DATE))
  END), 1) AS avg_recruit_days,    -- 流程加权（v4.0 已内联回大 SQL）

  -- ━━━ A6 社招流程中（不含简历评估）━━━ 治理基线 Row 8
  -- 🔴 v3.8 修订：flow_end_time 改 >= DATE_ADD(end,1) OR NULL；加 flow_id 区分
  -- 社招：flow_id=3 AND start_intv_time < end AND (flow_end_time >= end OR NULL)
  -- 活水：flow_id=5 AND huoshui_start_intv_time < end AND (flow_end_time >= end OR NULL)
  COUNT(DISTINCT CASE
    WHEN t1.flow_id = 3
     AND t1.start_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND (t1.flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR t1.flow_end_time IS NULL)
    THEN t1.flow_main_id
    WHEN t1.flow_id = 5
     AND t1.huoshui_start_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND (t1.flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR t1.flow_end_time IS NULL)
    THEN t1.flow_main_id
  END) AS flow_active_cnt,

  -- ━━━ A7_活水 评估中（仅活水分量）━━━ 治理基线 Row 9（活水部分）
  -- 🔴 v3.7 已修方向；v3.8 复审无误
  -- 社招分支用 T_ASSESS，独立 SQL 见下方 ## A7 拆分说明
  COUNT(DISTINCT CASE
    WHEN t1.start_huoshui_resume_assess_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND (t1.huoshui_resume_assess_time >= DATE_ADD(:end_date, INTERVAL 1 DAY)
          OR t1.huoshui_resume_assess_time IS NULL)
    THEN t1.flow_main_id
  END) AS flow_evaluating_huoshui_cnt,   -- 仅活水分量；总数 = 此值 + A7_社招独立 SQL 结果

  -- ━━━ A8 面试中 ━━━ 治理基线 Row 10
  -- 🔴 v3.8 修订：所有 OR NULL 字段从 > DATE_ADD(end,1) 改为 >= DATE_ADD(end,1)；加 flow_id 区分
  -- 社招：flow_id=3 AND start_intv_time < end AND (flow_end_time >= end OR NULL) AND (hr_salary_negotiation_arrive_time >= end OR NULL)
  -- 活水：flow_id=5 AND huoshui_start_intv_time < end AND (flow_end_time >= end OR NULL) AND (huoshui_in_dept_approval_time >= end OR NULL)
  COUNT(DISTINCT CASE
    WHEN t1.flow_id = 3
     AND t1.start_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND (t1.flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR t1.flow_end_time IS NULL)
     AND (t1.hr_salary_negotiation_arrive_time >= DATE_ADD(:end_date, INTERVAL 1 DAY)
          OR t1.hr_salary_negotiation_arrive_time IS NULL)
    THEN t1.flow_main_id
    WHEN t1.flow_id = 5
     AND t1.huoshui_start_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND (t1.flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR t1.flow_end_time IS NULL)
     AND (t1.huoshui_in_dept_approval_time >= DATE_ADD(:end_date, INTERVAL 1 DAY)
          OR t1.huoshui_in_dept_approval_time IS NULL)
    THEN t1.flow_main_id
  END) AS flow_interviewing_cnt,

  -- ━━━ A9 offer 中 ━━━ 治理基线 Row 11（4 套子逻辑全部补齐）
  -- 🔴 v3.8 整段重写：之前社招分支缺失 + 活水关键字段误用（用了 start_huoshui_out_first_approval_time 而非 huoshui_in_dept_approval_time）
  -- 社招逻辑1：flow_id=3 AND state_id NOT IN (5,6) AND start_hr_salary_negotiation_time < end AND (send_offer_time >= end OR NULL)
  -- 社招逻辑2：flow_id=3 AND state_id IN (5,6) AND start_hr_salary_negotiation_time < end AND send_offer_time IS NULL AND flow_end_time >= end
  -- 活水逻辑1：flow_id=5 AND state_id NOT IN (11) AND huoshui_in_dept_approval_time < end AND (huoshui_hire_arrive_time >= end OR NULL) AND (flow_end_time >= end OR NULL)
  -- 活水逻辑2：flow_id=5 AND state_id = 11 AND huoshui_in_dept_approval_time < end AND flow_end_time >= end
  COUNT(DISTINCT CASE
    WHEN t1.flow_id = 3
     AND t1.state_id NOT IN (5, 6)
     AND t1.start_hr_salary_negotiation_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND (t1.send_offer_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR t1.send_offer_time IS NULL)
    THEN t1.flow_main_id
    WHEN t1.flow_id = 3
     AND t1.state_id IN (5, 6)
     AND t1.start_hr_salary_negotiation_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND t1.send_offer_time IS NULL
     AND t1.flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN t1.flow_main_id
    WHEN t1.flow_id = 5
     AND t1.state_id NOT IN (11)
     AND t1.huoshui_in_dept_approval_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND (t1.huoshui_hire_arrive_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR t1.huoshui_hire_arrive_time IS NULL)
     AND (t1.flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR t1.flow_end_time IS NULL)
    THEN t1.flow_main_id
    WHEN t1.flow_id = 5
     AND t1.state_id = 11
     AND t1.huoshui_in_dept_approval_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND t1.flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN t1.flow_main_id
  END) AS flow_offer_stage_cnt,

  -- ━━━ A10 入职中/调动中 ━━━ 治理基线 Row 12（4 套子逻辑）
  -- 🔴 v3.8 修订：所有 OR NULL 字段方向从 > DATE_ADD(end,1) 改为 >= DATE_ADD(end,1)
  -- 社招逻辑1：flow_id=3 AND state_id NOT IN (5,6) AND take_offer_time < end AND (hire_date >= end OR NULL)
  -- 社招逻辑2：flow_id=3 AND state_id IN (5,6) AND take_offer_time < end AND flow_end_time >= end
  -- 活水逻辑1：flow_id=5 AND state_id NOT IN (11) AND huoshui_out_first_approval_time < end AND (flow_end_time >= end OR NULL)
  -- 活水逻辑2：flow_id=5 AND state_id IN (11) AND huoshui_out_first_approval_time < end AND flow_end_time >= end
  COUNT(DISTINCT CASE
    WHEN t1.flow_id = 3
     AND t1.state_id NOT IN (5, 6)
     AND t1.take_offer_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND (t1.hire_date >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR t1.hire_date IS NULL)
    THEN t1.flow_main_id
    WHEN t1.flow_id = 3
     AND t1.state_id IN (5, 6)
     AND t1.take_offer_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND t1.flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN t1.flow_main_id
    WHEN t1.flow_id = 5
     AND t1.state_id NOT IN (11)
     AND t1.huoshui_out_first_approval_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND (t1.flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR t1.flow_end_time IS NULL)
    THEN t1.flow_main_id
    WHEN t1.flow_id = 5
     AND t1.state_id IN (11)
     AND t1.huoshui_out_first_approval_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND t1.flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN t1.flow_main_id
  END) AS flow_onboarding_cnt,

  -- ━━━ A11 口头 turndown ━━━ 治理基线 Row 13（2 套子逻辑）
  -- 区间型，begin_date 不 +1 天，end_date 已含 +1 天 → SQL 用 < DATE_ADD(end,1) 等价
  COUNT(DISTINCT CASE
    WHEN t1.hr_salary_negotiation_process_time >= :begin_date
     AND t1.hr_salary_negotiation_process_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
     AND t1.hr_salary_negotiation_state = '放弃'
     AND t1.is_know_salary_data = '是'
    THEN t1.flow_main_id
    WHEN t1.hr_salary_negotiation_state = '通过'
     AND t1.send_offer_time IS NULL
     AND t1.flow_end_time >= :begin_date
     AND t1.flow_end_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN t1.flow_main_id
  END) AS turndown_cnt,

  -- ━━━ A12 拒绝 offer ━━━ 治理基线 Row 14
  -- 区间型，与 A11 同范式
  COUNT(DISTINCT CASE
    WHEN t1.offer_giveup_time >= :begin_date
     AND t1.offer_giveup_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN t1.flow_main_id
    WHEN t1.huoshui_giveup_time >= :begin_date
     AND t1.huoshui_giveup_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN t1.flow_main_id
  END) AS offer_giveup_cnt

FROM (
  -- ⭐️ v3.0 必须用子查询：直接 INNER JOIN 会触发 dos_current_user ambiguous
  -- 🔴 v3.8 补字段：start_hr_salary_negotiation_time（A9 社招分支需要）
  SELECT flow_main_id, post_id, hire_date, take_offer_time, flow_end_time,
         start_intv_time, hr_salary_negotiation_arrive_time, hr_salary_negotiation_process_time,
         hr_salary_negotiation_state, is_know_salary_data, send_offer_time,
         start_hr_salary_negotiation_time,                                    -- v3.8 新增
         offer_giveup_time, is_entry, flow_id, state_id,
         huoshui_transfer_date, huoshui_in_dept_approval_time, huoshui_start_intv_time,
         huoshui_hire_arrive_time, start_huoshui_out_first_approval_time, huoshui_out_first_approval_time,
         start_huoshui_resume_assess_time, huoshui_resume_assess_time, huoshui_giveup_time
  FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
  WHERE staff_type_id = '2'
    -- ⚠️ A 卡 A3-A12 不带 flow_id 过滤（同时算社招和活水分支）
    -- v3.0 运行时筛选参数
    /* :manager_unit_name_cn      */ AND manager_unit_name_cn      = :manager_unit_name_cn
    /* if :location_country_name  */ AND location_country_name     LIKE :location_country_name
    /* if :post_id                */ AND post_id                   = :post_id
    /* if :post_name_cn           */ AND post_name_cn              LIKE CONCAT('%', :post_name_cn, '%')
    /* if :recruit_owner          */ AND recruit_owner             = :recruit_owner
    /* if :mapping_position_name  */ AND mapping_position_name     = :mapping_position_name
    /* if :recruit_post_org_full_name */ AND recruit_post_org_full_name LIKE CONCAT('%', :recruit_post_org_full_name, '%')
) t1
INNER JOIN (
  SELECT recruit_post_id, publish_time, recruit_post_belong_org_full_name
  FROM catalog_dos_da_mcp.hrdw.Report_Position_Management_Recruitment_P_I_Daily_Slice
  WHERE recruit_staff_type_name = '正式'                        -- 🔴 v3.6 修订：T_POST 强制岗位员工类型=正式（治理基线要求）
    -- v3.0 运行时筛选参数（与 t1 必须保持一致）
    /* :manager_unit_name_cn      */ AND manager_unit_name_cn      = :manager_unit_name_cn
    /* if :recruit_post_belong_org_full_name */ AND recruit_post_belong_org_full_name LIKE CONCAT('%', :recruit_post_belong_org_full_name, '%')
) t2
  ON t1.post_id = t2.recruit_post_id
LIMIT 1;
```

---

## A2 复合：在前端做加法

```js
const a2_total_post_count = a1.on_going_post_count + a3.finish_post_onboard_cnt;
```

> A2「社招总需求数」= A1「社招在招需求数」+ A3「社招已完成需求数(入职)」。

---

## A5 平均招聘天数（v4.0 — 流程加权，已内联回 A3-A12 大 SQL）

> 🔴 **v4.0 修订**：v3.9 曾因"先按岗位聚合再 AVG（岗位等权）"把 A5 拆为独立 SQL + 占位 NULL + 前端代入。该口径已被回退为**流程加权（对所有流程直接 AVG）**，与 A3-A12 大 SQL"按流程行直接 AVG"架构一致，因此 **A5 已内联回大 SQL**（见上方 `avg_recruit_days` 列），**无需独立 SQL，也无需前端代入**。
>
> **口径沿革**：
> - v3.8 及之前：`AVG(所有流程的 recruit_days)` — 流程加权
> - v3.9（❌ 已废弃）：`AVG(每个岗位的岗位级平均)` — 岗位等权
> - v4.0（✅ 当前）：回退为流程加权 `AVG(recruit_days)`，内联于大 SQL
>
> 完整定义见 [`composite/recruit-social/avg-recruit-days.md`](../../composite/recruit-social/avg-recruit-days.md)。
> 如需"按岗位明细 / 排名"，见该卡 § 替代用法（仅展示用途，非整体口径）。

---

## A7 评估中拆分说明（v3.7 修订）

> 🔴 **重要**：治理基线 Row 9 明确「评估中 = 社招评估中（T_ASSESS）+ 活水评估中（T_FLOW）」，**两套子逻辑数据源不同**：
> - **社招评估中**：来自 `Report_Recruit_Resume_Assessment` 的 `arrive_time / process_time`
> - **活水评估中**：来自 `Report_Recruit_Flow_Detail` 的 `start_huoshui_resume_assess_time / huoshui_resume_assess_time`
>
> A3-A12 大 SQL 的 FROM 是 T_FLOW INNER JOIN T_POST，**不能直接拼入 T_ASSESS 数据**，因此 A7 必须拆成"独立 SQL + 前端加法"模式（同 A1/A2）。

### A7_社招 评估中（独立 SQL，T_ASSESS 表）

```sql
SELECT COUNT(DISTINCT flow_main_id) AS flow_evaluating_shezhao_cnt
FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Resume_Assessment
WHERE arrive_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
  AND (process_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR process_time IS NULL)
  AND location_country_name LIKE :location_country_name             -- 默认 '%中国%'
  AND manager_unit_name_cn = :manager_unit_name_cn                   -- 默认 '腾讯集团本部'
  /* if :recruit_post_org_full_name */ AND recruit_post_org_full_name LIKE CONCAT('%', :recruit_post_org_full_name, '%')
  -- ⚠️ T_ASSESS 表不加 flow_id 过滤（README 勘误 B）
LIMIT 1;
```

### A7 总数：在前端做加法

```js
const a7_total_evaluating_cnt =
    a3_a12_result.flow_evaluating_huoshui_cnt    // 活水分量（来自 A3-A12 大 SQL）
  + a7_shezhao_result.flow_evaluating_shezhao_cnt; // 社招分量（来自上面独立 SQL）
```

> **修订前的 bug**（v3.7 之前）：把整个 A7 当成"只用 T_FLOW 活水字段"，导致 **整个社招简历评估漏斗的所有候选人全部丢失**，A7 数值严重偏低。

---

## A6.5 🆕 社招流程中总人数（含简历评估）：在前端做加法

```js
const a6_5_flow_total_count = a6.flow_active_cnt + a7_total_evaluating_cnt;
//                                                ↑↑↑ 注意是 A7 总数（社招+活水），不是单独活水分量
```

> A6.5「社招流程中总人数」（v3.0 新增）= A6「社招流程中总人数(除简历评估)」+ A7「评估中（社招+活水合计）」。
> 🔴 **v3.7 修订**：A7 现在拆为社招（独立 SQL）+ 活水（A3-A12 大 SQL 内），需要把两个分量加和后再代入此公式。

---

## 维度扩展示例：按组织全路径展开

```sql
-- 把上面整段 A3-A12 SQL 包成 CTE，再做组织展开
WITH cte_metrics AS (
  -- ... 上面整段 SQL（去掉最末 LIMIT 1，加 GROUP BY t2.recruit_post_belong_org_full_name）
)
SELECT split_value AS org_full_name, *
FROM cte_metrics
LATERAL VIEW EXPLODE(SPLIT(recruit_post_belong_org_full_name, '/')) tab AS split_value
WHERE split_value IS NOT NULL AND split_value != ''
GROUP BY split_value
LIMIT 1000;
```

---

## 🎚️ 本卡片支持的运行时筛选参数（v3.0）

> 完整定义见 [`../../dimensions/recruit-social/filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md)。

| 参数 | 默认值 | 渲染位置 | 备注 |
| --- | --- | --- | --- |
| `:begin_date` | 当年 1 月 1 日 | A3-A5、A11-A12 时间字段下边界 | A1/A6-A10 不用 |
| `:end_date` | 昨天（T-1） | 区间型 + 时点型双用途 | 时点型用 `DATE_ADD(:end_date, INTERVAL 1 DAY)` |
| `:manager_unit_name_cn` | **`'腾讯集团本部'`** | t1/t2 双侧 | 建议必带 |
| `:location_country_name` | `'%中国%'` | t1 侧 | v3.0 起从固定→动态 |
| `:post_id` | — | t1.post_id（流程） / t2.recruit_post_id（岗位） | t1/t2 双侧 |
| `:post_name_cn` | — | LIKE 模糊匹配 | t1 侧 |
| `:recruit_owner` | — | t1/t2 双侧 | |
| `:recruit_post_org_full_name` | — | t1 侧（流程表字段） | |
| `:recruit_post_belong_org_full_name` | — | t2 侧（岗位表字段） | |
| `:mapping_position_name` | — | t1/t2 双侧 | |
| `:is_disabled_name` | A1 默认 `'在招'`（CASE 内处理） | A1 内部使用 | v3.0 起 WHERE 也安全 |

**❌ 已剔除**：`org_id` / `manager_unit_id` / `:next_date` / `:channel_id` / `:work_location_id` / `:mapping_position_id`（统一改用 v3.0 中文名变体）。

**❌ 不适用**：`:channel_id`（A 卡数据源 `T_POST` 无 channel_id 字段）。

---

## ⚠️ 跨表 JOIN 治理铁律（v3.0）

1. **必须先子查询过滤再 JOIN**：直接 `T_FLOW JOIN T_POST` 触发 `dos_current_user ambiguous`（实测 2026-06-08）
2. **t1/t2 必须使用相同的运行时参数**：否则两侧权限范围不一致，结果失真
3. **子查询的 SELECT 列表必须包含所有外层用到的列**：否则外层引用失败
4. **避免 `SELECT *` 子查询**：StarRocks 自动注入的 `dos_current_user` 列会被携带过 JOIN 边界
