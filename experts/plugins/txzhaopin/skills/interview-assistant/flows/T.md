# 面试助手 · T 待办查询子模块（T 我的面试待办 + T2 推荐待办）

> 子模块路径：`flows/T.md`  
> 触发：在主 SKILL.md 的 Router-0 命中本类目后，**第一件事是 Read 本文件**，再执行内部步骤。  
> 本文件由 v3.6 单文件 SKILL.md 拆分而来，原章节内容完整保留。

<!-- skill-tracker sub_flow: begin (auto-generated) -->

> 🚨 **FIRST ACTION（读到本文件第一件事 · MANDATORY · 静默执行）**：上报 `sub_flow_entered` 事件，标记本次进入了 **`T` 子流程（我的面试待办（含 T2 推荐待办））**。这是 v4.6 双轨埋点的精准维度——配合 SKILL.md 主 FIRST ACTION 的 `skill_invoked`，看板能拉出"哪个 sub_flow 用得最频繁"。

```bash
bash ./scripts/track.sh "0WEB06ZI7OVDOZQW" "interview-assistant" "sub_flow_entered" '{"session_id":"'"$(date +%s)"'","sub_flow":"T","sub_flow_name":"我的面试待办（含 T2 推荐待办）"}'
```

**约束**：每次读到本文件就执行一次（不要因为同会话内"刚跑过"就跳过）。静默后台，失败容忍，不询问用户。

<!-- skill-tracker sub_flow: end -->

---

## 场景 T：我的面试待办（v4.5 · 校招 + 社招）

**触发条件**：用户说"查看我的面试待办"、"我有什么面试"、"今天有什么面试"、"面试待办"、"待面试"、"待填面评"等

> 🆕 **v4.6 校招全环节扩展**：除了「面试待办」，校招还支持**四大环节 × 待办/已办**全量查询（面试 / 实习生考核 / 录用 / 评估）。
> 用户问「我的校招**已办** / 我已经面完哪些 / 我名下校招**录用/考核**还有哪些待办 / 校招事项」时 → 走下面 **T-4 校招全环节**（脚本 `fetch_campus_flow.py`）。
> - 「今天我要面谁」这种**纯面试待办高频问句** → 仍走 T-2 `fetch_todos.py`（校招+社招双查，最快）。
> - 「校招其它环节 / 已办」 → 走 T-4 `fetch_campus_flow.py`。

> 🔴 **重要限制**：本场景只能查询**当前 API token 持有人（即你自己）**名下的面试待办。
> 如需查询**其他面试官 / HR / 招聘经理 / 当前处理人**名下的待办（**仅社招**），请改用 `recruitment-process-tracker` skill——它基于社招流程跟踪接口 `recruit.social-todo-center.post_api_process_get_list`，支持按 `hrs`（招聘 HR）/ `interviewers`（面试官）/ `currentProcessStaffs`（当前处理人）/ `ownerStaffId`（待办所有人）等维度筛指定人名下的待办/已办（需要对应查询权限）。⚠️ 校招暂无逐人待办查询接口，校招他人待办不支持。
> 如需查询**推荐待办（锁定简历/他人推荐简历）**，请使用场景 T2。

> 🔴 **默认双查（v4.5 行为）**：用户问"我的面试待办 / 今天有什么面试"时，**默认同时查校招和社招**两类，最后合并展示并标注来源（校招 / 社招）。除非用户明确说"只看校招"或"只看社招"，否则不要单查一边。

### T-1. 前置检查

确认 `recruit-mcp` 已通过 mcporter 配置：

```bash
mcporter list
```

- 已有 `recruit-mcp` 且状态正常 → 继续
- 未配置 → 走启动检查 §3-① 的安装引导

### T-2. 一键脚本（v4.5 · **强制使用，禁止手拼 mcporter call**）

> 🔴 **硬约束**：agent **不允许**手工拼 `mcporter call recruit-mcp CallAPI` 拉待办——必须用下面脚本。
> 脚本已经把"顶部概览 + 社招列表 + 校招列表 + 字段探测（社招姓名在 `title` 而非 `name`；校招展开 personList）+ 简历 URL 模板分发（社招用 `employeeId`，校招用 `rid`）+ 渲染合并 Markdown"全部一站式完成，省 token 又快。

