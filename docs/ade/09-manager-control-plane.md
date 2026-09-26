# 09 总管控制面：team、worker、dispatch

- 阶段：P1
- 依赖：01、02、05、06、07、08
- 被依赖：10、11、12

## 1. 目标

Kun 原生 agent 作为总管：拆任务、选 agent、派活、盯进度、回答 worker 的问题、验收、汇报。
所有"必须正确"的规则都写在宿主代码里：

| 规则 | 宿主怎么保证 |
| --- | --- |
| 同一次派活只投递一次 | dispatchId 作为 `clientRequestId`，turn 启动幂等（§5） |
| 完成与否不靠 worker 自觉 | worker 的一轮结束就是 `TurnRunOutcome`（§6） |
| 总管不会等一个不会来的回报 | 派活工具如实返回是否已派发；完成时宿主主动唤醒总管（§6） |
| worker 权限不超过总管 | 权限取交集，升级需要用户当面确认（§7） |
| 完成不等于通过 | 验收结论单独记录（10） |
| 汇报写清谁做的 | 工具返回宿主生成的 `userReport`（§4.4） |

## 2. 定位

- **总管只存在于 ADE 模式**（00）：只有 `workspaceMode === 'ade'` 的线程才有 `worker_*` 工具，Code 线程没有。
- **总管不是新的编排模式**。它就是 Kun 原生 loop，多了一组 `worker_*` 工具；某个线程第一次创建 worker 时，宿主为它建一个 team，这个线程就成了总管线程。
- **Graph 是总管的结构化形态**：Graph 用 DAG 显式编排，总管用对话自由编排。两者共用同一套 worker 执行底座（dispatch、任务工作区、ActivityStore、harness 路由）。
- 总管必须是 `harness: 'kun'`：`worker_*` 工具只在原生 loop 的 turn 上广告。外部 harness 的一对一会话里没有这些工具（不做"外部 agent 当总管"）。
- 总管模型：默认用该线程当前模型；设置 `agents.kun.ade.managerModel`（可选）指定专用模型，例如便宜的 DeepSeek。
- Rooms 不在范围内：Rooms 有自己的成员协议，`worker_*` 工具在 Rooms 线程里不广告。
- worker 线程里不广告 `worker_*`（不允许嵌套 team）；worker 需要子任务时用现有 `delegate_task`（受原有子代理规则约束）。

## 3. 数据模型

### 3.1 线程字段（`kun/src/contracts/threads.ts`）

```ts
executionUnit: z.object({
  kind: z.literal('worker'),
  teamId: z.string().min(1),
  managerThreadId: z.string().min(1),
  label: z.string().min(1).max(64),
  role: z.string().max(64).optional(),                 // 'implementer' | 'reviewer' | 'tester' ... 自由文本
  lifecycle: z.enum(['persistent', 'ephemeral']),
  taskWorkspaceId: z.string().optional(),              // 07
  control: z.enum(['manager', 'user'])                 // 用户接管后为 user（§9）
}).strict().optional()
```

worker 线程是总管线程的侧边线程（`relation: 'side'`、`parentThreadId = managerThreadId`，与现有子代理一致），默认不出现在主会话列表，出现在 Mission Control 和总管的 Workers 轨道里。

### 3.2 存储：`kun/src/ade/`（新增）

路径 `dataDir/ade/teams/<managerThreadId>/`，每个文件 `AtomicJsonFile` + Manager 数据互斥：

