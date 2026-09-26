# P0-13 ~ P0-16：交接简报、注入、停泊、权限上限

设计依据：[08](../08-handoff-context.md)、[09 §7](../09-manager-control-plane.md)。

---

## P0-13 交接简报与工作现场提取（M，K）

- 分支：`codex/ade-handoff-brief`；提交：`feat(handoff): deterministic handoff brief builder`
- 依赖：无。纯函数，不接线。

### 新增

| 文件 | 内容 |
| --- | --- |
| `kun/src/handoff/handoff-types.ts` | `HandoffReason`、`HandoffBudgets`、`DEFAULT_HANDOFF_BUDGETS`、`HandoffStats`、`WorkState` |
| `kun/src/handoff/turn-grouping.ts` | `groupConversationTurns(items, currentTurnId)`：按 turnId 分组，只保留 user_message（用 `displayText ?? text`）、assistant_text、tool_call / tool_result（仅用于工作现场），排除推理、审批、`runtime_context_source`、`model_context`、`goal_context` 的正文 |
| `kun/src/handoff/work-state.ts` | `extractWorkState(items, taskWorkspace?)` |
| `kun/src/handoff/handoff-brief.ts` | `buildHandoffBrief(input)` |
| `kun/src/handoff/utf8-budget.ts` | `utf8Bytes`、`fitUtf8`（从 `sdk-context-assembler.ts` 移过来并在原处再导出） |

### `buildHandoffBrief` 的算法

```ts
export function buildHandoffBrief(input: BuildHandoffInput): HandoffBriefResult {
  const b = { ...DEFAULT_HANDOFF_BUDGETS, ...input.budgets }
  const effective = effectiveHistoryAfterLatestCompaction(input.items)      // 复用 loop/compaction-history.ts
  const summary = effective[0]?.kind === 'compaction' ? effective[0] : undefined
  let turns = groupConversationTurns(summary ? effective.slice(1) : effective, input.currentTurnId)
  if (input.mode === 'delta' && input.sinceTurnId) {
    const index = turns.findIndex((t) => t.turnId === input.sinceTurnId)
    turns = index >= 0 ? turns.slice(index + 1) : turns                      // 找不到起点时退化为全量
  }
  const recent = turns.slice(-b.recentTurns)
  const older = turns.slice(0, Math.max(0, turns.length - b.recentTurns))

  const sections = {
    header: renderHeader(input),                                            // 来源 → 接手、工作区、分支
    digest: renderDigest(summary, older, b),                                 // 每轮一行，超预算从最旧删
    recent: renderRecent(recent, b.recentTextCap),
    workState: renderWorkState(input.workState, b.commandLimit),
    footer: RETRIEVAL_HINT
  }
  const text = fitSections(sections, b.totalCap)                            // 削减顺序见 08 §3.2
  return { text, digest: sha256Hex(text), stats: statsOf(sections, recent, older, input.workState) }
}
```

- 摘要行：`第 N 轮 用户：{前 60 字} ／ 助手：{最后一段的前 60 字}`，超出 `digestLineCap` 截断并加省略号。轮次编号是该线程的**全局轮次序号**（从 1 开始，按 turn 在线程中的顺序），与 `read_thread_history` 的 `turnRange` 一致。
- 原文区：user 原文 + 该轮最后一条 assistant_text（中间的工具往返不放原文，只进工作现场）。
- `fitSections` 的削减：删摘要最旧行 → 原文单条上限每次 ×0.75 → 原文轮数每次 −1（最少 1）→ 最后才截断摘要区整体；`workState` 与 `footer` 永不删。
- 所有渲染只用固定模板字符串，**不含时间戳、随机 id**，保证确定性。

### `extractWorkState`

```ts
export function extractWorkState(items: readonly TurnItem[], tws?: { changedFiles: readonly string[] }): WorkState {
  const files = new Set<string>()
  const commands: Array<{ command: string; exitCode?: number }> = []
  for (const item of items) {
    if (item.kind === 'tool_call' && item.toolKind === 'file_change') for (const p of fileChangePaths(item)) files.add(p)
    if (item.kind === 'tool_call' && item.toolKind === 'command_execution') commands.push(commandOf(item, items))
  }
  for (const p of tws?.changedFiles ?? []) files.add(p)
  return { files: [...files].sort(), commands: commands.slice(-50), todos: openTodos(items), goal: activeGoal(items) }
}
```

`fileChangePaths` 需要适配三种来源的参数形状：Kun 原生写入工具（`path`）、Claude SDK 的 Edit / Write / MultiEdit（`file_path`）、ACP diff（`path`），按 `toolName` 分派；解析不了的忽略，不抛错。

### 测试（快照为主）

| 用例 | 期望 |
| --- | --- |
| 确定性 | 同一输入调用两次，文本逐字节相同 |
| 空历史 | 调用方不会调用（`needsHandoff` 返回 null）；直接调用返回只有头尾的简报 |
| 12 轮对话 | 最近 4 轮原文 + 8 行摘要 |
| 超预算 | 按削减顺序逐步收缩；`workState` 仍完整 |
| 有压缩摘要 | 摘要出现在摘要区第一段 |
| delta 模式 | 只含 sinceTurnId 之后的轮次；找不到 sinceTurnId 时退化为全量 |
| 工作现场三种来源 | 路径都被提取；未知工具忽略 |
| 中文与 emoji | UTF-8 截断不产生半个字符 |

