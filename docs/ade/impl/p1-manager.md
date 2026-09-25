# P1-10 ~ P1-16、P1-25、P1-26：总管控制面

设计依据：[05 §2](../05-worker-callbacks.md)、[06 §6–§7](../06-activity-store.md)、[09](../09-manager-control-plane.md)、[10](../10-worker-selection-quality.md)。

---

## P1-10 ADE 存储、`manager-worker` launcher、`clientRequestId` 透传（M，K）

- 分支：`codex/ade-manager-foundation`；提交：`feat(ade): team/dispatch stores and idempotent child starts`
- 依赖：P0-04

### 契约

| 文件 | 改什么 |
| --- | --- |
| `kun/src/contracts/threads.ts` | `ThreadSchemaBase` 加 `executionUnit`（09 §3.1）；`ThreadSummary` pick 加 `executionUnit: true`；`CreateThreadRequest` 不开放该字段（只能由宿主写） |
| `kun/src/contracts/ade.ts`（新） | `TeamRecordSchema`、`WorkerRecordSchema`、`DispatchRecordSchema`、`QuestionRecordSchema`、`WorkerNoticeSchema`、`QualityVerdictSchema`（09 §3.2、10 §4.1），全部 `.strict()`，带 `version: z.literal(1)` 的文件外壳 |
| `kun/src/contracts/items.ts:86` | `UserMessageSource` 加 `'worker_update'` |
| `kun/src/delegation/delegation-runtime-contracts.ts:86` | `ChildRunLauncher` 加 `'manager-worker'` |
| 同文件 `ChildRunExecutor` 输入（约 353 行） | 加 `clientRequestId?: string` |

### 实现

| 文件 | 内容 |
| --- | --- |
| `kun/src/ade/ade-paths.ts` | `adeTeamDir(dataDir, managerThreadId)` 等路径函数；线程 id 经 `safeId` 过滤 |
| `kun/src/ade/team-store.ts` | `FileTeamStore`：`ensure(managerThreadId, limits)`、`get(teamId)`、`byManager(threadId)`、`upsertWorker`、`worker(teamId, workerId)`；每个 team 一个 `team.json` |
| `kun/src/ade/dispatch-store.ts` | `dispatches.json`：`create / get / update / listByWorker / findByClientRequestId / listByState`；状态转换在 `update` 里校验（非法转换抛错，例如 completed → pending） |
| `kun/src/ade/question-store.ts`、`worker-notice-store.ts` | 同样模式 |
| `kun/src/delegation/child-agent-executor.ts:~440` | `turns.startTurn` 的 `request` 加 `...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {})` |
| `kun/src/delegation/delegation-runtime-run.ts:81`、`delegation-runtime-lifecycle.ts:117` | `runChild` / `resumeChild` 的输入加 `clientRequestId`，透传给 executor |
| `kun/src/delegation/delegation-runtime-contracts.ts:127` | `isGenericChildLauncher('manager-worker') === false` |
| 线程删除级联 | `core.stopThreadAuxiliaryWork`（`runtime-composition-agent.ts` 约 262 行）里：删除总管线程时删除 team 目录并撤销该 team 所有 worker 的令牌；删除 worker 线程时把它在 team 里的记录标为 `released` |

状态转换表（`dispatch-store.ts` 里的常量）：

```ts
const ALLOWED: Record<DispatchState, readonly DispatchState[]> = {
  pending: ['delivering', 'cancelled', 'failed'],
  delivering: ['accepted', 'uncertain', 'failed'],
  uncertain: ['accepted', 'delivering', 'failed'],
  accepted: ['completed', 'failed', 'cancelled'],
  completed: [], failed: [], cancelled: []
}
```

### 测试

| 用例 | 期望 |
| --- | --- |
| 同一 `clientRequestId` 调两次 runChild | 只有一个 turn（`findIdempotentStart` 生效） |
| 同 id 不同 prompt | 第二次报错（指纹不一致） |
| resumeChild 透传 | 续跑的 turn 带该 id |
| 非法状态转换 | 抛错 |
| 删除总管线程 | team 目录删除、令牌撤销 |
| 文件损坏 | 读取时丢弃并记日志，返回空 team（不影响线程本身） |

---

## P1-11 worker 回调工具与服务（M，K）

