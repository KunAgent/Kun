# Kun 供应商与本地网关：合并后的补强实施计划

日期：2026-10-06。前置文档：`docs/provider-gateway-parity-plan.zh-CN.md`
（8 条工作线已合并到 develop `0b2e33462`）。本文是对合并结果的复查结论与
下一轮实施计划，按"先还验证债、再补产品缺口、最后扩广度"排序。

## 0. 一句话结论

上一轮把能力面铺齐了，但有三类债没还：

1. **验证债**：七个 agent 适配器只验证了配置写入和还原，没有真实客户端跑过
   网关；现有 `scripts/smoke-model-gateway-clients.mjs` 走的还是旧的隔离目录
   模板，不覆盖 `kun/src/agent-wiring`；路由规则面板没有组件测试；打包 app 没跑过。
2. **闭环缺口**：外部 agent 看不到自己的限额和路由轨迹；中间件脚本没有创建
   入口；发现文件没有 GUI 开关；额度恢复提醒只在面板里；上游下线的模型不会
   从路由池和白名单里清掉。
3. **广度**：适配器 7 个，自定义余额 URL、价格层级覆盖、会话归因、
   `kun provider` 子命令都还没有。

分 6 条补强线（F1–F6）、4 个阶段。F1 和 F2 先做，它们决定已合并代码能不能放心
发版。

## 1. 复查结论修正

复查时有三条判断不准确，这里纠正，避免后续按错的前提开工：

| 复查时的说法 | 实际情况 | 结论 |
| --- | --- | --- |
| 亲和落盘没有容量上限 | `route-affinity.ts` 内存有 `capacity` LRU，落盘只保留最近 512 条 | 不需要做 |
| 发现文件默认关闭 | `serve-entry.ts` 在 production flavor 下默认 `advertiseGatewayDiscovery: true` | 缺的只是 GUI 开关与状态展示，见 F3.2 |
| Gemini 入口的 conformance 只测文本流 | `gemini-gateway.test.ts` 已覆盖 function call、thinking、countTokens | 缺的是 `inlineData` 图片与多轮 functionResponse，见 F2.3 |

## 2. 补强线

每条线按"目标 / 改动点 / 测试 / 验收"写。文件路径为当前 develop 的落点；
新文件以 700 行门槛为前提拆分。

### F1 真实 agent 端到端联调与打包验证（高，规模 L）

目标：用固定版本的官方客户端走一遍"原生配置接管 -> 请求经网关 -> 断开还原"，
并把结果写回 `docs/provider-gateway-release-validation.md`。

改动点：

- `scripts/smoke-model-gateway-clients.mjs` 增加 `--wiring` 模式。现有模式继续
  用 `harness/gateway-config-templates.ts`（隔离目录），新模式改为：
  1. 为每个客户端准备隔离 HOME（同时设置 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`、
     `XDG_CONFIG_HOME`，Windows 下 `APPDATA`），预置一份"用户已有配置"
     （含注释与自定义字段的 JSONC/TOML）。
  2. 通过 `kun/src/agent-wiring/service.ts` 的 `connect` 写入原生配置，记录每个
     文件的 sha256。
  3. 启动客户端，跑既有 13 个场景（文本流、真实 read 工具 + 下一次模型调用、
     取消 -> 上游中止、小模型）。
  4. `disconnect` 后比对 sha256 与预置文件逐字节一致；再模拟"用户接入后手改
     一行"的情况，断开时应只还原 Kun 写过的键、保留用户改动。
- 新增场景（fake upstream 侧断言）：
  - effort 透传：`--effort high` 后上游收到 `reasoning_effort` /
    `thinking.budget_tokens`，Claude Code 的 `max` 走 `CLAUDE_CODE_EFFORT_LEVEL`。
  - Anthropic thinking 签名回路：thinking 块 + tool_use -> 客户端带着
    `kungw1.` 签名回传 -> `gateway-continuations.ts` 还原成功，上游第二次请求
    带原始 thinking。
  - 路由规则：fake runtime 配一个 `strategy: manual` 池和一条 `when.intent`
    规则，断言上游看到的 provider/model 与规则一致。
  - 中间件：启用一条 `model-map`，断言上游收到映射后的模型。
- 新增客户端：Gemini CLI、Crush、Droid 加入固定版本表；没有稳定二进制的先标
  "未门控"而不是跳过。
- 打包验证：`npm run build` + `npm run dist:mac:arm64`，解压后启动，检查
  Settings -> Providers 的 Gateway 页、Agents 面板、Middleware 面板渲染无报错，
  `curl http://127.0.0.1:18899/api/hello` 返回发现信息，`~/.kun/gateway.json`
  存在且 0600。

