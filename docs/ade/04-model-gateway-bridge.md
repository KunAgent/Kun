# 04 harness × 模型：网关协议桥

- 阶段：P1
- 依赖：01（`credentialMode: 'kun-gateway'`）
- 被依赖：09、10（worker 选择时可以把便宜模型配给外部 harness）

## 1. 目标

让外部 harness 使用 Kun 配置的**任意** provider/model，例如"Claude Code 的外壳 + DeepSeek 模型"、"Codex 的外壳 + Kimi 模型"。
做法是把 Kun 现有的本地模型网关扩展成 harness 的上游，**凭据始终留在 Kun 里**，harness 进程只拿到一个短期、限定范围的令牌。

## 2. 现状

`kun/src/server/routes/openai-model-gateway.ts`（400 行）已经提供：

- `GET /v1/models`、`POST /v1/chat/completions`、`POST /v1/responses`（`register-core-routes.ts:69-71`）。
- 入站请求 → Kun `ModelRequest`（支持 tools、图片、reasoning）→ `runtime.modelClient.stream()`（多 provider 路由）→ 按入站形态输出 SSE 或 JSON。
- 鉴权：`GatewayRequestGuard` + `GatewayCredentialService`，带并发和速率限制。
- 只暴露**路由池**的虚拟模型 id（`runtime.modelGateway.pools()`）。

缺的：

1. 没有 Anthropic Messages 入口（Claude Code / Claude Agent SDK 只会说这个协议）。
2. 不能直接按 (providerId, model) 寻址，只能用路由池。
3. 令牌是全局网关凭据，没有"只给某个 harness 会话用"的范围限制。
4. 经网关的调用没有记到发起它的 Kun 线程上。

## 3. 模型寻址

harness 会话里使用的模型 id 统一为：

```text
kun/<providerId>/<model>
例：kun/deepseek/deepseek-v4-pro
```

解析：

```ts
export function parseGatewayModelId(id: string): { providerId: string; model: string } | null {
  const match = /^kun\/([^/]{1,128})\/(.{1,512})$/.exec(id)
  return match ? { providerId: match[1]!, model: match[2]! } : null
}
```

- 这种直接寻址**只对 harness 范围令牌开放**（§4）；公共网关凭据仍只能用路由池 id，行为不变。
- 令牌里记录允许的 (providerId, model) 集合，请求的模型不在集合里 → 404 `model_not_found`。
- 除主模型外，允许一个"小模型"路由（Claude Code 会用小模型做后台任务），默认取 `roles.smallModel`，没配则用主模型。

## 4. harness 范围令牌：`kun/src/harness/harness-gateway-tokens.ts`（新增）

```ts
export type HarnessGatewayGrant = {
  grantId: string
  threadId: string
  harnessId: HarnessId
  routes: Array<{ providerId: string; model: string; role: 'main' | 'small' }>
  maxConcurrent: number          // 默认 4
  maxBodyBytes: number           // 默认 32 MiB（长上下文请求远大于公共网关的 2 MiB）
  expiresAt: number              // 进程级有效；Kun 重启即全部失效
}

export class HarnessGatewayTokenService {
  private readonly secret = randomBytes(32)        // 进程内随机，不落盘
  private readonly grants = new Map<string, HarnessGatewayGrant>()

  /** 同一 (harnessId, credentialIdentity, threadId) 在本进程内得到同一个令牌：spawn env 逐字节稳定（03 §4.1）。 */
  issue(input: Omit<HarnessGatewayGrant, 'grantId' | 'expiresAt'> & { credentialIdentity: string }): string {
    const grantId = hmacHex(this.secret, `${input.harnessId}\0${input.credentialIdentity}\0${input.threadId}`).slice(0, 32)
    this.grants.set(grantId, { ...input, grantId, expiresAt: Number.MAX_SAFE_INTEGER })
    return `kgw_${grantId}.${hmacHex(this.secret, grantId)}`
  }

  verify(token: string): HarnessGatewayGrant | null {
    const [prefix, sig] = token.split('.')
    if (!prefix?.startsWith('kgw_') || !sig) return null
    const grantId = prefix.slice(4)
    if (!timingSafeEqualHex(sig, hmacHex(this.secret, grantId))) return null
    return this.grants.get(grantId) ?? null
  }

  revokeThread(threadId: string): void { /* 线程删除、归档、worker 释放时调用 */ }
}
```

- 令牌只在内存里，Kun 重启后全部失效；harness 进程是 Kun 的受管子进程，也会随之重建，不存在"旧令牌还在用"的情况。
- 令牌不写日志；debug 记录里只写 `grantId` 前 8 位。

## 5. Anthropic Messages 入口

