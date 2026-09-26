# 05 Worker 回调通道：Kun Tools MCP server、worker 工具、CLI 回调、托管 hooks

- 阶段：P1（MCP server、worker 工具）；P2（CLI 回调、托管 hooks、终端 agent）
- 依赖：01、02、06、09
- 被依赖：03、09、10

## 1. 目标

外部 harness 上的 worker 需要三件事：

1. 用上 Kun 独有的工具（记忆、画布、网页、技能、MCP 门面……）。
2. 和总管通信：汇报进度、提问、提交结构化结果、读总管的上下文。
3. 让宿主知道它的状态——对结构化 harness 这是天然的；对只在终端里跑的 agent，需要 hooks。

按 harness 的接入方式选通道：

| transport | Kun 工具与 worker 工具 | 状态来源 |
| --- | --- | --- |
| native-loop | 原生工具注册表 | 原生事件 |
| agent-sdk / cursor-sdk | 现有进程内工具桥（`sdk-tool-bridge.ts`、`cursor-sdk-tool-bridge.ts`） | 适配器事件 |
| acp | Kun Tools MCP server（§3） | ACP `session/update` |
| terminal | `kun worker` CLI 回调（§5） | 托管 hooks（§6） |

## 2. Worker 工具

新增工具提供者 `kun/src/adapters/tool/worker-callback-tool-provider.ts`，写法与现有提供者一致（`LocalToolHost.defineTool({ name, description, inputSchema, policy, sideEffect, shouldAdvertise, execute })`，参考 `context-window-tool-provider.ts`），提供者 `kind: 'delegation'`。
**只在 worker 线程上广告**，普通会话看不到。

`shouldAdvertise(context)` 是同步函数，只能读 `ToolHostContext`（`kun/src/ports/tool-host.ts`），而它目前没有线程的执行单元信息。因此 `ToolHostContext` 新增两个字段，由 agent loop 与外部运行时的工具桥在构造上下文时从线程记录填入：

```ts
/** 本轮运行的 harness（01）；工具桥为外部 harness 构造上下文时必填 */
harnessId?: string
/** 线程的执行单元类型（09 §3.1）；普通线程缺省 */
executionUnitKind?: 'worker'
```

- worker 回调工具：`shouldAdvertise = (ctx) => ctx.executionUnitKind === 'worker'`。
- 总管工具（09 §4）：`shouldAdvertise = (ctx) => ctx.workspaceMode === 'ade' && (ctx.harnessId ?? 'kun') === 'kun' && ctx.executionUnitKind !== 'worker' && !ctx.roomAgent`（ADE 独立模式，见 00 §3；`ToolHostContext` 同时新增 `workspaceMode?`）。IM / 定时任务触发的总管 turn 也能派活，但按无人值守规则执行（不升级权限、回落最严档，02 §4）。

### 2.1 `report_progress`

```ts
input: {
  summary: string            // ≤ 280 字，第一句写"刚做了什么"
  phase?: 'investigating' | 'implementing' | 'verifying' | 'blocked'
}
```

- 写入 ActivityStore 行的 `progressNote` 和 `phase`（06 §3），不调模型、不产生 turn。
- 限流：同一 worker 10 秒内最多一次，超出返回 `rate_limited` 但不算错误。
- 总管不会因为进度而被唤醒（避免来回摇摆）；只在看板和总管的 Workers 轨道里显示。

### 2.2 `ask_manager`

```ts
input: {
  question: string
  options?: string[]         // 给出选项时总管/用户只能选其一
  timeoutSeconds?: number    // 默认 600，最大 3600
}
output:
  | { status: 'answered'; answer: string; answeredBy: 'manager' | 'user' }
  | { status: 'timeout' }                      // worker 应按最保守的假设继续，并在结果里写明
  | { status: 'cancelled' }
```

流程（实现见 09 §6）：

