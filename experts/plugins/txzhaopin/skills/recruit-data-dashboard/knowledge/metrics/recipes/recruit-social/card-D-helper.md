# D 卡片：辅助指标（v3.0 SQL 拼装）

> **本卡片对应指标**：D1-D12（漏斗各环节的发起数 + 未提交数）
> **指标层归类**：12 个原子（全部来自 T_FLOW）
> **用途**：作为 C 组比率指标的分母基数
>
> 🚀 **v3.0 SQL 范式**：聚合 `COUNT(DISTINCT flow_main_id)`、标志位 `is_xxx = '是'`、管理主体中文名 `manager_unit_name_cn`、国家动态参数 `location_country_name`。详见 [`card-B-funnel-counts.md`](./card-B-funnel-counts.md) 顶部说明。

| 卡片项 | 中文名 | 指标 ID |
| --- | --- | --- |
| D1 | 发起部门内专业面试数 | `recruit-start-dept-professional-intv-cnt` |
| D2 | 发起部门内专业面试未提交数 | `recruit-start-dept-professional-intv-no-submit-cnt` |
| D3 | 发起通道面委面试数 | `recruit-start-cf-intv-cnt` |
| D4 | 发起通道面委面试未提交数 | `recruit-start-cf-intv-no-submit-cnt` |
| D5 | 发起用人决策面试未提交数 | `recruit-start-dm-intv-no-submit-cnt` |
| D6 | 发起用人决策面试数 | `recruit-start-dm-intv-cnt` |
| D7 | 发起 HR 资格面试数 | `recruit-start-hr-intv-cnt` |
| D8 | 发起 HR 资格面试未提交数 | `recruit-start-hr-intv-no-submit-cnt` |
| D9 | 发起薪资谈判数 | `recruit-start-hr-salary-negotiation-cnt` |
| D10 | 发起薪资谈判未提交数 | `recruit-start-hr-salary-negotiation-no-submit-cnt` |
| D11 | 发起 offer 审批人数 | `recruit-start-offer-approval-cnt` |
| D12 | offer 审批中未审批人数 | `recruit-offer-approval-no-submit-cnt` |

详细定义见 [atomic/recruit-social/](../../atomic/recruit-social/) 各文件。

---

## ⭐️ B + D 合并查询（推荐，v3.0 标准）：21 项一次取出

由于 B1-B10 + D1-D12 全部来自 `T_FLOW` 单表，**最佳实践是合并到 1 条 SQL**：

