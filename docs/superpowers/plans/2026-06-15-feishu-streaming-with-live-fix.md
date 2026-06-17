# 飞书 / Lark 流式输出（带 live 视图卡顿修复）实施记录

> **历史状态**:本计划最初于 2026-06-15 按 TDD 红绿循环拆分(41 个 commit)。2026-06-17 重做版为 5 个 commit 的扁平历史,本文件重写为最终实施记录,与代码现状一致。

**Goal:** 在 `feat/feishu-streaming` 分支上把飞书 / Lark bot 的回复改为 SDK markdown 流式卡,并修复上一版"`onClawChannelActivity` 触发时 Connect phone 视图卡住"的两处 bug(`selectThread` HTTP 抢在 SSE 之前 + `showLiveAssistant` 被 `isProcessing` 隐藏)。重做版额外把 `subscribeThreadEventsLive` 改造为"并行 fetch + SSE"以保留历史视图。

**Architecture:** 在 `ClawRuntime.handleFeishuMessage` 内部根据 `channel.feishuStream === true` 开关分两路 —— 开:经由 `runStreamingReply` 走 `FeishuStreamer` + `bridge.stream` + 自管 SSE 订阅(失败时退到一次性 `bridge.send`);关:走原 `processIncomingImPrompt` 轮询路径。Renderer 侧新增 `subscribeThreadEventsLive` action(**并行 fetch + SSE**:同步切 activeThreadId + 立即开 SSE sinceSeq:0 + 并行 getThreadDetail 拉历史,fetch 完成后 merge 写入),并把 `MessageTimeline` 的 live bubble 门控改为只检查 `liveContent`。WeChat、kun runtime、既有 `processIncomingImPrompt` 路径全部保留。

**Tech Stack:** Electron + React 19 + TypeScript + Zustand + Vitest + Lark SDK(`@larksuiteoapi/node-sdk`)。runtime 还是单一 `kun`(无新增 / 切换 runtime)。

**Spec:** [`docs/superpowers/specs/2026-06-15-feishu-streaming-with-live-fix-design.md`](../specs/2026-06-15-feishu-streaming-with-live-fix-design.md)

---

## 工作约束(影响全部任务)

- **TDD**:原分支上的红绿循环已嵌入到 `feishu-streamer.test.ts` / `claw-runtime.test.ts` / `chat-store-thread-actions.test.ts` 的 case 集合中。重做版保留所有原有 case,`subscribeThreadEventsLive` 的新行为(fetch + merge + lastSeq max + fetch 失败 fallback)在测试中显式覆盖。
- **commit 粒度**:5 个 commit(见下文 Commit 分组),每个 commit 完成立刻 commit。
- **YAGNI**:本期不做 card JSON 2.0、reasoning 透出、per-channel 已实现无需 YAGNI。
- **不动 `kun/` runtime 包**:kun 的 `/v1/threads/{id}/events` SSE 端点已经存在;本计划只用它。
- **不复用 `src/main/runtime-sse-ipc.ts`**:那是给 renderer→main IPC 用的;main 直接 `fetch` + 自管 SSE 解析循环(`subscribeRuntimeThreadEvents`)。
- **路径风格**:本计划所有路径用正斜杠,跨平台可读。
- **改动核心调用**:`bridge.stream(chatId, { markdown: producer }, replyOptions)`(**不是** `bridge.send` —— 上版踩坑);SSE 字段读 `event.item.text`(**不是** `event.item.delta` —— 上版踩坑)。两个 spec 注释里都写明。
- **路径冲突约定**:原 feishu 分支 41 个 commit 的"全局 `ClawImSettingsV1.feishuStream` + migration + 多次 UI 位置调整"已全部丢弃;**最终实现为 per-channel `ClawImChannelV1.feishuStream`**,无 default 注入、无 migration。

---

## 文件结构(实现前先锁好)