1. 创建 `QuestionRecord`（持久化，带 dispatchId、workerId、选项、截止时间）。
2. ActivityStore 行进入 `waiting_input`（原因 `question`）。
3. 总管线程空闲 → 用一个 host-control turn 唤醒总管，把问题作为结构化上下文注入；总管线程忙 → 排进总管的待处理问题队列，当前 turn 结束后处理。
4. 总管用 `worker_answer` 工具回答，或判断需要用户决定时调用 `user_input`（问题升级到用户，出现在总管线程的输入面板里）。
5. worker 的工具调用一直阻塞到有答案或超时。阻塞期间 worker 的 turn 保持运行，但不计入"卡住"检测（06 §6）。

### 2.3 `read_manager_context`

```ts
input: { query?: string; cursor?: string; limit?: number }   // limit 默认 10，最大 50
output: { items: Array<{ role: 'user' | 'assistant'; text: string; turnId: string; createdAt: string }>;
          nextCursor?: string }
```

- 身份由宿主认证：只能读**自己所属总管线程**的 user / assistant 文本，不能指定任意线程。
- 只返回可见消息，不返回工具结果、推理、系统上下文。
- 使用时机写进工具描述：只在任务依赖"当前这个问题 / 刚才说的方案"这类相对范围时读；任务自包含时不需要。
- 实现复用 08 §5 的历史读取服务。

### 2.4 `submit_result`

```ts
input: {
  summary: string                                  // 做了什么、发现了什么、还剩什么
  outcome: 'succeeded' | 'partial' | 'failed'
  filesChanged?: string[]
  checks?: Array<{ name: string; status: 'passed' | 'failed' | 'skipped'; detail?: string }>
  risks?: string[]
}
```

- 可选。完成与否由宿主根据 turn 结果判定（09 §5），不依赖 worker 调用这个工具。
- 调用后写入当前 dispatch 的 `workerReport`；总管汇总时优先用它，没有则用 worker 最后一条助手消息。
- `filesChanged` 只是参考，最终以 07 的 git 采集结果为准；两者不一致时在审查面板提示。

## 3. Kun Tools MCP server

### 3.1 为什么需要

ACP agent 只能通过 `session/new` 的 `mcpServers` 拿到额外工具。Kun 目前只有 MCP **客户端**（`@modelcontextprotocol/client`），没有服务端。

### 3.2 共享执行宿主

从 `kun/src/runtime/agent-sdk/agent-sdk-runtime-factory-tools.ts:123` 的 `createAgentSdkToolRuntimeDeps().executeKunTool` 抽出传输无关的宿主：

```ts
// kun/src/harness/kun-tool-bridge-host.ts（新增）
export interface KunToolBridgeHost {
  /** 本轮可以桥接给 harness 的工具：已按 turn 的能力快照、计划上下文、surface 过滤，并去掉与 harness 内置重叠的工具 */
  listTools(threadId: string, turnId: string, opts: { overlap: ReadonlySet<string> }): Promise<BridgedToolSpec[]>
  /** 与 SDK 路径完全相同的执行语义：审批、沙箱、技能、计划写盘路径、画布回执 */
  execute(threadId: string, turnId: string, call: {
    toolName: string; args: Record<string, unknown>; callId?: string; signal: AbortSignal
  }): Promise<KunToolResult>
}
```

- `executeKunTool` 的实现整体搬过去，Claude SDK、Cursor SDK、MCP server 三处都调用它；各自只保留格式转换（`mapKunResultToSdkContent`、Cursor 的 `SDKCustomTool`、MCP 的 `CallToolResult`）。
- `listTools` 复用 `selectBridgeableTools` 和 `DEFAULT_OVERLAP_TOOL_NAMES`（`sdk-tool-bridge.ts:51`）。ACP agent 的内置工具集合各不相同，overlap 集合放在 harness 定义里（`HarnessDefinition.overlapTools`，缺省用默认集合）。

### 3.3 服务端实现：`kun/src/server/routes/kun-tools-mcp.ts`（新增）

