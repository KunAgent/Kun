# Kun 客户端持有单运行时方案

本文记录 Kun 桌面应用和独立 TUI 如何使用同一套 Kun 协议与持久化数据，
但各自持有本次应用会话的完整服务进程。GUI 只保留一个 agent，唯一
ID 是 `kun`；GUI、TUI、脚本、扩展和连接手机都通过同一条 `kun serve`
HTTP/SSE 边界工作。同一规范化 `dataDir` 在所有 runtime flavor 之间只有一个
应用所有者：谁启动 Manager、Runtime 和工作进程，谁负责在退出时关闭整套服务。
主窗口关闭即退出应用。对话、设置、记忆和用量继续由 Service Manager 持久化，
后续客户端顺序打开时读取原址历史。历史运行时、
旧绘画/设计 starter、运行时诊断面板、agent 切换都不再是产品表面。

Graph 编排、自进化项目 Agent、恢复与治理仍运行在同一个 Kun 边界内，完整设计与
运维说明见 [`docs/graph-mode.md`](./graph-mode.md)。

Work 工作区可以按线程挂载为 Code 的只读、无向量结构知识库。索引、工具、权限边界
与检索流程见 [`docs/knowledge-bases.md`](./knowledge-bases.md)。知识库挂载不会扩大
普通文件工具或 sandbox 的可写根。

GUI Code 项目可以把附加目录挂到主项目上（侧边栏「添加目录到项目」），写入该项目线程的
`additionalWorkspaces`。附加目录不是新的侧边栏项目，也不是知识库。`git_inspect`、`/review`、
plan worktree、bash 默认 cwd 和 `.kun/project.json` 仍只跟随主目录；文件工具用绝对路径访问附加根。

长期记忆使用“原子 JSON 标准数据 + 可重建 SQLite FTS5 投影”。检索必须先做作用域和生命周期
过滤，记忆只能作为动态、不可信的 `reference` 证据，不能进入稳定 system 前缀或获得指令权限。
数据布局、迁移、降级与验证见 [`docs/memory-foundation.md`](./memory-foundation.md)。
反馈账本是独立的、默认关闭的本地审计投影：`retrieved` 只记录实际注入，`confirmed` 只接受
显式用户动作，`corrected` 创建同作用域的新版本并保留 `supersedes` 链。它不保存查询、正文、
模型输出、凭据或本机路径，也不参与当前 lexical/FTS5 生产排序；离线候选若未通过预注册门禁，
不得添加隐藏权重或 dormant flag。详见记忆基础文档的 Feedback ledger 章节。

## 客户端能力边界

每个 turn 持久化发起端 `clientSurface`，取值为 `gui`、`tui`、`cli`、
`api`、`im` 或 `extension`。自动续跑、后台任务和子代理必须继承来源，
不能根据“最近连接的是 GUI 还是 TUI”修改进程全局状态。

- `gui` 类型的 Tool Provider 只用于真正依赖桌面工作台的能力，例如
  Design Canvas 和 Computer Use；非 GUI turn 在工具发现和执行两层都
  必须拒绝这些 Provider。
- goal、todo、plan、Skill、MCP、附件、审批、结构化用户输入和 subagent
  都属于运行时能力，GUI/TUI 只负责各自的呈现，不应被误分类为 GUI 工具。
- 稳定 system prompt 必须保持客户端中立，以便共享缓存前缀；当前客户端、
  可用交互和禁止假设的界面能力，通过每个 turn 的动态 context 注入。
- GUI、TUI、CLI、订阅 SDK 和 HTTP 模型路径必须使用同一条能力过滤规则，
  不能只在某个前端隐藏菜单。
- 桌面 Rooms 私聊与 Code 是同一 Kun Agent 的不同呈现入口：在模型、权限、工作区和任务阶段相同的前提下，
  通用工具发现、审批、子代理、目标续跑、结构化结果与文件交付必须等价。Rooms 可增加成员/任务协议工具，
  但不得维护一份需要逐项同步的通用工具白名单。群聊 coordination/discussion/review 仍按其阶段保持只读；
  已授权 execution 继承 Code 的通用执行能力和同一 sandbox/approval 上限。
- 订阅 SDK 只有在声明并实际使用 Kun tool bridge、原生工具拦截、外部审批和 scoped workspace 时才能进入 Rooms。
  Claude Agent SDK 的房间调用禁用原生工具，统一经过 LocalToolHost；Cursor SDK 尚无原生工具拦截入口，
  与 `kunTools: false` 的 Antigravity 一样保持禁用，不能仅因存在工具桥接就宣称等价。
- Rooms 的后台子代理、Shell、目标和重启 continuation 由共享 coordinator 提供明确 source turn，
  经 RoomRuntime 校验原请求、权限快照、workspace/epoch 和取消状态后，先持久化 request，再通过原房间队列执行。
  不扫描历史线程接管未知 turn；同根后台通知可连续交付，但新用户请求或权限变更会使旧通知失效。
  历史 run inspector 永远只读，不得因查看历史重新执行工具。
- GUI 结构化结果使用 Code 的 canonical mapper/renderer（chart、visualization、generatedFiles）；
  文件引用来自成功的结构化 tool result，并验证文件存在及 canonical path 在工作区内，不能从模型文字或目录时间戳猜交付物。
- Excalidraw apply 不会先把旧的本地草稿写回磁盘。保存带读取版本，冲突时保留草稿并提示保存副本后重载；
  Claude bridge 的 accepted/applied 使用同一个 SDK callId，回执等待直到最终结果持久化完成。

## 目标边界

