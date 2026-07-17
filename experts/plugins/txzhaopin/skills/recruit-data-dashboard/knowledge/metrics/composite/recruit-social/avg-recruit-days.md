# 社招平均招聘天数（复合指标）

> 强制过滤：见下方各 CTE WHERE 子句（社招 `flow_id=3 AND is_entry='是'`；活水 `flow_id=5`）
> **支持的运行时筛选参数**（详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md)）：
> `:begin_date` `:end_date` `:post_id` `:post_name_cn` `:recruit_owner_id` `:org_full_name` `:work_location_id` `:mapping_position_id`

> 🔴 **v4.0 修正（2026-06-13，回退 v3.9 的错误"岗位等权"层）**：
> 1. **去掉"先按岗位聚合再 AVG"这一层限制**：v3.9 误引入 `position_avg`（`GROUP BY post_id` → 再 `AVG(post_avg_days)`），与标准 SQL 文档口径不符。整体口径恢复为**流程加权**：对合并后的所有流程直接 `AVG(recruit_days)`
> 2. **"按岗位聚合"只保留为可选的明细展示用法**（见 § 替代用法），不再作为整体指标的计算口径
> 3. **架构保持 CTE 分流**：社招 CTE（`flow_id=3 + is_entry='是'`）+ 活水 CTE（`flow_id=5`），UNION ALL 后直接 AVG
> 4. **保留** `publish_time` 用 `CAST(p.publish_time AS DATE)`、`WHERE recruit_days >= 0` 过滤负数、`< DATE_ADD(:end_date, INTERVAL 1 DAY)` 开区间等规范

> 🔄 **历史 v 系列**：
> - v3.0 聚合方式从 SUM(CASE) 改为 COUNT(DISTINCT)
> - v3.1 国家从固定过滤改为动态参数
> - v3.8 时间边界对齐 治理口径 end_date 已+1 天铁律
> - v3.9 聚合粒度从"流程加权"改为"岗位等权"（❌ 错误，已被 v4.0 回退）
> - v4.0 回退"岗位等权"，恢复"流程加权"直接 AVG（本次）

## 社招平均招聘天数 `recruit-avg-recruit-days`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-avg-recruit-days` |
| 类型 | composite（平均，按流程加权直接 AVG）|
| 业务过程 | 需求与岗位（端到端时长） |
| 数据源 | `T_FLOW` JOIN `T_POST`（社招+活水 CTE 分流） |
| 统计口径 | 天数（合并所有流程后整体 AVG） |
| 同义词 | 平均招聘周期、avg recruit days |
| 关联字段 | `f.post_id = p.recruit_post_id`（⚠️ 不是 `p.post_id`） |

**业务定义**：在统计周期内，合并所有社招入职（`flow_id=3 + is_entry='是'`）和活水调动（`flow_id=5`）流程，计算每个流程的"入职/调动日期 − 岗位发布日期"作为单流程招聘天数，**对所有流程直接求平均**（流程加权）。

**公式**：
```
单流程招聘天数_i = (入职日期_i 或 调动日期_i) − 岗位发布日期
社招平均招聘天数 = AVG(单流程招聘天数_i for 所有流程 i)
```

**口径说明（流程加权）**：
- 整体指标对合并后的所有流程直接 AVG，每个入职/调动流程等权
- 治理口径标准 SQL 文档的整体口径即此口径；其"按岗位聚合"只是明细展示用法（见下方 § 替代用法），不作为整体指标计算方式

**depends_on**：
- 候选人侧：`hire_date`（社招）/ `huoshui_transfer_date`（活水），来自 `T_FLOW`
- 岗位侧：`publish_time`（DATE 字符串如 `"2007-09-10"`），来自 `T_POST`
- JOIN 条件：`f.post_id = p.recruit_post_id`

### 完整 SQL（v4.0 流程加权，子查询模式遵循 README 勘误 A 铁律）

> ⚠️ **关于 JOIN 模式**：治理口径标准 SQL 用了直 `INNER JOIN catalog_..._T_POST` 写法，但 README 勘误 A 实测 2026-06-08 显示**直 JOIN 模式会触发 `Column 'dos_current_user' is ambiguous` 报错**。因此此处采用「先用子查询各自过滤再 JOIN」模式，业务语义完全等价。

