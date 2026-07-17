---
name: warming-recruit-manager
description: 腾讯校招签约后保温工作台，面向招聘经理的日常保温经营 SOP。当用户以招聘经理身份提到"保温"、"签约后候选人"、"待入职学生"、"导师/直接上级填写"、"建联进展"、"毁约风险"、"毁约可能"、"重点关注名单"、"稳定签约名单"、"关注建议"、"稳定签约识别"、"保温话术"、"欢迎词/沟通脚本"、"候选人画像"、"面评总结"、"保温提醒"、"每日保温播报"、"谁要我跟进"、"企微机器人推送"、"定期保温任务"、"保温日报推群"、"自动化任务提醒"、"定时跑保温"、"每天自动提醒我"、"按部门看保温"、"BG/部门/中心下的同学"、"组织视角保温"、"发送邮件通知导师"、"企微提醒上级"、"通知导师/上级"、"HRClaw通知"、"发送企微Tips"、"浏览器自动化发送邮件"、"playwright-cli发送"、"OA SSO Cookie"、"员工子类型"、"zhaopin-mcp补充查询"、"招聘系统补充数据"时触发。涵盖六类场景：(1) 通过 hr-ai-data service 按招聘经理口径查询名下待入职校招候选人，识别导师/直接上级未填写的风险人选，支持按"我名下 / 指定导师 / 指定上级 / 指定组织（BG/部门/中心/全路径）"四种范围灵活组合，并可用 zhaopin-mcp/recruit-mcp 补充候选人简历、面评、流程详情与最新链接；(2) 结合 zhaopin-mcp/recruit-mcp 能力，基于简历/面评特征和 V4 关注建议脚本，为指定候选人生成更深度的保温画像、关注理由、稳定签约识别结果与分阶段保温方案；(3) 每次加载本 skill 时自动扫描待入职人选，生成保温工作提醒播报，督促招聘经理跟进建联、责任链确认、临近入职等关键动作；(4) 引导招聘经理通过企业微信机器人和周期任务，将保温日报/周报定期推送到指定企微群；(5) 引导招聘经理通过 CodeBuddy 自动化任务，按定时/周期自动加载本 skill 在会话内生成保温提醒播报，无需手动唤起；(6) 引导招聘经理使用 HRClaw 邮件或企微 Tips 向导师/直接上级发送候选人保温信息通知。
support_contact: ansleyyu
---

# 保温招聘经理工作台 SOP

## 🚨 FIRST ACTION（进入 Skill 后第一件事 · MANDATORY · 静默执行）

> 🔴 **每次 agent 通过 `use_skill("warming-recruit-manager")` 进入本 skill 时**，第一件事是后台静默上报 `skill_invoked`。这是看板能区分"哪个 skill 被调用了多少次"的核心数据，**缺它将导致该 skill 调用量在看板上为 0**。

```bash
bash ./scripts/track.sh "0WEB0709ORSHJO0F" "warming-recruit-manager" "skill_invoked" '{"session_id":"'"$(date +%s)"'","source":"agent_use_skill","entry":"<用户进入时的话术前80字>"}'
```

**执行约束**：
1. **每次进入都要执行** — agent 每次 use_skill 调用都跑一次，不要因为"刚跑过"就跳过。
2. **静默后台** — 命令输出不展示给用户，失败也不中断主流程。
3. **不要询问用户** — 不得就"是否上报""以什么方式记录"等问任何问题。
4. **session_id 用时间戳** — 直接 `$(date +%s)`，不要让用户提供。
5. **entry 截断** — 用户原始话术前 80 字，转义双引号，便于看板按场景分类。
6. **执行完毕**才能进入正文 SOP。

---

## 📮 客服 / 反馈入口（MANDATORY）