只实现 MCP streamable HTTP 的最小子集，不引入新依赖：

| JSON-RPC 方法 | 处理 |
| --- | --- |
| `initialize` | 协商协议版本（取客户端请求版本与本端支持列表的交集中最新的），`capabilities: { tools: { listChanged: false } }`，`serverInfo: { name: 'kun' }` |
| `notifications/initialized` | 记录会话已初始化，返回 202 |
| `ping` | 空结果 |
| `tools/list` | `host.listTools()` → `{ name, description, inputSchema }`；分页可选 |
| `tools/call` | `host.execute()` → `{ content: [...], isError }` |
| 其它 | JSON-RPC `-32601` |

```ts
export async function handleKunToolsMcp(runtime: ServerRuntime, request: Request): Promise<Response> {
  const grant = runtime.harnessTokens.verifyScope(bearer(request), 'kun-tools')   // 与 04 的令牌服务同一套，scope 不同
  if (!grant) return jsonRpcHttpError(401, 'unauthorized')
  const message = await readJsonRpc(request, { maxBytes: 1024 * 1024 })
  if (Array.isArray(message)) return jsonRpcHttpError(400, 'batch not supported')   // 批量请求不支持，避免身份混淆
  const turnId = runtime.activity.currentTurnFor(grant.threadId)
  if (message.method === 'tools/call') {
    if (!turnId) return jsonRpcResult(message.id, toolError('no active turn for this session'))
    const result = await runtime.kunToolBridge.execute(grant.threadId, turnId, {
      toolName: String(message.params?.name ?? ''), args: asRecord(message.params?.arguments),
      callId: `mcp_${message.id}`, signal: runtime.turns.abortSignalFor(grant.threadId, turnId)
    })
    return jsonRpcResult(message.id, toMcpCallToolResult(result))
  }
  // initialize / tools/list / ping ...
}
```

- 路由：`POST /mcp/kun`（不放在 `/v1/` 下，避免与运行时令牌鉴权混在一起）；`GET /mcp/kun` 返回 405（不提供服务端推送流）。
- 身份：每个 harness 会话一个 `kun-tools` 范围令牌，绑定 threadId。**工具调用落在该线程当前运行中的 turn**；没有运行中的 turn 时拒绝，保证"工具只在一轮对话里执行"。
- 审批：走 `host.execute` 内部的 `ApprovalGate`，和 SDK 路径一致；MCP 协议层不做任何放行。
- stdio 形态：给不支持 HTTP MCP 的 agent 提供 `kun mcp-bridge --token-env KUN_TOOLS_TOKEN`，它把 stdio JSON-RPC 逐条转发到 `/mcp/kun`。令牌通过环境变量传，不进 argv（argv 在进程列表里可见）。

## 4. 令牌范围

`HarnessGatewayTokenService`（04 §4）扩展为通用的 `HarnessTokenService`，每个 grant 带 `scopes`：

| scope | 可访问 | 签发时机 |
| --- | --- | --- |
| `gateway` | `/v1/messages*`、`/v1/chat/completions`、`/v1/responses`、`/v1/models` | `credentialMode: 'kun-gateway'` 的会话 |
| `kun-tools` | `/mcp/kun` | 所有 ACP 会话；SDK 路径不需要（进程内桥） |
| `worker-callback` | `/v1/worker-callbacks/*` | 所有 worker（终端 agent 也需要） |
| `hook-ingest` | `/v1/activity/hooks` | 终端 agent |

一个会话只签发它需要的 scope。令牌格式、存储和撤销规则同 04 §4。

## 5. `kun worker` CLI 回调（P2）

给只能跑 shell 的 agent（终端 agent，以及不想暴露 MCP 的场景）用。

### 5.1 命令

```text
kun worker progress "<summary>" [--phase implementing]
kun worker ask "<question>" [--options a,b,c] [--timeout 600]      # 阻塞，stdout 输出 JSON {status, answer?}
kun worker result --outcome succeeded --summary "<text>" [--files a,b] [--check name=passed]
kun worker context [--query "<text>"] [--limit 10]
kun worker hook <event>                                             # 托管 hooks 的入口，从 stdin 读 hook JSON（§6）
```

