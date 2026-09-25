# 08 确定性交接与上下文

- 阶段：P0（交接简报、检索工具）；P1（停泊会话 + 增量、worker 简报、压缩归属）
- 依赖：01、02
- 被依赖：03、05、09

## 1. 目标

1. 外部 harness 开一个**新的原生会话**、而线程里已经有历史时（切换 agent、原生会话失效后重建、worker 首次派活），用**代码确定性生成**的交接简报把上下文带过去，不调 LLM：零额外延迟、可测试、可复现。
2. 切回曾经用过的 harness 时，恢复它**停泊**的原生会话，只补离开期间的增量。
3. 简报之外的细节，由 harness 通过只读检索工具按需获取。
4. 每个会话只有一个压缩器；换模型等于重建会话。

## 2. 现状

- `kun/src/runtime/agent-sdk/sdk-context-assembler.ts:33` 的 `buildHistoryTranscript(items, currentTurnId, maxBytes = 48 KiB)`：取最新压缩摘要 + 从新到旧尽量塞满 48 KiB 的渲染文本。调用点（2026-09-25 核对）：
  - Claude SDK：`agent-sdk-runtime-factory-turn.ts:355` 生成，`agent-sdk-runtime-core.ts:298` 只在**没有 resume id**（新 generation）时放进 prompt。
  - Cursor SDK：`cursor-sdk-runtime-lifecycle.ts:196` 生成，`preparation.resumed` 且无动态指令时不带。
  - Antigravity：`antigravity-cli-runtime.ts:244`，没有原生续接，**每轮都带**。
  - 三处都通过 `composeSdkPromptText` 拼成 `<prior_conversation>` 块。
- `DelegatedSessionCoordinator.prepare`（`delegated-session-binding.ts:172`）：路由变化时对新旧两种 providerKind 都 `clearProviderState`，**旧会话直接丢弃**，没有停泊。
- 窗口模式有 `history_*` 检索工具，但只在窗口模式开启时可用（`context-window-tool-provider.ts:41`）。
- 外部历史引用有 `read_source_history`（读 Codex / Claude Code / OpenCode 的原始日志）。

问题：48 KiB 的渲染尾巴在长会话里既贵又丢重点（改了哪些文件、跑过哪些命令这类"工作现场"信息可能在截断范围外）；切换 harness 时旧会话被丢弃，切回来只能重新灌历史；harness 拿不到截断范围之外的细节。Antigravity 这类没有原生续接的 harness 每轮都带 48 KiB，代价更高。

## 3. 交接简报：`kun/src/handoff/handoff-brief.ts`（新增，纯函数）

### 3.1 结构

```text
<kun_handoff version="1" reason="harness-switch">
来源：Kun（deepseek-v4-pro）→ 接手：Claude Code（claude-opus-4-8）
工作区：/Users/x/.kun/worktrees/tasks/app-3f2a91c0/tws_k2j4 （分支 kun/fix-login-a1b2c3）

## 较早的对话（摘要）
[压缩摘要，若有]
- 第 3 轮 用户：把登录页的错误提示改成… ／ 助手：已修改 LoginForm.tsx，并…
- 第 4 轮 …

## 最近的对话（原文）
### 第 7 轮 用户
…原文，每条最多 2000 字，超出以"…（已截断）"结尾…
### 第 7 轮 助手
…

## 工作现场
改动过的文件：src/login/LoginForm.tsx，src/login/api.ts（共 2 个）
执行过的命令（最近 10 条）：
- pnpm test src/login  → 退出码 1
- pnpm test src/login  → 退出码 0
未完成的待办：补充 api.ts 的超时处理
当前目标：登录失败时给出可操作的错误信息

## 需要更多细节时
用 read_thread_history 工具按关键词或轮次检索这段对话的完整原文，不要凭空推测。
</kun_handoff>
```

### 3.2 生成规则