测试：smoke 脚本本身是测试；额外给 `agent-wiring/engine.ts` 加"用户在接入后
修改了同一文件的其他键"的回归用例（当前 `editors.test.ts` 只覆盖未触碰时的
整文件备份还原）。

验收：release-validation 文档的表格扩到 7 个客户端，每行有版本号与四列结果；
smoke 命令可在干净机器按文档一次跑通；打包 app 的检查项全部记录。

### F2 测试补强（高，规模 M）

目标：新 UI 与新协议分支都有回归测试，并把 develop 上这次改动引入的测试
缺口补齐。

改动点：

- F2.1 `src/renderer/src/components/settings-section-model-routes-rules.test.ts`
  （新文件，参照 `settings-section-model-routes.test.ts` 的 react-test-renderer
  写法）。用例：
  - `strategy: manual` 时出现 pick 下拉，切换触发 `onUpdate({ pick })`；
    非 manual 不渲染。
  - 添加规则默认 `use` 第一个目标、`when: {}`、`enabled: true`；删除规则。
  - RuleRow 修改 `when.intent` / `use`，`onUpdate` 收到合并后的 `rules`。
  - 分类器开关：选择模型时默认 intents 为 `['code','chat']`；清空时
    `classifier: undefined`；intents 输入裁到 12 个。
  - overflow 开关默认 on，关闭写 `overflowMove: false`。
  - 七种语言的 `routeRules.*` key 齐全（复用现有 locale parity 测试模式）。
- F2.2 `kun/src/agent-wiring/adapters.<id>.test.ts`：每个适配器一个文件，
  覆盖 `edits()` 生成的 slot 路径、`inspect()` 对"指向网关 / 指向别处 / 文件
  缺失"三种状态的判断、以及带注释配置的字节保留。当前只有 `service.test.ts`
  14 个用例一把抓。
- F2.3 `kun/src/server/routes/gemini-gateway.test.ts` 补：`inlineData` 图片
  映射到 `localFilePath`/data URL 契约、多轮 `functionResponse` 回传、
  `systemInstruction` 为空时不注入空 system。
- F2.4 `kun/src/server/routes/gateway-middleware.test.ts` 补：多个中间件顺序
  叠加（model-map 两次、think-tags + script 同时）、脚本修改 `options` 不影响
  下一次调用（`structuredClone` 保证）。

验收：以上文件存在且通过；`npm run test` 的失败集合与 develop 基线一致
（基线红项见 memory `develop-pre-existing-red-tests`）。

### F3 闭环小缺口（中，规模 M）

四个独立小项，可并行。

#### F3.1 客户端密钥自查端点 `GET /v1/kun/limit`

- 认证：bearer client key（与 `/v1/kun/route` 同一 guard）。
- 响应：
  ```json
  {
    "client": { "id": "…", "name": "…" },
    "limited": false,
    "protocols": ["chat_completions", "messages"],
    "models": ["…"],
    "rate": { "requestsPerMinute": 60, "burst": 20, "maxConcurrent": 2, "active": 0 },
    "tokenBudget": { "mode": "hard", "period": "day", "timeZone": "…", "tokens": 0, "used": 0, "left": 0, "resetsAt": "…" },
    "cost": { "period": "day", "usd": 0, "used": 0, "left": 0, "enforce": true, "resetsAt": "…" },
    "expiresAt": "…"
  }
  ```
  `tokenBudget`/`cost` 缺省时省略；`limited` 为任一硬限已触发。
- 实现：`kun/src/server/routes/gateway-limit.ts`（新），窗口统计复用
  `gateway-budget-integration` 里 429 判定用的同一函数，保证自查数字和拒绝
  数字一致。429 响应体改为同结构并加 `x-kun-limit-reset` 头。