```text
Renderer (React + Zustand)
  Code（含 Design 任务）/ Work / Connect phone UI
        |
        | window.kunGui.runtimeRequest(path, method, body)
        | window.kunGui.startSse(threadId, sinceSeq)
        v
Preload IPC bridge
        |
        v
Main process
  DesktopProcessStack -> owned Service Manager
  RuntimeHost -> kunRuntimeAdapter -> owned Runtime
  session / generation / admission / ordered shutdown
        |
        v
GUI-owned kun serve (TypeScript package)
  /health
  /v1/threads
  /v1/threads/{id}/turns
  /v1/threads/{id}/events
  /v1/threads/{id}/fork
  /v1/sessions/{id}/resume-thread
  /v1/approvals/{id}
  /v1/user-inputs/{id}
  /v1/usage
  /v1/workspace/status

Default TUI process
        |
        | owns/stops its Service Manager and exact Runtime
        v
TUI-owned kun serve

GUI/TUI-owned Runtime
        |
        v
Application-owned Service Manager
  election / fencing / canonical persisted data
  closes after Runtime and desktop data consumers
```

这个边界采用本地 HTTP 服务架构：GUI 不直接嵌 agent loop，不通过
stdio/RPC 混跑多个状态机，只把 `kun serve` 当成稳定协议。Kun 内部使用
cache-first loop：immutable prefix、append-only log、bounded LRU/TTL cache、
inflight cleanup、steering queue、context compaction、usage/cache telemetry。

## 应用会话持有的生命周期

- `DesktopProcessStack` 统一持有 GUI 的 Manager、启动代次和退出状态。GUI
  在 `autoStart` 开启时启动受监督的 Runtime，只向精确 owned 实例发送请求。
  `autoStart: false` 只关闭 Runtime 自动启动；GUI 数据服务使用的 Manager
  仍属于本次应用，不能在 GUI 退出后常驻。
- 主窗口关闭、平台 Quit、更新安装和数据搬迁退出进入同一 quit barrier。
  macOS 不保留关闭主窗口后的无窗口驻留。旧 `ask` / `tray` / `closeToTray`
  设置迁移为 `closeAction: quit` / `closeToTray: false`。普通最小化、mini
  模式切换和辅助窗口关闭保持局部行为；mini 模式下关闭主窗口仍退出应用。
- 退出先同步禁止新工作、恢复和重启，再 flush GUI 修改、撤销 GUI 工具授权、
  停止调度/手机入口并 drain Main/Runtime 的数据消费者。每个资源独立收尾；
  单项失败不能跳过其他资源。消费者退出后才关闭 Manager 的队列、存储和端口。
  共享截止时间必须给消费者升级终止、Manager 落盘和最后的 guard 回收留出预算。
- 退出完成以实际进程死亡为准，不能用 shutdown accepted、已发 TERM/KILL 或
  stopped 标志替代。清理仅删除匹配自身 session/instance/generation 的登记。
  活跃 writer 或执行进程尚未退出时保留所有权并记录失败，避免另一个实例抢占。
- POSIX 受管启动使用独立进程组、执行前登记 gate 和独立 owner-loss guard；
  Windows native launcher 先创建 suspended 子进程、纳入 Job Object 再恢复执行。
  PTY 使用同一所有权工具，支持等待 shell 后台 job 和包装器的后代退出；默认
  session daemon、LSP、MCP 等也必须等待整棵受管树，不因直接 child 先退就
  取消后续回收。外部浏览器、编辑器和远程服务只断开 Kun 的连接。
- 进程组及后代轮询不等价于能阻挡任意快速 `setsid` / double-fork 的 OS 沙箱。
  受支持适配器、父强杀场景和各平台打包产物需要真实进程证据；未验证的平台与
  不能纳管的特殊脱离方式必须保留为明确限制，不能由 mock 或单平台测试推断。
- 默认 TUI 与前台 serve 自行 bootstrap 时持有完整 stack，并在退出、信号和
  初始化失败的 finally 中按先 Runtime 后 Manager 的顺序清理。`--url` 和
  `--no-start` 仅连接外部服务，不能停止或延长目标 owner 的生命周期。
- 同一 canonical `dataDir`、settingsPath 已有 live/starting 应用 session 时，
  第二个正常 GUI/TUI 返回 ownership conflict，不能 attach、steal 或 silent kill。
  production/development 不能共享同一数据 owner；并行实例必须显式隔离
  dataDir、Manager controlDir 和 settingsPath，不能自动换历史目录。
- GUI Runtime 重启只替换本次 Runtime，Manager 保持本次 session。Manager
  崩溃恢复由应用 owner 决定：先停旧 Runtime 与消费者，再启动下一 generation
  并统一重绑。app-owned Runtime 不能因 Manager 断连自行 ensure 或 re-election。
- 旧版常驻实例只有在认证身份、规范化目录、原子冻结新接入和空闲状态均可证明时
  才允许退休。discovery、PID、endpoint、owner 或 Manager registration 存在歧义，
  或旧协议不能证明无活跃外部工作时，必须停止接管并提示关闭旧应用。同版本
  Manager 通过 `/v1/manager/retire-idle` 原子退休；协议或 capability 不兼容的
  旧 Manager 由启动流程自动执行同一套验证空闲退休：在 `/health` 与
  `/v1/manager/status` 上认证记录身份，要求规范化 dataDir/settingsPath 一致、
  无仍活着的 appOwner 且无仍活着的 Runtime slot，再经 instanceId 围栏的
  `/v1/manager/shutdown` 退出并确认进程真实退出。已用同一套进程身份验证确认
  死亡的 owner / slot 视为空闲。任何一步验证失败都 fail closed，保留旧进程并提示
  手动处理。确认旧客户端
  已关闭后，可在匹配的 `KUN_MANAGER_CONTROL_DIR` / `KUN_MANAGER_SETTINGS_PATH`
  下显式运行 `kun manager retire --data-dir <旧目录>` 作为手动兜底；该命令拒绝
  仍活着的 app-owned Manager 或 live Runtime slot。