```ts
export type HandoffReason =
  | 'harness-switch'      // 同一线程换了 harness
  | 'rebase'              // 原生会话失效（route/能力/历史变化，或 resume 失败）
  | 'worker-dispatch'     // 总管派活，worker 首次拿到上下文（§6）
  | 'context-overflow'    // harness 上下文满了，换新原生会话（§7）

export type HandoffBudgets = {
  recentTurns: number        // 默认 4
  recentTextCap: number      // 单条原文上限，默认 2_000 字符
  digestBudget: number       // 摘要区总预算，默认 3_000 字符，超出从最旧行丢
  digestLineCap: number      // 摘要区单行上限，默认 120 字符
  commandLimit: number       // 默认 10
  totalCap: number           // 整个简报上限，默认 12 KiB（UTF-8）
}

export function buildHandoffBrief(input: {
  items: readonly TurnItem[]
  currentTurnId: string
  reason: HandoffReason
  mode: 'full' | 'delta'
  sinceTurnId?: string                        // delta 模式：只取这之后的轮次
  from: { harnessName: string; model?: string }
  to: { harnessName: string; model?: string }
  workspace?: { path: string; branch?: string }
  workState: WorkState                        // §3.3，delta 模式也用全量历史提取
  budgets?: Partial<HandoffBudgets>
}): { text: string; digest: string; stats: HandoffStats }
```

1. 历史取 `effectiveHistoryAfterLatestCompaction(items)`，排除当前 turn、`runtime_context_source`、推理内容、审批与内部 item。
2. 按轮次（turnId）分组；最后 `recentTurns` 轮进原文区，其余进摘要区。
3. 摘要区每轮一行：用户原话前 N 字 + 助手最后一段的前 N 字；**不调模型**。若存在压缩摘要，放在摘要区第一段。
4. 超出 `totalCap` 时的削减顺序：先删摘要区最旧行 → 再压缩原文区单条上限 → 最后减少原文轮数（至少保留 1 轮）。工作现场区永远保留（它是最耐久的交接信息）。
5. 输出必须**确定**：相同输入逐字节相同（不含时间戳、随机 id），`digest` = sha256(text)。
6. delta 模式：原文区与摘要区只取 `sinceTurnId` 之后的轮次，开头改为"你离开期间发生了："。

### 3.3 工作现场：`extractWorkState(items, taskWorkspace?)`

| 字段 | 来源 |
| --- | --- |
| files | `tool_call` / `tool_result` 中 `toolKind: 'file_change'` 的路径（含 ACP diff、SDK Edit/Write）；绑定了任务工作区时与 `TaskWorkspaceRecord.changedFiles` 取并集，以采集结果为准 |
| commands | `toolKind: 'command_execution'` 的命令和退出码，最近 `commandLimit` 条 |
| todos | 线程当前未完成 todo |
| goal | 线程当前目标（`goal_context`） |
| plan | 若有已批准计划，给计划文件路径（不内联全文） |

## 4. 注入方式

简报**不写进用户消息**，界面上用户看到的仍是原话：

- 结构化 harness：在该轮 prompt 的最前面作为独立文本块发送（03 §6 的 `buildPromptBlocks`；Claude SDK 的 `composeSdkPromptText` 改为接收 `handoffBrief` 替代 `priorConversation`）。
- 终端 agent：作为启动时的初始任务文本的一部分（05 §6.1）。
- 不持久化为 item（它可以由 items 确定性重建）。会话绑定里记录 `handoffBriefDigest` 与统计，便于审计。
- 时间线显示一个仅展示用的标记事件 `handoff_injected`：「已把上下文交接给 Claude Code（最近 4 轮原文、2 个改动文件）」，点开可查看简报全文（按需重新生成）。

何时注入：

```ts
function needsHandoff(prep: DelegatedSessionPreparation, priorItems: readonly TurnItem[]): HandoffPlan | null {
  if (!priorItems.some(isConversational)) return null            // 线程里没有更早历史
  if (prep.resumed) return prep.parkedDelta                       // 恢复了停泊会话：只发增量（§5）
    ? { mode: 'delta', sinceTurnId: prep.parkedDelta.lastCommittedTurnId }
    : null                                                        // 原生会话连续：什么都不发
  return { mode: 'full', reason: prep.rebaseReason === 'route_changed' ? 'harness-switch' : 'rebase' }
}
```