```sql
WITH
-- ① 社招流程 CTE：先子查询过滤 T_FLOW + T_POST 再 JOIN
shezhao_flow AS (
  SELECT
    f.flow_main_id,
    f.post_id,
    DATEDIFF(f.hire_date, CAST(p.publish_time AS DATE)) AS recruit_days
  FROM (
    SELECT flow_main_id, post_id, hire_date, post_name_cn
    FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
    WHERE flow_id = 3                                            -- 社招流程
      AND is_entry = '是'                                         -- 已入职
      AND hire_date >= :begin_date
      AND hire_date <  DATE_ADD(:end_date, INTERVAL 1 DAY)        -- v3.8 铁律：治理口径 end_date 已 +1 天
      AND staff_type_id = '2'
      AND location_country_name LIKE :location_country_name       -- 默认 '%中国%'
      AND manager_unit_name_cn   = :manager_unit_name_cn          -- 默认 '腾讯集团本部'
      /* if :post_id      */ AND post_id      = :post_id
      /* if :post_name_cn */ AND post_name_cn LIKE CONCAT('%', :post_name_cn, '%')
  ) f
  INNER JOIN (
    SELECT recruit_post_id, publish_time, recruit_post_org_full_name
    FROM catalog_dos_da_mcp.hrdw.Report_Position_Management_Recruitment_P_I_Daily_Slice
    WHERE recruit_staff_type_name = '正式'                        -- v3.6 铁律：岗位员工类型=正式
      /* if :recruit_post_org_full_name */ AND recruit_post_org_full_name LIKE CONCAT('%', :recruit_post_org_full_name, '%')
  ) p
    ON f.post_id = p.recruit_post_id                              -- ⚠️ T_POST 关联字段是 recruit_post_id 不是 post_id
),

-- ② 活水流程 CTE：同样子查询模式
huoshui_flow AS (
  SELECT
    f.flow_main_id,
    f.post_id,
    DATEDIFF(f.huoshui_transfer_date, CAST(p.publish_time AS DATE)) AS recruit_days
  FROM (
    SELECT flow_main_id, post_id, huoshui_transfer_date, post_name_cn
    FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail
    WHERE flow_id = 5                                            -- 活水流程
      AND huoshui_transfer_date >= :begin_date
      AND huoshui_transfer_date <  DATE_ADD(:end_date, INTERVAL 1 DAY)
      AND staff_type_id = '2'
      AND location_country_name LIKE :location_country_name
      AND manager_unit_name_cn   = :manager_unit_name_cn
      /* if :post_id      */ AND post_id      = :post_id
      /* if :post_name_cn */ AND post_name_cn LIKE CONCAT('%', :post_name_cn, '%')
  ) f
  INNER JOIN (
    SELECT recruit_post_id, publish_time, recruit_post_org_full_name
    FROM catalog_dos_da_mcp.hrdw.Report_Position_Management_Recruitment_P_I_Daily_Slice
    WHERE recruit_staff_type_name = '正式'
      /* if :recruit_post_org_full_name */ AND recruit_post_org_full_name LIKE CONCAT('%', :recruit_post_org_full_name, '%')
  ) p
    ON f.post_id = p.recruit_post_id
),

-- ③ 合并社招+活水
combined_flow AS (
  SELECT * FROM shezhao_flow
  UNION ALL
  SELECT * FROM huoshui_flow
)

-- ④ 最终聚合：对所有流程直接 AVG（流程加权，已去掉"按岗位聚合"层）
SELECT
  ROUND(AVG(recruit_days), 1)   AS avg_recruit_days,    -- 社招平均招聘天数（流程加权）
  COUNT(DISTINCT flow_main_id)  AS total_flow_count,    -- 统计了多少个入职/调动流程
  COUNT(DISTINCT post_id)       AS post_count           -- 涉及多少个岗位
FROM combined_flow
WHERE recruit_days >= 0;                                -- 过滤异常负数（hire_date 早于 publish_date 脏数据）
```

### 替代用法：按岗位明细输出（用于 B 类多指标对比）

> ⚠️ **片段示例**：下面的 SQL 是接在上方 § 完整 SQL 的 `WITH ... combined_flow AS (...)` 之后使用的片段，不是独立完整 SQL。回归脚本应跳过此块（DEPRECATED 关键词触发）。
> 注意：此处的"按岗位聚合"**仅用于明细展示/排名**，不是整体指标的计算口径（整体口径为流程加权，见 § 完整 SQL）。

需要看每个岗位具体的招聘天数排名时，把 `combined_flow` 按岗位聚合后再 LEFT JOIN 取岗位名（也用子查询模式）：

```sql
-- 反例式片段：此 SQL 不可独立运行，必须接 § 完整 SQL 的 WITH ... combined_flow AS (...) 之后
SELECT
  c.post_id,
  p.recruit_post_name,
  COUNT(DISTINCT c.flow_main_id)   AS flow_count,
  ROUND(AVG(c.recruit_days), 1)    AS post_avg_recruit_days
FROM combined_flow c
LEFT JOIN (
  SELECT recruit_post_id, recruit_post_name
  FROM catalog_dos_da_mcp.hrdw.Report_Position_Management_Recruitment_P_I_Daily_Slice
  WHERE recruit_staff_type_name = '正式'
) p
  ON c.post_id = p.recruit_post_id
WHERE c.recruit_days >= 0
GROUP BY c.post_id, p.recruit_post_name
ORDER BY post_avg_recruit_days DESC;
```

### 替代用法：仅社招 / 仅活水

如果用户明确说"只看社招"或"只看活水"，删除对应 CTE 即可（参见治理口径标准 SQL 的活水/社招拆分约定）。

### 注意事项

- ⚠️ **关联字段是 `f.post_id = p.recruit_post_id`**（不是 `p.post_id`），这是 T_POST 表的特殊命名
- ⚠️ **`publish_time` 是 DATE 字符串**（如 `"2007-09-10"`），用 `CAST(p.publish_time AS DATE)`；MCP 工具返回时可能显示为 Unix 毫秒数字（如 `1189353600000`）是渲染问题，真实值仍是日期字符串
- ⚠️ **必须加 `WHERE recruit_days >= 0`**：`hire_date` 早于 `publish_date` 是脏数据，会污染平均值
- ⚠️ **聚合粒度**：本指标整体口径是"按流程加权"（合并所有流程直接 AVG），**不是**"按岗位等权"。若用户明确要"按岗位等权"（先按岗位聚合再 AVG），需单独确认后改用明细聚合逻辑
- ⚠️ AVG 会自动忽略 NULL 值
- 业务上"招聘周期长"是负面信号，建议同时关注**中位数**和**P90**作为补充
- 口径沿革：**v3.8 及之前为"流程加权"，v3.9 误改为"岗位等权"，v4.0 已回退为"流程加权"**