- GUI 关闭后手机连接、定时执行和本地后台任务停止；已有任务定义、会话、配置、
  记忆和用量仍保存在原址。重开沿用已有到期策略，不重复派发已完成任务。回滚前
  先退出新版整套服务并确认 writer 释放，再打开旧版本，不回滚或删除业务历史。

## 缓存命中优化

Kun 的缓存命中率要按 provider 原生 usage 字段优先计算和优化：

- 模型 client 优先解析 provider 原生
  `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`。只有原生字段缺失
  时，才退回 `prompt_tokens_details.cached_tokens`、`cache_read_input_tokens`
  等兼容字段。
- cache hit rate 使用 `hit / (hit + miss)`，不使用
  `hit / prompt_tokens`。provider 原生 miss 不一定等于 `prompt_tokens - hit`。
- `kun/src/prompt/kun-system-prompt.ts` 是稳定前缀。它只放长期
  不变的 Kun 运行契约，不能放 workspace、时间戳、文件片段、选中文本、
  用户动态信息或一次性工具结果。
- `ImmutablePrefix` 在每次 model step 前调用 `verifyImmutablePrefix()`。
  如果有人绕过 `setSystemPrompt` / `setTools` / `setFewShots` 直接改 prefix，
  开发和测试期会立即暴露 fingerprint drift，而不是悄悄牺牲缓存。
- few-shot fingerprint 只计算真正会发给模型的内容，不计算 item id、turn id、
  thread id、时间戳等 GUI/存储层动态字段。
- 工具 schema 在发送到模型前 canonical sort，避免同一工具集合因为顺序或
  schema key 顺序变化造成 prefix churn。
- 每个 turn 会持久化 canonical tool catalog fingerprint 和 tool count；同一
  scope 下工具定义漂移时会标记 `toolCatalogDrift`，便于排查 cache miss。
- 历史消息发送给上游模型前会做共享的 model-history repair：孤儿
  `tool_result` 不发，缺少对应 result 的 `tool_call` 不发；同一次响应里的
  多个 tool call 会重组为一个合法 assistant `tool_calls` 消息，避免
  400/retry 造成额外延迟和缓存浪费。
- 同一模型回合里连续的 built-in 只读工具 `read` / `grep` / `find` / `ls`
  会小批量并发执行，但 `tool_result` 仍按 call 顺序写入，减少等待时间的同时
  不让动态历史随完成顺序抖动。
- Serve runtime 会从 persisted usage event 恢复累计 cache hit/miss counters，
  重启或 resume 后 runtime usage 面板不重新从 0 计算。
- 动态上下文必须追加在稳定前缀之后。compaction、resume、fork、plan context
  也不得改写稳定系统前缀。
- 普通 Code 与 Design 回合共享同一个 Agent 缓存分区和同一份工作台工具 schema 并集；
  模式规则、Design profile 与画布快照只作为 append-only `model_context` 追加在历史末尾。
  Code / Design 模式切换不得改变 immutable prefix；计划 Worktree 的分支、路径、脏文件数和
  Markdown 快照也只允许进入当次 user input。
工具执行仍按当前回合的真实 surface / canvas 状态重新校验，所以稳定 schema 不会扩大执行权限。
  Plan、Graph 与专用 SVG 回合属于真实能力阶段，继续使用独立分区和受限工具目录。

实验室中的“自动模式（计划 + 构建）”只是一层 Renderer 编排，不新增 Kun mode：用户请求先以
`plan` 回合生成绑定 workspace/thread/path 的 `create_plan` 结果，只有精确匹配后才以普通
Direct `agent` 回合构建，或复用现有一次性定时任务。Renderer 持久化有界 intent，并用稳定
request id、计划身份和定时任务指纹处理任务切换与重启恢复；无法证明安全时进入
`needs_attention`，不得降级执行。自动模式的 worktree 默认值独立于手动计划，但最终仍复用
同一套 `preparePlanBuild` 和 Agent 管理的 worktree prompt。Graph 不参与此模式，所有选择和
恢复事实都留在动态 GUI 状态中，不写入 Kun config 或 immutable prefix。
- Work turn 按 `agentSurface: write` 追加稳定的 Work mode system instruction；Renderer
  持久化的用户正文只保留用户原话。当前资源、精确选区、检索/Office 摘录和白板快照
  通过有界 `composerContexts` 引用随 turn 传入，不再把工作区、工具手册或画布规则拼进
  可见 user message。稳定的 ShapeOp 字段契约属于 canvas tool schema；Work 白板引用优先
  保留选中对象和可见文字，并使用 renderer 的规范 `textContent` 字段。Renderer 对已完成
  Work turn 的 canvas tool result 做 keyed durable replay，覆盖画布加载与 turn 结束竞态。
- 自动压缩同时考虑输入压力和请求总预算：压缩触发不仅比较历史/请求输入与
  soft/hard 输入阈值，还会把压缩预留（有界的普通输出预留，默认 32768）计入
  `input + output` 总预算，并与发送前硬上限（上下文窗口的 85% 或模型
  profile 的 hard threshold）对齐。这样输入尚未达到软阈值、但加上压缩预留
  已经突破发送上限时，会在发送前强制压缩，而不是在发送校验处直接失败。
  压缩预留与真正发送的 `max_tokens` 是两个独立的值：预留保持有界，避免模型
  catalog 把整个上下文窗口当作输出上限（例如 500k）时每次请求都触发压缩；
  发送值则采用用户配置的模型输出上限（`maxOutputTokens`），仅按硬上限的剩余
  容量夹紧，因此设置里调大「最大输出」会真正生效。
