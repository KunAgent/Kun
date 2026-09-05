# Kun 客户端持有单运行时方案

本文记录 Kun 桌面应用和独立 TUI 如何使用同一套 Kun 协议与持久化数据，
但各自持有自己的运行时进程。结论先说清楚：GUI 只保留一个 agent，唯一
ID 是 `kun`；GUI、TUI、脚本、扩展和连接手机都通过同一条 `kun serve`
HTTP/SSE 边界工作。正常 GUI/TUI 在同一 `(规范化 dataDir, runtime flavor)`
槽位内互斥：谁启动 Runtime，谁负责在真实退出时关闭它。对话、设置、记忆
和用量继续由 Service Manager 持久化并可被后续客户端顺序复用。历史运行时、
旧绘画/设计 starter、运行时诊断面板、agent 切换都不再是产品表面。

Graph 编排、自进化项目 Agent、恢复与治理仍运行在同一个 Kun 边界内，完整设计与
运维说明见 [`docs/graph-mode.md`](./graph-mode.md)。

Work 工作区可以按线程挂载为 Code 的只读、无向量结构知识库。索引、工具、权限边界
与检索流程见 [`docs/knowledge-bases.md`](./knowledge-bases.md)。知识库挂载不会扩大
普通文件工具或 sandbox 的可写根。

长期记忆使用“原子 JSON 标准数据 + 可重建 SQLite FTS5 投影”。检索必须先做作用域和生命周期
过滤，记忆只能作为动态、不可信的 `reference` 证据，不能进入稳定 system 前缀或获得指令权限。
数据布局、迁移、降级与验证见 [`docs/memory-foundation.md`](./memory-foundation.md)。

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
  RuntimeHost -> kunRuntimeAdapter
  exact GUI child/config/port/token management only
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
        | starts/stops its exact owned Runtime
        v
TUI-owned kun serve

GUI/TUI-owned Runtime
        |
        v
Service Manager
  election / fencing / canonical persisted data
```

这个边界采用本地 HTTP 服务架构：GUI 不直接嵌 agent loop，不通过
stdio/RPC 混跑多个状态机，只把 `kun serve` 当成稳定协议。Kun 内部使用
cache-first loop：immutable prefix、append-only log、bounded LRU/TTL cache、
inflight cleanup、steering queue、context compaction、usage/cache telemetry。

## 客户端持有的生命周期

- GUI 在 `autoStart` 开启且目标槽位空闲时启动一个受监督的非 detached
  Runtime 子进程，只把请求路由到这个精确子进程。关闭自动启动时，GUI
  不启动也不接管已有 Runtime。
- 真正的应用 Quit、平台退出快捷键、保存的 `closeAction: quit`、更新退出和
  非 macOS 最后窗口退出都进入同一 quit barrier：停止恢复调度、优雅关闭
  精确 GUI 子进程并等待退出。隐藏窗口、最小化到托盘以及 Electron 仍存活的
  macOS 无窗口状态不算退出，Runtime 继续运行。
- 默认 TUI 启动自己的 Runtime，并在 `/quit`、信号退出、初始化失败或其他
  command 退出路径的 `finally` 中关闭精确实例。`--url` 和 `--no-start` 是
  显式外部连接例外：它们不拥有、不启动，也不停止目标 Runtime；目标 owner
  退出时，这类连接可以随之断开。
- 同一 `(Service Manager profile, runtime flavor)` 已有 live/starting GUI 或
  TUI owner 时，另一个正常客户端必须返回可操作的 ownership conflict，不能
  attach、steal、replace 或 silent kill。默认 Manager profile 绑定一个 canonical
  dataDir，production/development flavor 仍是独立槽位；若确实需要并行的第二套
  profile，必须显式隔离 Manager control directory，不能只换 `dataDir` 参数。
- GUI 顶部重启只优雅停止并重拉当前 Electron 持有的 Runtime；不再扫描当前
  用户的所有 `kun serve`，不触碰 TUI、其他 dataDir/flavor 或 Service Manager。
- Service Manager 是独立、轻量的选举与数据面进程。普通 GUI/TUI 退出和 Runtime
  restart 都不停止 Manager；Manager 可以在没有 Runtime slot 时继续保留持久化
  状态，但它自身不执行 Agent turn。
- 首次升级到 client-owned 生命周期时，可以只对同一 canonical dataDir 中、
  已认证且身份精确、`launchMode: shared` 且无 client-owner 元数据的旧 daemon
  做一次优雅退休并等待 PID 退出。任何 discovery、PID、endpoint、dataDir、
  Manager registration 或认证歧义都必须 fail closed，禁止扩大为全用户进程扫描。

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
  soft/hard 输入阈值，还会把为模型输出保留的预算（`maxOutputTokens`）计入
  `input + output` 总预算，并与发送前硬上限（上下文窗口的 85% 或模型
  profile 的 hard threshold）对齐。这样输入尚未达到软阈值、但加上输出预算
  已经突破发送上限（例如 1M 窗口 + 131072 输出预算）时，会在发送前强制
  压缩，而不是在发送校验处直接失败。
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

## Subagent 召回与派发

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
9. 最小化到托盘后 GUI Runtime PID 不变；真正退出应用后该精确 PID 退出，
   Service Manager 仍可用且 Runtime slot 已释放。
10. 默认 TUI 退出后没有遗留 owned Runtime；`--url` / `--no-start` 退出不停止
    外部 Runtime。
11. 同一 `(dataDir, flavor)` 的第二个正常 GUI/TUI 启动明确报 ownership conflict，
    首个 owner 退出后另一个客户端能启动并读取原有会话。
12. GUI 顶部重启只更换自己的 Runtime PID/instance，不停止 TUI、其他 dataDir /
    flavor 或 Service Manager。