- CLI：`kun gateway keys limit <client-id>`。
- GUI：Connection Center 的密钥列表每行显示 used/left 进度条，数据来自管理端
  `/v1/model-gateway/clients/:id/limit`（同一计算，管理 token）。
- 测试：窗口数学单测；路由测试用假账本验证 `limited` 翻转与 429 体一致。

#### F3.2 发现文件 GUI 开关与状态

- 设置：`localGateway.advertiseDiscovery?: boolean`（默认 `true`），落在
  `src/shared/app-settings-provider-core.ts`，经 `gui-settings-bridge` 投影
  到 kun config，`serve-entry.ts` 改为读配置而不是按 flavor 硬编码；
  `runtime-server-start.ts` 的 loopback 检查保留。
- GUI：Gateway 页顶部状态行显示"发现文件：`~/.kun/gateway.json` · 开/关"，
  带复制路径按钮；关闭时提示外部 agent 需手填地址。
- 测试：设置 normalizer 往返；`runtime-server-start` 在关闭时不写文件并删除
  旧文件。

#### F3.3 中间件脚本入口

- `GET /v1/model-gateway/middleware` 响应增加 `directory`。
- `POST /v1/model-gateway/middleware/example` 在目录内写
  `example-middleware.js`（三个 hook 的注释模板），已存在则 409。
- GUI `gateway-middleware-panel.tsx`：显示目录路径、"打开目录"（新增
  `shell:open-path` IPC，限制为 kun 数据目录内）、"创建示例脚本"；script
  类型的 file 字段改为从目录现有 `.js` 文件下拉选择，仍允许手填。
- 测试：路由测试（409、路径逃逸拒绝）；面板测试（目录为空时按钮态）。

#### F3.4 额度恢复系统通知

- 新增 `src/main/services/provider-quota-reminder-service.ts`：挂在现有额度
  刷新节奏上，调用共享的 `quotaResetReminders`，以 `metricId + resetAt` 做去重
  （复用 `notification-receipts.ts`），通过 `notification-display.ts` 发系统
  通知，点击打开 Settings -> Providers。
- 偏好：`notification-preferences.ts` 增加 `quotaReminders`（默认开），
  Settings -> Notifications 加开关。
- 测试：去重、偏好关闭不发、同一窗口不重复。

### F4 Routing 页路由轨迹（中，规模 M）

目标：把 `/v1/kun/route` 的轨迹在 GUI 里可视化，不用开 CLI。

- 存储：`GatewayRouteTraceStore` 增加跨会话的 `recent(limit)` 环形列表
  （≤100 条，内存），`decision` 字段补齐来源：`rule:<id>` / `intent:<name>` /
  `manual` / `affinity` / `overflow` / `strategy`，由
  `route-pool-model-client.ts` 写进 chunk 的 `route` 元数据（当前只有 `ruleId`）。
- 管理端：`GET /v1/model-gateway/route-traces?since=<seq>` 长轮询，管理 token。
- GUI：Connection Center 新增 "Recent routes" 面板（`gateway-route-trace-panel.tsx`）：
  时间、agent、请求模型 -> 实际 provider/model、决策来源、每次尝试的状态与
  耗时、失败原因；仅在 Gateway 页激活时轮询（沿用 model-routes 的 active 约定，
  测试里按路径过滤计数）。
- 测试：store 环形与 seq 单调；路由测试长轮询超时返回空；面板测试轮询暂停。

### F5 适配器扩展与接入预览（中，规模 L）

#### F5.0 接入预览（先做，F1 也受益）

- `POST /v1/model-gateway/agents/:id/preview` 返回将写入的每个文件的 unified
  diff（基于 `engine.ts` 的 edits 在内存里应用，不落盘）。
- Agents 面板"连接"前先展示 diff，用户确认后再写；CLI
  `kun agents connect --dry-run` 打印同样的 diff。

#### F5.1 第一批新适配器

候选来自参考实现的 agent 列表，按 Kun 用户群和配置格式可靠性挑选，格式在
开工时逐一核实：

