# 外部编程 Agent 作为私聊对象和群成员：方案

> 状态：首批已实施（2026-10-07）：Codex、Claude Code、OpenCode 可作为私聊对象和群讨论成员，见第 11 节。群内干活（P3）和其余引擎（P4）仍是方案。目标是在 Code 的「对话」里，像跟 Kun Agent 一样，直接和外部编程 Agent 私聊，或者把它们拉进群一起讨论。

## 1. 现状

| 能力 | 现在 | 位置 |
| --- | --- | --- |
| 群成员是谁 | 只有 Kun 自己的 Agent。成员带 `presetId` / `presetSnapshot`（子 Agent 配置）、`modelRef`、`participantAgentId`（Agent 身份） | `kun/src/contracts/rooms.ts` 的 `RoomMemberSchema` |
| 成员怎么发言 | 每次发言建一个附属线程（`relation: 'side'`，带 `roomContext`），按成员的模型连接、工具白名单排队执行一轮 | `kun/src/rooms/room-execution.ts` 的 `ensureRoomThread`、`enqueueRoomTurn` |
| 外部 Agent 怎么干活 | Code 线程可以带 `harnessId`，轮次在受理时被路由到对应外部 Agent | `kun/src/harness/resolve-turn-harness.ts`、`harness-router.ts` |
| 群里能否用外部 Agent | 能，但只能当「派出去的 Code 任务」。Kun Agent 调 `list_code_harnesses` 找到路由，再用 `create_code_task` 派任务，任务以卡片形式出现在对话里；外部 Agent 只支持 direct 模式 | `kun/src/workbench-bridge/code-tools.ts`、`workbench-bridge/harnesses.ts` |
| 工具桥 | Kun 工具可以桥给外部 Agent（Claude Agent SDK 的 MCP、Cursor SDK 的自定义工具、通用的 Kun Tools MCP 服务），而且已经支持「群聊策略」范围的工具列表 | `kun/src/harness/kun-tool-bridge-host.ts` |
| 安全拦截 | 拦外部引擎的条件是「引擎能否关掉自带工具」。目前 Antigravity 和 Cursor SDK 被拦下，因为它们自带的读写和命令工具无法禁用，光桥接工具不够 | `kun/src/server/runtime-factory-model.ts` 的 `roomUnsupportedProviderIdsForOptions` |
| 离线测试夹具 | 已有一个 ACP 协议的 Devin 离线替身，用来测外部 Agent 是否就绪 | `scripts/smoke-rooms-harness-fixture.cjs`、`kun/src/harness/rooms-harness-smoke.test.ts` |

**结论**：执行通道（带 `harnessId` 的线程）和工具通道（工具桥）都已经有了。真正缺的是三样：

- 一个「由外部 Agent 执行」的成员和身份类型；
- 按引擎区分的安全闸门：讨论时只读，干活时才允许写；
- 界面入口：选人、头像、模型选择、就绪状态。

## 2. 目标与不做的事

**目标**

1. 私聊：在「发起对话」里能选 Claude Code、Codex 等编程 Agent，像和小 Kun 聊天一样直接对话，回复由该 Agent 自己生成。
2. 群聊：编程 Agent 可以和 Kun Agent 同群，能被 @、能参与讨论，按协作模式轮流发言。
3. 干活：在群里让编程 Agent 改代码时，它在绑定仓库的隔离工作区里执行，产出可审阅的改动，沿用现有的任务卡片和审批流程。

**不做**

- 不让外部 Agent 担任协调者（coordinator）。规划、自动编排、goal、Graph 仍然只由 Kun 负责，这和现在「外部 Agent 只支持 direct 模式」一致。
- 不把 Kun 的长期记忆注入外部 Agent。只把对话上下文传过去，见 6.3。
- 不支持关不掉自带工具的引擎（Antigravity、Cursor SDK），直到它们提供禁用开关。

## 3. 数据模型

### 3.1 成员执行方

`RoomMemberSchema` 新增 `executor` 字段：