### 新增
| 文件 | 角色 |
|------|------|
| `src/main/feishu-streamer.ts` | `FeishuStreamer` 类,封装一次流式回复生命周期 |
| `src/main/feishu-streamer.test.ts` | `FeishuStreamer` 单测(10 个 case) |

### 修改
| 文件 | 角色 |
|------|------|
| `src/main/claw-runtime-helpers.ts` | `subscribeRuntimeThreadEvents` + `SseSubscriber` + `RuntimeSseEvent` |
| `src/main/claw-runtime-helpers.test.ts` | 新增 3 个 SSE case + 既有 `feishuSenderLabel` / `imCompletionReplyForPush` 测试 |
| `src/main/claw-runtime.ts` | `runStreamingReply` / `subscribeSse` / `subscribeSseForStreamer`;`handleFeishuMessage` 分支 |
| `src/main/claw-runtime.test.ts` | 集成测试(7 个 streaming 相关 case + 既有 44 个) |
| `src/main/ipc/app-ipc-schemas.ts` | `ClawImChannelV1` zod schema 加 `feishuStream: z.boolean().optional()` |
| `src/shared/app-settings-types.ts` | `ClawImChannelV1` 加 `feishuStream?: boolean`(per-channel,默认 false) |
| `src/shared/app-settings-claw.ts` | `map` 归一化补 `feishuStream: normalizeBoolean(raw.feishuStream, false)` |
| `src/shared/app-settings.test.ts` | `feishuStream` 归一化边界 case |
| `src/renderer/src/store/chat-store-types.ts` | `ChatState` 加 `subscribeThreadEventsLive` action 字段 |
| `src/renderer/src/store/chat-store-thread-actions.ts` | `subscribeThreadEventsLive` action(**并行 fetch + SSE** 改造) |
| `src/renderer/src/store/chat-store-thread-actions.test.ts` | `subscribeThreadEventsLive` 3 个 case(并行启动 / merge / 失败 fallback) |
| `src/renderer/src/store/chat-store-navigation-actions.ts` | `onClawChannelActivity` 改走新 action |
| `src/renderer/src/store/chat-store-navigation-actions.test.ts` | 路由验证 case |
| `src/renderer/src/components/chat/MessageTimeline.tsx` | `showLiveAssistant` 去掉 `!isProcessing` 门控 + 注释说明全局 SSE sink |
| `src/renderer/src/components/chat/derive-turn-sections.ts` | 衍生 turn 区段逻辑调整 |
| `src/renderer/src/components/chat/MessageTimeline.tool-summary.test.ts` | live bubble 渲染 |
| `src/renderer/src/components/chat/derive-turn-sections.test.ts` | 衍生逻辑 |
| `src/renderer/src/components/settings-section-claw.tsx` | per-channel `feishuStream` `SettingRow`,仅 feishu/lark 渠道显示 |
| `src/renderer/src/locales/en/settings.json` | `clawFeishuStream` / `clawFeishuStreamDesc`(英文 desc 修复为有信息量文案) |
| `src/renderer/src/locales/zh/settings.json` | 同上(中文) |
| `docs/CONTRIBUTING.md` | 末尾"飞书 / Lark 流式 smoke 测试"小节(自动化覆盖表 + 9 个手工 case + 验证命令) |
| `docs/superpowers/specs/2026-06-15-feishu-streaming-with-live-fix-design.md` | 设计 spec(per-channel + 默认 false,与本计划一致) |
| `docs/superpowers/plans/2026-06-15-feishu-streaming-with-live-fix.md` | 本文件 |

### 不在本计划里(明确不动的文件)
- `kun/` runtime 包
- `src/renderer/src/agent/kun-runtime.ts`
- `src/main/runtime-sse-ipc.ts`
- `src/main/claw-runtime.ts` 里 `processIncomingImPrompt` / `waitForAssistantResult` 主体逻辑
- `src/shared/app-settings-types.ts` 里 `ClawImSettingsV1`(不持有 `feishuStream`,迁移规则不变)

---

## Commit 分组(5 个 commit)

