# 设计稿（Design 白板）不可用问题分析与修复方案

> 分析对象：线程 `thr_487a8900392d445fa4f151cf9691b742`（"协作展示UI重新设计"），
> 模型 `gpt-6-astra`（provider `codex`，endpointFormat `responses`），设计文档 `dcee8b79`，
> 白板 `c4142088`，两个屏幕 `4d67320a`（协作 · 紧凑总览）与 `17f832d5`（协作 · 任务详情）。
>
> 证据来源：`~/.kun/data/threads/<thread>/events.jsonl`、`messages.jsonl`、`metadata.jsonl`，
> `~/.kun/data/observability/trajectory/records/*.jsonl`（仅 metadata 模式，没有请求体），
> `.kun-design/dcee8b79/*/meta.json` 与落盘 HTML，以及下文引用的源码。

---

## 1. 结论摘要

这不是某一个模型或 provider 的偶发问题。设计稿链路里有几个**确定性缺陷**，它们会叠加，任何模型都会碰到：

| # | 缺陷 | 严重度 | 结果 |
|---|---|---|---|
| D1 | 渲染端 canvas 回执被 Main 进程 IPC 白名单拦截，从未到达 Kun | P0 | 每个白板工具调用都阻塞 45s，然后以 `ok:false, unverified` 返回给模型 |
| D2 | 屏幕生成队列 drain 没有并发锁，多个屏幕的生成 turn 几乎同时下发 | P0 | 第二个屏幕被排进 Kun 队列，与第一个屏幕串线 |
| D3 | 屏幕 prompt 把**尚未生成**的兄弟屏幕当作"已存在页面"，并附上它的祈使句生成 brief | P0 | 模型为 A 屏幕的 turn 去做了 B 屏幕 |
| D4 | 屏幕 turn 的"只允许写入保留文件"只是 prompt 约束，运行时不强制 | P1 | 越界写入别的屏幕文件，没有任何拦截 |
| D5 | 空响应安全网：文案误导、不重试、重复写入两条错误 | P1 | 截图里的两条红色 `model_empty_response` |
| D6 | 屏幕生成失败后，帧永远停在 pending，没有失败态和重试入口 | P1 | 画布显示英文 "Preview generation is incomplete"，用户无从恢复 |
| D7 | 设计 turn 上下文过重、注入了无关指令 | P2 | 2 个屏幕消耗约 1.1M tokens，模型更容易偏离任务 |

在这次复现里，D1 → D2 → D3 → D4 → D5 → D6 依次触发：两个屏幕最终只有一个被写入，而且是在错误的 turn 里写入的；另一个屏幕永远停在占位页。

---

## 2. 复现时间线（UTC，2026-10-22）

| 时间 | 事件 |
|---|---|
| 06:03:37 | Code turn `turn_2c98…` 开始："请你用设计稿帮我重新设计好这个协作的展示ui" |
| 06:04:50 | 模型调用 `design_open`，返回 `queued`（`design_8622d5b34c6dc960`） |
| 06:05:01 | 渲染端发起 design_continuation turn `turn_79be…`（agentSurface=design，锁定文档 `dcee8b79`） |
| 06:07:23 | 模型调用 `design_create_screen`，一次创建两个屏幕；渲染端 06:07:23.64 已真实创建两个 HTML 帧和 `meta.json` |
| 06:07:23 → 06:08:08 | Kun 等待渲染端回执。**整整 45s 没有收到**，事件流里一条 `canvas_receipt` 都没有 |
| 06:08:08 | 回执超时，工具结果被改写成 `ok:false, unverified:true, hint: renderer receipt timed out` |
| 06:08:17 | 模型回复"目前画布回执超时，尚未确认设计稿生成完成"，turn 结束 |
| 06:08:17.965 | 渲染端为屏幕 A（紧凑总览，`4d67320a`）下发生成 turn `turn_258e…` |
| 06:08:18.157 | **190ms 后**又为屏幕 B（任务详情，`17f832d5`）下发 `turn_6497…`，此时 A 已在运行，B 被 Kun 排队（`turn_queued`） |
| 06:08:25 | A 的第一句输出："这一步制作**任务详情页**……"（reasoning 摘要："Implementing the latest request"） |
| 06:10:19 | A 把完整 HTML 写进了 **`17f832d5/v1.html`**（B 的文件），A 自己的 `4d67320a/v1.html` 仍是占位页 |
| 06:10:57 | A 结束，回复"已完成「协作 · 任务详情」"；B 出队开始执行 |
| 06:11:06 | B 的单次模型请求 HTTP 200、`stopReason=stop`、completion 22 tokens，但 text/reasoning/toolCalls 全空，触发 `model_empty_response`，turn 失败 |