```sql
SELECT
  -- ============ B 组 10 项 ============
  COUNT(DISTINCT CASE WHEN is_start_intv = '是'
                       AND start_intv_time >= :begin_date
                       AND start_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS start_intv_cnt,                                  -- B1
  COUNT(DISTINCT CASE WHEN is_dept_professional_intv = '是'
                       AND dept_professional_intv_time >= :begin_date
                       AND dept_professional_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS dept_professional_intv_cnt,                      -- B2
  COUNT(DISTINCT CASE WHEN is_cf_intv = '是'
                       AND cf_intv_time >= :begin_date
                       AND cf_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS cf_intv_cnt,                                     -- B3
  COUNT(DISTINCT CASE WHEN is_dm_intv = '是'
                       AND dm_intv_time >= :begin_date
                       AND dm_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS dm_intv_cnt,                                     -- B4
  COUNT(DISTINCT CASE WHEN is_hr_intv = '是'
                       AND hr_intv_time >= :begin_date
                       AND hr_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS hr_intv_cnt,                                     -- B5
  -- B6 🚫 v3.0 已废弃（保留兼容）
  -- 🔴 v3.8 软删除：旧 SQL 不在 治理基线中。请改用 D11 (recruit-start-offer-approval-cnt)
  COUNT(DISTINCT CASE WHEN 1=0 THEN flow_main_id END) AS offer_approval_cnt,                  -- B6 🚫 软禁用
  COUNT(DISTINCT CASE WHEN hr_salary_negotiation_time IS NOT NULL
                       AND hr_salary_negotiation_time >= :begin_date
                       AND hr_salary_negotiation_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS hr_salary_negotiation_pass_cnt,                  -- B7
  COUNT(DISTINCT CASE WHEN is_send_offer = '是'
                       AND send_offer_time >= :begin_date
                       AND send_offer_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS send_offer_cnt,                                  -- B8
  COUNT(DISTINCT CASE WHEN is_entry = '是'
                       AND hire_date >= :begin_date
                       AND hire_date < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS entry_cnt,                                       -- B9
  COUNT(DISTINCT CASE WHEN is_resume_assess = '是'
                       AND start_intv_time >= :begin_date
                       AND start_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS resume_assess_cnt,                               -- B10

  -- ============ D 组 12 项 ============
  COUNT(DISTINCT CASE WHEN is_start_dept_professional_intv = '是'
                       AND start_dept_professional_intv_time >= :begin_date
                       AND start_dept_professional_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS start_dept_professional_intv_cnt,                -- D1
  COUNT(DISTINCT CASE WHEN is_dept_professional_intv_no_submit = '是'
                       AND start_dept_professional_intv_time >= :begin_date
                       AND start_dept_professional_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS start_dept_professional_intv_no_submit_cnt,      -- D2
  COUNT(DISTINCT CASE WHEN is_start_cf_intv = '是'
                       AND start_cf_intv_time >= :begin_date
                       AND start_cf_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS start_cf_intv_cnt,                               -- D3
  COUNT(DISTINCT CASE WHEN is_cf_intv_no_submit = '是'
                       AND start_cf_intv_time >= :begin_date
                       AND start_cf_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS start_cf_intv_no_submit_cnt,                     -- D4
  COUNT(DISTINCT CASE WHEN is_dm_intv_no_submit = '是'
                       AND start_dm_intv_time >= :begin_date
                       AND start_dm_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS start_dm_intv_no_submit_cnt,                     -- D5
  COUNT(DISTINCT CASE WHEN is_start_dm_intv = '是'
                       AND start_dm_intv_time >= :begin_date
                       AND start_dm_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS start_dm_intv_cnt,                               -- D6
  COUNT(DISTINCT CASE WHEN is_start_hr_intv = '是'
                       AND start_hr_intv_time >= :begin_date
                       AND start_hr_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS start_hr_intv_cnt,                               -- D7
  COUNT(DISTINCT CASE WHEN is_hr_intv_no_submit = '是'
                       AND start_hr_intv_time >= :begin_date
                       AND start_hr_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS hr_intv_no_submit_cnt,                           -- D8
  COUNT(DISTINCT CASE WHEN is_hr_salary_negotiation = '是'
                       AND hr_salary_negotiation_time >= :begin_date
                       AND hr_salary_negotiation_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS hr_salary_negotiation_time_cnt,                  -- D9
  COUNT(DISTINCT CASE WHEN is_hr_salary_negotiation_no_submit = '是'
                       AND hr_salary_negotiation_time >= :begin_date
                       AND hr_salary_negotiation_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS hr_salary_negotiation_no_submit_cnt,             -- D10
  COUNT(DISTINCT CASE WHEN is_offer_approval = '是'
                       AND start_offer_approval_time >= :begin_date
                       AND start_offer_approval_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS send_offer_approval_cnt,                         -- D11
  COUNT(DISTINCT CASE WHEN is_offer_approval_no_submit = '是'
                       AND start_offer_approval_time >= :begin_date
                       AND start_offer_approval_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS offer_approval_no_submit_cnt                     -- D12

FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
WHERE staff_type_id = '2'                                                    -- 强制过滤
  AND flow_id = 3                                                            -- 强制过滤（T_FLOW 的社招）
  -- v3.0 运行时筛选参数（条件性 AND，详见 ../../dimensions/recruit-social/filter-parameters.md）
  /* :manager_unit_name_cn      */ AND manager_unit_name_cn      = :manager_unit_name_cn   -- 默认 '腾讯集团本部'
  /* if :location_country_name  */ AND location_country_name     LIKE :location_country_name  -- 默认 '%中国%'
  /* if :post_id                */ AND post_id                   = :post_id
  /* if :post_name_cn           */ AND post_name_cn              LIKE CONCAT('%', :post_name_cn, '%')
  /* if :recruit_owner          */ AND recruit_owner             = :recruit_owner
  /* if :mapping_position_name  */ AND mapping_position_name     = :mapping_position_name
  /* if :recruit_post_org_full_name */ AND recruit_post_org_full_name LIKE CONCAT('%', :recruit_post_org_full_name, '%')
LIMIT 1000;
```

> 取出 21 项后，C 组比率指标可以**在前端层做四则运算**，无需再发 SQL；详见 [`card-C-funnel-rates.md`](./card-C-funnel-rates.md)。

---

## 🎚️ 本卡片支持的运行时筛选参数

参数集与 B 卡完全一致（同源 `T_FLOW` 单表），详见 [`card-B-funnel-counts.md`](./card-B-funnel-counts.md) 末节「本卡片支持的运行时筛选参数」。

> 一致性铁律：**B+D 合并查询时，B/D 必须使用完全相同的筛选参数**（否则 C 组比率分子分母口径漂移）。
