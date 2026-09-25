# 06 单一状态存储：ActivityStore、三态生命周期、休眠

- 阶段：P0（存储、读接口、结构化执行单元）；P1（休眠、卡住检测）；P2（终端 agent 行）
- 依赖：01
- 被依赖：05、09、10、12

## 1. 目标与规则

**执行主机（`kun serve`）只存一份执行单元状态，所有读者只订阅。**

- 读者：桌面侧栏、Mission Control（12）、总管的 Workers 轨道、手机远程、IM 回执、TUI、`kun worker` CLI。
- 状态的优先级在**写入时**一次裁决，并记录来源；读者只做展示策略（衰减、已读），而且展示策略也只有一份实现（`src/shared/`）。
- 用户动作（忽略、确认已读）写回存储，**一处忽略，处处消失**。

参考项目的教训：同一个 agent 在主进程里曾有三份状态副本，桌面、手机、CLI 各自裁决，显示互相矛盾。Kun 从一开始就只建一份。

## 2. 现状

- `kun/src/services/thread-activity-registry.ts`：`RuntimeEventObserver`，只记录"哪个线程有变化"，带 epoch + revision 游标和 `waitForChange` 长轮询，路由 `GET /v1/thread-activity/events`。
- 前端每个组件从 chat-store 和子任务事件里自己推断"运行中 / 待审批"，没有统一行。
- 子代理状态在 `RuntimeEventBase.child`（`childStatus: queued | running | completed | failed | aborted`）。

ActivityStore 沿用 ThreadActivityRegistry 的游标与长轮询模式，但每行存的是完整状态。

## 3. 契约：`kun/src/contracts/activity.ts`（新增）

```ts
export const ExecutionUnitKindSchema = z.enum([
  'thread',          // 普通会话（一对一或总管线程本身）
  'worker',          // 总管派的 worker（09）
  'side-chat',       // 用户从某条消息分叉出的侧边对话
  'graph-attempt',   // Graph 节点的一次尝试
  'terminal-agent'   // 0 档终端 agent（05 §6）
])

export const ActivityStateSchema = z.enum([
  'initializing',    // 已登记，runtime 还没开始
  'working',
  'waiting',         // 等人：见 waitingReason
  'done',            // 本轮结束，等下一条输入
  'failed',
  'idle',            // 长时间无事（由 done 衰减而来，或被取消）
  'closed'           // runtime 已释放且不再期待输入（终端退出、worker 被释放）
])

export const ActivityRowSchema = z.object({
  unitId: z.string().min(1).max(128),
  kind: ExecutionUnitKindSchema,
  threadId: z.string().min(1),
  parentThreadId: z.string().optional(),       // worker / side-chat / graph-attempt 的父线程
  teamId: z.string().optional(),
  harnessId: HarnessIdSchema,
  title: z.string().max(200),
  workspace: z.object({
    path: z.string().max(4_096),
    kind: z.enum(['worktree', 'local', 'directory']),
    branch: z.string().max(256).optional()
  }).strict(),
  /** 把子单元折叠进来之后给用户看的状态 */
  state: ActivityStateSchema,
  waitingReason: z.enum(['approval', 'user_input', 'question', 'terminal_prompt']).optional(),
  /** 单元自身的状态，不含子单元。总管判断"自己这轮做完没有"用它 */
  mainState: ActivityStateSchema,
  /** 最近一次结束的结果；只在 mainState 为 done / idle 时有意义 */
  lastOutcome: z.enum(['completed', 'failed', 'cancelled']).optional(),
  children: z.object({
    working: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative()
  }).strict(),
  phase: z.enum(['investigating', 'implementing', 'verifying', 'blocked', 'compacting']).optional(),
  progressNote: z.string().max(280).optional(),
  currentTool: z.string().max(128).optional(),
  lastMessagePreview: z.string().max(200).optional(),
  turnId: z.string().optional(),
  stateSince: z.string().datetime(),
  updatedAt: z.string().datetime(),
  provenance: z.enum(['runtime', 'callback', 'hook', 'inferred', 'restored']),
  /** 重启后从持久化恢复、尚未被运行时确认的行，永远不当作实时真相 */
  restoredUnconfirmed: z.boolean().default(false),
  stalled: z.boolean().default(false),
  /** 三态生命周期（§7） */
  visibility: z.enum(['active', 'archived']),
  residency: z.enum(['live', 'dormant']),
  /** 用户事实：跨端共享 */
  acknowledgedAt: z.string().datetime().optional(),
  dismissedAt: z.string().datetime().optional(),
  pinned: z.boolean().default(false)
}).strict()
export type ActivityRow = z.infer<typeof ActivityRowSchema>
```

