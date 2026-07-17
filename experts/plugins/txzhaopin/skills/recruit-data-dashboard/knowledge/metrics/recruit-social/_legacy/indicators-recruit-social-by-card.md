# 招活-社招统计指标手册（44 个指标）

> 数据源：治理基线《社招统计指标》（共 44 个指标）
> 原始档案：`.knowledge/source/社招统计指标.raw.json`
> 元数据：`.knowledge/metrics/recruit-social/_metadata.json`
> 抓取时间：2026-06-07

---

> 🗄️ **历史归档（已废弃，请勿直接使用）**
> 本文件是 v3.x 治理之前的早期快照，多处口径已过时（如 `is_xxx = 1` 数字写法、`':begin_date'` 带引号、缺 `manager_unit_name_cn` 等）。
> **唯一真相源**请以 `knowledge/metrics/` 下当前 atomic/composite/derived/recipes 卡为准。
> 🔴 **T_ASSESS 口径勘误（2026-06-12）**：本文档原文要求 `Report_Recruit_Resume_Assessment`（社招简历评估宽表）也带 `staff_type_id = '2' AND flow_id = 3`，**这是错误的**。该表**不加 `staff_type_id`、不加 `flow_id`**（见 README 勘误 B）。本次已就地修正下方模板 3A / 3B 与相关说明，其余过时写法不再逐一处理。

---

## ⚠️ 使用前必读

1. **权限前置**：本批指标涉及表 `Report_Recruit_Flow_Detail` / `Report_Recruit_Resume_Assessment` / `Report_Position_Management_Recruitment_P_I_Daily_Slice`。已验证当前账号对前两张表 `hasPermission = false`。**使用 SQL 前请先用 `data-permission-checker` 验证权限**。
2. **权限条件已剔除**：依据 `hr-starrocks-query-conventions` 规则，本文档统一**移除** 治理口径原文中的：
   - `manager_unit_id = 用户当前管理主体`
   - `org_id = 用户权限范围内的顶层组织`
   StarRocks 已基于身份做行列权限自动控权，**SQL 中加这些条件会引发数据异常**。
3. **占位符约定**：本文档继续沿用 治理基线 中的命名占位符 `:begin_date / :end_date / :next_date`，对应业务时间窗口；执行时由前端/调用方替换为实际值或动态函数。
4. **统一固定条件**：除特殊说明外，**`Report_Recruit_Flow_Detail`（T_FLOW）指标**默认带：
   - `staff_type_id = '2'`（员工类型，正式员工候选人口径）
   - `flow_id = 3`（社招；活水是 `flow_id = 5`，部分跨场景指标会同时取两类）
   - 🔴 **例外（2026-06-12 勘误）**：`Report_Recruit_Resume_Assessment`（T_ASSESS，B11/C1 用）**不加 `staff_type_id`、不加 `flow_id`**（见 README 勘误 B），仅靠时间窗 + 国家过滤。
5. **仅 SELECT，禁写操作**；查询大结果集必须 `LIMIT`。

---

## 📑 全量指标速查表（44 项）

按"业务漏斗顺序"重排，便于按场景定位指标：

### A. 需求与漏斗概览（12 项）

| # | 中文名 | 指标编码 | 类型 | 来源表 | 关键时间字段 |
| --- | --- | --- | --- | --- | --- |
| A1 | 在招需求数 | `recruit-on-going-post-count` | 派生 | 招聘岗位信息 + 面试全流程 | `is_disabled / publish_time / send_offer_time` |
| A2 | 总需求数 | `recruit-total-post-count` | 复合 | 招聘岗位信息 + 面试全流程 | 在招 + 已完成 |
| A3 | 已完成需求数（入职） | `recruit-finish-post-onboard-count` | 原子 | 面试全流程 + 招聘岗位信息 | `hire_date / huoshui_transfer_date` |
| A4 | 已完成需求数（offer） | `recruit-finish-post-offer-count` | 原子 | 面试全流程 + 招聘岗位信息 | `take_offer_time / huoshui_in_dept_approval_time` |
| A5 | 平均招聘天数（=平均招聘周期） | `recruit-avg-recruit-days` | 复合 | 面试全流程 + 招聘岗位信息 | `DATEDIFF(hire_date, publish_time)` |
| A6 | 全部流程中（除简历评估，=流程中总人数） | `recruit-flow-active-count` | 派生 | 面试全流程 + 招聘岗位信息 | `start_intv_time / flow_end_time` 时点快照 |
| A7 | 评估中 | `recruit-flow-evaluating-count` | 派生 | 面试全流程 + 招聘岗位信息 | `start_huoshui_resume_assess_time` |
| A8 | 面试中 | `recruit-flow-interviewing-count` | 派生 | 面试全流程 + 招聘岗位信息 | `start_intv_time / hr_salary_negotiation_arrive_time` |
| A9 | offer 中 | `recruit-flow-offer-stage-count` | 派生 | 面试全流程 + 招聘岗位信息 | `huoshui_hire_arrive_time / start_huoshui_out_first_approval_time` |
| A10 | 入职中/调动中 | `recruit-flow-onboarding-count` | 派生 | 面试全流程 + 招聘岗位信息 | `take_offer_time / huoshui_out_first_approval_time` |
| A11 | 口头 turndown | `recruit-turndown-count` | 派生 | 面试全流程 + 招聘岗位信息 | `hr_salary_negotiation_state='放弃' / send_offer_time IS NULL` |
| A12 | 拒绝 offer | `recruit-offer-giveup-count` | 原子 | 面试全流程 + 招聘岗位信息 | `offer_giveup_time / huoshui_giveup_time` |

### B. 环节通过/进度数量（11 项）

| # | 中文名 | 指标编码 | 类型 | 来源表 |
| --- | --- | --- | --- | --- |
| B1 | 发起面试数 | `recruit-start-interview-count` | 原子 | 面试全流程 |
| B2 | 部门内专业面试通过数 | `recruit-dept-professional-pass-count` | 原子 | 面试全流程 |
| B3 | 通道面委面试通过数 | `recruit-cf-pass-count` | 原子 | 面试全流程 |
| B4 | 用人决策面试通过数 | `recruit-dm-pass-count` | 原子 | 面试全流程 |
| B5 | HR 资格面试通过数 | `recruit-hr-pass-count` | 原子 | 面试全流程 |
| B6 | offer 审批中人数 | `recruit-offer-approval-count` | 派生 | 面试全流程 |
| B7 | 薪资谈判通过数 | `recruit-hr-salary-negotiation-pass-count` | 原子 | 面试全流程 |
| B8 | 发送 offer 数 | `recruit-send-offer-count` | 原子 | 面试全流程 |
| B9 | 入职数 | `recruit-entry-count` | 原子 | 面试全流程 |
| B10 | 有简历评估面试数（=渠道发起面试数） | `recruit-resume-assess-interview-count` | 原子 | 面试全流程 |
| B11 | 渠道收到评估数 | `recruit-channel-resume-assess-count` | 原子 | 简历评估宽表 |

### C. 漏斗通过率（9 项，复合指标）

| # | 中文名 | 指标编码 | 分子 | 分母 |
| --- | --- | --- | --- | --- |
| C1 | 渠道发起面试率 | `recruit-channel-start-interview-rate` | `resume_assess_cnt`(B10) | `channel_cnt - resume_assessing_cnt` |
| C2 | 部门内面试通过率 | `recruit-dept-professional-pass-rate` | `dept_professional_intv_cnt`(B2) | `start_dept_professional_intv_cnt - start_dept_professional_intv_no_submit_cnt` |
| C3 | 通道面委面试通过率 | `recruit-cf-pass-rate` | `cf_intv_cnt`(B3) | `start_cf_intv_cnt - start_cf_intv_no_submit_cnt` |
| C4 | 用人决策面试通过率 | `recruit-dm-pass-rate` | `dm_intv_cnt`(B4) | `start_dm_intv_cnt - start_dm_intv_no_submit_cnt` |
| C5 | HR 资格面试通过率 | `recruit-hr-pass-rate` | `hr_intv_cnt`(B5) | `start_hr_intv_cnt - hr_intv_no_submit_cnt` |
| C6 | HR 薪资谈判通过率 | `recruit-hr-salary-negotiation-rate` | `hr_salary_negotiation_pass_cnt` | `hr_intv_cnt - hr_salary_negotiation_no_submit_cnt` |
| C7 | 进入 offer 审批率 | `recruit-offer-approval-rate` | `offer_approval_cnt`(B6) | `hr_salary_negotiation_time_cnt - hr_salary_negotiation_no_submit_cnt` |
| C8 | 发送 offer 率 | `recruit-send-offer-rate` | `send_offer_cnt`(B8) | `send_offer_approval_cnt - offer_approval_no_submit_cnt` |
| C9 | 入职率 | `recruit-entry-rate` | `entry_cnt`(B9) | `send_offer_cnt`(B8) |