落盘结果：

- `17f832d5/meta.json`：`previewStatus: "ready"`（内容由 A 写入）
- `4d67320a/meta.json`：`previewStatus: "pending"`，`v1.html` 仍是 2804 字节的 "Generating design preview" 占位页，也就是截图里的 "Preview generation is incomplete"
- `messages.jsonl` 里同一次失败有两条错误：`item_error_0253c4d2…` 和 `item_turn_6497…_error`，也就是截图里的两条红色卡片

---

## 3. 缺陷详解与修复

### D1（P0）canvas 回执被 IPC 白名单拒绝

**现象**

所有由渲染端执行的设计工具都返回 `accepted + receiptKey`：`design_create_screen`、`design_update_shapes`、`design_canvas`、`design_arrange`、`design_export_canvas`、excalidraw 系列等。Kun 在下一次模型请求前会阻塞等待回执（`CANVAS_RECEIPT_TIMEOUT_MS = 45_000`），超时后把结果改写为失败。

**证据**

- 线程事件里 `canvas_receipt` 事件数为 0；工具结果在 06:07:23 写入，06:08:08 被改写为 timeout，间隔正好 45s。
- 渲染端发送路径是 `src/renderer/src/design/canvas/canvas-receipt-sender.ts`，它调用 `rendererRuntimeClient.runtimeRequest('/v1/threads/:id/canvas-receipts', 'POST')`，错误被 `.catch(() => undefined)` 静默吞掉。
- Main 进程 `runtime:request` 用 `runtimeRequestPayloadSchema` 校验路径（`src/main/ipc/app-ipc-schemas/runtime.ts` 的 `ENDPOINTS` + `isAllowedRuntimeRequest`），白名单里**没有** `canvas-receipts`。用临时 vitest 实测：
  - `{ path: '/v1/threads/thr_1/canvas-receipts', method: 'POST' }` → `success: false, "runtime request path is not allowed"`
  - `{ path: '/v1/threads/thr_1/turns', method: 'POST' }` → `success: true`
- `git log -S"canvas-receipts" -- src/main src/shared` 为空。引入两阶段回执的提交 `ba883b60a feat(work-canvas): two-phase design tool receipts…` 加了 Kun 路由和渲染端发送，但没有加 Main 白名单。`canvas-receipt-sender.test.ts` mock 了 `runtimeRequest`，所以单测一直是绿的。

**影响**

- 每个白板工具调用至少多等 45s。
- 模型总是看到 "canvas may not have applied these operations"，于是重复操作、提前收尾，或者向用户报告"回执超时"。
- 依赖回执的 `generatedFiles`（例如 `design_export_canvas`）永远拿不到真实结果。

**修复**

1. 在 `src/shared/kun-endpoints.ts` 增加 `KUN_THREAD_CANVAS_RECEIPTS_TEMPLATE = '/v1/threads/{threadId}/canvas-receipts'`，在 `ENDPOINTS` 中加入 `compileEndpoint(KUN_THREAD_CANVAS_RECEIPTS_TEMPLATE, ['POST'])`。渲染端也改为通过该模板构造路径。
2. `sendCanvasTurnReceipt` 不再静默吞错：至少 `console.warn` 一次（带 receiptKey 和错误码），方便定位。
3. 增加边界测试 `src/main/ipc/app-ipc-schemas.canvas-receipts.test.ts`：允许 POST，拒绝 GET/PUT/DELETE，拒绝 `/canvas-receipts/extra`。
4. 增加防回归的契约测试：把渲染端所有 `runtimeRequest(` 的字面路径模板，与 `runtimeRequestPayloadSchema` 对一遍。`composer-subscription-quota-client.test.ts` 已有"走真实 IPC schema"的写法，可以复用。

---

### D2（P0）屏幕生成 drain 并发下发

**现象**

