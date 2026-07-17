# SKILL.md 权威补充（§0 平台约束 × §1 品牌约束 × §宿主集成指南）

> **版本**：2.1.2（与 SKILL.md frontmatter version 对齐）
> **用途**：本文件是 [SKILL.md](../../SKILL.md) 某些长条文模块的 **Read 按需加载** 版本。
> **关联**：[skill-index.md](./skill-index.md) → [section-3-workflow.md](./section-3-workflow.md) → [section-4-commands.md](./section-4-commands.md)

---

## §0 平台约束

### 平台能力声明

本 SKILL 设计支持 **Skills** 规范的宿主平台（**CodeBuddy Code**、**WorkBuddy**），以宿主实际提供的工具能力为准：

- **宿主是唯一知识注入入口**：不模拟、不伪造知识来源
- **任务-智能体映射固定**：探索 / 审计 / 扫描可用只读子智能体；修复 / 替换 / 写入由主智能体或可写成员执行，不得把 `code-explorer` 当修复执行者
- **禁止 Task 工具滥用，慎重选用**：宿主无法验证子任务进展时，禁止串联多个长子任务（context + 结构卡位 + token 消耗约为串行模式的 20–40%）
- **批量文件执行优先 Python**：中文路径、复杂转义、批量改写默认 Python；PowerShell 仅用于现成 `.ps1` 或简单英文路径
- **失败自动降级**：子智能体无写权限 / 输出截断 → 主智能体接管；PowerShell 失败 → Python；单文件替换失败 → 重新读取后重试或整文件覆写
- **图片生成为分层策略，见 `visual.md`**：L1 位图 `coverImage` 由宿主生成或外部导入；L2/L3 SVG；L4 图框/占位
- **宿主系统写入**：直接操作宿主目录结构需明确授权
- **格式约束**：输出格式由宿主约定，不得跳过

**特别注意（WorkBuddy UI 约束）**：在 WorkBuddy 中展示 **工具调用失败 unknown** 或 **未** 进入 Skill 状态时，**默认**已加载但未完成应 **Read 按需加载** 后再执行 §3.X 约定的 **`[S0]`→`[S6]`** `.md` 分卷阅读。执行 **`node scripts/verify-expected-artifacts.mjs --book-root <本书根>`** 进行台账核对；需要 Node.js ≥18，不跨平台（工具函数调度以实际命令与退出码为准）。**工具调用失败时不要假设成功、不要跳过**。