### D. 辅助指标（12 项，用于支撑 C 类比率的分母）

| # | 中文名 | 指标编码 | 类型 | 用于支撑 |
| --- | --- | --- | --- | --- |
| D1 | 发起部门内专业面试数 | `recruit-start-dept-professional-count` | 原子 | C2 分母 |
| D2 | 发起部门内专业面试未提交数 | `recruit-start-dept-professional-no-submit-count` | 原子 | C2 分母（扣减） |
| D3 | 发起通道面委面试数 | `recruit-start-cf-count` | 原子 | C3 分母 |
| D4 | 发起通道面委面试未提交数 | `recruit-start-cf-no-submit-count` | 原子 | C3 分母（扣减） |
| D5 | 发起用人决策者面试未提交数 | `recruit-start-dm-no-submit-count` | 原子 | C4 分母（扣减） |
| D6 | 发起用人决策者面试数 | `recruit-start-dm-count` | 原子 | C4 分母 |
| D7 | 发起 hr 资格面试数 | `recruit-start-hr-count` | 原子 | C5 分母 |
| D8 | 发起 hr 资格面试未提交数 | `recruit-start-hr-no-submit-count` | 原子 | C5 分母（扣减）|
| D9 | 发起薪资谈判数 | `recruit-start-hr-salary-negotiation-count` | 原子 | C7 分母 |
| D10 | 发起薪资谈判未提交数 | `recruit-start-hr-salary-negotiation-no-submit-count` | 原子 | C6/C7 分母（扣减） |
| D11 | 发起 offer 审批人数 | `recruit-start-offer-approval-count` | 原子 | C8 分母 |
| D12 | offer 审批中未审批人数 | `recruit-offer-approval-no-submit-count` | 原子 | C8 分母（扣减） |

---

## 🔧 通用 SQL 模版规范

### 默认占位符与参数

| 占位符 | 含义 | 默认值 | 动态计算 |
| --- | --- | --- | --- |
| `:begin_date` | 业务起始日期 | 当年 1 月 1 日（YTD） | `DATE_FORMAT(CURRENT_DATE, '%Y-01-01')` |
| `:end_date` | 业务结束日期 | 昨天 | `DATE_SUB(CURRENT_DATE, INTERVAL 1 DAY)` |
| `:next_date` | 结束日期 +1 天 | end_date + 1 天 | `CURRENT_DATE` |
| `:org_path` | 组织全路径关键词（可选） | 全部（不过滤） | 例：`'%TEG技术工程事业群%'` |
| `:post_id` | 岗位 ID（可选） | 全部 | — |
| `:recruit_owner_id` | 招聘经理 ID（可选） | 全部 | — |
| `:work_location_id` | 工作地 ID（可选） | 全部 | — |
| `:channel_id` | 渠道 ID（可选） | 全部 | — |

### 维度 GROUP BY 速查

| 维度 | 「面试全流程」/「简历评估」表 | 「招聘岗位信息」表 |
| --- | --- | --- |
| 组织（按层级展开） | `GROUP BY id`（先 `unnest(split(cols, '.'))` 展开） | `GROUP BY split_value`（先 `unnest(split(recruit_post_org_full_path, '.'))` 展开） |
| 岗位 | `GROUP BY post_id, post_name_cn, is_secret_post, recruit_post_org_id_cb` | `GROUP BY t1.post_id` |
| 招聘经理 | `GROUP BY t1.recruit_owner, recruit_owner_id` | `GROUP BY t1.post_id, t1.recruit_owner_id, t1.recruit_owner` |

### 表别名约定

- `t1` = 主表（`Report_Recruit_Flow_Detail` 或 `Report_Recruit_Resume_Assessment`）
- `t2` = 招聘岗位信息辅表（`Report_Position_Management_Recruitment_P_I_Daily_Slice`）

### 关键 JOIN 字段（已通过表元数据校验）

| 主表 | 辅表 | JOIN 条件 |
| --- | --- | --- |
| `Report_Recruit_Flow_Detail.post_id` | `Report_Position_Management_Recruitment_P_I_Daily_Slice.recruit_post_id` | `t1.post_id = t2.recruit_post_id` |
| `Report_Recruit_Resume_Assessment.post_id` | 同上 | `t1.post_id = t2.recruit_post_id` |
| `Report_Recruit_Resume_Assessment.flow_main_id` | `Report_Recruit_Flow_Detail.resume_assess_flow_main_id` | 用于 C1 跨表关联 |

### 常用过滤字段（🔴 2026-06-12 勘误：T_ASSESS 不带 staff_type_id / flow_id）

| 字段 | 说明 | 默认值 | T_FLOW | T_ASSESS |
| --- | --- | --- | --- | --- |
| `staff_type_id` | 员工类型 ID | `'2'` | ✅ 带 | ❌ **不带** |
| `flow_id` | 流程类型 ID | `3`（社招）/ `5`（活水） | ✅ 带 | ❌ **不带** |
| `location_country_name` | 招聘岗位国家 | `LIKE '%中国%'` | ✅ 带 | ✅ 带 |

> ⚠️ 原文「两边都要带」表述有误：`Report_Recruit_Resume_Assessment`（T_ASSESS）侧**不能**加 `staff_type_id` / `flow_id`，否则口径错误（见 README 勘误 B）。

---

## 🔧 四类查询模式：完整可执行 SQL 模板

> **重要**：上一节（A/B/C/D）每条指标的"取值逻辑"代码块**仅是 SELECT 子句片段**（来自 治理口径原文，便于回溯校对）。
> **真要执行查询，请使用本节的完整 SQL 模板**。占位符规则同上一节。

### 模式 1：A 组（需求与漏斗概览）— 双表 JOIN

适用：A1 ~ A12（共 12 个指标）。这一类指标的特点是**以"招聘岗位"为粒度**，需把候选人侧（t1）的人次聚合到岗位侧（t2）。

#### 模板 1A：单指标查询（以 A3「已完成需求数入职」为例）

```sql
SELECT
  COUNT(
    CASE
      WHEN (t1.hire_date >= ':begin_date'
            AND t1.hire_date <= ':end_date'
            AND t1.is_entry = 1)
        OR (t1.huoshui_transfer_date >= ':begin_date'
            AND t1.huoshui_transfer_date <= ':end_date')
      THEN 1
      ELSE NULL
    END
  ) AS finish_cnt
FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail t1
INNER JOIN catalog_dos_da_mcp.hrdw.Report_Position_Management_Recruitment_P_I_Daily_Slice t2
        ON t1.post_id = t2.recruit_post_id
WHERE t1.staff_type_id = '2'
  AND t1.location_country_name LIKE '%中国%'
  AND t2.is_disabled = '0'                    -- 默认只看在招岗位
  -- 可选筛选
  -- AND t2.recruit_post_belong_org_full_name LIKE '%TEG技术工程事业群%'
  -- AND t1.post_id = ':post_id'
  -- AND t1.recruit_owner_id = ':recruit_owner_id'
LIMIT 1000;
```

#### 模板 1B：A 组完整 12 项一次性聚合（**推荐**：一次查询取全部）

