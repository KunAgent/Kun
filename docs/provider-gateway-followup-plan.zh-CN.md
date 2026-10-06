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
- 意图分类器不加"用模型分类"选项：当前关键词分类够用，模型分类会给每个
  turn 加一次前置调用，影响延迟与成本。
- YAML 编辑器只做标量键，不做通用重写；遇到锚点、多文档、流式写法直接拒绝
  接管并提示用户手改。
- 系统通知走现有偏好与回执机制，不新建通道。
- 700 行门槛：`gateway-route-trace.ts` 加 `recent` 后接近上限，`decision`
  类型放到 `contracts/gateway-route-trace.ts`（新）。
