# 飞书 / Lark 接入鲲后流式输出设计（带 live 视图卡顿修复）

**日期**:2026-06-15
**状态**:已实现并通过 review(2026-06-17 重做版)
**适用范围**:`src/main/claw-runtime.ts` 中飞书 / Lark 入站消息的回复链路;WeChat 渠道不在本期范围
**前身**:`D:\workspace\DeepSeek\DeepSeek-GUI` 的 `feature/feishu-streaming-bot-output` 分支上的同主题实现(2026-06-12);本次在 `develop` 上重建并修复 live 视图卡顿 bug

## 背景

`feature/feishu-streaming-bot-output` 分支上做过一版飞书流式,实现后用户报告 **bot 消息到达后,飞书 SDK 卡在实时刷新,但 Connect phone 视图的 chat 区一直不动,直到 turn 结束才看到文本**。

经排查,根因有两处叠加:

1. **`selectThread` 同步 HTTP 抢在 SSE 之前**。`onClawChannelActivity` 触发自动切换到 bot thread 时,调的是 `selectThread(threadId)`。`selectThread` 内部先 `await getThreadDetail()` 拉元数据 + 持久化 blocks,**然后**才打开 SSE。在 HTTP 往返期间,deltas 已经流入 chat-store,随后被 fetch 返回的旧 `blocks` 覆盖,deltas 消失。
2. **streaming 期间 live bubble 被 `isProcessing` 门控隐藏**。`MessageTimeline.tsx` 里 `showLiveAssistant = !isProcessing && !!liveContent.trim()`。turn 进行中(`busy: true`)时,bubble 被藏起来,只有 `WorkMetaRow` 处理指示器可见。`liveAssistant` 文本确实在累积,但用户看不到 —— 必须等 `turn_completed` 才一次性显示,视觉上像"卡住"。

本次重做版 (2026-06-17) 在原有修复基础上,进一步把 `subscribeThreadEventsLive` 改为**并行 fetch + SSE**:切换 thread 时同时启动 `getThreadDetail` 拉历史和 `sinceSeq: 0` 的 SSE 流,fetch 完成后用 merge 策略更新 blocks/lastSeq,保留 SSE 已累积的 deltas。这样既保留了"无 fetch 也能看到流式文本"的实时性,又不会让用户看到空白视图(因为 fetch 完成的瞬间历史就回来了)。

## 目标与非目标

### 目标

- 飞书 / Lark bot 收到入站消息后,只回一条 SDK 流式卡(Message Bubble),内容随 agent run 实时刷新。
- Connect phone 视图的 chat 区**实时**显示流式文本(无视觉卡顿),且自动切到的历史会话不出现空白视图。
- 飞书 SDK 卡和 Connect phone 视图两者同步 —— 用户两边看到的刷新节奏一致。
- **per-channel 默认关闭**,用户需要逐个渠道在 Settings → Claw → 已连接的手机 Agent 中显式开启(降低误用风险;新装机用户和老用户行为一致,无 migration)。
- 失败时降级为一次性发送或 partial 补一条,用户始终能看到一些结果。
- 附件(file upload)行为不变,仍然在文本流式结束后作为独立消息发出。
- 与现有 thread / turn 编排、IM 命令(`/new` `/model` `/help`)、欢迎语、reaction 提示共存不冲突。

### 非目标

- 不暴露工具调用状态(不渲染"正在调用 file_read / bash"等中间行)。
- 不暴露 reasoning / chain-of-thought(过滤掉 `assistant_reasoning_delta`)。
- 不切到 card JSON 2.0 富卡片(本期只走 markdown 流式;card 模式留给后续工作)。
- WeChat 渠道保持单条消息回复不变(不订阅 SSE)。
- Webhook 入站路径(`handleWebhook`)保持单条回复不变(它返回的是 HTTP body,不是 IM 卡)。
- 不重做"重发 / 编辑历史消息"功能(本次只让流式阶段 + live 视图同步落地)。
- 不抽取 `runStreamingReply` 通用抽象 —— wechat 渠道的后续工作单独 PR。

## 设计决策一览

