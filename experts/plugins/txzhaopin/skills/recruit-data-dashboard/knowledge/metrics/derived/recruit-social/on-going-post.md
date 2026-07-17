# 在招需求数（派生指标，含子查询）

> 数据源：`T_POST` (`Report_Position_Management_Recruitment_P_I_Daily_Slice`) + `T_FLOW` (`Report_Recruit_Flow_Detail`) — **两个独立查询求和**，不是 JOIN
> 强制过滤（v3.3 严格按 治理基线）：
> - **T_POST 侧**：`is_disabled_name = '在招'` AND `recruit_staff_type_name = '正式'`
> - **T_FLOW 侧**：`flow_id = 3` AND `state_id NOT IN (5,6)` AND `staff_type_id = '2'` AND `location_country_name LIKE '%中国%'`
> **支持的运行时筛选参数**（详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md)）：
> `:end_date`（必带，时点边界） `:manager_unit_name_cn`（默认='腾讯集团本部'） `:org_full_name` `:post_id` `:post_name_cn` `:recruit_owner_id` `:mapping_position_name` `:location_country_name`
>
> 🔴 **v3.8 最终修订（2026-06-11）**：基于 v3.8 核心铁律「治理基线 `:end_date` 已 +1 天」，所有"字段 OP :end_date" 都改为"字段 OP DATE_ADD(:end_date, INTERVAL 1 DAY)"。详见 SKILL.md § v3.8 新增核心铁律。
>
> 🔴 **v3.3 重大修订（2026-06-10）**：
> - **架构改动**：从 `T_POST LEFT JOIN T_FLOW 子查询` 改为 **两个独立子查询求和**（治理基线明确写"在招需求数 = 当前在招 + 历史在招"，是加法关系，无 JOIN）
> - **岗位状态字段修正**：从 `is_disabled = '1'`（反向逻辑，CASE 内置 0）改为 **`is_disabled_name = '在招'`**（直接 WHERE 正向过滤，与 治理基线一致）
> - **send_offer_time 方向修正**：严格按 治理基线 `send_offer_time >= end_date`（v3.8 SQL 写法 `>= DATE_ADD(:end_date, 1)`）
> - **flow_end_time 边界**：v3.8 SQL 写法 `flow_end_time >= DATE_ADD(:end_date, 1) OR NULL`
> - **新增强制过滤**：`recruit_staff_type_name = '正式'`、`staff_type_id = '2'`、`location_country_name LIKE '%中国%'`（之前指标卡缺失，导致混入实习生/海外岗位）
> - **新增默认参数**：`manager_unit_name_cn = '腾讯集团本部'`（治理基线默认值，BG 看板常用口径）
>
> 🔄 **历史 v 系列**：v3.0 基础架构、v3.1 多决策落地、v3.2 时点边界翻转、v3.8 治理口径 end_date 映射铁律。详见各版本 CHANGELOG。

## 在招需求数 `recruit-on-going-post-count`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-on-going-post-count` |
| 类型 | derived（两表独立求和） |
| 业务过程 | 需求与岗位 |
| 数据源 | `T_POST` + `T_FLOW`（独立查询、求和） |
| 统计口径 | 人数（HC 数 + 历史在招的 offer 未结束人数） |
| 时点语义 | **截至 :end_date 的瞬时存量** |
| 同义词 | 在招岗位数、在招需求、ongoing posts、在招职位数、当前在招需求数 |
| 业务负责人 | 招活产研 |
| 接入时间 | 2026-06-07（v3.3 修订 2026-06-10） |
| 来源 治理基线 | 卡片 A1-在招需求数（v3.2 原档） |

**业务定义**（严格摘自 治理基线）：

```
在招需求数 = 当前在招岗位的需求数 + 历史在招岗位的需求数
```

| 分量 | 含义 | 数据源 | 关键卡时方法 |
| --- | --- | --- | --- |
| **当前在招** | 当前所有「在招」岗位上还需要招的人头 | T_POST（`Report_Position_Management_Recruitment_P_I_Daily_Slice`） | 用 `last_update_time <= :end_date` 卡岗位最近一次更新时间（取截至 end_date 的最新切片） |
| **历史在招** | 已发出 offer 且流程未结束、未放弃的候选人 | T_FLOW（`Report_Recruit_Flow_Detail`） | 用 `send_offer_time >= :end_date` AND `flow_end_time >= :end_date OR NULL` 卡 |

**❗️ 关于 `send_offer_time >= :end_date` 反直觉的解释**：

- 当 `:end_date = 今天`（默认值）时，"今天或之后才发的 offer"几乎为 0 → **历史在招分量 = 0** 是正常的
- 历史在招分量**只在查询过去某时点**（如"截至 2025-12-31 的在招需求数"）时才有意义
  - 此时 T_POST 是 2025-12-31 的快照，T_FLOW 用 `send_offer_time >= '2025-12-31'` 把"截至 2025-12-31 时已发 offer 但流程到 2026 才结束"的人补回来
- 这不是 治理基线 笔误，是有意为之的反向时点设计 ⚠️

**血缘下游**：
- `recruit-total-post-count`（总需求数）的加数 1

---

## 完整 SQL（v3.3，严格按 治理基线）