```ts
executor?:
  | { kind: 'kun' }                                   // 缺省；现有成员全部视为这种
  | { kind: 'harness', harnessId: HarnessId,          // 'claude-code' | 'codex' | 'devin' | 'opencode' | ...
      credentialMode: HarnessCredentialMode,          // 'native-login' | 'provider' | 'kun-gateway'
      providerId?: string, model?: string }           // 与 Code 任务的路由同一格式
```

- 和 `create_code_task` 用同一套路由（`harnessId`、`model`、`providerId`、`credentialMode`），统一交给 `WorkbenchHarnessService` 解析和校验：引擎被禁用、未就绪、没有用户同意的配置，都直接报错。
- `executor.kind === 'harness'` 的成员会忽略 `presetSnapshot` 里的模型字段。工具白名单、只读和可写的约束照旧生效（见第 5 节）。

### 3.2 Agent 身份

在 `kun/src/contracts/agent-identities.ts` 的身份里加同样的 `executor`。这样外部 Agent 也有自己稳定的身份，有名字和头像（用 `agent-icon` 的官方图标），可以出现在通讯录和私聊列表里。

- 一个外部引擎可以建多个身份，比如「Codex（订阅）」「Codex（网关）」；每个身份对应一条固定路由。
- 首次创建时从 Code 的外部 Agent 目录导入，只列出已就绪、并且用户同意过的配置。

### 3.3 线程

`ensureRoomThread` 给外部 Agent 成员建线程时，写入 `harnessId`、`credentialMode`、`model`、`providerId`。轮次受理时由 `resolveAdmissionHarness` 路由到对应引擎，不需要新的执行器。

## 4. 执行路径

```
用户 / 其他成员发消息
  → 房间调度器选出要发言的成员（规则不变）
  → ensureRoomThread（外部 Agent 成员时带上 harnessId 等路由）
  → enqueueRoomTurn → HarnessRouter → 对应引擎的 DelegatedTurnRuntime
       · Codex：app-server 协议
       · Claude Code：Agent SDK
       · Devin / OpenCode 等：ACP 协议
  → 工具通过 kun-tool-bridge-host 桥给引擎（群聊范围的工具列表）
  → 回复落成群消息（见 4.1）
```

### 4.1 回复怎么落到对话里

- 现在 Kun 成员在私聊里，正文是内部的，用户能看到的回复必须调 `send_im_message` 发出。
- 外部引擎不一定能稳定调用桥过去的工具，所以给外部 Agent 成员换一种协议：**这一轮最后的助手正文，由宿主直接发成这位成员的一条消息**。中间过程只显示「回复中」。
- 如果引擎支持工具桥（Claude Agent SDK、支持 MCP 的 Codex 和 ACP Agent），还可以开放 `read_room_updates`，按需开放 `send_room_message`，用于群里的同伴协议。

### 4.2 群里让它干活

- 讨论轮：只读，按第 5 节的闸门执行。
- 执行轮（用户在群里明确让它改代码，或者协调者派活）：走现有的房间任务流程，在绑定仓库的隔离工作树里执行。审阅、检查（`declare_room_checks`）、整合流程不变。本质上和现在 `create_code_task` 派给外部 Agent 是同一条路，只是发起者从 Kun Agent 换成了这位成员自己。

## 5. 安全闸门（核心约束）

外部引擎自带读写和命令工具。要进群，必须满足：「讨论时只读」能由引擎强制执行，而不是只靠提示词。

| 引擎 | 讨论轮（只读） | 执行轮（可写） | 结论 |
| --- | --- | --- | --- |
| Claude Code（Agent SDK） | 用 `disallowedTools` 关掉写入和 Bash，只留读工具和桥接工具 | 在隔离工作树里放开 | 可以，最先做 |
| Codex（app-server） | 用 `sandbox: read-only`，配合永不自动批准 | 用 `workspace-write`，限定在工作树内 | 可以 |
| ACP Agent（Devin、OpenCode…） | 选该引擎最严格的权限档位（如 Devin 的 ask）；写入和命令要经 `session/request_permission` 申请，由 Kun 拒绝（`kun/src/runtime/acp/acp-permission.ts`） | 在工作树内按审批策略放行 | 可以，按引擎逐个验证 |
| Antigravity、Cursor SDK | 无法禁用自带工具 | — | 维持拦截 |