```ts
export type TeamRecord = {
  teamId: string
  managerThreadId: string
  status: 'active' | 'ended'
  limits: { softWorkers: number; hardWorkers: number }          // 默认 4 / 8
  budget?: { softTokens?: number; hardTokens?: number }          // 可选，按 worker 线程用量合计
  workers: WorkerRecord[]
  createdAt: string; updatedAt: string
}

export type WorkerRecord = {
  workerId: string                  // = worker 线程 id = ChildRunRecord.id
  label: string
  role?: string
  route: HarnessRoute               // 01：harnessId / providerId / model / credentialMode
  permissionMode: string            // harness 档位 id（已按 §7 裁剪）
  lifecycle: 'persistent' | 'ephemeral'
  taskWorkspaceId?: string
  /** 创建时按 §7 固化的权限交集（ChildSecuritySnapshot）；之后每次派活都用它，不随总管后续 turn 变宽 */
  securitySnapshot: ChildSecuritySnapshot
  control: 'manager' | 'user'
  state: 'active' | 'released' | 'detached'
  createdAt: string; releasedAt?: string
}

export type DispatchState =
  | 'pending'      // 已持久化，等工作区就绪或 worker 空闲
  | 'delivering'   // 已标记即将投递（投递前先落盘）
  | 'uncertain'    // 投递结果不明（进程在投递中途退出）
  | 'accepted'     // worker 的 turn 已接纳
  | 'completed' | 'failed' | 'cancelled'

export type DispatchRecord = {
  dispatchId: string                // `dsp_` + 随机；同时作为 startTurn 的 clientRequestId
  teamId: string
  workerId: string
  parentTurnId: string              // 发起派活的总管 turn（GUI 发起时为总管线程最近一个 turn）
  title: string
  task: string                      // 总管写的任务说明
  context?: DispatchContext         // 总管显式给的文件、链接、约束
  mode: 'queue' | 'interrupt'
  state: DispatchState
  turnId?: string
  outcome?: TurnRunOutcome
  workerReport?: WorkerReport       // 05 §2.4
  resultExcerpt?: string            // 没有 workerReport 时，worker 最后一条助手消息的摘录（≤1500 字）
  capture?: { changedFiles: number; insertions: number; deletions: number; patchArtifactId?: string }
  verdict?: QualityVerdict          // 10
  failureReason?: string
  createdAt: string; updatedAt: string
}

export type QuestionRecord = {
  questionId: string
  dispatchId: string
  workerId: string
  question: string
  options?: string[]
  state: 'open' | 'answered' | 'escalated' | 'timeout' | 'cancelled'
  answer?: string
  answeredBy?: 'manager' | 'user'
  deadline: string
}
```

与 `ChildRunRecord` 的关系：每个 worker 对应一条 `ChildRunRecord`（`launcher: 'manager-worker'`，新增到 `ChildRunLauncher` 枚举），复用它的安全快照、用量统计、子任务事件（`RuntimeEventBase.child`）和 UI 卡片。每次派活是这个 child 的一次续跑（`resumeChild: true`）。

## 4. 工具：`kun/src/adapters/tool/manager-tool-provider.ts`（新增）

`providerKind: 'delegation'`。广告条件：线程 `workspaceMode === 'ade'`、原生 loop 的 turn、线程不是 worker、不在 Rooms（00 §3）。

### 4.1 工具列表

| 工具 | 作用 | 副作用 |
| --- | --- | --- |
| `harness_list` | 可用的 agent、模型、准入结果、额度快照（10 §2） | 无 |
| `worker_create` | 建 worker（含任务工作区）并派第一份活 | 有 |
| `worker_create_batch` | 一次建多个 worker | 有 |
| `worker_send` | 给已有 worker 派新活（排队或打断） | 有 |
| `worker_status` | worker 与 dispatch 的状态（读 ActivityStore 和 DispatchStore） | 无 |
| `worker_read` | 读某个 worker 最近的可见消息（分页） | 无 |
| `worker_answer` | 回答 worker 的问题 | 有 |
| `worker_stop` | 中断 worker 当前这一轮 | 有 |
| `worker_release` | 结束 worker：释放 runtime，可选归档；历史保留 | 有 |
| `dispatch_queue` / `dispatch_update` / `dispatch_cancel` | 查看、改写、撤回还没被接纳的派活 | 有 |
| `review_request` | 让另一个 agent 审查某个 worker 的结果（10 §5） | 有 |
| `workspace_integrate` | 把 worker 的改动合入（07 §8.2），需要用户审批 | 有 |

