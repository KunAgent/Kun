# Agent Runs 与工具

> Extension API：v1
> English: [Agent Runs and tools](./agent-and-tools.en.md)
> 相关：[单 runtime 架构](./architecture.md) · [权限与配额](./security-and-resources.md)

扩展可以让 Kun Agent 为自己的应用执行工作，也可以注册工具供 Kun 调用。两个方向都经过唯一 `kun serve` 的 AgentLoop、ThreadStore、EventBus、ApprovalGate 和 ToolHost；扩展没有 runtime token，也不能创建第二套 Agent loop。

## 权限

| 能力 | 权限 |
| --- | --- |
| 创建、steer、cancel 自有 Run | `agent.run` |
| 查询自有 thread/run 投影 | `agent.threads.readOwn` |
| 注册 Manifest 声明的工具 | `tools.register` |
| 运行中读写 workspace、联网、使用账号 | 对应 `workspace.*`、`network:*`、`accounts.use:*` |

权限只允许 Broker 调用。每个模型/工具步骤在使用时重新检查当前 grant、workspace trust 和 policy；Run 创建时存在的权限被撤销后，后续步骤会失败。

## 稳定 Agent API

v1 提供：

- `agent.getRunOptions`
- `agent.createRun`
- `agent.listRunEvents`
- `agent.subscribe`
- `agent.steer`
- `agent.cancel`
- `agent.getRun`
- `threads.listOwn`
- `threads.getOwn`

调用身份由 Host session 绑定，不从请求中的 `ownerExtensionId` 读取。请求、结果、事件和错误都经过协商版本 Schema。

`agent.getRunOptions()` 返回当前 Kun 主模型连接上已配置、可供 extension-owned Run 使用的模型。每项只包含安全的 `id`、`displayName`、`selected`、`reasoningEfforts` 和 `defaultReasoningEffort`；不会暴露 Provider 凭据、账号或其它连接。`reasoningEfforts` 使用 Kun 稳定语义值 `auto | off | low | medium | high | max`。适配器可在请求上游时转换成 Provider 的 wire 值，例如将 Codex 的 `max` 转成 `xhigh`。

```ts
const options = await context.agent.getRunOptions()
const selected = options.models.find(model => model.selected)!

const { run } = await context.agent.createRun({
  input: 'Implement the task',
  model: selected.id,
  reasoningEffort: selected.defaultReasoningEffort
})
```

`model` 和 `reasoningEffort` 只影响新 Run/新 Turn，不能通过 `steer` 修改正在执行的 Run。Host 会拒绝未配置模型、不受该模型支持的推理强度，以及把 Host 模型选择与扩展自有 `providerBinding` 混用的请求。Run 投影中的 `model` 和可选 `reasoningEffort` 是实际已接纳值。

## 创建 Run

概念示例：

```ts
const { run, createdThread } = await context.agent.createRun({
  input: 'Summarize the open issues',
  workspace: context.workspaceContext?.root,
  profileId: 'issue-triage',
  providerBinding: {
    providerId: 'acme.models',
    accountId: selectedAccount.id,
    modelId: 'reasoning-small'
  },
  budget: {
    maxTokens: 20_000,
    maxElapsedMs: 120_000,
    maxModelRequests: 8,
    maxToolInvocations: 20,
    maxEvents: 2_000
  },
  allowedTools: ['create-issue', 'lookup-issue']
})
```

以同版本 TypeScript 类型为字段真源。Kun 会把请求值与用户/宿主 policy 合并并 clamp，返回 `run.extensionBudget`；`createdThread` 表示这次是否创建了新 thread，而不是保证接受扩展请求的上限。

默认创建一个独立 extension-owned thread。持久化元数据包括：

- `ownerExtensionId` 和创建扩展版本；
- workspace scope；
- resolved Agent profile snapshot；
- Provider/model/account reference；
- token/time/concurrency/model/tool/event budget；
- tool catalog epoch、fingerprint 和 tool digests。

所有权属于稳定扩展 ID，所以新版本可以查询旧版本创建的自有 thread；原创建版本仍保留作审计。

## 恢复已有 Thread

只有显式传入 `threadId` 且同时满足以下条件才恢复：

- thread 由当前扩展 ID 拥有；
- workspace scope 兼容；
- thread 未 deleted；
- 没有不兼容 active run；
- 当前 profile/provider/account/tool policy 允许新 Run。

扩展不能收养主工作台或其它扩展 thread。拒绝结果不会泄漏 foreign thread 内容。`threads.listOwn/getOwn` 返回分页、有界投影；每个有运行记录的 thread 都包含安全投影后的 `latestRun`（状态、时间、profile 和用量），不提供 raw store access 或秘密。

## Run 生命周期与预算

```text
queued -> running <-> waiting-approval -> completed
                   <-> waiting-user-input -> failed
                                         \-> cancelled
                                         \-> budget-exhausted
```

Run 只有一个 terminal outcome。completion、cancel、tool failure、disable 和 thread deletion 竞争时，由 Kun terminal fence 决定唯一结果，之后不再提交模型/工具成功输出。