- 分支：`codex/ade-worker-callbacks`；依赖：P1-10、P0-07

### 新增

| 文件 | 内容 |
| --- | --- |
| `kun/src/services/worker-callback-service.ts` | `reportProgress(workerThreadId, input)`、`askManager(workerThreadId, input, signal)`、`readManagerContext(workerThreadId, input)`、`submitResult(workerThreadId, input)` |
| `kun/src/adapters/tool/worker-callback-tool-provider.ts` | 四个工具（05 §2），`shouldAdvertise: (ctx) => ctx.executionUnitKind === 'worker'` |
| `kun/src/loop/tool-context-factory.ts`、`tool-discovery-context-factory.ts` | 填 `executionUnitKind: thread.executionUnit?.kind`（P0-04 预留的字段） |

### 服务细节

- **身份**：所有方法先 `thread = threadStore.get(workerThreadId)`，要求 `thread.executionUnit?.kind === 'worker'`，再用 `executionUnit.teamId` 找 team；找不到则报错"not a worker"。调用方传不进任何线程 id。
- **reportProgress**：限流 `Map<workerId, lastAt>`；写 ActivityStore：`apply(workerId, { phase, progressNote }, 'callback')`。
- **askManager**：
  1. 找到当前运行中的 dispatch（`listByWorker` 中 state 为 `accepted` 的那条），没有则报错"no active dispatch"；
  2. `questions.create({ dispatchId, workerId, question, options, deadline: now + timeout })`；
  3. `activity.apply(workerId, { mainState: 'waiting', waitingReason: 'question' }, 'callback')`；
  4. `notices.enqueue(teamId, { kind: 'question', questionId, … })`（P1-13 负责投递）；
  5. 等待：`questions.waitForAnswer(questionId, signal, timeoutMs)`（内存里的 `Map<questionId, Deferred>` + 持久化状态；进程重启后未回答的问题在启动时置 `timeout`，因为 worker 的那一轮也已中断）；
  6. 返回后 `activity.apply(workerId, { mainState: 'working', waitingReason: undefined }, 'callback')`。
- **readManagerContext**：读 `team.managerThreadId` 的 items，只保留 `user_message`（displayText 优先、排除 `messageSource` 非空的宿主消息）与 `assistant_text`，按 `(createdAt, seq)` 倒序分页；`query` 非空时做子串匹配（大小写不敏感），最多扫描最近 500 条。
- **submitResult**：写当前 dispatch 的 `workerReport`（`WorkerReportSchema`，字段长度都有上限）。

### 测试

| 用例 | 期望 |
| --- | --- |
| 非 worker 线程调用 | 工具不广告；直接调服务报错 |
| ask → answer | 返回 answered，行状态回到 working |
| ask 超时 | 返回 timeout，问题记录 timeout |
| ask 期间 turn 被中断 | 返回 cancelled |
| readManagerContext | 不含工具结果、推理、宿主消息；不能读其它线程 |
| 重启 | 未回答问题置 timeout |

---

## P1-12 总管工具（一）与投递（L，K）

- 分支：`codex/ade-manager-dispatch`；依赖：P1-10、P0-10、P0-16、P0-05

### 新增

| 文件 | 内容 |
| --- | --- |
| `kun/src/adapters/tool/manager-tool-provider.ts` | 工具定义与参数 schema；`shouldAdvertise` 见 05 §2；每个工具的 execute 转调 `kun/src/ade/tools/*` |
| `kun/src/ade/tools/harness-list.ts` | 10 §2 |
| `kun/src/ade/tools/worker-create.ts` | 09 §4.2（含 batch） |
| `kun/src/ade/tools/worker-status.ts`、`worker-read.ts` | 只读 |
| `kun/src/ade/manager-runtime.ts` | 组合：stores、deliverer、taskWorkspaces、activity、delegation、catalog、detector；对外 `createWorker`、`status`、`read`、`handleWorkspaceChange`、`reconcileOnStartup` |
| `kun/src/ade/dispatch-deliverer.ts` | 09 §5（已按核对结果改为 runChild / resumeChild） |
| `kun/src/ade/assignment-template.ts` | 09 §4.3，按 harness 的回调通道填"协作方式"段 |
| `kun/src/ade/user-report.ts` | 固定句式的 `userReport` 生成（en / zh 两套模板，按线程的界面语言选；拿不到时用 en） |
| `kun/src/server/runtime-composition-agent.ts` | 构造 `ManagerRuntime`；注册工具提供者；`TaskWorkspaceService.onChange` → `managerRuntime.handleWorkspaceChange` |