### 4.2 `worker_create`

```ts
input: {
  label: string                         // 在看板和汇报里显示，如 "登录修复"
  role?: string
  task: string                          // 任务说明：目标、范围、验收标准
  context?: { files?: string[]; links?: string[]; constraints?: string[] }
  agent?: { harnessId?: string; model?: string; providerId?: string }   // 省略时由 10 §3 自动选择
  workspace?: { isolation?: 'worktree' | 'local'; startFrom?: StartFrom }   // 默认 worktree + default-branch
  permissionMode?: string               // 省略时 = 总管当前档位映射到该 harness 的档位
  lifecycle?: 'persistent' | 'ephemeral'   // 默认 persistent
}
output: {
  ok: boolean
  workerId?: string
  dispatchId?: string
  dispatched: boolean                   // 是否已经派出（工作区还在创建时为 false，但 dispatch 会在就绪后自动投递）
  deliveryPending?: 'workspace' | 'worker-busy'
  route?: HarnessRoute
  permissionMode?: { requested?: string; effective: string; downgraded: boolean }
  admission?: AdmissionResult           // 失败时说明缺什么能力（02 §5.3）
  userReport: string                    // 宿主生成，总管应原样转告用户
}
```

处理流程：

```ts
async function workerCreate(ctx: ManagerToolContext, input: WorkerCreateInput): Promise<WorkerCreateOutput> {
  const team = await teams.ensure(ctx.threadId)                                   // 第一次调用时建 team
  if (activeWorkers(team) >= team.limits.hardWorkers) return refuse('worker_limit', team)
  const route = input.agent?.harnessId
    ? resolveExplicitRoute(input.agent, ctx)
    : await selector.select({ task: input.task, role: input.role, ctx })          // 10 §3
  const def = catalog.get(route.harnessId)
  const workspace = input.workspace?.isolation ?? 'worktree'
  const permission = clampPermission(def, input.permissionMode, ctx.authority)    // §7
  const admission = checkHarnessAdmission({ usage: 'manager-worker', harness: def,
    effective: await capabilities.effective(route), status: await detector.status(route.harnessId),
    workspace: { isolated: workspace === 'worktree' }, requestedPermissionMode: permission.effective,
    unattended: ctx.unattended, allowUnattendedFullAccess: settings.allowUnattendedFullAccess })
  if (!admission.ok) return refuse('admission', admission)
  if (permission.needsUserConfirmation) {                                         // §7.2
    const confirmed = await ctx.requestEscalation(permission)
    if (!confirmed) return refuse('escalation_declined')
  }
  const tws = await taskWorkspaces.create({ ownerThreadId: ctx.threadId, sourceRoot: ctx.workspace,
    isolation: workspace, startFrom: input.workspace?.startFrom ?? { kind: 'default-branch' },
    label: input.label }, ctx.signal)                                              // 07：立即返回 creating
  const worker = await workers.create({ team, route, permission, label: input.label, role: input.role,
    lifecycle: input.lifecycle ?? 'persistent', taskWorkspaceId: tws.workspaceId })   // 建 side 线程 + ChildRunRecord
  activity.register({ unitId: worker.workerId, kind: 'worker', threadId: worker.workerId,
    parentThreadId: ctx.threadId, teamId: team.teamId, harnessId: route.harnessId,
    title: input.label, workspace: { path: tws.path, kind: workspace === 'worktree' ? 'worktree' : 'local' } })
  const dispatch = await dispatches.create({ teamId: team.teamId, workerId: worker.workerId,
    title: input.label, task: input.task, context: input.context, mode: 'queue' })
  const delivered = await deliverer.tryDeliver(dispatch.dispatchId)               // §5；工作区未就绪时保持 pending
  return { ok: true, workerId: worker.workerId, dispatchId: dispatch.dispatchId,
    dispatched: delivered.accepted, deliveryPending: delivered.pendingReason, route,
    permissionMode: permission.report, userReport: reportCreated(worker, delivered, permission) }
}
```

