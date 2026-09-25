# 03 ACP 通用接入运行时

- 阶段：P1
- 依赖：01、02、05（Kun Tools MCP server）、07（任务工作区）、08（交接简报）
- 被依赖：09、10

## 1. 目标

用**一个**运行时接入所有支持 ACP（Agent Client Protocol）的 agent：Gemini CLI（原生）、Codex（经 adapter）、OpenCode 等。
新 agent 只需要在 harness 目录里加一条配置（01 §4），不再各写几千行适配器。

现有三个深度适配器（Claude SDK、Cursor SDK、Antigravity CLI）保持不变。

## 2. 协议速览（ACP protocolVersion 1，2026-09 查阅官方文档）

实现时 pin 住协议版本，类型从官方 JSON schema / 官方 TypeScript SDK 生成，**不要手抄**。下表只用于设计。

| 方向 | 方法 | 必需 / 可选 | 能力门控 |
| --- | --- | --- | --- |
| 客户端 → agent | `initialize` | 必需 | — |
| | `authenticate` | 按需 | `authMethods` 非空 |
| | `session/new` | 必需 | — |
| | `session/load` | 可选 | `agentCapabilities.loadSession` |
| | `session/prompt` | 必需 | — |
| | `session/set_config_option` | 可选 | 会话返回 `configOptions` |
| | `session/set_mode` | 可选（正在废弃） | 会话返回 modes |
| | `session/cancel`（通知） | 必需 | — |
| agent → 客户端 | `session/request_permission` | 必需 | — |
| | `fs/read_text_file`、`fs/write_text_file` | 可选 | 客户端声明 `fs.readTextFile` / `fs.writeTextFile` |
| | `terminal/create`、`output`、`wait_for_exit`、`kill`、`release` | 可选 | 客户端声明 `terminal` |
| | `elicitation/create` | 可选 | 客户端声明 elicitation |
| | `session/update`（通知） | — | — |

`session/update` 的 `sessionUpdate` 变体：`user_message_chunk`、`agent_message_chunk`、`agent_thought_chunk`、`tool_call`、`tool_call_update`、`plan`、`available_commands_update`、`current_mode_update`、`config_option_update`、`session_info_update`、`usage_update`。

`session/prompt` 的 `stopReason`：`end_turn`、`max_tokens`、`max_turn_requests`、`refusal`、`cancelled`。

工具调用：`kind` ∈ `read / edit / delete / move / search / execute / think / fetch / switch_mode / other`；`status` ∈ `pending / in_progress / completed / failed`；`content` 变体：`content`（文本/图片块）、`diff`（`path`、`oldText` 可空、`newText`）、`terminal`（`terminalId`）；`locations`：`{ path, line? }[]`。

权限：`session/request_permission` 带 `toolCall` 和 `options[]`（`optionId`、`name`、`kind` ∈ `allow_once / allow_always / reject_once / reject_always`）；回复 `outcome` 为 `{ outcome: 'selected', optionId }` 或 `{ outcome: 'cancelled' }`。

取消语义：客户端发 `session/cancel` 后，agent 必须尽快停止并以 `cancelled` 回复原 `session/prompt`；客户端必须把所有挂起的 `request_permission` 回复为 `cancelled`。

## 3. 模块结构：`kun/src/runtime/acp/`（新增）

| 文件 | 职责 |
| --- | --- |
| `acp-schema.ts` | 从官方 schema 生成/引入的类型 + zod 解析器（只解析 Kun 用到的字段，其余透传忽略） |
| `acp-jsonrpc.ts` | stdio 上的 JSON-RPC 帧：逐行 JSON、请求 id 表、超时、通知分发、双向请求 |
| `acp-process.ts` | 受管进程：启动、环境隔离、退出观测、强制结束；用通用的 `spawnOwnedProcess` / `stopOwnedProcess`（`kun/src/process/owned-process.ts:161`，POSIX 进程组 + 启动闸门，Windows Job Object），不用 SDK 专用的 `spawnOwnedSdkProcess` |
| `acp-connection-pool.ts` | 按 (harnessId, 凭据身份) 复用进程，一个进程承载多个会话 |
| `acp-session-manager.ts` | 线程 ↔ ACP 会话：new / load、config options、原生会话绑定 |
| `acp-client-host.ts` | 实现 agent → 客户端方法：fs、terminal、权限、elicitation |
| `acp-event-mapper.ts` | `session/update` → Kun items / events |
| `acp-runtime.ts` | `DelegatedTurnRuntime` 实现，组合以上模块 |
| `acp-capabilities.ts` | 从 initialize / session 响应推导能力声明 v2 |

