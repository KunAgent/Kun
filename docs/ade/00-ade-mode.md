# 00 ADE 作为独立模式

- 日期：2026-09-26
- 决策：ADE 与 Code、Work、Bot（Rooms）并列，是**单独的工作区模式**，不再是 Code 模式里的增强。
- 本文覆盖此前各文档中"在 Code 里加 harness 选择器 / Mission Control 放在 `board` 路由 / 总管工具在 Code 线程上广告"的说法；冲突时以本文为准。

## 1. 为什么单独成模式

1. **风险隔离**：Code 是现有主力模式，大量用户与测试依赖它。ADE 的新路由、新面板、新工具先在独立模式里成熟，Code 行为不变。
2. **心智清晰**：Code = 和 Kun 一起写代码；ADE = 指挥一组 agent（含一对一使用外部 agent）。两者的列表、默认布局、主操作都不同。
3. **可以整体开关**：实验期整个模式在实验室开关后面，关闭时入口消失，数据保留。

## 2. 边界

| 项 | Code | ADE |
| --- | --- | --- |
| 入口 | 模式切换器"Code" | 模式切换器新增"ADE"（与 Work / Code / Bot 并列） |
| 会话列表 | 只显示 Code 线程（排除 ADE 线程） | 只显示 ADE 线程：总管会话、一对一外部 agent 会话；worker 挂在总管下 |
| harness 选择器 | 不加（保持现状；现有订阅 provider 仍可在模型选择器里用） | composer 左侧 agent 选择器（12 §7.2） |
| 总管工具 `worker_*` | 不广告 | ADE 线程上广告 |
| Mission Control | 无 | ADE 模式的首页 |
| Workers / 审查面板 | 无 | 右侧面板 |
| 任务工作区（worktree） | 现有计划 worktree 协议不变 | 宿主持有（07） |
| 运行时底座 | 共用：HarnessRouter、ActivityStore、交接、网关、ACP 在 kun 里对两种模式都生效，只是 Code 不暴露新入口 | 同左 |

底层能力（01–08 的运行时部分）仍是公共的：P0 的路由、能力、状态存储、工作区、交接改动对 Code 透明，这些 PR 不变。

## 3. 数据模型：线程归属

不新增 `agentSurface` 值（`agentSurface` 在 kun 里有 50 多处使用，涉及子代理目录分层、Design 锁定、缓存分区）。ADE 的 turn 仍以 `agentSurface: 'code'` 运行，工具与提示语义和 Code 一致。

新增线程级归属字段：

```ts
// kun/src/contracts/threads.ts：ThreadSchemaBase、ThreadSummary、CreateThreadRequest
workspaceMode: z.enum(['code', 'ade']).optional()   // 缺省视为 code（兼容全部历史线程）
```

- 创建时由 renderer 按当前模式写入；创建后不可修改（`PATCH` 拒绝），避免线程在两个列表间漂移。
- worker 线程继承总管线程的 `workspaceMode: 'ade'`（child executor 建线程时从父线程复制）。
- `GET /v1/threads` 增加过滤参数 `workspace_mode=code|ade`；Code 列表请求带 `code`（服务端把缺省值当作 code），ADE 列表带 `ade`。
- 线程搜索、归档、fork：fork 继承源线程的 `workspaceMode`；搜索结果按当前模式过滤，另提供"在全部模式中搜索"。
- 工具上下文加 `workspaceMode?`（与 `harnessId`、`executionUnitKind` 一同在 P0-04 加入），总管工具门控改为：

```ts
shouldAdvertise = (ctx) => ctx.workspaceMode === 'ade' && (ctx.harnessId ?? 'kun') === 'kun'
  && ctx.executionUnitKind !== 'worker' && !ctx.roomAgent
```

- ADE 专属的每轮动态说明（总管职责、可用 agent 摘要）只在 `workspaceMode === 'ade'` 的 turn 上追加，位于稳定前缀之后，不影响 Code 的缓存。

## 4. 界面结构

```text
模式切换器：Work · Code · ADE · Bot
┌ ADE 左侧栏 ───────────────┬ 中间 ─────────────────────────┬ 右侧面板 ───────────────┐
│ 新建：总管会话 / 一对一     │ 首页 = Mission Control 看板     │ Workers                  │
│ Mission Control (3)        │ 或打开的会话（总管 / 一对一 /    │ 审查                     │
│ ───────────                │ worker）                        │ 终端 / 浏览器 / 文件      │
│ 按状态：待你处理 / 进行中 / │                                │                          │
│ 待审查 / 已完成             │ composer：[agent▾][模型▾]…     │                          │
│ 或按项目                    │                                │                          │
└────────────────────────────┴────────────────────────────────┴──────────────────────────┘
```