一次创建多个屏幕时，设计上要求"每个屏幕一个 follow-up turn，严格串行"（`canvas-turn-drain.ts` 的注释："the per-screen turns run strictly one at a time"）。实际两个 turn 只隔了 190ms。

**代码位置**

- `src/renderer/src/design/canvas/use-apply-shape-ops-live.ts`
  - `scheduleScreenDrain()` 在定时器触发时先把 `screenDrainTimer = null`，再 `void drainPendingScreens(...)`，异步 drain 期间**没有任何 in-flight 标记**。
  - `useChatStore.subscribe` 回调里，只要 `!currentTurnId && !busy && pendingScreens.length > 0` 就 `scheduleScreenDrain(0)`。任何 store 变化（选中帧、blocks 更新）都会再次触发。
- `src/renderer/src/design/canvas/canvas-design-replay-support.ts` 的 `takeNextReadyScreenGeneration` 同步 `shift()` 出队，然后 `await onDispatch(next)`。
- `onDispatch` → `useWorkbenchShellRuntime.tsx` 的 `onScreenCreated` → `sendDesignPrompt`（`useDesignPromptController.ts`）。它先 `await ensureDesignThreadForWorkspace(...)` 等异步步骤，之后才进入 `sendMessage`。在这段 await 窗口里，chat store 仍是 idle（`busy=false, currentTurnId=null`），第二次 drain 就会认为线程空闲，把下一个屏幕也发出去。
- 第二个发送到达时第一个 turn 已在运行，`chat-store-thread-send-enqueue.ts` 用 `enqueueIfBusy: true` 把它塞进 Kun 的持久队列。

**修复**

1. 在 hook 闭包里加 `screenDispatchInFlight`（或一个 Promise 链）。`drainPendingScreens` 进入时置位；只有在 dispatch 失败，或者**观察到本次 dispatch 对应的 turn 已经开始并结束**之后才清除。不能只看 `busy/currentTurnId`。
2. 屏幕 follow-up 发送统一带 `waitForRuntimeAdmission: true`。现在只有 `drawing.created` 时才带，这样 `onDispatch` resolve 的时刻能对应到 runtime 已经接纳。
3. drain 只认"本 hook 自己下发的 turn 已结束"作为推进条件，不认"任意 store 变化时线程刚好空闲"。
4. 测试：在 `use-apply-shape-ops-live-continuation.test.ts` 增加"`onScreenCreated` 异步延迟 300ms、期间 store 多次变化"的用例，断言两个屏幕的 `onScreenCreated` 不会重叠调用。

> 更长期的方向见 §4：把"逐屏生成"的编排从渲染端订阅回调移到 Kun 侧的显式作业里。

---

### D3（P0）兄弟屏幕清单把"待生成的屏幕"当成"已存在页面"

**现象**

A（紧凑总览）的 turn 一开始就说"这一步制作任务详情页"，然后写入了 B 的文件。

**证据**

A 的 user prompt（`messages.jsonl` 第 53 条，`turn_258e…`）在保留文件说明之后，包含：

```text
Other pages already in this project (keep ONE cohesive design system across them …):
- "协作 · 任务详情" (1280x800) → .kun-design/dcee8b79/17f832d5/v1.html (prototype href: ../17f832d5/v1.html)
  — 创建与「协作 · 紧凑总览」一致的 Kun 中文工作台交互HTML第二状态，1280x800，初始右面板显示Claude Cursor续接审查的任务详情。…
…
Read a relevant sibling page if you need to match its exact styling. Do NOT modify sibling files …
```

问题有三处：

1. B 当时只是一个 pending 占位页，并不"already in this project"。
2. 摘要取的是 `currentDesignArtifactVersion(linked).summary`，也就是 B 的**生成 brief**，是一段以"创建……"开头的祈使句。它在 prompt 里离"生成指令"很近，模型把它当成了新的任务。
3. prompt 还鼓励"读一下相关兄弟页"。模型读了两个占位文件后发现都是空的，就把"最新那条指令"当成了要做的事。

**代码位置**

- `src/renderer/src/design/design-turn-prompt/payload.ts` 的 `buildScreenManifest()`：遍历画布上所有 HTML 帧，没有过滤 `previewStatus`。
- `src/renderer/src/design/design-pages.ts` 的 `buildHtmlSiblingManifest()`：同样没有过滤。
- `src/renderer/src/design/design-turn-prompt/shared.ts` 的 `formatScreenManifestLines()`：标题文案写死为 "already in this project"。

