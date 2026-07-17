# Offer 节点原子指标

> 业务过程：Offer 审批 → 发送 Offer
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
>
> 🔄 **v3.0 口径变化（2026-06-08，对齐 治理基线 新版）**：聚合方式从 `COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)`（人次）→ **`COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)`**（按流程主键去重的人数）。多数场景两口径结果接近，严格按 v3.0 业务口径应使用 DISTINCT。下方 SQL 模板沿用 v2.x 写法供兼容；新查询建议改用 DISTINCT。
> 🔄 **v3.0 参数变化**：管理主体改用 `manager_unit_name_cn`（中文名）；国家从「固定过滤」→「动态参数」（默认 `'%中国%'`，可切全球）。详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md) v3.0 章节。

4 个原子指标：

| ID | 中文名 | 标志位 | 时间字段 |
| --- | --- | --- | --- |
| `recruit-offer-approval-cnt` | offer 审批中人数 | `is_offer_approval = '是'` | `start_offer_approval_time` |
| `recruit-start-offer-approval-cnt` | 发起 offer 审批人数 | `is_offer_approval = '是'` | `start_offer_approval_time` |
| `recruit-offer-approval-no-submit-cnt` | offer 审批中未审批人数 | `is_offer_approval_no_submit = '是'` | `start_offer_approval_time` |
| `recruit-send-offer-cnt` | 发送 offer 数 | `is_send_offer = '是'` | `send_offer_time` |

---

> ⚠️ **v3.1 决策（2026-06-09）**：国家筛选**不再是强制过滤**，改为动态参数 `:location_country_name`（默认 `'%中国%'`，可切 `'%亚太%'`、`'%全球%'` 等）。详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md) #6。

## 1. offer 审批中人数 `recruit-offer-approval-cnt` ⚠️ **v3.0 已废弃**

> 🚫 **v3.0 移除（2026-06-08）**：本指标在新版 治理基线 中已被移除（"进入 offer 审批率" `recruit-offer-approval-rate` 也一并移除）。下方 SQL 仍保留供兼容历史看板/SQL 使用，但**不应在新业务中引用**。建议改用 `recruit-start-offer-approval-cnt`（发起 offer 审批人数）替代。

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-offer-approval-cnt` |
| 类型 | atomic（v3.0 废弃） |
| 业务过程 | Offer 审批 |
| 关键字段 | `is_offer_approval`、`start_offer_approval_time`、`offer_approval_time` |
| 同义词 | offer 审批中、offer approval count |

**业务定义**：在 :end_date 时点上，仍处于 offer 审批中状态（已发起审批、且审批时间 ≥ :end_date 或为空）的人次。

**核心表达式**（与"快照型"区分：本指标条件较复杂，包含审批未完成判断）：
```sql
COUNT(DISTINCT CASE WHEN is_offer_approval = '是'
         AND start_offer_approval_time >= :begin_date
         AND start_offer_approval_time <= DATE_ADD(:end_date, INTERVAL 1 DAY)
         AND COALESCE(offer_approval_time, '9999-12-31') >= :end_date
    THEN flow_main_id END)
```

**血缘下游**：
- `recruit-offer-approval-rate`（进入 offer 审批率）分子

**注意**：本指标本质偏"时点状态"，但 治理口径原文将其作为单表聚合，故归入 atomic。

---

## 2. 发起 offer 审批人数 `recruit-start-offer-approval-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-start-offer-approval-cnt` |
| 类型 | atomic |
| 关键字段 | `is_offer_approval`、`start_offer_approval_time` |

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN is_offer_approval = '是'
         AND start_offer_approval_time >= :begin_date
         AND start_offer_approval_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：作为 `recruit-send-offer-rate`（发送 offer 率）分母基数。

---

## 3. offer 审批中未审批人数 `recruit-offer-approval-no-submit-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-offer-approval-no-submit-cnt` |
| 类型 | atomic |
| 关键字段 | `is_offer_approval_no_submit`、`start_offer_approval_time` |

**业务定义**：发起了 offer 审批但**审批人尚未提交意见**的人次。

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN is_offer_approval_no_submit = '是'
         AND start_offer_approval_time >= :begin_date
         AND start_offer_approval_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：作为 `recruit-send-offer-rate` 的分母扣除项。

---

## 4. 发送 offer 数 `recruit-send-offer-cnt`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-send-offer-cnt` |
| 类型 | atomic |
| 业务过程 | 发送 Offer |
| 关键字段 | `is_send_offer`、`send_offer_time` |
| 同义词 | 发出 offer 数、发 offer 数、send offer count |

**业务定义**：HR 系统正式向候选人发出 offer 的人次。

**核心表达式**：
```sql
COUNT(DISTINCT CASE WHEN is_send_offer = '是'
         AND send_offer_time >= :begin_date
         AND send_offer_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN flow_main_id END)
```

**血缘下游**：
- `recruit-send-offer-rate` 分子
- `recruit-entry-rate`（入职率）分母