```bash
# 默认双查（顶部概览 + 社招 + 校招 → 直接拿 Markdown 给用户）
python3 ~/.workbuddy/plugins/marketplaces/my-experts/plugins/txzhaopin/skills/interview-assistant/scripts/fetch_todos.py

# 只看概览（最省 token，适合"我今天忙不忙"这种问句）
python3 .../scripts/fetch_todos.py --top-only

# 只看社招
python3 .../scripts/fetch_todos.py --type social

# 只看校招
python3 .../scripts/fetch_todos.py --type campus

# 拿原始 JSON（用于程序处理，如联动 D 写面评时用 rid）
python3 .../scripts/fetch_todos.py --format json
```

**脚本输出格式（默认 markdown）**：

```
📋 待办概览：社招 N / 校招 M / 紧急 K
- 关注岗位：社招 a / 校招 b
- ...

## 🟦 社招待办（N 条）
| # | 候选人 | 岗位 | 部门 | 环节 | 状态 | 地点 | 剩余 | 简历 |
...

## 🟧 校招待办（M 条）
| # | 候选人 | 学校 | 岗位 | 环节 | 时间 | 形式 | 状态 | 简历 |
...
```

agent **直接**把脚本 stdout 转发给用户即可，无需再加工。

### T-2-Bonus. 脚本背后的接口（仅供脚本出错时排查，不要手动调）

- **顶部概览**：`recruit.social-todo-center.get_api_trace_get_top_count`（GET 无入参，响应路径 `data.data.totalTrace / socialTrace / campusTrace / urgentTrace`，**两层 data**）
- **社招列表**：`recruit.social-todo-center.get_api_trace_get_list`（GET，必填 `flowId="3" + extType="interview" + done="false" + type="trace"`；响应路径 `data.data.rows[]`；**候选人姓名在 `title` 字段**；简历链接优先用接口直出的 `resumeUrl`，否则用 `employeeId` 拼）
  - 🔴 **重要：社招 todo 接口不返回 `rid`（GUID），只有 `employeeId`**。但 `post_order_add` / 简历详情 / S-Pre 资格判定都要 rid。脚本会**自动按 `emailAddress` 调社招搜索接口 `recruit.social-resume.post_api_resume_query_query` 反查 rid**，并在输出末尾附「🔑 候选人 RID 索引」表
- **校招列表**：`recruit.campus-center-front.get_campus_interview_todo_list`（POST `{pageIndex, pageSize, orderBy:"interviewTime"}`；响应路径 `data.data.list[]`，**每条顶层是"面试时段"，候选人在 `personList[]` 子数组**，要展开成一对一）

### T-2-RID. 手动反查社招 RID（独立工具，v4.5 新增）

如果是从其它入口拿到候选人邮箱/手机号（而不是从 T 待办联动），需要单独反查 rid 时用：

```bash
# 按邮箱查（最准）
python3 ~/.workbuddy/plugins/marketplaces/my-experts/plugins/txzhaopin/skills/interview-assistant/scripts/resolve_social_rid.py \
    --email candidate@example.com

# 按手机号查
python3 .../scripts/resolve_social_rid.py --mobile 13800001234

# 按 employeeId 反查（必须配合 hint-name 二次比对）
python3 .../scripts/resolve_social_rid.py --ext-id <EXT_ID> --hint-name <候选人姓名>
```

返回 JSON 含 `rid` / `ext_id` / `name` / `status_text` 等字段，**rid 即可直接传给 `post_order_add` / `check_interview_eligibility.py --type social --rid <rid>`**。

退出码：0 唯一命中 / 1 无匹配 / 4 多匹配（需澄清）。

**校招筛选参数（脚本默认值之外的自定义场景才需要）**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `currentStep` | integer | 面试环节：1-初试 / 2-复试 / 3-终面 / 5-HR面 |
| `recruitType` | integer | 招聘类型：1-校招 / 2-实习 |
| `recruitYear` | integer | 招聘年份，如 2026 |
| `orderStateId` | integer[] | 待办状态筛选（见下表） |

**校招待办状态码**（脚本已用 `resultTxt` 文本展示，code 表仅供查询）：

| 状态码 | 含义 | 用户需要做什么 |
|:---:|------|-------------|
| 1 | 待安排面试时间 | 安排面试 |
| 2 | 待确认面试时间 | 确认时间 |
| 3 | 待面试官接受 | 接受面试 |
| 4 | 待候选人接受 | 等候选人确认 |
| 5 | 面试已取消 | — |
| 6 | 候选人已拒绝 | — |
| 7 | 已过期未处理 | 尽快处理 |
| 8 | 待开始面试 | 准备面试 |
| 9 | 面试进行中 | 正在面试 |
| 10 | 待填写面评 | 填写面评 |
| 11 | 已完成 | — |

### T-3. 输出待办列表（v4.5 · 支持校招+社招合并）

