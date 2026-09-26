# 契约汇总

本文件只做索引与汇总；字段的完整定义在对应设计文档与 PR 里。新增字段一律**可选**，保证旧客户端（包括手机端、TUI）能忽略。

---

## 1. HTTP 接口

鉴权列：`runtime` = 现有运行时令牌；`public-gw` = 现有网关凭据；`kgw:<scope>` = harness 范围令牌（P1-07）。

### harness（P0-03、P1-05）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/v1/harnesses?usage=` | runtime | 定义、缓存状态、生效能力；带 `usage` 时附准入结果 |
| POST | `/v1/harnesses/:id/probe` | runtime | 强制重新检测 |
| GET | `/v1/harnesses/:id/models` | runtime | 模型列表（static / provider / probe） |

### activity（P0-08、P1-26、P2-03）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/v1/activity?scope=all\|workspace&workspace=` | runtime | 快照 + 游标 |
| GET | `/v1/activity/events?cursor=&wait_ms=` | runtime | 长轮询（`wait_ms ≤ 30000`）或 SSE（`Accept: text/event-stream`，15 秒心跳）；主进程超时需大于 `wait_ms` |
| POST | `/v1/activity/:unitId/ack` \| `/dismiss` \| `/pin` | runtime | 用户事实，跨端生效 |
| POST | `/v1/activity/foreground` | runtime | renderer 上报前台线程（30 秒过期） |
| POST | `/v1/activity/hooks` | kgw:hook-ingest | 终端 agent hook 事件（≤ 64 KiB） |

### task workspaces（P0-10、P0-12、P1-17、P1-19）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/v1/task-workspaces` | 创建，立即返回 creating |
| GET | `/v1/task-workspaces?ownerThreadId=` · `/:id` | 列表 / 单个 |
| POST | `/:id/cancel` · `/:id/retry` · `/:id/mark-ready` | 创建控制 |
| POST | `/:id/capture` | 采集 |
| GET | `/:id/diff` · `/:id/diff/file?path=` | 审查数据 |
| GET | `/:id/integrate-preview` | 合入可行性（只读） |
| POST | `/:id/integrate` | `{ mode: 'apply-patch' \| 'merge-branch' }` |
| POST | `/:id/discard` | `{ confirm: true }`，未确认返回 409 + 预览 |
| GET | `/:id/setup-log` | setup 日志 |
| GET | `/v1/task-workspaces/preserved-branches?repo=` | 待复核分支 |
| GET | `/:id/attribution?path=` | 逐行归属（P2-06） |

以上路径的前缀都是 `/v1/task-workspaces`，鉴权均为 runtime。

### teams / reviews（P1-13、P1-14、P1-16、P1-18、P2-04）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/teams/by-manager/:threadId` | team、workers、最近 dispatch 与 question |
| GET | `/v1/teams/:managerThreadId/pending-notices` | 未投递的通知（用户发送消息时附带） |
| POST | `/v1/teams/:managerThreadId/notice-hold` | `{ holdMs ≤ 60000 }` |
| POST | `/v1/teams/workers/:workerId/take-over` · `/hand-back` · `/detach` · `/dispatch` | 接管、交还、解除、GUI 派活 |
| POST | `/v1/teams/questions/:questionId/answer` | 用户回答 |
| POST | `/v1/teams/dispatches/:dispatchId/verdict` | 用户验收结论 |
| GET / POST | `/v1/teams/races/:raceId` · `/decide` · `/discard-others` | 赛马（P2-04） |
| GET / POST / PATCH | `/v1/reviews/:workspaceId/comments[/:id]` | 批注 |
| POST | `/v1/reviews/:workspaceId/send` | 发送修改请求 |
| GET | `/v1/threads/:id/handoff-preview?turnId=` | 重建交接简报文本（展示用） |

### worker 回调与终端 agent（P1-07、P2-01、P2-02）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/mcp/kun` | kgw:kun-tools | MCP streamable HTTP 最小子集；GET 返回 405 |
| POST | `/v1/worker-callbacks/progress\|ask\|result\|context` | kgw:worker-callback | 与 worker 工具同一服务 |
| POST | `/v1/execution-units` · `/:id/exit` · `/:id/interrupt-hint` | runtime（主进程调用） | 终端 agent 登记与上报 |

### 模型网关（P1-08、P1-09）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/v1/messages` | public-gw 或 kgw:gateway | Anthropic Messages；harness 令牌可用 `kun/<provider>/<model>` |
| POST | `/v1/messages/count_tokens` | 同上 | 估算值，响应头 `x-kun-estimate: true` |
| （现有） | `/v1/models`、`/v1/chat/completions`、`/v1/responses` | public-gw 或 kgw:gateway | harness 令牌同样可用 |

`kgw_` 令牌访问以上列表之外的任何路径：401（P1-07 的 guard）。

---

## 2. 运行时事件（`kun/src/contracts/events.ts`）

