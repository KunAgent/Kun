# 核心宽表速查（默认参数 + SQL 背景）

> 抓取自 `starrocks://tables` 元数据；字段详情见 `tables/raw/*.json`

---

## 1. 员工信息宽表（最新T-1）— `catalog_dos_data_analysis_mcp_2.hrdw.Report_Wide_Public_Staff_Info`

**定位**：T-1 切片，每员工 1 行，最常用的查现状表。

**默认参数 (default_parameters)**：

| 参数 | 中文 | 默认值 |
| --- | --- | --- |
| `manage_unit_name` | 管理主体 | 腾讯集团本部 |
| `staff_type_name` | 员工类型 | 正式 |
| `hr_status_name` | 员工状态 | 在职 |

**必选字段 (find_column_background)**：员工ID、管理主体、员工状态、员工类型、员工组织全路径、员工组织名称

**SQL 背景 (write_sql_background)**：

1. 绩效梯队周期：H1=6/30、H2=12/31，本表追溯近 4 个周期；员工评估周期内在职 ≥ 3 个月可参评。
2. "近 X 次评估"为避免歧义，**返回近 1 次到近 X 次都返回**。
3. 连续多周期高/低绩效，需 `AND` 多次绩效等级条件。
4. 秘书人群：`pro_position_genus_name = '秘书类－SE'`。

---

## 2. 员工信息宽表（历史月末快照）— `catalog_dos_da_mcp.hrdw.Report_Wide_Public_Staff_Info`

**定位**：每月月末日期一份快照，做时间序列纵向对比时用。

**默认参数**：同上 T-1 表。

**SQL 背景**：

1. **本表按快照日期 `p_mm` 分区，任何查询必须带 `p_mm`**。查指定月份历史快照：选该月月末日期（如查 2026-03 数据 → `p_mm = '20260331'`）。**未指定具体日期**（"近 3 个月"等）必须用动态函数计算 `p_mm`。
2. 绩效梯队同上，可追溯近 4 个周期。

---

## 3. 人员变动信息宽表 — `catalog_dos_da_mcp.hrdw.Report_Wide_Public_Staff_Change_Record`

**定位**：员工全职涯雇佣 / 调动 / 专业升降 / 管理升降免 / 离职等异动流水。
**唯一标识**：`业务流程单号 + 异动场景类型`

**默认参数**：

| 参数 | 中文 | 默认值 |
| --- | --- | --- |
| `to_manage_unit_name` | 管理主体 | 腾讯集团本部 |
| `to_staff_type_name` | 员工类型 | 正式 |

**必选字段**：员工ID

**SQL 背景**：

1. 原始记录是**人次数**，统计人数需 `COUNT(DISTINCT staff_id)`。
2. 异动类型映射：
   - 入职：`move_type_name = '雇佣'`
   - 离职：`move_type_name = '离职'`
   - 调动：`move_type_name = '调动'`
   - 专业变化：`move_type_name = '专业变化'`
   - 管理变化：`move_type_name = '管理变化'`
   - 配合 `move_date BETWEEN '...' AND '...'` 过滤异动生效日期。
   - 时间未指明，默认"今年"。
3. **组织前后字段**：
   - A 组织入职/离职/专业变化/管理变化：`to_org_full_name LIKE '%A%'`
   - 从 A 调入 B：`from_org_full_name LIKE '%A%' AND to_org_full_name LIKE '%B%'`
   - 调动整体：`from_org_full_name = 'A' OR to_org_full_name = 'A'`
4. **入离职交叉**：
   - 一定时期入职的人是否在某段时间离职：`异动场景类型=入职` 圈人 → `最近一次离职生效日期`
   - 一定时期离职的人是否在某段时间入职：`异动场景类型=离职` 圈人 → `最近一次入职生效日期`
5. 平均职级停留：分别对应 `异动子场景类型 = 专业晋升 / 管理晋升`。
6. **不支持**：在职人数统计、流程发起/进行中人次、晋升失败人次、活水流程数据、招聘流程数据、入职记录中的绩效/盘点/职级停留分析、L0 管理者入职/离职。

---

## 4. 调动信息宽表 — `catalog_dos_da_mcp.hrdw.Report_Wide_Public_Staff_Transfer_Info`

**定位**：所有"调动"异动（境内+跨境），含流程中。
**唯一标识**：`异动ID move_id`（同日多条由 `move_date_seq` 区分）

**默认参数**：

| 参数 | 默认值 |
| --- | --- |
| `manage_unit_name` | 腾讯集团本部 |
| `staff_type_name` | 正式 |
| `hr_status_name` | 在职 |
| `state_name` | 流程完成 |

**SQL 背景**：

1. 调动**人数**用 `COUNT(DISTINCT staff_id)`，**次数**用 `COUNT(move_id)`。
2. 时间过滤：`move_date`（YYYY-MM-DD）。
3. 同员工同日多条按 `move_date_seq` 排序（数值越小越早）。
4. 绩效快照含近 4 次结果，对应 H1 / H2。

**常用过滤字段**：员工状态、员工类型、管理主体、流程状态、异动场景类型、是否活水、是否跨BG调动、是否跨部门调动

**常用维度**：调动核心、调动前/后信息（组织/职级/工作地/BG/部门）、调动特征、异动时快照、绩效快照

---

## 5. 派驻记录表 — `catalog_dos_da_mcp.hrdw.Report_StaffStation`

**定位**：境内派驻流水，含派驻中、派驻结束。
**唯一标识**：`派驻异动ID move_id`