### 4.3 派给 worker 的输入

由宿主按固定模板组装（08 §6），作为 worker 线程这一轮的 prompt：

```text
<kun_assignment dispatch="dsp_x9…" from="总管">
## 任务
{task}

## 背景与约束
{context.files / links / constraints}

## 工作区
路径：{path}　分支：{branch}　起点：{startFrom}
依赖安装：{setup 状态；未安装时明确写出}

## 协作方式
- 需要做决定、而任务说明没有覆盖时：{ask_manager 工具名 或 kun worker ask 命令}
- 阶段性进展：{report_progress / kun worker progress}
- 完成时：{submit_result / kun worker result}（可选，但推荐）
- 需要总管这边的更早上下文：{read_manager_context}
</kun_assignment>
```

这段属于该轮的输入，不进任何 system prompt；界面上 worker 线程里显示为"来自总管的任务"卡片，展开可看全文。

### 4.4 `userReport` 与批量创建

- 每个有副作用的工具都返回宿主生成的 `userReport`（固定句式，不含模型推测），例如："已为「登录修复」创建 worker（Claude Code · claude-opus-4-8），工作区正在准备，就绪后自动开始。"
- `worker_create_batch`：按输入顺序依次执行 `workerCreate`；首次遇到 `worker_limit` 或批次级错误后，其余项标为 `skipped`。返回里 `requested = created + failed + skipped` 必须成立（测试断言），并给出逐项结果和汇总 `userReport`。
- 多个 worker 要一次派出时，总管应调用一次 `worker_create_batch`，而不是连续多次 `worker_create`：工具描述里写明；宿主在同一轮里检测到第二次单独 `worker_create` 时不拒绝，但在结果里提示改用批量。

## 5. 投递：只投递一次

`kun/src/ade/dispatch-deliverer.ts`：

```ts
async tryDeliver(dispatchId: string): Promise<{ accepted: boolean; pendingReason?: 'workspace' | 'worker-busy' }> {
  return this.exclusive(dispatchId, async () => {
    const d = await this.dispatches.get(dispatchId)
    if (d.state !== 'pending' && d.state !== 'uncertain') return { accepted: d.state === 'accepted' }
    const team = await this.teams.get(d.teamId)
    const worker = await this.teams.worker(d.teamId, d.workerId)
    if (worker.control === 'user' || worker.state !== 'active') {
      await this.cancel(d, worker.control === 'user' ? 'worker is under user control' : 'worker released')
      return { accepted: false }
    }
    const tws = worker.taskWorkspaceId ? await this.taskWorkspaces.get(worker.taskWorkspaceId) : null
    if (tws && tws.state !== 'ready') {
      if (tws.state === 'failed') { await this.fail(d, `workspace failed: ${tws.lastError}`); return { accepted: false } }
      return { accepted: false, pendingReason: 'workspace' }          // 工作区就绪事件到达时再调用 tryDeliver
    }
    const busy = await this.workerHasActiveTurn(d.workerId)
    if (busy && d.mode === 'queue') return { accepted: false, pendingReason: 'worker-busy' }
    if (busy && d.mode === 'interrupt') await this.abortWorkerTurn(d.workerId)
    await this.dispatches.update(d.dispatchId, { state: 'delivering' })     // 先落盘，再投递
    const record = await this.childRuns.get(d.workerId)                     // ChildRunRecord；首次派活时不存在
    const controller = this.abortControllers.forWorker(d.workerId)          // worker 独立的中止器，与总管 turn 生命周期无关
    const common = {
      parentThreadId: team.managerThreadId,
      parentTurnId: d.parentTurnId,                 // 派活来源的总管 turn；GUI 发起的派活用总管线程最近一个 turn（见下）
      prompt: renderAssignment(d, worker),          // §4.3
      clientRequestId: d.dispatchId,                // 新增：一路透传到 turns.startTurn，保证幂等
      security: worker.securitySnapshot,            // 创建时按 §7 固化的交集快照
      signal: controller.signal
    }
    // 两个现有入口（2026-09-25 核对）：
    // - 首次：DelegationRuntime.runChild（delegation-runtime-run.ts:81），detach: true 时立即返回 queued 记录、后台执行
    // - 之后：DelegationRuntime.resumeChild（delegation-runtime-lifecycle.ts:117），同步执行到 child 结束，
    //   用 expectedResumeCount 作为乐观栅栏；这里不 await，由 deliverer 在后台跟踪
    const run = record
      ? this.delegation.resumeChild({ ...common, childId: d.workerId,
          expectedResumeCount: record.resumeCount ?? 0, expectedLaunchers: ['manager-worker'] })
      : this.delegation.runChild({ ...common, ...workerFirstRunInput(worker), launcher: 'manager-worker', detach: true })
    this.track(d.dispatchId, run)                                           // 失败时置 failed / uncertain（见下）
    await this.dispatches.update(d.dispatchId, { state: 'accepted' })       // turnId 由 turn_started 事件回填（按 clientRequestId 匹配）
    return { accepted: true }
  })
}
```

