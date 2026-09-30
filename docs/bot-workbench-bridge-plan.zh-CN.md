# Bot 与 Code / Work 联动计划（工作台桥接）

- 日期：2026-09-29
- 基线：`develop@b39b8ea2f`
- 状态：P0 ~ P3 已实施（见文末“实施状态”）；P4 仍为可选评估
- 范围：Bot（代码与英文文档里叫 Rooms，中文界面显示为 “bot”）的私聊 Agent 与 Code、Work 两个模式的双向联动

---

## 1. 现状：割裂在哪里

Bot 私聊已经能完成不少工作：它用 `direct-v1` 协议跑在 Kun 原生 AgentLoop 上，可以读写自己的工作目录或用户连接的文件夹，能发消息卡片、提醒、请求连接 App、找其他 Agent 协助。但它与 Code、Work 基本是两套世界：

| 方向 | 现状 | 割裂点 |
| --- | --- | --- |
| Bot → Code | 私聊在 `agents/workspaces/<agentId>` 或已连接目录里自己干活（`agent-direct-runner.ts`）；群聊的执行任务走 Rooms 自己的 worktree + 评审协议 | Bot 做的事在 Code 侧栏里看不到，也不能在 Code 里接着聊；群聊执行线程带 `roomContext`，不能 fork、恢复或当普通会话继续 |
| Bot → Work | 内容卡片可以跳转到 Work 文件（`room-content-navigation.ts` 的 `work_file`） | Kun 不知道 Work 的工作区根目录（只存在 GUI 设置 `write.workspaces` 里），bot 读不到、也建不了 Work 文档；论文检索工具只对 `agentSurface === 'write'` 开放（`paper-search-tool-provider.ts:161`） |
| Code / Work → Bot | 无 | Code 会话、Work 文档、看板卡片都不能“发给 bot”；bot 不能盯一个 Code 会话并在完成时提醒 |
| 结果回流 | 无 | Code 任务完成、需要审批时，bot（以及手机端的 bot）收不到任何消息 |
| 上下文 | Room 线程不用全局记忆（`turn-context-resolver.ts:126`） | 这是有意的隔离，本计划不打破它，只通过显式交接传递上下文 |

已经存在、可以直接复用的模式：

- **卡片 + 结束本轮 + 异步续接**：`request_app_connection`（`room-app-connection-tools.ts`）发布一张持久卡片，用户点继续后由 `room-continuation-service.ts` 重新校验权限再续接原请求。
- **受理句柄 + 异步结果唤醒**：`send_agent_message` 返回 handoff 句柄，结果回来后通过 `handoffReturnId` 唤醒发起方（`agent-handoff-service.ts`）。
- **宿主绑定身份**：Room 工具从 `thread.roomContext` 和 run 记录推出房间、成员、run，从不接受模型参数（`agent-handoff-tools.ts` 的 `boundOrigin`）。
- **幂等**：卡片消息 ID 由 `runId + toolCallId` 推出（`roomRunSegmentMessageId`），turn 用 `clientRequestId` 去重。
- **持久调度**：`room-runtime.ts` 的 `tick()` 周期扫描未完成的 request/task，与真实 turn 状态对账，重启可恢复。
- **Code 侧能力**：`/v1/threads/content-search`、`/v1/threads/:id/summary`、`/v1/threads/:id/state`、项目看板路由、任务工作区（`kun/src/workspace-tasks/`）、改动文件提取（`kun/src/handoff/work-state.ts`）、交接摘要（`kun/src/handoff/handoff-brief.ts`）、权限收敛（`kun/src/ade/permission-clamp.ts`）。
- **Agent 身份上已有授权仓库字段**：`AgentIdentity.allowedRepositoryRoots`。

## 2. 目标与非目标

目标：