| # | 主题 | 涵盖文件 |
|---|------|---------|
| 1 | `docs(feishu): spec + plan for per-channel feishu streaming (default off)` | spec / plan / CONTRIBUTING |
| 2 | `types(settings): add ClawImChannelV1.feishuStream? (default off)` | app-settings-types / app-settings-claw / app-settings.test / ipc-schemas |
| 3 | `feat(claw): FeishuStreamer + runStreamingReply + SSE subscription` | feishu-streamer(.test) / claw-runtime / claw-runtime.test / claw-runtime-helpers / claw-runtime-helpers.test |
| 4 | `fix(chat): subscribeThreadEventsLive pre-fetches history in parallel with SSE` | chat-store-types / chat-store-thread-actions(.test) / chat-store-navigation-actions(.test) / MessageTimeline / MessageTimeline.tool-summary.test / derive-turn-sections(.test) |
| 5 | `feat(claw-settings): per-channel feishuStream toggle in connected-channel card` | settings-section-claw / locales/{en,zh}/settings |

---

## Phase 1:文档先行

### Task 1.1:重写 spec
- Files: `docs/superpowers/specs/2026-06-15-feishu-streaming-with-live-fix-design.md`
- 内容:把"全局 `ClawImSettingsV1.feishuStream` + 默认 `true` + migration"改为"per-channel `ClawImChannelV1.feishuStream` + 默认 `false` + 无 migration"。`runStreamingReply` 分支谓词改为 `channel.feishuStream === true`。spec §2.5 集成测试表去掉 migration 行,引用测试文件名 `MessageTimeline.tool-summary.test.ts` 而非过时的 `MessageTimeline.test.tsx`。

### Task 1.2:重写 plan
- Files: `docs/superpowers/plans/2026-06-15-feishu-streaming-with-live-fix.md`
- 内容:commit 分组改为 5 个;Task 2.1/2.2/2.3 的"全局 `ClawImSettingsV1`"改为"per-channel `ClawImChannelV1`";移除 default normalizer / migration 相关步骤;新增 Phase 4:并行 fetch + SSE 改造。

### Task 1.3:CONTRIBUTING smoke 小节
- Files: `docs/CONTRIBUTING.md`
- 内容:确认"飞书 / Lark 流式 smoke 测试"小节存在(9 个手工 case + 自动化覆盖表 + 验证命令)。**注意**:CONTRIBUTING.md 实际已有此小节,本任务主要是核对最新一致性。

---

## Phase 2:类型与 IPC

### Task 2.1:`ClawImChannelV1.feishuStream` 字段
- Files: `src/shared/app-settings-types.ts`
- 内容:在 `ClawImChannelV1` interface 内 `weixinStream?` 旁边加 `feishuStream?: boolean`,注释"当 provider === 'feishu' 时,是否把 agent 回复改为流式输出。默认 false (per-channel)。"

### Task 2.2:归一化
- Files: `src/shared/app-settings-claw.ts`
- 内容:在 `map` 归一化处加 `feishuStream: normalizeBoolean(raw.feishuStream, false)`,确保缺省(undefined)显式归一为 `false`。

### Task 2.3:归一化测试
- Files: `src/shared/app-settings.test.ts`
- 内容:`describe('feishuStream normalization')` 块,3 个 case:`undefined → false`、`true → true`、`false → false`。

### Task 2.4:IPC zod schema
- Files: `src/main/ipc/app-ipc-schemas.ts`
- 内容:`ClawImChannelV1` zod schema 加 `feishuStream: z.boolean().optional()`。

---

## Phase 3:FeishuStreamer + runStreamingReply + SSE

### Task 3.1:`FeishuStreamer` 类骨架 + failing test
- Files: `src/main/feishu-streamer.ts`(新),`src/main/feishu-streamer.test.ts`(新)
- 测试(10 case):happy-path(顺序 append + setContent 1 次);reasoning delta 被丢弃;跨 turn delta 被忽略;append 失败降级到 setContent(partial);subscribe 同步抛错被 reject;turn_failed 时 ok=false;abort 时 nextDelta=null + start reject;读 `event.item.text` 而非 `item.delta`;用 `bridge.stream` 而非 `bridge.send`;dispose 释放 waiters + subscription。