---

## P0-14 简报注入、`handoff_injected`、`read_thread_history`（M，K R）

- 分支：`codex/ade-handoff-inject`；提交：`feat(handoff): inject handoff brief into delegated runtimes`
- 依赖：P0-13、P0-06（开关 `ade.deterministicHandoff`）

### 注入点（2026-09-25 核对）

| 运行时 | 生成位置 | 使用位置 | 改法 |
| --- | --- | --- | --- |
| Claude SDK | `agent-sdk-runtime-factory-turn.ts:355` | `agent-sdk-runtime-core.ts:298`（无 resume id 时） | 开关打开时，`ctx.historyTranscript` 改为 `buildHandoffBrief(...).text`，`reason` 由 `sessionPreparation.rebaseReason` 推出（`route_changed` → harness-switch，其余 → rebase） |
| Cursor SDK | `cursor-sdk-runtime-lifecycle.ts:196` | 同文件 `buildPrompt(!resumeNativeSession)` | 同上 |
| Antigravity | `antigravity-cli-runtime.ts:244` | 同处 | 同上（每轮都是新会话，`reason: 'rebase'`） |

`composeSdkPromptText` 的 `<prior_conversation>` 包装在开关打开时改为直接放简报（简报自带 `<kun_handoff>` 包装）：`SdkPromptParts` 增加 `handoffBrief?: string`，二者互斥。

工作现场里的任务工作区：P0 阶段线程还没有 `taskWorkspaceId`（P1-10 才有），先传 `undefined`。

### 事件与界面

- `kun/src/contracts/events.ts`：新事件 `handoff_injected`：`{ harnessId, reason, mode: 'full' | 'delta', stats: { recentTurns, digestLines, files, commands, bytes }, briefDigest }`。只用于展示，不进模型历史。
- `DelegatedSessionBinding` 增加可选 `handoffBriefDigest`（审计用）。
- renderer：`kun-mapper` 把事件映射成时间线上的小标记块（`kind: 'handoff'`），文案"已把上下文交接给 {agent}（最近 {n} 轮、{m} 个文件）"；点击调用 `GET /v1/threads/:id/handoff-preview?turnId=` 按需重建简报文本显示。

### `read_thread_history`

| 文件 | 内容 |
| --- | --- |
| `kun/src/services/thread-history-reader.ts`（新） | 从 `context-window-tool-provider.ts` 背后的 `ContextWindowService` 抽出不依赖窗口模式的读取与检索：`search(threadId, { query, turnRange, cursor, limit })` |
| `kun/src/adapters/tool/thread-history-tool-provider.ts`（新） | 工具定义；`sideEffect: 'read-only'`；`shouldAdvertise: (ctx) => (ctx.harnessId ?? 'kun') !== 'kun'` |
| `kun/src/runtime/agent-sdk/sdk-tool-bridge.ts` | 该工具不在 `DEFAULT_OVERLAP_TOOL_NAMES` 里，自然会被桥接给 SDK |

线程范围：`threadId` 取自可信上下文；允许读取 fork 祖先（沿 `parentThreadId` 且 `relation === 'fork'` 向上，最多 8 层），不允许读 side 线程的父线程（worker 读总管上下文走专用工具 `read_manager_context`，有自己的授权规则）。

### 测试

| 用例 | 期望 |
| --- | --- |
| 开关关闭 | 三个运行时发出的 prompt 与改动前完全相同（快照） |
| 开关打开 + 新 generation | prompt 以 `<kun_handoff` 开头，无 `<prior_conversation>` |
| 开关打开 + resume | 不带简报（与现状一致） |
| Antigravity | 每轮带简报 |
| 事件 | 注入时发一条 `handoff_injected`；resume 时不发 |
| 检索工具：原生 turn | 不广告 |
| 检索工具：读其它线程 | 参数里没有 threadId 字段，无法指定；fork 祖先可读、side 父线程不可读 |
| 输出上限 | 超过 16 KiB 时 `truncated: true` 并给 cursor |

---

## P0-15 会话停泊与增量（M，K）

- 分支：`codex/ade-session-parking`；提交：`feat(runtime): park delegated native sessions across harness switches`
- 依赖：P0-14

### 改动：`kun/src/runtime/delegated-session-binding.ts`

1. `BINDING_SCHEMA_VERSION` 1 → 2；`DelegatedSessionBinding` 增加 `parked?: ParkedSession[]` 与 `priorItemCount?: number`（记录 commit 时的历史条数，用于前缀校验）。读取 v1 文件时视为 `parked: []`。
2. provider-state 目录从 `provider-state/<kind>/<threadId>` 改为 `provider-state/<kind>/<threadId>/<routeKeyHash>`：
   - `providerStateDir(kind, threadId)` 增加第三个参数 `routeKey`；
   - 迁移：首次以 v2 读取某线程时，把旧目录整体移动到当前绑定的 `routeKeyHash` 子目录（同一个 Manager 互斥里完成）；
   - 各运行时调用 `providerStateDir` 的地方都传 `routeKey(preparation.route)`。