**修复**

1. 拆成两类清单：
   - **已生成页面**：`previewStatus === 'ready'` 且文件不是占位页。保留现有格式，摘要改为生成后的设计描述，不用原始 brief。可用 `DESIGN.md` 首段，或者截断到 160 字符并去掉祈使句。
   - **同批计划中的页面**：只列 `name + 保留路径 + prototype href`，**不附 brief**，并明确写 "Planned in this batch — another turn builds it; do NOT read or write it now."
2. 测试：在 `design-turn-prompt/payload.test.ts` 增加 pending 兄弟帧的用例，断言 prompt 不包含其 brief，并包含 "do NOT read or write"。

---

### D4（P1）保留文件写入范围不受运行时约束

**现象**

A 的 prompt 写了 "Modify ONLY `.kun-design/dcee8b79/4d67320a/v1.html` and `…/DESIGN.md`"，但 A 成功调用 `write` 写入了 `17f832d5/v1.html` 和 `17f832d5/DESIGN.md`，没有被拦截。

**代码位置**

- `src/renderer/src/design/design-turn-dispatch.ts` 的 `buildDesignTurnSendOverrides()`：只有 `target === 'svg'` 时才把 `guiDesignArtifact` 传给 Kun；HTML 屏幕 turn 不带任何保留路径信息。
- Kun 侧的 `allowedWritePaths` 只在子代理或进程级 deps 上生效（`kun/src/loop/turn-context-resolver.ts`），不是按 turn 设置。

**修复**

1. 扩展 turn 契约：`guiDesignArtifact` 支持 `{ kind: 'html', artifactId, relativePath, designMdPath }`。改动顺序：先改 `kun/src/contracts/turns.ts`，再依次改 preload、main、renderer，符合 AGENTS.md 的"先 shared 契约"原则。
2. Kun 文件写工具（`write` / `edit` / `apply_patch` / `bash` 重定向等文件类工具）在 `agentSurface === 'design'` 且带 html `guiDesignArtifact` 时，拒绝写入 `.kun-design/` 下除保留 HTML 和 DESIGN.md 之外的路径。返回结构化工具错误（例如 `design_write_scope_violation`），让模型能自行纠正。
3. 增加完成门禁：参照现有 SVG completion gate（`recoverRequiredSvgCompletion`），屏幕 turn 结束前检查保留 HTML 是否以 `</html>` 结尾且不是占位页。未满足时有界续写一次，仍未满足再失败。
4. 测试：Kun 单测覆盖"写兄弟文件被拒""写保留文件通过""未写保留文件触发一次续写"。

---

### D5（P1）`model_empty_response` 处理：误导、不重试、重复两条

**现象**

截图里同一条错误出现了两次，文案让用户去"检查 provider/model 可用性"。

**证据**

- B 的模型请求：HTTP 200，`stopReason=stop`，`completionTokens=22`，`receivedTextLength=0`，没有 tool call。provider 是可用的，只是模型认为没什么可做（B 的目标文件刚被 A 写完，历史里 A 也说"已完成任务详情"）。这是 D3/D4 的下游结果，不是 provider 故障。
- 同一失败在 `messages.jsonl` 里有两条错误项：
  - `item_error_0253c4d2…`：由 `kun/src/loop/round-outcome-recovery-phase.ts` 的 `failEmptyTerminalResponse()` 用 `ids.next('item_error')` 写入
  - `item_turn_6497…_error`：同一函数先调用了 `rememberFailure()`，turn 结算时 `kun/src/services/turn-service-compaction-operations.ts` 又按 `item_${turnId}_error` 追加一条
  - 现有测试 `kun-mapper-plan.test.ts` / `chat-store-runtime-errors.test.ts` 只覆盖了 live 去重，没有覆盖"重载后从持久化 items 恢复"
- 同样的"`rememberFailure` + 自己再 `applyItem(ids.next('item_error'))`"模式，也出现在 `resolveEmptyPostToolResponse`、`advancePostToolFailureRecovery`、`failToolSuppressionRecovery`、`recoverRequiredSvgCompletion`（exhausted 分支），推测会出现同样的重复卡片。

**修复**