### 5.1 路由

- `POST /v1/messages`
- `POST /v1/messages/count_tokens`（Claude Code 会调用；用 Kun 现有的 token 估算器返回估计值，并在响应头标注估算）
- 鉴权：`x-api-key` 或 `Authorization: Bearer`，两者都接受；先试 harness 令牌，再试公共网关凭据。

### 5.2 文件拆分

- `kun/src/server/routes/model-gateway-core.ts`（从现有文件抽出）：鉴权、并发租约、`readJsonBody`、`ModelRequest` 组装的公共部分、用量归属（§6）。
- `kun/src/server/routes/openai-model-gateway.ts`：只留 chat / responses 的入站与出站映射。
- `kun/src/server/routes/anthropic-messages-gateway.ts`（新增）：messages 的入站与出站映射。

### 5.3 入站映射：Anthropic → `ModelRequest`

`ModelRequest`（`kun/src/ports/model-client.ts`）的对话历史是 `prefix` / `history: TurnItem[]`，不是聊天消息数组。
现有网关的 `makeModelRequest`（`openai-model-gateway.ts:141`）已经实现了"聊天消息 → TurnItem"，抽到 `model-gateway-core.ts`
作为 `gatewayMessagesToTurnItems(messages: GatewayMessage[])`，Anthropic 入口先转成同一个中间形态 `GatewayMessage` 再复用它：

```ts
export function anthropicToModelRequest(
  body: AnthropicMessagesBody,
  route: { providerId: string; model: string },         // parseGatewayModelId 的结果
  grant: HarnessGatewayGrant,
  abortSignal: AbortSignal
): ModelRequest {
  const messages: GatewayMessage[] = body.messages.flatMap(anthropicMessageToGateway)   // 见下表
  return {
    threadId: grant.threadId,
    turnId: gatewayTurnId(grant),                        // 当前运行中的 turn；没有时用 `gateway_${grantId}` 占位
    model: route.model,
    providerId: route.providerId,
    systemPrompt: flattenSystem(body.system),            // string | TextBlock[] → string；cache_control 丢弃（§7）
    prefix: [],
    history: gatewayMessagesToTurnItems(messages),
    tools: (body.tools ?? []).filter(isCustomTool).map(toModelToolSpec),   // name / description / input_schema
    requiredToolName: body.tool_choice?.type === 'tool' ? body.tool_choice.name : undefined,
    stream: body.stream === true,
    maxTokens: body.max_tokens,
    temperature: body.temperature,
    reasoningEffort: body.thinking?.type === 'enabled'
      ? effortFromBudget(body.thinking.budget_tokens)    // budget → off/low/medium/high/max 的分档
      : undefined,
    abortSignal
  }
}
```

`tool_choice: { type: 'any' }` 与 `'none'`：`ModelRequest` 没有对应字段；`none` 通过传空 `tools` 实现，`any` 退化为 `auto` 并记 debug（不影响正确性，只是少一个约束）。
`stop_sequences` 同样没有对应字段，丢弃并记 debug。

| Anthropic 内容块 | Kun 消息 |
| --- | --- |
| user `text` | user 文本 |
| user `image`（base64 / url） | 图片部分（目标模型不支持视觉时返回 400 并说明，不静默丢图） |
| user `tool_result` | tool 结果消息，按 `tool_use_id` 关联 |
| assistant `text` | assistant 文本 |
| assistant `thinking` / `redacted_thinking` | 丢弃（不回传给非 Anthropic 模型） |
| assistant `tool_use` | assistant tool call |
| `document`、服务端工具（web_search 等） | 400 `unsupported_content`，并在能力里标注（§7） |

历史修复：入站历史必须经过 Kun 现有的 model-history repair（孤儿 tool_result、缺结果的 tool_call），和原生 loop 同一条规则。

### 5.4 出站映射：Kun 流 → Anthropic SSE