- 最终请求只允许一次启发式兜底压缩：重新构造（图片/浏览器转发、token
  economy、history hygiene）后的精确请求若仍超出 `input + output` 上限，
  会基于最新持久化历史再做一次确定性启发式压缩（不调用 summary 模型、不
  重复预算 reservation）并重建请求；第二次仍超限才精确失败。任何路径都
  不会无限循环压缩、递归重建或把超限请求发往供应商。

冷启动第一轮可能仍然低或为 0，因为服务端还没有同一前缀可读；热起来后应稳定
超过 90%。2026-06-02 的真实 Kun 临时线程验证：

- 12 轮短消息：去掉冷启动后的热命中 `94.7%`，最新一轮 `93.6%`。
- 同一稳定前缀热身后 24 轮短消息：整体含冷启动 `95.2%`，最新一轮 `98.1%`。

优化前已经持久化的旧 usage 事件不会被事后改写，因为当时没有保存
provider 原生缓存字段；这些历史数据只能作为旧实现的证据，不能证明新实现仍然低命中。

## 窗口式上下文（实验性）

默认关闭的独立开关 `agents.kun.contextCompaction.windowModeEnabled`（默认 `false`），
在设置页 实验室 → 窗口式上下文 显示。开启后模型
可以感知当前窗口剩余容量、保存工作笔记并通过 `new_context` 切换上下文窗口，旧对话保留
完整可见时间线并按需检索；关闭后沿用现有摘要压缩，全部摘要参数（摘要模型、阈值、尾部
预算）原样保留，旧配置无需迁移。

- 模式在 turn admission 时冻结：热更新只影响之后接纳的 turn，进行中的 turn 保持进入时
  的模式。自动续跑和子代理线程继承父线程最后接受的模式，但各自持有独立窗口状态和数据。
- 预算是当前请求窗口，不是累计任务用量：窗口开始时给出窗口编号和非负剩余容量，
  25/50/75% 使用率各至多提示一次，一轮跨多个阈值只发送当前最高阈值提示并把较低阈值
  标记为已覆盖。剩余容量 = 模型 profile 有效容量（无 profile 时按有界兜底容量）减去
  完整请求估算（system、tools、动态 context、附件、新输入、输出预留和已发提示本身）；
  provider 最近一次同窗口实际用量只作读数校准，不使用跨窗口累计账单 token，也不重置
  既有任务预算或 cache usage。immutable system prefix 不变，窗口编号和预算上下文只追加
  在稳定前缀之后；窗口或模型切换时按新窗口、新容量重新计算。
- `new_context({})` 是当前 agent 的专属控制工具。工具批次预检查发现它与其他调用混用时，
  整批在执行任何副作用前拒绝，并要求模型单独发起换窗；存在未完成的工具、审批或用户
  输入请求时不提交换窗。换窗顺序固定：保存原始历史 → 建立持久边界 → CAS 原子提交
  检查点 → 发送 SSE → 清理旧请求压力/read tracker → 用权威运行时上下文和有界历史/笔记
  指针重建初始上下文 → 同一 turn 继续。同一 operation 重放只返回已提交结果；上一次换窗
  之后没有普通模型/工具工作进展时再次换窗会被拒绝。
- 所有自动压缩入口（自动预检、发送边界兜底、内存压力清扫、provider overflow 恢复）都
  经过同一个策略协调器分派。窗口模式下软阈值只发去重的预算提示，硬阈值或
  `输入 + 输出预留` 超限时执行恰好一次确定性的无摘要换窗，然后由调用方重建请求；
  绝不隐式调用摘要模型降级。硬容量口径（profile hard threshold 或容量的 85%）和
  「只有一次启发式兜底重建」的 overflow 规则不变；新窗口初始上下文本身加输出预留仍
  放不下、或 overflow 恢复再次失败时，仅以 `unrecoverable` 结果让当前 turn 以可操作
  错误失败，不反复清窗、不重放采样。
- 换窗提交版本化的 `context_window` item/event：窗口 id、前一窗口、原因
  （`model` / `pressure` / `overflow` / `manual-summary`）、源历史 revision、切分位置、
  初始化引用和幂等 operation id。重启或 resume 从最后已提交边界恢复一次，不重复换窗；
  fork 复制分叉点的可见历史、边界和该时点笔记快照到新线程，之后互相独立；归档保持
  可恢复；删除线程按现有生命周期级联移除窗口索引、笔记版本和专用历史数据。GUI 经
  通用 SSE 把该事件投影成时间线上的「已切换上下文窗口」标记：与摘要压缩区分显示，
  不隐藏原始消息、不产生新任务、不恢复任何已删除的运行时面板。手动 `/compact` 在窗口
  模式下仍是摘要压缩，并登记为 `manual-summary` 类型的窗口边界，下一请求按边界重新
  初始化预算。