Run 请求预算字段覆盖 tokens、elapsed time、model requests、tool invocations 和 retained events；Host/user policy 另外限制 concurrent runs。达到 hard limit 后 Kun 停止后续工作并发出一次 `budget-exhausted`。用量、cache telemetry 和调用都按 extension/version/run/thread/profile/provider/model/account/catalog epoch 归因；复用已有 thread 时，Run 投影返回相对前一累计快照的本 Run 增量，而不是把旧 Run 用量重复归入当前 Run。

## 订阅与重放

`agent.listRunEvents` 从持久化事件源读取有界、正序的历史页，默认 100 条、最多 200 条：

```ts
const page = await context.agent.listRunEvents({
  runId: run.id,
  afterSequence: lastSeenSequence,
  limit: 100
})
lastSeenSequence = page.cursor
```

响应包含 `items`、数字 `cursor`、`hasMore` 和 `historyIncomplete`。同一个 cursor 可继续传给下一页或 `agent.subscribe.afterSequence`。`historyIncomplete` 表示更早的底层事件已按 Kun 留存策略清理；扩展必须在 UI 中明确展示缺口，不能推断或伪造内容。该方法只读取当前扩展拥有的 Run，并同时受 `agent.run` 与 `agent.threads.readOwn` 边界保护。

公共 message 事件包含稳定 `messageId` 与 `phase: 'delta' | 'replace' | 'complete'`。客户端对 delta 追加、对 replace/complete 按 `messageId` 覆盖，从而恢复流式正文而不生成重复气泡。用户与助手正文是字符串；工具消息只包含 Host 生成的工具名、状态和通用摘要，不包含原始参数、结果或路径。内部模型上下文、reasoning、附件路径和审批/输入凭据不会投影。

`agent.subscribe` 使用专用 authenticated event boundary，而不是 runtime bearer token。事件包含 owner scope、run ID、thread ID、type 和单调递增 sequence。

```ts
const subscription = await context.agent.subscribe({
  runId: run.id,
  afterSequence: lastSeenSequence
})
context.subscriptions.add(subscription)
context.subscriptions.add(
  subscription.onEvent(event => {
    lastSeenSequence = event.sequence
    render(event)
  })
)
```

重连时先按 sequence 从持久化事件源重放，再进入 live delivery。terminal 事件相对 cursor 最多交付一次。不要把 stream 全部复制进无界内存数组：每个 subscriber 有队列、消息大小和速率上限；lagging subscriber 会收到 resumable overflow/disconnect cursor，再从持久化源重连。

在 Webview 中，live `agent.event` 只通过当前 sender-bound View Session 的事件泵交付；它不会转发到同一扩展的其他 View 或 Node Host。View 关闭、崩溃、重载或换工作区时，该 Session 的订阅会被取消。官方 React hook 会按 sequence 去重并保留有界事件窗口。

事件不包含 runtime token、consent token、account secret、foreign thread 或未授权能力数据。

## Steering 与取消

`agent.steer` 只接受调用者拥有的 active Run，按接受顺序写入 Kun `SteeringQueue`，在 AgentLoop 支持的边界应用。它不能：

- 批准 tool call；
- 回答/取消 `request_user_input`；
- 提交账号 secret 或 consent；
- 绕过 workspace/tool/provider policy。

即使文本写着“我批准”，ApprovalGate 仍保持 pending。

`agent.cancel` owner-checked 且幂等。它取消 model request 和 ToolHost call、清空未应用 steering，并持久化唯一 cancelled terminal event。重复 cancel 得到一致结果，不会生成第二个 terminal。

## Agent Profiles

Profile 通过 `contributes.agentProfiles` 静态声明并按扩展命名空间注册。它可以包含：

- local ID 和显示信息；
- 有界 instruction overlay；
- 默认 Provider/model/account binding；
- allowed tool scope；
- budget defaults；
- visibility。

Profile 不能替换、重排或修改 Kun 稳定 system/few-shot prefix、ApprovalGate、tool history repair、sandbox 或隐藏运行时指令。Profile 文本是较低优先级、可归因 overlay。

Run 创建时持久化 resolved snapshot（profile ID、扩展版本、instruction digest、绑定、预算、工具范围与 epoch）。更新 Profile 只影响之后的 resolution，不重写旧历史。

## 声明并注册工具

Manifest：

```json
{
  "activationEvents": ["onTool:create-issue"],
  "contributes": {
    "tools": [
      {
        "id": "create-issue",
        "description": "Create an issue in the configured project",
        "inputSchema": {
          "type": "object",
          "properties": {
            "title": { "type": "string", "minLength": 1 }
          },
          "required": ["title"],
          "additionalProperties": false
        },
        "outputSchema": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "type": { "const": "text" },
              "text": { "type": "string" }
            },
            "required": ["type", "text"],
            "additionalProperties": false
          }
        },
        "sideEffects": "external",
        "idempotent": false,
        "maxOutputBytes": 32768
      }
    ]
  },
  "permissions": ["tools.register"]
}
```

