# SQL 模板库

基于主表 `catalog_dos_da_mcp.hrdw.Report_School_Recruiti_Info_List`，按招聘经理保温场景定制。

所有模板都已经完成 **按 `resume_id` 去重取最新记录** 的逻辑，可以直接替换占位符后提交 `starrocks_query`。

---

## ⚠️ 字段名映射（必读）

本表部分字段名与直觉不符，使用前务必对照：

| 本 skill 语义 | 实际字段名 | 说明 |
|---|---|---|
| 候选人姓名 | `name` | 不是 `candidate_name` |
| 性别 | `sex` | 不是 `gender` |
| 岗位名称 | `position_name_cn` | 不是 `job_name` |
| 工作地 | `w_city` | 不是 `work_city` |
| 招聘经理 | `recruit_manager_name` | 格式为 `loginName(中文名)`，如 `zhangsan(张三)` |
| 导师 | `tutor_name_en` | 只有这一个字段，没有 `tutor_name_cn` |
| 直接上级 | `lead_name_en` | 只有这一个字段，没有 `lead_name_cn` |
| 毁约/拒签原因 | `suggestion` | 不是"意见建议" |
| 最新反馈 | `cm_feedback` | |
| 拒签原因 | `cm_fb_result` | 不是"CM反馈结果" |
| 拒签原因备注 | `cm_fb_remark` | |
| 人选标签（高潜） | `employ_candidate_tag_id` | 高潜识别主字段（数字ID）。权威取值：`12`=青云计划 / `1020`=青云实习 / `14`=销售培训生 / `1`=产品经理培训生；`0` 或其他=普通人选 |
| 招聘类型（学生类型） | `offer_staff_subtype_name` | 取值 `毕业生`/`应届实习生`/`日常实习生` |

---

## 占位符说明

| 占位符 | 示例 | 说明 |
|---|---|---|
| `{{MANAGER_FULL_NAME}}` | `'zhangsan(张三)'` | 招聘经理中英文名组合，来自 `get_current_user.loginName` + 员工宽表中文名拼接。单引号务必保留 |
| `{{RECRUIT_YEAR}}` | `2026` | 毕业届次（招聘年份），由首次加载确认；用户未指定/"默认"时取当年+次年。注意是数字类型不加引号。多届时改写 WHERE 为 `recruit_year IN (2025, 2026)` |
| `{{RECRUIT_TYPE_FILTER}}` | `AND offer_staff_subtype_name IN ('毕业生','应届实习生')` | 招聘类型（学生类型）过滤片段。全部/不限时为**空字符串**；单选 `= '毕业生'`；多选 `IN (...)`。取值仅 `毕业生` / `应届实习生` / `日常实习生` |
| `{{EXTRA_WHERE}}` | `AND bg_name_cn = 'TEG'` | 额外筛选条件，可为空 |
| `{{ORG_FILTER}}` | `AND bg_name_cn = 'PCG' AND dept_name_cn = 'QQ研发部'` | 范围 ④ 专用：组织过滤 WHERE 片段，按 `references/data-query.md` 第 1.1 节构造，可为空字符串 |
| `{{MANAGER_FILTER}}` | `AND recruit_manager_name = 'zhangsan(张三)'` 或 空字符串 | 控制是否叠加"我名下"过滤。范围 ① / ② / ③ / ④ 默认非空；范围 ④ 全组织视角时才置空 |
| `{{TUTOR_FILTER}}` | `AND tutor_name_en = 'lzhang'` 或 空字符串 | 范围 ② 时填入，其它范围置空 |
| `{{LEADER_FILTER}}` | `AND lead_name_en = 'lzhang'` 或 空字符串 | 范围 ③ 时填入，其它范围置空 |
| `{{HIGH_POTENTIAL_FILTER}}` | `AND employ_candidate_tag_id IN (12,1020,1)` 或 空字符串 | 高潜人选标签过滤，仅在用户明示"只看高潜/青云/产培生"时填入；默认空（全量，但仍派生 `candidate_tag` 用于标记） |

### 高潜人选标签口径（重要，字段零臆造）

- **主字段**：`employ_candidate_tag_id`（校招人选标签ID，数字）。实测权威取值：`12`=青云计划 / `1020`=青云实习 / `14`=销售培训生 / `1`=产品经理培训生；`0` 或其他=普通人选。
- **高潜人群口径**：`employ_candidate_tag_id IN (12,1020,1)`，即青云计划 / 青云实习 / 产品经理培训生 三类。青云实习（`1020`）为**独立标签值**，单独识别，不并入青云计划；销售培训生（`14`）不计入高潜。
- **派生标签** `candidate_tag`（所有明细模板统一加在 SELECT，仅三类高潜映射为非空，非空即 ⭐高潜，优先保温）：

