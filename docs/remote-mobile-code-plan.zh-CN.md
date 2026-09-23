# Remote 手机 Web · Code 模式可用性修复计划

> 日期：2026-09-23　范围：先把 **Code 模式**在手机 Remote Web 上做到「能正常用」，Rooms / Work 之后按同样方法跟进。

## 0. 复现环境与结论速览

- 宿主：`/Applications/Kun.app` 0.3.10（今天 12:47 从 develop 打包安装），Remote 绑定 LAN，端口 `42659`。
- 客户端：内置浏览器模拟手机（375×812、Android Chrome UA、触控），通过 `http://192.168.91.56:42659` 访问，属于**非安全上下文**（和真手机走局域网一致）。
- 用户反馈的症状「进入后选项目，会话加载不出来」**已复现并定位根因**（见 P0-1）。
- 顺带确认了另外 2 个会直接导致 Code 模式「用不了」的 bug（P0-2 新建会话建错目录、P0-3 界面文案大量显示原始 key），以及若干体验/稳定性问题。

复现过程与关键数据：

| 步骤 | 结果 |
| --- | --- |
| 进 DeepSeek-GUI 项目 | 会话列表正常（它的会话占全局最近 100 条里的 81 条） |
| 进 KunRemoteExtend 项目 | 显示 `noSessions` + `loadMore`（均为原始 i18n key），列表为空 |
| 服务端直查 `/v1/threads?workspace=KunRemoteExtend` | 实际有 **11** 条会话 |
| 全局首屏 `/v1/threads?limit=100` 构成 | DeepSeek-GUI 81、Rooms 讨论区 15、agent 工作区 3、KunRemoteExtend 1 |
| store 中该项目分页游标 | `{ status: 'unknown', hasMore: true }` —— 从未发起过项目分页请求 |
| 手动触发 `loadMoreThreads(project)` | 立刻加载出 11 条，状态变 `complete` |

结论：**数据链路（bridge → /remote/invoke → runtime）是通的，问题在手机端没有按项目加载会话**。

---

## 1. 已确认的问题

### P0-1 选项目后会话为空（用户报告的问题）

**根因**

1. `refreshThreads()` 只拉**全局**最近 100 条（`THREAD_LIST_FIRST_PAGE_SIZE`，`src/renderer/src/store/chat-store-thread-pagination.ts:8`），不按项目拉。不常用的项目在首屏里可能 0～1 条。
2. 按项目分页的首屏要靠调用方主动触发 `loadMoreThreads(workspace)`。桌面端侧边栏有 `useSidebarWorkspaceAutoLoad`（`src/renderer/src/components/chat/sidebar-project-auto-load.ts`）：项目组展开且本地没会话、游标为 `unknown` 时自动拉第一页。
3. 手机端 `MobileCodeHome`（`src/renderer/src/mobile/screens/MobileCodeHome.tsx`）**没有这个自动加载**，只在用户点 `loadMore` 时才拉；而这个按钮文案还是原始 key，用户根本认不出来它是补救入口。
4. 进一步：手机端的会话过滤条件和桌面不一致：
   - 只按 `thread.workspace` 做等值匹配，**没有**走 `resolveProjectWorkspacePath` + worktree 注册表，所以跑在 worktree 里的会话永远不会出现在项目下；
   - 用 `agentSurface` 粗判，没有用 `isCodeThread(thread, clawChannels, writeRegistry, designRegistry)`，claw / write / design 会话可能混进来；
   - 首屏里那 1 条 KunRemoteExtend 会话也没有进 store（被 `filterThreadsForSidebar` 等过滤掉了），说明「靠全局首屏凑项目列表」这条路本身就不可靠。
5. 搜索只在已加载的会话里做本地过滤，没加载的会话搜不到。

### P0-2 项目内「新建会话」会建到对话临时目录

`MobileCodeHome` 的新建按钮调用的是 `createConversation()`，它等价于 `createThread({ conversation: true })`（`src/renderer/src/store/chat-store-thread-creation-actions.ts:410`），在 `conversationWorkspaceRoot` 下**新建一个时间戳临时目录**作为工作区，而不是当前项目目录。结果：

- 新会话的工作目录不是用户选的项目，Agent 改不到项目代码；
- 回到项目列表时这条新会话也不在该项目下。

### P0-3 手机端大量界面文案显示原始 key

手机端组件调用的 `common` 命名空间下有 **24 个 key 在 zh / en 语言包里都不存在**，界面直接显示 key：