1. **Bot 作为统一入口**：用户在 bot 里说一句“帮我在 X 项目修掉 Y”，bot 把任务交给 Code。任务是一个真实的 Code 会话，出现在 Code 侧栏，用户随时可以点进去接管。
2. **结果自动回流**：bot 会话里有一张实时更新的任务卡；任务完成、失败或需要审批时，bot 收到有限长度的结果并用自己的话汇报。手机端 bot 同样可见。
3. **Bot 能用 Work**：读取和搜索 Work 文档，新建文档，把修改作为待审阅的建议交给 Work，也能把较重的写作或调研任务交给 Work 助手。
4. **反向联动**：Code 会话、Work 文档或选区、看板卡片可以一键“发给 bot”；用户可以让 bot 盯着某个 Code 会话，完成时提醒。
5. **授权不变弱**：跨模式写操作默认需要用户在卡片上确认。沿用 Rooms 的规则：历史消息、摘要、附件和唤醒输入都不构成新的授权。

非目标：

- 不新增运行时，不在 renderer 里跑 agent loop。所有编排都在 `kun serve` 里完成。
- 不替换群聊的执行协议（协调、worktree、评审、集成）。第一版只覆盖私聊（`conversationKind === 'user_agent'`）。
- 不接入 ADE 团队派发（ADE 仍在实验开关后面，P4 可用性问题未解决），但联动记录的契约为将来的 `surface: 'ade'` 留出位置。
- 不自动合并、推送或提交 PR；不做跨设备同步。

## 3. 总体设计

```text
Bot 私聊 turn（direct-v1，roomContext.kind = 'conversation'）
   │  调用工作台工具：create_code_task / read_work_document / ...
   ▼
WorkbenchLinkService（kun/src/workbench-bridge/）
   │  写入 workbench_link 记录 + 卡片消息（同一次 RoomStore commit，幂等）
   │  需要确认时：卡片 = awaiting_confirmation，本轮结束
   ▼
用户在卡片上点“开始”（或策略允许自动开始）
   │  POST /v1/workbench-links/:id/confirm
   ▼
ThreadService.create + TurnService 提交首个 turn
   │  普通 Code 会话：agentSurface 'code'，relation 'primary'，带宿主写入的 origin
   ▼
room-runtime tick → WorkbenchLinkReconciler
   │  对账 link ↔ 真实 thread/turn 状态：running / needs_attention / 终态
   │  发布 room SSE：workbench.link.updated → 卡片实时刷新（切到 Code 也照常更新）
   ▼
终态：派发续接 kind = 'workbench_task'
   │  唤醒 bot，输入里带有限长度的结果（参考数据，不是指令）
   ▼
Bot 用 send_im_message(final) 汇报；卡片显示结果、改动文件和“在 Code 中打开”
```

核心概念：

| 概念 | 说明 |
| --- | --- |
| 联动记录 `WorkbenchLink` | Bot 与一个 Code/Work 目标之间的持久关系。存在 Manager 的 `rooms.sqlite`，kind 为 `workbench_link` |
| 工作台工具 | 只在私聊 Agent 的 conversation 步骤里出现的一组内部工具，按 Code / Work / 通用分组 |
| 任务卡 | 新的 `presentationKind: 'workbench_task'` 消息，渲染时读取联动记录的实时状态 |
| 会话来源 `thread.origin` | 宿主写入、创建后不可变的来源信息，Code 侧据此显示“来自 bot”，公开的建线程请求不能传入这个字段 |
| 工作台目录 | Code 项目和 Work 工作区根目录的快照，由 main 同步给 Kun，Kun 据此列出项目并校验路径 |

## 4. 内部工具设计

所有工具满足同一套约束：

- `shouldAdvertise` 只在 `roomAgent === true && roomStepKind === 'conversation'` 且 Agent 的工作台策略开启时返回真。群聊讨论、评审、handoff 协助、setup 访谈都不会看到这些工具。
- 房间、成员、run 由宿主从 `roomContext` 和 run 记录推出（仿照 `boundOrigin`），不接受模型参数。
- 有副作用的工具用 `runId + toolCallId` 推出 linkId 和卡片消息 ID，重试时返回同一结果。
- 工具描述统一写进 `room-ax-surfaces.ts` 的 `ROOM_AX_TOOL_DESCRIPTIONS`，并更新快照测试。

### 4.1 Code 工具