每个文件控制在 700 行以内；`acp-event-mapper.ts` 预计最大，工具调用映射单独拆 `acp-tool-call-mapper.ts`。

## 4. 进程与握手

### 4.1 启动

```ts
export async function startAcpProcess(input: {
  def: HarnessDefinition                     // transport === 'acp'
  command: string                            // HarnessDetector 解析出的命令
  credential: AcpCredential                  // native-login | kun-gateway（04）
  ownership: OwnedProcessLauncher            // 现有受管启动器：登记进程组，退出时回收整棵树
}): Promise<AcpProcess> {
  const env = buildHarnessEnv({
    base: process.env,
    strip: HARNESS_CREDENTIAL_ENV_DENYLIST,  // 通用化 buildScopedEnv：剥掉会抢优先级的 *_API_KEY、代理令牌等
    add: { ...input.def.launch!.env, ...credentialEnv(input.credential) }
  })
  const child = await input.ownership.spawn(input.command, input.def.launch!.args, {
    env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
  })
  return new AcpProcess(child, { stderrTailBytes: 64 * 1024 })  // stderr 只保留尾部，用于报错
}
```

- `HARNESS_CREDENTIAL_ENV_DENYLIST` 放在 `kun/src/harness/harness-env.ts`，Claude SDK 现有的 `buildScopedEnv` 改为调用它，保证所有 harness 口径一致。
- 同一 (harnessId, credentialIdentity) 的 spawn env 必须**逐字节稳定**：不要往 env 里放随机值或时间戳，否则连接池判断"配置变了"会反复重启进程。需要的随机令牌走 MCP URL 或文件（05 §3）。

### 4.2 initialize

```ts
const init = await rpc.request('initialize', {
  protocolVersion: 1,
  clientCapabilities: {
    fs: { readTextFile: true, writeTextFile: true },
    terminal: true
    // elicitation：P2 再声明，先不承诺
  },
  clientInfo: { name: 'kun', title: 'Kun', version: KUN_VERSION }
}, { timeoutMs: 20_000 })
if (init.protocolVersion !== 1) throw new AcpProtocolError('protocol_version_unsupported')
```

- `authMethods` 非空且 agent 报告需要认证时：**不在一轮对话里做交互式登录**。turn 以 `harness_not_ready` 失败，提示去设置页登录；设置页的"登录"按钮负责调用 `authenticate`（需要浏览器的方法由主进程打开系统浏览器）。
- 握手结果缓存在连接上，供能力推导（§8）。

### 4.3 连接池

```ts
class AcpConnectionPool {
  // key = `${harnessId}:${credentialIdentity}`；credentialIdentity 复用 delegatedCredentialIdentity()
  acquire(key: string, factory: () => Promise<AcpConnection>): Promise<AcpConnectionLease>
  // 引用计数归零且空闲超过 idleReleaseMs（默认 10 分钟）后关闭进程；会话按 06 §5 进入 dormant
  release(lease: AcpConnectionLease): void
  // 进程意外退出：该连接上所有会话标记 native_state_unavailable，下一轮走 portable 重建
  onExit(key: string, cb: (info: ExitInfo) => void): void
}
```

## 5. 会话

### 5.1 线程 ↔ 会话

复用 `DelegatedSessionCoordinator`（`kun/src/runtime/delegated-session-binding.ts:147`），扩展：

```ts
export type DelegatedProviderKind = 'agent-sdk' | 'cursor-sdk' | 'antigravity-cli' | 'acp'
```

`DelegatedSessionRoute.providerId` 对 ACP 填 harnessId（ACP 没有 provider 概念时），`continuationMode` 按 `loadSession` 能力取 `native` 或 `portable`。