- 历史和笔记由本地 Service Manager 拥有的标准数据承载，窗口索引只记录 item 范围并复用
  标准对话数据，不以 events.jsonl 作为唯一历史源；分页读取和检索用有界扫描，不把全部
  窗口加载成常驻数组。工具使用扁平名称（`history_list_windows` / `history_list_items` /
  `history_read_item` / `history_search_contents` 和 `notes_list_files_by_prefix` /
  `notes_read_file` / `notes_search_contents` / `notes_append_to_file` /
  `notes_write_file`），身份取自可信执行上下文，参数不能指定其他线程。笔记是线程私有
  逻辑路径，不是 workspace 文件：拒绝绝对路径、`..`、NUL 和越界路径；写入带 revision
  CAS，追加带 operation id 幂等。限额：单次读写文本最多 16 KiB UTF-8，单文件 256 KiB，
  每线程最多 100 个文件、共 2 MiB；列表每页默认 20、最多 100；检索 query 最多 1024
  字符；工具输出同时受 16 KiB 和 min(现有工具 token 上限, 4096) 限制，返回结构化
  truncated/cursor。笔记不会自动进入长期记忆，也不改变长期记忆的现有生命周期。
- 边界与回退：不做向量检索，不接入 Codex 后端或私有认证；无法执行所需工具的模型路由
  在 turn admission 直接失败（报告不支持的能力），不会清上下文或静默改策略，摘要模式
  仍可正常使用。关闭开关是功能回退路径：从最后有效边界起继续使用摘要策略，不展开全部
  旧历史，已提交的窗口数据和全部历史读取能力保留。注意降级 caveat：旧二进制不认识新
  item/数据时不应直接读取新数据；二进制回滚需要先做好数据备份或兼容导出。

## Subagent 召回与派发

子代理的独立模型供应商发生请求、认证、额度、限流、网络或可用性故障时，宿主最多自动
回退一次，使用派发时主会话实际选中的 provider/model/account，并继承主会话的推理强度
和服务等级。恢复请求会更新该主会话快照；已经回退的子代理不会再次循环回退。回退继续
同一 child thread，保留已有工具结果和证据，分别结算两条路由的用量，并持久化安全的
`providerFallback` 原因和路由信息。原 profile 设置保持不变。普通和 Fast Context 子代理
共用此机制；Fast Context 仍只开放 grep/glob/read。权限边界、用户停止、运行时故障、
步数/时长上限和工具错误不会触发供应商回退；主会话路由缺失或不在允许范围时原样失败。

Service Manager 短暂断连时，同一认证实例上的读取请求（包括 POST 数据读取）最多尝试
三次，所有尝试共享原超时和取消信号。响应体中途断开也受此规则保护。写请求只有在连接
被拒绝、确认尚未收到响应时才允许重试；不重放可能已经落盘的写入，不盲目更换 Manager
实例。持久化不可用导致回合异常退出时，仍释放本地执行占用与租约心跳，由 Manager 的
既有租约恢复流程核对持久化状态。GUI 将此类故障显示为本地数据服务断连。

`delegate_task` 是创建普通 child run 的唯一模型入口，`list_subagent_profiles` 是主代理专用的
只读发现工具。`fast_context` 是例外的 host-owned 全局只读检索能力：支持 Kun ToolHost
的普通 agent、subagent 和 Graph Worker 都可以启动它的受管 retrieval child，但这不会
开放普通 child fan-out。开启“使用现有代理”时，发现结果只按页返回当前 workspace 和 product
surface 的有效 profile；`delegate_task` 只公开可选 `profile`，省略时由 Kun 在有效
目录中自动路由。该模式不向模型公开 `custom_agent`，宿主也会拒绝旧客户端或手工请求
携带的该字段。关闭该开关时不读取或返回注入目录，发现结果只描述一次性 custom
能力，且 `delegate_task` 必须提供 `custom_agent`。
动态目录只出现在工具结果中，不写入稳定 system prompt 或工具 schema。

可信的内置、GUI 配置和工作区 `.kun/agents/*.md` 目标统一成独立 agent profile
检索集合，不再存在 skill worker。仓库可编辑的
`.kun/agents/*.md` 进入自动 BM25/LLM 召回（仅索引 id/name/description，不索引
body），也可按精确 ID 显式选择，并出现在设置页与工作台右侧子代理面板（带
「自定义」标签；定义来自 markdown，面板内只读）。未写 `toolPolicy` 时默认只读；显式
`toolPolicy: inherit` 时可在父能力快照内使用写工具。`omit_base_prompt: true`
时 child 只用 role prompt，不再 prepend Kun base。宿主仍强制禁用 Skills、
屏蔽 model/provider/reasoning 覆盖，并阻止嵌套 `delegate_task` /
`generate_subagent`。`fast_context` 在普通 profile allowlist 收窄后由宿主统一补入，
但父 capability snapshot、显式 tool/provider deny 和 Lab 总开关仍优先。它的内部 child
只获得 `grep` / `glob` / `read` 和继承的 read scope；嵌套调用借用当前 subagent 的
全局并发位，同时仍受独立 Fast Context lane 串行约束。provider-native runtime 若声明
`kunTools: false`（当前 Antigravity CLI）则整个回合都没有 Kun 独占工具，不会静默换模型。

Subagent 目录按产品 surface 分层。`shared` 是 Code、Work、Design 强制继承的
基础池，其余 profile 可以属于一个或多个 `code` / `write` / `design` surface；
空 surface 列表表示不参与派发。Renderer 在每个 turn 持久化 `agentSurface`，旧 turn
缺失时按 Code 兼容。自动 BM25、LLM Top-5 判断、生成器样例选择和显式 profile
解析都只能看到“shared + 当前 surface”，跨模式显式调用会被宿主拒绝。child-run
同时记录 surface，确保历史派发可解释、可复现。