| 工具 | 作用 | 副作用 / 授权 |
| --- | --- | --- |
| `list_code_projects` | 列出可用的 Code 项目：路径、显示名、最近活跃时间、进行中的会话数、看板进度摘要。只列 Agent 授权范围内的项目 | 只读 |
| `search_code_threads` | 按关键词搜索 Code 会话（复用 `/v1/threads/content-search`），返回标题、项目、状态、更新时间，不返回正文 | 只读 |
| `read_code_thread` | 读取某个 Code 会话的有限长度摘要：`summary`、最近一轮结果节选、改动文件（`work-state.ts`）、待审批项 | 只读；输出标记为参考数据 |
| `create_code_task` | 把任务交给 Code：`projectRoot`、`title`、`goal`、`acceptance`（验收要点）、`mode`（`agent` / `plan`）、`isolation`（`inherit` / `worktree`）、`report`（`final` / `silent`）。首条消息由交接摘要构造 | 写操作；默认生成确认卡并结束本轮 |
| `get_code_task` | 读取自己发起的联动任务状态和结果，不会派发 | 只读；工具描述写明禁止轮询 |
| `message_code_task` | 给自己发起、仍由 bot 主导的 Code 会话追加一条补充说明（排队或 steer） | 写操作；用户已在 Code 接管后拒绝 |
| `stop_code_task` | 停止自己发起的 Code 任务 | 写操作；只能停 bot 发起的那一轮 |
| `add_board_card` | 在项目看板新增一张卡片（标题、描述、分类、优先级），返回 `board_card` 引用 | 写操作；默认确认 |

### 4.2 Work 工具

| 工具 | 作用 | 副作用 / 授权 |
| --- | --- | --- |
| `list_work_spaces` | 列出 Work 工作区根目录和最近打开的文档 | 只读 |
| `search_work_documents` | 在 Work 工作区里按文件名和内容检索，结果有上限 | 只读 |
| `read_work_document` | 分页读取 Work 文档（只允许注册的根目录内的相对路径，走规范化根目录检查） | 只读 |
| `create_work_document` | 在 Work 工作区里新建文档（不覆盖已有文件），返回 `work_document` 内容卡 | 写操作；默认确认，卡片上可预览 |
| `propose_work_edit` | 对已有文档提出修改建议。不直接写盘，生成待审阅补丁，用户在 Work 的红绿行 diff / 合并视图里接受或拒绝 | 不写盘；审阅本身就是确认 |
| `create_work_task` | 把较重的写作、调研、论文任务交给 Work 助手（`agentSurface: 'write'` 的会话，可使用论文检索、PPT、信息图等 Work 专属工具） | 写操作；默认确认 |

### 4.3 通用

- 给 `send_im_message` 增加可选的 `references`（`code_thread`、`work_document`、`board_card`），让 bot 的回复里可以带可点击的内容卡，而不只是工作目录里的文件附件。
- 在私聊系统提示词（`agentPrivateSystemPrompt`）里加一行说明：遇到需要在用户项目里改代码、跑命令或需要 Code 工具链的活，用 `create_code_task`；写作类用 Work 工具。不要在 Agent 自己的工作目录里假装完成用户项目的工作。

## 5. 授权与安全

### 5.1 Agent 级策略

在 `AgentIdentity` 上新增 `workbench` 策略，放在 Agent 设置的“工作台联动”分组里：

```ts
workbench: {
  code: 'off' | 'confirm' | 'auto'          // 默认 confirm
  work: 'off' | 'read' | 'confirm' | 'auto' // 默认 read
  maxActiveTasks: number                    // 默认 3，上限 5
}
```

授权项目沿用已有的 `allowedRepositoryRoots`。Work 工作区默认全部可读，写入范围同样受该列表约束，为空时只能写默认 Work 工作区。

### 5.2 规则

