# B 卡片：环节通过/进度数量（v3.0 SQL 拼装）

> **本卡片对应指标**：B1-B11（漏斗各环节的通过/进度数量）
> **指标层归类**：10 个原子（B1-B10 来自 T_FLOW）+ 2 个原子（B11/B12 来自 T_ASSESS，含 v3.0 新增「渠道收到简历未评估数」）
>
> 🚀 **v3.0 SQL 范式（2026-06-08）**：
> 1. 聚合：`COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)`（按流程主键去重）
> 2. 标志位：`is_xxx = '是'`（中文枚举，非 `1/0`）
> 3. 管理主体：`manager_unit_name_cn = :manager_unit_name_cn`（默认 `'腾讯集团本部'`）
> 4. 国家：`location_country_name LIKE :location_country_name`（默认 `'%中国%'`，可切全球）
> 5. **T_ASSESS 表 SQL 不加 `flow_id` 过滤**（见 [README 勘误 B](../../README.md)）：治理基线「固定查询条件」中的 `flow_id = 3` 是业务上下文标注（指向 T_FLOW），实际「取值逻辑」只用 `arrive_time` + `process_time`

| 卡片项 | 中文名 | 指标 ID | 详细定义 |
| --- | --- | --- | --- |
| B1 | 发起面试数 | `recruit-start-intv-cnt` | [interview-count.md](../../atomic/recruit-social/interview-count.md) |
| B2 | 部门内专业面试通过数 | `recruit-dept-professional-intv-cnt` | 同上 |
| B3 | 通道面委面试通过数 | `recruit-cf-intv-cnt` | 同上 |
| B4 | 用人决策面试通过数 | `recruit-dm-intv-cnt` | 同上 |
| B5 | HR 资格面试通过数 | `recruit-hr-intv-cnt` | 同上 |
| B6 🚫 | ~~offer 审批中人数~~ | `recruit-offer-approval-cnt` | **v3.0 已废弃**，建议用 D11 替代 |
| B7 | 薪资谈判通过数 | `recruit-hr-salary-negotiation-pass-cnt` | [salary-negotiation-count.md](../../atomic/recruit-social/salary-negotiation-count.md) |
| B8 | 发送 offer 数 | `recruit-send-offer-cnt` | [offer-count.md](../../atomic/recruit-social/offer-count.md) |
| B9 | 入职数 | `recruit-entry-cnt` | [entry-count.md](../../atomic/recruit-social/entry-count.md) |
| B10 | 有简历评估面试数 | `recruit-resume-assess-intv-cnt` | [resume-assess-count.md](../../atomic/recruit-social/resume-assess-count.md) |
| B11 | 渠道收到评估数（别名「渠道收到简历数」） | `recruit-channel-resume-assess-cnt` | 同上（T_ASSESS） |
| B12 🆕 | **渠道收到简历未评估数**（v3.0 新增） | `recruit-channel-resume-not-assessed-cnt` | 同上 |

---

## B1-B10 拼装 SQL（单表 T_FLOW，v3.0 标准）