**默认参数**：

| 参数 | 默认值 |
| --- | --- |
| `manage_unit_name` | 腾讯集团本部 |
| `staff_type_name` | 正式 |
| `hr_status_name` | 在职 |
| `record_status` | 1 |

**SQL 背景**：

1. 派驻**人数** `COUNT(DISTINCT staff_id)`，**次数** `COUNT(move_id)`。
2. 组织过滤：`org_full_name`（当前所在组织）；派出组织 `station_from_org_full_name`，派入组织 `station_to_org_full_name`。

---

## 6. 编制宽表 — `catalog_dos_da_mcp.hrdw.Report_HC_Management`

**定位**：日切片，HC 定额 / 剩余 HC / 待流入待流出。

**SQL 背景**：

1. **必选字段 `p_dt`（切片日期）**，默认取当前日期 `-1`。
2. 查某组织总 HC / 剩余 HC / HC 定额时，**默认条件**：
   - `self_flag = '否'`（是否本级组织）
   - `manage_unit_name = '全部'`
   - `region_type_name = '全部'`
   - `staff_subtype_name = '正式聘用制'`
3. 组织作为动态参数传入 `org_full_name LIKE '%{org}%'`。

**关键字段**：

| 字段 | 含义 |
| --- | --- |
| `hc_quotas_num` | HC 定额 |
| `hc_loan_num` | 校招 HC 借贷 |
| `hc_sum_num` | 总 HC（已预计算 = 定额 + 借贷） |
| `on_job_num_hc` | 在职人数（编制占用口径） |
| `to_be_flow_in_num` | 待流入_总计 |
| `to_be_flow_out_num` | 待流出_总计 |
| `remaining_hc` | 剩余 HC（已预计算） |

---

## 7. BP 关系链 — `catalog_dos_da_mcp.hrdw.Report_BP_bp_mapping`

**定位**：HRBP 与组织的服务关系映射。
**唯一标识**：`BP员工ID + BP支持的组织ID + 角色ID`
**控权**：列权限整表授权，行权限按组织。

**默认参数**：

| 参数 | 默认值 |
| --- | --- |
| `effect_status` | 服务中 |
| `is_deleted` | 0 |

**SQL 背景**：

1. 一个组织可能有多个 BP，统计某组织 BP 人数用 `COUNT(DISTINCT bp_staff_id)`。
2. 一个 BP 可能服务多个组织。
3. `effect_duration` = 截至当前的服务天数。

---

## 8. 组织异动记录表（新） — `catalog_dos_da_mcp.hrdw.Report_Org_Move_Record_New`

**定位**：组织新建/撤销/改名/挂靠/负责人变更全量流水。

**默认参数**：`record_status = 1`

**SQL 背景**：

1. 时间过滤：`org_move_date`（YYYY-MM-DD）。
2. 改名：组织类型 = 改名 且 `from_org_name != to_org_name`。
3. 挂靠变更：对比 `from_parent_org_name` 与 `to_parent_org_name`。
4. `org_name / org_full_name` 取异动后（to）优先，否则取异动前（from）。
5. 异动**次数** `COUNT(org_move_id)`，涉及**组织数** `COUNT(DISTINCT org_id)`。

---

## 9. 字典维表使用要点

字典表名含连字符，必须反引号：

```sql
SELECT * FROM catalog_dos_da_mcp.hrdw.`dw-api-public-dictionary-manager-level-name` LIMIT 100;
```

权限维度 ↔ 码值表对照：运行时 `use_skill("data-permission-checker")` 查看「行权限维度代码映射」章节。

---

## 10. 业务规则汇总（全表通用）

### 组织信息

- `org_full_name`：组织全路径，**WHERE 优先用 + LIKE**。
- `org_name`：末级组织节点。
- BG/线/部门/中心/组：分层级字段，分布统计 GROUP BY 用对应字段。
- 示例：`xx 线各部门在职人数 → WHERE org_full_name LIKE '%xx线%' GROUP BY dept_name`。

### 专业职级

- 专业人员：`pro_position_level_name IS NOT NULL AND manager_level_name IS NULL`
- x 级专业人员：`pro_position_level_num = x`
- T9（带族）：`pro_position_level_name = 'T9'`
- T9+（带族）：`pro_position_level_name IN (含 T 且数值 >= 9 的值)`
- 9 级+（不带族）：`pro_position_level_num >= 9`
- 职级分布：`GROUP BY pro_position_level_num`

### 异动场景类型 ↔ 中文名称

| 中文 | move_type_name |
| --- | --- |
| 入职 | 雇佣 |
| 离职 | 离职 |
| 调动 | 调动 |
| 专业变化 | 专业变化 |
| 管理变化 | 管理变化 |

### 校验清单（生成 SQL 必看）

- [ ] 已从 MCP 获取表结构，**表名含 catalog 前缀**
- [ ] 默认过滤条件齐全
- [ ] 统计人数用 `COUNT(DISTINCT staff_id8)`（员工信息宽表）/ `COUNT(DISTINCT staff_id)`（异动表）
- [ ] 专业职级字段类型正确（字符串 vs 数字）
- [ ] 组织查询用 `org_full_name + LIKE`
- [ ] 异动查询指定 `move_type_name`
- [ ] 绩效等级码值正确（`Outstanding` / `Good` / `Underperform`）
- [ ] 大结果集有 LIMIT
- [ ] 仅 SELECT，禁写操作
- [ ] 无权限控制类过滤条件（StarRocks 已自动控权）