设置页以“基础 / Code / 写作 / 设计”配置同一份 profile 定义，不复制 Agent；搜索和
分类后按 12 条分页。工作台侧栏不分页，只展示当前 surface 的有效集合。内置
`general` 始终属于 shared，作为稳定兜底；旧自定义 profile 没有 surface 字段时按
shared 读取，保持升级前的全局可用语义。

内置目录共 45 个角色，其中 8 个中文本地化核心角色标记为基础代理并默认启用；其余
25 个 agent-skills 角色、6 个 Work 和 6 个 Design 专属角色默认不分配 surface。
工作台可通过“扩展代理”总开关一次性启用这 37 个角色，或通过“仅保留基础代理”
清空全部扩展角色的 surface 分配。

在“使用现有代理”模式下未显式指定 `profile` 时，派发顺序固定为：

1. 对 ID/名称、description 和单一权威目录中的双语能力 facets 建立字段加权
   BM25 索引，使用 `k1=1.2`、`b=0.75`，并按任务显式只读/修改意图做策略加权后
   只保留 Top 5。真实 33-Agent 中英 query 集持续验证 Recall@5。
2. 使用 `roles.smallModel`（未配置则父会话/运行时模型）做一次无工具、JSON
   约束的判断。模型只能选择 Top 5 中的 profile，且 confidence 至少为 0.60；
   低于阈值或没有完整匹配时返回生成角色所需的 brief。
3. 没有有效 specialist、判断模型超时/报错/输出非法 JSON 或虚构候选 ID 时，
   复用配置的 default profile（通常是 `general`），而不是现场生成角色。父 abort
   会直接终止派发，不会启动 fallback child。

显式 `profile` 是稳定直达路径；选中的 profile 会连同来源和权限在执行前快照，
不在 recall 与 run 之间重新读取。只有关闭“使用现有代理”后，`custom_agent` 才允许
主 agent 直接给出一次性角色；它不写入 settings/workspace，并继承当前 turn 的
model/provider/reasoning 选择。升级前已经持久化的 `custom:*` child record 仍可读取，
但不会让严格现有代理模式重新开放 custom 派发。任何路径都不能扩大
父 turn 的 approval policy、sandbox 根、工具/工具 Provider allowlist、denylist 或 Memory
边界；有效能力始终是父快照与 profile 约束的交集。独立 workflow agent 和一次性
custom agent 都禁用 Skills 自动激活。child record 持久化 route method、Top 5、
选择理由、置信度及临时角色快照；router usage 计入父 thread。

下一阶段仍值得推进的缓存能力：

- 工具集合 mutation gate：新增工具允许 append，编辑、重排、删除工具时要求
  restart 或新会话边界，避免热前缀突然全量 miss。当前 Kun 已排序工具
  schema，但还没有把“工具集合变更策略”做成显式产品规则。
- LLM fold summarizer：`contextCompaction.summaryMode: "model"` 时，自动压缩和
  GUI `/compact` 都会额外请求模型生成结构化摘要，并复用主 agent 的 system /
  few-shot 前缀；超时、空响应或模型错误会降级到启发式摘要。
- 大工具结果 token cap 和长参数 markerize：当前本地工具输出较小；一旦加入
  shell、文件全文、网页抓取类工具，需要在进入历史窗口前按 token 截断或标记化，
  不让超大 tool result 把 append-only log 撑爆。
- volatile scratch 边界：assistant reasoning 现在不会上传给模型，但仍会落 GUI
  历史。未来若加入内部计划、临时草稿或子 agent scratch，应保持“可展示”和
  “可重放给模型”分离。

## GUI 要拆的东西

Renderer 只应展示 Kun。需要删除或保持删除的 UI 面包括：

- Agent 切换器：`AgentSwitcher` 不再出现，`AGENT_CATALOG` 只有
  `kun`。
- 顶部连接状态条和 runtime 诊断按钮：不再把运行时检测作为用户入口。
- Runtime insights/right panel：右侧面板可以展示只读 Kun 用量与 provider
  订阅额度，但不恢复 runtime 诊断、切换或控制台。
- GUI 斜杠菜单不恢复 runtime 控制命令。独立 TUI 的 `/usage` 只读取
  `GET /v1/usage` 生成用量报告，不代表可切换或可控制的运行时。
- 设置页 provider selector：Settings -> Agents 直接展示 Kun 配置，
  包含 binary path、port、autoStart、API key、base URL、runtime token、
  data dir、model、approval policy、sandbox mode、insecure。
- 旧绘画/设计 starter：不恢复独立 Design 工作区入口。核心工作区入口只有
  Code、Work；Design 是 Code 工作台内的任务类型并使用右侧白板，连接手机和自动化仍走各自入口。

## Main / Preload 要拆的东西

主进程和 preload 不再暴露旧 agent IPC：

- 删除历史运行时的 spawn/update/diagnostics IPC。
- 删除历史 RPC event bridge。
- 删除历史 adapter、HTTP bridge、updater、binary resolver 和 process manager。
- 删除 Kun 之外的 diagnostics/importer 模块。用户要的是可用的单
  agent，不是运行时检测中心。

主进程现在只需要：

- `kunRuntimeAdapter`：启动/停止精确 GUI-owned `kun serve`、拒绝同槽位外部
  owner、同步 config、计算 base URL、附加 auth header。
- `runtimeRequestViaHost`：确保 Kun running 后转发 `/v1/*`。
- `startSse/stopSse`：按 `threadId + sinceSeq` 转发 Kun SSE。

## Settings / Migration

保存后的 settings 结构只应有：

