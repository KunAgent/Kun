# HR 数仓核心指标口径手册

> 数据源：MCP `slang_query` 工具
> 抓取时间：2026-06-07
> 标签：`indicator` = 严格指标定义；`metric_knot` = 指标节点（含 SQL 模版）

## ⚙️ 通用占位符

| 占位符 | 说明 |
| --- | --- |
| `{p_mm}` | 月末快照日期（YYYYMMDD） |
| `{p_dt}` | 日切片日期（YYYY-MM-DD），默认 T-1 |
| `{startDate}` `{endDate}` | 异动日期范围（YYYY-MM-DD） |
| `{p_mm_begin}` `{p_mm_end}` | 期初 / 期末快照（YYYYMMDD） |
| `{org_name}` | 目标组织全路径，模糊匹配 |
| `{manage_unit_name}` | 默认 "腾讯集团本部" |
| `{staff_type_name}` | 默认 "正式" |

---

## 一、人员现状（在职 / HC 系列）

### 在职人数 `staff-count`（原子）

- **定义**：员工状态 = 在职 的人数（去重）
- **数据源**：`catalog_dos_da_mcp.hrdw.Report_Wide_Public_Staff_Info`
- **同义词**：员工人数、员工数

```sql
SELECT COUNT(DISTINCT staff_id8) AS staff_count
FROM catalog_dos_da_mcp.hrdw.Report_Wide_Public_Staff_Info
WHERE hr_status_name = '在职'
  AND p_mm = '{p_mm}'
  AND manage_unit_name = '{manage_unit_name}'    -- 默认 腾讯集团本部
  AND staff_type_name  = '{staff_type_name}'     -- 默认 正式
  AND org_full_name LIKE '%{org_name}%'
```

### 在职人数（编制占用口径） `on-job-num-hc`（原子）

- **定义**：截至统计日期，员工状态为在职的正式员工数（按编制视角）
- **数据源**：`Report_HC_Management`（日切片 `p_dt`）
- 直接读 `on_job_num_hc` 字段。

### HC 定额 `hc-quotas-num`（原子）

- **定义**：年度 1/1 - 12/31 内基于人力预算预设的编制数量
- 直接读 `Report_HC_Management.hc_quotas_num`，默认条件：
  `self_flag='否' AND manage_unit_name='全部' AND region_type_name='全部' AND staff_subtype_name='正式聘用制'`

### 总 HC 数 `hc-sum-num`（复合，已预计算）

- **公式**：总 HC = HC 定额 + 校招 HC 借贷
- 直接读 `hc_sum_num`，**不要自己加**。

### 剩余 HC `remaining-hc`（复合，已预计算）

- **公式**：剩余 HC = HC 定额 + 校招 HC 借贷 − 在职人数 − 待流入人数 + 待流出人数
- 直接读 `remaining_hc`。正值=有可用编制；负值=超用。

### 管理者人数 `manager-count`（派生）

- **定义**：在职 + 有管理职级（默认）/ 有汇报下级（汇报链口径）
- **数据源**：员工信息宽表

```sql
SELECT COUNT(DISTINCT staff_id8) AS manager_count
FROM catalog_dos_da_mcp.hrdw.Report_Wide_Public_Staff_Info
WHERE hr_status_name = '在职'
  AND have_manager_level_flag_desc = '是'   -- 默认管理职级口径
  -- AND have_subee_flag_desc = '是'         -- 汇报链口径（替代）
  AND p_mm = '{p_mm}'
  AND manage_unit_name = '{manage_unit_name}'
  AND staff_type_name = '{staff_type_name}'
  AND org_full_name LIKE '%{org_name}%'
```

### 专业员工数 `pro-staff-count`（派生）

- **定义**：在职 + 专业职级不为空
- 在 `staff-count` 基础上叠加 `pro_position_level_name IS NOT NULL AND pro_position_level_name != ''`。

### 组织内管理者人数占比 `org-manager-ratio`（复合）

- **公式**：管理者人数 / 在职人数 × 100%
- 分子分母**必须使用相同筛选条件**（管理主体/员工类型/组织/切片日期）；分母为 0 返回 NULL。

---

## 二、异动（流入 / 流出 / 净流动）

### 入职人次数 `hire-count`（原子）

- **数据源**：`Report_Wide_Public_Staff_Change_Record`
- **核心条件**：`move_type_name = '雇佣'` + `move_date BETWEEN ...`
- 用**异动后**的 `to_*` 字段过滤组织/管理主体/员工类型。

### 离职人次数 `dimission-count`（原子）

- 同上，`move_type_name = '离职'`。
- 离职类型可加：`dimission_type_name IN ('主动类型','被动离职','法定离职','转聘')`。

### 调入人次数 `transfer-in-count`（原子）