需要的底层改动（2026-09-25 核对后确定）：

- `ChildRunExecutor` 的输入（`delegation-runtime-contracts.ts:353`）加 `clientRequestId?: string`；`child-agent-executor.ts` 调用 `turns.startTurn` 时放进 `request.clientRequestId`。`runChild` 与 `resumeChild` 的输入都加这个字段并透传。服务端 `findIdempotentStart`（`turn-service-admission-operations.ts:474`）已按 `clientRequestId` + 请求指纹去重：同一 id 同一内容返回原 turn，不同内容报错。
- `ChildRunLauncher` 枚举（`delegation-runtime-contracts.ts:86`）加 `manager-worker`；`isGenericChildLauncher` 对它返回 false（worker 不走 `delegate_task` 的通用恢复路径）。
- `resumeChild` 在 child 正在运行时会抛"still running"：deliverer 先用 `workerHasActiveTurn` 判断，排队的派活等上一轮结束再投递，不依赖这个异常。
- `parentTurnId` 是必填：来自总管工具调用时就是当前 turn；来自 GUI（例如审查批注发回 worker，11 §4.4）时用总管线程最近一个 turn id，只影响 UI 分组，不影响执行。

对账与触发：

- `track()`：`runChild` / `resumeChild` 的 promise 拒绝时，错误能确定"未启动"（参数校验、栅栏冲突）→ `failed`；否则 → `uncertain`。
- 启动时对账：`delivering` / `uncertain` 的派活，在 worker 线程里按 `turn.clientRequestId === dispatchId` 查找：找到 → `accepted` 并回填 turnId；没找到 → 用同一个 id 重新投递（幂等保证不会产生第二个 turn）。
- 触发 `tryDeliver` 的事件：创建时、任务工作区变为 ready、worker 的 turn 结束（队列里的下一份活）、启动对账。
- 同一 worker 的派活按创建顺序串行投递。

## 6. 完成、唤醒总管

### 6.1 worker 的一轮结束

在 `runtime-composition-agent.ts` 的 `runAgentTurn`（现在会调用 `graphRuntime.handleSourceTurnTerminal`）旁边加一个钩子：

```ts
if (outcome !== 'suspended' && outcome !== 'suspended_pending_supervision') {
  await managerRuntime.handleWorkerTurnTerminal(threadId, turnId, outcome)
}
```

```ts
async handleWorkerTurnTerminal(threadId: string, turnId: string, outcome: TurnRunOutcome) {
  const d = await this.dispatches.findByTurn(threadId, turnId)
  if (!d) return                                                       // 用户接管时发的消息不是派活
  const worker = await this.teams.worker(d.teamId, d.workerId)
  const capture = worker.taskWorkspaceId ? await this.taskWorkspaces.capture(worker.taskWorkspaceId) : undefined
  const report = d.workerReport ? undefined : await this.lastAssistantExcerpt(threadId, turnId, 1_500)
  await this.dispatches.update(d.dispatchId, {
    state: outcome === 'completed' ? 'completed' : outcome === 'aborted' ? 'cancelled' : 'failed',
    outcome, capture: capture && diffStat(capture), resultExcerpt: report })
  await this.notices.enqueue(d.teamId, noticeFromDispatch(d, outcome, capture))
  await this.deliverer.tryDeliverNext(d.workerId)                       // 队列里的下一份活
  if (worker.lifecycle === 'ephemeral' && outcome === 'completed') await this.workers.scheduleRelease(d.workerId)
}
```