```sql
SELECT
  -- B1 发起面试数
  COUNT(DISTINCT CASE WHEN is_start_intv = '是'
                       AND start_intv_time >= :begin_date
                       AND start_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS start_intv_cnt,

  -- B2 部门内专业面试通过数
  COUNT(DISTINCT CASE WHEN is_dept_professional_intv = '是'
                       AND dept_professional_intv_time >= :begin_date
                       AND dept_professional_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS dept_professional_intv_cnt,

  -- B3 通道面委面试通过数
  COUNT(DISTINCT CASE WHEN is_cf_intv = '是'
                       AND cf_intv_time >= :begin_date
                       AND cf_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS cf_intv_cnt,

  -- B4 用人决策面试通过数
  COUNT(DISTINCT CASE WHEN is_dm_intv = '是'
                       AND dm_intv_time >= :begin_date
                       AND dm_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS dm_intv_cnt,

  -- B5 HR 资格面试通过数
  COUNT(DISTINCT CASE WHEN is_hr_intv = '是'
                       AND hr_intv_time >= :begin_date
                       AND hr_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS hr_intv_cnt,

  -- B6 🚫 v3.0 已废弃（保留兼容）：offer 审批中人数
  -- 🔴 v3.8 软删除：B6 的旧 SQL（含 COALESCE(offer_approval_time, ...) >= :end_date）不在 治理基线中，
  --    属于 v2.x 历史残留。建议改用 D11 (`recruit-start-offer-approval-cnt`) 或 D12 替代。
  --    此处用 1=0 让该列永远返回 0，保留位置占位（避免下游 SELECT 索引错位），但**不再进行真实计算**。
  COUNT(DISTINCT CASE WHEN 1=0 THEN flow_main_id END) AS offer_approval_cnt,  -- 🚫 已禁用，请改用 D11

  -- B7 薪资谈判通过数
  COUNT(DISTINCT CASE WHEN hr_salary_negotiation_time IS NOT NULL
                       AND hr_salary_negotiation_time >= :begin_date
                       AND hr_salary_negotiation_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS hr_salary_negotiation_pass_cnt,

  -- B8 发送 offer 数
  COUNT(DISTINCT CASE WHEN is_send_offer = '是'
                       AND send_offer_time >= :begin_date
                       AND send_offer_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS send_offer_cnt,

  -- B9 入职数
  COUNT(DISTINCT CASE WHEN is_entry = '是'
                       AND hire_date >= :begin_date
                       AND hire_date < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS entry_cnt,

  -- B10 有简历评估面试数
  COUNT(DISTINCT CASE WHEN is_resume_assess = '是'
                       AND start_intv_time >= :begin_date
                       AND start_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS resume_assess_cnt

FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
WHERE staff_type_id = '2'                                                    -- 强制过滤
  AND flow_id = 3                                                            -- 强制过滤（T_FLOW 的社招）
  -- v3.0 运行时筛选参数（条件性 AND，详见 ../../dimensions/recruit-social/filter-parameters.md）
  /* :manager_unit_name_cn      */ AND manager_unit_name_cn      = :manager_unit_name_cn   -- 默认 '腾讯集团本部'，建议必带
  /* if :location_country_name  */ AND location_country_name     LIKE :location_country_name  -- 默认 '%中国%'
  /* if :post_id                */ AND post_id                   = :post_id
  /* if :post_name_cn           */ AND post_name_cn              LIKE CONCAT('%', :post_name_cn, '%')
  /* if :recruit_owner          */ AND recruit_owner             = :recruit_owner
  /* if :mapping_position_name  */ AND mapping_position_name     = :mapping_position_name
  /* if :recruit_post_org_full_name */ AND recruit_post_org_full_name LIKE CONCAT('%', :recruit_post_org_full_name, '%')
LIMIT 1000;
```

> **参数解释**：`/* if :xxx */` 表示该 AND 块仅当用户传入了 `:xxx`（非空、非默认全选）时才被拼接到 SQL 中。`manager_unit_name_cn` 没有 `if`，因为它**默认就是 `'腾讯集团本部'`**——业务上"集团"≠"全部"。

---

## B11 + B12 SQL（来源表 T_ASSESS，⚠️ **不加 flow_id 过滤**）

> 🔴 **重要**：T_ASSESS 表的过滤**不要加 `flow_id` 条件**（2026-06-09 纠偏）：
> - 治理基线「取值逻辑」未要求 `flow_id` 过滤
> - 早期版本（v3.0 初稿）曾写"T_ASSESS 中社招 = flow_id = 2"，**这是错误猜测**，已纠正
> - 见 [README 勘误 B](../../README.md)

