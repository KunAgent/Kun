# C 卡片：漏斗通过率（v3.0 SQL 拼装）

> **本卡片对应指标**：C1-C9（漏斗通过率，v3.0 实际有效 8 个）
> **指标层归类**：复合指标，依赖 B/D 组原子指标
>
> 🚀 **v3.0 SQL 范式**：聚合 `COUNT(DISTINCT flow_main_id)`、标志位 `is_xxx = '是'`、管理主体中文名 `manager_unit_name_cn`、**T_ASSESS 表 SQL 不加 `flow_id` 过滤**（见 [README 勘误 B](../../README.md)）。详见 [`card-B-funnel-counts.md`](./card-B-funnel-counts.md) 顶部说明。

| 卡片项 | 中文名 | 指标 ID | v3.0 状态 |
| --- | --- | --- | --- |
| C1 | 渠道发起面试率 | `recruit-channel-start-interview-rate` | ✅ 分母改用 v3.0 新原子 |
| C2 | 部门内面试通过率 | `recruit-dept-professional-intv-rate` | ✅ |
| C3 | 通道面委面试通过率 | `recruit-cf-intv-rate` | ✅ |
| C4 | 用人决策面试通过率 | `recruit-dm-intv-rate` | ✅ |
| C5 | HR 资格面试通过率 | `recruit-hr-intv-rate` | ✅ |
| C6 | HR 薪资谈判通过率 | `recruit-hr-salary-negotiation-rate` | ✅ |
| C7 🚫 | ~~进入 offer 审批率~~ | `recruit-offer-approval-rate` | **v3.0 已废弃** |
| C8 | 发送 offer 率 | `recruit-send-offer-rate` | ✅ |
| C9 | 入职率 | `recruit-entry-rate` | ✅ |

详细定义见 [composite/recruit-social/funnel-rates.md](../../composite/recruit-social/funnel-rates.md)。

---

## 推荐实施模式：原子查询 → 前端做比率

由于 C 组指标都是**基于 B/D 组原子指标的四则运算**，最佳实践有两种：

### 方案 1：前端层做比率（最简）

执行 [`card-D-helper.md`](./card-D-helper.md) 的"B+D 合并查询"和 B11/B12 的 T_ASSESS 查询，拿到 21+2 项后在前端：

```js
// C2 部门内面试通过率
const c2 = (denom => denom <= 0 ? 0 : b2.dept_professional_intv_cnt / denom)
           (d1.start_dept_professional_intv_cnt - d2.start_dept_professional_intv_no_submit_cnt);

// C1 渠道发起面试率（v3.0 用新原子做分母扣除）
const c1 = (denom => denom <= 0 ? 0 : b10.resume_assess_cnt / denom)
           (b11.channel_resume_assess_cnt - b12.channel_resume_not_assessed_cnt);
```

### 方案 2：SQL CTE 包装（一次出全部数）