用户可见文案映射（12 §3）：working = 进行中；waiting = 待你处理；done = 待审查 / 已完成（视有无改动）；failed = 失败；idle = 空闲。

## 4. 写入：`kun/src/services/activity-store.ts`（新增）

### 4.1 生产者与权威

| 执行单元 | 权威生产者 | 只能补充的生产者 |
| --- | --- | --- |
| thread / worker / side-chat / graph-attempt | 运行时事件（`provenance: 'runtime'`） | worker 回调：phase、progressNote、`waiting(question)` |
| terminal-agent | hooks（`hook`） | 进程退出（`runtime`）、中断推断（`inferred`） |

```ts
const AUTHORITY: Record<ExecutionUnitKind, readonly ActivityProvenance[]> = {
  thread: ['runtime'], worker: ['runtime'], 'side-chat': ['runtime'], 'graph-attempt': ['runtime'],
  'terminal-agent': ['hook', 'runtime']
}

export class ActivityStore implements RuntimeEventObserver {
  readonly epoch = randomUUID()
  private revision = 0
  private readonly rows = new Map<string, StoredRow>()
  private readonly changes: Array<{ unitId: string; revision: number }> = []    // 环形，容量 4_096

  /** 生产者统一入口：先判断权威，再合并、折叠、记录变化 */
  apply(unitId: string, patch: ActivityPatch, provenance: ActivityProvenance): void {
    const row = this.rows.get(unitId)
    if (!row) return                                           // 未登记的单元不接受写入
    // 非权威生产者只能把 mainState 设为 waiting(question)，其它状态变化一律忽略；
    // state 字段不接受直接写入，永远由下面的折叠规则算出
    if (patch.mainState && !AUTHORITY[row.kind].includes(provenance) &&
        !(patch.mainState === 'waiting' && patch.waitingReason === 'question')) return
    const next = mergeRow(row, patch, provenance, this.nowIso())
    next.state = rollupState(next.mainState, next.children, next.waitingReason)   // §5，写入时一次裁决
    if (rowsEqual(row, next)) return
    this.rows.set(unitId, next)
    this.bump(unitId)
    if (next.parentThreadId) this.recomputeParent(next.parentThreadId)
  }

  register(input: RegisterUnit): ActivityRow { /* 建行：initializing、live、active */ }
  remove(unitId: string): void { /* 线程删除时移除，并记一条删除变化 */ }
}
```

### 4.2 运行时事件 → 行

`ActivityStore` 实现 `RuntimeEventObserver`，在 `RuntimeEventRecorder` 上注册（和 ThreadActivityRegistry 同一个挂载点，`runtime-composition` 里）：

| 事件 | patch |
| --- | --- |
| `turn_queued` | mainState `initializing` |
| `turn_started` | mainState `working`，turnId，清 `lastOutcome`、`stalled` |
| `approval_requested` | mainState `waiting`，waitingReason `approval` |
| `user_input_requested` | mainState `waiting`，waitingReason `user_input` |
| `approval_resolved` / `user_input_resolved` | 回到 `working`，清 waitingReason |
| `tool_call_started` | currentTool |
| `tool_call_finished` | 清 currentTool |
| `assistant_text_delta` | lastMessagePreview（节流：每 2 秒最多更新一次，取最后 200 字） |
| `turn_completed` | mainState `done`，lastOutcome `completed` |
| `turn_failed` | mainState `failed`，lastOutcome `failed` |
| `turn_aborted` | mainState `idle`，lastOutcome `cancelled` |
| 带 `event.child` 的事件 | 更新父单元的 `children` 计数 |
| `thread_updated`（标题） | title |

`assistant_text_delta` 是高频事件：观察者里只做字符串截断和时间戳比较，不做对象深拷贝；变化合并后再 `bump`，保证不拖慢事件热路径。

### 4.3 未登记单元

- 普通线程在第一个 `turn_started` 时自动登记（kind `thread`）。
- worker / side-chat / graph-attempt 由创建方显式 `register`（09、10），带上 parentThreadId、teamId、工作区信息。
- terminal-agent 由 `POST /v1/execution-units` 登记（05 §6.1）。

