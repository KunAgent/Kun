# 产品统计与首次任务引导

## 范围与发布状态

本改动实现桌面客户端、Runtime 最小化事件观察、Code/Room 自愿首次任务入口；2026-10-23 增加 Work 主任务观测。
独立 KunApp 提供手机自己的统计同意、前台会话及远程操作结果事件。
服务端的新接口需要独立交付；客户端遇到 404/426/501、未知协议或关闭开关会暂停上传/隐藏新引导内容，正常产品功能继续运行。
Work 扩展与 Kunserve 的兼容校验、增量迁移和独立报表一同在本地实现；没有部署或推送，也没有对生产数据库执行迁移。

## 老用户保护

- 新统计默认关闭。升级不改写模型、权限、登录态、历史任务或 initialSetupCompleted。
- 首次启动判定在默认配置/迁移前检查旧设置、兼容目录、已知 Runtime 和账户数据；不确定按 unknown 处理。
- 只有明确 fresh 的安装在原欢迎页展示可选同意项；已有用户可从设置手动开启。
- CodeTour 的 v1 seen/pending 标记保持原值；新任务路径只有点击后才请求服务端功能开关；历史账号也可主动打开。
- 登录非必需。匿名同意后使用新的随机统计安装标识，绝不使用硬件标识。
- 匿名与账号事件不回溯合并。身份切换清空待发队列并更换 epoch；不使用新账号凭据发送旧事件。
- 关闭立即停止 Main/UI 采集、取消在途请求、清空主进程待发队列并尽力撤销云端会话；Runtime 不可达时租约最多 45 秒失效，持久保留待清理标记并在本地重连后清除 Runtime 队列。清理携带旧 epoch，不能清除重新同意后的新会话。已接收数据由服务端保留策略处理。
- Native KunApp 的同意独立于电脑。切换/退出手机账号会关闭手机采集并清空队列；已登录手机可重新在隐私设置主动开启。
- Remote 浏览器不继承电脑统计同意，也无权访问新增桌面 IPC/Runtime 私有 outbox。

## 客户端数据流

UI 事件 → 限定类型 IPC → Main 独立 JSON outbox → 批量云端请求。
Runtime observer → Manager 所拥有的独立 product_analytics 文档 → Main 持久接收 → Runtime ack → 云端确认 → Main 清理。

Runtime observer 默认只做内存开关判断，不读取旧用户存储；只有同意后 Main 续租的 45 秒采集上下文有效时才工作。
observer 回调不等待磁盘/网络。原 Code/Room 观察规则保持；Work 使用独立观察器，仅接受带当前同意 epoch 标记的用户主动主回合。排除 Design、后台续跑、子代理和非 GUI 来源。
开始早于同意的回合及历史回放不补报。Runtime 重启丢失的在途开始关联不伪造；只能记录可关联的新回合。

每层队列最多 1000 条；Main 文件上限 2 MiB；7 天过期。
Main 每 15 秒尝试收集与上传，单批 50 条，HTTP 超时 5 秒，错误指数退避，遵守 Retry-After。
Runtime Main-only 端点：GET /v1/product-analytics、POST /lease、POST /ack。
服务端不可用不影响模型请求，不因统计 401/403 清除业务账号会话。

## 云端 v1 接口契约

公开 GET /api/product-experience/v1/config：

```json
{"schemaVersion":1,"policyVersion":"product-analytics-v1","collectionEnabled":false,"guidanceEnabled":false,"workAnalyticsVersion":0}
```

原计划中的 GET /api/product-experience/v1/eligibility 用于未来主动邀请判断，首版显式入口无需调用。
如后续加入主动邀请，资格应由服务端账号创建时间与固定上线日期判断，不能相信客户端的“新账号”标记。
匿名引导只能显式点击进入；没有登录前，不能判断一个新安装是否属于老账号。

POST /api/product-analytics/v1/sessions：

```json
{"schemaVersion":1,"policyVersion":"product-analytics-v1","installationId":"UUID"}
```

返回 `{sessionId, expiresAt, credential?}`；账号使用当前 Bearer，匿名返回仅限统计接口的独立 credential。
匿名后续使用 X-Kun-Analytics；不允许与 Bearer 混用。账号 user_id 必须由服务端验证得出。

POST /api/product-analytics/v1/events：`{schemaVersion:1, sessionId, events:[...]}`。
每个事件有 eventId、occurredAt、schemaVersion、surface、observation、sessionId（客户端 epoch）、appVersion、platform、name、properties。
外层 sessionId 是服务端颁发的统计会话，事件中的 sessionId 是本地采集 epoch，二者含义不同。
返回 `{acceptedEventIds: UUID[], rejected: [{eventId, code}]}`；重复已接收事件也返回 accepted。
400 类无效单条应进入 rejected，暂时性错误应使用 HTTP 429/5xx，不应永久拒绝可重试的合法事件。
DELETE /api/product-analytics/v1/sessions/{sessionId} 撤销会话，返回 204。