```sql
CASE employ_candidate_tag_id
  WHEN 12 THEN '青云计划'
  WHEN 1020 THEN '青云实习'
  WHEN 1 THEN '产品经理培训生'
  ELSE NULL
END AS candidate_tag
```

### `{{MANAGER_FULL_NAME}}` 获取方法

```
# 第一步：获取 loginName
mcp_call_tool: HRIT/hr-ai-data/hr_data_service.get_current_user
→ 返回: { "loginName": "zhangsan" }

# 第二步：查员工宽表获取中文名
mcp_call_tool: HRIT/hr-ai-data/hr_data_service.starrocks_query
arguments: {
  "sql": "SELECT staff_display_name, staff_account_name FROM catalog_dos_data_analysis_mcp_2.hrdw.Report_Wide_Public_Staff_Info WHERE staff_account_name LIKE '%zhangsan%' LIMIT 3",
  "userQuestion": "查询当前用户的中文名，用于拼接招聘经理标识"
}
→ 返回: { "staff_display_name": "张三", "staff_account_name": "zhangsan" }

# 第三步：拼接
{{MANAGER_FULL_NAME}} = 'zhangsan(张三)'
```

---

## 通用内层（去重 CTE）

所有模板共用这一段（兼容范围 ① / ② / ③ / ④ 及叠加场景）：

```sql
WITH latest AS (
  SELECT
    resume_id, offer_id, name, sex,
    highest_school, highest_speciality, highest_degree,
    practice_exp, employer_names,
    bg_name_cn, line_name_cn, dept_name_cn, center_name_cn,
    org_full_path, org_full_name_cn, position_name_cn, w_city,
    recruit_manager_name,
    tutor_name_en, lead_name_en, leader_post_name,
    sign_status, tripartite_status,
    signed_time, third_party_sub_time,
    expect_entry_date, is_entry, entry_status, entry_date,
    destroy_time, suggestion,
    cm_feedback, cm_fb_result, cm_fb_remark,
    resume_link, offer_link, lastest_flow_flag_name,
    recruit_year, offer_staff_subtype_name,
    employ_candidate_tag_id,
    CASE employ_candidate_tag_id
      WHEN 12 THEN '青云计划'
      WHEN 1020 THEN '青云实习'
      WHEN 1 THEN '产品经理培训生'
      ELSE NULL
    END AS candidate_tag,
    -- 【最新流程单据】去重标准写法：lastest_flow_flag_name='是' 永远排最前，
    -- 保证每个 resume_id 取到的都是"当前最新流程单据"；标记缺失时再按签约时间兜底，不漏人
    ROW_NUMBER() OVER (
      PARTITION BY resume_id
      ORDER BY
        CASE WHEN lastest_flow_flag_name = '是' THEN 0 ELSE 1 END ASC,
        signed_time DESC,
        offer_id DESC
    ) AS rn
  FROM catalog_dos_da_mcp.hrdw.Report_School_Recruiti_Info_List
  WHERE recruit_year IN ({{RECRUIT_YEAR}}, {{RECRUIT_YEAR}} + 1)   -- 多届时改为 recruit_year IN (2025, 2026)
    AND sign_status IN ('已签', '毁约')
    {{MANAGER_FILTER}}
    {{TUTOR_FILTER}}
    {{LEADER_FILTER}}
    {{ORG_FILTER}}
    {{RECRUIT_TYPE_FILTER}}
    {{EXTRA_WHERE}}
)
```

### 占位符按范围填法速查

| 范围 | `{{MANAGER_FILTER}}` | `{{TUTOR_FILTER}}` | `{{LEADER_FILTER}}` | `{{ORG_FILTER}}` |
|---|---|---|---|---|
| ① 我名下 | `AND recruit_manager_name = {{MANAGER_FULL_NAME}}` | 空 | 空 | 空 |
| ② 指定导师 | 空 | `AND tutor_name_en = '{{TUTOR_NAME_EN}}'` | 空 | 空 |
| ③ 指定上级 | 空 | 空 | `AND lead_name_en = '{{LEAD_NAME_EN}}'` | 空 |
| ④ 指定组织（默认带"我名下"防越权） | `AND recruit_manager_name = {{MANAGER_FULL_NAME}}` | 空 | 空 | 见 data-query.md 1.1.3 |
| ④ 全组织视角（用户明示，谨慎） | 空 | 空 | 空 | 见 data-query.md 1.1.3 |
| ④ + ① / ② / ③ 叠加 | 按对应范围 | 按对应范围 | 按对应范围 | 见 data-query.md 1.1.3 |