| 事件 | 新增 / 变更 | 字段 | PR |
| --- | --- | --- | --- |
| `delegated_runtime` | 变更 | `providerKind` 加 `acp`；可选 `harnessId`、`capabilitiesV2` | P0-05 |
| `harness_runtime` | 新增 | `harnessId`、`capabilitiesV2`（原生 loop 也发） | P0-05 |
| `harness_session_state` | 新增 | `harnessId`、`commands?`、`configOptions?` | P1-03 |
| `handoff_injected` | 新增 | `harnessId`、`reason`、`mode`、`stats`、`briefDigest` | P0-14 |
| `task_workspace` | 新增 | `workspaceId`、`state`、`progress?`、`setup?` | P0-10 |
| `usage` | 变更 | 可选 `source: 'native' \| 'harness-gateway' \| 'harness-reported'`、`harnessId` | P1-09 |

`RuntimeEventKind` 枚举与 `RuntimeEvent` 判别联合都要加新 kind；renderer 的映射对未知 kind 必须忽略（加一条测试守护，防止旧客户端遇到新事件时出错）。

---

## 3. 字段

| 位置 | 字段 | PR |
| --- | --- | --- |
| `ThreadSchemaBase` / `ThreadSummary` / `CreateThreadRequest` | `harnessId?` | P0-04 |
| `ThreadSchemaBase` / `ThreadSummary` | `executionUnit?`（宿主写入，请求不可设） | P1-10 |
| `ThreadSchemaBase` | `taskWorkspaceId?`（一对一线程绑定任务工作区） | P1-22 |
| `StartTurnRequest` / `TurnSchema` | `harnessId?`、`credentialMode?`（准入时冻结） | P0-04 |
| `ToolHostContext` | `harnessId?`、`executionUnitKind?: 'worker'` | P0-04 |
| `UserMessageSource` | 加 `worker_update` | P1-10 |
| `ChildRunLauncher` | 加 `manager-worker` | P1-10 |
| `ChildRunExecutor` 输入、`runChild`、`resumeChild` | `clientRequestId?`；`runChild` 另加 `childId?`、`executionUnit?`、`harnessId?`、`credentialMode?`、`taskWorkspaceId?` | P1-10、P1-12 |
| `ApprovalActionEnvelopeSchema` | `reviewerRequirement?: 'user'` | P0-16 |
| `DelegatedRuntimeCapabilities`（运行时接口） | 可选方法 `handlesRoute?`、`capabilitiesV2?` | P0-04 |
| `DelegatedProviderKind` | 加 `acp` | P1-02 |
| `DelegatedSessionBinding` | schema v2：`parked?`、`priorItemCount?`、`handoffBriefDigest?` | P0-14、P0-15 |
| `DelegatedSessionPreparation` | `parkedDelta?` | P0-15 |
| `SubagentProfileConfig` | `harnessId?`、`credentialMode?`、`delegationNotes?` | P1-15 |
| `GraphAssignmentReferenceV1Schema`（ephemeral） | `harnessId?`、`credentialMode?` | P1-25 |
| `KunProjectConfigSchema` | `worktree`（`sharedDirectories`、`copyFiles`、`setup`、`checks`、`branchPrefix`） | P0-11、P2-05 |
| `notificationPayloadSchema`（IPC） | `category?` | P1-23 |

---

## 4. 设置

### 4.1 GUI：`agents.kun.*`

| 路径 | 类型 | 默认 | PR |
| --- | --- | --- | --- |
| `harnesses.disabledIds` | `string[]` | `[]` | P0-06 |
| `harnesses.binaryPaths` | `Record<string, string>` | `{}` | P0-06 |
| `harnesses.custom` | `Array<{ id, displayName, command, args, env }>` | `[]` | P0-06 |
| `harnesses.defaultPermissionMode` | `Record<string, string>` | `{}`（缺省取最严档） | P0-06 |
| `harnesses.defaultHarnessId` | `string` | `'kun'` | P0-06 |
| `harnesses.priority` | `string[]` | `[]`（worker 选择的偏好顺序） | P1-15 |
| `ade.enabled` | `boolean` | `false` | P0-06 |
| `ade.harnessRouter` | `boolean` | `true` | P0-06 |
| `ade.deterministicHandoff` | `boolean` | `true` | P0-06 |
| `ade.managerModel` | `{ providerId, model }?` | — | P0-06 |
| `ade.managerMayApprove` | `boolean` | `false` | P0-06 |
| `ade.allowUnattendedFullAccess` | `boolean` | `false` | P0-06 |
| `ade.limits` | `{ softWorkers, hardWorkers }` | `{ 4, 8 }` | P0-06 |
| `ade.budget` | `{ softTokens?, hardTokens? }?` | — | P0-06 |
| `ade.hibernation` | `{ enabled, idleMinutes }` | `{ true, 30 }` | P0-06 |
| `ade.stall` | `{ structuredMinutes, terminalMinutes }` | `{ 10, 20 }` | P0-06 |
| `ade.notifications` | `{ waiting, failed, done, stalled, sound, keepAwake }` | `{ true, true, true, true, false, false }` | P1-23 |
| `worktrees.sharedPaths` | `Record<repoRoot, Array<{ path, mode }>>` | `{}` | P0-11 |
| `projectConfig.grants` | （现有）`Array<{ workspaceRoot, configDigest }>` | — | 复用 |