### 5.2 实现

- 入口：`kun/src/cli/serve-entry.ts:423` 的 `main()` 里，与 `manager` / `extension` 并列加 `if (argv[0] === 'worker') return runWorkerCallbackCommand(...)`。
- 新文件 `kun/src/cli/worker-callback-cli.ts`：读环境变量 `KUN_WORKER_ENDPOINT`（`http://127.0.0.1:<port>`）和 `KUN_WORKER_TOKEN`，POST 到对应路由，输出一行 JSON。
- 服务端路由 `kun/src/server/routes/worker-callbacks.ts`：`POST /v1/worker-callbacks/{progress,ask,result,context}`，令牌 scope `worker-callback`，逻辑与 §2 的工具完全相同（两者都调用 `WorkerCallbackService`）。
- `ask` 是长请求：服务端最多挂起 `timeout` 秒，期间客户端每 15 秒收到一次心跳注释行（SSE 注释或分块空白）防止代理断开。

### 5.3 让 agent 知道这些命令

- 不往用户全局的 agent 配置里写 skill。
- 终端 agent 的任务简报（08 §4）末尾附一段"与总管通信"说明，列出上面的命令；这段说明属于 turn 输入，不进任何 system prompt。

## 6. 托管 hooks 与终端 agent（P2）

### 6.1 终端 agent 的启动

`HarnessDefinition` 增加终端字段：

```ts
terminal: z.object({
  /** 如何把初始任务交给 CLI：argv 追加 / 指定参数 / 等就绪后粘贴 */
  promptInjection: z.enum(['argv', 'flag', 'paste-after-ready']),
  promptFlag: z.string().max(64).optional(),
  /** 恢复原生会话的参数模板，{sessionId} 占位 */
  resumeArgs: z.array(z.string().max(128)).max(8).optional(),
  /** hooks 的注入方式；none 表示只能靠终端标题等弱信号 */
  hooks: z.enum(['per-launch-settings', 'env-config-dir', 'none'])
}).strict().optional()
```

流程：

1. GUI 发起"在终端里运行某 agent"时，先调用 `POST /v1/execution-units`（kind `terminal-agent`）在 kun 里登记执行单元，拿到 `unitId` 和 `worker-callback` + `hook-ingest` 令牌。
2. 主进程用现有 PTY（`src/main/terminal/terminal-pty-ipc.ts`）启动命令，`cwd` = 07 的任务工作区，环境变量加上 `KUN_WORKER_ENDPOINT`、`KUN_WORKER_TOKEN`、`KUN_UNIT_ID`。
3. PTY 退出时主进程调用 `POST /v1/execution-units/:id/exit`，带退出码。
4. 终端 agent 的 PTY 属于应用会话，应用退出时按现有退出屏障回收（不常驻，见 README §8）。

`paste-after-ready` 是最脆弱的方式（要判断 TUI 何时可以接收输入）。**只有在 argv / flag 都不支持时才用**，并且判定规则必须基于录下来的真实终端输出编写测试（参考项目在这上面反复失败过）。

### 6.2 hooks 注入

优先**每次启动时指定配置**，不改用户全局配置：

- `per-launch-settings`：CLI 支持通过参数指定额外配置文件时，Kun 为这个执行单元生成一个临时配置（放在 `dataDir/ade/hooks/<unitId>/`），只包含 Kun 的 hooks，退出后删除。
- `env-config-dir`：CLI 支持通过环境变量指定配置目录时，生成一个叠加目录。
- 两者都不支持的 harness：不装 hooks，状态只来自进程存活与退出（`facts.usageReporting = none`，状态精度低，在 UI 标注）。

每个 hook 的命令都是 `kun worker hook <event>`，由 CLI 把 stdin 的 hook JSON 裁剪后 POST 到 `/v1/activity/hooks`。

