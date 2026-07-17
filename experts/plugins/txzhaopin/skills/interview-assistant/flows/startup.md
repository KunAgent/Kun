# 面试助手 · 启动检查与工作流附录

> 子模块路径：`flows/startup.md`  
> 触发：在主 SKILL.md 的 Router-0 命中本类目后，**第一件事是 Read 本文件**，再执行内部步骤。  
> 本文件由 v3.6 单文件 SKILL.md 拆分而来，原章节内容完整保留。

---

## 启动检查

**每次启动时，执行以下检查**：

### 1. 本地模型检索（核心步骤）

扫描 `references/models/` 目录：

**有模型时**：列出所有可用模型文件

```
📋 检测到以下可用模型：

| # | 模型名称 | 适用范围 | 维度数 |
|---|---------|---------|--------|
| 0 | 腾讯校招通用胜任力（内置兜底） | 全集团校招 | 8 项 |
| 1 | {甄选专家导出的模型名} | {BG/岗位/招聘类型} | {N}项 |
| 2 | ... | ... | ... |

请选择要使用的模型（输入序号，默认 1）。
选定后进入场景选择：[T-我的面试待办] / [T2-校园推荐待办] / [A-校招搜索] / [B-简历评估] / [C-面试计划] / [D-面评填写]
```

同时检查 `references/jds/` 目录是否有对应 JD 文件（简历筛选场景需要）。

**没有甄选专家导出的模型时**（改进 · 不再阻断）：

```
💡 当前未检测到「甄选质量专家」(assessment-quality-expert) skill 导出的岗位专属模型。
   已自动加载**内置兜底模型：腾讯校招通用胜任力**（8 项维度，覆盖全集团校招通用场景）。

   如需更精准的岗位专属模型，可：
   [方式 1] 让 HR 在「甄选质量专家」skill 搭建本岗位模型并导出（最推荐）
   [方式 2] HR 手动把现成模型放到 references/models/
   [方式 3] 使用场景 B 时直接上传 JD，系统会自动补充岗位维度

   已自动继续使用内置兜底模型，如需切换请输入序号选择。
```

> 💡 **关键改进**：起所有 B/C/D 场景默认加载内置兜底模型（远程资产 `model_default_campus`），不再因为"没装甄选专家"就卡住。用户如果装了甄选专家或手动上传了专属模型，优先级更高，会自动覆盖兜底。

> 💡 **场景 T / T2 / S / A（简历搜索）不需要模型**，无模型时也可直接使用。

### 2. 岗位面试设计方案检索（新增）

扫描 `references/interview-designs/` 目录：

**有方案时**：列出所有可用方案

```
📐 检测到以下岗位面试设计方案（来自甄选专家 HR 导出）：

| # | 岗位 | 已覆盖环节 | 最近更新 |
|---|------|-----------|---------|
| 1 | {岗位名} | {环节列表} | {日期} |

场景 C 出题时会按候选人投递岗位自动匹配使用。
```

**无方案时**：不阻断启动。进入场景 C 时会降级，**优先**通过 `flow_matrix_campus_fallback` 语义键拉取远程权威版；**远程不可用时**回退到本地 `references/campus-interview-flow-fallback.md`（公开方法论，离线兜底）。降级时在输出末尾提示用户："建议让 HR 在甄选专家中搭建方案并同步"。

### 3. 依赖检查

检查以下外部依赖，**未就绪时主动提示用户安装方法**：

**① 招聘 MCP（场景 T 面试待办 + 场景 A 校招搜索 + 场景 C 拉取简历详情必需）**

> 🔴 **重要**：招聘 MCP（`recruit-mcp`）通过 mcporter 接入，需要两个 Token（太湖 PAT + 招活 Token）。接通即视为可用。

**探活：先判断当前会话能不能用 recruit-mcp**

按以下顺序检查（任一可用即停）：

1. 当前会话是否暴露 `mcp__recruit-mcp__*` 工具（最直观）
2. 执行 `mcporter list 2>&1 | grep -i recruit-mcp`，出现 `- recruit-mcp (N tools, ...)` 即可用

任一通过 → 跳过下面的安装引导，直接进入正式流程。
全部失败 → 严格按下面**接入引导**响应用户，**不要**进入 T/T2/S/A/B/C/D 任一正式场景。

**安装引导（用户就在本对话里跟我一步步走完，不要跳出本 skill）**：

