# Remote 手机端 · Code Review 修复计划

> 日期：2026-09-23
> 来源：对当前工作区未提交改动（45 个文件，Remote 手机端 Code 模式 Phase 1/2 实现）的 xhigh 级别 code review，共 11 条问题。
> 前置文档：[remote-mobile-code-plan.zh-CN.md](./remote-mobile-code-plan.zh-CN.md)（原始修复计划）。
> 当前测试状态：相关测试全绿（renderer 30 个文件 / 153 例，kun 3 个文件 / 29 例），**以下问题都不会被现有测试发现**。

---

## 0. 总览

| ID | 严重度 | 模块 | 一句话问题 | 批次 | 预估 |
| --- | --- | --- | --- | --- | --- |
| F1 | 高 | main / remote-events | 缓冲溢出只发一个无 streamId 的错误，除当前会话外的所有订阅永久卡死 | A | 1 天 |
| F2 | 高 | renderer / 轮询 | 「页面隐藏就暂停」也作用于桌面 Electron，最小化/被遮挡时后台会话不再通知 | B | 0.5 天 |
| F3 | 高 | bridge / transport | EventSource 进入 CLOSED 后永不重建，推送彻底失效 | A | 0.5 天 |
| F4 | 中 | renderer / 恢复 hook | 每次切回页面都全量刷新 + 打断健康的流 + 闪「正在恢复」 | A | 0.5 天 |
| F5 | 中 | renderer / 项目会话 hook | 搜索 effect 随每次会话列表更新重发，可能永远停在「搜索中」 | C | 0.25 天 |
| F6 | 中 | renderer / 手机首页 | 4 个注册表在两处组件里每次会话更新都重读 + JSON 解析 | C | 0.25 天 |
| F7 | 中 | kun / ThreadService | listPage 回退路径、list() 对新 `workspaces` 参数处理不一致 | D | 0.25 天 |
| F8 | 中 | kun / 测试 | 生产用的 SQLite `IN (...)` 分支没有测试；测试命名与内容不符；注释错误 | D | 0.25 天 |
| F9 | 中 | renderer / store | `persist: false` 只改了 store，多处仍回落到宿主 `settings.workspaceRoot` | E | 0.5 天 |
| F10 | 低 | renderer / 会话详情 | 重命名/归档失败是未处理的 rejection；关闭再打开仍显示旧编辑态 | E | 0.1 天 |
| F11 | 低 | i18n | 手机端文案借用其他功能的 key；新增的 `mobileDetailsPath` 未使用 | E | 0.2 天 |

**建议批次与 PR 拆分**

| 批次 | 内容 | 目标 | 依赖 |
| --- | --- | --- | --- |
| A（P0） | F1 + F3 + F4，以及配套的「sender 重置」信号 | 锁屏、切后台、断网回来后，所有实时视图都能自动恢复 | F4 依赖 F1、F3 提供的信号 |
| B（P0） | F2 | 修掉桌面端回归（后台通知） | 无，可与 A 并行、优先合入 |
| C（P1） | F5 + F6 | 手机端性能与搜索可用性 | 无 |
| D（P1） | F7 + F8 | kun 多工作区列表的一致性与测试 | 无 |
| E（P2） | F9 + F10 + F11 | 边角正确性与可维护性 | F9 最好在 A 之后做 |

建议提交顺序：**B → A → D → C → E**。B 是桌面端回归，影响面最大、改动最小，应该最先合。

---

## 批次 A：推送链路可靠性（F1 / F3 / F4 + sender 重置信号）

### 背景：一条推送事件的完整路径

```
kun runtime SSE ──fetch──> main: runtime-sse-ipc（批量 + ACK 窗口，15s 未 ACK 即终止）
                              │ sender.send('runtime:sse-event', …)
                              ▼
                  RemoteClientSender（每个浏览器客户端一个）
                              │ hub.emitToClient
                              ▼
                  RemoteEventHub：有 EventSource → 直接写；没有 → 进缓冲（上限 512）
                              │ HTTP SSE /remote/events
                              ▼
            浏览器 bridge：EventSource → dispatchEvent(channel) → 各订阅方的 sink
```

关键约束：
- 每条 `runtime:sse-event` 都要 ACK。手机锁屏后 15 秒内没有 ACK，main 就会终止这条流，并发送终止帧 `runtime:sse-error { code: 'renderer_ack_timeout', streamId }`。**真正让订阅方自愈的，是这个带 streamId 的终止帧**。
- `terminal:data`、`file:workspace-changed`、`browser-use:state` 这类频道没有 ACK 节流，锁屏期间会源源不断进缓冲。

---

### F1 缓冲溢出后，除当前会话外的所有订阅永久卡死

**现象**
手机锁屏时，宿主上有终端在输出（或文件监听很频繁）。解锁后 Rooms、Rooms 运行详情、设计助手、侧边会话等实时视图全部不再更新，只有刷新页面才能恢复。以桌面尺寸打开 Remote 的平板，连当前会话都不会恢复。

**根因**
- `src/main/remote/remote-events.ts:113-123`：缓冲超过 512 帧时，把**整个缓冲**清空，只放一帧 `runtime:sse-error { code: 'remote_buffer_overflow' }`（**没有 streamId**），同时置 `bufferOverflowed = true`，之后的所有帧都丢弃。
- 各订阅方的错误回调都是 `if (sid !== streamId) return`（`src/renderer/src/agent/kun-runtime-services.ts:629-645`、`useRoomEvents.ts:170`、`useRoomRun.ts`、`design-assistant-store.ts`），**无 streamId 的帧没人处理**。
- 被清掉的恰恰是各条流自己的终止帧（`renderer_ack_timeout` / `remote_client_expired`）。溢出之后新产生的终止帧也被丢弃。
- 唯一的兜底是 `use-mobile-reconnect-recovery.ts`，它只恢复 Code 的当前会话，而且只挂在 `MobileAppShell` 里（桌面尺寸的 Remote 客户端不挂）。