### Task 3.2:`subscribeRuntimeThreadEvents` SSE 订阅器
- Files: `src/main/claw-runtime-helpers.ts`,`src/main/claw-runtime-helpers.test.ts`
- 测试(3 case):首连带 `since_seq=0` + Authorization header;5xx 后 750ms→5s 指数退避重连;4xx(非 408/429)不重连。

### Task 3.3:`runStreamingReply` 编排
- Files: `src/main/claw-runtime.ts`
- 实现:`bridge.stream` 拿 `MarkdownStreamController`,把异步 SSE 包装成 `SseSubscriber`,调 `FeishuStreamer.start({ subscribe })`,超时/异常降级到 `bridge.send`。返回 `{ ok, messageId, finalText, fellBack, message }`。

### Task 3.4:`handleFeishuMessage` 分流
- Files: `src/main/claw-runtime.ts`
- 实现:在分流点按 `channel.feishuStream === true` 决定走 streaming 还是原 polling。streaming 完成后用闭包内 `streamedToFeishu = true` 标志阻止后续 `sendFeishuMessage` 重复发送。

### Task 3.5:集成测试
- Files: `src/main/claw-runtime.test.ts`
- 测试(7 case):routes through runStreamingReply when channel.feishuStream=true;fallback path(bridge.stream 抛错 → bridge.send 兜底);append-failure 走 setContent(accumulated);feishuStream 未开启时不用 FeishuStreamer;streaming happy path;weixin 不走 FeishuStreamer;runStreamingReplyWeixin 相关。

---

## Phase 4:并行 fetch + SSE(PR #332 反馈 #1 的重做版)

### Task 4.1:`subscribeThreadEventsLive` 改造
- Files: `src/renderer/src/store/chat-store-thread-actions.ts`,`src/renderer/src/store/chat-store-thread-actions.test.ts`,`src/renderer/src/store/chat-store-types.ts`
- 实现:
  - 同步切 `activeThreadId` + `busy: true`,**不**清 `blocks`/`lastSeq`(同 thread 时保留;跨 thread 时清空)
  - 立即开 SSE with `sinceSeq: 0`(捕获 fetch 期间 deltas)
  - 并行 `await p.getThreadDetail(targetThreadId)`
  - fetch 完成后用 `set((s) => ...)` merge:
    - `blocks: hydrateResult`
    - `lastSeq: Math.max(fetched, s.lastSeq)`  // 保护 SSE 已累积的 seq
    - `liveAssistant` / `liveReasoning` **不写入**(保护 SSE deltas)
    - `busy`, `currentTurnId`, `currentTurnUserId` 从 fetch 推导
  - fetch 失败:catch 块暴露 error,SSE 仍开
- 测试(3 case):并行启动(开 SSE + 调 fetch);merge 成功(blocks 写入,liveAssistant 保留,lastSeq 取 max);fetch 失败 fallback(错误暴露,SSE 仍开)。