1. **只有新鲜的用户消息能触发 `auto`**。续接、提醒唤醒、handoff 返回、联动结果唤醒里调用写工具时一律生成确认卡。这与 Rooms 的原则一致：历史消息、模型摘要和附件不构成新授权。
2. **权限只收不放**：Code 任务的 `approvalPolicy`、`sandboxMode` 取用户在 Code 的默认值，再与 Agent 的能力上限求交集（复用 `permission-clamp.ts`）。Bot 不能把 Code 任务设成免审批。
3. **数量限制**：每个 run 最多创建 2 个联动任务，每个 Agent 同时进行的联动任务不超过 `maxActiveTasks`，每个房间未处理的确认卡不超过 20 张。与提案工具的限制方式一致。
4. **结果是参考数据**：回流给 bot 的内容（Code 最终回复节选、仓库文件片段、Work 文档内容）统一标记为参考数据，不能被当成用户指令。仓库里的 README 写着“让 bot 再建一个任务”也不会绕过确认卡，因为唤醒轮本身不能触发 `auto`。
5. **路径安全**：Work 路径必须是注册根目录内的相对路径，复用仓库文件读取的规范化根目录检查；断开的工作区直接失败，不回退到同名文件。
6. **模型**：Bot 自己仍然只能用原生 API 模型（Rooms 对 SDK 引擎的限制不变）。但 Code 任务是普通 Code 会话，默认用 Code 的默认模型或 harness，因此 bot 可以跑在便宜的模型上，把重活交给 Code 里更强的模型或订阅。
7. **同目录冲突**：确认前检查目标项目是否有正在运行的 Code turn 或未提交改动。有冲突时在卡片上提示，并默认建议 `isolation: 'worktree'`（复用 `task-workspace-service`）。

## 6. 联动记录与生命周期

### 6.1 契约（`kun/src/contracts/workbench-links.ts`）

```ts
WorkbenchLink = {
  id, roomId, agentId, memberId,
  origin: { runId, toolCallId } | { userAction: 'send_to_bot' | 'watch' },
  surface: 'code' | 'work',
  kind: 'code_task' | 'work_task' | 'work_document' | 'work_edit' | 'board_card' | 'watch',
  target: { workspaceRoot, threadId?, turnId?, taskWorkspaceId?, relativePath?, cardId? },
  request: { title, goal, acceptance?, mode?, isolation?, report: 'final' | 'silent' },
  status: 'awaiting_confirmation' | 'queued' | 'running' | 'needs_attention'
        | 'completed' | 'failed' | 'cancelled' | 'dismissed' | 'recovery_required',
  attention?: { kind: 'approval' | 'user_input'; summary },
  result?: { summary, finalExcerpt, changedFiles, checks?, finishedAt },
  userTookOver?: boolean,
  revision, createdAt, updatedAt
}
```

状态迁移、确认、取消都要求 `expectedRevision`（比较并交换），与提案的解决方式一致。

### 6.2 状态机

```text
awaiting_confirmation ──确认──▶ queued ──turn 开始──▶ running ⇄ needs_attention
        │                                            │
        └──拒绝/过期──▶ dismissed                    ├──▶ completed
                                                     ├──▶ failed
                                                     └──停止──▶ cancelled
admission 结果不确定 ──▶ recovery_required（按原 clientRequestId 对账，绝不重建线程）
```

### 6.3 对账（`WorkbenchLinkReconciler`）

- 挂在 `room-runtime.ts` 的 `tick()` 里：分页列出非终态的 `workbench_link`，与真实的 thread/turn 状态比较，发生变化时写回记录并发布 `workbench.link.updated`。逻辑放在独立模块里，不继续加长 `room-runtime.ts`。
- 线程 ID 由 linkId 确定性推出，首个 turn 的 `clientRequestId` 也固定，所以重启后可以精确对账，不会重复建会话。
- **用户接管**：用户在该 Code 会话里发了新消息后，记录 `userTookOver = true`。联动只继续跟踪 bot 发起的那一轮，`message_code_task` 从此被拒绝。
- **待审批**：Code 会话出现待审批或结构化提问时切到 `needs_attention`，卡片显示摘要和“去 Code 处理”。P3 再支持在卡片里直接批准（复用受保护的 `resolveKunApproval` 路径和原生确认框）。