**修复方案：按频道分级的缓冲 + 按流发终止帧**

1. 在 `remote-events.ts` 里给频道分级：

   ```ts
   // 终止类：永不淘汰（数量受「流的个数」约束，天然有界）
   const CONTROL_CHANNELS = new Set([
     'runtime:sse-error', 'runtime:sse-end',
     'terminal:exit', 'remote-ssh:terminal:exit'
   ])
   // 流数据：溢出时按流整体丢弃，并为该流补一个终止帧
   const STREAM_DATA_CHANNELS = new Set(['runtime:sse-event', 'runtime:sse-open'])
   // 可丢失：最先被淘汰；browser-use:state 只保留每个 thread 的最新一帧
   const LOSSY_CHANNELS = new Set([
     'terminal:data', 'remote-ssh:terminal:data',
     'file:workspace-changed', 'browser-use:state'
   ])
   ```

2. 缓冲仍是**一个有序数组**，保证同一条流「数据在前、终止在后」的顺序。每一帧记录 `{ channel, payload, kind, streamId? }`，其中 `streamId` 从 payload 里取。

3. 超过上限时的淘汰顺序（循环执行，直到回到上限以内）：
   1. 先淘汰最旧的 LOSSY 帧；
   2. 仍然超限：选缓冲里数据帧最多的那条流 `S`，删除 `S` 的**全部**数据帧，追加一帧 `runtime:sse-error { streamId: S, code: 'remote_buffer_overflow' }`，并把 `S` 加入 `client.overflowedStreams`；
   3. CONTROL 帧永不淘汰。

4. `emitToClient` 收到属于 `overflowedStreams` 的数据帧时直接丢弃；**其他流不受影响**（去掉现在这个全局的 `bufferOverflowed` 开关）。

5. 通知 main 侧停掉溢出的流，避免它继续白白发送：
   - `RemoteClientSender` 新增事件 `remote:streams-overflowed`，参数是 `streamIds: string[]`；
   - `runtime-sse-ipc.ts` 的 `observeSseOwner` 里，已有 `remote:will-destroy` 监听，旁边再加一个监听：对这些 streamId 执行 `stopSseState(state)`，并从 `sseControllers` 删除。终止帧已经在第 3 步写入缓冲，这里**不要**再发一次。

6. `attachStream` 刷出缓冲后清空 `overflowedStreams`。

7. 契约：`src/shared/kun-gui-sse-contracts.ts` 把 `SseErrorPayload.streamId` **改回必填**，删掉「session-level」那段注释。`use-mobile-reconnect-recovery.ts` 里对无 streamId 的 `remote_buffer_overflow` 的特判一并删除（见 F4）。

**渲染层配套（确认或补齐按流恢复）**

| 订阅方 | 文件 | 当前收到带 streamId 的错误后的行为 | 需要做什么 |
| --- | --- | --- | --- |
| Code 线程流 | `agent/kun-runtime-services.ts:629` | `sink.onError` 进入 store 的通用恢复（从快照续订） | 确认新 code 不会以原始文案 `sse error` 展示给用户；需要时给 `remote_*` code 配友好文案 |
| Rooms 总流 | `components/rooms/useRoomEvents.ts:170` | 只把 `live` 置为 false，退化成每 10 秒轮询，**永不重新订阅 SSE** | 收到 `remote_*` 或 `renderer_ack_timeout` 时，带退避调用 `initialize()` 重新 `startSse`（复用现有 cursor） |
| Rooms 运行详情 | `components/rooms/useRoomRun.ts:167` | 需要核对 | 同上：重新订阅，从最后的 cursor 续上 |
| 设计助手 | `design/design-assistant-store.ts:148` | 需要核对 | 同上 |
| 侧边会话 / graph 观察者 | `store/chat-store-side-runtime.ts:528`、`graph/*` | 目前只处理 `replay_reset_required` | 核对其余 code 是否会走通用重订阅；不会就补上 |

**改动文件**：`src/main/remote/remote-events.ts`、`src/main/remote/remote-sender.ts`、`src/main/runtime-sse-ipc.ts`、`src/shared/kun-gui-sse-contracts.ts`、`src/renderer/src/components/rooms/useRoomEvents.ts`、`useRoomRun.ts`、`src/renderer/src/design/design-assistant-store.ts`（按核对结果增减）。

**测试**（`src/main/remote/remote-events.test.ts`）
- 缓冲里有流 A、B 的数据帧和 600 帧 `terminal:data`：只淘汰 `terminal:data`，A、B 的数据帧完整保留。
- 流 A 的数据帧单独撑爆缓冲：attach 后收到 B 的全部数据帧，以及 **A 的一帧** `runtime:sse-error { streamId: 'A', code: 'remote_buffer_overflow' }`；之后 A 的数据帧被丢弃，B 的不受影响。
- 溢出前已缓冲的 CONTROL 帧（如 `renderer_ack_timeout`）在溢出后仍会送达。
- `browser-use:state` 按 thread 合并，只保留最新一帧。
- sender 触发 `remote:streams-overflowed` 时，`runtime-sse-ipc` 停掉对应流（新增一个 runtime-sse-ipc 单测，或放进现有测试）。
- 删掉现有的「整个缓冲替换成一个全局错误」这条断言。