与现状的差别：注入时机不变（Claude SDK、Cursor 已经只在新 generation 时带历史），变的是**内容**（确定性简报替代 48 KiB 渲染尾巴）和**能力**（停泊恢复、按需检索）。没有原生续接的 harness（Antigravity）每轮都等于新会话，每轮带简报——与现状等价，但更短、更有重点。

迁移：`buildHistoryTranscript` 保留一个版本周期，由开关 `agents.kun.ade.deterministicHandoff`（默认开）控制，关闭时回到旧行为。

## 5. 停泊会话与增量

### 5.1 数据

`DelegatedSessionBinding`（`delegated-session-binding.ts:23`）增加：

```ts
parked?: Array<{
  key: string                       // `${providerKind}:${providerId}:${credentialIdentity}:${workspace}:${model}`
  nativeSessionId: string
  lastCommittedTurnId: string
  synchronizedHistoryDigest: string
  parkedAt: string
}>                                  // 最多 3 条，超过 7 天的丢弃
```

### 5.2 `prepare` 的改动

```ts
// 旧：路由变化 → 两种 providerKind 的状态都 clear
// 新：路由变化 → 把当前绑定停泊，而不是清除；只有新路由对应的停泊项才可能被恢复
if (binding && !routeMatches) {
  const parkedKey = routeKey(binding)
  await this.park(binding)                                       // 写入 parked，保留该 kind 的 provider-state 目录
  const candidate = binding.parked?.find((p) => p.key === routeKey(input.route))
  if (candidate && input.route.continuationMode === 'native') {
    return { ...base, generation: binding.generation + 1, nativeSessionId: candidate.nativeSessionId,
      resumed: true, parkedDelta: { lastCommittedTurnId: candidate.lastCommittedTurnId } }
  }
  // 没有可恢复的停泊项：全新会话，全量简报
}
```

- provider-state 目录改为按 `(providerKind, 停泊 key 哈希)` 分目录，这样同一线程可以同时保留多个 harness 的原生状态。`clearProviderState` 只在停泊项过期或被淘汰时调用。
- 恢复失败（native session 已过期）：`rejectResume` → 全新会话 + 全量简报，reason `rebase`。
- `delegatedHistoryDigest` 的校验对停泊恢复放宽：停泊项的 digest 只需要是当前历史的**前缀**（离开时的历史仍在），否则（历史被删改过）放弃停泊、走全量简报。前缀判断：保存停泊时额外记录当时的 item 数与 digest，恢复时对当前历史的同长度前缀重算 digest 比较。

## 6. worker 的初始上下文

总管派活时，worker 拿到的初始输入由宿主按固定模板组装（09 §4.3）：

1. **任务说明**：总管在 `worker_create` / `worker_send` 里写的正文（这是唯一由 LLM 写的部分）。
2. **总管提供的上下文**：工具参数里 `context` 字段显式给出的文件、链接、约束。
3. **工作区事实**：路径、分支、起点、setup 状态（依赖未安装时明确写出）。
4. **协作约定**：怎么汇报进度、怎么提问、怎么提交结果（按 harness 的通道给出工具名或 CLI 命令，05）。
5. 默认**不**附带总管的完整历史。worker 需要时用 `read_manager_context`（05 §2.3）按需读。

worker 被收编自一个已有的一对一会话时（09 §9），第一轮带 `reason: 'worker-dispatch'` 的全量简报。

## 7. 压缩归属与上下文溢出