```json
{
  "agentProvider": "kun",
  "agents": {
    "kun": {
      "binaryPath": "",
      "port": 18899,
      "autoStart": true,
      "apiKey": "",
      "baseUrl": "https://api.deepseek.com/beta",
      "runtimeToken": "<generated-local-token>",
      "dataDir": "~/.kun/data",
      "model": "deepseek-v4-pro",
      "approvalPolicy": "auto",
      "sandboxMode": "workspace-write",
      "insecure": false
    }
  }
}
```

代码里仍允许出现历史 provider 字符串的唯一原因是读取旧 settings 文件时做
一次性迁移：

- 历史 `agentProvider` 值归一为 `kun`。
- 历史 provider 的 port、autoStart、API key、base URL、runtime token、
  approval、sandbox、model 会种到 `agents.kun`。
- 迁移后的落盘文件不再保留历史 provider 配置块。
- 连接手机（内部旧名 Claw）的历史 `agentThreadIds` 只折叠成
  `agentThreadIds.kun`，不保留 per-agent map。

## Code / Design 任务 / Work / 连接手机如何走 Kun

- Code：`KunRuntimeProvider` 负责 list/create thread、send turn、
  steer、interrupt、compact、approval、SSE 映射。Chat UI 不知道旧
  provider。同一 Code-owned 会话可为每个下一回合选择 Code 或 Design；
  admission 把意图固定在当前 turn/user item，不改变 thread ownership。首个被接纳的
  Design 回合只锁定设计文档、产物介质、目标与风格 profile；后续 Code 回合仍然有效。
- Design 任务：与 Code 任务共用工作台、会话列表、输入框、模型、权限和工作区控制；
  设计稿、原型和设计流程图落在 `.kun-design/`，在右侧白板中预览和迭代。
- Work：办公助手和 inline completion 读取同一份 Kun API key /
  base URL 配置。内部 Write thread registry 只把办公线程识别为 Kun
  thread，不再区分旧运行时会话。白板只缓存其绑定 thread 的 session title：
  新建时 session 携带初始标题并允许首轮自动命名，运行时标题变化会回写白板索引，
  手动改名则先锁定 session title，再更新白板缓存。
- 连接手机：定时任务、飞书/Lark/微信、IM webhook 创建或复用 Kun thread。
  代码内部仍沿用 `claw` route / settings key / runtime 文件名，作为旧命名兼容。
  `threadId` / `localThreadId` 字段只作为旧 settings 兼容字段存在，真正
  当前映射写入 `agentThreadIds.kun`。

## 计划构建 Worktree 提示词边界

计划执行仍走单一 Kun runtime。实验开关
`agents.kun.lab.planWorktree.enabled` 默认关闭；开启后，每个计划可以为 Direct 构建选择
“提示词管理 Worktree”。Graph 明确不使用这层协议，继续走当前工作区和自身节点隔离。

- Renderer 点击执行时先保存计划，再通过通用 `getGitBranches(workspaceRoot)` 读取本地仓库根、
  当前分支和脏文件数。非 Git、Git 不可用或 detached HEAD 会阻止发送；脏工作区不会被阻止。
- 应用只构造固定协议，并把仓库、分支、分支前缀、脏文件数、计划标题和完整 Markdown 经过
  JSON 结构化编码后放进下一条 user input。当前 thread、workspace、活动计划和计划页签都不变。
- Agent 从点击时捕获的本地目标分支已提交 HEAD 创建唯一临时分支，在
  `~/.kun/worktrees/plan-prompt/<unique>/<repo>` 创建 worktree，并显式在其中完成读取、编辑、
  命令、测试和提交。源 checkout 的未提交修改不进入基线，也不得被 stash、reset、clean、
  切换或提交。
- 合入前若目标分支前进，Agent 在 worktree 内 rebase；只解决能够可靠判断并复测的冲突。
  仅当源 checkout 仍位于目标分支且 Git 允许时，才执行 `git merge --ff-only`。
- 只有证明临时提交已被目标分支包含后，才能非强制移除 worktree、用 `git branch -d` 删除
  临时分支并 prune。测试失败、冲突不确定、源分支变化或脏文件阻塞合入时必须保留现场，
  报告绝对路径、分支、Git 状态和下一步；无仓库改动时可以安全清理未变化现场。

Electron main 不再持久化计划运行记录、监听完成、自动合入、恢复或清理；Kun 也不再提供
计划专用 fork/admission/fence。旧 `planBuildRunId` 等字段仅作历史解析，不能阻止普通输入。
旧磁盘记录、worktree 和临时分支不会迁移删除，仍可通过通用 Git Worktrees 页面或 Git 命令处理。
定时任务 worktree pool、通用分支 worktree 和 Graph 节点隔离保持独立。

## GUI HTTP 功能等价面

运行时归一不是只保留聊天。Kun 的 GUI HTTP 面必须覆盖 store/UI
已经依赖的能力：

- `GET /v1/threads` 支持 `limit`、`search`、`include_archived`、
  `archived_only`。默认隐藏 archived/deleted，会话搜索和归档视图不依赖
  GUI 本地猜测。
- `POST /v1/threads/{id}/fork` 复制 thread 历史、写入 fork lineage，
  并把历史 item 写回新 thread 的 session store。复制时会把 pending
  approval/user-input 规整为不可继续操作的历史状态，避免新会话悬挂旧 gate。
- `POST /v1/sessions/{id}/resume-thread` 沿用历史 resume 路径。
  Kun 优先从同名 thread 恢复；没有 thread 时从 session snapshot
  或 JSONL items 重建 turns；找不到时返回 404，而不是在 GUI 抛
  unsupported。