**验收**
锁屏 2 分钟，期间宿主终端持续输出（`yes | head -n 200000`），解锁后：Code 当前会话、Rooms 列表、Rooms 运行详情在 5 秒内恢复实时更新，不需要刷新页面。

**风险**
锁屏期间的终端输出会丢失一部分（原本也会丢）。可以在丢弃 `terminal:data` 时写一条 `terminal:data-dropped { sessionId }` 标记，让终端视图显示「部分输出已省略」（可选）。

---

### F3 EventSource 进入 CLOSED 后永不重建

**现象**
iOS Safari 从后台恢复、切换网络，或者网关对 `/remote/events` 返回非 SSE 响应（5xx 等）之后，页面上所有推送都停了，会话看起来一直卡在生成中，必须手动刷新。

**根因**
`src/renderer/public/remote-bridge-transport.js:56-79`：
- `ensureEventStream()` 在 `if (eventSource) return` 处直接返回；
- `onerror` 只做一次登录态探测。如果探测结果仍是已登录，就什么都不做；
- EventSource 一旦 `readyState === CLOSED`（浏览器放弃重连），`eventSource` 仍然指向这个死对象，之后再也不会新建。

**修复方案**

```js
var reconnectTimer = null
var reconnectDelay = 1000            // 1s → 2s → … 最多 30s
var MAX_RECONNECT_DELAY = 30000

function scheduleRecreate() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(function () {
    reconnectTimer = null
    if (eventSource && eventSource.readyState !== EventSource.CLOSED) return
    eventSource = null
    ensureEventStream()              // 新连接的 onopen 会派发 reconnected
  }, reconnectDelay)
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY)
}

source.onopen = function () {
  if (source !== eventSource) return
  reconnectDelay = 1000
  if (streamWasOpen && streamDropped) dispatchEvent('remote:stream-reconnected', {})
  streamWasOpen = true
  streamDropped = false
}
source.onerror = function () {
  if (source !== eventSource) return
  streamDropped = true
  probeRemoteAuth()                  // 未登录会跳转登录页
  if (source.readyState === EventSource.CLOSED) {
    try { source.close() } catch (e) {}
    scheduleRecreate()
  }
  // CONNECTING 状态交给浏览器自己重连
}

// 页面回到前台时，如果连接已死，立即重建，不等退避
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState !== 'visible') return
  if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    reconnectDelay = 1000
    eventSource = null
    ensureEventStream()
  }
})
window.addEventListener('online', function () { /* 与 visibility 同样处理 */ })
```

还有一点：`probeRemoteAuth` 返回 `authed: false` 时要停止重建（会跳转登录页），防止跳转前抢着再建一次连接。

**配套：sender 重置信号（给 F4 用）**

有两种情况，客户端需要知道「服务端已经丢掉了我名下所有的流」：
1. 超过 5 分钟宽限期后 sender 被销毁；在 10 分钟保留期内回来，`ensureClient` 会新建 sender（`remote-events.ts:186-199`）；
2. 超过保留期后，client 条目被彻底删除，回来时是一个全新条目，**连 `remote_client_expired` 终止帧也没有**。

方案：
- bridge 第二次及以后建立连接时，URL 带上 `&resume=1`；
- `remote-access-service.ts` 的 `handleEvents` 把 `resume` 传给 `hub.attachStream(…, { resume })`；
- `RemoteEventHub.attachStream` 在以下两种情况下，先直接写一帧（用 `writeSseFrame`，不经过 allowlist）`remote:sender-reset`，再刷出缓冲：
  - `ensureClient` 这次新建了 sender（给 client 加一个 `senderRecreated` 标记，写完后清掉）；
  - 或者 `resume === true`，但这个 clientId 在 hub 里原本不存在。
- bridge 暴露 `onRemoteSenderReset: on('remote:sender-reset')`；`KunGuiSseSurface` 增加对应的可选方法。

**改动文件**：`src/renderer/public/remote-bridge-transport.js`、`src/renderer/public/remote-bridge.js`、`src/main/remote/remote-events.ts`、`src/main/remote/remote-access-service.ts`、`src/shared/kun-gui-sse-contracts.ts`。

**测试**
- 新建 `src/renderer/src/mobile/remote-bridge-transport.test.ts`：在 jsdom 里用 `fs.readFileSync` 读入 transport 源码并执行，注入一个假的 `EventSource` 类（可以手动控制 `readyState`，手动触发 `onopen` / `onerror`）。覆盖以下场景：
  - CONNECTING 状态出错：不新建连接；
  - CLOSED 状态出错：按退避新建连接，新连接 open 后派发 `remote:stream-reconnected`；
  - `authed: false`：跳转登录页，不再新建连接；
  - `visibilitychange` 时连接已是 CLOSED：立即新建。
- `remote-events.test.ts`：
  - 过期后 sender 被重建，attach 时第一帧是 `remote:sender-reset`；
  - `resume=1` 且条目已被删除：同样发 `remote:sender-reset`；
  - 首次连接（`resume=0`）：不发。

**验收**
- Chrome DevTools 里把 `/remote/events` 的响应改成 500（或在网关里临时注入），恢复后 30 秒内推送自动恢复；
- iPhone 锁屏 20 分钟（超过 5 分钟宽限 + 10 分钟保留）后解锁，当前会话与 Rooms 自动恢复，不需要刷新页面。

---