```ts
async function ensureSession(ctx: TurnContext, conn: AcpConnection): Promise<AcpSessionHandle> {
  const preparation = await coordinator.prepare({
    threadId: ctx.threadId,
    route: { providerKind: 'acp', providerId: ctx.route.harnessId, credentialIdentity: conn.identity,
             workspace: ctx.workspace.path, model: ctx.route.model,
             capabilityFingerprint: delegatedCapabilityFingerprint(conn.initResult.agentCapabilities),
             continuationMode: conn.initResult.agentCapabilities.loadSession ? 'native' : 'portable' },
    priorItems: priorItemsForDelegatedTurn(ctx.items, ctx.turnId)
  })
  if (preparation.resumed && preparation.nativeSessionId) {
    try {
      await conn.rpc.request('session/load', { sessionId: preparation.nativeSessionId,
        cwd: ctx.workspace.path, mcpServers: ctx.mcpServers })
      return { sessionId: preparation.nativeSessionId, preparation, replayedHistory: false }
    } catch {
      const rebased = await coordinator.rejectResume(preparation)
      return createFresh(rebased)
    }
  }
  return createFresh(preparation)

  async function createFresh(prep: DelegatedSessionPreparation) {
    const res = await conn.rpc.request('session/new', { cwd: ctx.workspace.path, mcpServers: ctx.mcpServers })
    await applyConfigOptions(conn, res.sessionId, res.configOptions, ctx)   // §5.3
    return { sessionId: res.sessionId, preparation: prep, replayedHistory: true }  // 新会话：本轮 prompt 要带交接简报（08）
  }
}
```

注意 `session/load` 会让 agent 通过 `session/update` 回放历史：映射器在"加载阶段"必须**丢弃**这些回放的 `user_message_chunk` / `agent_message_chunk`，不能再写进 Kun 的时间线（Kun 已经有这段历史）。实现：`AcpSessionHandle.phase = 'loading' | 'prompting'`，加载阶段的 update 只用于更新 config/commands 缓存。

### 5.2 `cwd` 与 `mcpServers`

- `cwd` 永远是 07 的任务工作区路径（一对一且未开隔离时是用户选的工作区）。
- `mcpServers` 注入 Kun Tools MCP server（05 §2）：
  - agent 声明 `mcpCapabilities.http` → `{ type: 'http', name: 'kun', url, headers: [{ name: 'Authorization', value: 'Bearer <per-session token>' }] }`
  - 否则 → stdio 形式：`{ name: 'kun', command: <kun 可执行文件>, args: ['mcp-bridge', '--session', <id>], env: [...] }`，由一个轻量桥进程转发到本机 HTTP 端点。
- 用户在 Kun 里配置的其它 MCP server：**默认不透传**给外部 agent（它们可能有自己的 MCP 配置，重复注入会冲突）；通过 Kun Tools MCP server 的门面工具间接可用。

### 5.3 模型、模式、推理强度

优先用 config options，回退到旧的 modes：

```ts
async function applyConfigOptions(conn, sessionId, options: AcpConfigOption[] | undefined, ctx) {
  if (!options) return fallbackToModes(conn, sessionId, ctx)
  const byCategory = indexBy(options, (o) => o.category)
  await setIfDifferent(byCategory.model, ctx.route.model)                         // 找不到精确 id 时不猜，保持 agent 默认并记日志
  await setIfDifferent(byCategory.thought_level, mapEffort(ctx.reasoningEffort))  // off/low/medium/high/max → agent 选项
  await setIfDifferent(byCategory.mode, ctx.permissionModeId)                     // 02 §5.3 解析出的档位
  async function setIfDifferent(opt, value) {
    if (!opt || value === undefined || opt.currentValue === value) return
    if (!opt.options?.some((o) => o.value === value)) return
    // 参数字段名以官方 schema 为准（这里的 configId/value 只是示意）
    await conn.rpc.request('session/set_config_option', { sessionId, configId: opt.id, value })
  }
}
```

- 模型列表来源：`session/new` 返回的 model 类 config option；在 `GET /v1/harnesses/:id/models` 里通过一次"探测会话"获取并缓存（不发 prompt，不产生费用），探测会话结束后丢弃。
- `config_option_update` 通知到达时更新缓存，并发出 `harness_session_state` 事件（§7.3），composer 据此刷新控件。

## 6. 一轮（runTurn）

```ts
async runTurn(threadId, turnId, signal): Promise<TurnRunOutcome> {
  const ctx = await this.loadTurnContext(threadId, turnId)          // 线程、turn、items、工作区、路由、权限档
  const lease = await this.pool.acquire(ctx.connectionKey, () => this.connect(ctx))
  try {
    const session = await this.sessions.ensure(ctx, lease.connection)
    const prompt = buildPromptBlocks(ctx, session, lease.connection.initResult.agentCapabilities.promptCapabilities)
    const mapper = new AcpEventMapper(ctx, this.deps.recorder)      // 负责写 items / events
    const unsubscribe = lease.connection.onSessionUpdate(session.sessionId, (u) => mapper.apply(u))
    const onAbort = () => this.cancel(lease.connection, session.sessionId)
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      const res = await lease.connection.rpc.request('session/prompt',
        { sessionId: session.sessionId, prompt }, { timeoutMs: ctx.limits.turnWallMs })
      await mapper.flush()
      await this.sessions.commit(session, ctx)                      // DelegatedSessionCoordinator.commit
      return outcomeFromStopReason(res.stopReason, signal)
    } finally {
      signal.removeEventListener('abort', onAbort)
      unsubscribe()
    }
  } catch (error) {
    return this.failTurn(ctx, error)                                // 统一错误映射，见 §9
  } finally {
    this.pool.release(lease)
  }
}
```