Host 注册：

```ts
context.subscriptions.add(
  await context.tools.registerTool(definition, async (input, toolContext) => {
    if (toolContext.cancellation.isCancellationRequested) {
      throw new Error('Tool invocation was cancelled')
    }
    await toolContext.reportProgress({ message: 'Creating issue' })
    return {
      content: [{ type: 'text', text: `Issue created: ${String(input.title)}` }]
    }
  })
)
```

准确 handler/return type 以 `@kun/extension-api` 为准。声明和注册必须逐字段匹配；`inputSchema` 校验参数，`outputSchema`（如声明）校验 `ToolResult.content`。`maxOutputBytes` 的公开范围为 1 KiB–1 MiB。Schema 最多 128 KiB，只支持 `#`/`#/...` 本地引用，并拒绝危险或过长的正则、过深/过大的结构；不要依赖远程 `$ref`。无效 Schema、重复/保留 ID、未声明工具和政策禁止项在进入模型 Catalog 前被拒绝。`request_user_input`、审批工具等 Kun 保留身份不能注册。

## 工具身份与调用路径

Kun 从 authenticated extension ID + local tool ID 推导 canonical identity 和 model-safe alias。两个扩展都声明 `create-issue` 时仍互不冲突。

```text
model tool call
  -> pinned catalog lookup
  -> ToolHost argument/policy validation
  -> ApprovalGate when required
  -> ExtensionToolProvider
  -> owning Node Host handler
  -> bounded normalized result
  -> model history in original call order
```

调用含稳定 invocation ID、deadline、cancellation、workspace/account/network scope 和 operation attribution。Progress 和 result 有数量/大小上限；超大结果会按公开契约 truncate、externalize 或 reject，不能破坏 tool-call/tool-result 历史。

## 审批、交互 Gate 与副作用

`sideEffects` 是政策输入，不是扩展自我授权。Kun 可以把声称 read-only 的操作升级为需要审批；扩展不能降低用户、sandbox、workspace 或 ApprovalGate 的严格程度。

- 外部副作用在 Host-owned protected surface 由真实用户决定；
- 扩展消息、Agent steering、Webview click、content script 都不能伪造审批；
- Direct DOM 在审批待处理期间会被撤销；合成 click 会被拒绝，真实点击还需通过 Main 原生确认和 Kun 后端验证的短时单次 action-bound consent；
- 执行策略和 sandbox 的任何实际变化同样需要 Main 原生确认及绑定旧值/新值/发送 frame 的单次 consent；普通 Settings/Composer DOM 不能自行授权；
- `request_user_input` 只能由 Kun 的 authenticated user boundary 回答；
- headless 没有可信交互 surface 时保持 gated 或按显式 policy 结束，不合成答案。

如果 Host 在收到可能产生副作用的调用后崩溃，且无法知道 effect 是否完成，Kun 返回 unknown-outcome，不自动再次调用。只有工具声明 `idempotent: true`、使用 policy 接受的稳定 invocation key，并且重试获得授权时才可能安全重试。

## 调用时重新授权

Catalog 中存在工具不表示后续永远可执行。每次 invocation 都重新检查：

- extension/workspace enablement 与 trust；
- tool、workspace、network、account、provider、secret grants；
- 当前 Approval/Sandbox/user policy；
- budget/deadline；
- Host 健康和注册生命周期。

Disable/dispose 立刻阻止新 dispatch，并尝试取消在途调用；历史记录和已完成 turn 的 catalog fingerprint 保留。

## 工具 Catalog 与缓存稳定性

每个 thread 或显式新 epoch 都固定 permission-eligible tool snapshot：

- canonical sort；
- epoch ID 与 fingerprint；
- tool count、canonical identities；
- 每工具 Schema digest。

安装、enable/disable、删除或 Schema 变化只影响新 thread 或在 idle thread boundary 显式创建的新 epoch，不能改变正在进行的 model round。发现 live registry 与 pinned digest 不同时，Kun 报 catalog drift，并在 upstream request 前 fence，不把变异 Schema 当成同一稳定 prefix。

当工具过多时，模型只看到 core-owned 稳定 search/call gateway。Discovery 只搜索 pinned 且获准 epoch；gateway 仍经过 ToolHost、审批、预算和取消。扩展不能猜测调用 disabled/foreign tool。

## Headless

Node Agent API、Profile 和工具在 `kun serve`/受支持 CLI 下语义一致。无 GUI 时非交互工具可以正常执行；需要审批或 user input 时不会自动通过。browser-only 扩展不能提供 headless 工具。

## 测试清单

- own/foreign thread、workspace scope 和 permission revocation；
- budget clamp/exhaustion 和单 terminal race；
- sequence replay、断线、overflow cursor；
- ordered steering、idempotent cancel；
- profile snapshot 与 immutable prefix；
- 参数错误、progress/result limit、Host crash/circuit；
- approval、user input、unknown outcome；
- tool dispose/disable mid-call；
- catalog canonicalization、drift 和 progressive discovery；
- GUI 关闭后的 headless tool/provider/account path。