### F4 每次切回页面都全量刷新，打断健康的流，还会闪「正在恢复」

**现象**
在手机上切到别的 App 几秒再切回来，会话页顶部闪一下「正在恢复连接」，时间线轻微跳动，同时有一大批网络请求。

**根因**
`src/renderer/src/mobile/use-mobile-reconnect-recovery.ts:31-34`：只要 `visibilitychange` 变成可见就调用 `recover()`，而 `recover()`：
- `refreshThreads()`：全局 100 条会话、可疑标题的详情探测、运行中会话的状态批量加载；
- `recoverActiveTurn()`：先 `sseAbortRef.current?.abort()` 打断当前流，再 `set({ error: runtimeStreamRecoveringMessage() })`（`chat-store-thread-creation-actions.ts:437`），于是出现横幅。
另外 `code === 'remote_client_expired' && typeof streamId !== 'string'` 这个分支是死代码（main 发这个 code 时一定带 streamId）。

**修复方案**

1. **触发条件收紧**，只在确实可能丢事件时恢复：

   | 信号 | 动作 |
   | --- | --- |
   | `onRemoteSenderReset`（F3） | **完全恢复**：服务端所有流都已停止 → 执行 `refreshThreads()` + `recoverActiveTurn({ reason: 'sse_disconnect' })`，并派发 `kun:remote-resubscribe-all` 事件，Rooms、设计助手等订阅方各自重新订阅 |
   | `onRemoteStreamReconnected`（EventSource 断开后重新连上） | **轻量校验**：见第 2 步 |
   | `visibilitychange → visible` | 只在「隐藏时长 ≥ 15 秒（ACK 超时）」**并且**（当前会话 busy **或** 隐藏时长 ≥ 60 秒）时做轻量校验；否则什么都不做 |
   | `online` | 同 `onRemoteStreamReconnected` |

2. **轻量校验**：`provider.getThreadState(activeThreadId)` 拿到 `latestSeq` 和运行状态：
   - `latestSeq > state.lastSeq`，或者 runtime 显示运行中而本地没有活跃流，才调用 `recoverActiveTurn`；
   - 线程列表只在隐藏 ≥ 60 秒时刷新一次，否则交给已有的活动监听（`sidebar-activity-lifecycle`）增量更新。

3. **不闪横幅**：给 `ThreadRecoveryOptions`（`src/renderer/src/store/thread-recovery-coordinator.ts:10`）加一个 `quiet?: boolean`。`recoverActiveTurn` 在 `quiet` 时不设置 `runtimeStreamRecoveringMessage()`（恢复失败时照常报错）。后台自动恢复一律传 `quiet: true`。

4. **挂载位置**：从 `MobileAppShell` 挪到 `AppShell`，条件是 `window.kunGui?.isRemoteWeb === true`，让桌面尺寸的 Remote 客户端（平板、横屏）也能恢复。hook 改名为 `useRemoteReconnectRecovery`，文件移到 `src/renderer/src/lib/` 或 `src/renderer/src/remote/`。

5. 删掉 `onSseError` 里对全局 `remote_buffer_overflow` / `remote_client_expired` 的特判（F1 之后这些都是按流的帧，由各自的 sink 处理）。

**改动文件**：`use-mobile-reconnect-recovery.ts`（改名、移动）、`AppShell.tsx`、`MobileAppShell.tsx`、`thread-recovery-coordinator.ts`、`chat-store-thread-creation-actions.ts`（`recoverActiveTurn` 支持 `quiet`）、`useRoomEvents.ts` / `useRoomRun.ts` / `design-assistant-store.ts`（监听 `kun:remote-resubscribe-all`）。

**测试**（新建 `use-remote-reconnect-recovery.test.ts`，用 fake timers 与假 store）
- 隐藏 5 秒后恢复可见：不调用 `refreshThreads` / `recoverActiveTurn`；
- 隐藏 20 秒、busy、`getThreadState.latestSeq > lastSeq`：调用 `recoverActiveTurn({ quiet: true })`；
- 隐藏 20 秒、非 busy、seq 没有落后：什么都不做；
- `remote:sender-reset`：完全恢复，并派发 `kun:remote-resubscribe-all`；
- 2 秒内多个信号只触发一次。

**验收**
- 切 App 5 秒再回来：不出现横幅；Network 面板里除了常规轮询没有新请求；
- 生成回复过程中锁屏 30 秒再解锁：回复自动续上，全程不出现「正在恢复」横幅；
- 锁屏 20 分钟再解锁：自动完全恢复。

---

## 批次 B：桌面端回归（F2）

### F2 「页面隐藏就暂停」同时作用于桌面 Electron

**现象（桌面端）**
Kun 窗口最小化，或者被其他窗口完全遮住（macOS 的遮挡检测会把 `visibilityState` 置为 `hidden`）时，IM 或定时任务在后台启动的会话跑完后，没有系统通知、没有未读标记、Dock 角标不更新，要等用户切回窗口才补上。

**根因**
- `src/renderer/src/sidebar-activity-lifecycle.ts:72`：只要 `isPageHidden()` 就停掉活动监听，**不区分平台，也不看有没有进行中的工作**。原有的 legacy 扫描逻辑（同文件 `scheduleLegacy`）是刻意设计成「隐藏时只要 `hasActiveWork()` 就继续跑」的。
- 活动监听是发现「新开始运行的后台会话」并把它加入 `watchTurnCompletion` 的入口（`chat-store-sidebar-activity.ts:273`），停掉后后续的完成通知链路就断了。
- `src/renderer/src/lib/model-connection-watch.ts:96` 和 `src/renderer/src/lib/shared-business-storage.ts`（隐藏时跳过同步）同理，影响相对小，但也不应该改变桌面行为。