```sql
SELECT
  -- A1 在招需求数：基于岗位口径 + 发 offer 后未结束的注册数
  --   注：A1 完整逻辑含子查询 register_cnt，详见 A1 详述；此处给出近似可跑版本
  SUM(
    CASE
      WHEN t2.is_disabled = '1' AND t2.last_update_time < ':next_date' THEN 0
      ELSE COALESCE(t2.person_count, 0)
    END
  )
  + SUM(
    CASE
      WHEN t1.send_offer_time < ':next_date'
       AND (t1.flow_end_time >= ':next_date' OR t1.flow_end_time IS NULL)
       AND t1.flow_id = 3
       AND t1.state_id NOT IN (5, 6)
      THEN 1 ELSE 0
    END
  ) AS on_going_post_count,

  -- A3 已完成需求数（入职）
  COUNT(
    CASE
      WHEN (t1.hire_date >= ':begin_date' AND t1.hire_date <= ':end_date' AND t1.is_entry = 1)
        OR (t1.huoshui_transfer_date >= ':begin_date' AND t1.huoshui_transfer_date <= ':end_date')
      THEN 1 ELSE NULL
    END
  ) AS finish_post_onboard_count,

  -- A4 已完成需求数（offer）
  COUNT(
    CASE
      WHEN (t1.take_offer_time >= ':begin_date' AND t1.take_offer_time < ':next_date'
            AND t1.flow_id = 3
            AND (t1.state_id NOT IN (5, 6)
                 OR (t1.state_id IN (5, 6) AND t1.flow_end_time > ':next_date')))
        OR (t1.huoshui_in_dept_approval_time >= ':begin_date' AND t1.huoshui_in_dept_approval_time < ':next_date'
            AND t1.flow_id = 5
            AND (t1.state_id NOT IN (11)
                 OR (t1.state_id = 11 AND t1.flow_end_time > ':next_date')))
      THEN 1 ELSE NULL
    END
  ) AS finish_post_offer_count,

  -- A5 平均招聘天数
  AVG(
    CASE
      WHEN t1.hire_date >= ':begin_date' AND t1.hire_date <= ':end_date'
        THEN DATEDIFF(t1.hire_date, t2.publish_time)
      WHEN t1.huoshui_transfer_date >= ':begin_date' AND t1.huoshui_transfer_date <= ':end_date'
        THEN DATEDIFF(t1.huoshui_transfer_date, t2.publish_time)
      ELSE NULL
    END
  ) AS avg_recruit_days,

  -- A6 全部流程中（除简历评估）
  COUNT(
    CASE
      WHEN t1.start_intv_time < ':next_date'
       AND (t1.flow_end_time > ':next_date' OR t1.flow_end_time IS NULL)
      THEN 1
      WHEN t1.huoshui_start_intv_time < ':next_date'
       AND (t1.flow_end_time > ':next_date' OR t1.flow_end_time IS NULL)
      THEN 1
      ELSE NULL
    END
  ) AS flow_active_count,

  -- A7 评估中
  COUNT(
    CASE
      WHEN t1.start_huoshui_resume_assess_time < ':next_date'
       AND (t1.huoshui_resume_assess_time > ':next_date' OR t1.huoshui_resume_assess_time IS NULL)
      THEN 1 ELSE NULL
    END
  ) AS flow_evaluating_count,

  -- A8 面试中
  COUNT(
    CASE
      WHEN t1.start_intv_time < ':next_date'
       AND (t1.flow_end_time > ':next_date' OR t1.flow_end_time IS NULL)
       AND (t1.hr_salary_negotiation_arrive_time > ':next_date' OR t1.hr_salary_negotiation_arrive_time IS NULL)
      THEN 1
      WHEN t1.huoshui_start_intv_time < ':next_date'
       AND (t1.flow_end_time > ':next_date' OR t1.flow_end_time IS NULL)
       AND (t1.huoshui_in_dept_approval_time > ':next_date' OR t1.huoshui_in_dept_approval_time IS NULL)
      THEN 1
      ELSE NULL
    END
  ) AS flow_interviewing_count,

  -- A9 offer 中（注：治理口径原文社招分支被截断，仅给活水分支）
  COUNT(
    CASE
      WHEN (COALESCE(t1.huoshui_hire_arrive_time, t1.start_huoshui_out_first_approval_time) > ':next_date'
            OR COALESCE(t1.huoshui_hire_arrive_time, t1.start_huoshui_out_first_approval_time) IS NULL)
       AND t1.flow_id = 5
       AND (t1.state_id NOT IN (11)
            OR (t1.state_id = 11 AND t1.flow_end_time > ':next_date'))
      THEN 1 ELSE NULL
    END
  ) AS flow_offer_stage_count,

  -- A10 入职中/调动中
  COUNT(
    CASE
      WHEN t1.take_offer_time < ':next_date'
       AND (t1.hire_date > ':next_date' OR t1.hire_date IS NULL)
       AND t1.flow_id = 3
       AND (t1.state_id NOT IN (5, 6) OR (t1.state_id IN (5, 6) AND t1.flow_end_time > ':next_date'))
      THEN 1
      WHEN t1.huoshui_out_first_approval_time < ':next_date'
       AND (t1.flow_end_time > ':next_date' OR t1.flow_end_time IS NULL)
       AND t1.flow_id = 5
       AND (t1.state_id NOT IN (11) OR (t1.state_id = 11 AND t1.flow_end_time > ':next_date'))
      THEN 1
      ELSE NULL
    END
  ) AS flow_onboarding_count,

  -- A11 口头 turndown
  COUNT(
    CASE
      WHEN t1.hr_salary_negotiation_process_time >= ':begin_date'
       AND t1.hr_salary_negotiation_process_time < ':next_date'
       AND t1.hr_salary_negotiation_state = '放弃'
       AND t1.is_know_salary_data = 1
      THEN 1
      WHEN t1.hr_salary_negotiation_state = '通过'
       AND t1.send_offer_time IS NULL
       AND t1.flow_end_time >= ':begin_date'
       AND t1.flow_end_time < ':next_date'
      THEN 1
      ELSE NULL
    END
  ) AS turndown_count,

  -- A12 拒绝 offer
  COUNT(
    CASE
      WHEN t1.offer_giveup_time >= ':begin_date' AND t1.offer_giveup_time < ':next_date' THEN 1
      WHEN t1.huoshui_giveup_time >= ':begin_date' AND t1.huoshui_giveup_time < ':next_date' THEN 1
      ELSE NULL
    END
  ) AS offer_giveup_count

FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail t1
INNER JOIN catalog_dos_da_mcp.hrdw.Report_Position_Management_Recruitment_P_I_Daily_Slice t2
        ON t1.post_id = t2.recruit_post_id
WHERE t1.staff_type_id = '2'
  AND t1.location_country_name LIKE '%中国%'
  AND t2.is_disabled = '0'
  -- 可选筛选
  -- AND t2.recruit_post_belong_org_full_name LIKE '%TEG技术工程事业群%'
LIMIT 1000;

-- A2 总需求数 = A1 + A3，可在前端层做加法，无需单独 SQL
```

> **A1 单独说明**：A1 严格定义包含子查询 `register_cnt`（已发 offer 但流程未结束的人数），逻辑上更精准的写法见 A1 详述。模板 1B 中的 A1 实现近似 = "在招岗位的 `person_count` 之和 + 发 offer 后未结束注册人数"，与 治理口径原文等价但更易在 GROUP BY 维度下运行。

#### 模式 1 维度扩展：按组织/岗位/招聘经理分组

```sql
-- 按岗位维度
SELECT
  t1.post_id,
  t1.post_name_cn,
  COUNT(...) AS finish_post_onboard_count
FROM ... JOIN ... WHERE ...
GROUP BY t1.post_id, t1.post_name_cn
LIMIT 1000;

-- 按招聘经理维度
GROUP BY t1.post_id, t1.recruit_owner_id, t1.recruit_owner

-- 按组织维度（按层级展开）
SELECT split_value AS org_full_name, COUNT(...) AS finish_post_onboard_count
FROM (
  SELECT t1.*, t2.publish_time, t2.recruit_post_belong_org_full_name
  FROM ... JOIN ... WHERE ...
) base
LATERAL VIEW EXPLODE(SPLIT(recruit_post_belong_org_full_name, '/')) tab AS split_value
WHERE split_value IS NOT NULL AND split_value != ''
GROUP BY split_value
LIMIT 1000;
```

> 说明：治理口径原文写的是 `unnest(split(recruit_post_org_full_path, '.'))`，这是 PostgreSQL/Trino 风格语法。
> 在 StarRocks 中的等价写法是 `LATERAL VIEW EXPLODE(SPLIT(...))` 或 `UNNEST(SPLIT_TO_ARRAY(...))`。
> 实测时按当前 StarRocks 版本调整即可。

---

### 模式 2：B 组数量 + D 组辅助 — 单表 21 项一次取出

适用：B1 ~ B10、D1 ~ D12（B11 例外，走简历评估表，见模式 3）。
特点：全部来自 `Report_Recruit_Flow_Detail`，固定条件 `staff_type_id = '2' AND flow_id = 3`，按业务时间窗口聚合。

#### 模板 2A：单表 21 项漏斗指标完整 SQL