| 维度 | 决策 | 备注 |
|------|------|------|
| 载体 | Markdown 流式消息 | 用 SDK 的 `bridge.stream()` + `MarkdownStreamController` |
| 跨 SDK 调用方法 | `bridge.stream(...)`,**不是** `bridge.send(...)` | 上版踩过的坑(测试用 `send`,生产要用 `stream`),代码注释里写明 |
| 流式内容范围 | 只 `assistant_text_delta` | `assistant_reasoning_delta` 过滤掉;记 debug log |
| SSE 字段读取 | `event.item.text`(不是 `event.item.delta`) | 上版踩过的字段错位坑,代码注释里写明 |
| 附件 | 流式结束后作为独立消息 | 与现状行为一致 |
| **per-channel 字段** | `ClawImChannelV1.feishuStream?: boolean` | **不是** `ClawImSettingsV1`(全局),原因见下 |
| **默认** | 关闭(per-channel `feishuStream === true` 才开) | UI 按 `=== true` 显式判定,缺省视为 false;**无** default normalizer 注入,**无** migration |
| 失败降级 | 退到一次性 `bridge.send` | 能 partial 补一条就 partial 补一条;连 partial 都没有就"抱歉,生成失败" |
| 收尾信号 | `turn_completed` / `turn_failed` / `turn_aborted` | 终态事件后再 `setContent(accumulatedText)` 一次 |
| 并发入站 | 并行处理 | 新消息开新 turn + 新 streaming 卡;旧 turn 自然收尾 |
| Renderer 自动切 thread | 用 `subscribeThreadEventsLive`(并行 fetch + SSE) | 不再 `selectThread`,避免 HTTP 抢在 SSE 之前 |
| `subscribeThreadEventsLive` merge 策略 | 同步切 activeThreadId + 开 SSE,fetch 完成后用 `Math.max(fetchedSeq, currentSeq)` 写 `lastSeq`;`liveAssistant`/`liveReasoning` **不**写入 | 保护 SSE deltas 不被 fetch 覆盖 |
| Renderer live bubble | 去掉 `!isProcessing` 门控 | `busy: true` 期间也显示流式文本;`live` 是全局 SSE sink 输出,影响所有渠道 |
| WeChat | 不变 | 仍走 `processIncomingImPrompt` 轮询路径 |

### 为什么是 per-channel 而不是全局

设计最初是全局 `ClawImSettingsV1.feishuStream: true`,迁移到 `develop` 上做 review 之前改为 per-channel `ClawImChannelV1.feishuStream: false`,理由:

- 各业务渠道(测试号、正式号、客服号等)希望独立控制是否启用流式
- 默认关闭更安全:误用风险更低(失败时退到一次性发送)
- per-channel 与 `channel.enabled` / `channel.weixinStream` 模式一致,UI 自然