3. `prepare()` 的新逻辑（08 §5.2）：

   ```ts
   if (binding && !routeMatches) {
     const parkedList = pruneParked([...(binding.parked ?? []), toParked(binding)], this.nowIso())   // 最多 3 条、7 天
     const key = routeKey(input.route)
     const candidate = parkedList.find((p) => p.key === key)
     const prefixOk = candidate ? await this.prefixMatches(candidate, input.priorItems) : false
     if (candidate && prefixOk && input.route.continuationMode === 'native') {
       await this.store.save({ ...binding, parked: parkedList.filter((p) => p !== candidate) })
       return { threadId: input.threadId, generation: binding.generation + 1, route: input.route,
         priorHistoryDigest, nativeSessionId: candidate.nativeSessionId, resumed: true,
         parkedDelta: { lastCommittedTurnId: candidate.lastCommittedTurnId } }
     }
     await this.store.save({ ...binding, parked: parkedList })
     for (const evicted of evictedFrom(binding.parked, parkedList)) await this.store.clearProviderState(evicted.kind, input.threadId, evicted.key)
     return { ...freshPreparation(binding, input), rebaseReason: 'route_changed' }
   }
   ```

4. `prefixMatches(candidate, priorItems)`：取 `priorItems` 的前 `candidate.priorItemCount` 条，算 `delegatedHistoryDigest`，与 `candidate.synchronizedHistoryDigest` 比较。
5. `DelegatedSessionPreparation` 增加 `parkedDelta?`；`needsHandoff`（08 §4）据此返回 delta 计划；三个运行时把 `resumed && parkedDelta` 视为"恢复停泊会话"：用停泊的 nativeSessionId 续接，并在 prompt 前加 delta 简报。
6. 恢复失败：运行时调用现有 `rejectResume(preparation)` → 全新会话 + 全量简报（`reason: 'rebase'`）。

### 测试

| 用例 | 期望 |
| --- | --- |
| A → B → A | 第三次恢复 A 的原生会话，prompt 带 delta 简报 |
| A → B → A，期间删除了一条历史 | 前缀校验失败，A 全新会话 + 全量简报 |
| 停泊超过 3 条 | 最旧的被淘汰，其 provider-state 目录被清除 |
| 7 天过期 | 过期项在下次 prepare 时被清除 |
| v1 绑定文件 | 正常读取；旧 provider-state 目录迁移到子目录 |
| 并发 | 同一线程两次 prepare 串行（`runExclusive` 已有） |

---

## P0-16 权限上限与升级确认基础件（S，K）

- 分支：`codex/ade-permission-clamp`；提交：`feat(ade): permission clamp and user-only escalation approval`
- 依赖：P0-02

### 新增 / 修改

| 文件 | 内容 |
| --- | --- |
| `kun/src/ade/permission-clamp.ts`（新） | `PERMISSION_RANK`、`clampPermission()`（09 §7.1）、`authorityFromTurn(thread, turn)`：用 `kunToolPermissionModeFromSettings({ approvalPolicy, sandboxMode, approvalReviewer })`（`contracts/policy.ts`）把 turn 的实际权限投影成三档之一 |
| `kun/src/ade/escalation-approval.ts`（新） | `requestUserOnlyEscalation(ctx, { workerLabel, harnessName, workspacePath, mode })`：构造 `createApprovalRequest`（`domain/approval.ts:49`），`action` 为 `external-effect` 信封，并带 `reviewerRequirement: 'user'`，然后 `ctx.awaitApproval(request)` |
| `kun/src/contracts/approvals.ts` | `ApprovalActionEnvelopeSchema` 增加可选 `reviewerRequirement: z.literal('user')` |
| 自动审批路径（`approval-review` 服务与 `makeAwaitApproval`） | 看到 `reviewerRequirement === 'user'` 时：跳过 agent 审查者，跳过 `auto` 策略的自动放行，一律交给用户 |

投影规则的注意点：`kunToolPermissionModeFromSettings` 对非规范组合投影为 `ask-for-approval`（最保守），这正是上限计算需要的——总管的权限只会被低估，不会被高估。

### 测试

| 用例 | 期望 |
| --- | --- |
| 总管 ask-for-approval，请求 full-access | effective 为该 harness 最宽的 ≤ ask 档；`needsUserConfirmation: true`（交互场景） |
| 总管 full-access，请求 full-access | 不降级，不需要确认 |
| 无人值守 | 永不 `needsUserConfirmation`，直接降级 |
| harness 没有 ≤ 总管档位的档 | 取 `permissionModes[0]` |
| user-only 审批 + 总管处于 approve-for-me | 审批进入用户待办，agent 审查者未被调用 |
| user-only 审批 + auto 策略 | 仍然等待用户 |
| 取消 / 超时 | 返回 deny，调用方不产生副作用 |