```ts
async function* toAnthropicSse(chunks: AsyncIterable<ModelStreamChunk>, model: string) {
  yield event('message_start', { message: { id, type: 'message', role: 'assistant', model, content: [],
    stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } })
  let index = -1
  let open: { type: 'text' | 'thinking' | 'tool_use'; callId?: string } | null = null
  let streamedArgs = new Set<string>()                      // 已经用 tool_call_delta 流式发过参数的 callId
  for await (const chunk of chunks) {                       // 类型见 kun/src/ports/model-client.ts:32-55
    switch (chunk.kind) {
      case 'assistant_text_delta':
        if (open?.type !== 'text') { yield* closeBlock(); index++; open = { type: 'text' }
          yield event('content_block_start', { index, content_block: { type: 'text', text: '' } }) }
        yield event('content_block_delta', { index, delta: { type: 'text_delta', text: chunk.text } })
        break
      case 'assistant_reasoning_delta':
        if (open?.type !== 'thinking') { yield* closeBlock(); index++; open = { type: 'thinking' }
          yield event('content_block_start', { index, content_block: { type: 'thinking', thinking: '' } }) }
        yield event('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: chunk.text } })
        break
      case 'tool_call_delta':                               // 参数增量：直接转成 input_json_delta
        if (open?.type !== 'tool_use' || open.callId !== chunk.callId) {
          yield* closeBlock(); index++; open = { type: 'tool_use', callId: chunk.callId }
          yield event('content_block_start', { index, content_block: { type: 'tool_use', id: chunk.callId,
            name: chunk.toolName ?? '', input: {} } })
        }
        if (chunk.argumentsDelta) {
          streamedArgs.add(chunk.callId)
          yield event('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: chunk.argumentsDelta } })
        }
        break
      case 'tool_call_complete':                            // 没有增量的 provider：一次性发完整参数
        if (!streamedArgs.has(chunk.callId)) {
          yield* closeBlock(); index++
          yield event('content_block_start', { index, content_block: { type: 'tool_use', id: chunk.callId,
            name: chunk.toolName, input: {} } })
          yield event('content_block_delta', { index, delta: { type: 'input_json_delta',
            partial_json: JSON.stringify(chunk.arguments) } })
          open = { type: 'tool_use', callId: chunk.callId }
        }
        yield* closeBlock()
        break
      case 'usage': lastUsage = chunk.usage; break
      case 'completed': lastStop = chunk.stopReason; break  // 'stop' | 'tool_calls' | 'length' | 'error'
      case 'retrying': break                                // 重试对 harness 透明
      case 'error': yield event('error', { type: 'error', error: anthropicError(chunk) }); return
    }
  }
  yield* closeBlock()
  yield event('message_delta', { delta: { stop_reason: anthropicStopReason(lastStop), stop_sequence: null },
    usage: anthropicUsage(lastUsage) })
  yield event('message_stop', {})
}
```

- `stop_reason`：`completed.stopReason` 为 `tool_calls` → `tool_use`；`length` → `max_tokens`；其余 → `end_turn`。`error` 已在上面以 error 事件返回。
- 用量字段：`input_tokens` = 未命中缓存的输入；`cache_read_input_tokens` = provider 原生命中数；`output_tokens` = 输出。沿用 Kun 缓存统计的口径（优先 provider 原生字段）。
- 思考块：非 Anthropic 模型给出的推理只作为 `thinking` 展示，不带签名；harness 下一轮回传时在 §5.3 被丢弃，不会造成签名校验错误。
- 非流式请求：累积后一次性返回 message JSON，结构同上。
- 工具参数：provider 给出 `tool_call_delta` 时逐段转成 `input_json_delta`；只给 `tool_call_complete` 时一次性发出。两种都是合法的 SSE 序列。
- `image_generation_complete`（Codex 类生图）在 messages 入口不支持，映射为文本提示并在能力里标注。

## 6. 用量归属

经网关的请求要算进发起它的 Kun 线程：

```ts
function attributeUsage(grant: HarnessGatewayGrant, usage: UsageSnapshot, route: { providerId: string; model: string }) {
  const turnId = runtime.activity.currentTurnFor(grant.threadId)   // 06：该线程正在运行的 turn
  runtime.usage.record({
    threadId: grant.threadId,
    turnId: turnId ?? undefined,                // 没有运行中的 turn（后台请求）时记在线程级
    model: route.model,
    providerId: route.providerId,
    source: 'harness-gateway',
    harnessId: grant.harnessId,
    usage
  })
}
```

- `usage` 事件新增可选字段 `source: 'native' | 'harness-gateway' | 'harness-reported'`，用量面板据此区分"Kun 自己算的"与"harness 报告的"，避免同一次调用被计两遍：走网关的 harness 会话，harness 自己报告的 usage 只用于上下文显示，不入账。
- 这让"Claude Code + DeepSeek"的费用出现在 Kun 用量里，和原生 loop 一样可按线程、按天、按模型查看。

## 7. 能力收窄

`credentialMode: 'kun-gateway'` 时，02 的 `routeConstraints` 层：

| 能力 | 规则 |
| --- | --- |
| imageInput | 取目标模型 profile 的 `inputModalities` |
| reasoningStream | 取目标模型 profile 的 reasoning 声明 |
| 服务端工具（网页搜索等 harness 依赖上游的功能） | 不支持；harness 目录里需要它们的功能标记为 `platform` 不支持 |
| usageReporting | `exact`（Kun 自己记账） |
| 提示缓存 | 透传 provider 原生缓存（DeepSeek 自动前缀缓存可用）；Anthropic `cache_control` 标记被丢弃，命中率以 provider 实际为准 |