```sql
SELECT
  -- B 组：通过/进度数量（10 项，B11 在模式 3）
  SUM(CASE WHEN is_start_intv = 1                       AND start_intv_time                  >= ':begin_date' AND start_intv_time                  < DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS start_intv_cnt,                       -- B1 发起面试数
  SUM(CASE WHEN is_dept_professional_intv = 1           AND dept_professional_intv_time      >= ':begin_date' AND dept_professional_intv_time      < DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS dept_professional_intv_cnt,           -- B2 部门内专业面试通过数
  SUM(CASE WHEN is_cf_intv = 1                          AND cf_intv_time                     >= ':begin_date' AND cf_intv_time                     < DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS cf_intv_cnt,                          -- B3 通道面委面试通过数
  SUM(CASE WHEN is_dm_intv = 1                          AND dm_intv_time                     >= ':begin_date' AND dm_intv_time                     < DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS dm_intv_cnt,                          -- B4 用人决策面试通过数
  SUM(CASE WHEN is_hr_intv = 1                          AND hr_intv_time                     >= ':begin_date' AND hr_intv_time                     < DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS hr_intv_cnt,                          -- B5 HR 资格面试通过数
  SUM(CASE WHEN is_offer_approval = 1
            AND start_offer_approval_time >= ':begin_date'
            AND start_offer_approval_time <= DATE_ADD(':end_date', INTERVAL 1 DAY)
            AND COALESCE(offer_approval_time, '9999-12-31') >= ':end_date'                                                                                THEN 1 ELSE 0 END) AS offer_approval_cnt,                       -- B6 offer 审批中人数
  SUM(CASE WHEN hr_salary_negotiation_time IS NOT NULL  AND hr_salary_negotiation_time       >= ':begin_date' AND hr_salary_negotiation_time       < DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS hr_salary_negotiation_pass_cnt,       -- B7 薪资谈判通过数（统一别名为 *_pass_cnt 供 C6 引用）
  SUM(CASE WHEN is_send_offer = 1                       AND send_offer_time                  >= ':begin_date' AND send_offer_time                  < DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS send_offer_cnt,                       -- B8 发送 offer 数
  SUM(CASE WHEN is_entry = 1                            AND hire_date                        >= ':begin_date' AND hire_date                        < DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS entry_cnt,                            -- B9 入职数
  SUM(CASE WHEN is_resume_assess = 1                    AND start_intv_time                  >= ':begin_date' AND start_intv_time                  < DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS resume_assess_cnt,                    -- B10 有简历评估面试数

  -- D 组：辅助指标（12 项，用于支撑 C 组比率分母）
  SUM(CASE WHEN is_start_dept_professional_intv = 1     AND start_dept_professional_intv_time>= ':begin_date' AND start_dept_professional_intv_time< DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS start_dept_professional_intv_cnt,            -- D1
  SUM(CASE WHEN is_dept_professional_intv_no_submit = 1 AND start_dept_professional_intv_time>= ':begin_date' AND start_dept_professional_intv_time< DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS start_dept_professional_intv_no_submit_cnt, -- D2
  SUM(CASE WHEN is_start_cf_intv = 1                    AND start_cf_intv_time               >= ':begin_date' AND start_cf_intv_time               < DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS start_cf_intv_cnt,                            -- D3
  SUM(CASE WHEN is_cf_intv_no_submit = 1                AND start_cf_intv_time               >= ':begin_date' AND start_cf_intv_time               < DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS start_cf_intv_no_submit_cnt,                  -- D4
  SUM(CASE WHEN is_dm_intv_no_submit = 1                AND start_dm_intv_time               >= ':begin_date' AND start_dm_intv_time               < DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS start_dm_intv_no_submit_cnt,                  -- D5
  SUM(CASE WHEN is_start_dm_intv = 1                    AND start_dm_intv_time               >= ':begin_date' AND start_dm_intv_time               < DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS start_dm_intv_cnt,                            -- D6
  SUM(CASE WHEN is_start_hr_intv = 1                    AND start_hr_intv_time               >= ':begin_date' AND start_hr_intv_time               < DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS start_hr_intv_cnt,                            -- D7
  SUM(CASE WHEN is_hr_intv_no_submit = 1                AND start_hr_intv_time               >= ':begin_date' AND start_hr_intv_time               < DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS hr_intv_no_submit_cnt,                        -- D8
  SUM(CASE WHEN is_hr_salary_negotiation = 1            AND hr_salary_negotiation_time       >= ':begin_date' AND hr_salary_negotiation_time       < DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS hr_salary_negotiation_time_cnt,               -- D9
  SUM(CASE WHEN is_hr_salary_negotiation_no_submit = 1  AND hr_salary_negotiation_time       >= ':begin_date' AND hr_salary_negotiation_time       < DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS hr_salary_negotiation_no_submit_cnt,         -- D10
  SUM(CASE WHEN is_offer_approval = 1                   AND start_offer_approval_time        >= ':begin_date' AND start_offer_approval_time        < DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS send_offer_approval_cnt,                      -- D11
  SUM(CASE WHEN is_offer_approval_no_submit = 1         AND start_offer_approval_time        >= ':begin_date' AND start_offer_approval_time        < DATE_ADD(':end_date', INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS offer_approval_no_submit_cnt                  -- D12

FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
WHERE staff_type_id = '2'
  AND flow_id = 3
  AND location_country_name LIKE '%中国%'
  -- 可选筛选
  -- AND recruit_post_belong_org_full_name LIKE '%TEG技术工程事业群%'
  -- AND post_id = ':post_id'
  -- AND recruit_owner_id = ':recruit_owner_id'
  -- AND channel_id = ':channel_id'
LIMIT 1000;
```

#### 模板 2B：C 组比率 — 在模板 2A 外层 CTE 计算

```sql
WITH base_metrics AS (
  -- 把模板 2A 整段 SELECT 包进来
  SELECT
    SUM(CASE WHEN is_start_intv = 1 AND ... THEN 1 ELSE 0 END) AS start_intv_cnt,
    -- ... 21 项指标 ...
    SUM(CASE WHEN is_offer_approval_no_submit = 1 AND ... THEN 1 ELSE 0 END) AS offer_approval_no_submit_cnt
  FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
  WHERE staff_type_id = '2' AND flow_id = 3
)
SELECT
  -- C2 部门内面试通过率
  COALESCE(
    CASE
      WHEN start_dept_professional_intv_cnt - start_dept_professional_intv_no_submit_cnt <> 0
        THEN CAST(dept_professional_intv_cnt AS DECIMAL)
             / (start_dept_professional_intv_cnt - start_dept_professional_intv_no_submit_cnt)
      ELSE 0
    END, 0
  ) AS dept_professional_intv_rate,

  -- C3 通道面委面试通过率
  COALESCE(
    CASE WHEN start_cf_intv_cnt - start_cf_intv_no_submit_cnt <> 0
      THEN CAST(cf_intv_cnt AS DECIMAL) / (start_cf_intv_cnt - start_cf_intv_no_submit_cnt)
      ELSE 0 END, 0
  ) AS cf_intv_rate,

  -- C4 用人决策面试通过率
  COALESCE(
    CASE WHEN start_dm_intv_cnt - start_dm_intv_no_submit_cnt <> 0
      THEN CAST(dm_intv_cnt AS DECIMAL) / (start_dm_intv_cnt - start_dm_intv_no_submit_cnt)
      ELSE 0 END, 0
  ) AS dm_intv_rate,

  -- C5 HR 资格面试通过率
  COALESCE(
    CASE WHEN start_hr_intv_cnt - hr_intv_no_submit_cnt <> 0
      THEN CAST(hr_intv_cnt AS DECIMAL) / (start_hr_intv_cnt - hr_intv_no_submit_cnt)
      ELSE 0 END, 0
  ) AS hr_intv_rate,

  -- C6 HR 薪资谈判通过率
  COALESCE(
    CASE
      WHEN hr_intv_cnt - hr_salary_negotiation_no_submit_cnt = 0 THEN 0
      WHEN hr_intv_cnt - hr_salary_negotiation_no_submit_cnt <> 0
        THEN CAST(hr_salary_negotiation_pass_cnt AS DECIMAL)
             / (hr_intv_cnt - hr_salary_negotiation_no_submit_cnt)
      ELSE 0
    END, 0
  ) AS hr_salary_negotiation_rate,

  -- C7 进入 offer 审批率
  COALESCE(
    CASE WHEN hr_salary_negotiation_time_cnt - hr_salary_negotiation_no_submit_cnt <> 0
      THEN CAST(offer_approval_cnt AS DECIMAL)
           / (hr_salary_negotiation_time_cnt - hr_salary_negotiation_no_submit_cnt)
      ELSE 0 END, 0
  ) AS offer_approval_rate,

  -- C8 发送 offer 率
  COALESCE(
    CASE WHEN send_offer_approval_cnt - offer_approval_no_submit_cnt <> 0
      THEN CAST(send_offer_cnt AS DECIMAL)
           / (send_offer_approval_cnt - offer_approval_no_submit_cnt)
      ELSE 0 END, 0
  ) AS send_offer_rate,

  -- C9 入职率
  COALESCE(
    CASE WHEN send_offer_cnt <> 0
      THEN CAST(entry_cnt AS DECIMAL) / send_offer_cnt
      ELSE 0 END, 0
  ) AS entry_rate,

  -- 顺带带出原始数量供前端展示
  start_intv_cnt, dept_professional_intv_cnt, cf_intv_cnt, dm_intv_cnt, hr_intv_cnt,
  offer_approval_cnt, hr_salary_negotiation_pass_cnt, send_offer_cnt, entry_cnt, resume_assess_cnt
FROM base_metrics
LIMIT 1;
```