### 届次与招聘类型填法速查（与范围正交，独立确认）

| 维度 | 占位符 | 全部/默认 | 单选 | 多选 |
|---|---|---|---|---|
| 毕业届次 | `{{RECRUIT_YEAR}}` | 当年+次年：`recruit_year IN (2026, 2027)` | `recruit_year = 2026` | `recruit_year IN (2025, 2026)` |
| 招聘类型 | `{{RECRUIT_TYPE_FILTER}}` | 空字符串（不过滤） | `AND offer_staff_subtype_name = '毕业生'` | `AND offer_staff_subtype_name IN ('应届实习生','日常实习生')` |

⚠️ 届次为多届时，直接把通用内层 WHERE 的 `recruit_year IN ({{RECRUIT_YEAR}}, {{RECRUIT_YEAR}} + 1)` 替换为用户确认的届次集合，如 `recruit_year IN (2025, 2026)`。

---

## T1_MY_PENDING — 全量待入职清单

**用途**：用户说"我名下有哪些人"、"给我看我的保温列表"。

```sql
WITH latest AS (
  -- 见"通用内层"
)
SELECT
  resume_id, name, offer_staff_subtype_name,
  candidate_tag,
  highest_school, highest_speciality, highest_degree,
  bg_name_cn, dept_name_cn, center_name_cn, org_full_name_cn,
  position_name_cn, w_city,
  tutor_name_en, lead_name_en,
  sign_status, tripartite_status,
  signed_time, expect_entry_date, recruit_year,
  is_entry, entry_status,
  cm_feedback, suggestion,
  DATEDIFF(expect_entry_date, CURRENT_DATE()) AS days_to_entry,
  CASE
    WHEN tutor_name_en IS NULL OR tutor_name_en = '' THEN 0 ELSE 1
  END AS mentor_bound,
  CASE
    WHEN lead_name_en IS NULL OR lead_name_en = '' THEN 0 ELSE 1
  END AS leader_bound
FROM latest
WHERE rn = 1
  AND (is_entry = '否' OR entry_status = '待入职' OR sign_status = '毁约')
ORDER BY
  CASE WHEN sign_status = '毁约' THEN 2 ELSE 1 END,
  expect_entry_date ASC,
  signed_time DESC
LIMIT 500;
```

---

## T2_NO_MENTOR — 导师未填写清单

**用途**：用户说"导师还没填的"、"哪些没分配导师"。

```sql
WITH latest AS (
  -- 见"通用内层"
)
SELECT
  resume_id, name,
  highest_school, highest_degree, position_name_cn, w_city,
  org_full_name_cn,
  lead_name_en,
  sign_status, expect_entry_date,
  DATEDIFF(expect_entry_date, CURRENT_DATE()) AS days_to_entry,
  signed_time
FROM latest
WHERE rn = 1
  AND sign_status = '已签'
  AND (tutor_name_en IS NULL OR tutor_name_en = '')
  AND (is_entry = '否' OR entry_status = '待入职')
ORDER BY expect_entry_date ASC
LIMIT 200;
```

---

## T3_NO_LEADER — 直接上级未确认清单

**用途**：用户说"上级还没定的"、"直接上级没确认的"。

```sql
WITH latest AS (
  -- 见"通用内层"
)
SELECT
  resume_id, name,
  highest_school, highest_degree, position_name_cn, w_city,
  org_full_name_cn,
  tutor_name_en,
  sign_status, expect_entry_date,
  DATEDIFF(expect_entry_date, CURRENT_DATE()) AS days_to_entry,
  signed_time
FROM latest
WHERE rn = 1
  AND sign_status = '已签'
  AND (lead_name_en IS NULL OR lead_name_en = '')
  AND (is_entry = '否' OR entry_status = '待入职')
ORDER BY expect_entry_date ASC
LIMIT 200;
```

---

## T4_BY_ENTRY_DATE — 按预计入职时间筛选

**用途**：用户说"这周要入职的"、"5 月入职的"、"未来 30 天入职的"。