固定 origin 为 https://api-kun-server.com，禁用重定向与 Cookie；不把访问令牌传入 Renderer 或持久化到统计文件。
未来服务端应落实 64 KiB 请求上限、RLS、账号删除联动、匿名限流、事件去重、时间校验和 90 天原始数据保留。
当前统计设置中的保留文案依赖服务端按 policyVersion 实现；这些能力未完成前不得开启 collectionEnabled。

## 事件与报表语义

- `app_session_started`：前台用户会话；桌面以可信输入触发，手机以前台会话触发。不是一次成功任务。
- `onboarding_step`：原引导进入步骤及主动选择、跳过/准备首次任务。
- `provider_check_finished`：既有模型检查结果，不新增自动计费探测。
- `workspace_ready`：用户确实选中了目录，不含目录内容或路径。
- `account_session_ready`：桌面账号身份绑定，不能当新注册。
- `run_started/run_finished`：execution_host/runtime 观察；completed/failed/cancelled 分开。
- `result_presented`：当前界面观察到的实时非空结果；旧历史消息不补报。
- `result_action`：现有结果复制操作，不上传复制内容。
- `remote_action_finished`：手机发起操作的 accepted/unknown 请求结果。accepted 不等于电脑任务完成；网络错误也不能断言任务失败。

所有 properties 使用枚举/布尔/有界数字及不可逆 runKey 白名单；不上传正文、模型回复、代码、路径、标题、原始错误或凭据。
Code runKey 为 SHA256(threadId + ':' + turnId)，Room runKey 为 SHA256(originRunId)，仅用于关联执行与呈现。
运行时位置是 execution_host，不能据此认定用户来自桌面；手机 UI 是 mobile_native。
账号 DAU 按服务端 verified user_id 去重，不能把手机和电脑客户端数相加当人数。

保留历史 engagement/wardrobe 报表，新埋点是自愿参与样本。
关闭采集/旧版本/不完整覆盖记为未知，不记为流失；旧用户首次开启后的事件是首次观测，不是首次使用。
正常 completed 是技术终态，不等于用户目标达成；结果呈现、复制、再用另算。
使用上海时区日历日，D1/D7 仅纳入已完成观察窗口的 cohort。

## 验证

- Desktop：product-analytics 单元测试、Renderer 引导兼容测试、Runtime observer/outbox 测试。
- Native KunApp：analytics.test.ts、typecheck、check:lines、平台 JS 导出。
- 全端：未同意零上传、旧服务端退避、跨账号清理、撤销时在途请求、同意前请求不补报、字段白名单、旧引导不重置。
- 新客户端对旧服务端应继续使用原功能；手机 Relay 协议、权限和请求收据不变。

## Work 主任务扩展

- UI 入口、主动提交、提交受理、首个实际可见反馈、最终结果呈现与复制/导出分别记录。可信导航或前台输入才记录进入；启动恢复和程序跳转不当作主动进入。
- 未同意时提交参数不变；已同意的新请求复用现有 `clientRequestId` 字段，格式为 `turn_work_<epoch UUID>_<random UUID>`。排队重试保留同一个 ID，旧排队请求不补标记。
- UI 与 Runtime 的 Work `runKey` 都是 `SHA256("work:" + clientRequestId)`。只上报摘要，原始请求、会话、审批和文件标识不上传。
- Runtime 按回合 `agentSurface` 优先判断内部 `write`；只有当前租约、当前 epoch、30 秒内新启动的 GUI 主回合才关联。子代理、Room/bot、历史导入及自动继续不当作主动 Work 使用。
- 审批和补充信息分开记录；自动审批不计人工等待。`completed/failed/cancelled` 是该主执行回合的技术结果，不代表整个长期目标达成。
- 呈现使用实际 timeline 的 thread/turn、当前采集 epoch 和元素可见性；最终结果另需同回合完成证据。受理回包与 SSE 的先后顺序可以互换；旧历史和其他子线程不会借用当前任务归因。
- 结果操作只对明确关联且已经呈现的结果计采用信号。文档复制、导出、显式保存另记 `work_document_action`，自动保存不计，不冒充 AI 结果采用。
- 原 Code/Room 的 `result_action` 仍为 `copy|continue`。KunApp 本次不新增 Work 采集，原手机统计保持兼容。

