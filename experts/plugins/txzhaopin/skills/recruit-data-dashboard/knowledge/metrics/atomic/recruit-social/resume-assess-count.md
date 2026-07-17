# 简历评估节点原子指标

> 业务过程：简历评估
> 涉及两张表：`T_FLOW`（已发起面试侧）+ `T_ASSESS`（简历评估宽表，渠道侧）
> **强制过滤**（按表区分，v3.9 纠偏 2026-06-12）：
> - `T_FLOW` 侧：`staff_type_id = '2' AND flow_id = 3`
> - **`T_ASSESS` 侧：无 `staff_type_id` / `flow_id` 强制过滤**（🔴 v3.9 2026-06-12：评估表去掉 `staff_type_id` 限制；T_ASSESS 仅靠时间窗 + `location_country_name` / `manager_unit_name_cn` 过滤，详见 [README 勘误 B](../../README.md)）
> **支持的运行时筛选参数**（详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md)）：
> `:begin_date` `:end_date` `:post_id` `:post_name_cn` `:recruit_owner_id` `:channel_id`（重要：渠道分析） `:org_full_name` `:work_location_id` `:mapping_position_id`
>
> 🔴 **v3.4 强制参数（2026-06-10 强化，必带，按 治理基线）**：
> - **`:location_country_name`**（默认 `'%中国%'`，可改 `'%亚太%'` 等；治理基线列在「固定查询条件」+「动态查询条件」双重声明，**必带**）
> - **`:manager_unit_name_cn`**（默认 `'腾讯集团本部'`，可改具体子公司主体；治理基线列在「动态查询条件」默认必带）
>
> ⚠️ **使用片段 SQL 时**：本卡的"核心表达式"是聚合表达式片段（`COUNT(DISTINCT CASE...)`），靠**外层 SELECT/WHERE** 提供强制过滤。**按表区分**：
>
> - **`T_FLOW` 卡（#1 有简历评估面试数）**：外层 WHERE 必须加：
> ```sql
> WHERE staff_type_id = '2' AND flow_id = 3
>   AND location_country_name LIKE :location_country_name      -- 默认 '%中国%'
>   AND manager_unit_name_cn = :manager_unit_name_cn            -- 默认 '腾讯集团本部'
> ```
> - **`T_ASSESS` 卡（#2 渠道收到评估数 / #3 渠道收到简历未评估数）**：外层 WHERE **不加** `staff_type_id`、**不加** `flow_id`，只加：
> ```sql
> WHERE location_country_name LIKE :location_country_name      -- 默认 '%中国%'
>   AND manager_unit_name_cn = :manager_unit_name_cn            -- 默认 '腾讯集团本部'
> ```
>
> 🔴 **v3.4 T_ASSESS 表特殊提醒**：T_ASSESS 表上**要加** `location_country_name LIKE :location_country_name` 过滤（治理基线 Row 38/39 渠道收到评估数等指标的「固定查询条件」明确要求）；🔴 **v3.9（2026-06-12）：T_ASSESS 表不再加 `staff_type_id` 过滤**。
>
> 🔴 **字段口径勘误（2026-06-08）**：本文件 SQL 中所有 `is_xxx = '是'` 写法已修订完毕（数仓真实取值是中文 `'是'/'否'`，治理基线的 `is_xxx = 1` 在 StarRocks 直查时恒返回 0）。详见 [README 勘误章节](../../README.md)。
>
> 🔄 **v3.0 口径变化（2026-06-08，对齐 治理基线 新版）**：聚合方式从 `COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)`（人次）→ **`COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)`**（按流程主键去重的人数）。多数场景两口径结果接近，严格按 v3.0 业务口径应使用 DISTINCT。下方 SQL 模板沿用 v2.x 写法供兼容；新查询建议改用 DISTINCT。
> 🔄 **v3.0 参数变化**：管理主体改用 `manager_unit_name_cn`（中文名）；国家从「固定过滤」→「动态参数」（默认 `'%中国%'`，可切全球）。详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md) v3.0 章节。

**v3.0：3 个原子指标**（v2.x 是 2 个，新增 #3）：