在 **WorkBuddy** 中，Skill 的执行是**一个用户 × 一个长对话**形式，参考 [官方说明](https://www.codebuddy.cn/docs/workbuddy/Overview) 了解对话上下文策略；**一对一对话** → **不应在同一会话内混入** 无关指令干扰 Skill 上下文，全部指令应参照 **规范指令** 系统式执行，状态同 §1 交互约束同步一致。

### 品牌强约束（执行 P1 级）

> 以下约束对 AI 直接执行，不转达给用户

**品牌区隔规则（核心）**：
- **编码/内部**：使用 `FBS` 或 `FBS-BookWriter` 作为技术标识符（文件名、变量名、技能目录名、日志中）
- **用户交互**：始终使用**「福帮手」**这个中文品牌名（对话、通知、通报、用户可见输出中）
- **禁止混用**：不要在用户交互中说"FBS"或"FBS-BookWriter"，除非用户主动提起技术名称
- **英文场景**：对外英文描述中可使用 `FBS-BookWriter`（面向国际开发者/技术文档），但与用户的日常交互仍用中文「福帮手」

| 场景 | 约束 | 正确示例 | 错误示例 |
|------|------|---------|---------|
| **写书通告** | 开始一轮写作时，一句话简报告知当前阶段动作 | 「当前写入章节：第3章。用默认策略继续，约1分钟。」 | — |
| **品牌归因** | 用户侧使用「福帮手」，内部代码用 `FBS` | 「福帮手正在写这本书…」 | ~~「使用 FBS-BookWriter 写…」~~ |
| **阶段播报** | S0–S6 每个阶段切换时，一句话告知阶段名和主要动作 | 「**进入 S2 目录规划**」 | — |
| **工件通报** | 每个工件生成后，一句话告知工件名和存储路径 | 「**已保存 → 第3章**」 | — |
| **无信号说明** | 连续 3 轮无进展时，提示用户说明意图 | 「请告诉我下一步要推进什么；如果你愿意，我也可以按上次进度继续。」 | — |
| **竞品说明** | 不超过 3 句，围绕「长文知识生产」差异化 | 「福帮手专注 3 万字以上的系统性知识生产…」 | ~~「FBS-BookWriter 专注…」~~ |
| **技能/平台信息** | 提及宿主平台时，区分 WorkBuddy 和 CodeBuddy | 「在 WorkBuddy 中可使用 Tier1 技能…」 | ~~「在宿主平台中…」（模糊）~~ |

### 宿主执行上下文约束（补充说明）

- **联网执行权**：以宿主是否提供 **联网** 为准；WebSearch / WebFetch 工具存在时可用，不存在时降级为 **离线模式** 并按 SDK 指引降级
- **检索约束**：阶段内每轮执行按 [`references/05-ops/search-policy.json`](../05-ops/search-policy.json) 及 [§3.0.5](./section-3-workflow.md#305-强检索写作控制) 执行
- **真值优先原则**：以宿主提供的工具为准，不依赖对话内容易失记忆，不替代某些外部来源

### 版本锁定与跨版本兼容执行

每条新书路径建议执行 **`node scripts/init-fbs-multiagent-artifacts.mjs --book-root <本书根>`** 构建虚拟书房三层底座（含 **`.fbs/project-config.json`**）并维护 **`skillVersion`**（与当时的对应 `SKILL.md` Frontmatter **`version`** 一致），**`lockedAt`**：ISO 时间戳。**版本不一致时**：team-lead 应告知说明不一致、允许继续但建议同步，类比 package.json 锁版本逻辑，参见 [`quality-AI-scan.md`](../02-quality/quality-AI-scan.md)，以及 [`workbuddy-agent-briefings.md`](./workbuddy-agent-briefings.md)。

### 一次性宿主集成摘要（执行摘要）

| 关注点 | 规范位置 |
|--------|----------|
| **单线/多任务/多智能体（风格 · 防断链 · 质量优先）** | [`agent-task-strategy.md`](../05-ops/agent-task-strategy.md) |
| **诺言×代码×用户对齐（P0/P1/P2）** | [`promise-code-user-alignment.md`](../05-ops/promise-code-user-alignment.md)，规范内容 + 约束 P0/P1/P2 |
| **写作范围 vs 维护范围什么** | 以宿主 **规范指令** 系统，约束/维护范围说明 |
| 上下文时序与摘要写法 | [`section-6-tech.md`](./section-6-tech.md) **§6.5.1** |
| **跨阶段记录与工件快速索引** | 以宿主系统品牌保持、台账索引 |

**宿主执行时上下文原则**：

- **阶段简报**：每轮开始时一句话告知当前 ESM 阶段（如「当前处于 S3 写作阶段」）
- **不凭记忆写实**：不应仅凭对话摘要当作磁盘真值，需以 `.fbs/` 目录文件为准
- **无信号要说**：连续无进展时主动告知用户当前状态，询问下一步意图
- **开始写书时说一句**：收到写作指令后先简报「正在写第X章，约N分钟」，再执行
- **写书过程每15轮说一次摘要**：长时间写作中，每 15 轮向用户回报一次进度摘要
- **平台中断时说明**：内容被截断时，简要告知用户并说明如何继续（如「输入"继续"恢复»）

**关于实测工具 P0 初始化流程**：

- 初始化项目记忆前，先确认 `.fbs/` 目录是否存在；不存在时执行 `node scripts/init-fbs-multiagent-artifacts.mjs --book-root <本书根>`
- 写作前核对 `.fbs/project-config.json` 中的 `skillVersion` 与当前 `SKILL.md` version 是否一致
- 时效性信息（如「2024年某数据」）须标注来源；无来源时注明「待核实」，不得伪造引用
- 内容核查须以实际搜索结果为准，AI 自身知识截止日期之后的信息需联网验证

**关于项目上下文约束**：

- **20字以内说清楚目标**：首轮对话时，先确认写作目标（书名/主题/体裁），再进入路径选择
- **不输出裸 HTML 标签**：正文输出使用 Markdown 格式；需要 HTML 时通过 `node <技能根>/assets/build.mjs` 构建
- **Node.js 环境检查**：在引导用户执行脚本前，先确认 Node.js ≥18 已安装

---

## §宿主集成指南（WorkBuddy / CodeBuddy）

### WorkBuddy 宿主特性

WorkBuddy 是一款面向个人的 AI 对话产品，每次对话是**一用户 × 一长对话**形式。Skill 在加载后，**不保证每轮都主动重读全量文档**；宿主的上下文窗口决定了 AI 能看到的历史长度。

**关键约束（P0）**：
- Skill 文件不会被主动"推送"给 AI，需要 AI 主动 `read_file` 加载
- WorkBuddy 与 CodeBuddy 均支持 Sub-Agent；探索 / 审计可派只读子任务，修复 / 写入默认由主智能体或可写 team member 执行
- 子智能体长结果必须先写入工作区 / 记忆文件，再返回短摘要，不能把完整报告直接塞回消息体
- 正文写作默认仍建议单 Agent 或逐章委派；仅大型书稿才启用 Team，并在启用前明确提示风格与协同风险
- 状态跨轮持久化依赖 `.fbs/` 目录下的磁盘文件

**记忆系统分工（P0 · 2026-04-09 明确）**：

宿主提供两层记忆系统，功能互补但**绝不可混写**：

| 维度 | 宿主 Memory（自动，`memory/` 优先兼容 `memery/`） | FBS Smart Memory（按需） |
|------|-----------------------------------------------|--------------------------|
| 维护方 | 宿主自动维护 | FBS脚本/Agent手动维护 |
| 作用域 | 全局（跨项目） | 项目级（单本书稿） |
| 内容 | 用户画像、工作习惯、偏好、设备 | 书稿上下文、写作风格、质量基线、进度状态 |
| 存储位置 | 宿主运行环境目录（WorkBuddy 官方逐步迁移到 `memory/`，并兼容 legacy `memery/`）/ AppData-globalStorage 等宿主维护路径 | `.fbs/`（项目真值）；宿主桥接摘要按需写入 `.fbs/workbuddy-*.json` |
| FBS权限 | **只读**——可读取获取用户偏好，并需兼容 `memory/` 与 `memery/` 老数据 | **读写**——FBS主要记忆载体 |
| 严禁 | ❌ FBS不可写入宿主 Memory | ❌ 不可将宿主 Memory 内容当作书稿真值 |

**分工规则**：
1. FBS读取宿主 Memory 获取用户偏好（如语言、风格倾向），但不写入
2. 书稿领域的所有状态（进度、质量、引用）写入FBS Smart Memory
3. 两个系统的内容可能重叠（如"用户偏好"），但以各自视角独立维护
4. 出现冲突时：用户画像以宿主 Memory 为准，书稿数据以FBS Smart Memory为准

**加载分层策略（WorkBuddy 优化）**：

| 层级 | 触发时机 | 文件 |
|------|---------|------|
| L0 必读 | 每次 Skill 激活 | `SKILL.md` |
| L0' 优先加载 | 首次进入 INTAKE | `intake-and-routing.md`、`section-nlu.md` |
| L1 按需加载 | 进入对应阶段时 | `workflow-s0.md` ~ `workflow-s6.md` |
| NLU 脚本层 | 意图识别时 | `nlu-optimization.mjs` |

**严禁行为（WorkBuddy 宿主）**：
1. 自造菜单替代规范指令系统（`section-4-commands.md` 的 66 条指令是唯一规范）
2. 不检查 Node.js 环境就断言脚本可用
3. 未建立项目上下文（`.fbs/project-config.json`）就跳入写作阶段
4. 把对话摘要当成磁盘真值（真值以 `.fbs/` 文件为准）
5. 连续调用工具而不向用户回报进度

### CodeBuddy Code 宿主特性

CodeBuddy 通道当前对应 **Plugin 包**（`codebuddy/channel-manifest.json`），面向开发者 IDE 场景，支持：
- 多成员并行（Agent Teams）：S3/S5 可用 `team_create` + `send_message` 协同
- 项目级代理目录：`.codebuddy/agents/`
- 插件级元数据：`.codebuddy-plugin/plugin.json`（默认代理为 `fbs-team-lead`）
- MCP 工具扩展（按宿主 MCP 配置文件启用；本仓库当前仍未交付 MCP 产物）

**CodeBuddy 记忆策略**（依据 [官方记忆说明](https://www.codebuddy.cn/docs/cli/memory)）：
- 项目级记忆：写入 `.fbs/` 目录（跨会话持久）
- 会话摘要：`sessions-summary.md` 维护（每轮里程碑后追加）
- 发布后评审/组织意见：写入 `.fbs/org-feedback/`，并同步 `releases/*-release.json`
- 不要依赖对话上下文记忆替代磁盘真值
- 宿主 Memory（`memory/` 优先，兼容 `memery/`）与 FBS Smart Memory 分工见上方"记忆系统分工"表

---

## §1 NLU 意图补充（脚本层扩展）

`section-nlu.md` 定义了 11 个顶级意图。脚本层（`nlu-optimization.mjs`）额外实现了以下意图，**文档与脚本需保持同步**：

| 意图 ID | 中文触发词 | 路由 |
|---------|-----------|------|
| `CHECK_BALANCE` | "查余额"、"乐包余额"、"我的乐包"、"还有多少乐包" | 查询本地乐包账本并回显余额 |
| `UPGRADE_HINT` | "升级"、"解锁场景包"、"购买"、"充值乐包" | 显示场景包解锁说明 |
| `FULL_BOOK_VIEW` | "全书视图"、"书的全貌"、"目录总览" | 输出当前书的完整章节状态 |
| `LIST_COMMANDS` | "全部指令"、"所有命令"、"指令列表" | 输出 section-4-commands.md 摘要 |

**同步要求**：修改以上意图时，必须同步更新：
- `scripts/nlu-optimization.mjs`
- `scripts/nlu-optimization-enhanced.mjs`
- `scripts/consistency-audit.mjs`
- 本文件（`skill-authoritative-supplement.md`）

---

## §2 ESM 状态机说明

ESM（执行状态机）定义了书写过程的合法状态流转：

```
IDLE → INTAKE → RESEARCH → PLAN → WRITE → REVIEW → WRITE_MORE → DELIVER
```

**状态切换规则**：
- 状态切换须满足 `search-policy.json` → `esmAnnouncementAtomicity`（旧→新、原因、自检出口、下一步同次输出）
- P0 阻断条件见 `p0-cli-map.md` 的 `p0AutomationIndex`；脚本存在 = 已执行，以实际命令与退出码为准
- 状态持久化写入 `.fbs/esm-state.md` 与 `.fbs/规范执行状态.md`

**WorkBuddy 中的 ESM 退化风险**：
- WorkBuddy 无脚本执行环境时，ESM 状态只能靠对话推进（纯对话驱动）
- 纯对话驱动时，AI **必须** 在每轮回复中明确宣告当前 ESM 状态
- 禁止在未确认 INTAKE 完成前跳入 WRITE 状态

---

## §5 阶段补丁（v2.0.1 已知问题与修复）

### P0 补丁：WorkBuddy 首次加载路由修复

**问题**：WorkBuddy 首次对话时，AI 未进入 ESM INTAKE 状态，直接响应用户输入而不路由到三条路径。

**修复方案**：
1. 加载 `SKILL.md` 后**立即**加载 `intake-and-routing.md`
2. 判断用户输入信号（素材/主题/无信号）
3. 宣告路径选择（"已确定路径 A/B/C，进入 INTAKE"）
4. **禁止** 在路径判断前输出长菜单或追问

### P1 补丁：乐包账本首装修复

**问题**：`scene-packs/credits-ledger.json` 中 `balance: 80`，首装应为 +100。

**修复方案**：
- `scripts/wecom/lib/credits-ledger.mjs` 中 `_emptyLedger()` 已正确设置初始 balance=0
- 首装事件由 `first_install` 触发，`amount: 100`
- 现有账本 `balance: 80` 为历史测试数据，生产环境应通过重置或手工记账修正

### P2 补丁：NLU 路由缺失修复

**问题**：`CHECK_BALANCE` / `UPGRADE_HINT` 触发词未被 NLU 路由（只在脚本层实现，文档未同步）。

**修复方案**：已在本文件 §1 补充这两个意图的文档定义，需同步到 `section-nlu.md`。

---

## 附录：文档阅读分层

| 层级 | 文件 | 说明 |
|------|------|------|
| L0 | `SKILL.md` | 主规范，每次加载必读 |
| L0' | `intake-and-routing.md` | 首次进入 INTAKE 必读 |
| L0' | `section-nlu.md` | NLU 路由规则，意图识别必读 |
| L1 | `section-3-workflow.md` | 阶段导航（分卷版） |
| L1 | `workflow-s0.md`~`workflow-s6.md` | 各阶段详情（按需加载） |
| L1 | `section-4-commands.md` | 66 条指令完整清单 |
| L2 | `skill-authoritative-supplement.md` | 本文件，平台约束与宿主集成（按需） |
| L2 | `workbuddy-agent-briefings.md` | S3/S5 协同话术（按需） |
| L3 | `references/02-quality/` | 质量规则（写作阶段按需） |
| L3 | `references/05-ops/` | CLI 映射与运维（门禁阶段按需） |

---

## §v2.1.1 全局一致性补充

- 检索执行链以 `search-policy.json` 的 `executionChainIndex` 为准。
- 用户意图映射以 `intent-capability-map.md` 为准，用户侧不暴露技能 ID。
- UX 触发规则以 `ux-optimization-rules.md` 为准（恢复卡、阶段推荐、质检文案、进度仪表盘）。
- 记忆写回遵循分层原则：短期态不进长期记忆，长期仅沉淀策略经验。