默认值的差异:per-channel 字段不写 default normalizer,`channel.feishuStream === true` 显式判定,缺省(undefined)视为 false。`ClawImChannelV1.weixinStream` 同位置,缺省由 normalizer 补 `true`(因为微信 block streaming 是"feature-complete 默认开启",见后续 weixin PR)。

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│ Renderer (React + Zustand)                                      │
│  ┌──────────────────────────────────────────────┐               │
│  │ chat-store                                   │  ←—— onClawChannelActivity
│  │   • selectThread(threadId)          [保留]   │      (改走 subscribeThreadEventsLive)
│  │   • subscribeThreadEventsLive()     [改造]   │               │
│  │     - 同步切 activeThreadId                   │               │
│  │     - 立即开 SSE (sinceSeq: 0)               │               │
│  │     - 并行 getThreadDetail 拉历史            │               │
│  │     - fetch 完成后 merge 写 blocks           │               │
│  │   • liveAssistant (SSE 实时填充)             │               │
│  └──────────────────────────────────────────────┘               │
│  ┌──────────────────────────────────────────────┐               │
│  │ MessageTimeline                              │  ←—— showLiveAssistant
│  │   showLiveAssistant = !!liveContent.trim()   │      去掉 !isProcessing 门控
│  │   注:live 是全局 SSE sink,非飞书专属         │               │
│  └──────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│ Main (Electron main process)                                    │
│  ┌──────────────────────────────────────────────┐               │
│  │ claw-runtime.ts                              │               │
│  │   • handleFeishuMessage()           [改造]   │               │
│  │     - 读 channel.feishuStream === true       │               │
│  │     - true: 走 runStreamingReply             │               │
│  │     - false: 原 processIncomingImPrompt 轮询 │               │
│  │   • runStreamingReply()             [新增]   │               │
│  │   • subscribeSse / subscribeSseForStreamer   │               │
│  └──────────────────────────────────────────────┘               │
│  ┌──────────────────────────────────────────────┐               │
│  │ feishu-streamer.ts (新)                      │               │
│  │   FeishuStreamer 类:封装一次流式回复生命周期 │               │
│  └──────────────────────────────────────────────┘               │
│  ┌──────────────────────────────────────────────┐               │
│  │ claw-runtime-helpers.ts                      │               │
│  │   • subscribeRuntimeThreadEvents()  [新增]   │               │
│  │   • SseSubscriber, RuntimeSseEvent  [新类型] │               │
│  └──────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│ Settings (Claw 面板 → 已连接的手机 Agent → feishu 渠道卡片)    │
│   沿用"卡片-列表-SettingRow"模式                                  │
│   渠道卡片内按 channel.provider === 'feishu' 条件渲染 SettingRow │
│   Toggle 绑 channel.feishuStream,默认关闭                       │
└─────────────────────────────────────────────────────────────────┘
```

## 关键代码段

### FeishuStreamer 公开方法

```ts
// src/main/feishu-streamer.ts
export class FeishuStreamer {
  constructor(opts: FeishuStreamerOptions)
  start(input: { subscribe: SseSubscriber }): Promise<FeishuStreamerResult>
  onSseEvent(event: Record<string, unknown>): void
  getAccumulatedText(): string
  abort(): void
  dispose(): void
}
```

`FeishuStreamerOptions` 持有 `bridge: LarkChannel`、`chatId`、`turnId`、`threadId`、`responseTimeoutMs` 等。`start` 接收一个 `SseSubscriber`(把异步 SSE 包成同步契约),内部通过 `bridge.stream` 拿 `MarkdownStreamController`,从 SSE 接收 `assistant_text_delta` 并 `append()`,终态时 `setContent(accumulatedText)` 收尾,`append` 失败则降级到 `setContent(partial)`。

### claw-runtime.ts 四个核心方法

```ts
// src/main/claw-runtime.ts
private async subscribeSse(settings, threadId, streamer, signal): Promise<{ close }>
private subscribeSseForStreamer(settings, threadId, streamer): SseSubscriber
private async runStreamingReply(input: {
  bridge, chatId, threadId, turnId, replyOptions, responseTimeoutMs, context
}): Promise<{ ok, messageId, finalText, fellBack, message }>
private async handleFeishuMessage(channelId, message): Promise<void>
```

`handleFeishuMessage` 在分流点按 `channel.feishuStream === true` 决定走 streaming 还是原 polling。streaming 路径用 `streamedToFeishu = true` 标志(闭包内),streaming 完成后阻止后续的 `sendFeishuMessage` 重复发送。

### subscribeThreadEventsLive (并行 fetch + SSE)

```ts
// src/renderer/src/store/chat-store-thread-actions.ts
subscribeThreadEventsLive: async (threadId) => {
  // 1. 同步切 activeThreadId + busy=true(用户立即看到 view 切换)
  // 2. 立即开 SSE (sinceSeq: 0,捕获 fetch 期间到达的 deltas)
  // 3. 并行 await p.getThreadDetail(targetThreadId)
  // 4. fetch 完成后 merge 写入:
  //    - blocks: 拉到的历史
  //    - lastSeq: Math.max(fetched, current)  // 保护 SSE 已累积的 seq
  //    - liveAssistant / liveReasoning 不动 // 保护 SSE deltas
  //    - busy, currentTurnId, currentTurnUserId 从 fetch 推导
  // 5. fetch 失败:catch 块暴露 error,SSE 仍开
}
```

### 跨 SDK 调用要点(代码注释里都写明)

```ts
// bridge.stream(chatId, { markdown: producer }, replyOptions) -- 不是 bridge.send
// SSE 字段读 event.item.text -- 不是 event.item.delta
```

## Settings 改动

`src/shared/app-settings-types.ts:594-598`:

```ts
// ClawImChannelV1 interface 内
/** 当 provider === 'feishu' 时,是否把 agent 回复改为流式输出。默认 false (per-channel)。 */
feishuStream?: boolean
/** 当 provider === 'weixin' 时,是否把 agent 回复改为 block streaming。默认 true。 */
weixinStream?: boolean
```

`src/main/ipc/app-ipc-schemas.ts` 在 `ClawImChannelV1` zod schema 中加 `feishuStream: z.boolean().optional()`。

`src/shared/app-settings-claw.ts:159-163` 在 `map` 归一化处补 `feishuStream: normalizeBoolean(raw.feishuStream, false)`,确保缺省(undefined)显式归一为 `false`。

**无** default normalizer 注入到 `ClawImSettingsV1`;**无** migration 函数改动。`ClawImSettingsV1` 仍只是 IM 全局配置的容器,不持有 `feishuStream` 字段。

## UI 形态

`src/renderer/src/components/settings-section-claw.tsx:182-200`,在 connected-channel 卡片内,按 `channel.provider === 'feishu'` 条件渲染 `SettingRow`:

```tsx
<SettingRow
  title={t('clawFeishuStream')}
  description={t('clawFeishuStreamDesc')}
  control={
    <div className="flex items-center gap-2">
      <span className="text-[12px] font-medium text-ds-muted">
        {channel.feishuStream === true
          ? t('clawManageAgentEnabled')
          : t('clawManageAgentDisabled')}
      </span>
      <Toggle
        checked={channel.feishuStream === true}
        onChange={(value) => updateChannel(form, update, channel.id, { feishuStream: value })}
      />
    </div>
  }