### 6.2 唤醒

照搬 `DetachedChildHandoffCoordinator`（`kun/src/delegation/delegation-detached-handoff.ts`，2026-09-25 核对）的机制，新建 `WorkerNoticeCoordinator`：

| 现有后台子任务的做法 | worker 通知照搬 |
| --- | --- |
| `prepare()` 先持久化 handoff 记录（带 `clientRequestId = handoff id`） | 通知先写 `WorkerNoticeStore` |
| `deliver()`：父线程 `status === 'running'` → 抛错 → 指数退避重试（1s、2s、4s… 上限 30s） | 总管线程忙时同样退避重试；不往进行中的 turn 里塞上下文 |
| 父线程空闲 → `turns.startTurn({ prompt: notice, displayText, messageSource: 'background_subagent', clientRequestId })` → `runTurn` → `ack` | 用 `messageSource: 'worker_update'`（`UserMessageSource` 枚举新增，`contracts/items.ts:86`）启动一轮，`clientRequestId = notice batch id` |
| `replayPending()` 启动时重放 | 同样在启动时重放 |
| `roomContext` 线程走房间续跑 | 总管线程不在 Rooms 里（§2），不需要 |

在此基础上增加两点：

1. **合并**：投递时取该总管线程所有未确认的通知，合成一条消息，一次唤醒；合并窗口 3 秒（第一条通知到达后等 3 秒再投递），多个 worker 几乎同时完成时只唤醒一次。
2. **不打断用户**：renderer 在用户正在总管线程输入时（composer 有未发送草稿且有焦点）通过 `POST /v1/teams/:managerThreadId/notice-hold` 设置一个 60 秒可续期的暂缓标记；暂缓期间 `deliver()` 按"线程忙"处理。用户发出消息后，未投递的通知以 `composerContexts` 附在这条消息上，通知记录随之确认。

时间线上，`messageSource: 'worker_update'` 的用户消息渲染为"worker 更新"卡片，不显示为用户说的话（12 §6.2）。

通知内容（宿主生成，结构化）：

```text
<kun_worker_updates>
- [完成] 登录修复（Claude Code · claude-opus-4-8）dsp_x9…
  改动：3 个文件 +84 −12；验收：待定
  worker 汇报：已修复错误提示……（最多 1500 字）
- [失败] 接口超时（Codex · gpt-5.5）dsp_k2…
  原因：pnpm test 失败，见 worker 线程
- [提问] 样式调整 ：是否同时修改暗色主题？选项：是 / 否（q_7a…）
</kun_worker_updates>
```

总管在这一轮里决定：验收（10）、回答问题、派下一步、或向用户汇总。

### 6.3 总管的 turn 何时可以结束

- 派活是异步的：总管在派完活后可以直接结束当前 turn，不需要轮询、不需要 sleep。工具描述里明确写："派出后结束本轮即可，完成时你会被自动唤醒。"
- 宿主保证唤醒：只要有已接纳（accepted）的派活，其结束就一定会产生通知，通知一定会被投递（持久化 + 启动恢复）。
- 总管的 turn 里**没有任何派活真正派出**（全部失败或被拒）时，工具结果的 `userReport` 会明确说明，总管应直接告诉用户，而不是说"等 worker 回来"。这一点靠工具结果的如实性保证，不靠 prompt 规则。

### 6.4 问题

`ask_manager`（05 §2.2）到达时：