```
⚠️ 检测到招聘 MCP (recruit-mcp) 未接通。
本 skill 的正式工作流强依赖 recruit-mcp：待办、推荐待办、面试安排、简历搜索、简历详情、测评数据、候选人流程状态、面评待办等核心数据都来自它。
未接通前不进入 T/T2/S/A/B/C/D 任一正式场景；只能先完成接入引导。

连接很简单，🆕 已支持 WorkBuddy 一键弹窗连接，只认太湖授权，不再需要「招活 Token」：

━━━━━━━━━━ 方式 A · 一键弹窗连接（首选）━━━━━━━━━━

  ① WorkBuddy 弹出「是否连接 recruit-mcp（https://zhaopin.mcp.it.woa.com）」→ 点「连接」
  ② 按提示用太湖 SSO 授权即可（无需手填任何 Token）
  没弹窗就去「连接器」→「自定义连接器」→ recruit-mcp → 点「连接」/「Trust」。

━━━━━━━━━━ 方式 B · 手动 mcporter（仅客户端不支持弹窗时）━━━━━━━━━━

Step 1：太湖 PAT：https://tai.it.woa.com/user/pat（或本地装了 tai-oauth，告诉我「用 tai-oauth」我代跑）
Step 2：注册（只配太湖一个 header）
  mcporter config add recruit-mcp \
    --url "https://zhaopin.mcp.it.woa.com" \
    --header "Authorization=Bearer <太湖PAT>"

  ⚠️ 命令是 mcporter config add（不是 mcporter add）；Authorization 必须带 "Bearer " 前缀
  🆕 不再需要 recruit-Authorization / 招活 Token

Step 3：验证
  mcporter list | grep recruit-mcp        # 出现一行带 N tools 即注册成功
  mcporter call recruit-mcp CallAPI \
    apiId='recruit.campus-resume-search.get_v1_dictionary_getTagList' \
    params='{"tagType":"major"}'          # 返回 JSON 即鉴权通

  返回 401 → 太湖授权过期，重新点「连接」走太湖 SSO，或重跑 tai-oauth / 重建 PAT
  Unknown server → 设环境变量 MCPORTER_WORKSPACE 指向含 config/mcporter.json 的目录

━━━━━━━━━━ 安全提醒 ━━━━━━━━━━

- ❌ 严禁把太湖 Token 贴在对话里、提交到 Git、写进明文配置、贴到截图里
- ✅ Token 由 mcporter 存到 ~/.mcporter/credentials.json（0o600，不进 git）
- ⚠️ 太湖 Token 已外泄 → 立刻到 https://tai.it.woa.com/user/pat 吊销重申，再走一遍接入

接通后才继续进入正式流程。用户粘贴简历、上传转写等材料只能作为补充输入或异常兜底，不能替代 recruit-mcp 的候选人主数据源。
```

**两条路径都走不通时的兜底**：
```
⚠️ 双链路都未接通，本 skill 的正式工作流暂时不可用。

可继续做的（不依赖 recruit-mcp）：
  - 胜任力建模 / JD 撰写 / 出整套题（assessment-quality-expert）
  - 面评 Excel 清洗（interview-data-processor）
  - 岗位能力建模（interview-talent-modeler）

如需进一步排查，请截图 `~/.codebuddy/logs/` 中最新的插件加载日志，
或在企微搜【HR业务运维】寻求人工协助。
```

**② 腾讯会议 Skill（场景 D 面评填写的转写拉取需要）**

检查是否已安装并配置 `tencent-meeting-mcp` skill。如果未安装，展示：

```
💡 面评填写支持自动拉取腾讯会议转写，需要安装「腾讯会议」Skill。

未安装时仍可使用面评填写功能——直接粘贴或上传转写文本即可。

如需自动拉取：请在 WorkBuddy Skill 市场搜索并安装/配置 tencent-meeting-mcp。
```

**依赖检查规则**：`recruit-mcp` 是本 skill 的必装前置依赖，未配置时必须先完成安装/鉴权，不继续进入正式场景。`tencent-meeting-mcp` 是可选增强依赖；未配置时，D 场景可手工粘贴/上传转写，但候选人主数据仍以 recruit-mcp 为准。

### 4. 双输入分环节规则

选定模型后，根据用户选择的场景自动分配输入源：

| 场景 | 主要输入 | 强化考察 | 说明 |
|------|---------|---------|------|
| **T-面试待办** | recruit-mcp API | — | 查询本人名下校招面试待办 |
| **T2-校园推荐待办** | recruit-mcp API | — | 查询我锁定的/他人推荐给我的简历（评估待办） |
| **A-校招搜索 / B-简历评估** | JD 文件（为主）+ 模型（辅助） | 硬技能 + 背景资质 | 简历上看得到的是经历和技能 |
| **C-面试计划** | 模型 + **岗位面试设计方案**（骨架）+ 简历 + 前轮面评 | 软素质 + 价值观 + 候选人个性化 | 面试核心是考察行为和潜力，且需针对候选人定制 |
| **D-面评填写** | 模型文件（为主） | 软素质 + 价值观 | 面评逐维度评价行为证据 |

---