| 适配器 | 配置文件 | 协议 | 备注 |
| --- | --- | --- | --- |
| Zed | `~/.config/zed/settings.json`（JSONC） | openai-compatible / anthropic | 用现有 jsonc 编辑器 |
| Goose | `~/.config/goose/config.yaml` | openai-compatible | 需要 YAML 编辑器 |
| Continue | `~/.continue/config.yaml` | openai-compatible | 需要 YAML 编辑器 |
| Aider | `~/.aider.conf.yml` + `.env` | openai-compatible | YAML + dotenv |
| Kimi CLI | 待核实 | openai-compatible | 国内用户多 |
| Cline / Kilo Code | VS Code globalStorage JSON | openai-compatible | 路径随 IDE 变化，放第二批 |

- 新增 `kun/src/agent-wiring/edit/yaml.ts`：字节保留的 YAML 标量键编辑，
  只支持顶层与一层嵌套的 map 标量（够用，不做通用 YAML 重写）。
- 每个适配器按 F2.2 的模式配一个测试文件。

验收：Agents 面板检测到已安装客户端即显示；`kun agents` 列出；预览 diff
与实际写入一致。

### F6 按需的广度项（低，规模 S–M，各自独立）

- F6.1 **自定义余额 URL**：provider 档案增加
  `balance: { url, headers?, pointer, unit }`，`provider-quota-balance-parsers.ts`
  加 `generic-json` 解析器；主机必须与 provider `baseUrl` 同主机或显式放行
  （复用现有额度安全的主机范围检查）；GUI 在 provider 高级区。
- F6.2 **价格层级覆盖**：明确优先级"用户 provider-model 覆盖 > 预设目录价格 >
  models.dev"，模型编辑器显示价格来源；先核实现有 `modelProfiles.pricing`
  已覆盖多少，再决定是否只需补展示。
- F6.3 **会话归因**：`gateway-caller-agent.ts` 增加按 agent 的
  `sessionHint(headers, body)`：Codex 的 `session_id` 头、Claude Code 的
  `metadata.user_id` 中的 `session_<uuid>`、其他逐一核实；写入用量账本的
  `sessionId`，用量面板按 agent -> 会话分组。
- F6.4 **CLI 补齐**：`kun provider list|models <id>|test <id>`（`test` 走新的
  管理端最小探测路由，经配置好的 model client 发一条 1 token 请求）、
  `kun gateway route <alias> --preview`（复用 `/v1/model-routes` 的 preview）。

## 3. 分期

| 阶段 | 内容 | 退出条件 |
| --- | --- | --- |
| P0 | F1、F2 | smoke `--wiring` 7 客户端通过；新测试落地；打包 app 检查记录完成 |
| P1 | F3.1–F3.4、F4 | 外部 agent 可自查限额；Routing 页能看到轨迹；中间件可从 GUI 创建 |
| P2 | F5.0、F5.1 | 预览 diff 上线；新增 ≥4 个适配器且各有测试 |
| P3 | F6 按需 | 单项独立交付 |

依赖：F5.0 的预览复用 F1 里补的 engine 内存应用路径，建议 F1 做 engine 改动
时顺手把"不落盘应用"抽成函数。F4 的 `decision` 字段要在 F1 的路由规则场景
里一起断言，避免两次改 fake upstream。

## 4. 不做与风险

- 继续不做 OpenCode 认证插件兼容壳、LAN/远程共享、embeddings/rerank、
  媒体导出，理由同前置文档第 5 节。
- 意图分类器已经是模型分类（池的 classifier 指定 provider/model，每个 turn
  缓存一次结果），复查时误写为关键词匹配；不再新增分类方式。
- YAML 编辑器只做标量键，不做通用重写；遇到锚点、多文档、流式写法直接拒绝
  接管并提示用户手改。
- 系统通知走现有偏好与回执机制，不新建通道。
- 700 行门槛：`gateway-route-trace.ts` 加 `recent` 后接近上限，`decision`
  类型放到 `contracts/gateway-route-trace.ts`（新）。

## 5. 实施记录（2026-10-06）

分支 `codex/provider-gateway-followup`，按本计划全部实施：