1. 建 `QuestionRecord`，ActivityStore 中 worker 进入 `waiting(question)`。
2. 按 §6.2 唤醒总管，通知里带问题和 `questionId`。
3. 总管 `worker_answer({ questionId, answer })` → worker 的工具调用返回。
4. 总管判断需要用户决定：在总管线程里调用 `user_input`，问题记录置 `escalated`；用户回答后，总管再 `worker_answer`（或宿主在 `user_input` 结果里带 questionId 时自动转交）。
5. 超时：记录置 `timeout`，worker 收到 `{ status: 'timeout' }`。

### 6.5 worker 的审批请求

worker 的工具审批（`approval_requested`）默认**交给用户**：出现在统一收件箱（12 §8）和 Mission Control 的"待你处理"列。总管只会在通知里看到"worker 在等待审批"，不能代批。

可选设置 `agents.kun.ade.managerMayApprove`（默认关）：打开后，总管可以对**不超出总管自身权限快照**的请求做批准（例如总管是 full-access 时批准 worker 工作区内的文件写入），实现为审批者 `agent` 的一种来源，审计记录写明"由总管批准"。

## 7. 权限上限

### 7.1 交集

worker 的有效权限 = 总管当前 turn 的权限快照 ∩ worker 使用的 profile 约束 ∩ harness 档位上界：

```ts
const RANK = { 'ask-for-approval': 0, 'approve-for-me': 1, 'full-access': 2 } as const

export function clampPermission(def: HarnessDefinition, requested: string | undefined, authority: AuthoritySnapshot) {
  const managerRank = RANK[authority.kunPermissionMode]
  const candidates = def.permissionModes.filter((m) => RANK[m.kunPermissionMode] <= managerRank)
  const wanted = def.permissionModes.find((m) => m.id === requested)
  if (wanted && RANK[wanted.kunPermissionMode] > managerRank) {
    return { effective: candidates.at(-1)?.id ?? def.permissionModes[0]!.id, downgraded: true,
      needsUserConfirmation: authority.interactive && wanted.kunPermissionMode === 'full-access',
      requestedMode: wanted }
  }
  return { effective: wanted?.id ?? candidates.at(-1)?.id ?? def.permissionModes[0]!.id,
    downgraded: false, needsUserConfirmation: false }
}
```

- 沙箱：worker 的 `sandboxMode` = 总管的；可写根只有该 worker 的任务工作区路径（`security.allowedWritePaths`）。
- 工具、MCP、技能的允许/禁止列表：沿用 `ChildSecuritySnapshot`，取交集，不扩大（现有子代理规则）。

### 7.2 升级确认

总管请求的档位高于自己（例如总管是 ask-for-approval，但希望 worker 以完全访问运行，让它在隔离 worktree 里自由跑测试）：

- 交互场景：宿主向用户发一个审批请求（`ApprovalGate`，envelope kind `external-effect`，目标描述"允许 worker「登录修复」以完全访问运行，仅限工作区 …"），**由宿主持有、用户确认**，不依赖工具描述或 prompt。取消或超时不产生任何副作用。
- 无人值守场景（定时任务、IM 触发的总管 turn）：不允许升级，回落最严档（02 §4）。

## 8. 限额与预算

- worker 数量：每个 team 软上限 4（超过时工具结果提醒总管）、硬上限 8（拒绝）；可在设置调整。
- 并发：所有 worker 的 turn 仍走 Kun 全局的 turn 准入队列（`maxConcurrentTurns`），与普通会话共享容量。
- 预算（可选）：team 的 token 合计（按 worker 线程的用量求和）超过软上限 → 通知总管；超过硬上限 → 不再接受新派活，已运行的不打断。
- 每次派活的轮次上限沿用 `turnLimits`。

## 9. 收编、接管、解除