- 路由：`AppRoute` 新增 `'ade'`（`src/renderer/src/store/chat-store-types.ts:219`）；`WorkbenchStageRouter.tsx` 新分支渲染 `AdeStage`；`WorkspaceModeTabs.tsx` 的 `WorkspaceMode` 加 `'ade'`，选项放在 Code 与 Bot 之间，图标用 `Network`（lucide）。
- `AdeStage` 复用 Code 的会话舞台组件（`WorkbenchConversationStage`、composer、右侧面板宿主），通过 `mode="ade"` 属性切换：列表数据源、composer 控件、右侧面板集合、新建按钮。**不复制一套聊天界面**。
- `chat-store` 的会话状态按模式分开记住"当前打开的线程"（切回 Code 时回到原来的 Code 线程）。
- 项目看板（`board` 路由）保持原样，不再承载 Mission Control。
- 开关：`agents.kun.ade.enabled`（默认 false，放在实验室）。关闭时模式切换器不显示 ADE；已有 ADE 线程保留，重新打开后可见；Code 列表永远不显示它们。

## 5. 新建会话

| 类型 | 默认 | 说明 |
| --- | --- | --- |
| 总管会话 | harness = kun，模型 = `ade.managerModel` 或当前默认 | 有 `worker_*` 工具；右侧默认打开 Workers |
| 一对一 | 选择 agent（harness）与模型；隔离默认"新 worktree" | 与外部 agent 直接对话；可被总管收编 |

## 6. 对其它文档的修订

| 文档 | 修订 |
| --- | --- |
| README §1、§4、§7 | 两种使用方式都在 ADE 模式内；Code 不变 |
| 01 §10、12 §7.2 | harness 选择器只在 ADE composer 出现 |
| 05 §2、09 §2 | 总管工具门控改为 §3 的 `workspaceMode === 'ade'` |
| 12 §4–§5 | 信息架构与 Mission Control 归属改为 §4 |
| 13 §4 | 红线文档补充：ADE 是第四个工作区模式，只经 Kun HTTP/SSE 边界 |
| impl | 新增 P0-17（模式外壳）；P1-20 改为 ADE 首页；P1-22 只改 ADE composer |

## 7. 实施：P0-17 ADE 模式外壳（M，K R S）

- 分支：`codex/ade-mode-shell`；依赖：P0-06（开关）；应早于 P1-20 / P1-21 / P1-22。

| 文件 | 改什么 |
| --- | --- |
| `kun/src/contracts/threads.ts` | `workspaceMode` 字段；`ListThreadsQuery` 加 `workspace_mode` |
| `kun/src/services/thread-service-metadata-operations.ts:174` | 创建时写入；`PATCH` 拒绝修改 |
| 线程列表 / 搜索服务（SQLite 索引） | 索引列 `workspace_mode`（缺省 code），列表与搜索按它过滤；索引迁移为可重建投影，不改原始 JSON |
| `kun/src/delegation/child-agent-executor.ts:381` | 子线程继承父线程 `workspaceMode` |
| fork 路由 | 继承 |
| `kun/src/ports/tool-host.ts` 与两个 context factory | `workspaceMode` |
| `src/renderer/src/store/chat-store-types.ts` | `AppRoute` 加 `'ade'`；按模式记住当前线程 |
| `src/renderer/src/components/chat/WorkspaceModeTabs.tsx` | 新选项（受开关控制）、i18n `workspaceModeAdeLabel/Description` |
| `src/renderer/src/components/workbench/WorkbenchStageRouter.tsx` | `ade` 分支 → `AdeStage` |
| `src/renderer/src/components/ade/AdeStage.tsx`、`AdeSidebar.tsx`（新） | 复用会话舞台；侧栏按状态 / 项目分组 |
| Code 侧栏数据请求 | 带 `workspace_mode=code` |

测试：

| 用例 | 期望 |
| --- | --- |
| 历史线程（无字段） | 只出现在 Code 列表 |
| ADE 新建线程 | 只出现在 ADE 列表；Code 搜索默认搜不到 |
| worker / fork | 继承 ade |
| 修改 workspaceMode | 被拒绝 |
| 开关关闭 | 模式切换器无 ADE；Code 行为与改动前一致（现有测试全绿） |
| 总管工具 | Code 线程不广告；ADE 线程广告 |
| 切换模式 | 回到各自上次打开的线程 |