- 现成的基础：`kun/src/harness/harness-turn-permissions.ts` 已经把 Kun 这一轮的权限策略映射到各引擎自己的权限档位，并以 Kun 的策略为上限，只读轮会自动选该引擎最严格的一档。要补的是逐个验证「最严格的一档确实禁止写入和执行命令」，并把结论写进引擎能力定义。
- 拦截列表从「按服务商」改成「按引擎能力」。每个引擎在 harness 能力定义里声明 `gatesNativeTools: 'read-only' | 'permission-prompt' | false`，只有能做到只读的引擎才能用于讨论轮。
- 写入一律限定在隔离工作树内，沿用 ADE 的 `permission-clamp`。

## 6. 上下文、记忆与费用

### 6.1 上下文

每一轮把「最近的对话 + 被 @ 的上下文 + 群规则」拼成提示发给引擎，复用 `room-context.ts` 和同伴上下文的拼装逻辑。长对话按现有方式截断。

### 6.2 会话延续

同一个外部 Agent 成员在同一个房间里复用同一个线程。引擎支持会话续接的（Codex 的 thread、Claude SDK 的 session、ACP 的 session），就续接同一个会话，降低成本和延迟。

### 6.3 记忆

外部 Agent 不读写 Kun 的长期记忆。群规则、成员角色说明作为提示的一部分传过去。

### 6.4 费用与用量

- 用量按引擎自报统计，界面标为「由 Agent 计费」，与 Code 现有做法一致。
- 调度器给外部 Agent 成员单独设预算：每轮的时长上限和重试次数，避免群里你来我往地无限循环。

### 6.5 隐私

把外部 Agent 拉进群之前，要提示用户：对话内容会发给该 Agent 所在的服务。

## 7. 界面

- **发起对话**弹窗（`AgentChatPickerHost`）：新增「编程 Agent」一组，数据来自外部 Agent 目录，只列已就绪、用户同意过的配置；未就绪的显示原因，并给出「去设置」的入口。
- **头像**：编程 Agent 用 `agent-icon` 的官方图标，画在圆角方块里（设计稿约定：Kun Agent 用圆形头像，编程 Agent 用圆角方块），一眼就能区分。
- **私聊输入框**：模型按钮复用 Code 的「模型 · 推理强度」面板，模型列表来自该引擎的目录。
- **群成员面板**：显示引擎、模型、就绪状态和「由 Agent 计费」标签；未就绪时成员置灰，并说明原因。
- **消息**：外部 Agent 回复中显示「回复中」；改代码时沿用任务卡片。
- **手机端**：同样的列表和头像；暂不提供添加入口，只能查看和对话。

## 8. 分期

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P0 基础 | `executor` 数据结构（成员和身份）、路由校验、拦截规则改为按引擎能力判断、Claude Code（Agent SDK）讨论轮只读 | 单测：结构校验、各引擎能否进入讨论轮；离线替身跑通一轮私聊 |
| P1 私聊 | 选人弹窗出现「编程 Agent」，私聊一问一答，最终正文落成消息，复用会话，模型面板 | 桌面冒烟：用离线 ACP 替身与 Devin 私聊两轮；暗色截图 |
| P2 群聊 | 外部 Agent 进群，@ 触发、按协作模式轮流发言、预算上限、成员面板状态 | 冒烟：Kun Agent 与外部 Agent 同群讨论，外部 Agent 不能写文件（逐引擎验证） |
| P3 干活 | 群里让外部 Agent 改代码：隔离工作树、任务卡片、审阅和整合 | 冒烟：离线替身在工作树里写入、审阅通过、整合 |
| P4 扩展 | Codex（app-server）、OpenCode 等逐个开放，同伴协议工具（`read_room_updates` / `send_room_message`），手机端 | 每接一个引擎，加一条离线冒烟 |

工作量粗估：P0–P2 约 6–8 天，P3 约 3–4 天，P4 每个引擎 1–2 天。

## 9. 风险