## 8. 注入到 harness

`HarnessDefinition` 增加可选字段：

```ts
gateway: z.object({
  protocol: z.enum(['anthropic-messages', 'openai-responses', 'openai-chat']),
  env: z.object({
    baseUrl: z.string().regex(/^[A-Z][A-Z0-9_]*$/),     // 例如 ANTHROPIC_BASE_URL
    token: z.string().regex(/^[A-Z][A-Z0-9_]*$/),       // 例如 ANTHROPIC_AUTH_TOKEN
    model: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
    smallModel: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional()
  }).strict(),
  /** 必须从 env 里删掉的变量：否则 harness 会优先用它们，悄悄绕过网关 */
  stripEnv: z.array(z.string()).max(32)
}).strict().optional()
```

Claude Code（agent-sdk transport）：

```ts
{
  protocol: 'anthropic-messages',
  env: { baseUrl: 'ANTHROPIC_BASE_URL', token: 'ANTHROPIC_AUTH_TOKEN',
         model: 'ANTHROPIC_MODEL', smallModel: 'ANTHROPIC_SMALL_FAST_MODEL' },
  stripEnv: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']
}
```

- baseUrl 是 `kun serve` 的 loopback 地址（`http://127.0.0.1:<port>`），SDK 自己拼 `/v1/messages`。
- Claude SDK 适配器需要新增"网关模式"：`sdk-options-builder.ts` 的 `buildScopedEnv` 在 `credentialMode === 'kun-gateway'` 时注入以上变量，并**跳过**写 `CLAUDE_CODE_OAUTH_TOKEN`；`resolveSdkModel` 对 `kun/` 前缀的模型不做 `isAnthropicModel` 回退。
- 其他 harness 的变量名在接入时按其官方文档填写并测试，不预先写死。

原则：

1. **永远经网关**，即使 harness 自己能直连某个兼容 provider。直连意味着把 provider 密钥放进 harness 进程环境，而 harness 能跑任意命令（能读到自己的环境变量）。
2. 多一跳翻译的代价是：Kun `ModelRequest` 表达不了的上游特性会丢失。这些特性在 §7 显式标为不支持，而不是静默失效。

## 9. 安全

- 网关只监听 loopback（沿用 `kun serve` 现有绑定）。
- harness 令牌只能访问 `/v1/messages*`、`/v1/chat/completions`、`/v1/responses`、`/v1/models`，访问任何其它 `/v1/*` 路由返回 401（在路由分发前按令牌前缀 `kgw_` 拦截）。
- 每个 grant 有并发上限和请求体上限；超出返回 429 / 413。
- 线程删除、worker 释放、harness 被禁用时 `revokeThread`，已发出的令牌立即失效。

## 10. 测试

| 测试 | 断言 |
| --- | --- |
| `anthropic-messages-gateway.test.ts` | 文本、思考、工具调用、工具结果多轮往返的映射；SSE 事件序列合法（start → block start/delta/stop → message_delta → stop） |
| 非流式 | 结构与流式累积结果一致 |
| 图片 | 目标模型不支持视觉时 400，且错误说明清楚 |
| 历史修复 | 孤儿 tool_result 不发给上游 |
| `harness-gateway-tokens.test.ts` | 同输入令牌稳定；伪造签名、已撤销、访问非网关路由都被拒 |
| 模型寻址 | 令牌外的 (provider, model) 被拒；公共凭据不能用 `kun/` 直接寻址 |
| 用量归属 | 经网关的调用记到正确线程；harness 自报用量不重复入账 |
| 端到端（夜间） | 真实 Claude Code 二进制 + 网关 + DeepSeek：完成一个读文件并修改的小任务 |

## 11. 文件清单

新增：

- `kun/src/server/routes/model-gateway-core.ts`
- `kun/src/server/routes/anthropic-messages-gateway.ts`
- `kun/src/harness/harness-gateway-tokens.ts`
- `kun/src/harness/gateway-model-id.ts`

修改：

- `kun/src/server/routes/openai-model-gateway.ts`（改用 core）
- `kun/src/server/routes/register-core-routes.ts`（新路由）
- `kun/src/server/router.ts` 或鉴权中间件（`kgw_` 令牌的路由白名单）
- `kun/src/contracts/harness.ts`（`gateway` 字段）、`contracts/events.ts`（usage `source`）
- `kun/src/runtime/agent-sdk/sdk-options-builder.ts`（网关模式）
- `kun/src/services/usage-*`（source 字段、去重规则）