```sql
SELECT
  -- 1. 当前在招分量（T_POST）
  COALESCE((
    SELECT SUM(person_count)
    FROM catalog_dos_da_mcp.hrdw.Report_Position_Management_Recruitment_P_I_Daily_Slice
    WHERE is_disabled_name = '在招'                                       -- 强制：岗位状态在招
      AND last_update_time <= DATE_ADD(:end_date, INTERVAL 1 DAY)                                   -- 时点：截至 end_date
      AND recruit_staff_type_name = '正式'                                -- 强制：正式岗位
      AND manager_unit_name_cn = :manager_unit_name_cn                    -- 默认 = '腾讯集团本部'
      AND recruit_post_belong_org_full_name LIKE :org_full_name           -- 默认 = '%' 全部
      -- ⚠️ T_POST 表无 location_country_name 字段，国家过滤只在 T_FLOW 侧生效
  ), 0)
  +
  -- 2. 历史在招分量（T_FLOW）
  COALESCE((
    SELECT COUNT(DISTINCT flow_main_id)
    FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
    WHERE send_offer_time >= DATE_ADD(:end_date, INTERVAL 1 DAY)                                    -- 严格按 治理基线
      AND (flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR flow_end_time IS NULL)
      AND flow_id = 3                                                     -- 仅社招（活水另算）
      AND state_id NOT IN (5, 6)                                          -- 排除"已发 offer 已放弃"
      AND staff_type_id = '2'                                             -- 强制：正式员工
      AND location_country_name LIKE :location_country_name               -- 默认 = '%中国%'
      AND manager_unit_name_cn = :manager_unit_name_cn                    -- 默认 = '腾讯集团本部'
      AND recruit_post_org_full_name LIKE :org_full_name                  -- 默认 = '%' 全部
  ), 0)
  AS recruit_on_going_demand;
```

### 参数渲染示例

**示例 1：查 TEG 当前在招（用户问"TEG 的在招需求数"）**
```sql
:end_date = '2026-06-10'                            -- 昨天+1天 = 今天
:manager_unit_name_cn = '腾讯集团本部'              -- 默认
:org_full_name = '%TEG技术工程事业群%'              -- ⚠️ 用英文前缀+中文全路径，不是 '%TEG%' 也不是 '%技术工程事业群%'
:location_country_name = '%中国%'                   -- 默认
```
→ 期望结果：当前在招 336 + 历史在招 0 = **336**

**示例 2：查含子公司的完整 TEG 在招**
- 把 `manager_unit_name_cn = :manager_unit_name_cn` 这行**整条删掉**（不加管理主体过滤）
- 结果会包含「云智研发中心」等子公司主体下挂在 TEG 路径的岗位 → **342**

**示例 3：查截至 2025-12-31 的历史时点**
```sql
:end_date = '2025-12-31'
```
→ 此时历史在招分量会有真实数值（"截至 2025-12-31 已发 offer 但流程到 2026 才结束"的人）

---

## ⚠️ 字段使用注意事项（实测 + 治理沉淀）

### 1. T_POST 与 T_FLOW 是**独立求和**，不是 JOIN！（v3.3 关键纠错）

🔴 **v3.0~v3.2 错误写法**：用 `T_POST LEFT JOIN (T_FLOW 子查询) ON post_id` 关联

→ 这破坏了 治理基线的"加法"语义。LEFT JOIN 后 T_POST 的 person_count 会按"是否有匹配 offer 流程"拆开，导致基数错位。

✅ **v3.3 正确写法**：两个独立标量子查询，结果相加。

### 2. 岗位状态字段是 `is_disabled_name`（中文值），不是 `is_disabled`

| 字段 | 类型 | 取值 |
| --- | --- | --- |
| `is_disabled` | 字符串 | `'0'` / `'1'`（不可读，且行权限敏感）|
| `is_disabled_name` | 字符串 | **`'在招'` / `'停招'`**（业务直读，治理基线使用）|

→ **永远用 `is_disabled_name`**。`is_disabled` 字段在 WHERE 中有行权限拦截风险（实测：`WHERE is_disabled='0'` 返回 0 行）。

### 3. 时点语义：`:end_date` 默认 = "昨天 + 1 天" = 今天

- 如果业务方说"截至昨天（2026-06-09）"
- 则 `:end_date = '2026-06-10'`（昨天 + 1 天）
- 这样 `last_update_time <= '2026-06-10'` 包含 2026-06-09 的更新

### 4. 组织过滤：用中文全路径，不是英文缩写！

| BG 简称 | ❌ 错误（仅命中部分） | ✅ 正确（英文前缀+中文全路径） |
| --- | --- | --- |
| TEG | `LIKE '%TEG%'` | `LIKE '%TEG技术工程事业群%'` |
| CSIG | `LIKE '%CSIG%'` | `LIKE '%CSIG云与智慧产业事业群%'` |
| IEG | `LIKE '%IEG%'` | `LIKE '%IEG互动娱乐事业群%'` |
| PCG | `LIKE '%PCG%'` | `LIKE '%PCG平台与内容事业群%'` |
| WXG | `LIKE '%WXG%'` | `LIKE '%WXG微信事业群%'` |
| CDG | `LIKE '%CDG%'` | `LIKE '%CDG企业发展事业群%'` |
| S1 | `LIKE '%S1%'` | `LIKE '%S1职能系统－职能%'` |
| S2 | `LIKE '%S2%'` | `LIKE '%S2职能系统－财经%'` |
| S3 | `LIKE '%S3%'` | `LIKE '%S3职能系统－HR与管理%'` |

→ 详见 [`disambiguation.md`](../../../references/disambiguation.md) 的 BG 速查表。

### 5. `state_id NOT IN (5, 6)` 的语义

5 / 6 是社招"已发 offer 已放弃"类状态码（已通过 starrocks_query 验证）。该过滤排除了"已发 offer 但已放弃"的记录，保留"在流程中"的注册数。

### 6. 默认管理主体 = '腾讯集团本部'

按 治理基线默认值，不主动加这条过滤会包含子公司主体下的岗位（如「云智研发中心」），数值会偏大。BG 看板的常规做法是只看集团本部，所以默认带这条过滤；用户明确说"含子公司"或"全部主体"时再去掉。

---

## 血缘下游

- `recruit-total-post-count`（总需求数）的加数 1