## 5. 折叠规则：`src/shared/activity-rollup.ts`

kun 和 renderer 共用同一个纯函数（renderer 只在显示历史快照时用，不对实时行重新裁决）：

```ts
export function rollupState(
  main: ActivityState,
  children: ActivityChildren,
  waitingReason?: WaitingReason
): ActivityState {
  if (main === 'waiting') return 'waiting'                     // 自己在等人，最优先
  if (children.waiting > 0) return 'waiting'                   // 子单元在等人，也要用户看到
  if (main === 'working' || main === 'initializing') return main
  if (children.working > 0) return 'working'                   // 自己做完了但 worker 还在跑：仍是进行中
  return main                                                  // done / failed / idle / closed
}
```

- `mainState` 单独保留：总管判断"我这轮是否结束、是否该汇总"只看自己的 `mainState` 和 dispatch 记录（09），不看折叠后的 `state`。
- 子单元失败不会让父单元显示为失败（失败是子单元自己的事实，父单元的 children.failed 计数会在 UI 里显示）。

## 6. 卡住检测

```ts
// 每 60 秒扫一次；只看 live 的 working 行
for (const row of rows) {
  if (row.residency !== 'live' || row.mainState !== 'working') continue
  if (row.waitingReason === 'question') continue                // 在等总管回答，不算卡住
  const quietMs = now - lastEventAt(row.unitId)
  if (quietMs > stallThresholdMs(row)) apply(row.unitId, { stalled: true }, 'inferred')
}
```

- 阈值：结构化 harness 默认 10 分钟，终端 agent 20 分钟；可在设置里调。
- `stalled` 只是标记，不改变状态、不终止任何东西；看板上显示提示，并发一次通知（12 §8）。
- 任何新事件到达时清除 `stalled`。

## 7. 三态生命周期与休眠

### 7.1 三个维度

| 维度 | 取值 | 含义 |
| --- | --- | --- |
| 存在 | 行存在 / 被删除 | 线程删除时整行删除；其它情况行一直在 |
| 可见 | `active` / `archived` | 归档只影响列表显示，不释放、不删除 |
| 驻留 | `live` / `dormant` | 后台 runtime 是否在（ACP 进程、终端 PTY、Claude SDK 查询） |

不要用一个字段混表达三件事：`idle` 是状态，`archived` 是可见性，`dormant` 是驻留，彼此独立。

### 7.2 休眠（P1，默认开）

条件全部满足才把一个 worker / 终端 agent 转为 `dormant`：

1. `mainState` 为 `done` 或 `idle`，且 `children.working + children.waiting === 0`。
2. 没有未完成的 dispatch（09 的 `DispatchRecord.state` 不在 pending / delivering / uncertain / accepted）。
3. 没有未回答的 `QuestionRecord`。
4. 不是当前前台打开的会话；手机端也没有正在操作它。
5. 距 `stateSince` 超过休眠阈值（默认 30 分钟，1 分钟到 24 小时可调）。
6. harness 支持恢复：`nativeResume` 为 supported，或 portable 续接可用（结构化 harness 都可以）；终端 agent 必须有 `terminal.resumeArgs`。

动作：

- ACP：`AcpConnectionPool.release`（03 §4.3）；会话绑定保留，下次按 native / portable 续接。
- 终端 agent：结束 PTY，记录原生 sessionId；用户再次打开时用 `resumeArgs` 重新启动。
- Claude SDK / Cursor SDK：每轮本来就是独立查询，驻留标记只用于显示。
- 唤醒：新的 dispatch、用户在该会话里发消息、用户点击"恢复"。唤醒失败（例如原生会话已过期）→ 回退 portable 续接，并在时间线上提示"已从交接简报恢复"。

### 7.3 归档与级联

- 总管线程归档 → 它的 worker 一起归档，**除非** worker 属于另一个工作区或当前正在某个标签页打开（此时 worker 自动解除父子关系，成为普通会话）。
- 用户可以手动"解除"一个 worker：清除 teamId 和父关系，worker 变成普通线程；不停止、不移动、不重启。
- 取消归档只恢复可见性，不自动唤醒 runtime。

## 8. 持久化与重启