```sql
WHERE move_type_name = '调动'
  AND to_org_full_name   LIKE '%{org_name}%'
  AND from_org_full_name NOT LIKE '%{org_name}%'   -- 排除内部调动
  AND move_date BETWEEN '{startDate}' AND '{endDate}'
```

### 调出人次数 `transfer-out-count`（原子）

```sql
WHERE move_type_name = '调动'
  AND from_org_full_name LIKE '%{org_name}%'
  AND to_org_full_name   NOT LIKE '%{org_name}%'   -- 排除内部调动
  AND move_date BETWEEN '{startDate}' AND '{endDate}'
```

### 流入人次数 `inflow-count`（复合）

- **公式**：入职人次数 + 调入人次数

### 流出人次数 `outflow-count`（复合）

- **公式**：离职人次数 + 调出人次数

### 净流入流出人次数 `net-flow-count`（复合）

- **公式**：(入职+调入) − (离职+调出)
- 正→流入；负→流出。
- 同义词：净流入流出人数、净流入、净流出

### 离职率 `dimission-rate`（复合）

- **公式**：离职人次数 × 2 / (期初在职人数 + 期末在职人数)
- 期初切片：起始月的上月月末；期末切片：结束月的月末。
- 特殊逻辑：组织新建期初=0 时令期初=期末；期末=0 时令期末=期初。

### 流入率 `inflow-rate`（复合）

- **公式**：(入职+调入) × 2 / (期初+期末)

### 流出率 `outflow-rate`（复合）

- **公式**：(离职+调出) × 2 / (期初+期末)
- 同义词：流失率、员工流失率

### 流入中人数 `inflow-processing-count`（复合，时点快照）

- **公式**：入职流程中 + 调入流程中
- 入职流程中：`Report_Wide_Public_Staff_Register_Info` 中 `flow_status_name = '流程中'`
- 调入流程中：`Report_Wide_Public_Staff_Transfer_Info` 中 `state_name = '流程中' AND to_org LIKE 目标 AND from_org NOT LIKE 目标`
- 同义词：待流入

### 流出中人数 `outflow-processing-count`（复合，时点快照）

- **公式**：离职流程中 + 调出流程中
- 调出流程中过滤主体用**异动前**的 `from_manage_unit_name / from_staff_type_name`。
- 同义词：待流出、待流失

---

## 三、招聘（校招专项）

### 校招从全量简历中发起面试人次 `campus-interview-initiated-count`（原子）

- **数据源**：`Report_School_Recruit_Interview_Info`
- **核心条件**：`interview_round = '初试'` + 排除"更换处理人无效记录"
- **校招实习生运营快报场景**默认条件（注意是写死的）：
  - 招聘类型 = 实习生
  - 最高学历毕业时间：2026-09-01 ~ 2027-12-31
  - 招聘年份 = 2026
  - 本环节开始时间 ≥ 2026-03-06
  - 面试 BG ∈ 9 大事业群

### 校招面试通过总人次 `campus-interview-pass-count`（原子）

- **核心条件**：`interview_round = 'HR面试' AND current_round_opinion = '通过'`
- 其余默认条件同上。

### 校招面试流程中总人次 `campus-interview-processing-count`（原子）

- **核心条件**：`interview_round IN ('集体面试','初试','复试','GM/面委会/EVP面试','HR面试') AND current_round_opinion = '未处理'`

### 校招签约人数 `campus-sign-count`（原子）

- **数据源**：`Report_School_Recruiti_Info_List`
- **核心条件**：
  - `sign_status = '已签'`
  - `is_current_latest_process = '是'`
  - `launch_hire_bg NOT IN ('子公司组织')`
- 实习生运营快报默认：
  - 招聘类型 = 实习生 / 招聘员工子类型 = 应届实习
  - `campus_candidate_tag_id != '1021'`
  - 招聘年份 = 当年；最高学历毕业时间：当年9-1 ~ 次年12-31

### 校招已入职人数 `campus-onboard-count`（原子）

- 同上，但加 `onboard_status = '已入职'`。

### 校招入职率 `campus-onboard-rate`（复合）

- **公式**：已入职 / 签约 × 100%
- 分子分母筛选条件需一致；签约=0 时显示 "-"。

### T 族校招面试通过率 `campus-interview-pass-rate`（复合）

- **公式**：T 族校招面试通过总人次 / T 族发起面试人次 × 100%
- 限定 `interview_position_family = '技术族(TE)'`

---

## 四、字段维度（用工看板）