| 风险 | 对策 |
| --- | --- |
| 引擎越权写入 | 按引擎能力判断能否进讨论轮；写入一律在工作树内进行，并有审批流程把关 |
| 慢、贵 | 单轮时长上限、复用会话；外部 Agent 默认只在被 @ 时发言 |
| 登录过期、未就绪 | 发消息前检查就绪状态，在对话里提示，并给出「去设置」的入口 |
| 回复格式不稳定 | 只取最终正文；为空或出错时，在对话里显示失败卡片并支持重试 |
| 隐私 | 首次拉人进群时明确提示内容会发往哪家服务 |

## 10. 已定的问题

1. 首批开放 Claude Code（Agent SDK）、Codex（app-server）、OpenCode（ACP）。三者都能被 Kun 强制只读，其余引擎暂不开放。
2. 外部 Agent 在群里默认只在被 @ 时发言（成员 `attention` 冻结为 `mentions`），群设置里仍可改。
3. 外部 Agent 身份默认用引擎官方图标，名字可改；头像也可换成内置头像，但引擎图标只能给对应的编程 Agent 用。

## 11. 实施记录（2026-10-07）

| 部分 | 做法 | 位置 |
| --- | --- | --- |
| 数据结构 | `AgentExecutor`：`{ kind: 'harness', harnessId, credentialMode, model, providerId?, accountId? }`，`harnessId` 只允许三个首批引擎；身份和成员都带它；头像新增 `{ kind: 'harness', harnessId }` | `kun/src/contracts/agent-executor.ts` |
| 身份 | 写入时经 Code 的同一套路由校验（`WorkbenchHarnessService.resolve`）；只有路由变化才重新校验，引擎路由创建后不能改，只能换模型；Kun 模型、记忆、评审、工作台权限一律关掉 | `agent-identity-service.ts`、`agent-coding-agents.ts` |
| 受理 | 新增用途 `room-conversation`（私聊和群讨论），只要求可中断，接受引擎自带沙箱；协调、执行、评审仍是 `room-execution`，要求 Kun 托管沙箱 | `usage-for-turn.ts`、`harness-admission.ts` |
| 私聊 | 线程带 `harnessId`、`credentialMode`、模型，`mode: 'agent'`，按会话自己的权限运行；不注入 Kun 记忆；本轮最后一段助手正文由宿主发成该成员的消息，`send_im_message` 等 Kun 专用工具被屏蔽 | `agent-direct-runner.ts`、`agent-external-publication.ts` |
| 群讨论 | 只读沙箱，引擎选最严格档位（Codex `read-only`、OpenCode `plan`、Claude Code `default` 且无自带工具）；Codex 和 OpenCode 的提权请求一律拒绝（`approvalPolicy: never`），避免无人值守时卡住 | `room-execution.ts` |
| 群规则 | 群必须由 Kun Agent 牵头（建群和发送时都校验）；外部 Agent 不能承接执行、不能当评审、不参与 Agent 间协作；协调提示里注明它们只参与讨论 | `agent-membership.ts`、`room-request-runner.ts`、`agent-handoff-*.ts` |
| 接口 | `GET /v1/agents/coding-agents` 列出可用引擎和模型；`POST /v1/agents/coding-agents` 按路由找到或创建联系人，换模型时更新同一个联系人 | `register-agent-chat-routes.ts` |
| 界面 | 「发起对话」新增「编程 Agent」一组（引擎图标、模型下拉、未就绪原因）；群聊至少要选一位 Kun Agent；私聊输入框、标题和资料卡显示引擎模型而不是 Kun 模型；引擎图标画在圆角方块里 | `RoomNewChatCodingAgents.tsx`、`RoomCodingAgentParts.tsx`、`RoomAvatar.tsx` |
| 验证 | 单测覆盖受理、只读档位、身份规则、私聊发布、群讨论线程；离线冒烟用一个 OpenCode ACP 替身跑通选人、私聊回复和群里被 @ 后以 plan 模式回复 | `agent-external.test.ts`、`agent-direct-external.test.ts`、`scripts/smoke-coding-agent-*.cjs`（`smoke-development-ade.cjs --coding-agent-only`） |

尚未做：群内让外部 Agent 改代码（P3）、按引擎逐个做真实账号的只读验证、手机端添加入口、外部 Agent 的单轮时长预算。