### `createWorker` 的步骤（在 09 §4.2 基础上补实现细节）

1. `team = teams.ensure(managerThreadId, settings.limits)`；活跃 worker 数 ≥ 硬上限 → 返回 `refuse('worker_limit')`。
2. 路由：显式 `agent.harnessId` → 校验 harness 存在、`model` 在该 harness 的模型列表里（取不到列表时允许任意非空模型并记 debug）；否则调用 `selectWorkerRoute`（P1-15 之前先用"总管自己的 provider + model，harness = kun"作为默认）。
3. 权限：`authority = authorityFromTurn(managerThread, managerTurn)`（P0-16）；`clampPermission(def, input.permissionMode, authority)`。
4. 准入：`checkHarnessAdmission({ usage: 'manager-worker', workspace: { isolated: isolation === 'worktree' }, unattended: isUnattendedTurn(managerTurn), … })`。
5. 升级确认：`needsUserConfirmation` 时 `requestUserOnlyEscalation(ctx, …)`；拒绝 → `refuse('escalation_declined')`。
6. 任务工作区：`taskWorkspaces.create({ ownerThreadId: managerThreadId, sourceRoot: managerThread.workspace, isolation, startFrom, label })`。
7. worker 线程：**不在这里建线程**——首次 `runChild` 会创建 side 线程（`child-agent-executor.ts:381`）。但 ActivityStore 与 team 需要 workerId：用 `ids.next('child')` 预分配 child id，`runChild` 需要支持传入预分配的 id（新增可选输入 `childId`，现有调用不传时行为不变）。
8. `security = buildWorkerSecuritySnapshot(authority, profile, taskWorkspace.path)`：`allowedWritePaths: [tws.path]`，其余字段取总管 turn 的快照与 profile 的交集（复用 `delegate_task` 构造 `ChildSecuritySnapshot` 的函数）。
9. `teams.upsertWorker({ … securitySnapshot: security, control: 'manager', state: 'active' })`；`activity.register({ kind: 'worker', … })`。
10. `dispatches.create({ parentTurnId: managerTurnId, … })`；`deliverer.tryDeliver(dispatchId)`。
11. 返回 `userReport`。

worker 线程创建时还要写 `executionUnit`：`runChild` 创建线程的地方（`child-agent-executor.ts:381` 的 `threads.create`）接受新的可选输入 `executionUnit`，由 deliverer 在首次投递时传入。

### `reconcileOnStartup`

```ts
for (const d of await dispatches.listByState(['delivering', 'uncertain'])) {
  const thread = await threadStore.getMetadata(d.workerId)
  const turn = thread?.turns.find((t) => t.clientRequestId === d.dispatchId)
  if (turn) await dispatches.update(d.dispatchId, { state: 'accepted', turnId: turn.id })
  else await dispatches.update(d.dispatchId, { state: 'pending' }).then(() => deliverer.tryDeliver(d.dispatchId))
}
for (const d of await dispatches.listByState(['accepted'])) {
  const turn = await findTurn(d)
  if (turn && isTerminal(turn.status)) await managerRuntime.handleWorkerTurnTerminal(d.workerId, turn.id, outcomeOf(turn))
}
```

第二段处理"worker 在应用关闭时已结束、但完成钩子没来得及跑"的情况。

### turnId 回填

`accepted` 时还不知道 turnId：订阅 `turn_started` 事件（ActivityStore 已是观察者，这里在 `ManagerRuntime` 里再挂一个轻量观察者），事件所属线程是 worker 且该 turn 的 `clientRequestId` 与某个 accepted dispatch 相同 → 回填 `turnId`。

### 测试