`composerPlaceholder`、`noSessions`、`loadMore`、`search`、`more`、`retry`、`unknownError`、`attachments`、`stop`、`auto`、`model`、`composerSettings`、`approvalRequired`、`allow`、`deny`、`new`、`roomsNewChat`、`roomsContent`、`preview`、`edit`、`review`、`whiteboard`、`writeFileNotFound`、`writeAssistantTitle`

其中 Code 模式直接受影响的：项目页搜索框、空状态、加载更多、会话页输入框占位符、附件按钮、停止按钮、模型选择面板、**工具审批的「允许 / 拒绝」按钮**（审批按钮显示成 `allow` / `deny` 基本等于不可用）。

漏检原因：`src/renderer/src/locales/i18n-usage.test.ts` 用的是**显式文件白名单**，没覆盖 `src/renderer/src/mobile/**`。

### P1-4 手机切项目会改掉桌面端的「当前项目」

`MobileCodeHome.enter()` → `selectWorkspaceRoot()` → `setSettings({ workspaceRoot })`，写的是**全局设置**。实测在手机上点一下 KunRemoteExtend，桌面端设置里的 `workspaceRoot` 就被改了（测完已切回 DeepSeek-GUI）。手机只是「浏览」某个项目，不应该改宿主的当前项目。

### P1-5 会话页右上角「更多」直接跳到桌面设置页

`MobileAppShell` 里 `onDetails` / `onSettings` 都是 `chat.setRoute('settings')`，手机上会渲染整个桌面版 `SettingsView`（并且挡掉了移动端导航）。会话详情入口应该是移动端 sheet（会话信息、重命名、归档、复制路径、模型 / 模式等）。

### P1-6 请求量偏高 / 出现过突发

- 空闲时 `shared-client-state:get` 每秒 1 次（`shared-business-storage.ts` 的 `POLL_INTERVAL_MS = 1000`），手机常驻后台时耗电耗流量。
- 观测到一次突发：约 2 分钟内 `shared-client-state:get` 2090 次、`/v1/thread-activity/events` 与 `/v1/model-connections/events`（本应 25s 一次的长轮询）各 84 次。触发时浏览器面板正在改宽度 / 切前后台，**具体触发条件还没定位**，需要专门排查。
- 两个 25s 长轮询 + 一个 EventSource 会长期占住 3 个 HTTP/1.1 连接（浏览器对同一 host 上限 6 个），其余请求只剩一半的并发。

---

## 2. 代码审阅发现、尚未实测的风险

这些在本次复现里没有覆盖到（没有在真实会话里发消息），需要在 Phase 2 专门验证：

- **R1 手机锁屏 / 切后台后流式中断且不自愈（高概率）**
  - 远端客户端没有 SSE 流时，`RemoteEventHub` 60 秒后销毁它的 `RemoteClientSender`（`src/main/remote/remote-events.ts` 的 `SENDER_IDLE_GRACE_MS`）；
  - `runtime-sse-ipc.ts` 在 owner `destroyed` 时 `stopSseState`，**不会给渲染层发任何终止事件**；
  - 手机回到前台，EventSource 自动重连后拿到的是新 sender，渲染层还在等旧 streamId 的事件，表现为「发了消息没回复 / 要刷新才出来」；
  - bridge 的 `ensureEventStream()`（`src/renderer/public/remote-bridge.js`）没有 `onerror` / `onopen` 处理，渲染层无从得知「刚断线重连过」，会话过期（401）时 EventSource 直接关死，也不会跳登录页。
- **R2 缓冲溢出静默丢事件**：客户端没有流时事件最多缓冲 512 帧，超出就 `shift()` 丢最旧的，但 main 侧的 `nextSinceSeq` 已经按「已发送」前移，丢掉的增量不会再重放，时间线会缺内容。
- **R3 idle 定时器泄漏**：`RemoteEventHub.clientFor()` 清掉了 idle 定时器之后不再重新调度，只调 invoke、不开流的客户端永远不会被回收。
- **R4 会话内闭环未验证**：发送、流式、停止、工具审批、`user_input` 提问、附件上传、模型 / 模式 / 推理强度切换、归档，都还没在真实 Remote 上走通。
- **R5 iOS Safari**：WebKit 强制走打包产物（`chooseRemoteStaticSource`），非安全上下文依赖 `remote-polyfills.js`，软键盘 / `visualViewport` 行为和 Android 不同，需要真机回归。

---

## 3. 修复计划

### Phase 1（P0，目标：Code 模式能正常用）