- F1：`scripts/smoke-agent-wiring-clients.mjs` 用真实客户端走"接管原生配置
  -> 网关 -> 断开还原"。本机已安装的 Claude Code 2.1.291、Codex 0.145.0、
  OpenCode 1.1.47、Gemini CLI 0.52.0、Droid 0.234.0、Kimi Code 0.29.0
  全部通过（文本、真实读工具往返、按 agent 的路由规则、中间件、路由轨迹、
  字节级还原、保留用户改动；Claude Code 还验证了 thinking 签名回路）。
  Goose、Aider、Pi、Crush、Continue 本机未安装，只有单元测试。结果记录在
  `docs/provider-gateway-release-validation.md`。
- 真实联调发现并修复了 5 个网关兼容问题：Claude Code 的
  `context_management`（clear_thinking keep all）与 messages 内的 system
  消息、Codex 回放的 reasoning 条目、Gemini CLI 的 `topK`、Kimi Code 把
  上下文窗口当 `max_completion_tokens`（网关流量的 max tokens 改为上限，
  按成员能力收紧）。
- F2：路由规则面板测试、每个适配器一个测试文件、Gemini 图片与并行
  function call、中间件叠加与 options 隔离。
- F3：`GET /v1/kun/limit` 与管理端每个 key 的限额条、`kun gateway keys
  limit`；发现文件 0600、随设置热切换、网关页开关；中间件目录、打开目录、
  示例脚本；额度重置系统通知（偏好可关，每个窗口只提醒一次）。
- F4：路由元数据带决策来源，最近 100 条轨迹长轮询与"最近路由"面板，
  `kun gateway routes`。
- F5：连接前 diff 预览（GUI 确认 / `--dry-run`），新增 Goose、Continue、
  Aider、Kimi Code 适配器，YAML 编辑器保留注释，TOML 支持带点的表名与数组。
- F6：自定义余额 URL（同主机 HTTPS，片段为 JSON pointer）；价格优先级
  修正为 用户/供应商声明 > 目录（models.dev），预设静态价格仍是离线兜底、
  会被目录刷新；按 agent 会话归因用量与轨迹；`kun provider
  list|models|test`、`kun gateway route <alias>`。

与计划的偏差：

- Zed 未接入：它把 API key 存在系统钥匙串，而 Kun 只把 key 写进 agent
  自己的配置文件。
- 429 响应没有加 `x-kun-limit-reset` 头：预算拒绝以流内错误返回，改为在
  错误信息里指向 `/v1/kun/limit`。
- Gemini CLI 只在用户信任过的文件夹读取 `~/.gemini/.env`；未信任文件夹
  会报缺少 key 而不会把 key 发往 Google。Agents 页对 Gemini CLI 显示这条
  说明。

## 6. 复查修复记录（2026-10-07）

对上面实施结果又做了一轮复查，列出 17 项未处理好的问题，另有用户反馈的
供应商图标缺失，共 18 项，分支 `codex/provider-gateway-review-fixes`：

- 图标：57 个内置预设里 33 个显示 Kun 的 K。改用 magpie 自带的 lobe-icons
  （MIT）转成单色轮廓，带白色细节的彩色 logo 把细节挖空；本地 OpenAI 兼容
  与 Opper（无公开 logo）用中性图标。新增测试：任何预设没有图标即失败。
- A1 上游下线模型：供应商面板列出已不在供应商自有列表里、但仍被选用、
  在路由成员或密钥白名单里的模型，一次审阅即可从三处移除；手动添加的模型
  不算下线，路由不会被删空。路由本身不变，未列出的模型照常尝试。
- A2 限流 429：带 `retry-after`、`retry-after-ms`、`x-kun-limit-reset`；
  令牌桶给出精确等待时间，预算/费用拒绝给出窗口结束时间，上游失败透传
  上游的重试时间。流式请求被预算拒绝时改为直接 429（本地拒绝发生在任何
  上游调用之前，网关最多等 1.5 秒首个分块）。同时发现上一轮加的
  "/v1/kun/limit" 提示被网关的隐私过滤替换掉、从未到达客户端，已修。
- A3 自定义余额：可设单位、携带密钥的请求头，以及经用户逐字确认的另一
  主机；URL 换主机即作废确认，运行时每次请求同样校验。