| 用例 | 期望 |
| --- | --- |
| 工具广告 | 原生 + code + 开关开 + 非 worker + 非房间才出现 |
| 准入失败 | `ok: false`，`admission.missing` 非空，没有建工作区 |
| 权限降级 | 报告 `downgraded: true` |
| 升级被拒 | 无工作区、无 worker、无 dispatch |
| 工作区创建中 | `dispatched: false, deliveryPending: 'workspace'`；ready 后自动投递 |
| 批量 | `requested = created + failed + skipped` |
| 投递幂等 | 模拟在 delivering 后进程退出 → 重启对账后恰好一个 turn |
| 已结束但钩子未跑 | 重启对账补跑完成处理 |
| 预分配 child id | worker 线程 id 与 ActivityStore 行、team 记录一致 |

---

## P1-13 完成钩子、通知合并与唤醒（M，K R）

- 分支：`codex/ade-manager-wake`；依赖：P1-12

### 改动

| 文件 | 改什么 |
| --- | --- |
| `kun/src/server/runtime-composition-agent.ts`（`runAgentTurn`，约 305 行） | 与 `graphRuntime.handleSourceTurnTerminal` 并列调用 `managerRuntime.handleWorkerTurnTerminal`（09 §6.1） |
| `kun/src/ade/worker-notice-coordinator.ts`（新） | 照搬 `DetachedChildHandoffCoordinator`：`enqueue`、`deliverForManager`、`replayPending`、退避重试；加 3 秒合并窗口与暂缓标记（09 §6.2） |
| `kun/src/ade/notice-render.ts`（新） | `renderWorkerUpdates(notices)` → 结构化文本（09 §6.2 的 `<kun_worker_updates>`）与 `displayText`（给 UI 的简短标题，例如"3 个 worker 有更新"） |
| `kun/src/server/routes/teams.ts`（新） | `POST /v1/teams/:managerThreadId/notice-hold`（`{ holdMs ≤ 60000 }`） |
| renderer：`kun-mapper` | `user_message` 且 `messageSource === 'worker_update'` → 渲染为"worker 更新"卡片（不是用户气泡） |
| renderer：总管线程 composer | 有草稿且获得焦点时每 30 秒续一次 hold；发送消息时读取 `GET /v1/teams/:id/pending-notices`，把未投递的通知作为 `composerContexts` 附上，并在请求里带 `ackNoticeIds` |

### 合并窗口

```ts
enqueue(teamId, notice) {
  await this.store.add(notice)
  const managerThreadId = …
  if (!this.timers.has(managerThreadId)) {
    this.timers.set(managerThreadId, setTimeout(() => {
      this.timers.delete(managerThreadId)
      void this.deliverForManager(managerThreadId)
    }, 3_000))
  }
}

async deliverForManager(managerThreadId) {
  const pending = await this.store.listPending(managerThreadId)
  if (!pending.length) return
  const thread = await threadStore.get(managerThreadId)
  if (!thread) return this.store.ackAll(managerThreadId)
  if (thread.status === 'running' || this.holds.active(managerThreadId)) return this.scheduleRetry(managerThreadId)
  const batchId = `wnb_${sha256(pending.map((n) => n.id).join(',')).slice(0, 24)}`   // 同一批通知 → 同一个幂等键
  let admitted: string | undefined
  await turns.startTurn({ threadId: managerThreadId, request: {
    prompt: renderWorkerUpdates(pending), displayText: displayTitle(pending),
    messageSource: 'worker_update', clientRequestId: batchId } },
    { onAdmitted: (r) => { admitted = r.turnId } })
  if (admitted) void runTurn(managerThreadId, admitted).catch(() => undefined)
  await this.store.ack(pending.map((n) => n.id))
}
```

注意：唤醒 turn 的模型与 provider 取总管线程当前设置（与普通续跑一致）；如果设置了 `ade.managerModel`，唤醒 turn 使用它。

### 测试

| 用例 | 期望 |
| --- | --- |
| 3 秒内三个 worker 完成 | 只有一个唤醒 turn，内容含三条 |
| 总管忙 | 退避重试，忙完后投递 |
| hold 生效 | 暂缓；用户发送时通知附在消息上并被确认 |
| 重启 | 未确认通知在启动时重放 |
| 幂等 | 同一批通知重复投递只产生一个 turn |
| 渲染 | `worker_update` 消息显示为卡片 |

---

## P1-14 总管工具（二）：send / stop / release / answer、队列、接管（L，K R）

- 分支：`codex/ade-manager-controls`；依赖：P1-13、P1-11

### 工具与路由