`buildPromptBlocks`：

1. 会话是新建的（`replayedHistory: true`）且线程有更早历史 → 第一块是 08 的交接简报文本块。
2. 用户消息正文 + composer contexts（沿用 `userMessageTextWithComposerContexts`）。
3. 图片附件：`promptCapabilities.image` 为真时转成 image 块，否则转成文件路径文本并在 UI 提示（02 §6.2）。
4. 文件引用：转成 `resource_link` 块（路径必须在工作区内）。
5. 客户端表面说明（`buildClientSurfaceInstruction`）作为文本块追加在末尾，不进 harness 的 system prompt。

`outcomeFromStopReason`：

| stopReason | TurnRunOutcome | 额外处理 |
| --- | --- | --- |
| `end_turn` | `completed` | |
| `max_tokens` / `max_turn_requests` | `completed` | 在时间线追加一条系统提示：因上限停止 |
| `refusal` | `failed` | 错误码 `harness_refusal` |
| `cancelled` | `aborted` | |

取消：

```ts
private async cancel(conn: AcpConnection, sessionId: string) {
  conn.clientHost.cancelPendingPermissions(sessionId)          // 规范要求：挂起的权限请求回复 cancelled
  conn.rpc.notify('session/cancel', { sessionId })
  // 给 agent 10s 回复 cancelled；超时则标记该连接不健康，下一次 acquire 重建进程
  conn.expectPromptSettlement(sessionId, 10_000).catch(() => this.pool.markUnhealthy(conn))
}
```

## 7. 事件映射：`acp-event-mapper.ts`

### 7.1 消息与思考

| update | Kun |
| --- | --- |
| `agent_message_chunk`（text） | `assistant_text_delta`（增量 chunk，不是累计全文——这是 Claude SDK 接入时踩过的坑）；turn 结束时 `item_created`/`item_completed` 写完整 `assistant_text` |
| `agent_message_chunk`（image） | 保存为附件，追加 markdown 引用 |
| `agent_thought_chunk` | `assistant_reasoning_delta`，结束时写 `assistant_reasoning` |
| `user_message_chunk` | 加载阶段丢弃；提示阶段忽略（Kun 自己写用户消息） |

### 7.2 工具调用

```ts
function toolItemKind(kind: AcpToolKind): 'tool_call' | 'command_execution' | 'file_change' {
  switch (kind) {
    case 'edit': case 'delete': case 'move': return 'file_change'
    case 'execute': return 'command_execution'
    default: return 'tool_call'                      // read / search / fetch / think / switch_mode / other
  }
}
```

| update | Kun |
| --- | --- |
| `tool_call` | `tool_call_ready` + `item_created`（`tool_call` item，`toolKind` 按上表，`toolName` = `acp:${kind}`，标题用 `title`） |
| `tool_call_update` status → in_progress | `tool_call_started`（只发一次） |
| `tool_call_update` status → completed / failed | `tool_call_finished` + `tool_result` item；`failed` 标错误 |
| `content: diff` | `tool_result` 里带结构化 diff（path、old、new），供 Changes 面板和 AI 行归属（11 §4） |
| `content: terminal` | 关联 §8.2 的受管终端，结果里引用终端输出 |
| `locations` | 写进 item metadata，UI 可点击跳转 |

`tool_call` 和 `tool_call_update` 可能乱序或重复：映射器按 `toolCallId` 维护状态机，重复的终态忽略，未见过 `tool_call` 就先到的 update 先建占位。

### 7.3 其它

| update | Kun |
| --- | --- |
| `plan` | `todos_updated`（条目映射到 Kun todo：content、status、priority） |
| `available_commands_update` | 缓存到会话；发 `harness_session_state` 事件，composer 斜杠菜单用 |
| `current_mode_update` / `config_option_update` | 同上，更新模式/模型/推理强度的当前值 |
| `usage_update` | `usage` 事件（有 token 数时）+ `context_snapshot`（有窗口占用时）；`usageReporting` 事实置为 exact |
| `session_info_update` | 忽略标题（Kun 自己生成标题）；时间戳只记 debug |