| 操作 | 做法 |
| --- | --- |
| 收编 | 把一个已有的一对一会话变成 worker：写 `executionUnit`，加入 team；线程保持 `primary` 关系（不隐藏）；第一次派活带 `worker-dispatch` 全量简报（08 §6） |
| 用户接管 | 用户在 worker 线程里直接发消息：`control` 变为 `user`，这些消息是普通 turn，不是派活；总管收到"已被用户接管"通知，不再向它派活 |
| 交还 | worker 线程顶部"交还给总管"按钮：`control` 回到 `manager`，总管收到通知（附用户接管期间的改动统计） |
| 解除 | 从 team 移除，清除 `executionUnit`；线程变成普通会话，不停止、不移动 |
| 释放 | `worker_release`：进入 dormant / closed，任务工作区按 07 §8.3 处理（有未合入改动时保留） |

## 10. 与 Graph 的衔接

- Graph 节点的临时指派（`GraphAssignmentReferenceV1Schema`，`contracts/graph-core.ts:199`）已有 `providerId`；新增 `harnessId`、`credentialMode`，由 `graph-attempt-routing.ts` 传给 `runChild`（它已经走 `executeAttempt → delegation.runChild`）。
- Graph 尝试注册 ActivityStore 行（kind `graph-attempt`），工作区继续用 Graph 写协调器（它的 worktree 部分已抽成 07 的公共核心）。
- 规划阶段的动态上下文里提供 harness 摘要（名称、适合做什么、当前额度状态），**不进稳定前缀**。
- 准入：`graph_define_plan` 校验每个指定了 harness 的节点（02 §5.4）。

## 11. 测试

| 测试 | 断言 |
| --- | --- |
| 工具广告 | 只在原生 loop + code surface + 开关开启 + 非 worker + 非 Rooms 时出现 |
| `worker_create` | 准入失败返回缺失能力；权限降级如实报告；工作区未就绪时 `dispatched: false` 且之后自动投递 |
| 批量 | `requested = created + failed + skipped`；硬上限后其余 skipped |
| 投递幂等 | 同一 dispatchId 重复投递只产生一个 turn；进程在 delivering 后退出 → 启动对账后恰好一个 turn |
| 队列 | worker 忙时排队，上一轮结束后按顺序投递；interrupt 模式先中断再投递 |
| 完成 | turn 结束 → dispatch 状态、采集、通知；ephemeral worker 完成后释放 |
| 唤醒 | 3 秒内多个完成只唤醒一次；总管忙时通知作为下一轮上下文；重启后未投递的通知仍会投递 |
| 问题 | 回答、升级到用户、超时三条路径 |
| 权限 | 交集计算；升级需要用户确认，拒绝时无副作用；无人值守不升级 |
| 接管 | 用户消息不被当作派活；接管期间总管不能派活；交还后恢复 |
| Graph | 节点指定 harness 时 runChild 走对应运行时；准入失败在计划阶段报出 |

## 12. 文件清单

新增：

- `kun/src/ade/team-store.ts`、`dispatch-store.ts`、`question-store.ts`、`worker-notice-store.ts`
- `kun/src/ade/manager-runtime.ts`、`dispatch-deliverer.ts`、`worker-lifecycle.ts`、`permission-clamp.ts`、`assignment-template.ts`、`user-report.ts`
- `kun/src/adapters/tool/manager-tool-provider.ts`（工具定义与参数校验；各工具的实现放在 `kun/src/ade/tools/` 下按工具拆文件）
- `kun/src/server/routes/teams.ts`（GUI 读取 team / dispatch / question，GUI 发起接管、交还、解除）

修改：

- `kun/src/contracts/threads.ts`（`executionUnit`）
- `kun/src/delegation/delegation-runtime-contracts.ts`（`ChildRunLauncher` 加 `manager-worker`；runChild 输入加 `clientRequestId`、`harnessId`、`credentialMode`、`taskWorkspaceId`）
- `kun/src/delegation/child-agent-executor.ts`（透传 `clientRequestId`、按 harness 路由选运行时）
- `kun/src/server/runtime-composition-agent.ts`（worker turn 结束钩子、manager runtime 装配）
- `kun/src/contracts/graph-core.ts`、`kun/src/graph/graph-attempt-routing.ts`（节点 harness）