**修复方案**

1. `src/renderer/src/lib/page-visibility.ts` 新增：

   ```ts
   /** 只有 Remote Web（手机浏览器）才在隐藏时暂停后台轮询；桌面 Electron 保持原行为。 */
   export function shouldParkWhenHidden(): boolean {
     return typeof window !== 'undefined' &&
       window.kunGui?.isRemoteWeb === true &&
       isPageHidden()
   }
   ```

2. `sidebar-activity-lifecycle.ts`：`if (shouldParkWhenHidden() && !hasActiveWork())`。Remote 端有运行中的工作时也继续监听，与 legacy 扫描的语义保持一致。

3. `model-connection-watch.ts`：改用 `shouldParkWhenHidden()`。

4. `shared-business-storage.ts`：定时器里改成 `if (shouldParkWhenHidden()) return`。`visibilitychange` 时立即同步，这一点对两端都保留。

**测试**
- 新建 `src/renderer/src/sidebar-activity-lifecycle.test.ts`（目前没有）：mock `rendererRuntimeClient.runtimeRequest` 和 `document.visibilityState`：
  - 桌面（`isRemoteWeb` 未定义）、hidden：依然发出 `/v1/thread-activity/events` 请求；
  - Remote、hidden、没有活跃工作：暂停；恢复可见后立即发出请求；
  - Remote、hidden、有运行中的会话：继续请求。
- `model-connection-watch.test.ts`：补充桌面 hidden 时不暂停的用例。
- `shared-business-storage.test.ts`：补充桌面 hidden 时定时同步照常的用例。

**验收（桌面端）**
在 IM 里触发一个 30 秒左右的任务，然后立刻最小化 Kun。任务完成时有系统通知，Dock 角标 +1。

---

## 批次 C：手机首页性能与搜索（F5 / F6）

### F6 注册表在两处组件里被反复读取和解析

**根因**
- `src/renderer/src/mobile/screens/MobileCodeHome.tsx:90` 和 `use-mobile-project-threads.ts:63` 各有一个 `useMemo`，以 `chat.threads` 为依赖，每次都读取并 `JSON.parse` 4 个 localStorage 注册表：`kun.threadWorktrees.v1`、`kun.write.threadRegistry.v1`、`kun.design.threadRegistry.v1`、`kun.sdd.threadRegistry.v1`。
- 进入项目后，`MobileCodeHome` 的 `projects`（`selectCodeProjectRoots` → `buildSidebarWorkspaceGroups`）仍在每次会话更新时重算，而这时根本不显示项目列表。
- `chat.threads` 的更新非常频繁（活动监听、刷新、流式状态变化）。

**修复方案**

1. 新建 `src/renderer/src/mobile/screens/use-thread-classification-registries.ts`：

   ```ts
   const KEYS = ['kun.threadWorktrees.v1', 'kun.write.threadRegistry.v1',
     'kun.design.threadRegistry.v1', 'kun.sdd.threadRegistry.v1'] as const

   /**
    * 以「原始字符串」为缓存键：读字符串很便宜，只有字符串变了才重新解析，
    * 返回对象的引用只在内容变化时改变。
    */
   export function useThreadClassificationRegistries(trigger: unknown): Registries {
     const cache = useRef<{ raw: string; value: Registries } | null>(null)
     const [storageRevision, bump] = useReducer((n: number) => n + 1, 0)
     useEffect(() => {
       const onChange = (): void => bump()
       window.addEventListener(SHARED_BUSINESS_STORAGE_CHANGED_EVENT, onChange)
       return () => window.removeEventListener(SHARED_BUSINESS_STORAGE_CHANGED_EVENT, onChange)
     }, [])
     return useMemo(() => {
       const raw = KEYS.map((key) => readBrowserStorageItem(key) ?? '').join('\u0000')
       if (cache.current?.raw === raw) return cache.current.value
       const value = {
         threadWorktrees: readThreadWorktreeRegistry().worktrees,
         writeRegistry: readWriteThreadRegistry(),
         designRegistry: readDesignThreadRegistry(),
         sddRegistry: readSddThreadRegistry()
       }
       cache.current = { raw, value }
       return value
     // trigger（会话列表）只负责触发比较；本地写注册表不会派发共享存储事件，所以需要它兜底
     // eslint-disable-next-line react-hooks/exhaustive-deps
     }, [trigger, storageRevision])
   }
   ```

2. `MobileCodeHome` 和 `useMobileProjectThreads` 都改用这个 hook，删掉各自的 `classification`。

3. 选中项目后跳过项目列表的计算：可以把 `projects` 的计算放进一个只在 `!project` 时渲染的子组件（`MobileProjectList`），或者 `useMemo` 里 `if (project) return EMPTY`。

**测试**
- hook 单测：会话列表变化但注册表字符串没变时，返回同一个对象引用；改写 localStorage 或派发共享存储事件后返回新对象。
- `MobileCodeHome.test.ts`：进入项目后再更新 threads，`selectCodeProjectRoots` 不被调用（spy）。

### F5 搜索 effect 随每次会话列表更新重发

**根因**
`use-mobile-project-threads.ts:164`：依赖数组里有 `classification.threadWorktrees`，它随每次 `chat.threads` 变化而换引用。effect 重跑 → 清掉防抖 → `searchGeneration` 自增，在途结果被丢弃 → 重新发请求。会话更新快于「300 ms 防抖 + 请求耗时」时，搜索会一直停在搜索中。