1. 去重：这些路径只调用 `rememberFailure()`，把错误项交给 turn 结算统一写入 `item_${turnId}_error`；或者改为直接使用这个规范 id，借助 upsert 去重。补一条 Kun 测试，断言失败 turn 的持久化错误项恰好一条。
2. 文案分流：`completionTokens > 0` 且 HTTP 200 时，换成"模型结束了回答但没有产出内容"，并在 details 里带上 usage。只有真正 0 token 或路由异常时，才提示检查 provider。
3. 设计屏幕 turn 在空响应时，先走 D4 的完成门禁，有界续写一次，再失败。

---

### D6（P1）屏幕失败后没有失败态与重试

**现象**

`4d67320a` 的 `previewStatus` 永远是 `pending`。帧上显示英文硬编码的 "Preview generation is incomplete"，没有重试按钮。

**代码位置**

- `src/renderer/src/components/design/canvas/html-frame/HtmlFramePlaceholder.tsx`：英文硬编码文案，没有 i18n，也没有操作入口。
- `src/renderer/src/components/design/canvas/html-frame/html-frame-helpers.ts` 的 `htmlFrameDrawingActive()`：`previewStatus === 'pending' && chatBusy` 就显示"绘制中"。因此只要线程在忙（哪怕在画别的屏幕），所有 pending 帧都显示为正在绘制，状态失真。
- `use-apply-shape-ops-live.ts` 的 `screenGenSeen`：一个帧在一个挂载周期内只会入队一次。生成 turn 失败或没写文件，都不会再入队；`dispatchNextPendingScreen` 的重试只覆盖"下发失败"，不覆盖"turn 失败"。

**修复**

1. 屏幕生成 turn 结束（completed/failed）后，检查保留文件：仍是占位页或不完整就把 artifact 标为 `previewStatus: 'error'`，并记录 `failedReason`（例如 `turn_failed:model_empty_response`、`not_written`）。
2. 帧占位改为 i18n 文案（"生成失败" / "生成未完成"），提供"重新生成此屏幕"按钮，复用 `onScreenCreated(shapeId, userPrompt, brief)`。
3. `htmlFrameDrawingActive` 改为只看"当前运行 turn 的保留文件是否是本帧"，不看全局 `chatBusy`。

---

### D7（P2）设计 turn 上下文过重、注入无关指令

**证据（来自 `context_snapshot` 事件与 messages）**

- 每个设计 turn 广告 **163 个工具**，工具 schema 约 **39.7k tokens**；激活技能包含 `automation`、`browser`、`canvas`。
- 注入了 ADE manager 块："When the request splits into independent pieces … create one worker per piece and dispatch them in parallel"。这和"本 turn 只写一个保留文件"直接冲突。
- 单屏 prompt 约 17.8k 字符，design_continuation prompt 约 31.8k 字符。整个流程累计约 1.1M prompt tokens，最终只生成了 1 个屏幕。

**修复**

1. `agentSurface === 'design'` 的屏幕生成 turn 使用收窄的工具白名单：read/write/edit、设计相关工具、必要的 shell 校验。不注入 ADE manager 块；技能只保留 design/canvas。
2. 屏幕 prompt 去重：craft 规则、prototype 规则在 design_continuation 和每个屏幕 turn 里重复出现，可改为稳定前缀之后的固定块。注意 AGENTS.md 的缓存前缀约束：动态内容不能进稳定前缀。

---

## 4. 架构层面的建议

当前链路是 **Code turn → `design_open` → 渲染端 design_continuation turn → `design_create_screen` → 渲染端订阅 store、逐屏下发 follow-up turn**。一个请求要跨 3 跳，其中两跳的编排依赖渲染端 hook 是否挂载，以及 store 状态是否刚好空闲。

- `useApplyShapeOpsLive` 只在 `DesignDocumentCanvasSurface` 满足 `boardArtifact && activeThreadId && documentIsActive && !readOnly && canvasRuntimeReady` 时启用。用户切换线程、关闭面板或文档未加载时，drain 不会发生（本次复现未触发，属于风险）。
- 状态分散在 hook 闭包（`pendingScreens`、`screenGenSeen`）、localStorage（design requests）、`meta.json`、Kun 线程队列四处，任意一处丢失都会卡住。

建议中期把"逐屏生成"收敛成 Kun 侧的显式作业：