- `facts.compactionOwner`（02 §3）：原生 loop 为 `kun`；SDK / ACP harness 为 `harness`；终端 agent 为 `harness`。
- **一个会话只有一个压缩器**：harness 自己管理上下文时，Kun 不对它的原生会话做任何压缩注入；Kun 自己的压缩只作用于原生 loop 的模型历史。现状下委派的 turn 已经绕过 Kun 的 loop（不会触发 Kun 压缩），实现时加断言防止回归。
- harness 报告上下文溢出（错误码或停止原因可识别时）：
  1. 本轮**没有任何已完成的工具调用**（无副作用）→ 自动换新原生会话，带 `reason: 'context-overflow'` 的全量简报，重放本轮用户输入一次。
  2. 本轮已有副作用 → 不重放，turn 以可操作错误结束："上下文已满，已完成的操作保留，请发送'继续'以在新会话中接着做"。下一轮自动走全量简报。
  3. 同一轮最多换一次会话，第二次溢出直接失败，不循环。

## 8. 换模型

- 同一 harness 的原生会话中途换模型 = 重建执行单元：路由的 `model` 变化 → `route_changed` → 停泊旧会话 + 新会话 + 全量简报（旧模型的会话仍可在切回时恢复）。
- 推理强度是每轮参数，不触发重建（路由不包含 effort）。
- UI：会话进行中切换模型时，提示"切换模型会为该 agent 开一个新的原生会话，上下文会以交接简报的形式带过去"（12 §6）。

## 9. 检索工具：`read_thread_history`

新增工具提供者 `kun/src/adapters/tool/thread-history-tool-provider.ts`：

```ts
input: {
  query?: string                 // 关键词；为空时按轮次分页
  turnRange?: { from?: number; to?: number }
  cursor?: string
  limit?: number                 // 默认 5，最大 20
}
output: {
  matches: Array<{ turnNumber: number; role: 'user' | 'assistant' | 'tool'; excerpt: string; itemId: string }>
  nextCursor?: string
  truncated: boolean
}
```

- 只读，范围是**当前线程及其 fork 祖先**；身份来自可信的执行上下文，参数不能指定其它线程（与窗口模式的 `history_*` 工具规则一致）。
- 输出上限：16 KiB 且不超过 min(工具 token 上限, 4096)，与现有检索工具一致。
- 广告条件：委派给外部 harness 的 turn（经工具桥或 MCP server 提供）。原生 loop 已经有完整历史，不需要。
- 实现复用窗口模式的历史读取与检索代码（`context-window-tool-provider.ts` 背后的服务），去掉"必须开启窗口模式"的门控，只保留线程范围校验。
- 外部会话引用分支（01 §8）继续用现有 `read_source_history`，两者并存：一个读 Kun 线程，一个读外部原始日志。

## 10. 测试

| 测试 | 断言 |
| --- | --- |
| `handoff-brief.test.ts`（快照） | 相同输入输出逐字节相同；预算削减顺序；工作现场永远保留；delta 模式只含之后的轮次 |
| 工作现场 | ACP diff、SDK Edit、Kun 原生 file_change 三种来源都能提取；与任务工作区 changedFiles 合并 |
| 注入时机 | 原生会话连续时不发；新会话发全量；恢复停泊发增量 |
| 停泊 | 切到 B 再切回 A 恢复 A 的原生会话；历史被删改后放弃停泊；最多 3 条、7 天过期 |
| 溢出 | 无副作用自动换会话并重放一次；有副作用不重放；二次溢出直接失败 |
| 检索工具 | 不能读其它线程；输出上限；fork 祖先可读 |
| 回归 | 开关关闭时 Claude SDK 路径行为与现状一致（现有 `sdk-context-assembler` 测试） |

## 11. 文件清单

新增：

- `kun/src/handoff/handoff-brief.ts`、`work-state.ts`、`handoff-plan.ts`
- `kun/src/adapters/tool/thread-history-tool-provider.ts`

修改：

- `kun/src/runtime/delegated-session-binding.ts`（停泊、分目录的 provider-state、前缀校验）
- `kun/src/runtime/agent-sdk/sdk-context-assembler.ts`、`agent-sdk-runtime-factory-context.ts`（改用简报）
- `kun/src/runtime/antigravity/antigravity-cli-runtime.ts`（同上）
- `kun/src/contracts/events.ts`（`handoff_injected`）
- `kun/src/adapters/tool/context-window-tool-provider.ts`（抽出历史读取服务）
