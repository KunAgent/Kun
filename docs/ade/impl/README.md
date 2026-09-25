# ADE 实施拆解：总索引

- 日期：2026-09-25
- 基线：`develop@0cd036104`
- 上层设计：[`../README.md`](../README.md) 与 `01`–`13`
- 本目录：把设计拆成**可以独立合入的 PR**。每个 PR 写清依赖、改哪些文件、函数级实现步骤、测试用例、验证命令、完成标准和回滚方式。

## 1. 文件

| 文件 | 内容 |
| --- | --- |
| [p0-harness.md](./p0-harness.md) | P0-01 ~ P0-06：红线文档、harness 契约与目录、检测、路由接入、准入与能力事件、设置桥 |
| [p0-activity-workspace.md](./p0-activity-workspace.md) | P0-07 ~ P0-12：ActivityStore、任务工作区（抽取、创建、环境补齐、采集合入清理） |
| [p0-handoff.md](./p0-handoff.md) | P0-13 ~ P0-16：交接简报、注入、停泊会话、权限上限基础件 |
| [p1-acp-mcp-gateway.md](./p1-acp-mcp-gateway.md) | P1-01 ~ P1-09：ACP 运行时、工具桥宿主、MCP server、网关协议桥 |
| [p1-manager.md](./p1-manager.md) | P1-10 ~ P1-16、P1-25、P1-26：总管控制面、worker 回调、选择与验收、Graph 衔接、休眠 |
| [p1-review-ui.md](./p1-review-ui.md) | P1-17 ~ P1-24：审查面板、批注、合入、Mission Control、Workers 面板、agent 选择器、通知、设置页 |
| [p2.md](./p2.md) | P2-01 ~ P2-11：终端 agent、CLI 回调、hooks、赛马、检查、归属、PR/CI 等 |
| [flows.md](./flows.md) | 关键流程时序（含失败分支） |
| [contracts.md](./contracts.md) | 汇总：HTTP 接口、事件、字段、设置、持久化文件、错误码 |

## 2. 约定

### 2.1 分支、提交、PR

- 分支：`codex/ade-<短名>`，例如 `codex/ade-harness-router`（仓库规则：新分支用 `codex/` 前缀）。
- 提交：Angular 风格，scope 用模块名：`feat(harness): ...`、`feat(activity): ...`、`refactor(graph): ...`、`docs(ade): ...`。
- PR 一律以 `develop` 为 base（`gh pr create --base develop ...`），正文含 Summary / Changes / Tests；触及 prompt、工具暴露、事件翻译、模型映射、用量计量时附 13 §6 的指标说明。
- 一个 PR 只做表中的一项；抽取重构（P0-09、P1-06、P1-08 的前半）必须与新功能分开提交，便于回滚。

### 2.2 完成标准（每个 PR 都要满足）

1. `npm run typecheck`、`npm test`（或受影响的 vitest 目录）、改动 `kun/` 时 `npm run build:kun`、改动界面时 `npm run build` 通过。
2. `npm run check:file-lines` 通过：新文件和改动后的文件都不超过 700 行；接近上限的现有文件（如 `graph-write-coordinator.ts` 660 行）先拆再加。
3. 新增的持久化文件有 schema 版本号，读取失败有明确降级（丢弃并记日志，或只读报错），不会让运行时启动失败。
4. 新增的设置字段完成四层同步（`src/shared` 类型与规范化 → IPC strict schema → config 生成 → kun config schema + sanitize），并有"两次生成逐字节相同"的测试。
5. 新增的用户可见文案同时加 `en` 与 `zh` 两套 i18n。
6. 开关关闭时（或未使用新功能时）现有行为不变，有对应的回归测试。
7. 基线已知失败（见记忆里的 develop 预存红测）不算回归，但 PR 说明里要列出。

### 2.3 开关

| 开关 | 默认 | 作用 | 引入于 |
| --- | --- | --- | --- |
| `agents.kun.ade.harnessRouter` | true | 走新的 harness 路由；false 回到按 provider kind 推断 | P0-04 |
| `agents.kun.ade.deterministicHandoff` | true | 交接简报；false 回到 48 KiB transcript | P0-14 |
| `agents.kun.ade.enabled` | false | 总管工具、Mission Control 的 Agents 标签、Workers 面板 | P0-06（字段）/ P1-12（生效） |
| `agents.kun.ade.managerMayApprove` | false | 总管代批 worker 审批 | P1-14 |
| `agents.kun.ade.allowUnattendedFullAccess` | false | 无人值守保留完全访问 | P0-05 |
| `agents.kun.ade.hibernation.enabled` | true | 休眠 | P1-26 |

## 3. PR 总表

规模：S ≈ 300 行以内（含测试）；M ≈ 300–900；L ≈ 900–1800。区域：K = `kun/`，M = `src/main`，R = `src/renderer`，S = `src/shared`，D = 文档。

### P0 地基