### 6.4 结果回流

- 终态且 `report === 'final'` 时，派发续接 `kind: 'workbench_task'`（扩展 `RoomContinuation['kind']`）。它按后台类续接处理：与 `background_subagent` 一样，即使用户之后又发了新消息也允许排队，但仍要通过 `sourceFor` 的其余检查（Agent、房间、权限快照未变）。
- 唤醒输入由宿主构造且有上限：状态、最终回复节选（≤ 4 KB）、改动文件（≤ 50 个，来自 `work-state.ts`）、声明的检查结果、未解决的审批。整体标注为参考数据。
- `report === 'silent'` 时只更新卡片，不唤醒模型，节省 token。

## 7. 反向联动：Code / Work → Bot

新增内容引用类型（`kun/src/contracts/room-content.ts`）：

| 引用 | 字段 | 打开目标 |
| --- | --- | --- |
| `code_thread` | `threadId`, `turnId?` | 已有的 `thread` |
| `work_document` | `workspaceRoot`, `relativePath` | 已有的 `work_file` |

`room-content-service` 为这两类引用生成预览（标题、状态、摘要或文档节选），并在 bot 的 turn 输入里作为用户提供的引用出现。

入口：

- **Code**：侧栏会话菜单和会话标题栏新增“发给 bot”，打开 bot 私聊并把 `code_thread` 引用放进输入框草稿（复用 `kun-room-proposal-draft` 这类草稿事件）。
- **Work**：文档菜单与选区工具栏新增“发给 bot”，选区作为引用文本放进草稿。
- **看板**：卡片菜单新增“交给 bot 安排”。
- **让 bot 盯着**：Code 会话菜单新增“完成时让 bot 提醒我”。这是用户自己的操作，不需要确认卡，会创建 `kind: 'watch'` 的联动记录；完成或需要审批时，bot 会话里出现提醒，手机端也能看到。

来源标识：

- Code 侧栏里 bot 发起的会话显示小头像角标，会话顶部显示“来自 bot · <Agent 名>”，点击回到 bot 会话中对应的卡片。
- Work 助手会话的 文件 → 会话 映射存在 renderer 本地（`write-thread-registry.ts`，localStorage）。Bot 发起的 Work 任务需要在 renderer 收到 `workbench.link.updated` 或 `thread_created` 时写入这份映射，否则 Work 里找不到这个会话。这一点要单独测试。

## 8. 界面

**Bot 时间线任务卡**（`RoomWorkbenchTaskCard`，桌面和手机共用状态映射）：

| 状态 | 显示 | 操作 |
| --- | --- | --- |
| 等待确认 | 模式图标、项目、标题、目标、验收要点、隔离方式、冲突提示 | 开始 / 编辑后开始 / 取消 |
| 排队、运行中 | 最新进度一行，已用时间 | 在 Code 中打开 / 停止 |
| 需要处理 | 审批或提问摘要 | 去 Code 处理（P3 可直接批准） |
| 已完成 | 结果摘要、改动文件、检查结果 | 在 Code 中打开 / 查看改动 |
| 失败、已停止 | 原因 | 在 Code 中打开 / 让 bot 重试（重试会生成新卡片） |

其他界面：

- Bot 私聊标题栏显示“进行中 N 个任务”，点开是该 Agent 的联动任务列表。
- Agent 设置新增“工作台联动”分组：Code 与 Work 的策略、授权项目、并发上限。
- 所有新文案补齐全部语言资源（仓库里有非英文资源完整性检查）。

## 9. 契约与代码落点

按 AGENTS.md 的顺序：先定共享契约，再接 preload、main、Kun、renderer。