---

### 模式 3：B11 + C1 — 简历评估宽表（单表/跨表）

适用：B11 渠道收到评估数、C1 渠道发起面试率（C1 涉及跨表 JOIN）。

#### 模板 3A：B11 渠道收到评估数（单表）

```sql
SELECT
  SUM(
    CASE
      WHEN COALESCE(flow_end_time, '9999-12-31') < DATE_ADD(':end_date', INTERVAL 1 DAY)
        OR process_time IS NULL
      THEN 1 ELSE 0
    END
  ) AS channel_cnt
FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Resume_Assessment
-- 🔴 2026-06-12 勘误：T_ASSESS 不加 staff_type_id、不加 flow_id（见 README 勘误 B）
WHERE location_country_name LIKE '%中国%'
LIMIT 1000;
```

#### 模板 3B：C1 渠道发起面试率（跨表 JOIN）

```sql
WITH assess_base AS (
  -- 简历评估宽表上算 channel_cnt（B11）和 resume_assessing_cnt（评估中）
  SELECT
    SUM(CASE
          WHEN COALESCE(flow_end_time, '9999-12-31') < DATE_ADD(':end_date', INTERVAL 1 DAY)
            OR process_time IS NULL
          THEN 1 ELSE 0
        END) AS channel_cnt,
    SUM(CASE
          WHEN process_time IS NULL
            AND (flow_end_time IS NULL OR flow_end_time > ':end_date')
          THEN 1 ELSE 0
        END) AS resume_assessing_cnt
  FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Resume_Assessment
  -- 🔴 2026-06-12 勘误：T_ASSESS 不加 staff_type_id、不加 flow_id（见 README 勘误 B）
  WHERE location_country_name LIKE '%中国%'
),
flow_base AS (
  -- 面试全流程宽表上算 resume_assess_cnt（B10）
  SELECT
    SUM(CASE
          WHEN is_resume_assess = 1
           AND start_intv_time >= ':begin_date'
           AND start_intv_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
          THEN 1 ELSE 0
        END) AS resume_assess_cnt
  FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
  WHERE staff_type_id = '2' AND flow_id = 3
)
SELECT
  COALESCE(
    CASE
      WHEN a.channel_cnt - a.resume_assessing_cnt <> 0
        THEN CAST(f.resume_assess_cnt AS DECIMAL) / (a.channel_cnt - a.resume_assessing_cnt)
      ELSE 0
    END, 0
  ) AS start_intv_rate,
  a.channel_cnt,
  a.resume_assessing_cnt,
  f.resume_assess_cnt
FROM assess_base a, flow_base f
LIMIT 1;
```

> ⚠️ `resume_assessing_cnt` 在 治理口径原文中没有给出独立 SQL，本模板按"简历评估流程未结束"派生。生效前需与产研对齐口径。

---

### 模式 4：A1 严格版（含子查询 register_cnt）

A1 在 治理基线 中是个相对复杂的派生指标，严格定义如下：

```sql
SELECT
  SUM(
    CASE
      WHEN t2.is_disabled = '1' AND t2.last_update_time < ':next_date' THEN 0
      ELSE COALESCE(t2.person_count, 0)
    END
    + COALESCE(reg.register_cnt, 0)
  ) AS on_going_post_count
FROM catalog_dos_da_mcp.hrdw.Report_Position_Management_Recruitment_P_I_Daily_Slice t2
LEFT JOIN (
  -- 子查询：每个岗位下，已发 offer 但流程未结束的人数（register_cnt）
  SELECT
    post_id,
    COUNT(1) AS register_cnt
  FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
  WHERE send_offer_time < ':next_date'
    AND (flow_end_time >= ':next_date' OR flow_end_time IS NULL)
    AND flow_id = 3
    AND state_id NOT IN (5, 6)
  GROUP BY post_id
) reg ON reg.post_id = t2.recruit_post_id
WHERE t2.is_disabled = '0'                   -- 默认只看在招岗位
  AND t2.publish_time < ':next_date'
  AND (
    COALESCE(t2.person_count, 0) > 0
    OR COALESCE(reg.register_cnt, 0) > 0
  )
LIMIT 1000;
```

---

## A. 需求与漏斗概览（12 项详细口径）

> **本节定位**：每条指标的**业务定义、治理口径原文 SELECT 子句片段、字段映射、依赖关系**——便于审计和回溯校对 治理基线。
> **要执行 SQL 跑数？请用上一节「四类查询模式」的完整模板**（已含 FROM/JOIN/WHERE）：
> - **A1**：见 §「模式 4：A1 严格版」；近似简化版见 §「模板 1B」中的 `on_going_post_count`
> - **A2 总需求数**：在前端层做加法 `A1 + A3`，无需独立 SQL
> - **A3-A12**：见 §「模板 1B」（一次 SELECT 取出 11 个指标）

### A1. 在招需求数 `recruit-on-going-post-count`（派生）

- **同义词**：在招岗位数、在招需求、ongoing posts、在招职位数
- **定义**：当前处于"在招"状态的岗位需求数。在岗位维度上，等于该岗位的"还需招聘人数"。
- **数据源**：`catalog_dos_da_mcp.hrdw.Report_Position_Management_Recruitment_P_I_Daily_Slice` (t2) + `catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail` (t1, 子查询补充注册数)
- **统计口径**：人数次（基于岗位维度的 `person_count`）
- **取值逻辑**：

  ```sql
  -- 主指标
  CASE
    WHEN is_disabled = '1' AND last_update_time < ':next_date' THEN 0
    ELSE person_count
  END + COALESCE(register_cnt, 0) AS person_count

  -- register_cnt 子查询（来自 Report_Recruit_Flow_Detail）
  SELECT COUNT(1)
  FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
  WHERE send_offer_time < ':next_date'
    AND (flow_end_time >= ':next_date' OR flow_end_time IS NULL)
    AND flow_id = 3
    AND state_id NOT IN (5, 6)
  ```

- **筛选在招岗位**：`person_count > 0 AND (is_disabled = '0' OR (is_disabled = '1' AND last_update_time >= ':next_date')) AND publish_time < ':next_date'`
- **固定业务条件**：`t1.staff_type_id = '2'`、`t1.location_country_name LIKE '%中国%'`、`t2.is_disabled = '#is_disabled'`（默认 `#is_disabled = '0'`）

### A2. 总需求数 `recruit-total-post-count`（复合）

- **同义词**：总岗位数、需求总量
- **公式**：`总需求数 = 在招需求数 + 已完成需求数（入职）`
- **取值逻辑**：

  ```sql
  COALESCE(t2.person_count, 0) + COALESCE(t1.finish_cnt, 0) AS total_cnt
  ```

- **依赖原子指标**：A1（在招需求数）、A3（已完成需求数入职）
- **数据源**：同 A1（双表 JOIN）

### A3. 已完成需求数（入职） `recruit-finish-post-onboard-count`（原子）

- **同义词**：已完成需求-入职数、已入职完成需求
- **定义**：业务时间窗口内，候选人在该岗位上完成入职/活水调动到岗的人次。
- **取值逻辑**：

  ```sql
  COUNT(
    CASE
      WHEN (hire_date >= ':begin_date'
            AND hire_date <= ':end_date'
            AND is_entry = 1)
        OR (huoshui_transfer_date >= ':begin_date'
            AND huoshui_transfer_date <= ':end_date')
      THEN 1
      ELSE NULL
    END
  ) AS finish_cnt
  ```

- **数据源**：`Report_Recruit_Flow_Detail` (t1) + `Report_Position_Management_Recruitment_P_I_Daily_Slice` (t2)
- **固定业务条件**：`t1.staff_type_id = '2'`、`t1.location_country_name LIKE '%中国%'`、`t2.is_disabled = '#is_disabled'`