```sql
SELECT
  -- B11 渠道收到评估数（别名「渠道收到简历数」）
  COUNT(DISTINCT CASE WHEN arrive_time >= :begin_date
                       AND arrive_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                  THEN flow_main_id END) AS channel_resume_assess_cnt,

  -- B12 🆕 渠道收到简历未评估数（v3.0 新增）
  COUNT(DISTINCT CASE WHEN arrive_time >= :begin_date
                       AND arrive_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                       AND (process_time > DATE_ADD(:end_date, INTERVAL 1 DAY)
                            OR process_time IS NULL)
                  THEN flow_main_id END) AS channel_resume_not_assessed_cnt

FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Resume_Assessment
-- 🔴 v3.9（2026-06-12）：T_ASSESS 不加 staff_type_id、也不加 flow_id 过滤（见 README 勘误 B）
WHERE manager_unit_name_cn      = :manager_unit_name_cn                      -- 强制过滤（管理主体必带）
  -- v3.0 运行时筛选参数
  /* if :location_country_name  */ AND location_country_name     LIKE :location_country_name
  /* if :post_id                */ AND post_id                   = :post_id
  /* if :post_name_cn           */ AND post_name_cn              LIKE CONCAT('%', :post_name_cn, '%')
  /* if :recruit_owner          */ AND recruit_owner             = :recruit_owner
  /* if :recruit_post_org_full_name */ AND recruit_post_org_full_name LIKE CONCAT('%', :recruit_post_org_full_name, '%')
LIMIT 1000;
```

---

## ⭐️ B + D 合并查询（推荐）

由于 B1-B10 + D1-D12 全部来自 `T_FLOW` 单表，**最佳实践是合并到 1 条 SQL**。详见 [`card-D-helper.md`](./card-D-helper.md) 中的 v3.0 「B+D 合并查询」。

---

## 🎚️ 本卡片支持的运行时筛选参数（v3.0）

> 完整定义见 [`../../dimensions/recruit-social/filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md)。

| 参数 | 默认值 | 渲染位置 | 适用 SQL |
| --- | --- | --- | --- |
| `:begin_date` | 当年 1 月 1 日 | 各时间字段下边界 | B1-B12 全部 |
| `:end_date` | 昨天（T-1） | `< DATE_ADD(:end_date, INTERVAL 1 DAY)` | B1-B12 全部 |
| `:manager_unit_name_cn` | **`'腾讯集团本部'`**（建议必带） | `= :manager_unit_name_cn` | B1-B12 全部 |
| `:location_country_name` | `'%中国%'` | `LIKE :location_country_name` | B1-B12 全部（v3.0 起从固定→动态） |
| `:post_id` | — | `= :post_id` | B1-B12 全部 |
| `:post_name_cn` | — | `LIKE CONCAT('%',...,'%')` | B1-B12 全部 |
| `:recruit_owner` | — | `= :recruit_owner` | B1-B12 全部 |
| `:mapping_position_name` | — | `= :mapping_position_name` | B1-B10（T_FLOW） |
| `:recruit_post_org_full_name` | — | `LIKE CONCAT('%',...,'%')` | B1-B12 全部 |
| `:is_disabled_name` | `'全部'`（不带条件） | `= :is_disabled_name` | B1-B10 可选（按岗位状态过滤） |

**❌ 已剔除**：`org_id` / `manager_unit_id`（用 `manager_unit_name_cn` 替代） / `:next_date`（用 `DATE_ADD(:end_date, INTERVAL 1 DAY)` 表达式替代） / `:channel_id` / `:work_location_id`（v3.0 治理基线 未列）。

---

## 📜 v2.x 历史版本（兼容保留）

如需按旧口径（`SUM(CASE WHEN ... THEN 1 ELSE 0 END)` + `manager_unit_id` 数字 ID）查询，可参考 git 历史或自行替换：
- `COUNT(DISTINCT CASE ... THEN flow_main_id END)` → `SUM(CASE ... THEN 1 ELSE 0 END)`
- `manager_unit_name_cn = '腾讯集团本部'` → `manager_unit_id = '10101'`

> ⚠️ v2.x 与 v3.0 在多数实测场景结果接近（同一候选人多流程时差异可达数百），新业务请优先用 v3.0。