**修复方案**
1. 依赖 F6 的稳定引用之后，再额外改用**字符串 key**：

   ```ts
   const worktreeKey = useMemo(
     () => worktreePathsForProject(normalizedProject, registries.threadWorktrees).sort().join('\n'),
     [normalizedProject, registries.threadWorktrees]
   )
   // effect 依赖改为 [normalizedProject, query, worktreeKey]，effect 内用 worktreeKey.split('\n') 还原
   ```
2. 搜索结果同样经过 `normalizeWorkspaceRoot(thread.workspace)`，与分页列表处理一致（`chat-store-thread-pagination.ts` 的 loadMore 里就是这样做的），避免归属判断出现路径大小写或尾斜杠差异。

**测试**（`MobileCodeHome.test.ts` 或新建 hook 测试）
- 输入关键字后，300 ms 内连续 5 次更新 store 的 threads（注册表不变）：`listThreadsPage({ search })` **只调用 1 次**，结果正常显示；
- 搜索进行中更新了 worktree 注册表：会重新发起搜索。

**验收**
在一个有运行中会话的环境里，进入项目搜索关键字，1 秒内出结果；Network 面板中每次输入只有 1 次 `/v1/threads?search=` 请求。

---

## 批次 D：kun 多工作区列表（F7 / F8）

### F7 回退路径与 `list()` 对 `workspaces` 的处理不一致

**根因**
- `kun/src/services/thread-service-metadata-operations.ts:116-130`（listPage 回退，用于没有 listPage 的存储）：为了先拉全量再在内存里过滤，显式清掉了 `workspace: undefined`，**却没有清掉新的 `workspaces`**。如果某个存储的 `list()` 支持 `workspaces`，就会先按 worktree 过滤一遍，再经 `filterThreadSummaries` 过滤后，项目根目录下的会话就全丢了。
- 同文件 `list()`（`:93-95`）内存过滤只看 `options.workspace`，`workspaces` 却原样传给了存储，调用 `list({ workspace, workspaces })` 时 worktree 会话会被过滤掉。

**修复方案**

```ts
// listPage 回退
const allThreads = await store.list({
  ...storeOptions,
  limit: undefined, cursor: undefined, search: undefined,
  workspace: undefined,
  workspaces: undefined,          // 新增
  includeArchived: true, archivedOnly: false, includeSide: true
})

// list()
const workspaceSet = new Set([options.workspace, ...(options.workspaces ?? [])].filter(Boolean))
if (workspaceSet.size > 0) {
  threads = threads.filter((thread) => workspaceSet.has(thread.workspace))
}
```

更进一步：`list()` 的内存过滤（archived / side / workspace / search）与 `kun/src/domain/thread-list-query.ts` 的 `filterThreadSummaries` 基本重复，可以直接复用后者（注意它会排序、不会截断 limit，替换时保持原有的 limit 截断行为）。

另外，路由 `kun/src/server/routes/threads.ts:692` 目前永远传 `workspaces: []`。改成**只在非空时才带上**：

```ts
const workspaces = url.searchParams.getAll('workspaces').map((v) => v.trim()).filter(Boolean).slice(0, 64)
...(workspaces.length ? { workspaces } : {})
```

这样 manager IPC 的 payload 和改动前完全一致，也减少了严格 schema 在版本混用时的风险。

**测试**（`kun/src/services/thread-service-list.test.ts`）
- 用一个没有 `listPage`、且 `list()` 会按 `workspaces` 过滤的假存储：`listPage({ workspace: '/repo', workspaces: ['/wt'] })` 同时返回 `/repo` 和 `/wt` 的会话；
- `list({ workspace: '/repo', workspaces: ['/wt'] })` 同时返回两者；
- 路由在没有 `workspaces` 参数时，传给 service 的 options 里**没有** `workspaces` 键。

### F8 生产 SQLite 分支没有测试；测试命名与注释有误

**根因**
- `kun/src/adapters/hybrid/hybrid-thread-index.ts:50-56` 的 `workspace IN (@workspace0, …)` 是生产环境真正走的路径，目前**没有任何测试**。现有测试只覆盖了内存 mapping、路由和一个只记录参数的假存储。
- `:53` 的注释「better-sqlite3 expands array params in IN lists」是错的：better-sqlite3 不会展开数组，而代码实际用的是逐个命名的参数。这句注释会误导后人把它「简化」成数组参数。
- `kun/src/server/routes/threads.test.ts:683` 的用例名是「rejects a malformed workspaces value」，实际测的是 `limit=abc`。

**修复方案**
1. 删掉错误注释，改成：`// better-sqlite3 has no array binding; bind each root as its own named parameter.`
2. 新增 `kun/src/adapters/hybrid/hybrid-thread-index-workspaces.test.ts`，参照 `hybrid-thread-backfill.test.ts` 的方式，在临时目录里建一个真实的 HybridThreadStore / 索引：
   - 写入 3 个工作区（`/repo`、`/wt-a`、`/other`）的会话，每个 30 条；
   - `listPage({ workspace: '/repo', workspaces: ['/wt-a'], limit: 25 })`：第一页 25 条，`hasMore = true`，`total = 60`；用 `nextCursor` 翻到第二页拿到剩余 35 条，两页没有重复、没有遗漏，也没有 `/other` 的会话；
   - 只有一个 workspace 时走 `workspace = @workspace` 分支，结果正确；
   - 配合 `search`：`IN` 与 `LIKE` 条件组合正确。