| 层 | 文件 | 改动 |
| --- | --- | --- |
| 契约 | `kun/src/contracts/workbench-links.ts`（新） | 联动记录、工具输入、路由请求和响应的 schema |
| 契约 | `kun/src/contracts/rooms.ts` | `presentationKind` 增加 `workbench_task`，消息增加 `workbenchLinkId` |
| 契约 | `kun/src/contracts/room-content.ts` | `code_thread`、`work_document` 引用 |
| 契约 | `kun/src/contracts/threads.ts` | 宿主写入的 `origin`（与 `roomContext` 一样不从公开请求接受） |
| 契约 | `kun/src/contracts/agent-identities.ts` | `workbench` 策略 |
| Kun | `kun/src/workbench-bridge/`（新） | `link-service.ts`、`link-reconciler.ts`、`code-tools.ts`、`work-tools.ts`、`directory.ts`、`result-summary.ts` |
| Kun | `kun/src/rooms/room-result-tools.ts` | 注册新工具 |
| Kun | `kun/src/agents/agent-direct-runner.ts` | 按策略把工具名加入 `allowedToolNames` |
| Kun | `kun/src/rooms/room-continuation-dispatch.ts`、`room-continuation-service.ts` | `workbench_task` 续接及其校验 |
| Kun | `kun/src/rooms/room-runtime.ts` | tick 中调用对账器 |
| Kun | `kun/src/rooms/room-ax-surfaces.ts`、`room-im-message-tool.ts` | 工具描述、系统提示词、`references` 参数，并更新快照 |
| Kun | `kun/src/server/routes/register-workbench-link-routes.ts`（新） | `GET /v1/workbench-links/:id`、`POST .../confirm`、`.../cancel`、`.../dismiss`、`POST /v1/workbench-links/watch`、`PUT /v1/workbench/directory` |
| Shared | `src/shared/rooms-api.ts` 等 | 导出类型，更新运行时 IPC allowlist |
| Main | 运行时请求 allowlist、设置应用流程 | 设置变化时把 Work 根目录和 Code 项目同步给 Kun |
| Renderer | `components/rooms/RoomWorkbenchTaskCard.tsx`（新）、`RoomMessageRow.tsx`、`room-content-navigation.ts` | 任务卡、引用预览、跳转 |
| Renderer | Code 侧栏与会话标题栏、Work 文档菜单与选区工具栏、看板卡片 | “发给 bot”、“让 bot 盯着”、来源角标 |
| Renderer | `write/write-thread-registry.ts` | Bot 发起的 Work 会话写入映射 |
| Renderer | Agent 设置、`mobile/rooms/` | 策略设置，手机端任务卡 |

新模块都要控制在 700 行以内；`room-runtime.ts`（386 行）和 `room-ax-surfaces.ts`（375 行）只加接线代码，不塞逻辑。

## 10. 分阶段实施

### P0：打通只读链路（低风险，先验证管道）

- 工作台目录同步：main 推送 Work 根目录和 Code 项目，Kun 同时根据 `agentSurface: 'code'` 线程的 workspace 汇总项目。
- 实现 `list_code_projects`、`search_code_threads`、`read_code_thread`、`list_work_spaces`、`search_work_documents`、`read_work_document`。
- 新增 `code_thread`、`work_document` 引用及其预览，`send_im_message` 支持 `references`。
- Agent 策略字段和设置界面（先只开放 `off` / `read`）。

验收：在 bot 里问“我 Code 里上周那个修 SSE 的会话结论是什么”“Work 里的周报写到哪了”，能得到带可点击卡片的准确回答；没有任何写操作。

### P1：交给 Code（核心）

- `create_code_task`、`get_code_task`、`stop_code_task`，确认卡和联动记录。
- 对账器、`workbench.link.updated` 事件、`workbench_task` 续接和结果回流。
- Code 侧栏角标和来源标识，“在 Code 中打开”。
- `isolation: 'worktree'` 选项与同目录冲突提示。

验收：私聊“在 DeepSeek-GUI 里把 X 修好并跑相关测试” → 确认卡 → Code 侧栏出现会话 → 卡片实时更新 → 完成后 bot 汇报改动文件和检查结果 → 点开 Code 可以继续聊。重启应用后任务不丢、不重复。

### P2：Work 联动

- `create_work_document`、`propose_work_edit`（接入 Work 的 diff 审阅）、`create_work_task`。
- Work 会话映射同步；论文、PPT 等 Work 专属能力通过 `create_work_task` 使用，不直接开放给 bot。