- 结构化执行单元的状态**不持久化**：启动时从 ThreadStore 重建（最近 7 天有活动的线程；turn 的持久化状态就是真相）。
- 持久化的只有：用户事实（acknowledgedAt、dismissedAt、pinned）和终端 agent 行，存 `dataDir/ade/activity-facts.json`（`AtomicJsonFile`，写入走 Manager 数据互斥，与 `FileDelegatedSessionBindingStore` 相同的模式），防抖 2 秒。
- 恢复的终端 agent 行标记 `restoredUnconfirmed: true`、`provenance: 'restored'`，非终态一律降为 `idle`；直到收到新的 hook 或进程事件才清除标记。
- 容量：内存最多 2_000 行；超出时优先淘汰 `archived` 且 `closed` 超过 7 天的行。

## 9. 读接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/activity?scope=all\|workspace&workspace=<path>` | 快照 + 游标 |
| GET | `/v1/activity/events?cursor=<c>&wait_ms=<n>` | 长轮询，返回变化的行；epoch 变化或游标过期返回 `resetRequired`（与 thread-activity 相同语义） |
| POST | `/v1/activity/:unitId/ack` | 确认已读（跨端生效） |
| POST | `/v1/activity/:unitId/dismiss` | 忽略（从"待你处理"和"待审查"里移除，但不删除） |
| POST | `/v1/activity/:unitId/pin` | 置顶 |
| POST | `/v1/activity/hooks` | 终端 agent 的 hook 写入（`hook-ingest` 令牌，05 §4） |

- 主进程转发长轮询时，超时必须大于 `wait_ms`（`docs/AGENTS.md` 已有规则，thread-activity 曾因此出错）。
- 手机远程：远程桥的白名单（`src/main/remote/remote-allowlist.ts`）加上 `/v1/activity*` 的只读路由和 ack / dismiss。
- TUI：新增 `/activity` 只读视图（不增加任何运行时控制入口，符合现有 TUI 规则）。

## 10. 展示策略：`src/shared/activity-display.ts`

只有一份，桌面和手机共用：

```ts
export function displayBucket(row: ActivityRow, now: number): 'needs-you' | 'working' | 'review' | 'done' | 'idle' {
  if (row.dismissedAt) return row.state === 'working' ? 'working' : 'idle'
  if (row.state === 'waiting') return 'needs-you'
  if (row.state === 'working' || row.state === 'initializing') return 'working'
  if (row.state === 'failed') return 'needs-you'
  if (row.state === 'done') {
    const reviewable = row.kind !== 'thread' || row.workspace.kind === 'worktree'
    if (now - Date.parse(row.stateSince) > DONE_DECAY_MS && row.acknowledgedAt) return 'idle'
    return reviewable ? 'review' : 'done'
  }
  return 'idle'
}
export const DONE_DECAY_MS = 30 * 60_000
```

## 11. 测试

| 测试 | 断言 |
| --- | --- |
| `activity-store.test.ts` | 每个运行时事件的 patch；权威规则（回调不能把 worker 改成 done）；未登记单元拒绝写入 |
| 折叠 | `rollupState` 全部分支；父单元 children 计数随子单元变化 |
| 热路径 | 1 万次 `assistant_text_delta` 的处理耗时有上限（写成性能断言，阈值宽松） |
| 游标 | epoch 变化、游标过期返回 resetRequired；同一行多次变化只返回最后一次 |
| 卡住 | 无事件超过阈值 → stalled；等待问题时不标记；新事件清除 |
| 休眠 | 六个条件逐一不满足时不休眠；满足时 ACP 连接被释放；唤醒失败回退 portable |
| 归档级联 | 跨工作区 / 已打开的 worker 被解除而不是归档 |
| 重启 | 结构化单元从 ThreadStore 重建；终端 agent 行带 restoredUnconfirmed |
| 跨端 | 桌面 dismiss 后，手机的快照里同一行也是 dismissed |

## 12. 文件清单

新增：

- `kun/src/contracts/activity.ts`
- `kun/src/services/activity-store.ts`、`activity-event-projection.ts`、`activity-facts-store.ts`、`activity-hibernation.ts`
- `kun/src/server/routes/activity.ts`、`register-activity-routes.ts`
- `src/shared/activity-rollup.ts`、`activity-display.ts`
- `src/renderer/src/store/activity-store.ts`

修改：

- `kun/src/server/runtime-composition*.ts`（挂载观察者、服务、路由）
- `src/main/remote/remote-allowlist.ts`、主进程长轮询桥
- `src/preload/index.ts`、`src/shared/kun-gui-api-surface.ts`（activity API）