### A4. 已完成需求数（offer） `recruit-finish-post-offer-count`（原子）

- **同义词**：已完成需求-offer 数、已发 offer 完成需求
- **定义**：业务时间窗口内候选人接受 offer 的人次（社招走 `take_offer_time`，活水走 `huoshui_in_dept_approval_time`），已排除流程作废态。
- **取值逻辑**：

  ```sql
  COUNT(
    CASE
      WHEN (
        take_offer_time >= ':begin_date' AND take_offer_time < ':next_date'
        AND flow_id = 3
        AND (state_id NOT IN (5, 6)
             OR (state_id IN (5, 6) AND flow_end_time > ':next_date'))
      )
      OR (
        huoshui_in_dept_approval_time >= ':begin_date'
        AND huoshui_in_dept_approval_time < ':next_date'
        AND flow_id = 5
        AND (state_id NOT IN (11)
             OR (state_id = 11 AND flow_end_time > ':next_date'))
      ) THEN 1
      ELSE NULL
    END
  ) AS offer_cnt
  ```

- **关键码值**：`state_id = 5/6` 社招放弃；`state_id = 11` 活水放弃。
- **注意**：本指标**会同时统计** `flow_id=3`(社招) 和 `flow_id=5`(活水)，是少数跨流程的指标。

### A5. 平均招聘天数 `recruit-avg-recruit-days`（复合）

- **同义词**：平均招聘周期、avg recruit days
- **定义**：完成入职/调动到岗的候选人，从岗位发布到入职/到岗的天数均值。
- **取值逻辑**：

  ```sql
  AVG(
    CASE
      WHEN hire_date >= ':begin_date' AND hire_date <= ':end_date'
        THEN DATEDIFF(t1.hire_date, t2.publish_time)
      WHEN huoshui_transfer_date >= ':begin_date' AND huoshui_transfer_date <= ':end_date'
        THEN DATEDIFF(t1.huoshui_transfer_date, t2.publish_time)
      ELSE NULL
    END
  ) AS avg_recruit_days
  ```

- **依赖字段**：来自 t1 的 `hire_date / huoshui_transfer_date`，来自 t2 的 `publish_time`。

### A6. 全部流程中（除简历评估） `recruit-flow-active-count`（派生，时点快照）

- **同义词**：流程中总人数、活跃流程数
- **定义**：截至 `:next_date`（次日 0 点），已发起面试/活水面试且流程未结束的人次（不含纯简历评估阶段）。
- **取值逻辑**：

  ```sql
  COUNT(
    CASE
      WHEN start_intv_time < ':next_date'
       AND (flow_end_time > ':next_date' OR flow_end_time IS NULL)
      THEN 1
      WHEN huoshui_start_intv_time < ':next_date'
       AND (flow_end_time > ':next_date' OR flow_end_time IS NULL)
      THEN 1
      ELSE NULL
    END
  ) AS all_flow_cnt
  ```

### A7. 评估中 `recruit-flow-evaluating-count`（派生，时点快照）

- **定义**：截至 `:next_date`，活水流程已发起简历评估、但评估未完成的人次。
- **取值逻辑**：

  ```sql
  COUNT(
    CASE
      WHEN start_huoshui_resume_assess_time < ':next_date'
       AND (huoshui_resume_assess_time > ':next_date'
            OR huoshui_resume_assess_time IS NULL)
      THEN 1
      ELSE NULL
    END
  ) AS evaluate_flow_cnt
  ```

### A8. 面试中 `recruit-flow-interviewing-count`（派生，时点快照）

- **定义**：截至 `:next_date`，已发起面试且未进入薪资谈判（社招）/调入审批（活水）的流程人次。
- **取值逻辑**：

  ```sql
  COUNT(
    CASE
      -- 社招分支
      WHEN start_intv_time < ':next_date'
       AND (flow_end_time > ':next_date' OR flow_end_time IS NULL)
       AND (hr_salary_negotiation_arrive_time > ':next_date'
            OR hr_salary_negotiation_arrive_time IS NULL)
      THEN 1
      -- 活水分支
      WHEN huoshui_start_intv_time < ':next_date'
       AND (flow_end_time > ':next_date' OR flow_end_time IS NULL)
       AND (huoshui_in_dept_approval_time > ':next_date'
            OR huoshui_in_dept_approval_time IS NULL)
      THEN 1
      ELSE NULL
    END
  ) AS interview_flow_cnt
  ```

### A9. offer 中 `recruit-flow-offer-stage-count`（派生，时点快照）

- **定义**：截至 `:next_date`，处于 offer 审批/发放阶段但尚未结束的人次（活水分支为主）。
- **⚠️ 取值逻辑（治理口径原文截断，仅活水分支可见）**：

  ```sql
  COUNT(
    CASE
      WHEN (
        COALESCE(huoshui_hire_arrive_time, start_huoshui_out_first_approval_time) > ':next_date'
        OR COALESCE(huoshui_hire_arrive_time, start_huoshui_out_first_approval_time) IS NULL
      )
      AND flow_id = 5
      AND (state_id NOT IN (11)
           OR (state_id = 11 AND flow_end_time > ':next_date'))
      THEN 1
      ELSE NULL
    END
  ) AS offer_flow_cnt
  ```
- **TODO**：治理口径原文中社招分支被截断，使用前需确认。建议查"取值逻辑"完整版本（前置条件可能涉及 `take_offer_time / send_offer_time / hr_salary_negotiation_state`）。

### A10. 入职中/调动中 `recruit-flow-onboarding-count`（派生，时点快照）

- **定义**：截至 `:next_date`，已发 offer/已审批通过、但尚未完成入职/调动到岗的人次。
- **取值逻辑**：

  ```sql
  COUNT(
    CASE
      -- 社招：已接受 offer 但未入职
      WHEN take_offer_time < ':next_date'
       AND (hire_date > ':next_date' OR hire_date IS NULL)
       AND flow_id = 3
       AND (state_id NOT IN (5, 6)
            OR (state_id IN (5, 6) AND flow_end_time > ':next_date'))
      THEN 1
      -- 活水：已发起调出审批但未结束
      WHEN huoshui_out_first_approval_time < ':next_date'
       AND (flow_end_time > ':next_date' OR flow_end_time IS NULL)
       AND flow_id = 5
       AND (state_id NOT IN (11)
            OR (state_id = 11 AND flow_end_time > ':next_date'))
      THEN 1
      ELSE NULL
    END
  ) AS register_flow_cnt
  ```

### A11. 口头 turndown `recruit-turndown-count`（派生）

- **定义**：业务时间窗口内 ① HR 薪资谈判结果为"放弃"且已知薪资数据；② 或薪资谈判通过但流程结束未发 offer。
- **取值逻辑**：

  ```sql
  COUNT(
    CASE
      WHEN hr_salary_negotiation_process_time >= ':begin_date'
       AND hr_salary_negotiation_process_time < ':next_date'
       AND hr_salary_negotiation_state = '放弃'
       AND is_know_salary_data = 1
      THEN 1
      WHEN hr_salary_negotiation_state = '通过'
       AND send_offer_time IS NULL
       AND flow_end_time >= ':begin_date'
       AND flow_end_time < ':next_date'
      THEN 1
      ELSE NULL
    END
  ) AS turn_down_cnt
  ```

### A12. 拒绝 offer `recruit-offer-giveup-count`（原子）

- **定义**：业务时间窗口内候选人在收到 offer 后主动放弃的人次（同时统计社招 `offer_giveup_time` 和活水 `huoshui_giveup_time`）。
- **取值逻辑**：

  ```sql
  COUNT(
    CASE
      WHEN offer_giveup_time >= ':begin_date'
       AND offer_giveup_time < ':next_date'
      THEN 1
      WHEN huoshui_giveup_time >= ':begin_date'
       AND huoshui_giveup_time < ':next_date'
      THEN 1
      ELSE NULL
    END
  ) AS offer_giveup_cnt
  ```

---

## B. 环节通过/进度数量（11 项详细口径）

> **本节定位**：业务定义 + 治理口径原文 SELECT 子句片段，便于回溯。
> **要执行 SQL？**：B1-B10 见 §「模板 2A」（与 D 组共 21 项一次取出）；B11 见 §「模板 3A」。
> 本组共有特征：B1-B10 均来自 `Report_Recruit_Flow_Detail`，固定条件 `staff_type_id = '2' AND flow_id = 3`，时间过滤用 `XXX_time >= ':begin_date' AND XXX_time < DATE_ADD(':end_date', INTERVAL 1 DAY)`。**B11 例外**：来自 `Report_Recruit_Resume_Assessment`（T_ASSESS），🔴 **不带 `staff_type_id` / `flow_id`**（2026-06-12 勘误，见 README 勘误 B），仅时间窗 + 国家过滤。