| 工具 | 实现要点 |
| --- | --- |
| `worker_send` | 新 dispatch（`mode: 'queue' \| 'interrupt'`）→ `tryDeliver`；worker `control === 'user'` 时拒绝并说明 |
| `worker_stop` | 找运行中的 turn → 现有 interrupt 流程；dispatch 由完成钩子置 cancelled |
| `worker_release` | 有运行中 turn 先 stop；`teams.upsertWorker({ state: 'released' })`；ActivityStore `residency: 'dormant'`、可选 `visibility: 'archived'`；任务工作区有未合入改动时保留（返回里提示） |
| `worker_answer` | `questions.answer(questionId, answer, 'manager')` → 唤醒等待中的 `askManager` |
| `dispatch_queue` / `dispatch_update` / `dispatch_cancel` | 只作用于 `pending` 的 dispatch；update 只能改 `task` 与 `context` |

GUI 路由（`kun/src/server/routes/teams.ts`）：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/v1/teams/by-manager/:threadId` | team、workers、最近的 dispatch 与 question |
| POST | `/v1/teams/workers/:workerId/take-over` | `control: 'user'`，发通知给总管 |
| POST | `/v1/teams/workers/:workerId/hand-back` | `control: 'manager'`，通知附接管期间的 diff 统计 |
| POST | `/v1/teams/workers/:workerId/detach` | 清 `executionUnit`，从 team 移除 |
| POST | `/v1/teams/questions/:questionId/answer` | 用户直接回答（`answeredBy: 'user'`） |
| POST | `/v1/teams/workers/:workerId/dispatch` | GUI 发起的派活（审查批注发回，P1-18 使用） |

用户接管后，用户在 worker 线程里发送的消息是普通 turn：`chat-store` 发送时不带任何 dispatch 字段；`handleWorkerTurnTerminal` 找不到对应 dispatch 就直接返回（09 §6.1 已处理）。

### `managerMayApprove`（默认关）

开关打开时，worker 的审批请求额外生成一条通知给总管，总管可用 `worker_approve({ approvalId, decision })`：执行前检查请求的 `action` 是否在总管快照内（文件写入目标在 worker 工作区内、命令类在总管权限允许的范围内），不满足则拒绝；审计理由写"由总管批准"。

### 测试

| 用例 | 期望 |
| --- | --- |
| send 排队 | worker 忙时 pending，上一轮结束后投递 |
| send interrupt | 先中断再投递 |
| 接管期间 send | 拒绝 |
| 交还 | 通知带 diff 统计 |
| release 有未合入改动 | worktree 保留，返回提示 |
| dispatch_update 非 pending | 拒绝 |
| managerMayApprove 关 | 没有 `worker_approve` 工具 |
| 越权代批 | 拒绝 |

---

## P1-15 worker 选择、额度快照、profile 字段（M，K S M）

- 分支：`codex/ade-worker-selection`；依赖：P1-12

| 文件 | 改什么 |
| --- | --- |
| `kun/src/contracts/capabilities-core.ts:328` | `SubagentProfileConfig` 加 `harnessId`、`credentialMode`、`delegationNotes` |
| `kun/src/delegation/workspace-agents.ts` | frontmatter 解析 `harness`、`credential-mode`、`delegation-notes` |
| `src/shared` 设置类型、规范化、IPC（`subagentProfilePatchSchema` 是 passthrough，确认字段不被丢）、`subagentProfilesForRuntime` | 同步三个字段 |
| `kun/src/ade/quota-snapshot.ts` | 包装 `ProviderQuotaService.list()`，缓存 60 秒，失败返回空（不阻塞选择） |
| `kun/src/ade/worker-selector.ts` | 10 §3.2 |
| `kun/src/ade/tools/worker-create.ts` | 省略 agent 时调用选择器，`reason` 并入 userReport |

`quotaProviderIdFor(route)`：`native-login` 时按 harness 映射到订阅 preset id（`claude-code → claude-subscription`、`cursor → cursor-subscription`、`antigravity → gemini-subscription`，以 `model-provider-preset-catalog-core.ts` 的实际 id 为准）；否则用 `route.providerId`。

测试见 10 §7；额外一条：profile 新字段经"GUI 保存 → config.json → kun 读取 → 选择器使用"全链路不丢失。

---

## P1-16 验收结论、交叉审查（M，K）

- 分支：`codex/ade-verdict-review`；依赖：P1-14、P0-12

| 文件 | 内容 |
| --- | --- |
| `kun/src/ade/quality-verdict.ts` | `setVerdict(dispatchId, verdict, decidedBy)`；用户结论覆盖总管结论（记录两者，展示以用户为准） |
| `kun/src/ade/tools/worker-verdict.ts` | 工具 |
| `kun/src/ade/review-request.ts` | 10 §5：建 ephemeral reviewer worker（`toolPolicy: 'readOnly'`、`sandboxMode: 'read-only'`、工作区 = 被审查者的任务工作区、`isolation: 'local'` 语义但不加写租约） |
| `kun/src/ade/tools/review-request.ts` | 工具 |
| `kun/src/server/routes/teams.ts` | `POST /v1/teams/dispatches/:id/verdict`（用户在审查面板给结论） |

审查者的输入：采集到的 patch（超过 64 KiB 时只给文件列表 + 统计，并提示用 read 工具查看）、原任务、worker 汇报、`focus`；要求以 `submit_result` 结束（审查者也是 worker，回调工具可用）。审查者完成后，`handleWorkerTurnTerminal` 识别它是 reviewer（WorkerRecord 加 `reviewOf?: dispatchId`），把 `workerReport.checks / risks` 合并进被审查 dispatch 的 `verdict.checks`（`source: 'reviewer'`），然后发通知。

---

## P1-25 Graph 节点 harness、规划摘要、计划阶段准入（M，K）

- 分支：`codex/ade-graph-harness`；依赖：P0-05、P1-12

| 文件 | 改什么 |
| --- | --- |
| `kun/src/contracts/graph-core.ts:199` | `GraphAssignmentReferenceV1Schema` 的 ephemeral 分支加 `harnessId`、`credentialMode`（可选） |
| `kun/src/graph/graph-attempt-routing.ts` | 解析出的 assignment 带上这两个字段；`implicitWorkerModel` 不变 |
| `kun/src/graph/graph-attempt-scheduler.ts:304` | `delegation.runChild` 传 `harnessId` / `credentialMode`（runChild 在 P1-10 已支持经 HarnessRouter 选运行时） |
| Graph 规划的动态上下文 | 加 harness 摘要：每个就绪 harness 一行（名称、适合做什么、额度状态）；放在每轮动态上下文，不进稳定前缀 |
| `graph_define_plan` 校验 | 对指定了 harness 的节点调 `checkHarnessAdmission({ usage: 'graph-worker', workspace: { isolated: node.writeScopes.length > 0 ? isolationMode === 'worktree' : true } })`，失败时在工具结果里逐节点说明 |
| Graph 尝试的 ActivityStore 行 | 在 `executeAttempt` 开始时 `activity.register({ kind: 'graph-attempt', unitId: attemptId, parentThreadId: run.threadId, … })`，child 线程事件通过 `event.child` 更新 |

测试：计划里节点指定 claude-code → 尝试走 agent-sdk 运行时；指定不满足准入的 harness → 计划被拒并说明原因；现有 Graph 测试全绿。

---

## P1-26 休眠与卡住检测（M，K）

- 分支：`codex/ade-hibernation`；依赖：P0-08、P1-05、P1-12

| 文件 | 内容 |
| --- | --- |
| `kun/src/services/activity-hibernation.ts` | 每 60 秒扫描：卡住检测（06 §6）与休眠判定（06 §7.2）；可注入时钟便于测试 |
| `kun/src/services/activity-store.ts` | `lastEventAt: Map<unitId, number>`（事件到达时更新，不参与行比较） |
| `AcpConnectionPool` | `releaseForUnit(unitId)`：该单元对应会话的连接引用计数减一 |
| renderer | 上报"当前前台打开的线程"（`POST /v1/activity/foreground`，每次切换线程时调用，30 秒过期）——休眠条件 4 需要它 |

休眠判定用到的"未完成 dispatch / 未回答问题"通过 `ManagerRuntime.hasOpenWork(workerId)` 查询，不在 ActivityStore 里重复存。

测试见 06 §11 的休眠与卡住两行；加一条：休眠后用户发消息 → 连接重建 → portable 或 native 续接成功。