**输出方式**：优先使用 show_widget 生成可视化卡片，备选 Markdown 表格。

**合并展示原则（v4.5）**：
- 如果 T-0 用户选了"两边都展开"或没明说，**把社招（T-2A）和校招（T-2B）两边都拉**
- 输出时**按招聘类型分两段**（先社招后校招，或按面试时间统一排序后每条标注「校招/社招」）
- 简历链接区分：
  - 校招：`https://zhaopin.woa.com/resume/campus/ResumeDetail?rid={RID}`
  - 社招：`https://zhaopin.woa.com/resume/resume_detail?rid={RID}&fromplace=MCP`

**每条待办展示的信息**：
- 候选人姓名、学校（社招用工作年限+最近公司替代）、专业（社招用领域）
- 投递岗位、部门、BG
- 招聘类型（**校招 / 社招**，必填，区分双方）
- 面试时间、面试方式
- 待办状态（用颜色区分紧急程度）
- 面评截止时间
- 腾讯会议链接（如有）
- 简历详情链接（按类型选 URL 模板）

**紧急程度标注**：
- 🔴 今天的面试（待开始/进行中）
- 🟠 面评截止 < 48 小时
- 🟡 面评截止 < 7 天
- ⚪ 其他

### T-4. 校招全环节 待办/已办（v4.6 新增 · 脚本 `fetch_campus_flow.py`）

> **何时走这里**（而不是 T-2）：用户问的是**校招的「已办」**，或**面试以外的环节**（实习生考核 / 录用 / 评估）的待办/已办，或泛指「我名下还有哪些校招事项 / 已处理哪些」。
> 纯「今天我要面谁」仍走 T-2 `fetch_todos.py`（更快、还带社招）。

**一键脚本（强制使用，禁止手拼 mcporter call）**：

```bash
SCRIPT=~/.workbuddy/plugins/marketplaces/my-experts/plugins/txzhaopin/skills/interview-assistant/scripts/fetch_campus_flow.py

# 默认：四环节 × 待办（我名下校招还有哪些事项）
python3 "$SCRIPT"

# 已办（我已经处理过的：已面完 / 已录用 / 已考核 / 已评估）
python3 "$SCRIPT" --done

# 待办 + 已办都看
python3 "$SCRIPT" --both-status

# 只看某环节：interview（面试）/ assess（实习生考核）/ offer（录用）/ evaluation（评估）
python3 "$SCRIPT" --stage offer            # 录用待办
python3 "$SCRIPT" --stage assess --done    # 实习生考核已办

# 原始 JSON（联动其他场景取 rid 时用）
python3 "$SCRIPT" --format json
```

**脚本覆盖的 7 个校招接口**（`recruit.campus-center-front.*`，已封装取数+解析+渲染）：

| 环节 | 待办接口 | 已办接口 |
|---|---|---|
| 面试 | `get_campus_interview_todo_list` | `get_campus_interview_done_list` |
| 实习生考核 | `get_assess_todo_list` | `get_assess_done_list` |
| 录用 | `get_campus_offer_todo_list` | `get_campus_offer_done_list` |
| 评估 | `post_v1_evaluation_todoList` | `post_v1_evaluation_doneList` |

**输出**：脚本直接产出合并 Markdown（每环节一张表：候选人/学校/岗位/环节/结果/评级/时间/详情链接），agent 拿到直接给用户，**不要再手工解码**。脚本对单环节失败做隔离降级（某接口拉不到只标"暂无"，其余照常）。