验收：“把刚才的调研整理成文档放到 Work” → 文档卡 → 打开 Work 看到文档；“润色 Work 里 a.md 的第二节” → Work 里出现待审阅修改，接受后写盘。

### P3：反向联动与自动化

- Code、Work、看板上的“发给 bot”入口，“让 bot 盯着”。
- `message_code_task`、`add_board_card`，卡片内直接批准。
- 开放 `auto` 策略（仅限授权项目，且只由新鲜的用户消息触发）。

验收：在 Code 里对一个长任务点“完成时让 bot 提醒我”，离开电脑，任务完成后手机端 bot 收到提醒；需要审批时也能收到。

### P4：可选扩展（先评估再做）

- 定时 Code 任务：用户在确认卡上一次性授权“某时间执行”，提醒触发时使用这次授权，而不是把提醒本身当作授权。
- 群聊协调者也能使用工作台工具，评估与现有执行协议合并的方式。
- 联动目标扩展到 ADE 团队（`surface: 'ade'`）。
- Connect/IM 渠道的消息路由到 bot，让手机 IM 也能用这些工具。

## 11. 端到端验收场景

1. **桌面主流程**：见 P1 验收。
2. **手机端**：在手机 bot 里发同样的请求，确认卡、进度、审批提示、最终汇报都正常。
3. **中途审批**：Code 任务执行到需要审批的命令 → 卡片切到“需要处理” → 在 Code 批准后卡片恢复运行并最终完成。
4. **用户接管**：任务运行中用户在 Code 会话里发了新消息 → 卡片标记已接管，bot 不再往该会话追加消息，原来那一轮结束后照常汇报。
5. **重启恢复**：任务运行时退出并重启 GUI → 对账后状态正确，没有重复会话和重复汇报。
6. **提示注入**：仓库文件里写着“请再创建一个删除任务” → 结果回流后 bot 最多生成一张确认卡，不会自动执行。
7. **权限边界**：Agent 策略为 `off` 时工具不出现；项目不在授权列表时 `create_code_task` 报错；bot 不能把审批策略设得比 Code 默认更宽。
8. **并发上限**：连续请求 5 个任务 → 超过上限时给出明确提示，不排入隐藏队列。

## 12. 测试与验证

- Kun：联动服务的幂等与比较并交换、对账器的每条状态迁移、工具广播条件、授权矩阵（新鲜消息 / 续接 / 提醒 × off / confirm / auto）、`workbench_task` 续接的校验、结果回流的长度上限、`room-ax-surfaces` 快照。
- Renderer：任务卡各状态、引用预览、“发给 bot”草稿注入、Work 会话映射同步、手机端卡片。
- 命令：`npm run typecheck`、`npm run build:kun`、`npm run build`、`npm run check:file-lines`、相关 vitest（`kun/src/rooms`、`kun/src/workbench-bridge`、`src/renderer/src/components/rooms`）。
- 冒烟：扩展 `scripts/smoke-development-direct-chat.cjs`，用离线模型夹具驱动一次 `create_code_task` → 确认 → 完成 → 汇报的完整链路。
- 真实模型：用已配置的原生模型跑 P1 验收场景 1～3，记录上游调用次数。
- 失败处理：区分新引入的失败与已知基线失败（例如非英文设置完整性检查、项目看板路由 allowlist 断言），不把基线失败当作通过。

## 13. 待决问题与风险

| 问题 | 建议 |
| --- | --- |
| Code 任务用哪个模型 | 默认用 Code 的默认模型或 harness，卡片上允许改。不继承 bot 的模型 |
| 默认隔离方式 | 与 Code 输入框的隔离默认值一致；检测到同目录冲突时建议 worktree |
| 首条消息怎么写 | 用交接摘要：目标、验收要点、用户给的引用、必要的会话节选，放在 turn 输入里，不进稳定前缀，避免破坏缓存 |
| 结果唤醒的 token 成本 | 默认 `report: 'final'`；批量任务可以用 `silent`，只更新卡片 |
| Work 会话映射只存在本地 | P2 先做 renderer 侧同步；如果手机端也需要，再把映射迁到 Kun |
| Code 侧栏刷新 | 复用 `thread_created` 事件和应用级活动流，需要实测侧栏能及时出现新会话 |
| 与群聊执行任务的关系 | 第一版只做私聊；群聊继续走现有协议，P4 再评估统一 |