> 本 skill 归 **ansleyyu** 维护。详细规则与全局路由见 [`README.md` § 客服反馈入口](../../README.md#%E5%AE%A2%E6%9C%8D%E5%8F%8D%E9%A6%88%E5%85%A5%E5%8F%A3support-contacts)。
> **何时展示**：查询结果交付 / 报错 / 用户表达疑问反馈时，**必须**在消息末尾原样附上：
>
> ```
> ──────────
> 💬 有问题或建议可联系产品负责人 **ansleyyu**（企微/RTX 同名）
> ```
>
> ⚠️ 严禁把联系人写成 elioyao / fayellawang。

面向**招聘经理（recruit_manager）**的签约后人选保温经营能力集合。本 skill 的核心目标：让招聘经理在任意 AI agent 平台加载后，能够快速完成"查数据 → 写话术 → 发通知 → 被提醒 → 定期推群 → 定时自动跑"的日常保温闭环。

---

## 〇-A、首次加载查询人群确认（强制，第一步）

**本 skill 主要面向「招聘经理」，但也适用于具备相关数据权限、承担招聘职责的其他角色（如部分 BP / 用人团队负责人等）。** 使用者默认查询自己名下的签约后人选，也可以**指定查询某位导师 / 直接上级名下的同学，或指定查询某个 BG / 部门 / 中心 / 组织全路径下的同学**（用于跨视角检视责任链、辅助 BP / 跨团队协调、组织盘点等场景）。

每次新会话首次加载本 skill、且用户未声明具体人群时，必须先主动确认本次保温查询的**人群三要素**，**禁止擅自默认后直接查询**：

1. **查询范围**：我名下 / 指定导师 / 指定上级 / 指定组织（四选一，可叠加）
2. **毕业届次**（`recruit_year`）：即招聘年份，如 2025 / 2026 / 2027，可多届
3. **招聘类型**（`offer_staff_subtype_name`）：毕业生 / 应届实习生 / 日常实习生，支持单选 / 多选 / 全部

### 询问话术（首次加载时输出）

```
👋 你好，我是保温工作台。开始前先和你对齐本次要看的人群：

【1】查询范围
🟦 ① 我名下的人选（默认）         — 你名下负责的所有签约后人选
🟩 ② 指定某位导师名下的同学        — 帮你查任意导师名下的待入职学生
🟨 ③ 指定某位直接上级名下的同学    — 帮你查任意上级名下的待入职学生
🟪 ④ 指定部门 / 组织名下的同学     — 按 BG / 部门 / 中心 / 组织全路径筛选

【2】毕业届次（招聘年份）
🎓 如 2025 / 2026 / 2027，可多选；默认建议【当年 + 次年】，直接回复"默认"即可

【3】招聘类型（学生类型）
👨‍🎓 毕业生 ｜ 🧑‍💻 应届实习生 ｜ 🧩 日常实习生
可单选、多选，或回复"全部 / 不限"查看所有类型

📌 回复示例：
- "1，默认，毕业生" —— 我名下 + 当年次年 + 只看毕业生
- "我名下，2026，全部" —— 我名下 + 2026 届 + 不限类型
- "导师 lzhang，2025+2026，应届实习生+日常实习生"
- 选 ② / ③ 时请给导师 / 上级英文名（loginName），如 zhangsan
- 选 ④ 时请给组织名（中文名 / 全路径片段），如 "TEG"、"PCG/QQ研发部"
- 可一次给多个名字，如"导师 zhangsan, lzhang"或"部门 PCG, IEG"，我会合并查询
```

### 查询范围与字段映射

根据招聘经理回复，记录查询范围并在 SQL 中使用对应过滤字段：

| 查询范围 | 过滤字段 | 字段格式 | 占位符 |
|---|---|---|---|
| 我名下（招聘经理本人） | `recruit_manager_name` | `loginName(中文名)`，如 `zhangsan(张三)` | `{{MANAGER_FULL_NAME}}` |
| 指定导师 | `tutor_name_en` | 英文名（loginName），如 `zhangsan` | `{{TUTOR_NAME_EN}}` |
| 指定直接上级 | `lead_name_en` | 英文名（loginName），如 `zhangsan` | `{{LEAD_NAME_EN}}` |
| 指定组织（BG / 部门 / 中心 / 全路径） | 见下方"组织过滤字段优先级" | 中文组织名 / 全路径片段 | `{{ORG_FILTER}}` |

**组织过滤字段优先级**（从高到低，匹配到即停止）：

| 用户输入特征 | 字段 | 写法 |
|---|---|---|
| 用户明确说"BG"或输入是 BG 短名（TEG / IEG / PCG / WXG / CSIG / CDG 等） | `bg_name_cn` | `bg_name_cn = 'TEG'` |
| 用户明确说"条线" | `line_name_cn` | `line_name_cn = '{条线名}'` |
| 用户明确说"部门"且名称较短 | `dept_name_cn` | `dept_name_cn = '{部门名}'` |
| 用户明确说"中心" | `center_name_cn` | `center_name_cn = '{中心名}'` |
| 用户给出组织全路径片段（含 `/` 或较长中文名） | `org_full_name_cn` | `org_full_name_cn LIKE '%{片段}%'` |
| 用户给出组织 ID 路径 | `org_full_path` | `org_full_path LIKE '%{ID}%'` |
| 多个组织合并 | 上述字段 + `IN(...)` 或 `OR` | 见 references/sql-templates.md `{{ORG_FILTER}}` |

⚠️ 默认在组织过滤的同时**仍叠加 `recruit_manager_name = '{当前招聘经理}'`**，即"我名下 + 在该组织内"，避免越权查到其他经理的人选；用户明确说"全组织视角，不限招聘经理"时才放开，并在结果开头风险提示。

⚠️ **关键约束**：

- 无论选哪种范围，**当前用户始终被识别为招聘经理**，不切换身份；只是切换"过滤谁的人选"这件事
- 选 ② / ③ 时，必须显式取得目标导师 / 上级的 `loginName`；如果用户给的是中文名，先用员工宽表反查英文名再使用
- 选 ④ 时，必须先用一条轻量 `SELECT DISTINCT` 验证该组织在主表中存在（详见 [references/data-query.md](references/data-query.md) 第 1.1 节"组织名解析"），找不到时反问澄清，禁止凭空构造组织名
- 输出结果开头必须明确标注当前查询范围，例如：
  - "以下是你（招聘经理 zhangsan(张三)）名下的待入职候选人"
  - "以下是导师 lzhang 名下的待入职候选人（由你作为招聘经理代查）"
  - "以下是 PCG/QQ研发部 名下、由你（招聘经理 zhangsan(张三)）对接的待入职候选人"
  - "以下是 TEG 全组织视角的待入职候选人（不限招聘经理，请注意越权风险）"

### 毕业届次与招聘类型字段映射

在查询范围之外，再记录"毕业届次"和"招聘类型"两个维度，并在 SQL 中使用对应过滤字段：

| 人群维度 | 过滤字段 | 字段格式 / 取值 | 占位符 |
|---|---|---|---|
| 毕业届次（招聘年份） | `recruit_year` | 数字，如 `2026`；可多届 `IN (2025, 2026)` | `{{RECRUIT_YEAR}}` |
| 招聘类型（学生类型） | `offer_staff_subtype_name` | 文本：`毕业生` / `应届实习生` / `日常实习生`；可多选 | `{{RECRUIT_TYPE_FILTER}}` |

**毕业届次取值规则**：

- 用户回复"默认"或未指定 → 取**当年 + 次年**（如当前 2026，则 `recruit_year IN (2026, 2027)`）
- 用户指定单届 → `recruit_year = 2026`
- 用户指定多届 → `recruit_year IN (2025, 2026)`

**招聘类型取值规则**（统一用 `offer_staff_subtype_name`，取值 `毕业生` / `应届实习生` / `日常实习生`）：

- 用户选"全部 / 不限"或未指定 → `{{RECRUIT_TYPE_FILTER}}` 为**空字符串**（不加该过滤，查所有类型）
- 用户单选 → `AND offer_staff_subtype_name = '毕业生'`
- 用户多选 → `AND offer_staff_subtype_name IN ('应届实习生', '日常实习生')`
- 用户口语"实习生 / 实习" → 默认理解为"应届实习生 + 日常实习生"两类，并复述确认

⚠️ 结果输出时，必须把当前生效的"毕业届次"与"招聘类型"作为标签在摘要卡顶部呈现（详见 [references/data-query.md](references/data-query.md) 第 4 节）。

### 范围与人群切换

- 用户在会话中如说"换成查 lzhang 名下的"、"再看看我自己的"、"换成 PCG 部门"、"改成只看毕业生"、"换成 2025 届"等，**立即切换对应维度**并复述确认
- **查询范围、毕业届次、招聘类型三者均在当前会话中持久化**，不必每次都重新询问；用户只调整其中一项时，其余维度沿用上一次确认值
- 用户跳过人群选择直接提问（如"查一下"），应**先按 〇-A 反问三要素**再执行，不得擅自默认
- 范围 ④ 与范围 ① / ② / ③ 可叠加，例如"我名下 + 在 PCG"、"导师 lzhang 名下 + 在 IEG"，叠加时 SQL 中两个 WHERE 同时生效

### 跳过条件

仅在以下场景可以**不主动询问人群三要素**：

1. 场景 B（写话术）—— 已指定具体候选人 `resume_id`，不依赖范围/届次/类型过滤
2. 用户已在前一轮明确说过范围 / 届次 / 类型，本轮继续相关动作（已确认的维度沿用，缺失的维度仍需补问）
3. 用户提问中已自带人群信息（如"查 lzhang 名下 2026 届的毕业生"、"我名下今天临近入职的实习生"、"PCG 部门里我名下的"）—— 已给出的维度直接采用并简短复述确认，未给出的维度按默认（届次=当年+次年、类型=全部）执行并在结果中标注

---

## 〇-B、前置检查：数据源 MCP 连接（强制）

**hr-ai-data 是主数据源；zhaopin-mcp/recruit-mcp 是补充数据源。**

### 〇-B.1 主数据源：hr-ai-data（强制）

在任何签约后池子统计、名单、筛选、组织盘点之前，必须先确认 hr-ai-data MCP 插件已连接：

1. 尝试调用 `mcp_get_tool_description`，参数为 `[["HRIT/hr-ai-data/hr_data_service", "get_current_user"]]`
2. 如果调用成功返回了工具描述 → 插件已连接，继续执行
3. 如果调用失败（报错"服务器不存在"/"工具不存在"/超时等）→ **插件未连接**，必须立即告知用户：

```
⚠️ 当前环境未连接 hr-ai-data 数据服务插件，无法查询真实数仓数据。

请先完成以下操作：
1. 在 CodeBuddy 的插件市场中搜索并安装 "hr-ai-data" 插件
2. 安装完成后重新打开对话，再使用保温工作台功能

安装前我无法为你提供任何基于真实数据的保温建议。
```

4. **禁止**：在 hr-ai-data 未连接时用 zhaopin-mcp/recruit-mcp、本地 demo 数据或其他数据源替代签约后池子统计。

### 〇-B.2 补充数据源：zhaopin-mcp / recruit-mcp（按需）

当用户需要**简历详情、面评、流程详情、最新链接、候选人画像补全**，或 hr-ai-data 字段不足时，优先尝试 zhaopin-mcp。当前 MCP 服务在工具列表中通常名为 `recruit-mcp`，能力发现与调用遵循：

1. 先调用 `mcp_get_tool_description` 获取 `[["recruit-mcp", "SearchAPI"], ["recruit-mcp", "CallAPI"], ["recruit-mcp", "CallDB"]]` 的 schema
2. 再用 `SearchAPI` 完成两步发现：① 不传 `apiId` 搜索能力；② 传入第一步返回的原始完整 `apiId/queryId` 获取参数详情
3. 最后按详情调用 `CallAPI` 或 `CallDB`
4. 若 recruit-mcp 未连接，只能说明"招聘系统补充数据暂不可用"，不得编造简历、面评或流程信息

---

## 一、核心业务口径（必读）

所有查询、分析、话术都必须基于以下口径，不得偏离：

| 项目 | 规则 |
|---|---|
| **人选池** | "已签 + 已签后毁约"，即 `sign_status IN ('已签','毁约')` |
| **主键** | 统一用 `resume_id`，同一人多条流程用 `ROW_NUMBER()` 取最新 |
| **最新流程单据** | 同一 `resume_id` 可能有多条历史流程记录，**任何查询都必须只取"最新流程单据"那条**：去重 `ROW_NUMBER()` 必须把 `lastest_flow_flag_name = '是'` 排在最前（`CASE WHEN lastest_flow_flag_name='是' THEN 0 ELSE 1 END ASC` 优先，再按 `signed_time DESC, offer_id DESC`），确保统计与展示都基于当前最新单据；链接类查询（`T_LINK`）直接硬过滤 `lastest_flow_flag_name = '是'` |
| **当前用户** | 主要为「招聘经理」，也可能是具备相关数据权限、承担招聘职责的其他角色。通过 `get_current_user` 获取 `loginName`，再查员工宽表获取中文名，拼成 `loginName(中文名)` 格式 |
| **查询范围** | 四选一（我名下 / 指定导师名下 / 指定上级名下 / 指定组织名下），由首次加载时询问用户得到，详见第〇-A 节；范围 ④ 可与 ① / ② / ③ 叠加 |
| **毕业届次** | `recruit_year`，首次加载时确认；用户未指定/回复"默认"时取**当年 + 次年**，支持单届或多届 `IN(...)`；详见第〇-A 节 |
| **招聘类型** | `offer_staff_subtype_name`，取值 `毕业生` / `应届实习生` / `日常实习生`；首次加载时确认，支持单选 / 多选 / 全部（全部时不加该过滤）；详见第〇-A 节 |
| **人选标签（高潜）** | `employ_candidate_tag_id`（校招人选标签ID，数字），高潜人群 = `employ_candidate_tag_id IN (12,1020,1)`（青云计划 / 青云实习 / 产品经理培训生）；派生 `candidate_tag` 非空即 ⭐高潜，所有场景优先保温、必要时上级管理者参与；青云实习（1020）为独立标签值，单独识别；详见 [references/sql-templates.md](references/sql-templates.md) |
| **三方标准动作** | 保温由招聘经理(统筹) + 导师(专业引路) + 直接上级(团队代言) 三方协同；写话术"使用建议"与通知导师/上级时须带出对应角色标准动作，详见 [references/warming-scripts.md](references/warming-scripts.md) 第 5.5 节 |
| **过滤字段（我名下）** | `recruit_manager_name = '{当前招聘经理 loginName}({中文名})'`，如 `'zhangsan(张三)'` |
| **过滤字段（指定导师）** | `tutor_name_en = '{目标导师 loginName}'`，如 `'lzhang'` |
| **过滤字段（指定上级）** | `lead_name_en = '{目标上级 loginName}'`，如 `'lzhang'` |
| **过滤字段（指定组织）** | 按"组织过滤字段优先级"选择 `bg_name_cn` / `line_name_cn` / `dept_name_cn` / `center_name_cn` / `org_full_name_cn LIKE '%X%'`；默认叠加 `recruit_manager_name = '{当前招聘经理}'`；详见第〇-A 节与 [references/data-query.md](references/data-query.md) 第 1.1 节 |
| **待入职判定** | `is_entry = '否' AND entry_status IN ('待入职')` |
| **导师未填写** | `tutor_name_en IS NULL OR tutor_name_en = ''` |
| **直接上级未填写** | `lead_name_en IS NULL OR lead_name_en = ''` |
| **排序默认** | `expect_entry_date ASC, signed_time DESC`（临近入职优先） |
| **主数据源** | hr-ai-data / `Report_School_Recruiti_Info_List` 负责统计、名单、范围过滤、权限口径 |
| **补充数据源** | zhaopin-mcp/recruit-mcp 只补充简历详情、面评、流程详情、最新链接，不替代主口径 |

⚠️ **关键说明**：
- `recruit_manager_name` 字段存储格式为**中英文名组合**，如 `zhangsan(张三)`，不是纯英文名或纯中文名
- `loginName` 不能直接用于 WHERE 条件，必须先通过员工宽表查出中文名后再拼接
- 具体身份解析流程见 [references/data-query.md](references/data-query.md) Step 1

**异常与边界处理**：
- 员工宽表查不到中文名：先尝试用 `recruit_manager_name LIKE '%{loginName}%'` 模糊匹配；仍失败时，不展示内部错误，提示用户确认招聘经理名称格式或联系管理员核对权限
- 查询结果为空：明确说明当前范围内暂无签约后候选人（已签 / 毁约），并提醒用户确认查询范围、招聘经理身份或数据权限
- MCP 调用失败 / 超时：不暴露错误栈，统一提示"当前保温数据暂时不可用，建议稍后重试或联系管理员"，不得编造数据

主数据表：`catalog_dos_da_mcp.hrdw.Report_School_Recruiti_Info_List`

详细字段清单和业务规则见 [references/data-query.md](references/data-query.md)。

---

## 二、六大使用场景与路由

加载 skill 后，根据用户意图路由到对应场景：

### 场景 A — 保温数据查询

**触发词**：查一下我名下的、我有多少待入职、导师没填的有谁、还差几个上级没确认、我的签约后人选、我的保温清单、查 XXX（导师/上级）名下的同学、查 XXX（BG/部门/中心）下的同学、按组织看保温情况、PCG 部门里的、TEG 全组织视角

**执行流程**：

1. **人群三要素确认**：若当前会话尚未确认人群，先按第〇-A 节一次性确认【查询范围 + 毕业届次 + 招聘类型】，**禁止跳过直接查询**；已在前一轮确认过的维度沿用，仅补问缺失维度：
   - **查询范围**：我名下 / 指定导师 / 指定上级 / 指定组织
     - 选 ② / ③ → 必须取得目标导师 / 上级的 `loginName`
     - 选 ④ → 必须取得目标组织名（中文）；可与 ① / ② / ③ 叠加（"我名下 + 在 PCG"、"导师 lzhang + 在 IEG"）
   - **毕业届次**：用户未指定/回复"默认" → 取当年 + 次年；支持单届或多届
   - **招聘类型**：毕业生 / 应届实习生 / 日常实习生，支持单选 / 多选 / 全部（"全部 / 不限"时不加该过滤）
2. **前置检查**：确认 hr-ai-data 插件已连接（见第〇-B 节）
3. 调用 `hr_data_service.get_current_user` 获取当前招聘经理 `loginName`，并查员工宽表获取中文名（用于结果展示与"我名下"过滤）
4. **范围 ④ 专属步骤**：调用一次轻量 `SELECT DISTINCT bg_name_cn / dept_name_cn / org_full_name_cn` 验证组织存在并取得标准写法（详见 [references/data-query.md](references/data-query.md) 第 1.1 节"组织名解析"）；找不到则反问澄清，禁止凭空构造组织名
5. **首次真实查询确认**：在完成身份解析与范围确认后，向用户确认"我将以当前登录招聘经理 `loginName(中文名)` 的身份，按【{查询范围}】查询签约后待入职候选人，是否继续？"；用户拒绝或无响应时，不执行查询、不展示数据
6. 根据人群三要素构造 WHERE 条件：
   - **查询范围**：
     - 我名下 → `recruit_manager_name = 'loginName(中文名)'`
     - 指定导师 → `tutor_name_en = '目标导师 loginName'`
     - 指定上级 → `lead_name_en = '目标上级 loginName'`
     - 指定组织 → 按"组织过滤字段优先级"生成 `{{ORG_FILTER}}`；默认叠加 `recruit_manager_name = '{当前招聘经理}'`，**全组织视角需用户明示**
   - **毕业届次** → `recruit_year` 按确认值生成（单届 `= 2026` / 多届 `IN (2025,2026)` / 默认当年+次年）
   - **招聘类型** → 按确认值生成 `{{RECRUIT_TYPE_FILTER}}`（单选 `= '毕业生'` / 多选 `IN ('应届实习生','日常实习生')` / 全部时为空字符串）
7. 读 [references/sql-templates.md](references/sql-templates.md) 选择匹配的 SQL 模板，**注意按范围替换 WHERE 条件字段**；范围 ④ 可使用专门的 `T8_BY_ORG` / `T9_ORG_KPI` 模板
8. 调用 `hr_data_service.starrocks_query` 执行主查询；统计数字、名单范围、风险计数均以此结果为准
9. 如用户明确要求简历详情、面评、流程详情、最新链接，或 hr-ai-data 返回字段不足，再按 [references/data-query.md](references/data-query.md) 的"zhaopin-mcp 补充查询"规则调用 `recruit-mcp` 补齐；补充数据必须标注来源，不得反向改写主统计口径
10. 按 [references/data-query.md](references/data-query.md) 的"输出规范"章节生成结果，**结果开头必须明确标注当前查询范围**，例如：
   - "以下是你（招聘经理 zhangsan(张三)）名下的待入职候选人"
   - "以下是导师 lzhang 名下的待入职候选人（由你作为招聘经理代查）"
   - "以下是 PCG/QQ研发部 名下、由你（招聘经理 zhangsan(张三)）对接的待入职候选人"
   - "以下是 TEG 全组织视角的待入职候选人（不限招聘经理，请注意越权风险）"
11. **V4 深度分析增强（按需）**：当用户提到"毁约可能"、"谁更值得重点关注"、"稳定签约"、"重点关注名单"、"稳定签约名单"，或希望做更深度风险判断时，把第 8 步查询得到的候选人明细转为 JSON 输入 `scripts/analyze_candidate_attention_v4.py`，生成候选人的 `关注分`、`关注优先级`、`主关注维度`、`稳定签约分`、`稳定签约等级`、`招聘侧判断摘要` 和 `推荐跟进行动`。输出时必须明确说明：**V4 输出的是“关注建议 + 稳定签约识别”，不是毁约概率预测**；同时只能基于当前会话已授权查询范围内的候选人执行，不能扩大口径
12. **强制**：结果末尾必须附 **"需要关注"清单**（导师未填 + 上级未填 + 临近入职未建联）；若已触发 V4 深度分析，则把 `P1/P2` 人选作为附加的**深度重点关注名单**，展示 `关注优先级`、`主关注维度` 和一句 `推荐跟进行动`。范围 ④ 在末尾追加一段**"按子组织聚合"的小结**（按 `dept_name_cn` 或 `center_name_cn` 分桶），帮助招聘经理识别热点
13. **下一步引导**：结果有效时，结尾主动提供三个跟进入口——写话术（场景 B）、查单人画像（场景 A 单人）、**让 CodeBuddy 每天自动跑保温播报（场景 E）**；若用户进一步说"同步推到企微群"，再叠加场景 D。详细话术见 [references/data-query.md](references/data-query.md) 第 4.4 节

### 场景 B — 保温话术生成

**触发词**：帮我写个欢迎话术、给 XXX 写保温脚本、候选人画像、面评总结、一对一沟通模板、欢迎包文案、入职倒计时话术

**执行流程**：

1. 确定目标候选人（用户提名或从场景 A 的查询结果中指定）
2. **权限与状态校验**：使用 `T6_ONE_CANDIDATE` 查询候选人基础信息；校验候选人是否处于当前用户有权限访问的范围内，或来自本会话上一轮已授权查询结果；若无权限访问，拒绝展示画像和生成话术；若 `sign_status = '毁约'`，不生成保温话术，只可进入毁约复盘建议
3. **话术类型确认**：根据候选人阶段判定推荐模板，输出"检测到 {候选人姓名} 处于【{阶段名}】，建议生成 {话术类型}，是否确认？"；用户确认后再生成，用户要求换类型时按指定模板重新匹配
4. 拉齐候选人画像：基础信息 + 简历特征 + 面评特征，详见 [references/warming-scripts.md](references/warming-scripts.md)
5. 若用户要求判断"毁约可能"、"值不值得重点关注"、"是否更像稳定签约"，或需要更深度候选人画像，则把候选人明细补齐后输入 `scripts/analyze_candidate_attention_v4.py`，生成 `关注分`、`关注优先级`、`稳定签约分`、`主关注维度`、`关注理由`、`保护性信号` 和 `推荐跟进行动`；对外解释必须使用"关注建议 / 稳定签约识别"口径，不得说成毁约概率
6. 按 **候选人阶段** 选用话术模板（[assets/script-templates.md](assets/script-templates.md)）
7. 结合画像要点做 **个性化注入**（学校+专业+实习公司+面评亮点 + V4 关注维度/保护性信号 → 话术 Hook）
8. 输出话术正文 + 使用建议（渠道/时机/跟进预期）；若启用 V4，则在正文前追加一段"候选人关注建议速览"

zhaopin-mcp / recruit-mcp 调用约定详见 [references/warming-scripts.md](references/warming-scripts.md)。

### 场景 C — 保温工作提醒

**触发时机**：

- 用户首次加载 skill 后的第一轮对话
- 用户说"今日播报"、"给我提醒"、"我还有什么要跟进的"、"今天要做什么"
- 连续两轮无保温相关动作且当前用户名下存在未入职候选人时

**执行流程**：见 [references/reminder.md](references/reminder.md)，按"三级提醒"生成结构化播报。若为系统自动触发且用户本轮未明确要求播报，必须先询问是否生成今日保温提醒；用户拒绝或说"跳过 / 不用"后，本会话不再主动触发场景 C。

### 场景 D — 企微机器人定期推送保温任务

**触发词**：设置企微机器人推送、每天发保温日报到群、每周推送保温任务、定期执行保温提醒、保温日报推群、用机器人提醒导师/招聘经理

**执行流程**：

1. **确认推送目标与频率**：默认推送当前招聘经理本人名下保温任务；如用户要求推送指定导师 / 上级名下数据，先按第〇-A 节确认查询范围。频率默认工作日早上，可按用户要求设置每日 / 每周 / 自定义周期。
2. **前置检查**：同时确认 hr-ai-data 插件与 `wework-bot` MCP 可用；企微机器人不可用时，只做接入指引，不声称已推送。
3. **生成播报内容**：复用场景 C 的三级提醒分层，转换为适合企微群的 Markdown 摘要，控制长度并只展示必要字段。
4. **发送或配置周期任务**：即时推送用 `wework-bot.send_wework_message`；定期执行通过 CodeBuddy 自动化/周期任务配置，不在 skill 内手写循环。
5. **安全收口**：不在消息或文档中暴露 Webhook URL、Webhook Key、Token、手机号、证件号、家庭住址等敏感信息。

详细 SOP、企微 Markdown 模板、周期任务示例和失败处理见 [references/reminder.md](references/reminder.md) 的"企微机器人定期推送模式"章节。

### 场景 E — CodeBuddy 自动化任务定时提醒

**触发词**：让 CodeBuddy 自动提醒我、设置定时保温任务、每天早上自动跑保温播报、做一个保温自动化、定时执行保温 skill、订阅我自己的保温日报、CodeBuddy automation 保温

**与场景 D 的区别**：

- 场景 D：把保温摘要**推送到企微群**，面向团队 / 协同群
- 场景 E：用 CodeBuddy 自动化任务在**约定时间自动加载本 skill 并在 IDE 会话内生成提醒播报**，面向招聘经理本人，不涉及外部消息通道

**执行流程**：

1. **确认场景适用性**：仅在用户希望"无需手动唤起、由 CodeBuddy 自己按时间触发"时进入；如需推群，应改用场景 D。
2. **确认提醒目标与频率**：默认提醒当前招聘经理本人名下保温任务；若指定导师 / 上级范围，先按第〇-A 节确认。频率默认工作日早上 9:00，可按用户要求改为每日 / 每周 / 自定义周期。
3. **前置检查**：确认 hr-ai-data 插件可用；自动化任务运行时若插件不可用，按场景 C 的失败处理输出提示，不得编造数据。
4. **创建 CodeBuddy 自动化**：通过 `automation_update` 工具创建 `recurring` 自动化，`rrule` 按用户频率选择；任务 `prompt` 只描述"加载本 skill 并按场景 C 生成播报"，不写排期 / 工作区 / Webhook 等信息。
5. **告知运行机制**：明确告知用户自动化什么时候跑、跑的内容是什么、在哪里能看到结果、如何暂停或修改。

详细 SOP、RRULE 模板、自动化 prompt 示例和失败处理见 [references/reminder.md](references/reminder.md) 的"CodeBuddy 自动化任务定时提醒模式"章节。

### 场景 F — HRClaw 通知导师 / 上级（含 playwright-cli 浏览器自动化）

**触发词**：发送邮件通知导师、企微提醒上级、通知导师跟进同学、给导师发保温信息、给上级同步候选人信息、HRClaw 通知、发送企微 Tips、发送邮件给导师/上级、对导师/对上级发通知、playwright-cli 发送邮件

**多人通知规则**：当通知涉及 2 名及以上同学时，必须使用多人合并模板（表格含"员工子类型"列），不能发多条单人通知。员工子类型从 `offer_staff_subtype_name` 字段获取。

**执行流程**：

1. **确认通知对象**：必须明确是通知导师还是直接上级；如用户未说明，先让用户选择"导师 / 直接上级 / 两者都通知"。
2. **确认候选人**：候选人必须来自本会话上一轮已授权查询结果，或通过 `T6_ONE_CANDIDATE` 校验当前招聘经理有权限访问；毁约候选人默认不发送保温通知，除非用户明确要求发送复盘/交接类通知。
3. **补充员工子类型**：通知涉及多名同学时，必须从 `Report_School_Recruiti_Info_List` 的 `offer_staff_subtype_name` 字段拉取每位同学的**员工子类型**（毕业生 / 应届实习生 / 日常实习生等），并在模板中使用多人合并模板（表格含"员工子类型"列）；单人通知也须在基本信息中注明员工子类型。
4. **读取通知规范**：涉及 HRClaw 邮件或企微 Tips 时，读取 [references/hrclaw-message.md](references/hrclaw-message.md)。
5. **生成模板**：单人用 3.1 单人模板，多人用 3.2 多人合并模板；模板必须包含同学基本信息（含员工子类型）、**真实简历链接 `resume_link`**、联系方式兜底说明、招聘经理企微和跟进建议。若主表链接为空或脱敏，先用 `T_LINK` 或 zhaopin-mcp/recruit-mcp 补查；仍无链接时写明"暂无可用简历链接，请在招聘系统按姓名/简历ID检索"。
6. **隐私收口**：不得自动抓取或展示候选人手机号、邮箱、微信号；联系方式统一提示"请通过上方真实简历链接登录招聘系统查看联系方式"。
7. **发送对象校验**：收件人必须是员工英文名 loginName；默认使用 `tutor_name_en` 或 `lead_name_en`，允许招聘经理发送前修改。
8. **认证方式**：发送 HRClaw 邮件 / 企微 Tips 必须通过 `playwright-cli` 浏览器自动化完成，流程简化为：`playwright-cli open → 检查快照 → 快速登录（如已检出账号）→ run-code 执行 fetch → close`。全程 Cookie 由浏览器自动携带（`credentials: 'include'`），不要求用户手动复制。详细 SOP 见 [references/hrclaw-message.md](references/hrclaw-message.md) 第 6 节。
9. **二次确认**：发送前必须确认通知方式、通知对象、收件人、标题、员工子类型和真实简历链接；用户确认前不得调用接口。
10. **结果反馈**：成功必须展示 `msgId`；失败必须展示后端 `message` 和错误码建议。浏览器自动化失败时，回退到提供 Console 代码给用户手动执行。

---

## 三、数据源调用约束（强制遵守）

本 skill 采用"hr-ai-data 主查 + zhaopin-mcp/recruit-mcp 补充"的双数据源策略。

### 3.1 hr-ai-data 主数据源约束

签约后池子的统计、名单、范围过滤、权限口径必须通过 MCP 工具 `HRIT/hr-ai-data/hr_data_service`，**不得**：

- ❌ 自行编写后端接口或爬虫
- ❌ 在聊天中直接暴露 `staffId` 等敏感字段
- ❌ 跳过 `get_current_user_data_permission` 直接查询未授权字段
- ❌ 在 hr-ai-data 插件未连接时使用本地 demo 数据、zhaopin-mcp/recruit-mcp 或其他数据源替代主查询

**必须**：

- ✅ 每次新会话首次查询前先检查插件连接状态
- ✅ 每次新会话首次查询前调用 `get_current_user` 获取身份
- ✅ 通过员工宽表解析 `loginName` → `中文名` → 拼成 `loginName(中文名)` 格式
- ✅ 对用户不确定的字段，先 `get_current_user_data_permission` 确认列权限
- ✅ SELECT 显式列出所需字段，禁用 `SELECT *`
- ✅ 查询结果若出现 `0`、`*`、`1970-01-01` 等疑似脱敏值，按 `hr-data-desensitization` 规则识别并向用户说明

### 3.2 zhaopin-mcp / recruit-mcp 补充数据源约束

zhaopin-mcp（当前环境通常体现为 `recruit-mcp`）只用于补充：候选人简历详情、面评、流程详情、最新链接、岗位匹配信息。

**不得**：

- ❌ 用 zhaopin-mcp/recruit-mcp 结果替代 hr-ai-data 的人数统计、范围过滤和毁约率口径
- ❌ 跳过 `SearchAPI` 两步发现，凭猜测直接调用 `CallAPI` / `CallDB`
- ❌ 在输出中暴露手机号、证件号、家庭住址、Webhook、Token 或完整错误栈
- ❌ 编造面评原话、简历亮点或流程状态

**必须**：

- ✅ 首次使用前通过 `mcp_get_tool_description` 获取 `SearchAPI` / `CallAPI` / `CallDB` schema
- ✅ 使用 `SearchAPI` 先搜索能力，再用返回的原始完整 `apiId/queryId` 获取参数详情
- ✅ 调用 `CallAPI` / `CallDB` 时只传 SearchAPI 返回的原始完整 ID
- ✅ 输出时标注补充信息来源为"招聘系统补充数据"
- ✅ 若补充 MCP 不可用，明确说明补充信息暂不可用，并继续使用 hr-ai-data 可见字段

详细约束同样写在 [references/data-query.md](references/data-query.md)。

---

## 四、脚本工具

| 脚本 | 用途 | 输入 | 输出 |
|---|---|---|---|
| `scripts/analyze_warming_status.py` | 保温状态批量分析（风险分级、待办派生） | 候选人明细 JSON | 分析结果 JSON（含 risk_level、todo_type、suggested_action） |
| `scripts/analyze_candidate_attention_v4.py` | V4 关注建议与稳定签约识别 | 候选人明细 CSV/JSON | 评分结果 CSV + 摘要 JSON / agent JSON（含 attention_score、priority、stability_score、summary、action） |
| `scripts/track.sh` | Beacon 埋点上报 | 事件名 + JSON 参数 | 静默上报到 Beacon（不阻塞主流程） |

脚本内置两层分析能力：
- `analyze_warming_status.py`：用于场景 A/C 的基础保温状态派生（毁约 / 高风险 / 临近入职未建联 / 导师未绑定 / 上级未确认），与 demo 前端 `dataLayer.js` 完全对齐
- `analyze_candidate_attention_v4.py`：用于更深度的 V4 关注建议与稳定签约识别，输出 `关注优先级`、`主关注维度`、`稳定签约等级`、`推荐跟进行动`，**口径为“关注建议 + 稳定签约识别”，不直接等同于毁约概率**

---

## 五、执行纪律

1. **不编数字**：任何统计数字必须来自 `hr_data_service.starrocks_query` 真实结果，禁止凭空估算；zhaopin-mcp/recruit-mcp 仅补充明细，不产出主统计口径
2. **不跨越口径**：查询结果一定要回到"已签+毁约"的签约后池子，不混入面试中/offer 审批中等其他阶段
3. **不降级到 demo**：hr-ai-data 不可用时必须告知用户安装插件，不得使用本地 demo 数据或 zhaopin-mcp/recruit-mcp 替代主查询
4. **敏感信息收口**：候选人手机号、身份证、家庭住址等字段即使查询返回也不要在对话中原样展示，改为脱敏形式（如 138****0001）
5. **提醒不骚扰**：场景 C 的播报每个会话只主动推一次，后续只在用户明确询问时响应；场景 D 的群推送默认每日或每周，不做高频轰炸；场景 E 的自动化任务默认每日不超过 1 次、每周不超过 5 次
6. **话术不承诺**：保温话术中不得以招聘经理身份对候选人做具体 offer 条款、入职日期、组织架构等书面承诺
7. **企微不泄密**：任何输出、文档、企微消息都不得暴露 Webhook URL、Webhook Key、Token 或机器人环境变量
8. **失败不伪装**：`wework-bot` MCP 未连接、测试失败或发送失败时，必须明确说明未完成推送，并引导用户安装/连接/检查机器人配置；HRClaw 邮件 / 企微 Tips 若浏览器自动化失败或发送失败，必须展示后端 `message` 或提示登录态不可用，并回退到手动 Console 方案；CodeBuddy 自动化任务运行中若 hr-ai-data 不可用，也必须明确告知失败原因，不得返回假数据
9. **自动化任务自描述**：创建 CodeBuddy 自动化时，`prompt` 只描述任务本身（加载哪个 skill、生成什么播报、范围是谁），不写排期 / 工作区 / 通道密钥；排期通过 `rrule` 字段表达
10. **关键动作检查点**：首次真实数据查询前确认当前登录招聘经理身份和查询范围；生成候选人话术前确认访问权限、候选人未毁约、话术类型；自动触发播报前确认用户愿意接收（显式请求除外）；企微群推送前确认目标群、范围、频率和敏感信息边界；HRClaw 通知导师/上级前确认候选人、通知对象、通知方式、收件人、真实简历链接、员工子类型（多人时必查）、使用者本人 OA 登录态和隐私边界；创建 CodeBuddy 自动化前确认任务名称、频率、查询范围；涉及导出、群发、批量发送前二次确认
11. **埋点上报**（MANDATORY）：在每个关键节点主动上报埋点事件，帮助运营分析各场景使用情况。共 10 个事件（4 通用 + 6 场景业务）。上报使用 `scripts/track.sh`（跨平台通用）或 `tools/report.sh`（含 init/event/complete/debug 子命令），均为静默执行不阻塞主流程。必须上报的节点与事件如下：
    - **skill 被调用时**：上报 `skill_invoked`，参数含 `skill_name`（固定 `warming-recruit-manager`）、`invoke_source`（`command` / `keyword` / `automation`）、`user_login_name`、`session_id`、`intent_category`（AI 判断：`query` / `script` / `reminder` / `push` / `automation` / `notify`）
    - **场景 A 查询完成时**：上报 `scene_a_query`，参数含 `query_scope`、`is_full_org_view`、`org_filter_type`、`result_total`/`result_signed`/`result_broken`、`risk_high_count`/`risk_medium_count`、`no_mentor_count`/`no_leader_count`/`pre_entry_30d_count`、`link_requested`、`zhaopin_mcp_used`、`deep_analysis_used`、`focus_p1_p2_count`、`stable_candidate_count`、`user_login_name`、`session_id`
    - **场景 B 话术生成完成时**：上报 `scene_b_script`，参数含 `template_id`（`S1_welcome`~`S7_risk_check`）、`candidate_risk_level`、`has_resume_hook`、`has_interview_hook`、`multi_version`、`zhaopin_mcp_used`、`deep_analysis_used`、`attention_priority`、`stability_level`、`user_login_name`、`session_id`
    - **场景 C 播报生成完成时**：上报 `scene_c_reminder`，参数含 `trigger_type`（`auto` / `explicit` / `skipped`）、`l1_count`/`l2_count`/`l3_count`、`no_mentor_in_l1`/`pre_entry_in_l1`、`user_login_name`、`session_id`
    - **场景 D 推送完成时**：上报 `scene_d_wechat`，参数含 `action`（`push_instant` / `schedule_created` / `schedule_updated`）、`push_result`、`frequency`、`query_scope`、`user_login_name`、`session_id`
    - **场景 E 自动化任务完成时**：上报 `scene_e_automation`，参数含 `action`（`created` / `updated` / `deleted`）、`frequency_type`、`query_scope`、`with_wechat_push`、`user_login_name`、`session_id`
    - **场景 F HRClaw 发送完成时**：上报 `scene_f_hrclaw`，参数含 `channel`（`mail` / `workchat_tips`）、`notify_target`（`tutor` / `leader` / `both`）、`template_type`（`single` / `multi`）、`oa_login_result`（`auto_login` / `manual_login` / `failed`）、`send_result`（`success` / `failed`）、`receiver_count`/`candidate_count`、`has_resume_link`、`has_employee_subtype`、`use_browser_automation`、`fallback_reason`、`user_login_name`、`session_id`
    - **异常发生时**：上报 `error_occurred`，参数含 `skill_name`、`error_scene`（`data_source` / `identity` / `query` / `hrclaw_send` / `wechat_send` / `automation` / `org_resolve` / `other`）、`error_code`（AI 判断，开发者自定义错误码）、`error_message`（脱敏后）、`session_id`
    - **场景任务完成时**：上报 `task_completed`，参数含 `skill_name`、`scene`、`duration_ms`、`session_id`、`fail_reason`（AI 判断：`skill_bug` / `llm_limitation` / `user_cancel` / `dependency_error` / `timeout`，仅 status=fail 时填写）
    - **会话结束时**：上报 `session_end`，参数含 `skill_name`、`session_id`、`scenes_used`（逗号分隔）、`total_duration_ms`、`total_events_fired`
    - 上报调用方式（`requires_approval: false`）：`bash scripts/track.sh "0WEB0709ORSHJO0F" "warming-recruit-manager" <event_name> '<json_params>' && echo "READY"`
    - **AI 判断类参数引导**：`intent_category`、`fail_reason`、`error_code` 等 Hook 无法自动采集的参数，必须在适当时机由模型判断并显式传入。`intent_category` 在识别用户意图后填入；`fail_reason` 在任务失败时从枚举中选择；`error_code` 在捕获到已知错误时填入自定义码
    - 完整埋点方案见 [trackmate/tracking_plan.md](trackmate/tracking_plan.md)

---

## 六、快速场景决策索引

| 用户关键词 | 所属场景 | 必做检查点 |
|---|---|---|
| 查 / 有哪些 / 名单 / 清单 / 组织 / 导师 / 上级 / 链接 | A 数据查询 | 身份 + 查询范围确认；链接仅限单人请求 |
| 话术 / 欢迎词 / 沟通脚本 / 画像 / 面评总结 | B 话术生成 | 候选人权限校验 + 未毁约 + 话术类型确认 |
| 提醒 / 播报 / 今天做什么 / 谁要跟进 | C 保温提醒 | 自动触发需先确认，显式请求可直接播报 |
| 企微 / 机器人 / 推群 / 日报发群 | D 企微推送 | 目标群、频率、内容边界二次确认 |
| CodeBuddy / 自动化 / 定时 / 每天自动跑 | E 自动化提醒 | 任务名称、频率、查询范围确认 |
| 发邮件 / 企微 Tips / 通知导师 / 通知上级 / HRClaw | F 导师/上级通知 | 候选人权限 + 通知对象 + 收件人 + 二次确认 |

---

## §末尾推荐贴片（由 agent §-2.5 协议驱动 · 仅适用场景 C）

> **触发条件**：场景 C「三级播报」**输出已经完整给到用户**之后；满足 agent §-2.5 §B 全部不打扰条件。
> **不适用**：场景 A/B/D/E/F（A 是数据查询、F 是发通知，都不该被定时化）

### 适用判定

```
当前能力：warming-recruit-manager.C 三级播报
推荐模板：daily-recruit-warming-brief
频率：工作日 9:00 自动触发
```

### 标准贴片文案

```markdown
─────────────────────
⏰ **想每天工作日早上自动收保温播报？**

  · 推荐模板：`daily-recruit-warming-brief`（工作日 9:00 自动跑）
  · 一键开启：直接说「设个保温播报定时」
  · 想自定义频率/时间：说「我要自定义」
  · 不需要：说「不用了」（本会话不再问）
```

### 老用户精简版

```markdown
> ⏰ 提示：可设为定时任务（推荐 `daily-recruit-warming-brief`，工作日 9:00）—— 说「设个保温播报定时」即可。
```

### 不追加情况

- 用户本会话已被推过 1 次本能力推荐
- `automation_update view` 已存在 `daily-recruit-warming-brief` 对应任务
- user-prefs 里 `disable_recommend_global=true` 或包含 `warming-recruit-manager.C`
- 当前是场景 A/B/D/E/F（强制不追加）

详见 agent recruitment-expert.md §-2.5。

---

## 七、参考文件导航

| 文件 | 读取时机 |
|---|---|
| [references/data-query.md](references/data-query.md) | 场景 A 全流程、或需要确认字段含义时 |
| [references/sql-templates.md](references/sql-templates.md) | 场景 A 需要具体 SQL 时 |
| [references/warming-scripts.md](references/warming-scripts.md) | 场景 B 全流程、或需要调用 zhaopin-mcp / recruit-mcp 补充画像时 |
| [references/reminder.md](references/reminder.md) | 场景 C 触发时；或场景 D 需要企微机器人推送 / 定期任务配置时；或场景 E 需要 CodeBuddy 自动化定时提醒时 |
| [references/hrclaw-message.md](references/hrclaw-message.md) | 场景 F 触发时；需要向导师/上级发送 HRClaw 邮件或企微 Tips 时 |
| [trackmate/tracking_plan.md](trackmate/tracking_plan.md) | 需要确认埋点事件定义、参数说明时 |
| [assets/script-templates.md](assets/script-templates.md) | 场景 B 选模板时，不读入 context，按需 copy |