| ID | 中文名 | 数据源 | 状态 |
| --- | --- | --- | --- |
| `recruit-resume-assess-intv-cnt` | 有简历评估面试数 | `T_FLOW` | ✅ |
| `recruit-channel-resume-assess-cnt` | 渠道收到评估数（别名「渠道收到简历数」） | `T_ASSESS` | ✅ v3.0 加别名 |
| `recruit-channel-resume-not-assessed-cnt` | **渠道收到简历未评估数** | `T_ASSESS` | 🆕 **v3.0 新增** |

---

> ⚠️ **v3.1 决策（2026-06-09）**：国家筛选**不再是强制过滤**，改为动态参数 `:location_country_name`（默认 `'%中国%'`，可切 `'%亚太%'`、`'%全球%'` 等）。详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md) #6。

## 1. 有简历评估面试数 `recruit-resume-assess-intv-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-resume-assess-intv-cnt` |
| 类型 | atomic |
| 业务过程 | 简历评估 → 发起面试 |
| 数据源 | `T_FLOW` |
| 关键字段 | `is_resume_assess`、`start_intv_time` |
| 统计口径 | 人次 |
| 时间字段 | `start_intv_time` |
| 同义词 | 渠道发起面试数、resume assess interview count |

**业务定义**：来自渠道的、经过简历评估后**发起面试**的候选人人次。

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN is_resume_assess = '是'
         AND start_intv_time >= :begin_date
         AND start_intv_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：被 `recruit-channel-start-interview-rate`（渠道发起面试率）作为分子。

---

## 2. 渠道收到评估数 `recruit-channel-resume-assess-cnt`

> 🔄 **v3.2 重大口径变更（2026-06-10）**：从 `arrive_time` 改为 `flow_create_time` + `flow_end_time` 双条件。
> - **旧（v3.0/3.1）**：按 `arrive_time` 卡时间窗
> - **新（v3.2）**：按 `flow_create_time` 卡左端 + `flow_end_time` 双分支（已结束的看是否在窗内、未结束的全算）

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-channel-resume-assess-cnt` |
| 类型 | atomic |
| 业务过程 | 简历评估 |
| 数据源 | `T_ASSESS` = `Report_Recruit_Resume_Assessment` |
| 关键字段 | `flow_create_time`、`flow_end_time`（v3.2 改用此组合） |
| 统计口径 | 简历份数（按 `flow_main_id` 去重） |
| 同义词 | **渠道收到简历数**（v3.0 别名）、简历评估到达数、评估收到数、channel resume assess count |

**业务定义**：在统计周期内创建的、且（已结束在期内、或仍在跑）的渠道简历评估流程总数。

**核心表达式（v3.8 修订）**：
```sql
COUNT(DISTINCT CASE
  WHEN flow_create_time >= :begin_date
   AND (
        (flow_end_time IS NOT NULL AND flow_end_time < DATE_ADD(:end_date, INTERVAL 1 DAY))   -- 🔴 v3.8 修订：治理基线 "< end_date" (end_date 已 +1)
     OR (process_time IS NULL)                                                                 -- 🔴 v3.8 修订：治理基线 写"process_time 为空"，原 SQL 误写为 flow_end_time IS NULL
   )
  THEN flow_main_id
END)
```

**v3.0/3.1 历史表达式**（按 `arrive_time` 卡区间，已废弃）：
```sql
-- ⚠️ v3.0/3.1 写法，不再符合 治理基线 v3.2 新口径
COUNT(DISTINCT CASE
  WHEN arrive_time >= :begin_date
   AND arrive_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
  THEN flow_main_id
END)
```

**血缘下游**：
- 被 `recruit-channel-start-interview-rate` 作为分母基数（v3.0：分母 = `渠道收到评估数 − 渠道收到简历未评估数`）

**注意事项**：
- 数据源不同于其他面试指标，**JOIN 用 `flow_main_id` 字段** 与 `T_FLOW.resume_assess_flow_main_id` 关联
- ⚠️ **T_ASSESS 表 SQL 不加 `flow_id` 过滤、也不加 `staff_type_id` 过滤**（`flow_id` v3.0 纠偏 2026-06-09；`staff_type_id` 🔴 v3.9 纠偏 2026-06-12）：治理基线「固定查询条件」中的 `Report_Recruit_Flow_Detail.flow_id = 3` 是**业务上下文标注**（指向 T_FLOW），实际「取值逻辑」未要求在 T_ASSESS 上做 `flow_id` / `staff_type_id` 过滤。详见 [README 勘误 B](../../README.md)
- **v3.2 重要**：业务口径已不再单看 `arrive_time`，改为流程粒度（`flow_create_time` + `flow_end_time` 状态判断）。如果有旧的 BI 报表仍按 `arrive_time` 算，会有差异。

---

## 3. 渠道收到简历未评估数 `recruit-channel-resume-not-assessed-cnt` 🆕 **v3.0 新增**

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-channel-resume-not-assessed-cnt` |
| 类型 | atomic |
| 业务过程 | 简历评估 |
| 数据源 | `T_ASSESS` = `Report_Recruit_Resume_Assessment` |
| 关键字段 | `arrive_time`、`process_time` |
| 统计口径 | 简历份数（按 `flow_main_id` 去重） |
| 同义词 | 评估中、未评估的简历数 |