### B1. 发起面试数 `recruit-start-interview-count`

- **取值逻辑**：

  ```sql
  SUM(CASE
    WHEN is_start_intv = 1
     AND start_intv_time >= ':begin_date'
     AND start_intv_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
    THEN 1 ELSE 0
  END) AS start_intv_cnt
  ```

### B2. 部门内专业面试通过数 `recruit-dept-professional-pass-count`

- **取值逻辑**：

  ```sql
  SUM(CASE
    WHEN is_dept_professional_intv = 1
     AND dept_professional_intv_time >= ':begin_date'
     AND dept_professional_intv_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
    THEN 1 ELSE 0
  END) AS dept_professional_intv_cnt
  ```

### B3. 通道面委面试通过数 `recruit-cf-pass-count`

```sql
SUM(CASE
  WHEN is_cf_intv = 1
   AND cf_intv_time >= ':begin_date'
   AND cf_intv_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
  THEN 1 ELSE 0
END) AS cf_intv_cnt
```

### B4. 用人决策面试通过数 `recruit-dm-pass-count`

```sql
SUM(CASE
  WHEN is_dm_intv = 1
   AND dm_intv_time >= ':begin_date'
   AND dm_intv_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
  THEN 1 ELSE 0
END) AS dm_intv_cnt
```

### B5. HR 资格面试通过数 `recruit-hr-pass-count`

```sql
SUM(CASE
  WHEN is_hr_intv = 1
   AND hr_intv_time >= ':begin_date'
   AND hr_intv_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
  THEN 1 ELSE 0
END) AS hr_intv_cnt
```

### B6. offer 审批中人数 `recruit-offer-approval-count`（派生，时点）

- **定义**：业务时间窗口内已发起 offer 审批、且截至窗口结束尚未完成审批的人次。
- **取值逻辑**：

  ```sql
  SUM(CASE
    WHEN is_offer_approval = 1
     AND start_offer_approval_time >= ':begin_date'
     AND start_offer_approval_time <= DATE_ADD(':end_date', INTERVAL 1 DAY)
     AND COALESCE(offer_approval_time, '9999-12-31') >= ':end_date'
    THEN 1 ELSE 0
  END) AS offer_approval_cnt
  ```

### B7. 薪资谈判通过数 `recruit-hr-salary-negotiation-pass-count`

```sql
SUM(CASE
  WHEN hr_salary_negotiation_time IS NOT NULL
   AND hr_salary_negotiation_time >= ':begin_date'
   AND hr_salary_negotiation_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
  THEN 1 ELSE 0
END) AS hr_salary_negotiation_cnt
```

> ⚠️ 别名注意：本指标的 SQL 别名是 `hr_salary_negotiation_cnt`，但被 C6 引用时使用 `hr_salary_negotiation_pass_cnt`。在跨指标拼装时需统一字段名。

### B8. 发送 offer 数 `recruit-send-offer-count`

```sql
SUM(CASE
  WHEN is_send_offer = 1
   AND send_offer_time >= ':begin_date'
   AND send_offer_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
  THEN 1 ELSE 0
END) AS send_offer_cnt
```

### B9. 入职数 `recruit-entry-count`

```sql
SUM(CASE
  WHEN is_entry = 1
   AND hire_date >= ':begin_date'
   AND hire_date < DATE_ADD(':end_date', INTERVAL 1 DAY)
  THEN 1 ELSE 0
END) AS entry_cnt
```

### B10. 有简历评估面试数 `recruit-resume-assess-interview-count`

- **同义词**：渠道发起面试数（注意：与 C1 的"率"指标分子同名）
- **取值逻辑**：

  ```sql
  SUM(CASE
    WHEN is_resume_assess = 1
     AND start_intv_time >= ':begin_date'
     AND start_intv_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
    THEN 1 ELSE 0
  END) AS resume_assess_cnt
  ```

### B11. 渠道收到评估数 `recruit-channel-resume-assess-count`

- **数据源**：`catalog_dos_da_mcp.hrdw.Report_Recruit_Resume_Assessment`（不是面试全流程表）
- **定义**：业务时间窗口内简历到达评估环节的总数（已完成 + 评估中）。
- **取值逻辑**：

  ```sql
  SUM(CASE
    WHEN COALESCE(flow_end_time, '9999-12-31') < DATE_ADD(':end_date', INTERVAL 1 DAY)
      OR process_time IS NULL
    THEN 1 ELSE 0
  END) AS channel_cnt
  ```

---

## C. 漏斗通过率（9 项详细口径）

> **本节定位**：每条比率的公式 + 依赖原子指标，便于回溯校对 治理基线。
> **要执行 SQL？**：C2-C9 见 §「模板 2B」（CTE 包住模板 2A 后做比率）；C1 见 §「模板 3B」（跨表 JOIN）。
> 共有特征：所有率指标都用 `COALESCE((...), 0)` 包裹，分母为 0 时返回 0；分子分母都基于上方 B/D 类原子指标。

### C1. 渠道发起面试率 `recruit-channel-start-interview-rate`

- **数据源**：跨表，需 JOIN `Report_Recruit_Resume_Assessment` 与 `Report_Recruit_Flow_Detail`
- **公式**：`资源评估面试数 / (渠道收到评估数 - 评估中)`
- **取值逻辑**：

  ```sql
  COALESCE(
    CASE
      WHEN channel_cnt - resume_assessing_cnt <> 0
        THEN CAST(resume_assess_cnt AS DECIMAL) / (channel_cnt - resume_assessing_cnt)
      ELSE 0
    END,
    0
  ) AS start_intv_rate
  ```

- **依赖**：B10 (`resume_assess_cnt`)、B11 (`channel_cnt`)、`resume_assessing_cnt`（评估中数，对应 A7 同义概念，需要从同表派生）

### C2. 部门内面试通过率 `recruit-dept-professional-pass-rate`

```sql
COALESCE(
  CASE
    WHEN start_dept_professional_intv_cnt - start_dept_professional_intv_no_submit_cnt <> 0
      THEN CAST(dept_professional_intv_cnt AS DECIMAL)
           / (start_dept_professional_intv_cnt - start_dept_professional_intv_no_submit_cnt)
    ELSE 0
  END,
  0
) AS dept_professional_intv_rate
```

- **依赖**：B2 (`dept_professional_intv_cnt`) / D1 / D2

### C3. 通道面委面试通过率 `recruit-cf-pass-rate`

```sql
COALESCE(
  CASE
    WHEN start_cf_intv_cnt - start_cf_intv_no_submit_cnt <> 0
      THEN CAST(cf_intv_cnt AS DECIMAL) / (start_cf_intv_cnt - start_cf_intv_no_submit_cnt)
    ELSE 0
  END,
  0
) AS cf_intv_rate
```

- **依赖**：B3 / D3 / D4

### C4. 用人决策面试通过率 `recruit-dm-pass-rate`

```sql
COALESCE(
  CASE
    WHEN start_dm_intv_cnt - start_dm_intv_no_submit_cnt <> 0
      THEN CAST(dm_intv_cnt AS DECIMAL) / (start_dm_intv_cnt - start_dm_intv_no_submit_cnt)
    ELSE 0
  END,
  0
) AS dm_intv_rate
```

- **依赖**：B4 / D5 / D6

### C5. HR 资格面试通过率 `recruit-hr-pass-rate`

```sql
COALESCE(
  CASE
    WHEN start_hr_intv_cnt - hr_intv_no_submit_cnt <> 0
      THEN CAST(hr_intv_cnt AS DECIMAL) / (start_hr_intv_cnt - hr_intv_no_submit_cnt)
    ELSE 0
  END,
  0
) AS hr_intv_rate
```

- **依赖**：B5 / D7 / D8

### C6. HR 薪资谈判通过率 `recruit-hr-salary-negotiation-rate`

```sql
COALESCE(
  CASE
    WHEN (hr_intv_cnt - hr_salary_negotiation_no_submit_cnt) = 0 THEN 0
    WHEN hr_intv_cnt - hr_salary_negotiation_no_submit_cnt <> 0
      THEN CAST(hr_salary_negotiation_pass_cnt AS DECIMAL)
           / (hr_intv_cnt - hr_salary_negotiation_no_submit_cnt)
    ELSE 0
  END,
  0
) AS hr_salary_negotiation_rate
```

