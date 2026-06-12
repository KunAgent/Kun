# Feishu / Lark Bot 端流式回复设计

**日期**:2026-06-12
**状态**:已通过 brainstorming,待用户复审后进入 writing-plans
**适用范围**:`src/main/claw-runtime.ts` 中飞书/Lark 入站消息的回复链路;WeChat 渠道不在本期范围

## 背景

现状下,飞书 bot 收到用户消息后,`ClawRuntime.processIncomingImPrompt` → `runPrompt` → `waitForAssistantResult` 每 1.5 秒轮询一次 `GET /v1/threads/{id}`,直到 turn 结束拿到完整 `assistantText`,再调 `bridge.send(chatId, { markdown: fullText }, replyOptions)` 一次性发出([`src/main/claw-runtime.ts:1275-1340`](../../src/main/claw-runtime.ts))。

用户痛点:等待期间没有任何视觉反馈,容易误以为 bot 没有反应。本次改造要把它替换为"逐 token 增量写出"——bot 这边只看到一条消息在不断刷新,而不是若干条独立消息。

## 目标与非目标

### 目标

- 飞书 / Lark bot 收到入站消息后,只回一条消息(Message Bubble),内容随 agent run 实时刷新。
- 默认开启,新装机用户和老用户(走 settings migration)都启用。
- 失败时降级为"一次性发送"或"补一条 partial",用户始终能看到一些结果。
- 附件(file upload)行为不变,仍然在文本流式结束后作为独立消息发出。
- 与现有 thread/turn 编排、IM 命令( `/new` `/model` `/help` )、欢迎语、reaction 提示共存不冲突。

### 非目标

- 不暴露工具调用状态(不渲染"正在调用 file_read / bash"等中间行)。
- 不暴露 reasoning / chain-of-thought。
- 不切到 card JSON 2.0 富卡片(本期只走 markdown 流式;card 模式留给后续工作)。
- WeChat 渠道保持单条消息回复不变(不订阅 SSE)。
- Webhook 入站路径(`handleWebhook`)保持单条回复不变(它返回的是 HTTP body,不是 IM 卡)。
- 不重做"重发/编辑历史消息"功能(本次只让流式阶段落地)。

## 设计决策一览(已与用户确认)

| 维度 | 决策 | 备注 |
|---|---|---|
| 载体 | Markdown 流式消息 | 用 SDK 的 `MarkdownStreamProducer` + `MarkdownStreamController` |
| 流式内容范围 | 只 `assistant_text_delta` | `assistant_reasoning_delta` 过滤掉 |
| 附件 | 流式结束后作为独立消息 | 与现状行为一致 |
| 默认 | 开启 | 新建渠道默认 true,老 settings 迁移时补默认值 |
| 失败降级 | 补一条单发或同卡 setContent(partial) | 详见错误处理 |
| 收尾信号 | `turn_completed` / `turn_failed` / `turn_aborted` | 终态事件后再 `setContent` 一次 |
| 并发入站 | 并行处理 | 新消息开新 turn + 新 streaming 卡;旧 turn 自然收尾 |

## 架构

新增 `src/main/feishu-streamer.ts`(`FeishuStreamer` 类),封装"一次飞书会话的一条流式回复"的所有状态。

```
class FeishuStreamer {
  private readonly bridge: LarkChannel
  private readonly chatId: string
  private readonly turnId: string
  private readonly threadId: string
  private readonly replyOptions: SendOptions
  private readonly outbox: string[]           // SSE deltas 队列
  private readonly waiters: Array<(chunk: string | null) => void>
  private state: 'pending' | 'streaming' | 'fallback' | 'closed'
  private messageId: string                   // 流式卡的 messageId
  private accumulatedText: string
  private unsubscribeSse?: () => void
  private sseAbort: AbortController
  private readonly logger: (category, msg, detail) => void
}
```

对外 API:

- `start(subscribe: SseSubscriber, onComplete: (result) => void): Promise<{ ok, messageId, finalText, fellBack }>` — 启动流式。内部用 `bridge.send(chatId, { markdown: producer }, replyOptions)`,producer 等待 outbox 喂入,turn 终态后收尾。
- `abort(): void` — 用户取消 / 超时调用,关闭 SSE,reject producer。
- `accumulatedText(): string` — 失败兜底时拿已写过的内容。
- `dispose(): void` — 清空 waiters、释放 AbortController。

`ClawRuntime.handleFeishuMessage` 改造:

- 保留 `processIncomingImPrompt` → `waitForAssistantResult` 轮询路径(给非流式场景 / 调试 / 失败兜底用)。
- 新增 `runStreamingReply(input)`,内部构造 `FeishuStreamer` 并在 `startRuntimeTurn` 返回 turnId 后调用 `streamer.start()`。
- 文件附件仍走 `sendFeishuGeneratedFiles`(与现状完全一致)。
- `runStreamingReply` 抛错时退回到 `processIncomingImPrompt(... waitForResult: true)`,并把 `streamer.accumulatedText()` 拼到一次性 `bridge.send` 里,完成"失败降级为单条消息"语义。

## 数据流

一次完整流式回复的时序(单条入站消息触发):

```
[飞书 WS] -> [ClawRuntime.handleFeishuMessage]
  1. buildFeishuPrompt + addReaction 'OnIt'
  2. POST /v1/threads -> threadId
  3. POST /v1/threads/{id}/turns -> turnId
  4. onTurnStarted: store.patch 持久化 threadId
  5. streamer = new FeishuStreamer(bridge, chatId, turnId, replyOptions)
     streamer.start()
       a. sseAbort = new AbortController()
       b. bridge.send(chatId, { markdown: producer }, replyOptions)
          -- producer 启动,等 nextDelta() --
          -- SDK 创建流式卡 --
       c. 订阅 SSE /v1/threads/{id}/events
          过滤: turnId === this.turnId
                && (kind === 'assistant_text_delta'  -> outbox.push(delta)
                  || kind ∈ {turn_completed, turn_failed, turn_aborted}  -> outbox.push(null))
       d. 每个 delta 唤醒 producer -> controller.append(delta),accumulatedText += delta
       e. 收到 turn 终态 -> outbox.push(null),unsubscribeSse,producer 退出 while
       f. controller.setContent(accumulatedText) -- SDK finalize --
       g. bridge.send resolve -> streamer.start resolve { messageId, finalText }
  6. sendFeishuGeneratedFiles(若 prompt 命中文件模式)
```

关键点:

- **SSE 订阅起在 `bridge.send` 之后**,避免"卡片还没建好 delta 就先到"的竞态。
- **backpressure**:`nextDelta()` 是 `Promise` + `resolve` 唤醒的 wait queue,SSE 解析循环和 producer 互不阻塞。
- **reasoning delta 过滤**:`assistant_reasoning_delta` 不入 outbox,记 `debug` 日志。
- **SSE 复用**:`FeishuStreamer` 自己持 `AbortController`,默认每次新开(简单清晰);若后续发现开销大,再考虑 per-thread 共享。

## 错误处理

| # | 失败点 | 策略 |
|---|---|---|
| 1 | SSE 订阅失败(`5xx`/网络) | 关闭 producer,`runStreamingReply` catch → 退回到非流式路径 `processIncomingImPrompt` + 一次性 `sendFeishuMessage`。 |
| 2 | SSE 连接中断中途(服务重启/Kun 崩溃) | 先 `setContent(accumulatedText)` 保存进度,再走 fallback。 |
| 3 | `bridge.send` 抛错(`permission_denied`/`not_connected`) | 不写卡片,直接 fallback 到一次性发送。 |
| 4 | `controller.append` 抛错(限流 `rate_limited`/超 30k 切卡 `code 230099`) | 已累计的 `accumulatedText` 非空 → `setContent(accumulatedText)` 后正常退出;为空 → throw → fallback。 |
| 5 | `controller.setContent` 收尾抛错 | 不重试,记日志,producer 正常 return,`runStreamingReply` 不再 fallback(避免双发)。 |
| 6 | Kun `turn_failed` / `turn_aborted` | `setContent(partial)`,`runStreamingReply` 拿到 `ok: false`,可选发一条"生成未完成"尾注(默认关,留 setting 后续扩展)。 |
| 7 | `bridge.send` 超时(超过 `responseTimeoutMs`) | `streamer.abort()`;若 SDK 的 `outbound.retry` 已耗尽(`maxAttempts` 默认有限) → fallback 到一次性发送(用 partial text);若 SDK 没配 retry,直接 fallback。 |
| 8 | 二次发文件失败 | 沿用现状:`sendFeishuGeneratedFiles` 内部单文件 try/catch,失败文件名单独发"附件 X 上传失败"。 |