### 6.3 hook 事件到状态的映射

以 Claude Code 的 hook 事件为例（其它 CLI 在接入时按其文档补表）：

| hook 事件 | ActivityStore 写入 |
| --- | --- |
| `SessionStart` | 记录原生 sessionId（用于 resume）；状态 `idle` |
| `UserPromptSubmit` | `working` |
| `PreToolUse` / `PostToolUse` | `working`，更新 `currentTool` |
| `PermissionRequest` / 权限类 `Notification` | `waiting_approval`（审批发生在终端里，Kun 只显示"去终端处理"） |
| `Stop` | `done`（本轮结束，等待下一条输入） |
| `StopFailure` | `failed` |
| `SubagentStart` / `SubagentStop` | 子项计数（06 §3 的 `children`） |
| `PreCompact` | `working`，phase `compacting` |
| `SessionEnd` | `closed` |

- 取消：多数 CLI 在用户中断时不发 hook。Kun 在主进程检测到用户在该 PTY 里按了中断键（Ctrl+C / Esc）后，写一条 `inferredInterrupt` 事实，下一次 `Stop` 按 `cancelled` 处理。这是推断，行上标注来源为 `inferred`。
- 裁剪：hook JSON 最大 64 KiB；只保留状态所需字段（事件名、sessionId、工具名、时间）。**不信任 hook 里的任何路径做写操作**。

## 7. 安全要点

- 四种 scope 的令牌互不通用；终端 agent 拿到的令牌不能调用模型网关或 Kun 工具。
- `ask_manager` 的答案来自总管或用户，写进 worker 工具结果；不会授予 worker 任何额外权限（权限上限见 09 §7）。
- `read_manager_context` 只返回可见文本，并受总管线程的记忆/隐私边界约束：如果总管线程挂了知识库或私有记忆，这些检索结果不出现在返回里。
- 所有回调路由都有请求体上限和速率限制。

## 8. 测试

| 测试 | 断言 |
| --- | --- |
| `kun-tool-bridge-host.test.ts` | 抽出后，Claude SDK 现有工具桥测试全部通过（行为不变） |
| `kun-tools-mcp.test.ts` | initialize 版本协商；tools/list 与 SDK 路径列出的工具集合一致；无运行中 turn 时 tools/call 被拒；批量请求被拒；错误令牌 401 |
| `worker-callback-tool-provider.test.ts` | 非 worker 线程不广告；report_progress 限流；ask_manager 超时返回 timeout |
| `worker-callbacks.test.ts`（路由） | 与工具同一服务；ask 长请求心跳与超时 |
| `worker-callback-cli.test.ts` | 缺环境变量时的错误输出；JSON 输出格式 |
| hooks 映射 | 每个事件映射到正确状态；超大 payload 被截断；未知事件忽略 |
| 终端 agent 登记与退出 | PTY 退出后执行单元进入 closed；应用退出时 PTY 被回收 |

## 9. 文件清单

新增：

- `kun/src/harness/kun-tool-bridge-host.ts`、`harness-token-service.ts`（由 04 的令牌服务改名扩展）
- `kun/src/adapters/tool/worker-callback-tool-provider.ts`
- `kun/src/services/worker-callback-service.ts`
- `kun/src/server/routes/kun-tools-mcp.ts`、`worker-callbacks.ts`、`execution-units.ts`
- `kun/src/cli/worker-callback-cli.ts`、`mcp-bridge-cli.ts`

修改：

- `kun/src/runtime/agent-sdk/agent-sdk-runtime-factory-tools.ts`、`kun/src/runtime/cursor/cursor-sdk-tool-bridge.ts`（改用共享宿主）
- `kun/src/cli/serve-entry.ts`（`worker`、`mcp-bridge` 子命令）
- `src/main/terminal/terminal-pty-ipc.ts`（登记执行单元、注入环境变量、退出上报、中断推断）