- **依赖**：B7（注意别名 `hr_salary_negotiation_pass_cnt`）/ B5 (`hr_intv_cnt`) / D10
- **TODO**：核对 B7 在 SELECT 时使用的字段别名，应统一为 `hr_salary_negotiation_pass_cnt` 才能在此公式直接使用。

### C7. 进入 offer 审批率 `recruit-offer-approval-rate`

```sql
COALESCE(
  CASE
    WHEN hr_salary_negotiation_time_cnt - hr_salary_negotiation_no_submit_cnt <> 0
      THEN CAST(offer_approval_cnt AS DECIMAL)
           / (hr_salary_negotiation_time_cnt - hr_salary_negotiation_no_submit_cnt)
    ELSE 0
  END,
  0
) AS offer_approval_rate
```

- **依赖**：B6 (`offer_approval_cnt`) / D9 (`hr_salary_negotiation_time_cnt`) / D10

### C8. 发送 offer 率 `recruit-send-offer-rate`

```sql
COALESCE(
  CASE
    WHEN send_offer_approval_cnt - offer_approval_no_submit_cnt <> 0
      THEN CAST(send_offer_cnt AS DECIMAL)
           / (send_offer_approval_cnt - offer_approval_no_submit_cnt)
    ELSE 0
  END,
  0
) AS send_offer_rate
```

- **依赖**：B8 (`send_offer_cnt`) / D11 (`send_offer_approval_cnt`) / D12

### C9. 入职率 `recruit-entry-rate`

```sql
COALESCE(
  CASE
    WHEN send_offer_cnt <> 0
      THEN CAST(entry_cnt AS DECIMAL) / send_offer_cnt
    ELSE 0
  END,
  0
) AS entry_rate
```

- **依赖**：B9 (`entry_cnt`) / B8 (`send_offer_cnt`)

---

## D. 辅助指标（12 项详细口径）

> **本节定位**：每条辅助指标的 SELECT 子句片段，便于回溯校对 治理基线。
> **要执行 SQL？**：D1-D12 见 §「模板 2A」（与 B 组共 21 项一次取出）。
> 全部为 `Report_Recruit_Flow_Detail` 上的简单 SUM CASE 计数，固定条件 `staff_type_id = '2' AND flow_id = 3`，时间过滤同 B 组。

### D1. 发起部门内专业面试数 `recruit-start-dept-professional-count`

```sql
SUM(CASE
  WHEN is_start_dept_professional_intv = 1
   AND start_dept_professional_intv_time >= ':begin_date'
   AND start_dept_professional_intv_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
  THEN 1 ELSE 0
END) AS start_dept_professional_intv_cnt
```

### D2. 发起部门内专业面试未提交数 `recruit-start-dept-professional-no-submit-count`

```sql
SUM(CASE
  WHEN is_dept_professional_intv_no_submit = 1
   AND start_dept_professional_intv_time >= ':begin_date'
   AND start_dept_professional_intv_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
  THEN 1 ELSE 0
END) AS start_dept_professional_intv_no_submit_cnt
```

### D3. 发起通道面委面试数 `recruit-start-cf-count`

```sql
SUM(CASE
  WHEN is_start_cf_intv = 1
   AND start_cf_intv_time >= ':begin_date'
   AND start_cf_intv_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
  THEN 1 ELSE 0
END) AS start_cf_intv_cnt
```

### D4. 发起通道面委面试未提交数 `recruit-start-cf-no-submit-count`

```sql
SUM(CASE
  WHEN is_cf_intv_no_submit = 1
   AND start_cf_intv_time >= ':begin_date'
   AND start_cf_intv_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
  THEN 1 ELSE 0
END) AS start_cf_intv_no_submit_cnt
```

### D5. 发起用人决策者面试未提交数 `recruit-start-dm-no-submit-count`

```sql
SUM(CASE
  WHEN is_dm_intv_no_submit = 1
   AND start_dm_intv_time >= ':begin_date'
   AND start_dm_intv_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
  THEN 1 ELSE 0
END) AS start_dm_intv_no_submit_cnt
```

### D6. 发起用人决策者面试数 `recruit-start-dm-count`

```sql
SUM(CASE
  WHEN is_start_dm_intv = 1
   AND start_dm_intv_time >= ':begin_date'
   AND start_dm_intv_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
  THEN 1 ELSE 0
END) AS start_dm_intv_cnt
```

### D7. 发起 hr 资格面试数 `recruit-start-hr-count`

```sql
SUM(CASE
  WHEN is_start_hr_intv = 1
   AND start_hr_intv_time >= ':begin_date'
   AND start_hr_intv_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
  THEN 1 ELSE 0
END) AS start_hr_intv_cnt
```

### D8. 发起 hr 资格面试未提交数 `recruit-start-hr-no-submit-count`

```sql
SUM(CASE
  WHEN is_hr_intv_no_submit = 1
   AND start_hr_intv_time >= ':begin_date'
   AND start_hr_intv_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
  THEN 1 ELSE 0
END) AS hr_intv_no_submit_cnt
```

### D9. 发起薪资谈判数 `recruit-start-hr-salary-negotiation-count`

```sql
SUM(CASE
  WHEN is_hr_salary_negotiation = 1
   AND hr_salary_negotiation_time >= ':begin_date'
   AND hr_salary_negotiation_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
  THEN 1 ELSE 0
END) AS hr_salary_negotiation_time_cnt
```

### D10. 发起薪资谈判未提交数 `recruit-start-hr-salary-negotiation-no-submit-count`

```sql
SUM(CASE
  WHEN is_hr_salary_negotiation_no_submit = 1
   AND hr_salary_negotiation_time >= ':begin_date'
   AND hr_salary_negotiation_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
  THEN 1 ELSE 0
END) AS hr_salary_negotiation_no_submit_cnt
```

### D11. 发起 offer 审批人数 `recruit-start-offer-approval-count`

```sql
SUM(CASE
  WHEN is_offer_approval = 1
   AND start_offer_approval_time >= ':begin_date'
   AND start_offer_approval_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
  THEN 1 ELSE 0
END) AS send_offer_approval_cnt
```

### D12. offer 审批中未审批人数 `recruit-offer-approval-no-submit-count`

```sql
SUM(CASE
  WHEN is_offer_approval_no_submit = 1
   AND start_offer_approval_time >= ':begin_date'
   AND start_offer_approval_time < DATE_ADD(':end_date', INTERVAL 1 DAY)
  THEN 1 ELSE 0
END) AS offer_approval_no_submit_cnt
```

---

## 📝 已知 TODO（实测后补全）

1. **A9 offer 中（社招分支）**：治理口径原文取值逻辑被截断，仅活水分支可见。使用前需找 BI 团队补全社招分支 SQL；当前模板 1B 只覆盖了活水分支。
2. **A1 严格版子查询的 GROUP BY 粒度**：模板 4 中的 `register_cnt` 子查询按 `post_id` 分组，但 治理口径原文公式是聚合数（不带分组）。如果需要"全集团一个汇总值"，把子查询改为不带 `GROUP BY post_id` 即可；但与 t2 JOIN 时需注意维度对齐。
3. **`staff_type_id = '2'` 含义**：等拿到表权限后，通过字典表 `dw-api-public-core-personnel-filters-dictionary-staffType` 验证 `2` 对应的中文名（推测是"正式社招候选人"口径）。
4. **C1 中的 `resume_assessing_cnt`（评估中）**：治理基线 未单列指标，模板 3B 按"流程未结束 + 处理时间为空"派生，使用前需与产研对齐口径。
5. **组织维度展开语法**：治理口径原文用 PostgreSQL/Trino 的 `unnest(split(...))`，本文档已转写为 StarRocks 的 `LATERAL VIEW EXPLODE(SPLIT(...))`；实测时按当前 StarRocks 版本调整。
6. **B7 字段别名**：原 治理基线 SELECT 别名为 `hr_salary_negotiation_cnt`，但被 C6 公式引用为 `hr_salary_negotiation_pass_cnt`。模板 2A/2B 中**已统一改名为 `hr_salary_negotiation_pass_cnt`**，与 C6 一致；若直接套用 治理口径原文 SQL，需手动改这个别名。
7. **A1/A2 的"是否本级组织"未启用**：编制宽表存在 `self_flag` 字段（默认"否"），但招聘岗位表 (`Report_Position_Management_Recruitment_P_I_Daily_Slice`) 没有同名字段。如有"本级 / 含下级"切换需求，需对接产研补字段。
5. **权限申请**：先用 `data-permission-checker` 走一遍流程，确认申请流程后再使用本批指标。