```sql
WITH base_metrics AS (
  -- B+D 合并查询（v3.0 标准），完整版见 card-D-helper.md
  SELECT
    COUNT(DISTINCT CASE WHEN is_dept_professional_intv = '是' AND ... THEN flow_main_id END) AS dept_professional_intv_cnt,
    -- ... 共 20 项（B6 已废弃，C7 不再使用） ...
    COUNT(DISTINCT CASE WHEN is_offer_approval_no_submit = '是' AND ... THEN flow_main_id END) AS offer_approval_no_submit_cnt
  FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
  WHERE staff_type_id = '2' AND flow_id = 3                                                    -- 强制过滤
    -- v3.0 运行时筛选参数（与下方 c1_assessment 必须完全一致！）
    /* :manager_unit_name_cn      */ AND manager_unit_name_cn      = :manager_unit_name_cn
    /* if :location_country_name  */ AND location_country_name     LIKE :location_country_name
    /* if :post_id                */ AND post_id                   = :post_id
    /* if :post_name_cn           */ AND post_name_cn              LIKE CONCAT('%', :post_name_cn, '%')
    /* if :recruit_owner          */ AND recruit_owner             = :recruit_owner
    /* if :recruit_post_org_full_name */ AND recruit_post_org_full_name LIKE CONCAT('%', :recruit_post_org_full_name, '%')
),
c1_assessment AS (
  -- C1 需要单独 CTE：分子 b10.resume_assess_cnt 在 base_metrics（T_FLOW）；
  -- 分母两项 channel_resume_assess_cnt / channel_resume_not_assessed_cnt 来自 T_ASSESS
  SELECT
    COUNT(DISTINCT CASE WHEN arrive_time >= :begin_date
                         AND arrive_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                    THEN flow_main_id END) AS channel_resume_assess_cnt,
    COUNT(DISTINCT CASE WHEN arrive_time >= :begin_date
                         AND arrive_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                         AND (process_time > DATE_ADD(:end_date, INTERVAL 1 DAY)
                              OR process_time IS NULL)
                    THEN flow_main_id END) AS channel_resume_not_assessed_cnt
  FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Resume_Assessment
  -- 🔴 v3.9（2026-06-12）：T_ASSESS 不加 staff_type_id、也不加 flow_id 过滤（见 README 勘误 B）
  WHERE manager_unit_name_cn      = :manager_unit_name_cn                                      -- 强制过滤（管理主体必带）
    -- ⚠️ 必须与上方 base_metrics 完全相同的筛选参数（一致性铁律）
    /* if :location_country_name  */ AND location_country_name     LIKE :location_country_name
    /* if :post_id                */ AND post_id                   = :post_id
    /* if :post_name_cn           */ AND post_name_cn              LIKE CONCAT('%', :post_name_cn, '%')
    /* if :recruit_owner          */ AND recruit_owner             = :recruit_owner
    /* if :recruit_post_org_full_name */ AND recruit_post_org_full_name LIKE CONCAT('%', :recruit_post_org_full_name, '%')
)
SELECT
  -- C1 渠道发起面试率（v3.0：分母 = 渠道收到评估数 − 渠道收到简历未评估数）
  COALESCE(
    CASE WHEN c1a.channel_resume_assess_cnt - c1a.channel_resume_not_assessed_cnt <> 0
      THEN CAST(b.resume_assess_cnt AS DECIMAL)
           / (c1a.channel_resume_assess_cnt - c1a.channel_resume_not_assessed_cnt)
      ELSE 0 END, 0
  ) AS channel_start_interview_rate,

  -- C2 部门内面试通过率
  COALESCE(
    CASE WHEN b.start_dept_professional_intv_cnt - b.start_dept_professional_intv_no_submit_cnt <> 0
      THEN CAST(b.dept_professional_intv_cnt AS DECIMAL)
           / (b.start_dept_professional_intv_cnt - b.start_dept_professional_intv_no_submit_cnt)
      ELSE 0 END, 0
  ) AS dept_professional_intv_rate,

  -- C3 通道面委面试通过率
  COALESCE(
    CASE WHEN b.start_cf_intv_cnt - b.start_cf_intv_no_submit_cnt <> 0
      THEN CAST(b.cf_intv_cnt AS DECIMAL) / (b.start_cf_intv_cnt - b.start_cf_intv_no_submit_cnt)
      ELSE 0 END, 0
  ) AS cf_intv_rate,

  -- C4 用人决策面试通过率
  COALESCE(
    CASE WHEN b.start_dm_intv_cnt - b.start_dm_intv_no_submit_cnt <> 0
      THEN CAST(b.dm_intv_cnt AS DECIMAL) / (b.start_dm_intv_cnt - b.start_dm_intv_no_submit_cnt)
      ELSE 0 END, 0
  ) AS dm_intv_rate,

  -- C5 HR 资格面试通过率
  COALESCE(
    CASE WHEN b.start_hr_intv_cnt - b.hr_intv_no_submit_cnt <> 0
      THEN CAST(b.hr_intv_cnt AS DECIMAL) / (b.start_hr_intv_cnt - b.hr_intv_no_submit_cnt)
      ELSE 0 END, 0
  ) AS hr_intv_rate,

  -- C6 HR 薪资谈判通过率
  COALESCE(
    CASE
      WHEN b.hr_intv_cnt - b.hr_salary_negotiation_no_submit_cnt = 0 THEN 0
      WHEN b.hr_intv_cnt - b.hr_salary_negotiation_no_submit_cnt <> 0
        THEN CAST(b.hr_salary_negotiation_pass_cnt AS DECIMAL)
             / (b.hr_intv_cnt - b.hr_salary_negotiation_no_submit_cnt)
      ELSE 0
    END, 0
  ) AS hr_salary_negotiation_rate,

  -- C7 🚫 v3.0 已废弃（保留兼容）：进入 offer 审批率
  --     建议改用 C8 发送 offer 率作为漏斗指标
  COALESCE(
    CASE WHEN b.hr_salary_negotiation_time_cnt - b.hr_salary_negotiation_no_submit_cnt <> 0
      THEN CAST(b.offer_approval_cnt AS DECIMAL)
           / (b.hr_salary_negotiation_time_cnt - b.hr_salary_negotiation_no_submit_cnt)
      ELSE 0 END, 0
  ) AS offer_approval_rate,

  -- C8 发送 offer 率
  COALESCE(
    CASE WHEN b.send_offer_approval_cnt - b.offer_approval_no_submit_cnt <> 0
      THEN CAST(b.send_offer_cnt AS DECIMAL)
           / (b.send_offer_approval_cnt - b.offer_approval_no_submit_cnt)
      ELSE 0 END, 0
  ) AS send_offer_rate,

  -- C9 入职率
  COALESCE(
    CASE WHEN b.send_offer_cnt <> 0
      THEN CAST(b.entry_cnt AS DECIMAL) / b.send_offer_cnt
      ELSE 0 END, 0
  ) AS entry_rate

FROM base_metrics b, c1_assessment c1a
LIMIT 1;
```

---

## ⚠️ 一致性约束（治理强制）

1. **同时间窗**：分子分母必须用同一个 `:begin_date` / `:end_date`
2. **同维度**：分子分母必须 GROUP BY 同样的字段集
3. **同强制过滤**：T_FLOW 侧 `staff_type_id='2' AND flow_id=3`；T_ASSESS 侧 **仅** `staff_type_id='2'`（**T_ASSESS 不加 flow_id 过滤**）
4. **同运行时筛选参数**：分子分母必须用完全一致的 `:manager_unit_name_cn` / `:post_id` / `:recruit_post_org_full_name` / `:recruit_owner` 等参数
5. **率为 NULL → 0**：用 `COALESCE` 兜底
6. **率 > 100% 或率为负** → 数据异常，先查数据再展示

---

## 🎚️ 本卡片支持的运行时筛选参数

C 卡是复合指标卡，本身不直接产生 SQL，参数集与 B+D 合并查询完全一致，详见：
- [`card-B-funnel-counts.md`](./card-B-funnel-counts.md) 末节「本卡片支持的运行时筛选参数」（B/D 共用）
- C1 涉及的 T_ASSESS 子查询（B11/B12），参数集与 B 卡相同，但**强制过滤不带 `flow_id`**（见 [README 勘误 B](../../README.md)）

> ⚠️ 实施 C 卡时，**必须把 T_FLOW（base_metrics）和 T_ASSESS（c1_assessment）两个 CTE 的运行时筛选参数完全同步**（除了强制过滤：T_FLOW 带 `flow_id=3`，T_ASSESS **不带 `flow_id`**），否则比率失真。