| 维度 | 字段加工 |
| --- | --- |
| **性别** `gender_name` | 男 / 女 / 性别-无 |
| **年龄分段** `age` | 26↓、26-28、28-30、30-32、32-35、35-40、40-45、45-50、50+、年龄-无 |
| **学历分段** `highest_education_level_name` | 大专及以下 / 本科 / 硕士 / 博士及以上 / 无 |
| **工龄分段** `work_duration` | 1Y↓ / 1-3Y / 3-5Y / 5-10Y / 10-15Y / 15Y+ / 无 |
| **司龄分段** `seniority_duration` | 同工龄 |
| **进入部门时长** `entry_dept_duration` | 同工龄 |
| **管理层级（含海外）** | M / 组长(L1) / 总监(L2) / 中干(L3) / 高管(L4+) / 试点管理者 |
| **专业职级分段** `pro_position_level_num` | 4-5 / 6-8 / 9-11 / 12+ |
| **专业职级分段（含海外）** | 同上 + 试点员工（`overseas_job_bind_name` 不为空且 `If NHS Pilot=是`） |
| **族（含海外）** | 试点族 + `pro_position_clan_name` 标准值 |
| **专业通道（含海外）** | 试点通道 + `pro_position_genus_name` 标准值 |
| **招聘类型** | 校园招聘 / 社会招聘（按 `recruit_type_name` 是否为"校园招聘"） |
| **离职类型** | 被动离职 / 主动离职 |
| **用工分类** `employment_classification_name` | 集团正式用工 / 非集团正式用工 |
| **用工类型** `employment_type_name` | 集团本部正式 / 集团直管子公司用工 / 集团本部人力服务外包 / 集团本部学生 / 集团本部顾问 |

---

## 五、特殊定义速记

- **管理者**：拥有【管理职级】 → `have_manager_level_flag_desc = '是'`
- **专业员工**：`pro_position_level_name IS NOT NULL AND manager_level_name IS NULL`
- **集团**：管理主体 = 腾讯集团本部
- **海外**：`If NHS Pilot (overseas_nhs_pilot_flag_desc) = '是'`；组织：`oversea_org_flag_desc = '是'`
- **秘书**：`pro_position_genus_name = '秘书类－SE'`
- **基干**：管理职级 ∈ {L1-1,L1-2,L2-1,L2-2,L2-3}
- **青年干部**：年龄 < 35 + 管理职级 = L1/L2/L3
- **TT** = 梯队前 5%；**T1/第一梯队** = 前 15%；**T2/第二梯队** = 前 40%
- **绩效等级**：Outstanding（高绩效/5星）/ Good（3星）/ Underperform（2星-1星）
- **CVP** = L4 / **SVP** = L5 / **SEVP** = L6
- **职族（pro_position_clan_name）**：T 技术族 / P 产品/项目族 / S 专业族 / D 设计族 / M 市场族(MA)
- **正式**：员工类型 = 正式 + 员工子类型 = 正式聘用制
- **外包**：员工类型 = 外包 + 员工子类型 ∈ {项目外包, 人力资源外包, 人力资源外包驻场, 人力资源外包备份}
- **顾问**：员工类型 = 顾问 + 员工子类型 ∈ {长期顾问, 部门顾问, 特聘顾问, 荣誉顾问}
- **下级组织**：动态维度，需用 `catalog_dos_da_mcp.hrdw.a370651772b848cfa5dc7ef602243d69` 维表加工
- **下属人数**（员工信息宽表）：
  - 主岗口径：`direct_main_post_subee_num` / `all_main_post_subee_num`
  - 含兼岗：`direct_subee_num` / `all_subee_num`

---

## 六、活水

- **定义**：员工基于个人意愿应聘公司内其他岗位，经面试评估完成活水→衔接调动 → 调出旧组织 + 调入新组织。
- **判定**：`huoshui_flag_desc = '是'`
- **活水调入**（圈人 WHERE）：
  ```sql
  move_type_name = '调动'
    AND to_org_full_name LIKE '%调入组织%'
    AND from_org_full_name NOT LIKE '%调入组织%'
    AND huoshui_flag_desc = '是'
  ```
- **活水调出**（圈人 WHERE）：
  ```sql
  move_type_name = '调动'
    AND from_org_full_name LIKE '%调出组织%'
    AND to_org_full_name NOT LIKE '%调出组织%'
    AND huoshui_flag_desc = '是'
  ```

## 七、管理者流入/流出（针对组织维度）

| 类型 | 路径 |
| --- | --- |
| **管理者流入** | 入职(`异动场景类型=入职`) / 调入(`异动场景类型=调动`) / 新任(`异动子场景类型=管理新任`) |
| **管理者流出** | 离职(`异动场景类型=离职`) / 调出(`异动场景类型=调动`) / 免职(`异动子场景类型=管理免职`) |

## 八、转正

- 是否事实转正 `是否事实转正 = '是'`（无论在职/离职均可判断）
- 在职转正：`转正日期 < CURDATE() AND 员工状态 = '在职'`
- 转正率 = 已转正人数 / 已过转正日期人数