每一项都要：`src/shared` 类型 + 默认值 + 规范化 → `kunRuntimePatchSchema`（strict）→ config 生成 → kun config schema → `sanitizeKunConfigSections`。

### 4.2 kun `config.json` 顶层新增段

| 段 | 内容 | 由谁生成 |
| --- | --- | --- |
| `harnesses` | `disabledIds`、`binaryPaths`、`custom`、`defaultPermissionMode`、`defaultHarnessId`、`priority` | `harnessesConfigForRuntime` |
| `ade` | 4.1 中除 `notifications` 外的全部 `ade.*`，加 `approvedWorktreeConfigs: Array<{ repoRoot, digest, worktree }>` | `adeConfigForRuntime` |

---

## 5. 持久化文件（均在 `dataDir` 下，`AtomicJsonFile` + Manager 数据互斥）

| 路径 | 版本 | 写入者 | 损坏时 |
| --- | --- | --- | --- |
| `ade/activity-facts.json` | 1 | ActivityStore | 丢弃，用户事实清空 |
| `ade/task-workspaces.json` | 1 | TaskWorkspaceService | 只读报错并保留原文件（记录里有路径，不能静默丢） |
| `ade/teams/<managerThreadId>/team.json` | 1 | TeamStore | 丢弃该 team（线程本身不受影响） |
| `ade/teams/<managerThreadId>/dispatches.json` | 1 | DispatchStore | 同上 |
| `ade/teams/<managerThreadId>/questions.json` | 1 | QuestionStore | 同上 |
| `ade/teams/<managerThreadId>/notices.json` | 1 | WorkerNoticeCoordinator | 同上 |
| `ade/teams/<managerThreadId>/races.json` | 1 | Race（P2-04） | 同上 |
| `ade/reviews/<workspaceId>.json` | 1 | ReviewStore | 丢弃批注并记日志 |
| `ade/attribution/<workspaceId>.json` | 1 | AttributionLedger | 丢弃 |
| `ade/hooks/<unitId>/` | — | hook-config-writer | 单元结束时删除 |
| 委派会话绑定（现有目录） | 1 → 2 | DelegatedSessionCoordinator | 现有逻辑：删除绑定 |
| worktree：`~/.kun/worktrees/tasks/<repo>-<hash>/<workspaceId>` | — | TaskWorkspaceService | 启动扫描只报告，不删除 |

---

## 6. 错误码与文案

i18n 键前缀：`ade.error.<code>`（`src/renderer/src/locales/{en,zh}/common.json`）。kun 返回 `code`，renderer 负责文案；kun 的 `message` 是英文兜底。

| code | 场景 | 中文文案（草案） |
| --- | --- | --- |
| `harness_unknown` | turn 指定了不存在的 harness | 找不到这个 agent，可能已被移除 |
| `harness_unavailable` | 运行时未注册 | 当前版本不支持这个 agent 的接入方式 |
| `harness_not_ready` | 未安装 / 未登录 / 版本过低 | {agent} 还没准备好：{原因}。去设置检查 |
| `capability_missing` | 准入缺能力 | {agent} 不支持{场景}所需的功能：{能力列表} |
| `sandbox_insufficient` | 无沙箱且非隔离工作区 | {agent} 没有沙箱，只能在独立的工作区里运行 |
| `route_unsupported` | 运行时拒绝该路由 | {agent} 不能使用这个模型来源 |
| `harness_crashed` | agent 进程在一轮中退出 | {agent} 意外退出，下一条消息会以新会话继续 |
| `harness_protocol_error` | 协议解析失败 | 与 {agent} 通信出错 |
| `harness_refusal` | ACP stopReason refusal | {agent} 拒绝继续这个请求 |
| `worker_limit` | team 达到硬上限 | 同时运行的 worker 已达上限（{n}） |
| `escalation_declined` | 用户拒绝提升权限 | 已取消：未允许提升 worker 的权限 |
| `workspace_not_git` | 非 git 目录要求 worktree | 这个目录不是 git 仓库，无法创建独立工作区 |
| `start_from_unresolved` | 起点解析失败 | 无法确定起点分支 |
| `workspace_setup_failed` | setup 失败 | 工作区依赖安装失败，查看日志 |
| `integrate_needs_human` | 合入需要人工 | 需要你处理后才能合入：{原因} |
| `integrate_conflict` | rebase / apply 冲突 | 合入时出现冲突，已保留现场 |
| `no_active_dispatch` | worker 在没有派活时调用 ask 等 | 当前没有来自总管的任务 |
| `worker_under_user_control` | 接管期间派活 | 这个 worker 正由你接管，先交还给总管 |