**1.1 项目会话列表按项目加载（修 P0-1）**
- 把桌面侧边栏的「项目 → 会话」归属逻辑抽成共享的纯函数，例如在 `sidebar-project-selectors.ts` 里导出 `selectCodeProjectThreads(state, projectRoot)`：`isCodeThread` + `resolveProjectWorkspacePath` + worktree 注册表，桌面与手机共用。
- 新增 `src/renderer/src/mobile/screens/use-mobile-project-threads.ts`：
  - 进入项目时，只要该项目游标是 `unknown`（或本地为空），就立刻 `loadMoreThreads(project)`；
  - 首次加载期间显示 loading，**不再显示「暂无会话」**；
  - 列表滚动到底自动翻页（保留显式「加载更多」按钮做兜底）；
  - 下拉刷新 / 重试时先 `refreshThreads()` 再补项目页。
- 搜索：输入关键字时走服务端 `listThreadsPage({ workspace, search })`，不再只过滤已加载的数据。
- 测试：`MobileCodeHome.test.ts` 新增用例——全局首屏 0 条目标项目会话 → 自动拉项目页 → 展示；worktree 会话归到项目；claw / write 会话被排除。

**1.2 项目内新建会话落在项目目录（修 P0-2）**
- `onNewConversation` 改为 `createThread({ workspaceRoot: project, forceNew: true, agentSurface: 'code' })`，拿返回的 id 进入会话页；失败时在页面上提示错误。
- 项目列表页（未进入项目时）如果需要「新对话」入口，才用 `createConversation()`，文案上明确是「临时对话」。
- 测试：新建后 `thread.workspace === project`，且出现在该项目列表首位。

**1.3 补齐手机端 i18n（修 P0-3）**
- 优先复用已有 key（例如搜索、重试、审批按钮等在桌面组件里已有对应文案的），确实没有的再新增到 `locales/{zh,en}/common/phone-composer.json` 或新建 `mobile.json`，其他语言按 `locale-resources.test.ts` 的要求补齐。
- 把 `src/renderer/src/mobile/**` 纳入 `i18n-usage.test.ts`（改成目录扫描，或把手机端文件加进白名单），并支持 `t(cond ? 'a' : 'b')` 这种三元写法，防止再漏。
- `MobileCodeOptions` 里的模式（`auto / agent / plan`）、推理强度（`off / low / …`）也改成本地化文案。

**1.4 Phase 1 验收**
- 手机端进入任意项目（包括不在全局最近 100 条里的项目），2 秒内出现该项目的全部会话（或第一页 50 条）；
- 新建会话后，工作目录就是该项目，会话出现在项目列表中；
- Code 模式所有页面没有任何原始 key 文案。

### Phase 2（P1，目标：会话内闭环可靠）

**2.1 会话内全链路验证与修复（R4）**
在 Remote 上逐项走通并修复：发送 → 流式输出 → 停止；工具审批允许 / 拒绝；`user_input` 单选 / 多选 / 自由文本；图片与文档附件；模型 / 模式 / 推理强度切换后发送；长会话滚动与「跳到最新」；会话标题更新；运行中会话在列表上的状态标识。

**2.2 断线重连与流恢复（R1 / R2 / R3）**
- bridge：给 EventSource 加 `onopen` / `onerror`，重连成功后派发 `remote:stream-reconnected` 事件；非 200 / 会话过期时跳 `/remote/login`。
- 渲染层：收到重连事件或 `visibilitychange → visible` 时，对当前会话执行 `recoverActiveTurn()`（已有的快照 + 从 seq 续订逻辑），线程列表执行一次 `refreshThreads()`。
- main：
  - 客户端被 idle 回收前，给它名下每个 SSE 流发一个 `runtime:sse-error { code: 'remote_client_expired' }`，缓冲起来，重连后渲染层能走恢复路径；
  - 缓冲区溢出时不再静默丢帧，改为丢弃缓冲并写入一个 `runtime:sse-error { code: 'remote_buffer_overflow' }`，让渲染层重新拉快照；
  - 修 `clientFor()` 清 idle 定时器后不重新调度的问题；
  - idle 宽限期从 60s 适当拉长（例如 5 分钟），覆盖手机短暂锁屏。
- 测试：`remote-events.test.ts` 补过期 / 溢出 / 重连用例；新增渲染层「重连后恢复」单测。