需要额外占位符：`{{ENTRY_START}}` 和 `{{ENTRY_END}}`，如 `'2026-04-20'` / `'2026-05-20'`。

```sql
WITH latest AS (
  -- 见"通用内层"
)
SELECT
  resume_id, name,
  highest_school, highest_speciality, position_name_cn, w_city,
  org_full_name_cn,
  tutor_name_en, lead_name_en,
  sign_status, expect_entry_date,
  DATEDIFF(expect_entry_date, CURRENT_DATE()) AS days_to_entry,
  cm_feedback
FROM latest
WHERE rn = 1
  AND sign_status = '已签'
  AND expect_entry_date BETWEEN {{ENTRY_START}} AND {{ENTRY_END}}
ORDER BY expect_entry_date ASC
LIMIT 200;
```

---

## T5_DESTROYED — 已毁约清单

**用途**：用户说"已毁约的"、"毁约清单"、"毁约情况"。

```sql
WITH latest AS (
  -- 见"通用内层"
)
SELECT
  resume_id, name,
  highest_school, highest_speciality, highest_degree,
  bg_name_cn, dept_name_cn, position_name_cn, w_city,
  signed_time, destroy_time,
  DATEDIFF(destroy_time, signed_time) AS days_signed_to_broken,
  expect_entry_date,
  suggestion, cm_fb_result, cm_fb_remark
FROM latest
WHERE rn = 1
  AND sign_status = '毁约'
ORDER BY destroy_time DESC
LIMIT 200;
```

---

## T6_ONE_CANDIDATE — 单人画像全量

**用途**：用户说"查 XXX 的详情"、"XXX 的画像"。

需要额外占位符：`{{CANDIDATE_NAME}}`（如 `'陈思远'`）或 `{{RESUME_ID}}`（如 `'R2601001'`）。

```sql
WITH latest AS (
  -- 见"通用内层"，但 WHERE 去掉 recruit_manager_name 条件后，末尾加：
  -- AND (name = {{CANDIDATE_NAME}} OR resume_id = {{RESUME_ID}})
)
SELECT *
FROM latest
WHERE rn = 1
LIMIT 5;
```

⚠️ 安全校验：返回结果后务必检查 `recruit_manager_name` 是否包含当前用户 `loginName`。如果不包含，说明越权，应拒绝展示详情并提示"该候选人不在您的管辖范围内"。

---

## T_LINK — 单人链接专用查询（用户要求返回链接时使用）

**用途**：用户说"给我 XXX 的链接"、"简历链接"、"录用链接"、"发我 offer 链接"。

**核心原则**：不使用通用 CTE，直接以 `lastest_flow_flag_name = '是'` 为首要过滤条件，确保链接来自当前最新流程。

需要额外占位符：`{{CANDIDATE_NAME}}`（如 `'陈思远'`）或 `{{RESUME_ID}}`（如 `'R2601001'`）。

```sql
SELECT
  resume_id,
  offer_id,
  name,
  sign_status,
  lastest_flow_flag_name,
  CASE
    WHEN offer_link IS NOT NULL AND offer_link <> '' AND offer_link <> '***'
    THEN offer_link
    ELSE NULL
  END AS valid_offer_link,
  CASE
    WHEN resume_link IS NOT NULL AND resume_link <> '' AND resume_link <> '***'
    THEN resume_link
    ELSE NULL
  END AS valid_resume_link
FROM catalog_dos_da_mcp.hrdw.Report_School_Recruiti_Info_List
WHERE sign_status IN ('已签', '毁约')
  AND lastest_flow_flag_name = '是'
  AND (name = {{CANDIDATE_NAME}} OR resume_id = {{RESUME_ID}})
ORDER BY signed_time DESC
LIMIT 3;
```

**结果处理**：

1. `valid_offer_link` 非空 → 优先展示录用链接
2. `valid_offer_link` 为空但 `valid_resume_link` 非空 → 展示简历链接
3. 两者均为空 → 告知"当前暂无可用链接，建议在招聘系统中直接查询"
4. 若查询返回 0 行（`lastest_flow_flag_name = '是'` 无匹配）→ 告知数据异常，引导招聘系统确认

输出格式：

```
📎 {候选人姓名} 的链接（当前最新流程）：

• 录用链接：{valid_offer_link 或 暂无}
• 简历链接：{valid_resume_link 或 暂无}

⚠️ 请在内网环境访问。
```

⚠️ 不得在多人清单（T1 ~ T9）中批量返回链接字段；链接仅在用户针对特定候选人明确请求时展示。