/>
```

UI 沿用"卡片-列表-SettingRow"模式,与 `channel.enabled` / `channel.weixinStream` 并列。

## 集成测试表

| 场景 | 预期行为 |
|------|---------|
| per-channel `feishuStream=false` | 走原轮询路径 (`processIncomingImPrompt`) |
| per-channel `feishuStream=true`,streaming happy path | `FeishuStreamer` 顺序 append + 终态 setContent;`streamedToFeishu` 阻止重复 send |
| streaming 中 `bridge.stream` 抛错 | fallback 到 `bridge.send` 一次性发送,`fellBack: true` |
| streaming 中 `append` 失败 | 降级到 `setContent(accumulatedText)` partial 补发 |
| `turn_failed` | `ok: false`,partial 补发或错误提示 |
| abort / 超时 | `nextDelta = null`,`start` reject,降级到 send |
| 跨 turn 的 delta 忽略 | `currentTurnId !== turnId` 时不 append |
| 推理 delta 过滤 | `kind === 'agent_reasoning'` 不写入 `liveAssistant` |
| Webhook 路径 | 走 `bridge.send` 一次性,不走 streaming |
| 微信入站 | `handleWeixinMessage` 走轮询,不走 `FeishuStreamer` |
| `onClawChannelActivity` 触发自动切 | 走 `subscribeThreadEventsLive`(并行 fetch + SSE) |
| 自动切到无历史的新 thread | fetch 返回空 blocks,SSE 立即填充 liveAssistant |
| 自动切到有历史的 thread | fetch 返回历史 blocks,SSE 期间 deltas 保留,merge 后 `lastSeq` 取 max |
| `getThreadDetail` 失败 | 错误暴露在 UI,SSE 仍开,流式文本不丢 |

## 不在本期范围

- 任何对 `kun/` runtime 包的修改
- 任何对 `processIncomingImPrompt` / `waitForAssistantResult` 主体逻辑的修改
- `runStreamingReply` 的通用抽象抽取(为后续 wechat 渠道铺路)
- WeChat 渠道接入(见后续 `feat/weixin-block-streaming-v2` PR)