**2.3 手机切项目不改宿主设置（P1-4）**
- 给 `selectWorkspaceRoot` 增加 `{ persist: false }` 选项（只切 store 内的当前项目，不写 `settings.workspaceRoot`），Remote 手机端使用该选项；或者在 `remote-invoke.ts` 的 `sanitizeRemoteInvokeArgs` 里忽略远端对 `workspaceRoot` 的写入。
- ⚠️ 需要确认产品预期：手机上选的项目是否应该同步成桌面的当前项目？**默认建议不同步**。

**2.4 会话详情改为移动端 sheet（P1-5）**
- 「更多」打开 `MobileSheet`：会话标题 / 重命名、所属项目与路径、模型 / 模式、归档、复制会话 ID；
- 设置入口给一个移动端精简页（至少能看运行时状态、切模型），完整设置提示「请在桌面端修改」，不再直接渲染桌面版 `SettingsView`。

**2.5 请求量治理（P1-6）**
- 复现并定位那次突发：分别测试 surface 在 mobile / desktop 间切换、页面隐藏 / 显示、EventSource 断开时的请求量；
- `shared-client-state` 轮询：页面隐藏时暂停，前台改为 3～5s，或者 main 在版本号变化时通过 SSE 推送；
- 两个长轮询在 `document.hidden` 时暂停，回到前台立即补一次。

### Phase 3（P2，体验与兼容）

- iOS Safari / Android Chrome 真机回归：软键盘遮挡、安全区、横屏、触控区不小于 44px、输入法组合输入；
- 项目列表：显示每个项目的会话数、最近活动时间，按最近使用排序；
- 会话列表：运行中 / 等待输入 / 失败 / 未读状态徽标（复用 `sidebarThreadActivity`）；
- 弱网 / 离线提示条，运行时离线时的只读模式；
- 之后按同样的方法把 Rooms、Work 走一遍。

---

## 4. 测试与验证方案

**单元测试**（vitest，随代码提交）
- `MobileCodeHome.test.ts`：按项目自动加载、worktree 归属、排除非 Code 会话、新建会话落在项目目录、搜索走服务端。
- `i18n-usage.test.ts`：覆盖 `src/renderer/src/mobile/**`。
- `remote-events.test.ts` / `remote-access-service.test.ts`：过期终止事件、溢出、idle 定时器、重连。

**冒烟脚本**
- 参照 `scripts/smoke-mobile-remote-layout.mjs`（目前只覆盖 Rooms）新增 `scripts/smoke-mobile-remote-code.mjs`：假 bridge 构造「全局 100+ 会话、目标项目会话全在首屏之外」的数据，驱动真实的 `MobileAppShell` 走「选项目 → 看到会话 → 进会话 → 发送 → 收到流式事件（带 batch ack）→ 审批 → 断流重连后恢复」。

**真机验收清单**（桌面 Kun + 同局域网的 iPhone Safari 与 Android Chrome）
1. 登录 → 项目列表显示全部项目；
2. 进入一个冷门项目 → 会话完整出现；
3. 新建会话 → 在项目目录下运行 `pwd` 验证工作目录；
4. 发送消息 → 流式输出 → 停止；
5. 触发一次需要审批的命令 → 允许 / 拒绝都能生效；
6. 触发 `user_input` → 手机上作答；
7. 发送一张图片附件；
8. 锁屏 2 分钟再解锁 → 正在运行的回复能继续显示，不需要刷新；
9. 全程桌面端的当前项目不被改变；
10. 空闲 5 分钟，`/remote/invoke` 请求数在预期范围内（例如每分钟不超过 30 次）。

**注意**：Remote 默认提供的是打包产物 `out/renderer`（Safari / iPhone 必须用它）。改完前端后要 `npm run build` 或重新打包安装，手机上才能看到效果；只起 `npm run dev` 时 Android Chrome 走 Vite 代理，iPhone 仍然是旧包。

---

## 5. 执行顺序与粗略工作量

| 阶段 | 内容 | 预估 |
| --- | --- | --- |
| Phase 1 | 1.1 按项目加载 + 共享选择器；1.2 新建会话；1.3 i18n + 测试补漏 | 约 1 天 |
| Phase 2 | 2.1 全链路验证；2.2 断线恢复；2.3 不改宿主设置；2.4 详情 sheet；2.5 请求量 | 约 2～3 天 |
| Phase 3 | 真机体验与 Rooms / Work 跟进 | 持续 |

建议 Phase 1 单独一个 PR（小、可快速合入，解决「用不了」），Phase 2 按 2.2（稳定性）和 2.3～2.5（体验）拆成两个 PR。