---

## T7_SUMMARY_KPI — 个人保温 KPI 概览

**用途**：播报或"我的保温整体情况"。

```sql
WITH latest AS (
  -- 见"通用内层"
)
SELECT
  COUNT(*) AS total_pool,
  SUM(CASE WHEN sign_status = '已签' THEN 1 ELSE 0 END) AS signed_cnt,
  SUM(CASE WHEN sign_status = '毁约' THEN 1 ELSE 0 END) AS broken_cnt,
  SUM(CASE WHEN sign_status = '已签' AND (tutor_name_en IS NULL OR tutor_name_en = '') THEN 1 ELSE 0 END) AS no_mentor_cnt,
  SUM(CASE WHEN sign_status = '已签' AND (lead_name_en IS NULL OR lead_name_en = '') THEN 1 ELSE 0 END) AS no_leader_cnt,
  SUM(CASE WHEN sign_status = '已签' AND DATEDIFF(expect_entry_date, CURRENT_DATE()) BETWEEN 0 AND 30 THEN 1 ELSE 0 END) AS pre_entry_30d_cnt,
  SUM(CASE WHEN sign_status = '已签' AND (cm_fb_result IS NOT NULL AND cm_fb_result <> '') THEN 1 ELSE 0 END) AS high_risk_cnt
FROM latest
WHERE rn = 1;
```

返回值用于场景 C 的摘要播报。

---

## T8_BY_ORG — 按组织过滤的待入职清单（范围 ④）

**用途**：用户说"PCG 部门里的同学"、"TEG 名下保温清单"、"我名下且在 IEG 的"。