| ID | 名称 | 规模 | 区域 | 依赖 |
| --- | --- | --- | --- | --- |
| P0-01 | 红线文档改写 | S | D | — |
| P0-02 | harness 契约、内置目录、能力 v2（纯数据与纯函数） | M | K S | P0-01 |
| P0-03 | HarnessDetector 与 `/v1/harnesses` 只读接口 | M | K | P0-02 |
| P0-04 | 线程/turn 字段、HarnessRouter 接入两个组合点、工具上下文字段 | L | K | P0-02 |
| P0-05 | 准入矩阵、`delegated_runtime` 事件扩展、前端降级函数 | M | K R S | P0-04 |
| P0-06 | 设置桥：`agents.kun.harnesses`、`agents.kun.ade` | M | S M K | P0-02 |
| P0-07 | ActivityStore：契约、存储、事件投影、挂载 | M | K S | — |
| P0-08 | Activity 接口、主进程长轮询、renderer store、用户事实持久化 | M | K M R | P0-07 |
| P0-09 | 从 Graph 抽取 worktree 生命周期（行为不变） | M | K | — |
| P0-10 | 任务工作区：契约、存储、创建、接口、事件 | L | K | P0-09 |
| P0-11 | 环境补齐与 setup（复用项目配置批准） | M | K M S | P0-10、P0-06 |
| P0-12 | 采集、合入、丢弃、清理、待复核分支 | M | K | P0-10 |
| P0-13 | 交接简报与工作现场提取（纯函数） | M | K | — |
| P0-14 | 简报注入 SDK / Antigravity、`handoff_injected`、`read_thread_history` | M | K R | P0-13、P0-06 |
| P0-15 | 会话停泊与增量 | M | K | P0-14 |
| P0-16 | 权限上限与升级确认基础件 | S | K | P0-02 |

### P1 总管能派、能看、能判断

| ID | 名称 | 规模 | 区域 | 依赖 |
| --- | --- | --- | --- | --- |
| P1-01 | ACP：JSON-RPC、进程、假 agent 夹具 | M | K | P0-04 |
| P1-02 | ACP：会话管理、config options、能力推导 | M | K | P1-01 |
| P1-03 | ACP：事件映射与工具调用映射 | L | K | P1-02 |
| P1-04 | ACP：客户端方法（fs、终端、权限、取消） | L | K | P1-02、P0-10 |
| P1-05 | ACP：运行时装配、内置定义、冒烟 | M | K | P1-03、P1-04、P1-07 |
| P1-06 | 抽取 `KunToolBridgeHost`（行为不变） | M | K | — |
| P1-07 | `HarnessTokenService`、Kun Tools MCP server、stdio 桥 | M | K | P1-06 |
| P1-08 | 网关公共部分抽取 + Anthropic messages 入口 | L | K | — |
| P1-09 | 网关直接寻址、用量归属、Claude SDK 网关模式 | M | K | P1-08、P1-07、P0-04 |
| P1-10 | ADE 存储、`manager-worker` launcher、`clientRequestId` 透传 | M | K | P0-04 |
| P1-11 | worker 回调工具与服务 | M | K | P1-10、P0-07 |
| P1-12 | 总管工具（一）：`harness_list`、`worker_create(_batch)`、`worker_status/read`、投递与对账 | L | K | P1-10、P0-10、P0-16、P0-05 |
| P1-13 | worker 完成钩子、通知合并与唤醒、`worker_update` 渲染 | M | K R | P1-12 |
| P1-14 | 总管工具（二）：send / stop / release / answer、派活队列、提问、接管与交还 | L | K R | P1-13、P1-11 |
| P1-15 | worker 选择、额度快照、profile 字段 | M | K S M | P1-12 |
| P1-16 | 验收结论、交叉审查 | M | K | P1-14、P0-12 |
| P1-17 | 审查：diff 接口与审查面板 | L | K R | P0-12 |
| P1-18 | 审查：批注、重新定位、批量发送 | L | K R S | P1-17、P1-14 |
| P1-19 | 合入按钮与 `workspace_integrate` | M | K R | P1-17、P0-16 |
| P1-20 | Mission Control（`board` 路由的 Agents 标签） | L | R S | P0-08 |
| P1-21 | Workers 面板、轨道胶囊、接管横幅、任务卡片 | M | R | P1-14、P1-20 |
| P1-22 | composer 的 agent 选择器、模型分组、原生斜杠命令 | M | R K | P0-05、P1-05 |
| P1-23 | 通知接入 ActivityStore | S | R M | P0-08 |
| P1-24 | 设置页：Agents、工作区、总管 | M | R S | P0-06、P0-11 |
| P1-25 | Graph 节点 harness、规划摘要、计划阶段准入 | M | K | P0-05、P1-12 |
| P1-26 | 休眠与卡住检测 | M | K | P0-08、P1-05、P1-12 |

### P2 扩展面

见 [p2.md](./p2.md)：P2-01 终端 agent 登记与 PTY、P2-02 `kun worker` CLI、P2-03 托管 hooks、P2-04 同题赛马、P2-05 检查命令、P2-06 AI 行归属、P2-07 PR 与 CI、P2-08 外部会话接续、P2-09 Mission Control 弹出窗口、P2-10 ACP elicitation、P2-11 外部 harness 的计划构建。

