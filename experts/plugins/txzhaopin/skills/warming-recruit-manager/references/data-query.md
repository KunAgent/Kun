# 保温数据查询 SOP

面向场景 A：招聘经理查询名下待入职校招候选人。

---

## 目录

- [1. 执行步骤](#1-执行步骤)
- [2. 核心字段清单](#2-核心字段清单)
- [3. 风险识别规则](#3-风险识别规则)
- [4. 输出规范](#4-输出规范)
- [5. 常见口径变体](#5-常见口径变体)
- [6. 脱敏识别](#6-脱敏识别)

---

## 1. 执行步骤

### Step 0：检查数据源 MCP 连接

**hr-ai-data 是主数据源；zhaopin-mcp/recruit-mcp 是补充数据源。**

#### Step 0.1：检查 hr-ai-data（强制）

在执行签约后池子统计、名单、组织盘点之前，必须确认 hr-ai-data MCP 插件已连接。

```
尝试调用 mcp_get_tool_description:
  toolRequests: [["HRIT/hr-ai-data/hr_data_service", "get_current_user"]]

如果成功 → 插件已连接，继续 Step 1
如果失败 → 立即告知用户：
  "⚠️ 当前环境未连接 hr-ai-data 数据服务插件，无法查询真实数仓数据。
   请先在 CodeBuddy 插件市场安装 hr-ai-data 插件，然后重新打开对话。"
  并终止后续步骤，不得降级到本地 demo 数据，也不得用 zhaopin-mcp/recruit-mcp 替代主查询。
```

#### Step 0.2：检查 zhaopin-mcp / recruit-mcp（按需）

当用户需要简历详情、面评、流程详情、最新链接、候选人画像补全时，尝试检查 `recruit-mcp`（即 zhaopin-mcp 能力）。

```
尝试调用 mcp_get_tool_description:
  toolRequests: [["recruit-mcp", "SearchAPI"], ["recruit-mcp", "CallAPI"], ["recruit-mcp", "CallDB"]]

如果成功 → 可作为补充数据源
如果失败 → 告知用户“招聘系统补充数据暂不可用”，继续使用 hr-ai-data 可见字段，不编造补充信息
```

### Step 1：获取当前招聘经理身份

需要**两步**才能拿到可用于 SQL 的招聘经理标识：

**第一步**：获取 loginName

```
mcp_call_tool: HRIT/hr-ai-data/hr_data_service.get_current_user
返回: { "staffId": "...", "loginName": "zhangsan" }
```

⚠️ 不要把 `staffId` 展示给用户，仅作为内部标识。

**第二步**：通过员工宽表查中文名，拼接成 `recruit_manager_name` 所需格式

```
mcp_call_tool: HRIT/hr-ai-data/hr_data_service.starrocks_query
arguments: {
  "sql": "SELECT staff_display_name, staff_account_name FROM catalog_dos_data_analysis_mcp_2.hrdw.Report_Wide_Public_Staff_Info WHERE staff_account_name LIKE '%{loginName}%' LIMIT 3",
  "userQuestion": "查询当前用户的中文名，用于拼接招聘经理标识"
}
```

返回示例：`{ "staff_display_name": "张三", "staff_account_name": "zhangsan" }`

**第三步**：拼接 `recruit_manager_name` 值

`recruit_manager_name` 字段存储格式为 **中英文名组合**：`{loginName}({中文名})`

```
最终值 = 'zhangsan(张三)'
```

⚠️ **关键**：
- `recruit_manager_name` 不是纯英文名，也不是纯中文名，而是 `loginName(中文名)` 格式
- `loginName` 不能直接用于 WHERE 匹配，因为表中没有独立的 `recruit_manager_en` 字段
- 如果员工宽表查不到中文名，尝试用 LIKE 模糊匹配 `recruit_manager_name LIKE '%{loginName}%'`

### Step 1.1：组织名解析（仅范围 ④ 触发）

当用户选择查询范围 ④（指定部门 / 组织名下）时，**必须**先完成组织名解析，确认组织在主表中真实存在并取得标准写法，避免凭空构造 WHERE 条件。

#### 1.1.1 字段优先级与适用层级

主表 `Report_School_Recruiti_Info_List` 中可用于"按组织过滤"的字段：

| 字段 | 含义 | 层级 | 推荐写法 |
|---|---|---|---|
| `bg_name_cn` | 发起录用 BG | BG（最粗） | `bg_name_cn = 'TEG'` 精确匹配 |
| `line_name_cn` | 条线 | 条线 | `line_name_cn = '{条线名}'` 精确匹配 |
| `dept_name_cn` | 发起录用部门 | 部门 | `dept_name_cn = '{部门名}'` 精确匹配 |
| `center_name_cn` | 发起录用中心 | 中心 | `center_name_cn = '{中心名}'` 精确匹配 |
| `center_full_name` | 中心全路径 | 中心+ | `center_full_name LIKE '%{片段}%'` |
| `org_full_name_cn` | 录用组织全路径 | 组级（最细） | `org_full_name_cn LIKE '%{片段}%'` |
| `org_full_path` | 组织 ID 全路径 | 组级（ID） | `org_full_path LIKE '%{ID}%'` |
| `org_full_name_cn_fake` | 对应虚拟部门 | 虚拟组织 | 用户明确说"虚拟组织"时使用 |
| `requirement_org_full_name` | 需求所属组织中文全路径 | 需求口径 | 用户明确说"按需求归属组织"时使用 |

⚠️ 不建议直接用 `dept_name_cn LIKE '%片段%'`，因为部门重名跨 BG 较多；如必须模糊，请同时叠加 `bg_name_cn` 限定。

#### 1.1.2 组织名验证 SQL

收到用户输入的组织名后，**必须**先执行一次验证，再进入正式查询：

```
mcp_call_tool: HRIT/hr-ai-data/hr_data_service.starrocks_query
arguments: {
  "sql": "SELECT bg_name_cn, line_name_cn, dept_name_cn, center_name_cn, COUNT(DISTINCT resume_id) AS cand_cnt FROM catalog_dos_da_mcp.hrdw.Report_School_Recruiti_Info_List WHERE recruit_year IN ({当年}, {当年}+1) AND sign_status IN ('已签','毁约') AND ( bg_name_cn = '{用户输入}' OR dept_name_cn = '{用户输入}' OR center_name_cn = '{用户输入}' OR org_full_name_cn LIKE '%{用户输入}%' ) GROUP BY 1,2,3,4 ORDER BY cand_cnt DESC LIMIT 20",
  "userQuestion": "{用户原始组织名输入}"
}
```

返回处理：

- 若结果 = 0 行 → 组织不存在或本年度无签约后人选，**反问用户**澄清写法（"我没有在当年签约后池子里找到 'XXX'，你是想查 PCG 还是 IEG 下的某个具体部门？")
- 若结果 = 1 行 → 直接采用对应字段做精确匹配
- 若结果 ≥ 2 行 → 在结果开头列出候选组织（含层级和签约后人数），让用户确认目标后再继续；禁止一次性查多个不确定组织
- 若用户说"全部都查" → 用 `IN(...)` 生成 `{{ORG_FILTER}}`，结果开头明确说明合并范围

#### 1.1.3 组织过滤片段构造（{{ORG_FILTER}}）

按用户最终确认的组织信息，生成可嵌入主查询 WHERE 的字符串片段：

| 用户意图 | 生成片段示例 |
|---|---|
| 单 BG | `AND bg_name_cn = 'TEG'` |
| 单部门 | `AND dept_name_cn = 'QQ研发部'` |
| 多 BG | `AND bg_name_cn IN ('PCG','IEG')` |
| 单中心 | `AND center_name_cn = '深圳研发中心'` |
| 组织全路径 | `AND org_full_name_cn LIKE '%PCG/QQ研发部%'` |
| BG + 部门 | `AND bg_name_cn = 'PCG' AND dept_name_cn = 'QQ研发部'` |
| 多个并列组织 | `AND ( dept_name_cn IN ('A','B') OR center_name_cn IN ('C','D') )` |

#### 1.1.4 越权与合规默认

**默认叠加 `recruit_manager_name = '{当前招聘经理}'`**：即"组织内 + 我名下"，避免越权看到其他招聘经理对接的人选。

仅当用户**明确**说"全组织视角"、"不限招聘经理"、"组织盘点"等强意图时，才放开 `recruit_manager_name` 过滤；放开时必须：

- 先调用 `get_current_user_data_permission` 核查当前用户对该组织的行权限
- 结果开头明确标注："以下是 {组织} 全组织视角的待入职候选人（不限招聘经理，仅作组织盘点用途，请勿对外转发）"
- 涉及候选人手机号、面评原文等敏感字段，**一律不展示**，仅展示姓名 / 学校 / 岗位 / 入职日期 / 风险标签等

### Step 1.2：毕业届次与招聘类型确认（强制，首次查询前）

在执行正式查询前，除"查询范围"外，还必须确认两个**人群维度**（已在 〇-A 询问过则沿用，未确认则补问）：

#### 1.2.1 毕业届次（`recruit_year`）

| 用户回复 | `recruit_year` 取值 |
|---|---|
| "默认" / 未指定 | 当年 + 次年，如当前 2026 → `recruit_year IN (2026, 2027)` |
| 单届，如"2026 届" | `recruit_year = 2026` |
| 多届，如"2025 和 2026" | `recruit_year IN (2025, 2026)` |

#### 1.2.2 招聘类型（`offer_staff_subtype_name`）

字段取值固定为 `毕业生` / `应届实习生` / `日常实习生`，生成过滤片段 `{{RECRUIT_TYPE_FILTER}}`：

| 用户回复 | `{{RECRUIT_TYPE_FILTER}}` |
|---|---|
| "全部" / "不限" / 未指定 | 空字符串（不加过滤，查所有类型） |
| 单选，如"只看毕业生" | `AND offer_staff_subtype_name = '毕业生'` |
| 多选，如"应届实习生 + 日常实习生" | `AND offer_staff_subtype_name IN ('应届实习生', '日常实习生')` |
| 口语"实习生 / 实习" | 默认理解为 `IN ('应届实习生', '日常实习生')`，并向用户复述确认 |

#### 1.2.3 高潜人选标签（`employ_candidate_tag_id`，默认全量标记，非默认过滤）

主表用 `employ_candidate_tag_id`（校招人选标签ID，数字）标识高潜人选。**默认不按标签过滤**（仍查全量），但所有明细统一派生 `candidate_tag` 并对高潜同学打 ⭐ 标记、优先保温。仅当用户明示"只看高潜 / 只看青云 / 只看产培生"时，才生成过滤片段 `{{HIGH_POTENTIAL_FILTER}}`：

| 用户回复 | `{{HIGH_POTENTIAL_FILTER}}` |
|---|---|
| 未指定（默认） | 空字符串（全量，但派生 `candidate_tag` 标记高潜） |
| "只看高潜" | `AND employ_candidate_tag_id IN (12,1020,1)` |
| "只看青云"（青云计划 + 青云实习） | `AND employ_candidate_tag_id IN (12,1020)` |
| "只看青云计划" | `AND employ_candidate_tag_id = 12` |
| "只看青云实习" | `AND employ_candidate_tag_id = 1020` |
| "只看产培生" / "产品经理培训生" | `AND employ_candidate_tag_id = 1` |

派生标签口径（字段零臆造，详见 `sql-templates.md` 高潜口径）：`12→青云计划`；`1020→青云实习`；`1→产品经理培训生`；其余为 NULL。青云实习（`1020`）为**独立标签值**，单独识别，不并入青云计划。

⚠️ 高潜人才属于《学生人才吸引保温全景》定义的"高潜 / 特殊人才"人群，保温重点为**高层关注、资源倾斜、个性化发展规划，必要时由更高级别管理者参与保温**（见 `warming-scripts.md`）。

⚠️ 确认结果需在查询结果摘要卡顶部作为标签呈现（见第 4.1 节），并在明细表加"招聘类型""人选标签"列（见第 4.2 节）。

### Step 2：（可选）确认数据权限

若用户首次使用或查询的字段不确定是否有权限，调用：

```
mcp_call_tool: HRIT/hr-ai-data/hr_data_service.get_current_user_data_permission
arguments: { "tableCode": "catalog_dos_da_mcp.hrdw.Report_School_Recruiti_Info_List" }
```

重点关注返回的 `accessibleColumns`（可访问字段）和 `rowScope`（行权限范围）。

### Step 3：选 SQL 模板并执行

打开 [sql-templates.md](./sql-templates.md)，根据用户意图选择模板。

```
mcp_call_tool: HRIT/hr-ai-data/hr_data_service.starrocks_query
arguments: { "sql": "<拼好的 SQL>", "userQuestion": "<用户的问题>" }
```

### Step 3.5：zhaopin-mcp / recruit-mcp 补充查询（按需）

触发条件：用户要求简历详情、面评、流程详情、最新链接、候选人画像补全，或 hr-ai-data 字段为空 / 不足。

**边界**：补充查询只补足单人或少量候选人的详情，不用于替代 Step 3 的人数统计、范围过滤、毁约率等主口径。

调用顺序：

```
# 0. 获取工具 schema（每种工具首次使用前必须做）
mcp_get_tool_description:
  toolRequests: [["recruit-mcp", "SearchAPI"], ["recruit-mcp", "CallAPI"], ["recruit-mcp", "CallDB"]]

# 1. 发现能力：不传 apiId，通过 query/domain/type/tags 搜索
mcp_call_tool:
  serverName: recruit-mcp
  toolName: SearchAPI
  arguments: { "query": "简历详情 面评 resume_id", "domain": "recruit", "type": "all" }

# 2. 获取详情：传入第 1 步返回的原始完整 apiId/queryId
mcp_call_tool:
  serverName: recruit-mcp
  toolName: SearchAPI
  arguments: { "apiId": "<从第1步原样复制的完整ID>" }

# 3. 执行调用：按第 2 步 schema 构造 params
mcp_call_tool:
  serverName: recruit-mcp
  toolName: CallAPI 或 CallDB
  arguments: { "apiId/queryId": "<原始完整ID>", "params": { "resume_id": "<resume_id>" } }
```

输出处理：

- 明确标注“招聘系统补充数据”
- 不展示手机号、证件号、家庭住址、完整面评原文等敏感信息
- 面评只摘要亮点 / 顾虑，不逐字引用负面评价
- 补充 MCP 不可用时，不阻断主查询，只说明补充信息暂不可用

### Step 4：计算派生字段

执行查询后，对结果做 [第 3 节风险识别规则](#3-风险识别规则) 的本地计算（可在 SQL 里算，也可以拿到结果后本地算），派生出：

- `mentor_bound`（导师是否已填写）
- `leader_bound`（直接上级是否已填写）
- `days_to_entry`（距预计入职天数）
- `risk_level`（风险等级：high / medium / low / lost）
- `todo_type`（待办类型）

### Step 5：按 [第 4 节输出规范](#4-输出规范) 呈现

### Step 6：失败与空结果处理

以下异常路径必须统一收口，禁止暴露错误栈、`staffId`、Token、Webhook、候选人敏感字段或编造兜底数据：

| 场景 | 处理方式 |
|---|---|
| 员工宽表查不到中文名 | 先尝试 `recruit_manager_name LIKE '%{loginName}%'` 模糊匹配；仍失败时提示“身份解析失败，请确认你在系统中的招聘经理名称格式，或联系管理员核对权限。” |
| 当前范围查询结果为空 | 说明“当前查询范围内暂无签约后候选人（已签 / 毁约）”，并提醒用户确认查询范围、招聘经理身份或数据权限 |
| hr-ai-data 调用失败 / 超时 | 不展示错误栈，回复“当前保温数据暂时不可用，建议稍后重试或联系管理员。” |
| zhaopin-mcp/recruit-mcp 调用失败 / 超时 | 不展示错误栈，回复“招聘系统补充数据暂不可用，我将基于数仓可见信息继续处理。” |
| 组织名解析 0 行 | 不继续拼 SQL；反问用户确认组织写法或补充 BG / 部门 / 中心层级 |
| 组织名解析多行且用户未确认 | 展示候选组织及人数，让用户选择；禁止一次性查多个不确定组织 |
| 链接字段为空或脱敏 | 告知“当前暂无可用链接，建议在招聘系统中直接查询”，不要展示 `***` 或空链接 |
| `lastest_flow_flag_name = '是'` 无匹配 | 告知最新流程标记缺失，建议到招聘系统确认，不要返回历史流程链接 |

---

## 2. 核心字段清单

主表：`catalog_dos_da_mcp.hrdw.Report_School_Recruiti_Info_List`

### 2.1 招聘经理识别与筛选必备

| 字段 | 含义 | 用法 |
|---|---|---|
| `recruit_manager_name` | 对接招聘经理（中英文名组合） | **必须**等于 `{loginName}({中文名})`，如 `'zhangsan(张三)'` |
| `recruit_year` | 招聘年份（毕业届次） | 首次确认；未指定/默认取当年 + 次年，支持单届或多届 `IN(...)` |
| `offer_staff_subtype_name` | 招聘类型（学生类型 / 员工子类型） | 取值 `毕业生` / `应届实习生` / `日常实习生`；首次确认，支持单选 / 多选 / 全部；过滤用 `{{RECRUIT_TYPE_FILTER}}`，展示用于"招聘类型"标签列 |
| `employ_candidate_tag_id` | 人选标签（高潜，数字ID） | 高潜识别主字段，权威取值 `12`=青云计划 / `1020`=青云实习 / `14`=销售培训生 / `1`=产品经理培训生，`0`或其他=普通；派生 `candidate_tag` 用于 ⭐高潜标记与优先保温，过滤用 `{{HIGH_POTENTIAL_FILTER}}` |

⚠️ 表中**没有** `recruit_manager_en` 字段，不要使用。

⚠️ 招聘类型字段名是 `offer_staff_subtype_name`，与场景 F"员工子类型"为同一字段；用于人群筛选与标签展示，取值只有"毕业生 / 应届实习生 / 日常实习生"三类。

### 2.2 候选人基础画像

| 字段 | 含义 |
|---|---|
| `resume_id` | 简历主键（去重主键） |
| `offer_id` | 录用单号 |
| `name` | 候选人姓名 |
| `sex` | 性别 |
| `highest_school` | 最高学历学校 |
| `highest_speciality` | 最高学历专业 |
| `highest_degree` | 最高学历层次 |
| `practice_exp` | 实习经历 |
| `employer_names` | 实习公司 |

⚠️ 候选人姓名字段是 `name`，不是 `candidate_name`。

### 2.3 组织与岗位

| 字段 | 含义 | 范围 ④ 用法 |
|---|---|---|
| `bg_name_cn` | 发起录用BG | 精确匹配，如 `= 'TEG'` |
| `line_name_cn` | 条线 | 精确匹配 |
| `dept_name_cn` | 发起录用部门 | 精确匹配；重名跨 BG 时叠加 `bg_name_cn` |
| `center_name_cn` | 发起录用中心 | 精确匹配 |
| `center_full_name` | 中心全路径 | LIKE 匹配片段 |
| `org_full_path` | 组织全路径ID | LIKE 匹配 ID 片段 |
| `org_full_name_cn` | 录用组织全路径 | LIKE 匹配中文片段，最细粒度 |
| `org_full_name_cn_fake` | 对应虚拟部门 | 用户明确说"虚拟组织"时使用 |
| `requirement_org_full_name` | 需求所属组织中文全路径 | 用户明确说"按需求归属"时使用 |
| `position_name_cn` | 职位 | 展示用 |
| `w_city` | 工作地 | 展示用 |

⚠️ 岗位字段是 `position_name_cn`，不是 `job_name`；工作地字段是 `w_city`，不是 `work_city`。

⚠️ 范围 ④ 的字段优先级、组织名验证 SQL 与 `{{ORG_FILTER}}` 构造，详见第 1.1 节"组织名解析"。

### 2.4 责任链（**本 skill 重点**）

| 字段 | 含义 | 保温重点 |
|---|---|---|
| `tutor_name_en` | 导师 | 为空 → 导师未填写 |
| `lead_name_en` | 直接上级 | 为空 → 上级未填写 |
| `leader_post_name` | 直接上级岗位 | 展示用 |

⚠️ 导师和上级字段分别只有 `tutor_name_en` 和 `lead_name_en`，表中**没有** `tutor_name_cn` 和 `lead_name_cn` 字段。字段名虽带 `_en` 后缀，但实际可能包含中英文混合信息，判断是否填写用 `IS NULL OR = ''` 即可。

### 2.5 状态与进展

| 字段 | 含义 | 保温重点 |
|---|---|---|
| `sign_status` | 签约状态 | **'已签' OR '毁约'** 是人选池范围 |
| `tripartite_status` | 三方状态 | '已签署' 为健康态 |
| `signed_time` | 已签时间 | |
| `third_party_sub_time` | 三方签约时间 | |
| `expect_entry_date` | 预计入职时间 | 计算距入职天数的基础 |
| `is_entry` | 是否正式入职 | '否' 为待入职 |
| `entry_status` | 入职状态 | '待入职' / '已入职' / '已毁约' |
| `entry_date` | 入职日期 | |
| `destroy_time` | 毁约时间 | |

### 2.6 风险反馈

| 字段 | 含义 |
|---|---|
| `suggestion` | 毁约/拒签原因 |
| `cm_feedback` | 最新反馈 |
| `cm_fb_result` | 拒签原因 |
| `cm_fb_remark` | 拒签原因备注 |

### 2.7 链接字段（返回链接时必用）

| 字段 | 含义 | 使用规则 |
|---|---|---|
| `lastest_flow_flag_name` | 是否当前最新流程 | **取链接必须以此字段 = `'是'` 为准**；同一 `resume_id` 可能存在多条历史流程记录，只有 `lastest_flow_flag_name = '是'` 那条的链接才是有效的当前链接 |
| `resume_link` | 简历链接 | `offer_link` 不可用时作为降级链接 |
| `offer_link` | 录用链接 | **优先返回**；若为空则降级到 `resume_link` |

⚠️ **链接返回规则**：
1. 先筛选 `lastest_flow_flag_name = '是'` 的记录
2. 优先返回 `offer_link`（录用链接更权威），若为空则返回 `resume_link`
3. 两者均为空或脱敏（`***`），告知用户"当前暂无可用链接，建议在招聘系统中直接查询"
4. 不在多人清单中批量展示链接，只针对特定候选人请求时返回
5. 链接返回后提醒用户"请在内网环境访问"

---

## 3. 风险识别规则

与 demo 前端 `dataLayer.js` 对齐，保持口径一致。

### 3.1 派生字段计算

```
mentor_bound            = tutor_name_en 不为空
leader_bound            = lead_name_en 不为空
days_to_entry           = DATEDIFF(expect_entry_date, CURDATE())
is_break_contract       = sign_status = '毁约'
is_signed_pool          = sign_status IN ('已签', '毁约')
```

### 3.2 风险等级 `risk_level`

按优先级从高到低判断，取第一个匹配项：

| 条件 | risk_level |
|---|---|
| `is_break_contract = true` | **lost**（已流失） |
| `cm_fb_result` 非空 或 `suggestion` 非空 | **high**（高风险） |
| `cm_feedback` 非空 | **medium**（中风险） |
| 距上次互动 ≥ 14 天 | **medium** |
| 其他 | **low**（正常） |

### 3.3 待办类型 `todo_type`

按优先级取第一个匹配项：

| 条件 | todo_type | 文案 |
|---|---|---|
| 已毁约 | `break_contract` | 已毁约 |
| `risk_level = high` | `urgent_followup` | 紧急跟进 |
| `mentor_bound = false` | `assign_mentor` | 待分配导师 |
| `leader_bound = false` | `confirm_leader` | 待确认上级 |
| 导师已绑但首次沟通未完成 | `first_contact` | 待首次沟通 |
| 首次沟通已完成但资料未发送 | `send_material` | 待发送资料 |
| `days_to_entry` 在 (0, 30] 区间 | `pre_entry` | 临近入职 |
| 其他 | `routine` | 日常跟进 |

---

## 4. 输出规范

场景 A 的查询结果**必须**按以下结构输出：

### 4.1 摘要卡（第一屏）

```
【你的保温清单】

👤 招聘经理：{中文名}（{英文名}）
🏷️ 查询人群：{查询范围} ｜ 🎓 届次 {recruit_year，如 2026+2027} ｜ 👨‍🎓 招聘类型 {毕业生 / 应届实习生 / 日常实习生 / 全部}
📊 签约后人选：{总数}（已签 {x} + 毁约 {y}）
⏰ 30 天内预计入职：{数量}

🔴 需要立即关注：
   • 未填写导师：{n} 人
   • 未确认直接上级：{n} 人
   • 高风险人选：{n} 人
```

⚠️ **标签行（第 2 行）为强制项**：必须把本次生效的「查询范围 / 毕业届次 / 招聘类型」作为标签主动呈现，让招聘经理一眼确认查询口径；招聘类型为"全部"时标注"全部类型"。

### 4.2 明细表（紧接摘要卡）

| 候选人 | 招聘类型 | 学校/专业 | 岗位/组织 | 预计入职 | 导师 | 上级 | 阶段 | 风险 |
|---|---|---|---|---|---|---|---|---|

- "招聘类型"列使用 `offer_staff_subtype_name`（毕业生 / 应届实习生 / 日常实习生），缺失时显示"—"
- 导师/上级列未填写显示 **❌ 未填写** ，填了显示字段值
- "阶段"列使用 `warming_stage` 派生值（签约 / 三方处理 / 导师绑定 / 首次沟通完成 / 资料发送 / 已入职 / 已毁约）
- "风险"列使用 `risk_level` 的中文标签（🔴 高 / 🟡 中 / 🟢 正常 / ⚫ 流失）
- 默认按 `days_to_entry` 升序，临近入职排最前
- 当查询的招聘类型为"全部/多类型"时，"招聘类型"列尤其重要，便于招聘经理区分毕业生与不同实习生的保温重点

### 4.3 "需要关注"清单（**强制**，末尾附上）

如用户明确要求做更深度的"毁约可能 / 重点关注 / 稳定签约"判断，可在基础清单之后追加 **V4 深度重点关注名单**：

- 仅基于当前会话已授权查询到的候选人执行 `scripts/analyze_candidate_attention_v4.py`
- 输出口径必须使用"关注建议 + 稳定签约识别"，**不要**说成毁约概率
- 建议仅展示：`关注优先级`、`主关注维度`、`稳定签约等级`、`推荐跟进行动`
- 多人结果默认只展示 `P1/P2` 人选和高稳定签约人选，避免把全量评分表直接贴给用户


```
⚠️ 这些人选建议你今天就跟进：

1. [未填导师] {候选人}（{学校} / {岗位}），预计 {入职日期} 入职
   → 建议：尽快在系统中为其指派导师，并同步介绍

2. [未确认上级] {候选人}（{岗位}），预计 {入职日期} 入职
   → 建议：与部门负责人对齐直接上级人选

3. [临近入职未建联] {候选人}，距入职仅 {n} 天
   → 建议：本周内至少一次 1v1 语音沟通
```

### 4.3.1 范围 ④ 专属：按子组织聚合小结（强制，仅范围 ④）

当查询范围为指定组织（含与 ① / ② / ③ 叠加）时，结果末尾在"需要关注"清单之后**追加**一段子组织分桶汇总，让招聘经理快速看到组织内的热点：

```
🏢 按子组织看保温热点（{父组织} 范围内）：

| 子组织 | 签约后人数 | 导师未填 | 上级未确认 | 30 天内入职 |
|---|---|---|---|---|
| {dept_name_cn 1} | {n} | {n} | {n} | {n} |
| {dept_name_cn 2} | ... | ... | ... | ... |
| ... | | | | |

🔝 最需要关注：{n 最高的部门}（导师未填 {x} 人，30 天内入职 {y} 人）
```

聚合规则：

- 父组织粒度为 BG → 按 `dept_name_cn` 分桶
- 父组织粒度为部门 → 按 `center_name_cn` 分桶
- 父组织粒度为中心 / 全路径 → 按 `org_full_name_cn` 末段分桶
- 子组织数 > 10 时仅保留 `Top 10`，剩余汇总为"其他 X 个子组织合计 ..."

### 4.4 下一步引导

结尾主动提供三个跟进入口（话术 / 单人画像 / 自动化提醒）：

> 需要我帮你给某位同学写一段保温话术吗？直接说"给 XXX 写欢迎话术"即可。
>
> 想看具体某个同学的详细画像，发我"查 XXX 的画像"。
>
> 不想每天手动来查？可以让 CodeBuddy 自动每天早上跑一次保温播报，直接对我说"让 CodeBuddy 每天早上 9 点自动跑一遍我名下的保温播报"，我会按场景 E 帮你创建自动化任务（如需推到企微群，再加一句"同步发到企微群"，会按场景 D 叠加发送）。

⚠️ 引导原则：
- 仅在查询结果有效（非空、非全脱敏、非失败）时输出该引导，避免在异常路径下推销自动化

### 4.5 链接返回规范（用户明确要求时触发）

**触发词**：`链接`、`给我链接`、`简历链接`、`录用链接`、`offer 链接`、`发我链接`

**执行步骤**：

1. 确认目标候选人（用户提名或从上一轮查询结果中指定）
2. 确认候选人处于当前用户有权限访问的范围内，或来自本会话上一轮已授权查询结果；无权限时拒绝返回链接
3. 调用 **`T_LINK` 专用 SQL**（见 `sql-templates.md`），**不使用通用 CTE**；直接以 `lastest_flow_flag_name = '是'` 过滤，保证链接来自当前最新流程
4. 按优先级返回：
   - `offer_link` 非空且非脱敏 → 优先返回录用链接
   - 仅 `resume_link` 非空且非脱敏 → 返回简历链接
   - 均为空 → 告知"当前暂无可用链接，建议在招聘系统中直接查询"
5. 输出格式：

```
📎 {候选人姓名} 的链接（当前最新流程）：

• 录用链接：{offer_link 或 暂无}
• 简历链接：{resume_link 或 暂无}

⚠️ 请在内网环境访问。
```

6. 若 `lastest_flow_flag_name = '是'` 的记录查不到，告知用户数据可能存在异常，引导到招聘系统确认
- 引导话术保持单段、轻量，不要展开 RRULE / `automation_update` 细节，等用户确认意图后再进入场景 E
- 若当前会话已经创建过保温自动化，仅做一句"已为你设置过保温自动化，需要调整频率请告诉我"，不重复推荐

---

## 5. 常见口径变体

场景 A 的请求往往不是"查全部"，需要识别以下常见变体并选择正确的 SQL 模板：

| 用户说法 | 意图 | 对应 SQL 模板 |
|---|---|---|
| 我名下有哪些待入职 | 全量列表 | T1_MY_PENDING |
| 导师还没填的有谁 | 仅筛选 `tutor_name_en` 为空 | T2_NO_MENTOR |
| 上级还没定的 | 仅筛选 `lead_name_en` 为空 | T3_NO_LEADER |
| 这周要入职的 / 5 月入职的 | 按 `expect_entry_date` 范围 | T4_BY_ENTRY_DATE |
| 已毁约的人 | `sign_status = '毁约'` | T5_DESTROYED |
| {某 BG / 某部门} 的 | 范围 ④，使用 `{{ORG_FILTER}}` | T8_BY_ORG |
| 按部门看保温热点 / 组织盘点 | 范围 ④，分桶聚合 | T9_ORG_KPI |
| {某学校 / 某专业} 的 | 增加画像筛选条件 | 在任意模板上加 WHERE |
| 只看毕业生 / 只看实习生 / 只看应届实习生 | 招聘类型筛选 | 任意模板填 `{{RECRUIT_TYPE_FILTER}}` |
| 2025 届的 / 2026 加 2027 届的 | 毕业届次筛选 | 任意模板调整 `{{RECRUIT_YEAR}}`（单届 `=` / 多届 `IN`） |
| 只看高潜 / 只看青云 / 只看产培生（产品经理培训生） | 高潜人选标签筛选 | 任意模板填 `{{HIGH_POTENTIAL_FILTER}}`（如 `AND employ_candidate_tag_id IN (12,1020,1)`） |
| 我名下 2026 届的毕业生 | 范围 + 届次 + 类型 三维叠加 | T1_MY_PENDING + `{{RECRUIT_YEAR}}` + `{{RECRUIT_TYPE_FILTER}}` |
| 查 XXX 的详情 | 单人画像，所有字段 | T6_ONE_CANDIDATE |
| 给我 XXX 的链接 / 简历链接 / 录用链接 | 返回当前最新流程的链接（`lastest_flow_flag_name = '是'`） | T_LINK |