新事件 `harness_session_state`（`kun/src/contracts/events.ts` 新增一个 kind）：

```ts
export const HarnessSessionStateEvent = RuntimeEventBase.extend({
  kind: z.literal('harness_session_state'),
  harnessId: HarnessIdSchema,
  commands: z.array(z.object({ name: z.string(), description: z.string().optional(),
    inputHint: z.string().optional() }).strict()).max(200).optional(),
  configOptions: z.array(HarnessConfigOptionSchema).max(32).optional()
})
```

## 8. 客户端方法：`acp-client-host.ts`

所有方法先按 `sessionId` 找到所属线程/turn/工作区；找不到或 turn 已结束 → JSON-RPC 错误（不猜归属）。

### 8.1 文件

```ts
async readTextFile({ sessionId, path, line, limit }) {
  const ctx = this.contextFor(sessionId)
  const abs = resolveInside(ctx.readRoots, path)          // 工作区 + additionalWorkspaces + 已挂载只读根；越界即拒绝
  return { content: await readLines(abs, line, limit, { maxBytes: 2 * 1024 * 1024 }) }
}

async writeTextFile({ sessionId, path, content }) {
  const ctx = this.contextFor(sessionId)
  const abs = resolveInside(ctx.writeRoots, path)         // 只允许任务工作区
  const decision = await ctx.approve({ kind: 'file', target: abs, toolName: 'acp:write' })
  if (decision !== 'allow') throw rpcError(-32001, 'write rejected by Kun policy')
  await ctx.ensureCheckpoint()                            // 与委派路径一致：变更前确保工作区检查点
  const before = await readIfExists(abs)
  await atomicWriteFile(abs, content)
  ctx.recordFileChange({ path: abs, before, after: content, source: 'acp-fs' })   // 归属与 Changes 面板
  return {}
}
```

审批去重：多数 agent 会先发 `request_permission` 再写文件。同一 `toolCallId` 已被允许的写入在本轮内不再二次审批；`ctx.approve` 内部按 (turnId, 目标路径) 查最近的允许记录。

### 8.2 终端

- `terminal/create`：命令、参数、环境、`cwd`（必须在工作区内）、`outputByteLimit`。用 `spawnOwnedProcess` 启动（`BackgroundShellRuntime` 只是 bash 工具后台会话的登记表，不提供启动能力），句柄登记在新的 `AcpTerminalRegistry`（按 sessionId + turnId），turn 结束或取消时 `stopOwnedProcess` 回收整棵进程树。
- 审批：命令执行按 Kun 策略判定；如果本轮已经为对应工具调用允许过，不再二次询问。
- `output` / `wait_for_exit` / `kill` / `release`：直接映射到受管 shell 的对应操作；`release` 后句柄失效。
- 输出受 `outputByteLimit` 和 Kun 工具输出上限双重限制，截断时返回 `truncated: true`。

### 8.3 权限

```ts
async requestPermission({ sessionId, toolCall, options }) {
  const ctx = this.contextFor(sessionId)
  const envelope = approvalEnvelopeFromAcp(toolCall)       // kind 映射：execute→command，edit/delete/move→file，fetch→network，其余→unknown
  const pending = this.pendingPermissions.track(sessionId)
  try {
    const decision = await ctx.approvalGate.request({ ...envelope, threadId: ctx.threadId, turnId: ctx.turnId })
    const pick = decision === 'allow'
      ? options.find((o) => o.kind === 'allow_once') ?? options.find((o) => o.kind === 'allow_always')
      : options.find((o) => o.kind === 'reject_once') ?? options.find((o) => o.kind === 'reject_always')
    return pick ? { outcome: { outcome: 'selected', optionId: pick.optionId } } : { outcome: { outcome: 'cancelled' } }
  } finally {
    pending.done()
  }
}
```

- Kun 的审批只有"这一次"的语义，**永远不选 `allow_always`**，除非选项里只有它；这样权限不会在 agent 侧被持久放大。
- 审批者为 `agent`（approve-for-me）时走现有 `approvalReview` 服务，和原生 loop 一致。
- turn 取消时 `cancelPendingPermissions` 让所有挂起请求回复 `cancelled`。

### 8.4 elicitation（P2）