> 🔴 **接口实测要点（2026-06-17 全部 7 接口实跑校准进脚本，agent 无需关心，仅备查）**：
> - 全是 **POST**，接受 body：`pageIndex/pageSize`（+ 各环节自有筛选：面试 currentStep/recruitType/resultStatus；录用 stepId/offerType/tripartiteStatusId 等）。
> - **响应层级**：面试/录用/考核 = 三层 `data.data.data.list`；评估 `post_v1_evaluation_*` = 两层 `data.data.list`。脚本两者都兼容。
> - **四环节字段差异大**（脚本用「全变体并集 + 顺序探测」一套覆盖）：
>   - 面试：`name`/`resumeRid`/`speciality`/`stepName`/`resultTxt`/`rankTxt`/`interviewTimeStr`/`pcUrl`(小写)
>   - 录用：`name`/无rid(用resumeId)/`stepName`/`stateName`+`curHandleStatus`/`PCUrl`(大写)/`diffData`总耗时天
>   - 考核：`name`/`positionName`/`departmentName`/`assessResultName`+`assessStateName`/`diffDay`/**无详情URL**
>   - 评估：`name`/`rid`/`speciality`/`stationTxt`/`statusTxt`(操作)/`assessmentStatusTxt`(测评灯)/`diffTimeTxt`/**无URL**（用 rid 拼简历页）
> - 面试 `comment` 评语很长且可能含未转义控制字符 → mcporter stdout 在大 pageSize 时截断成非法 JSON。脚本用 `pageSize=15` 规避 + `_salvage_json` 救援兜底。**要全量请翻页**（改 pageIndex）。
> - 实测验证：面试已办 46 条、录用已办 3 条、评估已办 4 条、考核已办 0 条 —— 字段渲染全部正确。

> ⚠️ **边界**：本步是**校招专属**——它解决的是"校招以前只有面试待办、缺其它环节和已办"的缺口。社招的待办仍由 T-2 `fetch_todos.py` 的 `--type social` 承担（社招的多环节/已办接口若后续提供，再另行扩展）。

### T-5. 联动到其他场景

展示待办后，引导用户选择操作：

```
📋 你可以对待办中的候选人执行以下操作：

[1] 查看简历 — 拉取完整简历详情（进入 A-2）
[2] 面试出题 — 基于简历生成面试计划（进入场景 C）
[3] 写面评 — 基于面试转写生成结构化面评（进入场景 D）
[4] 调整面试安排 — 修改面试时间/取消面试（进入场景 S）
[5] 刷新待办 — 重新查询最新待办

输入候选人序号 + 操作（如 "1 出题" 或 "2 写面评"），或直接说你想做什么。
```

**自动联动规则**：
- 选择「面试出题」→ 用待办中的 RID 自动拉取简历，进入场景 C-0；**同时把待办里的 `step_txt`（环节）、`position_txt`（岗位）、`recruit_type`（招聘类型）打包带入 C-1 的 Step A，免去用户再选一遍环节**（新增）
- 选择「写面评」→ 如待办中有腾讯会议号，自动提示是否拉取转写；进入场景 D-1
- 选择「查看简历」→ 用 RID 拉取简历详情，进入 A-2 展示格式
- 选择「调整面试安排」→ 用待办中的 orderId 进入场景 S-3

---

## 场景 T2：校园推荐待办

**触发条件**：用户说"推荐待办"、"校园推荐"、"他人推荐"、"推荐给我的简历"、"锁定简历待办"、"评估待办"、"校招推荐待办"等

> 🔴 **与场景 T 的区别**：
> - **场景 T**（面试待办）= 已经进入面试环节的候选人（待开始面试/待填写面评）
> - **场景 T2**（推荐待办）= 我锁定的 / 他人推荐给我锁定的简历（尚未安排面试，需评估决策是否发起面试）
>
> 用户问"待办"时，如果上下文不明确，**两个都查**（先查 T 面试待办，再查 T2 推荐待办），合并展示。

### T2-1. 前置检查

同场景 T：确认 `recruit-mcp` 已通过 mcporter 配置。

### T2-2. 查询推荐待办

**API 接口**：`recruit.campus-center-front.post_v1_evaluation_todoList`（POST）

**调用方式**：

优先通过 mcporter CLI 调用（公开版最稳定、跨账号可复用）：
```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.campus-center-front.post_v1_evaluation_todoList' \
  params='{"pageSize":50,"pageIndex":1}' \
  > $TMP_DIR/recommend_todo_raw.json 2>&1
```

> 💡 若当前 WorkBuddy 环境已暴露 recruit-mcp 专用工具，也可以使用工具调用；但必须按平台规范先完成能力检索/参数确认，再调用目标 API。公开版文档默认使用 mcporter，避免不同用户环境里工具名不可用。

**支持的筛选参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `pageIndex` | integer | 页码，从 1 开始 |
| `pageSize` | integer | 每页数量，默认 20 |
| `keyword` | string | 关键字，支持简历信息/姓名/手机号/邮箱 |
| `staffId` | integer | 员工ID，null=查自己 |
| `recommendId` | integer | 按推荐人ID筛选 |
| `assessmentStatus` | integer | 测评完成情况：0-全部 / 1-已完成 / 2-未完成 |
| `assessmentPassStatus` | integer | 测评通过情况：0-全部 / 1-通过(黄灯+绿灯) / 2-未通过(红灯) |

> ⚠️ **不要混淆两套概念**（v3.6 澄清）：
> - T2 这里的 `assessmentPassStatus` 是**整份测评的整体红/黄/绿灯**（系统聚合判断，作筛选用）
> - 而 B/C 场景拉简历后读的 `qualityAssessmentResults[].result` 是**每个维度的档位**（1 低/2 中/3 高）
> - 两者不要串用：红灯 ≠ 某维度档位 1；绿灯 ≠ 所有维度档位 3

**返回数据结构**：

```
data.data.total - 总数
data.data.list[] - 每条推荐待办
  .resumeId      - 简历ID（数字，用于收藏等操作）
  .rid           - 简历RID（UUID，用于拼接详情链接）
  .name          - 候选人姓名
  .sex           - 性别
  .school        - 学校
  .speciality    - 专业
  .graduateTimeTxt    - 毕业时间
  .stationTxt         - 投递岗位
  .subDirectionName   - 细分方向
  .stationWithSubDirection - 投递岗位(含细分方向)
  .workCityTxt        - 期望工作城市
  .isDeploy           - 是否服从调剂（1=是）
  .recommendId        - 推荐人ID
  .recommendStaffName - 推荐人姓名
  .comment            - 推荐理由
  .endTime            - 到期释放时间（Unix时间戳）
  .endTimeTxt         - 到期释放时间（文本）
  .diffTimeTxt        - 环节耗时
  .status             - 操作状态（"0"=未处理）
  .statusTxt          - 操作状态文本
  .assessmentStatus   - 测评状态码
  .assessmentStatusTxt - 测评状态文本（已完成-绿灯/已完成-黄灯/已完成-红灯/未完成）
  .recruitProject     - 招聘项目（1=校招 / 2=实习）
```

### T2-3. 输出推荐待办列表

**输出格式**：Markdown 表格，按紧急程度排序。

**每条展示的信息**：
- 候选人姓名、学校、专业
- 投递岗位
- 期望工作城市
- 毕业时间
- 测评状态（用颜色标注：🟢绿灯 / 🟡黄灯 / 🔴红灯 / ⚪未完成）
- 推荐人
- 到期释放时间
- 处理状态

**紧急程度标注**：
- 🔴 到期释放 < 24 小时
- 🟠 到期释放 < 3 天
- 🟡 到期释放 < 7 天
- ⚪ 其他

**简历详情链接**：`https://zhaopin.woa.com/resume/campus/ResumeDetail?rid={rid}&from=recruit-mcp`

### T2-4. 联动到其他场景

展示待办后，引导用户选择操作：

```
📋 你可以对推荐待办中的候选人执行以下操作：

[1] 查看简历 — 拉取完整简历详情（进入 A-2）
[2] 简历评估 — 按模型维度评估候选人匹配度（进入场景 B）
[3] 面试出题 — 基于简历生成面试计划（进入场景 C）
[4] 刷新待办 — 重新查询最新推荐待办

输入候选人序号 + 操作（如 "1 查看简历" 或 "2 评估"），或直接说你想做什么。
```

**自动联动规则**：
- 选择「查看简历」→ 用 RID 拉取简历详情，进入 A-2 展示格式
- 选择「简历评估」→ 用 RID 拉取简历 → 进入场景 B1 评估
- 选择「面试出题」→ 用 RID 拉取简历 → 进入场景 C-0

---

## §T-末尾推荐贴片（v5.8 新增 · 由 agent §-2.5 协议驱动）

> **触发条件**：T / T2 主流程**输出已经完整给到用户**之后；满足 agent §-2.5 §B 全部不打扰条件。
>
> **接入位置**：在 T 主输出最后追加一段标准贴片，**不要**插在中间。

### 适用判定（命中即追加）

```
当前能力：interview-assistant.T or interview-assistant.T2
推荐模板：daily-interview-todo
频率：工作日 9:00 自动触发
```

### 标准贴片文案（直接照抄）

```markdown
─────────────────────
⏰ **每天上班第一件事都是查待办？**

  · 推荐模板：`daily-interview-todo`（工作日 9:00 自动跑）
  · 一键开启：直接说「设个面试待办定时」
  · 想自定义频率/时间：说「我要自定义」
  · 不需要：说「不用了」（本会话不再问）
```

### 老用户精简版（用户名下已有 ≥1 个其他定时任务时）

```markdown
> ⏰ 提示：可设为定时任务（推荐 `daily-interview-todo`，工作日 9:00）—— 说「设个面试待办定时」即可。
```

### 不追加情况

- 用户本会话已被推过 1 次 T 推荐
- `automation_update view` 已存在 `daily-interview-todo` 对应任务
- user-prefs 里 `disable_recommend_global=true` 或包含 `interview-assistant.T`

详见 agent recruitment-expert.md §-2.5。

---

---