- `POST /v1/user-inputs/{id}` 和旧兼容路径 `/v1/user-input/{id}` 都可接收
  `{ answers }` 或 `{ cancelled: true }`。AgentLoop 通过 `request_user_input`
  / `user_input` tool 暂停，GUI 回答后继续模型回合。
- `POST /v1/approvals/{id}` 继续支持工具审批；approval 和 user-input 都是
  gate/route/service 分层，不在 renderer 内实现 agent 逻辑。
- `GET /v1/usage?group_by=thread|day|model` 返回累计 token、turn、cache hit
  和实际/参考价格数据；`group_by=turn&thread_id=<id>` 只聚合该 thread 内
  每个 turn 的直接模型调用，side-thread 用量保持独立，避免父子重复计费。
  Workbench 首页、composer 底部、逐轮价格和右侧“用量与额度”面板只消费
  Kun 自己持久化的 usage，不扫描外部 Codex 日志，也不提供 runtime diagnostics
  或控制动作。订阅价格明确标记为 API 参考估值，不冒充供应商账单。

## 已删除/应保持删除的旧入口

旧 agent 运行路径不应再回来：

- 历史 runtime adapters / bridges
- 历史 runtime process managers / binary resolvers
- 历史 runtime update modules
- Kun 之外的 diagnostics/importers

旧 UI 入口不应再回来：

- `AgentSwitcher`
- `ConnectionStatusBar`
- `RuntimeDiagnosticsDialog`
- `RuntimeInsightsPanel`
- 旧设计/绘画 starter card（独立于 Design 模式的入口）

## 架构设计约束

Kun 包按 ports & adapters 组织：

- `contracts/`：HTTP/SSE DTO 和 zod schema。
- `ports/`：ModelClient、ToolHost、ThreadStore、SessionStore、
  ApprovalGate、EventBus、WorkspaceInspector、Clock。
- `adapters/`：DeepSeek-compatible model client、local tool host、
  file/in-memory stores、workspace inspector。

线程存储采用「原子 JSON 元数据 + 可重建 SQLite 索引」混合实现。`list()`/`listPage()`
不再阻塞等待冷启动补索引：索引缺失时首屏从 SQLite 已索引行与 dirty filesystem delta
合并立即返回；补索引在后台分批并行读取 metadata 并单事务批量写回，进度通过响应中的
`indexStatus`（status/indexed/total）暴露，避免 GUI 陷入无期限 loading。
- `loop/`：AgentLoop、InflightTracker、SteeringQueue、ContextCompactor。
- `cache/`：ImmutablePrefix、LRU、TTL-LRU。
- `server/`：Router、auth、SSE、routes。

GUI 侧不实现 agent 逻辑，只做 HTTP client、SSE subscription 和状态映射。
新增能力时优先加 Kun tool 或 HTTP endpoint，不新增 GUI 内第二个
agent。

## 桌面应用发布约束

从 0.3.8 起，Stable 和 Daily 只分发桌面应用，不再构建独立 TUI 压缩包或推进
独立 TUI 更新清单。GUI 包仍通过 `electron-builder` 内置 `kun/dist` 和平台
启动器，`kun` / `kun tui` 及共享 Runtime 保留，随 GUI 一起更新。

发布必须校验 macOS arm64/x64、Windows x64 和 Linux x64/arm64 的 GUI 产物与
更新元数据。Stable 最终候选包通过真实跨版本 GUI 升级验收后，才能推进 latest；
签名、历史数据/配置保留、运行时启动和公开下载校验都不能因停止独立 TUI 分发而跳过。

历史独立 TUI 包及其旧更新清单不在本次变更中删除。旧独立客户端不会收到 0.3.8
独立包；需要安装桌面应用才能获得后续版本。TUI 的只读用量、provider 额度和上下文
命令继续复用已有协议，不增加 GUI Runtime 诊断或控制入口。

## 验证清单

每次改这条线至少跑：

```bash
npm run typecheck
npm test
npm run build
```

手动冒烟：

1. 打开 Kun 桌面应用。
2. Code 新建会话，能创建 thread、发送消息、流式返回、审批/中断可用。
3. Design 打开画布，能创建或迭代设计稿、预览/导出原型，并把设计交给新的
   Code thread 实现。
4. Work 打开工作空间，inline completion 和选中文本助手能用同一个 API key。
5. 连接手机能保存设置、运行手动 task、把 thread id 写回 Kun mapping。
6. Settings -> Agents 只看得到 Kun，没有 provider switch、runtime
   diagnostics、历史 provider 配置块。
7. `GET /v1/usage?group_by=thread` 有历史 usage 时，GUI 首页/底部不显示
   “暂无用量”，而显示 token、回合、缓存命中等指标。
8. 线程搜索、归档视图、fork、resume session、request_user_input 回答/取消
   都能通过 Kun HTTP 路径完成。
9. 普通最小化后 GUI Runtime/Manager PID 不变；关闭主窗口或平台 Quit 后，
   本次 Runtime、Manager、guard 和已登记工作进程退出，端口与匹配登记释放。
10. 默认 TUI 退出后没有遗留 owned Runtime/Manager；`--url` / `--no-start`
    退出不停止外部 stack。
11. 同一 canonical `dataDir` 的第二个正常 GUI/TUI 启动报 ownership conflict，
    即使 flavor 不同；显式隔离三类路径后可并行，关闭一套不影响另一套。
    首个 owner 退出后重开继续读取原有会话、设置和任务定义。
12. GUI Runtime 重启只更换自己的 Runtime PID/instance，不停止同 session 的
    Service Manager 或其他隔离 profile。启动中关闭、父强杀、清理抛错与
    恢复/退出竞争需要真实进程测试；各目标平台的打包验收结果分别记录。