1. `design_create_screen` 在 design 线程里返回"屏幕作业 id 列表"，由 Kun 持久化每个屏幕的状态（queued/running/done/failed）。
2. Kun 串行执行每个屏幕 turn，每个 turn 带 D4 的写入范围和完成门禁。渲染端只负责展示和"重试"操作。
3. 兄弟页上下文由 Kun 按作业状态生成，满足 D3 的分类。

---

## 5. 修复优先级与落地顺序

| 阶段 | 内容 | 涉及文件 |
|---|---|---|
| 1（立即） | D1 白名单 + 边界测试 + 不再静默吞错 | `src/shared/kun-endpoints.ts`、`src/main/ipc/app-ipc-schemas/runtime.ts`、`src/renderer/src/design/canvas/canvas-receipt-sender.ts`、新增 main 侧测试 |
| 1（立即） | D2 drain in-flight 锁 + `waitForRuntimeAdmission` | `use-apply-shape-ops-live.ts`、`canvas-turn-drain.ts`、`useWorkbenchShellRuntime.tsx` / `useDesignPromptController.ts` |
| 1（立即） | D3 兄弟清单分类、去掉祈使 brief | `design-turn-prompt/payload.ts`、`design-turn-prompt/shared.ts`、`design-pages.ts` |
| 2 | D5 错误项去重与文案分流 | `kun/src/loop/round-outcome-recovery-phase.ts`、`round-outcome-coordinator.ts` |
| 2 | D6 失败态 + 重试 + i18n | `html-frame/HtmlFramePlaceholder.tsx`、`html-frame-helpers.ts`、`HtmlFrameScreenOverlay.tsx`、design workspace store |
| 3 | D4 HTML 保留路径契约 + 写入守卫 + 完成门禁 | `kun/src/contracts/turns.ts`、preload/main/renderer 透传、Kun 文件工具、`round-outcome-*` |
| 3 | D7 设计 turn 工具/技能/ADE 块收窄 | Kun tool discovery / skill 解析 / ADE manager context |
| 4 | §4 屏幕作业下沉 Kun | 新的 Kun 服务与路由，渲染端改为展示端 |

阶段 1 的三项改完后，本次复现的主路径（回执超时 → 并发 → 串线）就能闭合。D5/D6 决定失败时用户能否看懂并自助恢复。

---

## 6. 验证清单

自动化：

- `npm run typecheck`
- `npx vitest run src/main/ipc/app-ipc-schemas.canvas-receipts.test.ts src/renderer/src/design/canvas src/renderer/src/design/design-turn-prompt`
- Kun：`npm run build:kun`，以及 `canvas-receipt-registry`、`round-outcome-*`、新增写入守卫的测试
- `npm run check:file-lines`（`use-apply-shape-ops-live.ts` 已 696 行，新增逻辑需要拆到 `canvas-turn-drain.ts` 等模块）

手动冒烟（同一模型、同一需求复跑）：

1. 让 Code turn 调 `design_open`，设计 pass 一次创建 2 个屏幕。
2. 事件流里应在 1s 内出现 `canvas_receipt`（status `applied`），工具结果 `ok:true`，不再有 45s 空等。
3. 两个屏幕 turn 严格串行：第二个 `turn_started` 在第一个 `turn_completed` 之后，中间没有 `turn_queued`。
4. 每个屏幕 turn 只写自己的 `v1.html` / `DESIGN.md`；故意让模型写兄弟文件时收到 `design_write_scope_violation`。
5. 两个帧的 `meta.json` 都是 `previewStatus: "ready"`。
6. 人为制造一次空响应：只出现一条错误卡片，帧变成"生成失败 · 重新生成"，点击后能重新生成成功。

---

## 7. 尚未确认的部分

- 模型请求体没有被采集（trajectory 为 `captureMode: metadata`），所以 A 串线的直接诱因来自 prompt 内容推断：prompt 中存在 B 的祈使 brief，A 的首句就是"制作任务详情页"，随后写入了 B 的文件。证据链完整，但没有请求体原文。复测时建议开启线程的 `modelRequestCaptureEnabled`。
- B 的 22 个 completion tokens 具体是什么（推测是不可见的 reasoning token）无法从 metadata 判断；即便如此，它不影响 D5 的修复方向。
- D5 中其它恢复路径是否同样产生两条错误项，是根据相同代码模式推断的，未逐一复现。