### Task 4.2:`onClawChannelActivity` 路由
- Files: `src/renderer/src/store/chat-store-navigation-actions.ts`,`src/renderer/src/store/chat-store-navigation-actions.test.ts`
- 实现:`activeThreadId !== threadId` 时调 `subscribeThreadEventsLive(threadId)`(原 PR #332 的代码,保留)。
- 测试(1 case):路由验证,不调 `selectThread`。

### Task 4.3:`showLiveAssistant` 注释
- Files: `src/renderer/src/components/chat/MessageTimeline.tsx`
- 内容:在 `showLiveAssistant = !!liveContent.trim()` 上方注释加 4 行,说明 `live` 是全局 SSE sink 输出(所有渠道,非飞书专属),去掉 `!isProcessing` 门控是有意为之。

### Task 4.4:`MessageTimeline` 衍生逻辑
- Files: `src/renderer/src/components/chat/derive-turn-sections.ts`,`src/renderer/src/components/chat/derive-turn-sections.test.ts`,`src/renderer/src/components/chat/MessageTimeline.tool-summary.test.ts`
- 内容:live bubble 渲染衍生调整(配合 `showLiveAssistant` 门控变化)。

---

## Phase 5:Settings UI + i18n

### Task 5.1:per-channel SettingRow
- Files: `src/renderer/src/components/settings-section-claw.tsx`
- 内容:connected-channel 卡片内,`channel.provider === 'feishu'` 条件渲染 `SettingRow`,`Toggle` 绑 `channel.feishuStream === true`,`updateChannel(form, update, channel.id, { feishuStream: value })` 持久化。

### Task 5.2:i18n 修复
- Files: `src/renderer/src/locales/en/settings.json`,`src/renderer/src/locales/zh/settings.json`
- 内容:`clawFeishuStreamDesc` 从"Enable streaming output"/"开启流式输出"改为有信息量文案:
  - en: `"Stream the reply character-by-character in a live SDK card, instead of sending a one-shot message after the run completes."`
  - zh: `"把回复以 SDK 流式卡逐字发出,而不是在回复完成后一次性发送。"`

---

## 验证

### 自动化

```bash
npm run typecheck   # 必须 0 错误(2 个 pre-existing baseline 不算)
npm run lint        # 必须 0 错误
npm test -- claw claw-runtime feishu claw-runtime-helpers chat-store chat-store-thread-actions chat-store-navigation-actions  # 飞书相关测试全过
npm test            # 完整测试;预期 9 个 baseline 失败(4 文件:packaging-config、app-ipc-schemas、register-app-ipc-handlers、git-service),与本 PR 无关
```

### Smoke 测试(手工,真实飞书账号 + Electron)

参见 `docs/CONTRIBUTING.md` 的"飞书 / Lark 流式 smoke 测试"小节(9 个手工 case):

- 单聊发"你好":流式卡 1-2s 内出现,字符实时刷新
- 长回复(代码生成):30k 字符切分由 SDK 处理
- 触发限流(`outbound.retry.maxAttempts = 1`):观察 fallback 到一次性
- 触发 `turn_failed`(抛错的 MCP tool):观察 partial 补发
- 群 @bot:`replyInThread: true` 被尊重
- DM:`replyInThread: false` 默认
- **Connect phone 视图实时性(本 PR 关键修复)**:bot 消息 → chat view 立即出现流式文本,无空白期
- **自动切到有历史的会话(本 PR 新增)**:fetch 完成后历史 blocks 出现,SSE 期间 deltas 不丢
- 跨 turn 隔离:turn A 进行中发新消息 → A 收尾,B 独立
- 微信路径不变:不流式,设置无 toggle

### Pre-existing baseline 失败(与本 PR 无关)

`npm test` 在 PR commit 上失败的 9 个 case:

| 文件 | 失败数 | 原因 |
|------|--------|------|
| `src/main/packaging-config.test.ts` | 2 | electron-builder Kun packaging 既有 baseline |
| `src/main/ipc/app-ipc-schemas.test.ts` | 1 | 既有 baseline |
| `src/main/ipc/register-app-ipc-handlers.test.ts` | 1 | 既有 baseline |
| `src/main/services/git-service.test.ts` | 5 | Windows 平台 `path.normalize` 行为差异(`/ vs \`);用 stash 验证与本 PR 无关 |

---

## 不在本计划里

- 任何对 `kun/` runtime 包的修改
- 任何对 `processIncomingImPrompt` / `waitForAssistantResult` 主体逻辑的修改
- `runStreamingReply` 的通用抽象抽取(为后续 wechat 渠道铺路)
- WeChat 渠道接入(见后续 `feat/weixin-block-streaming-v2` PR)
- `card JSON 2.0` 富卡片
- 推理 / chain-of-thought 透出