`runStreamingReply` 兜底骨架:

```ts
async runStreamingReply(input) {
  let streamer: FeishuStreamer | null = null
  const cancel = new AbortController()
  const timeout = setTimeout(() => cancel.abort(), input.responseTimeoutMs)
  try {
    streamer = new FeishuStreamer(input.bridge, input.chatId, input.turnId, input.replyOptions, this.deps.logError)
    const result = await streamer.start({
      subscribe: (signal) => this.subscribeSse(input.threadId, input.sinceSeq, signal, cancel.signal)
    })
    return { ok: true, messageId: result.messageId, finalText: result.finalText, fellBack: false }
  } catch (error) {
    this.deps.logError('claw-feishu-stream', 'Streaming reply failed; falling back to one-shot send.', {
      message: errorMessage(error), ...input
    })
    const finalText = streamer?.accumulatedText() || ''
    try {
      const fb = await input.bridge.send(input.chatId,
        { markdown: finalText || 'Sorry, I could not finish streaming the response.' },
        input.replyOptions)
      return { ok: true, messageId: fb.messageId, finalText, fellBack: true }
    } catch (fbError) {
      return { ok: false, message: errorMessage(fbError), fellBack: true }
    }
  } finally {
    clearTimeout(timeout)
    streamer?.dispose()
  }
}
```

不变量:

- 失败永远不"丢消息":能 partial 补一条就 partial 补一条;连 partial 都没有就"抱歉,生成失败"。
- 不让用户看到两条:fallback 用相同的 replyOptions;SDK 端 controller 异常时卡片可能已写入,所以 fallback 优先在同张卡 `setContent(partial)`,只在 SDK 根本没创建卡时才发新 markdown。
- 不污染现有路径:`runPrompt` 里的 `waitForAssistantResult` 轮询路径保留;`processIncomingImPrompt` 给非流式渠道继续用。

## Settings 改动

在 `settings.claw.im`(全局 IM 配置)上加一个开关字段(在 `src/shared/app-settings-types.ts`):

```ts
// src/shared/app-settings-types.ts
interface ClawImSettingsV1 {
  // ...已有字段
  /** 当 provider === 'feishu' 时,是否把 agent 回复改为流式输出。默认 true。 */
  feishuStream?: boolean
}
```

`src/main/settings-store.ts` 的 migration 函数读到老 settings 时,补 `claw.im.feishuStream ?? true`。

本期是**全局开关**,对所有飞书渠道统一生效。若未来需要"某个业务账号不流式",再在 `ClawImChannelV1` 上加 per-channel 字段覆盖(本期不做,YAGNI)。

## 文件清单(预期改动)

| 文件 | 改动 |
|---|---|
| `src/main/feishu-streamer.ts` | 新增,`FeishuStreamer` 类。 |
| `src/main/feishu-streamer.test.ts` | 新增,单元测试。 |
| `src/main/claw-runtime.ts` | 改造 `handleFeishuMessage` 调用 `runStreamingReply`;新增 `runStreamingReply` 方法;新增 `subscribeSse` 私有方法。 |
| `src/main/claw-runtime-helpers.ts` | 可能加 `subscribeSse` 解析循环工具(若不复用 `runtime-sse-ipc.ts` 里的解析)。 |
| `src/main/claw-runtime.test.ts` | 新增 4 个端到端 case。 |
| `src/shared/app-settings-types.ts` | `ClawImSettingsV1` 加 `feishuStream?: boolean`(全局 IM 配置)。 |
| `src/main/settings-store.ts` | migration 补 `claw.im.feishuStream ?? true` 默认值。 |
| `docs/CONTRIBUTING.md` | 末尾追加"飞书流式 smoke 测试"小节。 |