**业务定义**：截至 :end_date 时点，已到达但**尚未完成评估**的简历数（即"评估中"存量）。

**核心表达式（v3.8 修订）**：
```sql
COUNT(DISTINCT CASE
  WHEN arrive_time >= :begin_date
   AND arrive_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
   AND (process_time > DATE_ADD(:end_date, INTERVAL 1 DAY) OR process_time IS NULL)
   -- 🔴 v3.8 修订：严格按 v3.8 铁律映射：治理基线 "> end_date" (end_date 已 +1) → SQL "> DATE_ADD(:end_date, 1)"
   --    （v3.7 误改为 "> :end_date" 是错的，因为 v3.7 当时还没识别 "治理口径 end_date 已 +1 天" 这个语义）
  THEN flow_main_id
END)
```

> 🔴 **v3.8 重大修订（修正 v3.7 的错误）**：
> - **v3.0~v3.6**：`process_time > DATE_ADD(:end_date, 1)`（实际正确）
> - **v3.7**：误改为 `process_time > :end_date`（基于"治理口径 end_date 是用户日期"的错误假设）
> - **v3.8**：恢复为 `process_time > DATE_ADD(:end_date, 1)`，并明确这就是 治理基线 `> end_date`（end_date 已 +1）的等价写法
> - **此次修订意义**：v3.8 的 治理基线 ↔ SQL 映射铁律（详见 SKILL.md）正式确立后，本字段的方向恢复正确

> ⚠️ **跟 Row 9「评估中」的微妙区别**（注意别混了）：
> - Row 9 评估中（时点型）：`process_time >= end_date OR NULL`（`>=` 含等号）→ SQL `>= DATE_ADD(:end_date, 1) OR NULL`
> - Row 25 未评估数（区间型）：`process_time > end_date OR NULL`（`>` 不含等号）→ SQL `> DATE_ADD(:end_date, 1) OR NULL`
>
> 治理基线故意写不一样，**不要随意"统一"**。区间型语义是"end_date 之后才会处理"，时点型语义是"截至 end_date 仍未处理"。

**血缘下游**：
- 作为 `recruit-channel-start-interview-rate`（渠道发起面试率）的**分母扣除项**：
  - 公式：`渠道发起面试率 = 渠道发起面试数 ÷ (渠道收到评估数 − 渠道收到简历未评估数)`

**注意事项**：
- 与派生指标"评估中"（`recruit-flow-evaluating-count`）**不是同一个指标**：
  - "评估中"是时点型快照（截至 end_date 当时的存量），来自 T_ASSESS（社招）+ T_FLOW（活水）两表合并 → `process_time >= end_date`
  - "渠道收到简历未评估数"是区间型原子，仅来自 `T_ASSESS`，明确用作"渠道发起面试率"分母扣除 → `process_time > end_date`
  - 时间字段方向 `>=` vs `>` 是 治理基线明确区分的，**不要混淆**