3. 路由测试：把现有用例改名为「rejects a malformed limit」。再新增一条真正针对 `workspaces` 的用例：超过 64 个会被截断；空字符串会被过滤。

---

## 批次 E：边角正确性与可维护性（F9 / F10 / F11）

### F9 `persist: false` 的「本地项目」会漏回宿主设置

**根因**
`selectWorkspaceRoot(root, { persist: false })`（`chat-store-navigation-workspace-actions.ts:282`）只改了 store 里的 `workspaceRoot`，但下面这些路径仍然读宿主的 `settings.workspaceRoot`：

| 位置 | 行为 |
| --- | --- |
| `store/chat-store-app-actions.ts:376-388` `reloadUiSettings` | 把 store 的 `workspaceRoot` **重置**为宿主值 |
| `store/chat-store-thread-send-direct.ts:173-174` | 没有活跃会话时发消息，会在**宿主的项目**里新建会话 |
| `store/chat-store-thread-review-actions.ts:201-202` | 同上（review 场景） |
| `store/chat-store-thread-creation-actions.ts:261` | `createThread` 的最后一级回退 |
| `store/chat-store-thread-send-enqueue.ts:107`、`chat-store-background-queue.ts:200`、`chat-store-thread-send-direct.ts:301` | checkpoint 的 `fallbackWorkspaceRoot` |

现在的手机端都显式传了 workspaceRoot，所以暂时没有触发。但以后任何复用这些 helper 的手机端路径，都会悄悄跑到宿主当前的项目里去。

**修复方案**
1. 新增 helper（放在 `chat-store-helpers.ts`）：

   ```ts
   /** 当前 Code 项目：以 store 为准（Remote 手机端可能是本地选择），store 为空才回落到宿主设置。 */
   export function currentCodeWorkspaceRoot(state: Pick<ChatState, 'workspaceRoot'>, settings: { workspaceRoot: string }): string {
     return normalizeWorkspaceRoot(state.workspaceRoot) || normalizeWorkspaceRoot(settings.workspaceRoot)
   }
   ```
   上表中除 `reloadUiSettings` 外的所有位置都改用它。在桌面端，store 与设置本来就一致（持久化选择），所以行为不变；而且当宿主设置里的项目已被移除时，以 store 为准反而更正确。

2. store 新增 `workspaceRootLocal: boolean`：`persist: false` 时置为 true，持久化选择或 `clearWorkspace` 时置为 false。`reloadUiSettings` 在 `workspaceRootLocal` 为 true 时**保留** store 里的 `workspaceRoot`，不用宿主值覆盖。

3. 为 `workspaceRootLocal` 补上类型和初始值（`chat-store-types.ts`、`chat-store-initial-state.ts`）。

**测试**
- 以 `persist: false` 选中 `/b`（宿主是 `/a`）后调用 `reloadUiSettings`：`workspaceRoot` 仍为 `/b`；
- 以 `persist: false` 选中 `/b` 后，在没有活跃会话时 `sendMessage`：`createThread` 收到的 workspace 是 `/b`；
- 桌面端（持久化选择）行为不变：原有测试全部通过。

### F10 会话详情 sheet 的错误处理与草稿残留

**根因**
`src/renderer/src/mobile/chat/MobileCodeThreadDetails.tsx:35-56`：
- `saveTitle` / `toggleArchive` 只有 `try/finally`、没有 `catch`，失败时是未处理的 promise rejection，界面上没有任何提示；
- `title` 草稿在关闭 sheet 后不会重置，再次打开时还停留在编辑态，显示的是上次没保存的内容。

**修复方案**
- 增加 `const [error, setError] = useState('')`，两个操作都 `catch` 住并 `setError(formatRuntimeError(cause))`，在 sheet 里用 `role="alert"` 显示；
- `useEffect(() => { if (!open) { setTitle(null); setError('') } }, [open])`；
- 归档成功后再调用 `onArchived()`（现在是基于操作前捕获的 `thread` 判断）：改成 `const archiving = thread?.archived !== true`，`await archive(...)` 成功后 `if (archiving) onArchived()`。

**测试**：新建 `MobileCodeThreadDetails.test.ts`：rename 被拒时显示错误且不抛出未处理异常；关闭后重开时输入框显示当前标题、不是编辑态；归档失败时不调用 `onArchived`。

### F11 手机端文案借用其他功能的 i18n key

**根因**
手机端用了 `projectBoardSearch`、`browserMore`、`workflowSave`、`workflowEdit`、`roomsContentRetry`、`designModeSurfaceWhiteboard`、`composerReviewChanges`、`generatedDocumentPreview` 等**其他功能专属**的 key。一旦那些功能改文案（比如把 `projectBoardSearch` 改成「搜索看板」），手机端按钮的含义就会悄悄变掉；新加的 i18n 测试只检查 key 是否存在，发现不了这种问题。另外新增的 `mobileDetailsPath` 没有被使用。

**修复方案**
1. 在 `locales/{en,zh}/common/sidebar.json`（或新建 `mobile.json`，并在 `common.ts` 里接入）新增手机端专用 key：

   | 新 key | zh | en | 替换 |
   | --- | --- | --- | --- |
   | `mobileSearch` | 搜索 | Search | `projectBoardSearch` |
   | `mobileMore` | 更多 | More | `browserMore` |
   | `mobileRetry` | 重试 | Retry | `roomsContentRetry` |
   | `mobileSave` | 保存 | Save | `workflowSave` |
   | `mobileEdit` | 编辑 | Edit | `workflowEdit` |
   | `mobilePreview` | 预览 | Preview | `generatedDocumentPreview` |
   | `mobileReview` | 审查 | Review | `composerReviewChanges` |
   | `mobileWhiteboard` | 白板 | Whiteboard | `designModeSurfaceWhiteboard` |
   | `mobileNewChat`（可选） | 新建会话 | New chat | `newChat`（通用 key，可保留） |

   已经是通用语义的 key（`newChat`、`interrupt`、`autoLabel`、`toolAttachments`、`approvalAllow` / `approvalDeny` / `approvalTitle`、`composerModel`、`cancel`、`back`、`loading`、`settings`）可以保留。