**前置**：必须先按 [data-query.md 1.1 节](./data-query.md#step-11组织名解析仅范围-触发) 完成组织名解析，得到 `{{ORG_FILTER}}`。

```sql
WITH latest AS (
  -- 见"通用内层"，按"占位符按范围填法速查"填好 4 个 FILTER
)
SELECT
  resume_id, name, offer_staff_subtype_name,
  highest_school, highest_speciality, highest_degree,
  bg_name_cn, dept_name_cn, center_name_cn, org_full_name_cn,
  position_name_cn, w_city,
  recruit_manager_name,
  tutor_name_en, lead_name_en,
  sign_status, tripartite_status,
  signed_time, expect_entry_date, recruit_year,
  is_entry, entry_status,
  cm_feedback, suggestion,
  DATEDIFF(expect_entry_date, CURRENT_DATE()) AS days_to_entry,
  CASE WHEN tutor_name_en IS NULL OR tutor_name_en = '' THEN 0 ELSE 1 END AS mentor_bound,
  CASE WHEN lead_name_en IS NULL OR lead_name_en = '' THEN 0 ELSE 1 END AS leader_bound
FROM latest
WHERE rn = 1
  AND (is_entry = '否' OR entry_status = '待入职' OR sign_status = '毁约')
ORDER BY
  CASE WHEN sign_status = '毁约' THEN 2 ELSE 1 END,
  expect_entry_date ASC,
  signed_time DESC
LIMIT 500;
```

⚠️ 默认填法（"我名下 + 在指定组织"）：

```
{{MANAGER_FILTER}} = AND recruit_manager_name = 'zhangsan(张三)'
{{TUTOR_FILTER}}    = （空）
{{LEADER_FILTER}}   = （空）
{{ORG_FILTER}}      = AND bg_name_cn = 'PCG' AND dept_name_cn = 'QQ研发部'
```

⚠️ 全组织视角（用户明示）：把 `{{MANAGER_FILTER}}` 置空，并在调用前先 `get_current_user_data_permission` 核查行权限。

---

## T9_ORG_KPI — 组织维度 KPI 与子组织聚合（范围 ④ 专用）

**用途**：用户说"按部门看保温热点"、"PCG 内各部门保温情况对比"、"组织盘点"。配合 T8_BY_ORG 使用，先 KPI 后明细。

```sql
WITH latest AS (
  -- 见"通用内层"，按"占位符按范围填法速查"填好 4 个 FILTER
),
base AS (
  SELECT *
  FROM latest
  WHERE rn = 1
    AND (is_entry = '否' OR entry_status = '待入职' OR sign_status = '毁约')
)
SELECT
  -- 子组织维度（默认 dept_name_cn，父组织为部门时改为 center_name_cn，更细可换 org_full_name_cn）
  dept_name_cn AS sub_org,
  COUNT(*) AS total_pool,
  SUM(CASE WHEN sign_status = '已签' THEN 1 ELSE 0 END) AS signed_cnt,
  SUM(CASE WHEN sign_status = '毁约' THEN 1 ELSE 0 END) AS broken_cnt,
  SUM(CASE WHEN sign_status = '已签' AND (tutor_name_en IS NULL OR tutor_name_en = '') THEN 1 ELSE 0 END) AS no_mentor_cnt,
  SUM(CASE WHEN sign_status = '已签' AND (lead_name_en IS NULL OR lead_name_en = '') THEN 1 ELSE 0 END) AS no_leader_cnt,
  SUM(CASE WHEN sign_status = '已签' AND DATEDIFF(expect_entry_date, CURRENT_DATE()) BETWEEN 0 AND 30 THEN 1 ELSE 0 END) AS pre_entry_30d_cnt,
  SUM(CASE WHEN sign_status = '已签' AND (cm_fb_result IS NOT NULL AND cm_fb_result <> '') THEN 1 ELSE 0 END) AS high_risk_cnt
FROM base
GROUP BY dept_name_cn
ORDER BY total_pool DESC
LIMIT 20;
```

⚠️ 分桶字段切换规则：

- 父组织粒度为 BG → `GROUP BY dept_name_cn`
- 父组织粒度为部门 → `GROUP BY center_name_cn`
- 父组织粒度为中心 / 全路径 → `GROUP BY org_full_name_cn`

返回值直接用于 [data-query.md 4.3.1 节](./data-query.md#431-范围--专属按子组织聚合小结强制仅范围-) 的"按子组织看保温热点"表。

---

## 调用模板

以 T8_BY_ORG（"我名下 + 在 PCG/QQ研发部 + 2026/2027 届 + 只看毕业生"）为例，最终拼好的 SQL 示意：

```sql
WITH latest AS (
  SELECT
    resume_id, offer_id, name, sex,
    highest_school, highest_speciality, highest_degree,
    practice_exp, employer_names,
    bg_name_cn, line_name_cn, dept_name_cn, center_name_cn,
    org_full_path, org_full_name_cn, position_name_cn, w_city,
    recruit_manager_name,
    tutor_name_en, lead_name_en, leader_post_name,
    sign_status, tripartite_status,
    signed_time, third_party_sub_time,
    expect_entry_date, is_entry, entry_status, entry_date,
    destroy_time, suggestion,
    cm_feedback, cm_fb_result, cm_fb_remark,
    lastest_flow_flag_name,
    recruit_year, offer_staff_subtype_name,
    -- 【最新流程单据】与通用内层一致：lastest_flow_flag_name='是' 永远排最前
    ROW_NUMBER() OVER (
      PARTITION BY resume_id
      ORDER BY
        CASE WHEN lastest_flow_flag_name = '是' THEN 0 ELSE 1 END ASC,
        signed_time DESC,
        offer_id DESC
    ) AS rn
  FROM catalog_dos_da_mcp.hrdw.Report_School_Recruiti_Info_List
  WHERE recruit_year IN (2026, 2027)
    AND sign_status IN ('已签', '毁约')
    AND recruit_manager_name = 'zhangsan(张三)'
    AND bg_name_cn = 'PCG'
    AND dept_name_cn = 'QQ研发部'
    AND offer_staff_subtype_name = '毕业生'
)
SELECT ...
```

⚠️ 上例展示了人群三维（范围 + 届次 + 招聘类型）+ 最新流程单据去重的完整拼法；招聘类型为"全部"时去掉最后一行 `AND offer_staff_subtype_name = ...` 即可。

⚠️ 若用户明示"只看高潜/青云/产培生"，在 WHERE 末尾追加 `{{HIGH_POTENTIAL_FILTER}}`，如 `AND employ_candidate_tag_id IN (12,1020,1)`；默认不加（全量），但 SELECT 始终保留 `candidate_tag` 以便对高潜同学打 ⭐ 标记并优先保温。

拿到 SQL 后调用：

```
mcp_call_tool:
  serverName: HRIT/hr-ai-data/hr_data_service
  toolName: starrocks_query
  arguments: { "sql": "<上面的 SQL>", "userQuestion": "<用户的问题>" }
```

⚠️ SQL 字符串里的单引号不要 escape 成 `\'`，直接传原样字符串即可。

⚠️ `starrocks_query` 的 `userQuestion` 参数为必填，必须传入用户最近一条消息内容。