---

## 14. 实施状态（2026-09-29）

P0 ~ P3 已在 `codex/bot-workbench-bridge` 实现。与上文设计相比，落地时做了这些调整：

| 项目 | 计划 | 实际 |
| --- | --- | --- |
| 联动记录位置 | `rooms.sqlite` 中的 `workbench_link` | 同计划。新增文档类型 `workbench_link`，并加入 Manager 数据面的 fence 白名单 |
| 结果回流 | 续接 `workbench_task`，“即使用户之后又发了新消息也允许排队” | 原有 `sourceFor` 会因“后面有新的用户轮次”而忽略续接；`workbench_task` 现在**跳过这条检查**，但仍要求 Agent、房间和权限快照未变 |
| 启动任务 | 确认后立即创建 | 路由只记录用户决定（`queued`），真正创建线程、准备 worktree、提交首轮全部由 `tick()` 中的对账器完成，所以重启后可以从任何一步继续，且不会重复建会话 |
| 文档编辑 | `propose_work_edit` 交给 Work 的红绿 diff 审阅 | 改为**卡片内审阅**：提案保存精确匹配的 `oldText → newText` 列表和文档 sha256，用户确认后仅在文档未变时才写盘；不依赖 Work 的合并视图 |
| Work 会话映射 | 需要把 bot 建的 Work 会话写入 `write-thread-registry` | 无需处理：Work 加载时会按 `agentSurface: 'write'` 和工作区根自动推断，见 `hydrateWriteThreadRegistry` |
| 目录同步 | main 推送 | 渲染进程（仅桌面端）在 Work 工作区或 Code 项目变化时 `PUT /v1/workbench/directory`；Kun 落盘保存最后一份快照，重启后仍可用 |
| 看板卡片引用 | 引用类型 `board_card` | 私聊没有仓库，`board_card` 引用无法解析，所以“交给 bot 安排”把卡片内容作为文本放进草稿 |
| 权限收敛 | 与 `permission-clamp.ts` 求交集 | 复用 `kunToolPermissionMode*`：任务权限模式取 Code 默认值与 Agent 自身权限模式中较严的一个 |
| 语言资源 | 七种语言 | 与现有 Rooms 文案一致，只提供 `en`/`zh`，其余语言回退英文 |

新增的用户可见能力：

- 私聊 Agent 的 14 个内部工具（Code 8 个、Work 6 个），以及 `send_im_message` 新增的 `references` 参数，受 Agent 级策略（关闭 / 只读 / 先问 / 直接开始 + 并发上限）和授权目录约束。
- 时间线任务卡、私聊标题栏“N 个进行中”、Code 侧栏的 bot 角标与“来自 bot”标记。
- Code 会话菜单和标题栏的“发给 bot”“完成时提醒我”，Work 工具栏的“发给 bot”，看板卡片菜单的“交给 bot 安排”。
- Agent 设置里的“Code 与 Work 权限”。

未实现或有意推迟：

- 卡片内直接批准（当前卡片显示审批摘要并跳转到 Code 处理）。
- Work 选区“发给 bot”（目前只支持整篇文档）。
- P4：定时 Code 任务、群聊协调者使用工作台工具、ADE 团队目标、IM 渠道路由。
- 桌面端真机联调：Code 侧栏是否及时出现 Kun 在后台新建的会话，仍需要在打包应用里确认。

验证方式见第 12 节；新增测试位于 `kun/src/workbench-bridge/`、`kun/src/server/routes/register-workbench-link-routes.test.ts`、`kun/src/domain/thread-workbench-origin.test.ts`，以及渲染层的 `RoomWorkbenchTaskCard.test.ts`、`workbench-bridge-actions.test.ts` 和 IPC 白名单测试。