- A4 会话归因：抓包发现 Codex 0.145 发的是 `session-id` 头和
  `client_metadata.session_id`，原逻辑只认 `session_id`，Codex 从未按会话
  归因；OpenCode 原本不发会话，Kun 写入 `setCacheKey` 后发
  `promptCacheKey: ses_<id>`；Crush 发 `x-session-id`，Goose 发
  `agent-session-id`。Droid、Gemini CLI、Pi、Aider、Continue 不发会话标识。
- A5 打包 app 界面：合并后重新打包，用调试端口只读驱动用户自己的配置，
  发现文件、Agents、最近路由、中间件、余额字段都正常渲染、无报错。日志里
  发现每次"最近路由"长轮询都在 15 秒被主进程默认超时截断（等待也是 15
  秒），已给它与其他长轮询相同的余量。
- B6 可视化：在 Settings fixture 里看过亮色、暗色、620px 宽度；修了 Zed
  误导性的"在 agent 内选模型"提示、日期按系统语言而非应用语言显示、中间件
  目录没缩写成 `~`、余额字段在未确认时就显示单位和请求头等问题。fixture
  现在提供最近路由、发现文件、中间件、密钥限额和 Agents 列表的样例数据。
- B7 钉版本门：把 Codex 0.160.0、Claude Code 2.1.220、OpenCode 1.1.47、
  Pi 0.73.1 装到临时目录重跑，13 个场景全部通过。首次运行卡在 Codex 的
  取消场景：客户端在网关等待首个分块期间断开时，HTTP 写出逻辑在等早已触发
  过的 close/drain 事件，请求永不结束、服务器无法关闭；现已在写出前识别
  已离开的客户端并取消响应体，补了真实断开的路由测试。
- B8 未安装的 5 个 agent：Goose 1.53.0、Aider 0.86.2、Pi 0.73.1、Crush
  0.97.1、Continue 1.5.47 装到临时目录，用真实配置（含用户注释和后续手改）
  跑接管→网关→还原，全部通过（Aider 不走工具调用，只跑文本场景）。真机
  发现 Continue 连接后仍用用户自己的第一个模型（Continue 默认用列表里第一个
  对话模型），现把 Kun 的条目放在最前，断开时只移除 Kun 的条目。
- C9 发现文件多实例：每次对账回读文件；文件缺失或属于已退出的实例就重新
  发布，另一个存活实例持有时让出，对方退出后接管。存活判断同时要求进程
  存在且其 hello 返回同一实例 id。网关页会提示"另一个 Kun 持有发现文件"。
- C10 额度提醒：移到主进程，窗口关闭时也能提醒；只在长窗口即将进入
  提醒期时自己查询，其余复用应用本来就会拉取的额度列表；不足一天的窗口
  （5 小时会话额度）不再提醒；通知文本按应用语言生成。
- C11 最近路由：完成的轨迹落盘（防抖、原子写、仅本人可读），重启后保留
  序号；面板加载失败时显示原因。
- C12 接入错误：带错误码和文件名，七种语言翻译，未知错误原样显示。
- C13 Claude Code 严格 JSON：settings.json 有注释或尾逗号时 Claude Code
  会整份忽略；Agents 页在连接前就提示，预览和连接拒绝执行。
- D14 文档：`local-model-gateway.md`、`provider-configuration-and-gateway.md`。
- D15 行数余量：preload 入口拆出 worktree 桥（700 → 676 行），英文和中文
  的路由页文案移到 `model-routes.json`（其余五种语言本来就这样放）。
- D16 `npm run smoke:agent-wiring`。
- 17 Zed：接入 Zed。Zed 把密钥放在系统钥匙串，Kun 写入 settings.json 的
  OpenAI 兼容 provider 和默认模型，密钥由主进程放进剪贴板一次（不经过
  渲染进程、不落盘），CLI 用 `kun agents key zed` 打印；切换模型沿用已粘贴
  的密钥，"复制新密钥"会轮换。也可设 `KUN_API_KEY`。

仍不做：

- Cline / Kilo Code：配置在 VS Code 的内部状态库和 SecretStorage 里，不是
  Kun 能安全编辑的配置文件。
- OpenCode 认证插件兼容壳：它的用途是复用社区的订阅登录插件，与 D1
  "默认不导出消费级订阅"的结论和供应商条款相冲突，仍不做。