映射到 Kun 的 `user_input` 门（该 turn `disableUserInput` 为假时）；否则回复拒绝。总管派出的 worker 默认 `disableUserInput: true`，问题改走 `ask_manager`（05 §2.2）。

## 9. 错误与超时

| 情况 | 处理 |
| --- | --- |
| 命令不存在 / 启动失败 | turn 失败，错误码 `harness_not_ready`，文案指向设置页检测 |
| initialize 超时（20s） | 同上，附 stderr 尾部（脱敏） |
| 需要认证 | 同上，提示登录 |
| 进程在一轮中退出 | turn 失败 `harness_crashed`；该连接上所有会话标记 `native_state_unavailable` |
| 长时间无 update（默认 10 分钟）且无挂起审批 | 不终止；ActivityStore 标记 `stalled`（06），通知用户 |
| JSON 解析失败 / 未知必需字段 | 记 debug，turn 失败 `harness_protocol_error` |
| agent 调用未声明的客户端方法 | 回复 JSON-RPC `method not found` |

所有错误的用户文案不包含凭据、完整环境变量或未脱敏的路径以外信息。

## 10. 能力推导：`acp-capabilities.ts`

| 能力 | 来源 |
| --- | --- |
| nativeResume | `agentCapabilities.loadSession` |
| imageInput | `promptCapabilities.image` |
| fileInput | `promptCapabilities.embeddedContext` |
| kunTools | 总是 supported（http 或 stdio 桥二选一） |
| externalApproval | supported（`request_permission` 是基线方法）；但 agent 自己的免审批模式会绕过，所以 02 的准入对 room-execution 仍要求 sandbox = host |
| fsMediated / terminalMediated | supported 表示"Kun 提供了"；agent 是否使用不可保证，因此 `facts.sandbox` 仍取 harness 目录里的声明（通常 `native` 或 `none`） |
| sameTurnSteer | upstream（协议无对应方法） |
| fork / rewind | upstream |
| modes / effort | 会话返回对应类别的 config option 时 supported |
| nativeCommands | 收到过 `available_commands_update` 后 supported |
| nativeContextTelemetry | 收到过带窗口信息的 `usage_update` 后 supported |
| usageReporting | 有 token 数的 `usage_update` → exact；否则 none |
| compactionOwner | harness（ACP agent 自己管理上下文） |

## 11. 观测与调试

- 复用 `ModelRequestTraceDelegated`：每轮记录 harnessId、协议版本、sessionId（哈希）、stopReason、耗时、工具调用数。
- LLM debug 开关打开时，把 JSON-RPC 帧写入现有 debug sink，**先脱敏**：去掉 headers、env、文件全文（只保留长度和哈希）。

## 12. 测试

测试夹具：`kun/src/runtime/acp/__fixtures__/fake-acp-agent.mjs`，一个按脚本回应的最小 ACP agent（读 stdin 逐行 JSON，按场景文件输出 update 和响应）。

| 测试 | 断言 |
| --- | --- |
| `acp-jsonrpc.test.ts` | 分帧、并发请求、超时、双向请求、畸形行 |
| `acp-runtime.test.ts` | 一轮完整流程：文本、思考、工具调用、diff、plan、usage 映射正确 |
| 取消 | 挂起的权限被回复 cancelled；agent 回复 cancelled → turn aborted；agent 不回复 → 连接被标记不健康 |
| 加载会话 | `session/load` 的历史回放不写进 Kun 时间线；load 失败 → rejectResume → 新会话 + 交接简报 |
| 客户端方法 | 工作区外读写被拒；写入触发审批与检查点；同一工具调用不二次审批 |
| 权限 | 永不选 allow_always；审批者 agent 时走 approvalReview |
| 进程崩溃 | 一轮中退出 → turn failed `harness_crashed`，下一轮 portable 重建 |
| 真实二进制（手动/夜间） | 13 §5 的 harness 冒烟清单 |

## 13. 文件清单

新增：`kun/src/runtime/acp/*`（§3）、`kun/src/harness/harness-env.ts`、测试夹具。

修改：

- `kun/src/runtime/delegated-session-binding.ts`（`DelegatedProviderKind` 加 `acp`）
- `kun/src/runtime/agent-sdk/sdk-options-builder.ts`（`buildScopedEnv` 改用 `harness-env.ts`）
- `kun/src/contracts/events.ts`（`harness_session_state`、`providerKind` 加 `acp`）
- `kun/src/server/runtime-composition-agent.ts`（注册 acp 运行时）
- `src/renderer/src/agent/kun-mapper-projection.ts`（解析新事件）