2. 删除未使用的 `mobileDetailsPath`，或者在详情 sheet 里真正展示路径（`thread.workspace`），把现在「项目」一栏改成项目名 + 路径两行。
3. i18n 测试增加一条轻量检查：`src/renderer/src/mobile/**` 里用到的 `projectBoard*`、`workflow*`、`browser*`、`designMode*` 前缀 key 视为违规（白名单形式），防止再次借用。

---

## 端到端验证方案

### 1. 自动化

| 类型 | 命令 / 文件 | 覆盖 |
| --- | --- | --- |
| main 单测 | `npx vitest run src/main/remote src/main/runtime-sse-ipc` | F1、F3（hub 部分） |
| renderer 单测 | `npx vitest run src/renderer/src/mobile src/renderer/src/sidebar-activity-lifecycle.test.ts src/renderer/src/lib` | F2、F3（transport）、F4、F5、F6、F10 |
| i18n | `npx vitest run src/renderer/src/locales` | F11 |
| kun 单测 | `cd kun && npx vitest run --root . hybrid-thread-index thread-service-list threads.test` | F7、F8 |
| 类型 / lint | `npm run typecheck`、`npx eslint` 覆盖所有改动文件 | 全部 |
| 冒烟 | `node scripts/smoke-mobile-remote-code.mjs`，**扩展**以下场景 | F1、F3、F4 |

`scripts/smoke-mobile-remote-code.mjs` 需要新增的场景（在假 bridge 里模拟）：
- 派发 `remote:stream-reconnected`：只做轻量校验，不打断流，不出现横幅；
- 派发 `remote:sender-reset`：当前会话重新订阅（`startSse` 被再次调用），Rooms 也重新订阅；
- 派发带 streamId 的 `runtime:sse-error { code: 'remote_buffer_overflow' }`：对应流重新订阅，其他流不受影响；
- 模拟 `visibilitychange`（隐藏 5 秒 / 20 秒）：请求次数符合 F4 的规则。

### 2. 真机矩阵（桌面 Kun 与手机在同一局域网；iPhone Safari 和 Android Chrome 各测一遍）

| # | 场景 | 期望 |
| --- | --- | --- |
| 1 | 会话页切到别的 App 5 秒再回来 | 不出现横幅，没有额外请求 |
| 2 | 生成回复中锁屏 30 秒 | 解锁后回复自动续上（ACK 超时 → 按流恢复） |
| 3 | 生成回复中锁屏 6 分钟（超过宽限） | 解锁后收到 `remote_client_expired`，自动恢复 |
| 4 | 锁屏 20 分钟（超过保留期） | 收到 `remote:sender-reset`，当前会话和 Rooms 都自动恢复 |
| 5 | 锁屏期间宿主终端持续大量输出 | 解锁后 Code、Rooms、运行详情都恢复；终端显示部分输出被省略 |
| 6 | 开关飞行模式 / 切换 Wi-Fi | 30 秒内推送恢复 |
| 7 | 桌面端「撤销所有 Remote 会话」 | 手机端跳到登录页，不会反复重连 |
| 8 | 项目内搜索（同时有会话在运行） | 1 秒内出结果，每次输入只有 1 次请求 |
| 9 | 手机选项目 B（宿主是 A），在设置 sheet 里改模型 | 手机端仍停留在项目 B；宿主设置仍是 A |
| 10 | 桌面最小化后 IM 任务完成（F2） | 桌面有系统通知和角标 |
| 11 | 重命名失败（断开运行时再改名） | sheet 内显示错误，控制台没有未处理异常 |

### 3. 构建注意事项

Remote 默认提供的是打包产物 `out/renderer`，iPhone Safari 只能使用打包产物。改完前端后需要重新 `npm run build`，或者重新打包安装 Kun.app，才能在手机上看到效果。只跑 `npm run dev` 时，Android Chrome 走 Vite 代理，iPhone 仍然是旧包。bridge 由 main 进程拼接三个文件（`remote-bridge-transport.js`、`remote-bridge-browser.js`、`remote-bridge.js`）后提供，改 bridge 之后同样需要重建。

---

## 待决策事项

1. **锁屏期间的终端输出**：只丢弃（加一条「部分输出已省略」提示）还是按会话保留最后 N KB？建议先丢弃并提示，实现最简单。
2. **Remote 端有运行中的工作时是否也暂停轮询**：本计划建议不暂停（与桌面 legacy 扫描一致）。如果更在意耗电，可以改成隐藏时把轮询间隔拉长到 60 秒。
3. **宽限与保留时长**：sender 宽限 5 分钟、条目保留 10 分钟。有了 F3 的 `remote:sender-reset` 之后，保留期的意义下降，可以考虑缩短到 2 分钟以减少内存占用。
4. **`workspaceRootLocal` 的生命周期**：手机刷新页面后是否恢复到上次本地选中的项目（存 sessionStorage）？当前计划是刷新后回到宿主的项目。