### 新旧版本与关闭行为

服务端 `workAnalyticsVersion` 缺失或为 `0` 时，Main 保留有限的 Work 队列，但只上传原 Code/Room 事件；Work 排在队首不会阻塞它们。声明 `1` 后才上传 Work。
本地采集仍须明确同意；队列沿用 1000 条、2 MiB、7 天限制。服务端能力关闭不是远程撤回本地同意，用户关闭统计才会停采和清队列。

Main 向 Runtime 租约声明 `workAnalyticsVersion:1`。旧 Main 未声明时，新 Runtime 不生成或返回 Work 事件。同 epoch 降级会移除 Work 队列并保留 Code/Room。
新 Main 只有收到旧 Runtime 对这个新增字段的明确 `400/unrecognized_keys` 拒绝时才回退旧租约；网络故障、503 和其他错误不会触发降级清队列。
退出、切换账号和重新同意都会更换 epoch，迟到的 UI 动作和 Runtime 终态不能进入新账号队列。

持久化也兼容旧版回退：Main 原状态文件保持旧严格结构及 Code/Room 事件，Work 写入独立 `.work-v1.json` 附属文件；只有主状态仍同意且 epoch、账号和安装标识相同时才能合并读取。
Runtime 的旧 `events` 数组只保存旧事件，Work 保存在旧解析器会忽略的扩展字段，对外 API 仍返回协商后的统一队列。
回退旧版可能丢弃未上传的 Work 观测，但不会因 Work 枚举导致旧队列解析失败或重置原统计同意。关闭/换账号后再升级不会恢复旧 Work 队列。

Work 默认服务端门禁关闭。上线需先审阅缺失迁移、维护清理和真实链路，再依次打开数据库 Work 位和 Worker Work 开关；本次不执行这些远端操作。
数据只代表同意并上报的样本；首次观测不是首次使用，未观测再次使用不能直接称为流失。服务端独立报表区分 D1、D7 和第 1–7 天任一天再使用。

### 本地验证入口

- `npx vitest run src/main/product-analytics`：旧配置/Runtime、Work 队列不阻塞旧事件、临时故障不降级、账号切换及撤回。
- 在 `kun/` 运行 `npx vitest run src/analytics/observer.test.ts src/analytics/work-observer.test.ts`：真实 SQLite 租约、Code/Room 回归、Work 根任务及等待去重。
- Renderer 的 `product-analytics/work*.test.ts`、`lifecycle-work.test.ts`，Work composer 和队列、文档操作测试：默认关闭不改发送、短任务乱序、可见性、完成证据和显式保存。
- Kunserve 的 `tests/runtime/analytics/work-clients.test.mjs`：真实桌面统计模块 → Runtime SQLite → Main → 编译 Worker → 临时 PostgreSQL；Auth/PostgREST 使用本地适配器，所有外部请求禁止。

这些是模块、编译和本地集成验证；不等同于完整安装包升级或真机验收。


## Review 后的兼容修复

- 账号状态订阅只在身份或统计 epoch 真正变化时清空 Work 关联。同一账号的令牌/资料刷新及暂时网络错误保留正在执行的任务。默认关闭时不会由统计模块主动读取账号。
- 提交回执从实际发送路径报告：明确接受为 accepted、响应丢失为 unknown、确定拒绝为 failed。旧 sendMessage 布尔返回值只作兜底，不能覆盖已知回执。unknown 后恢复确认可补记 accepted，仍按同一 runKey 去重；确定结果不会降级。
- 用户编辑重发与手动批量论文解读补齐入口。批量中每个真正提交的论文主回合计一个任务，跳过项不计。点击时冻结同意 epoch，异步 rewind/文档准备期间切换账号或开启同意都不会将旧操作归给新账号。
- 新增同账号刷新、身份切换、旧响应迟到、未知回执、真实 ChatStore 重试、编辑重发和批量论文入口测试；无同意时原发送参数及业务结果保持不变。
- 全量检查使用本次进程的 `NODE_OPTIONS=--max-old-space-size=8192`，不改应用运行参数或用户设置。类型检查与完整构建需分别返回成功，专项测试不能替代这两项结果。


本轮最终验收：完整 `npm run typecheck` 已通过（检查进程使用 8 GB 堆）；同一工作区的完整 `npm run build` 已完成，已确认本次修复文件早于构建启动，并复核最终产物中的 Work 回执逻辑。生产依赖检查和沙箱 Preload 检查再次通过。构建仍提示设置模块循环依赖和大 chunk，安装包升级/真机验收未包含在本轮结果中。所有改动保持本地，未推送或部署。