## 4. 关键路径

```text
P0-01 ─ P0-02 ─ P0-04 ─ P0-05 ─────────────┐
                 └─ P1-10 ─ P1-12 ─ P1-13 ─ P1-14 ─ P1-16
P0-09 ─ P0-10 ─ P0-12 ───────────┘            └─ P1-18
P0-07 ─ P0-08 ─ P1-20 ─ P1-21
P1-01 ─ P1-02 ─ P1-03/P1-04 ─ P1-05（第三种 harness 进场）
```

最短可演示路径（"总管派两个 worker：一个 Kun 原生、一个 Claude Code"）：P0-01 → P0-02 → P0-04 → P0-05 → P0-07 → P0-09 → P0-10 → P0-16 → P1-10 → P1-12 → P1-13。这条路径不依赖 ACP 和网关，可以先跑通总管闭环，再并行推进 ACP（P1-01 ~ P1-05）。

## 5. 2026-09-25 核对过的代码事实

以下事实已在代码中确认，设计文档已据此修正；实施时以它们为准：

| 事实 | 位置 | 影响 |
| --- | --- | --- |
| 外部运行时有两个组合点：主运行时与子任务运行时 | `runtime-composition-agent.ts:250`、`runtime-composition-registry.ts:73` | P0-04 两处都要装 HarnessRouter |
| 委派分派点在 turn 生命周期里按 `turn.providerId ?? thread.providerId` 选运行时 | `agent-loop-turn-lifecycle.ts:125-139` | P0-04 的替换点 |
| 产品权限档只有三档：`ask-for-approval` < `approve-for-me` < `full-access` | `kun/src/contracts/policy.ts:39` | P0-16 的排序口径 |
| turn 上没有定时任务 id；无人值守用 `disableUserInput` / `imContext` 判定 | `contracts/turns.ts` | P0-05 的 usage 推导 |
| `startTurn` 支持 `clientRequestId`，按 id + 请求指纹幂等 | `turn-service-admission-operations.ts:474` | P1-10 的派活幂等 |
| `runChild` 支持 `detach`，但没有"续跑已有 child"参数；续跑用 `resumeChild`，带 `expectedResumeCount` 栅栏，同步执行 | `delegation-runtime-run.ts:81`、`delegation-runtime-lifecycle.ts:117` | P1-12 的投递方式 |
| 后台子任务完成后，用"持久化 → 父线程空闲时以带 messageSource 的消息启动一轮 → 指数退避重试 → 启动重放"唤醒父线程 | `delegation-detached-handoff.ts` | P1-13 照搬 |
| `UserMessageSource` 枚举：background_shell / background_subagent / graph_runtime / subagent_resume / design_continuation | `contracts/items.ts:86` | P1-13 新增 `worker_update` |
| 工具用 `LocalToolHost.defineTool`，广告门控是同步的 `shouldAdvertise(ctx)` | `adapters/tool/context-window-tool-provider.ts` | P0-04 给 `ToolHostContext` 加字段 |
| 通用受管进程：`spawnOwnedProcess` / `stopOwnedProcess` | `kun/src/process/owned-process.ts:161` | ACP 进程、终端、setup |
| `BackgroundShellRuntime` 只登记 bash 后台会话，不能启动进程 | `services/background-shell-runtime.ts` | P1-04 另建终端登记表 |
| `ThreadActivityRegistry` 挂在 `observers` 数组上 | `runtime-composition-core.ts:158` | P0-07 同处挂载 |
| 主进程对长轮询路径单独放宽超时 | `src/main/runtime/kun-adapter.ts:293` `runtimeEventsWaitMs` | P0-08 加前缀 |
| 远程白名单按 IPC 通道，`runtime:request` 已放行所有 `/v1` 路径 | `src/main/remote/remote-allowlist.ts` | 新路由无需改白名单 |
| 通知由渲染层驱动：IPC `notification:turn-complete`、`app:badge-count` | `register-app-content-ipc-handlers.ts:425` | P1-23 扩展 |
| 项目配置批准：`agents.kun.projectConfig.grants` 按整份配置 digest | `src/main/services/project-config-service.ts:69` | P0-11 复用 |
| 项目看板已有全页路由 `'board'` | `src/renderer/src/store/chat-store-types.ts:219` | P1-20 复用 |
| composer 组件在 `components/chat/FloatingComposer*` | — | P1-22 命名 |
| 模型流 chunk：`assistant_text_delta`、`assistant_reasoning_delta`、`tool_call_delta`、`tool_call_complete`、`usage`、`completed`、`error`、`retrying` | `kun/src/ports/model-client.ts:32` | P1-08 的出站映射 |
| `ModelRequest` 的历史是 `prefix` / `history: TurnItem[]` | `ports/model-client.ts` | P1-08 的入站映射 |
| kun 只有 MCP 客户端依赖（`@modelcontextprotocol/client`），没有服务端 | `kun/package.json` | P1-07 手写最小服务端 |