## 测试策略

#### 1. 单元测试 — `FeishuStreamer` 行为契约(`src/main/feishu-streamer.test.ts`)

fake `LarkChannel` + 可控 SSE 事件流,覆盖:

- 正常路径:5 个 delta + turn_completed → `append` 5 次 + `setContent` 1 次 + resolve。
- 过滤 reasoning:`assistant_reasoning_delta` 不触发 `append`。
- 失败降级(`append` 抛错):partial text 走 `setContent` 收尾,start 仍 resolve。
- 失败降级(SSE 抛错):start reject,`runStreamingReply` fallback 调一次 `bridge.send({ markdown })`。
- 失败降级(`turn_failed`):setContent(partial),resolve `{ ok: false }`。
- 取消:`abort()` 后 `nextDelta()` 永久 await,SSE signal 触发 abort。
- 超时:200ms 内不喂事件,`responseTimeoutMs = 200` 触发 abort。
- 30k 字符切卡(可选,需要真实 SDK 或 mock):第 30000 字符 append 抛 `code 230099` → 切 `setContent` 路径。

#### 2. 集成测试(`src/main/claw-runtime.test.ts`)

- 流式成功:createThread → startTurn → startStreamer → 3 个 delta → turn_completed → 收到 `bridge.send` 一次的 streamInput,拿到 messageId。
- 流式降级:模拟 `LarkChannel.send` 第二次抛 `not_connected` → 验证 fallback 路径只调一次 `send({ markdown })`。
- 附件仍发送:`shouldSendGeneratedFilesForPrompt` 命中时,流式后 `sendFeishuGeneratedFiles` 仍被调用。
- 渠道不受影响:`provider === 'weixin'` 走原路径,不创建 `FeishuStreamer`。

#### 3. 手工 / 真实飞书 smoke

写进 `docs/CONTRIBUTING.md` 末尾,作为发版前必跑项:

- 单条对话:发"你好" → 看到 streaming 卡出现 → 1–2 秒内开始出现字符。
- 长回答(写代码):验证 30k 字符切卡能跨第二张卡继续写。
- 故意触发限流:`outbound.retry.maxAttempts = 1` 让限流不重试,观察 fallback。
- 故意制造 `turn_failed`:用抛错的 MCP 工具触发,观察 partial 补发。
- 群聊(@bot):`replyInThread: true` 仍生效,streaming 卡出现在 thread 里。
- DM:同上,`replyInThread: false` 默认。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| SDK `MarkdownStreamProducer` 在新版升级后行为变化 | 锁版本(主进程 package.json),升级前在 smoke 跑过。 |
| 飞书 QPS 限流(单 app 高频 `cardElement.content` 写) | 依赖 SDK 默认 `streamThrottleMs` (~200ms),且不在本进程加额外限流;出问题先在 `outbound.retry` 上调 `baseDelayMs`。 |
| 30k 字符切卡被 SDK 行为差异影响 | 单测覆盖切卡边界,出问题第一时间在 `streamMaxElementChars` 上调小阈值(默认 30000)。 |
| SSE 订阅 leak(turn 终态后没 unsubscribe) | `streamer.dispose()` 显式调用,close path 总是跑(`finally` 块)。 |
| 入站消息风暴(同一渠道连续多条) | 现状不背 IM 队列(SDK 内部 `chatQueue` 默认关);新方案并行处理,可能短时开多张流式卡——本设计接受这种行为,符合"并行处理"决策。 |

## 后续可扩展(不在本期)

- Card JSON 2.0 富卡片(工具状态、按钮、进度条)。
- 透出 reasoning delta("💭 ..."折叠区)。
- IM 内"重发/编辑"上一条消息(需要把 `messageId` 持久化到 settings)。
- Per-channel 粒度的 `feishuStream` 开关。
- WeChat 渠道流式(需要先确认微信侧是否有对应能力)。
