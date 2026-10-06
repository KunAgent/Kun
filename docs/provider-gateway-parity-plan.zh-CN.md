# Kun 多供应商接入与本地网关：对齐 magpie 的打磨方案

日期：2026-10-06。参考实现：`../magpie`（Go，MIT）。本文最初是设计与分期方案；
D1/D2/D3 均按建议拍板，实现状态见文末"实施记录"。

## 0. 一句话结论

Kun 的骨架已经有了：provider v2 注册表、route pool、三协议网关、client key、
Connection Center、`kun://import`。和 magpie 的差距不在"有没有"，而在三件事：

1. **广度**：预设 43 个但缺中国云厂商多计划/多区域，`/v1/models` 不带元数据，
   只有 4 个外部客户端且走隔离目录、Claude Code 被迫关闭 thinking。
2. **顺滑度**：没有"改原生配置、一键还原"的 agent 适配层；路由没有规则/
   嵌套/上下文溢出迁移；亲和不落盘。
3. **对外约定**：缺发现端点、路由 trace、按 agent 归因、余额/计划额度读取、
   网关中间件、OpenCode 插件兼容。

建议拆成 8 条工作线、4 个阶段。先做 P0 的"对外约定 + 预设 schema +
原生配置接管"，这三项决定其他 agent 能不能"一键接上 Kun"。

## 1. 现状对照

| 维度 | magpie | Kun 现状 | 差距 |
| --- | --- | --- | --- |
| 预设数量 | 约 50，含 vendor/relay/local 分组、regions/plans | 43（`packages/provider-catalog/src/definitions`） | 缺 Qwen 多区、Qianfan 三计划、Huawei MaaS、Tencent 三端、Bedrock、Azure、NVIDIA、ModelScope、Kilo、OpenCode Zen、CommandCode、oMLX、Cloudflare |
| 预设元数据 | regions、headerHints、only 前缀、noList+models、endpoint 占位、keysUrl、balance/planQuota 源 | id/name/category/kind/authFlow/baseUrl/endpointFormat/models/docsUrl/credentialUrl | 缺 regions、headerHints、only、noList、endpoint 占位、余额/额度源 |
| 模型目录 | vendor `/models` 实时 + models.dev 补名/价格/效果档；`model wire` 上游改名；价格/窗口 per provider 覆盖 | auto/manual/custom discovery + models.dev 补全；modelProfiles 含 pricing/reasoning | 缺 wire 改名、价格层级覆盖、refresh 时清理失效选择 |
| 网关协议 | Chat / Responses / Messages / Gemini / count_tokens / images / embeddings / rerank / videos | Chat / Responses / Messages / count_tokens | Gemini ingress 与 embeddings 在 P5 提案中，未实现 |
| `/v1/models` | id、display_name、owned_by、reasoning、supported_reasoning_levels、context_window、max_output_tokens、modalities、native_endpoints、`?format=text` | id、owned_by、`x_kun.guarantees`（仅 pool） | 外部 agent 拿不到推理档位和窗口 |
| 发现 | `GET /api/hello` + settings.json 的 port | `/health`，端口 18899 | 缺 hello 协议与只读发现文件 |
| 调用归因 | key `magpie-<app>` 或 User-Agent 首词 | 只认真实 client key | 缺按 agent 归因 |
| 路由策略 | smart/order/rotate/usage/pace + manual；rules；intent；嵌套组；95% 窗口溢出迁移 | 6 种 pool 策略 + 4 种账号组策略；affinity turn/session | 缺 rules、intent、嵌套、溢出迁移、manual、按成员固定 effort |
| 亲和 | 落盘 affinity.json，重启保持 | 内存 LRU（`route-affinity.ts`） | 重启丢缓存亲和 |
| 路由可观测 | `GET /v1/magpie/route?session=` 长轮询 trace | route preview（管理端） | 缺面向客户端的 trace |
| 外部 agent | 68 个适配器，改原生配置、Unwire 还原、Sync 目录文件、UA 归因、Profiles | 4 个（Codex/Claude Code/OpenCode/Pi），隔离 `.kun-gateway` 目录，不动原生配置 | 缺适配层与配置编辑库 |
| Claude Code 接入 | thinking 透传 | `MAX_THINKING_TOKENS=0`，签名 thinking 不支持 | 体验降级 |
| 订阅导出 | Claude binary bridge、Codex、Copilot、Code Assist、Grok、Devin、Cursor… | 明确不导出订阅/OAuth/SDK provider | 政策差异，见 D1 |
| client key | 命名 key、模型范围、日/周/月 token+cost 限额、`/v1/magpie/limit` | 命名 key、route/model 范围、协议、并发、速率、token 预算（日历窗口）、cost 仅告警 | 缺 cost 硬限、自查端点 |
| 余额/额度 | 7 家余额端点 + 自定义 BalanceURL；计划额度 Zhipu/Kimi Code/MiniMax/CommandCode/StepFun；订阅窗口；重置提醒；`quota wait` | 计划额度仅 Z.ai；订阅窗口 Codex/Gemini CLI/Grok/OpenCode Go | 缺余额读取器与解析器注册表 |
| 用量 | 按 agent/provider/key/account/session；OTLP；按 session 读取 agent 会话文件 | 按 attempt/client 的账本 | 缺 agent 归因、OTLP、session 归因 |
| 插件 | OpenCode auth 插件 + pi 包跑在 Bun；网关中间件 onRequest/onEvent/onResponse | extension-api ModelProviderAdapter；不可导出到网关；hooks 只覆盖 agent loop | 缺导出、OpenCode 兼容壳、网关中间件 |
| 导入 | CC Switch、Claude Code、Codex、Alma；`magpie://import` + https 落地页 | CC Switch；`kun://import` | 缺 Claude Code/Codex 配置导入、https 落地页 |
| CLI | `provider add/test/models`、`claude <model>`、`group`、`gateway-key`、`quota` | 无 provider/gateway 子命令 | 缺 |
| 共享 | LAN、Remote magpie、Docker、WebDAV/S3 同步 | loopback only（P5 提案） | 后置 |

## 2. 三个需要先拍板的决策

### D1 订阅类 provider 要不要通过网关导出

magpie 导出了所有登录态订阅。代价：`claude_subscription.go` 3125 行，驱动真实
`claude` 二进制并通过 MCP 桥接工具；magpie 自己的 AGENTS.md 承认部分订阅触碰
厂商条款，正在迁出到社区插件以免 magpie 被封。

建议：

- 保持 Kun 现有政策为默认：API key / token plan 类 provider 可导出，订阅/OAuth/
  SDK 类不导出。
- 增加 provider 级别的显式开关 `gatewayExport: 'off' | 'experimental'`，只对
  OpenAI 兼容的账号型 provider（Codex/ChatGPT）开放，开启时弹风险说明。
- 不做 Claude binary bridge。Claude 订阅继续走 agent-sdk 整回合委托。
- 将来若要覆盖更多订阅，走 WS7 的 OpenCode 插件兼容壳，让风险留在社区插件。

### D2 接入外部 agent 时写不写它的原生配置

Kun 现在只写 `.kun-gateway/<client>/` 隔离目录，用户需要用
`CODEX_HOME=... codex` 这种方式启动，安全但不顺手。magpie 直接改
`~/.claude/settings.json`、`~/.codex/config.toml`，只动自己写的键，保留注释、
顺序和格式，disconnect 时按 stash 还原。

建议双模式并存：

- **隔离模式**（现有）：默认用于多项目并行、CI、不信任环境。
- **接管模式**（新）：Agents 页一键连接；只改声明的键；写前备份 stash；
  字节级还原测试作为每个适配器的准入条件。

### D3 本机 loopback 的 key 策略

magpie 在 loopback 上接受任意 key，用 `magpie-<app-id>` 做归因。Kun 要求真实
client key。建议保持真实 key 的鉴权，但补两点：

- 允许创建"命名归因 key"：`kun-<app-id>-<secret>`，前缀做归因，后缀做鉴权。
- 无法识别 key 身份时，用 User-Agent 首词做用量归因（只用于统计，不放权）。

## 3. 工作线

每条工作线写明目标、契约变更、涉及文件、验收、风险。文件路径以现有代码为准。

### WS1 预设平台化（广度）

目标：预设 schema 能表达 magpie `PresetDef` 的全部字段，再把缺的厂商补齐。

契约变更（`packages/provider-catalog` schemaVersion 2）：

```jsonc
{
  "id": "baidu-qianfan",
  "name": "Baidu Qianfan",
  "group": "vendor",                 // vendor | relay | local
  "regions": [                       // 第一个是默认；UI 按 regionLabel 命名
    { "id": "personal", "name": "Token Plan Personal",
      "endpoints": { "chat_completions": "…/v2/tokenplan/personal",
                     "responses": "…/v2/tokenplan/personal",
                     "messages": "…/anthropic/tokenplan/personal" },
      "noList": true, "models": ["ernie-5.0", "…"] },
    { "id": "api", "name": "Pay as you go", "endpoints": { "…": "…" } }
  ],
  "regionLabel": "Plan",
  "headerHints": ["X-Ark-Plan"],      // 编辑器提供但值由用户填
  "only": "kimi-",                   // 计划 key 只看以此开头的模型
  "endpointRequired": { "example": "https://<resource>.openai.azure.com", "hint": "…" },
  "hosts": true,                     // relay 列表不是 maker 的话（Groq/Ollama Cloud）
  "balance": { "kind": "deepseek" | "custom", "url": "…", "path": "/data/balance" },
  "planQuota": { "kind": "zhipu" | "kimi-code" | "minimax" | "…" },
  "keysUrl": "…", "website": "…", "sponsored": false, "note": "…"
}
```

现有 `endpoints`（`ModelProviderEndpointsV1`）已经是三协议分离，regions 复用它。
`presetSource.mode: 'api' | 'token-plan'` 继续保留，和 regions 不冲突：
region 决定 URL，mode 决定计价/额度语义。

补齐清单（按优先级）：

1. 中国云厂商：Qwen/DashScope（intl、cn、token-plan 三区）、Baidu Qianfan
   （personal/team/api）、Huawei Cloud MaaS（plan/api）、Tencent Cloud
   （plan/cn/intl）、Volcengine 补 region 字段统一三个现有预设。
2. 云与本地：Amazon Bedrock（noList + models）、Azure OpenAI（endpointRequired）、
   NVIDIA NIM、ModelScope、Ollama Cloud 已有、oMLX。
3. relay：Kilo、OpenCode Zen、CommandCode、PipeLLM、CherryIN、yylx（三区）、
   Cloudflare Workers AI。

涉及文件：`packages/provider-catalog/src/*`、
`src/shared/model-provider-preset-types.ts`、`model-provider-preset-catalog-*.ts`、
`src/shared/app-settings-types-provider.ts`、`src/shared/openai-compat-url.ts`、
`kun/src/contracts/model-endpoint-format.ts`、渲染层
`settings-section-providers-*.tsx` 的添加面板（region 选择器、header hints）。

验收：

- 每个预设一条 URL 快照测试：chat/responses/messages 三条最终 URL
  （历史上 gemini 预设多拼了一层 `/v1`，这类错误要被快照拦住）。
- `only`/`noList`/`regions` 的 zod 校验，schema v1 定义仍可加载。
- 预设更新不覆盖已存在用户连接（现有契约保持）。

风险：region 和已有 `-token-plan` profile 后缀的迁移。处理：迁移时把
`presetSource.mode === 'token-plan'` 映射到对应 region id，不新建 profile。

### WS2 模型目录融合

目标：vendor 实时列表为真，models.dev 只补元数据；per-provider 覆盖层级清晰。

变更：

- `modelProfiles[id].wireId`：请求出站时用的上游名；只影响 model 字段，
  目录、路由、账本、价格仍用 Kun 认识的 id。支持 `provider/*` 通配。
- 价格查找顺序固定为：模型自身 → `provider/*` → provider 自带目录 → models.dev。
  窗口/输出上限同序。长上下文 tier 价格沿用 models.dev `cost.tiers`。
- discovery refresh 增加"清理失效选择"动作，默认仍是保留供修复。
- 新增 `hosts` 标志：relay 列表不写回 maker 的 catalogSources。

涉及文件：`kun/src/services/provider-catalog-operations.ts`、
`model-catalog-store.ts`、`kun/src/adapters/model/catalog-pricing.ts`、
`src/main/models-dev-catalog*.ts`、`src/main/upstream-models.ts`、
`compat-request-builder.ts`（wireId 替换点，只在出站 body）。

验收：价格层级单测四层各一；wireId 替换只出现在出站 body 与 count_tokens；
`served_model` 与 wireId 比对不误判为模型被换。

### WS3 网关对外约定

目标：任何有 base URL 设置的 agent，照文档改两个环境变量就能接上。

1. `/v1/models` 富元数据。每条增加 `display_name`、`reasoning`、
   `supported_reasoning_levels: [{effort}]`、`context_window`、`max_output_tokens`、
   `modalities`、`native_endpoints`。pool 只列所有成员都支持的档位。支持
   `?format=text`。数据来源是 `modelProfiles`，未知字段不输出，不猜。
2. 发现：`GET /api/hello` 返回 `{name:"kun", version, gateway:{port, v1}}`；
   在 `~/.kun/gateway.json` 写只读发现文件（port、`hello` URL），
   不含任何 key。
3. 归因：D3 的命名 key + UA 首词。账本 `agent` 字段落库，用量页按 agent 分组。
4. 路由 trace：`GET /v1/kun/route?session=<id>&after=<seq>&wait=<s>`，
   返回 asked/group/rule/model/effort/tries/done/served。实现复用
   `provider-route-preview.ts` 的决策结构，加一个按 session 的环形缓冲。
5. 账号钉住：`X-Kun-Account` 只在显式开启多账号组时生效，未知账号报错不漂移。
6. 推理透传：Anthropic 入口的签名 thinking block 作为 opaque 字段原样回传，
   仅当目标 provider 与签名来源一致时放行，跨 provider 剥离。这是解除
   Claude Code `MAX_THINKING_TOKENS=0` 的前提。OpenAI Responses 的
   `reasoning.encrypted_content` 同理。
7. 错误形状按入口协议返回；上游诊断文本不回显（现有）。
8. Gemini-native ingress 放 P2（P5 提案 2.1/2.2），Gemini CLI 依赖它。

涉及文件：`kun/src/server/routes/model-gateway-core.ts`（拆：models 元数据
独立到 `gateway-models-catalog.ts`）、`openai-model-gateway.ts`、
`anthropic-messages-gateway.ts`、`anthropic-gateway-input.ts`、
`openai-gateway-output.ts`、`gateway-usage-service.ts`、`health.ts`、
`kun/src/server/routes/index.ts`。

验收：

- 协议矩阵 golden fixtures：3 入口 × 3 出口 = 9 格，每格覆盖纯文本、
  流式、工具调用、并行工具、图片、reasoning、取消。Gemini 入口上线后 12 格。
- 真实客户端冒烟沿用现有 pinned 版本机制（Codex 0.160.0、Claude Code 2.1.220、
  OpenCode 1.1.47、Pi 0.73.1），新增 Claude Code 开启 thinking 的用例。

### WS4 外部 agent 接入层（Agents 页）

目标：Kun 的 Connection Center 从"4 个客户端 + 隔离目录"变成 magpie 式的
Agents 页：检测已安装、一键连接、选模型、断开还原。

结构：

```
kun/src/harness/agent-wiring/
  registry.ts            # 适配器注册表 + 检测
  adapter.ts             # 接口：id/name/icon/bin/dir/path/fields/ua/notice/sync/unwire/join
  edit/                  # 配置编辑库：json、jsonc、toml、yaml、dotenv
  adapters/claude-code.ts, codex.ts, opencode.ts, pi.ts, gemini-cli.ts, crush.ts, …
  stash.ts               # 连接前的原值，按 agent+key 存，断开时还原
  profiles.ts            # "Budget"/"Focus"：一组 agent → 模型 的命名快照
```

配置编辑库是 magpie `internal/edit` 的核心价值，必须在 TS 侧重建：
只改目标键、其他字节原样保留、CRLF/BOM/尾换行保持。库选型：
JSON/JSONC 用 `jsonc-parser` 的 `modify` + `applyEdits`；TOML 用带 AST 的
`@ltd/j-toml` 或自研最小 patcher（magpie 的 toml.go 可作参考）；YAML 用
`yaml` 的 Document API；dotenv 逐行替换。编辑库先做，适配器后做。

适配器接口（对齐 magpie `Agent`）：

- `detect()`：bin 在 PATH 或 dir 存在。
- `fields`：model、effort、small-model 等，每个有 get/set/options。
- `connect(model)`：写 provider 条目 + 模型；`disconnect()`：按 stash 还原；
  `set('')` 回到 agent 默认。
- `ua`：User-Agent 前缀，供 WS3 归因。
- `sync()`：为读文件目录的 agent 重写模型列表（Codex `model_catalog_json`、
  Pi `models.json`、OpenCode `limit`）。
- `notice()`：是否需要重启。

首批（P0）：Claude Code、Codex、OpenCode、Pi（现有 4 个改为双模式）。
第二批（P1）：Crush、Cline、Droid、Goose、Cursor CLI、Copilot CLI。
第三批（P2）：Gemini CLI（需 Gemini ingress）、Zed、VS Code Chat、
JetBrains Air、Hermes、Qoder。

Claude Code 细节（从 magpie `claude.go` 吸收）：

- 写 `settings.json` 的 `env`：`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、
  三个 tier 的 `ANTHROPIC_DEFAULT_*_MODEL`、`ANTHROPIC_SMALL_FAST_MODEL`、
  `CLAUDE_CODE_SUBAGENT_MODEL`；不写 `ANTHROPIC_MODEL`（它压过 `/model`）。
- effort：按模型版本裁剪可选档位；`max` 只能走 `CLAUDE_CODE_EFFORT_LEVEL`。
- `[1m]` 后缀模型加 `context-1m` beta。
- 选原生模型（opus/sonnet）时移除以上键并还原。

Codex 细节：写 `[model_providers.kun]` 表、`model_provider = "kun"`、
`model_catalog_json` 指向 Kun 写的目录文件；断开时删除 `model_provider` 与
`model_catalog_json`，保留表以便旧线程可打开；Codex 读配置在启动时，提示重启。

与现有 Agent Center 的关系：`expand-agent-integrations` 做的是 Kun 驱动外部
agent（harness，反方向）。本工作线是外部 agent 使用 Kun 的模型。两者共用
检测逻辑（bin/dir），不共用配置写入。UI 上放在同一个 Agents 页的两个 tab。

涉及文件：`src/shared/gateway-client-setup.ts`、
`src/main/services/gateway-launch-profile-service.ts`、
`kun/src/harness/gateway-config-templates.ts`、渲染层
`gateway-connection-center.tsx`、`gateway-launch-profile.tsx`。

验收（每个适配器必备）：临时 HOME 下 connect → switch → disconnect，
最终文件与初始文件字节一致；带注释的 JSONC/TOML 样例注释不丢；
CRLF 文件保持 CRLF；外部进程先改了文件时拒绝覆盖并提示。

### WS5 路由精细化

目标：补齐 magpie 的组内决策能力，同时保持 Kun 现有策略与导出政策不变。

变更（`ModelRoutePoolV1` 增量，全部可选）：

- `rules[]`：`when` 条件（agent、pattern、hours、tokensOver、images、effort、
  compact）→ `use` 成员排前；turn 开始时决定，整个 turn 内不变；
  trace 记录 `held/waits/grown`。
- `overflowMove`：请求估算 tokens ≥ 成员窗口 95% 时迁移到窗口更大的成员，
  是 turn 内唯一允许的移动。
- `members[].effort`：按成员固定推理档位（`provider/model:low`）。
- `strategy: 'manual'` + `pick`：CC Switch 式手动选中。
- `members[]` 允许 `pool/<id>` 嵌套（P5 4.1，编译成 DAG，拒绝环，
  共享尝试预算 4 次与 120s deadline）。
- `intent`：可选小模型分类，一 turn 一次，8s 超时，失败即无 intent，
  分类调用记入账本为 Kun 自身调用。放 P3。
- `pace`/`smart` 订阅感知策略：依赖 WS6 的额度窗口数据，放 P2。
- 亲和落盘：`route-affinity.ts` 增加 `affinity.json` 持久化，
  最近 512 条、24h 过期；`auto` 模式按上次 cache 读取量 ≥ 1024 且未冷却
  5 分钟决定是否保持。

先清旧账：memory 记录的 09-25 审查 19 条里，adaptive 未评分目标得满分、
quota 误判、endpoints 未落地、probe 走 RoutePool 已由后续提交修复；
残余项（CC Switch 导入配对错误、quick-add 空模型切换）在本工作线开工前复核。

涉及文件：`kun/src/adapters/model/route-pool-model-client.ts`、
`route-pool-failover-groups.ts`、`route-affinity.ts`、`route-target-order.ts`、
`gateway-routing-budget.ts`、`src/shared/app-settings-provider-failover.ts`、
渲染层 `settings-section-model-routes-*.tsx`。

验收：rules 决策单测（held/grown/unready/then）；嵌套环检测；溢出迁移只发生
一次；亲和重启恢复；现有 route-pool 测试全绿。

### WS6 余额、额度、成本

目标：用量页能像 magpie 一样显示每个 key/计划/订阅"还剩多少、何时重置"。

变更：

- 解析器注册表 `kun/src/services/provider-balance/`：DeepSeek `/user/balance`、
  Kimi、OpenRouter、SiliconFlow、StepFun、AiHubMix，以及自定义
  `balanceUrl + jsonPath`（new-api 系 relay 的 `/api/user/self`）。
- 计划额度解析器扩展现有 `provider-quota-service-provider-parsers.ts`：
  Zhipu/Z.ai 已有，补 Kimi Code、MiniMax、Volcengine、CommandCode、StepFun。
- 重置提醒：窗口剩余 > 阈值且 < N 小时重置时通知。
- `kun quota wait <provider|account>`：轮询到有额度退出 0。
- 价格覆盖层级（WS2）；cost 硬限额作为 client key policy 的可选项，
  估算口径与现有 cost alert 一致，明确标注"估算非账单"。
- OTLP 导出放 P3；按 session 读取 agent 会话文件归因放 P3。

安全边界沿用现有契约：余额/额度请求使用独立 purpose 的凭据授权，
不能借用推理凭据的 host 许可。

验收：每个解析器一份真实响应 fixture；超时隔离测试沿用
`provider-quota-timeout-isolation.test.ts`。

### WS7 插件生态

目标：第三方能给 Kun 加模型来源与请求改写，而核心不背 ToS 风险。

1. extension provider 导出到网关（P5 4.3）：manifest 声明
   `gatewayExport: { protocols: [...] }`，经现有扩展权限审查后进入
   `exposableProvider`；安装不改变已有 client 的授权范围。
2. OpenCode auth 插件兼容壳：Kun 是 Node，可直接 `import()` npm 包，提供
   `PluginInput` 的 `client.auth.get/set`（落 extension credential store）、
   `tui.showToast`、`app.log`、`$`。把插件注册的 provider 包装成
   `ModelProviderAdapter`。按 D1 门控，默认不导出。
   这一步一旦完成，`magpie-community/plugins` 的订阅插件理论上可直接复用。
3. 网关中间件：hooks 配置新增三阶段 `GatewayRequest`、`GatewayEvent`、
   `GatewayResponse`，JS 文件跑在 `node:vm` 沙箱（无 fetch/timer/require），
   限时 250ms/50ms/250ms，超时或抛错即 fail-open 保持原样；
   每个中间件统计调用数、耗时、失败数。先内置 `model-map`、`system-prompt`、
   `think-tags` 三个。

涉及文件：`kun/src/extensions/*`、`kun/src/adapters/model/extension-model-provider.ts`、
`kun/src/hooks/*`、`docs/kun-hooks.md`、`docs/extensions/providers-and-accounts.md`。

验收：中间件 fail-open 单测；沙箱逃逸基线测试；插件壳用一个最小 OpenCode
插件 fixture 做 sign-in → models → stream 三步。

### WS8 CLI 对齐

目标：headless 与脚本场景可用，和 GUI 共用 HTTP 管理面。

```
kun provider add deepseek sk-…            # 预设只要 key
kun provider add "My Relay" url=… key=… models=a,b
kun providers | provider <id> | provider test <id> | provider models <id>
kun models                                # 网关目录，含档位与窗口
kun claude deepseek/deepseek-v4-pro       # 连接 Claude Code（WS4）
kun codex group/daily | kun opencode …
kun group add "Daily" models=… routing=order stays=session
kun gateway-key add "Laptop" | list | rotate | remove | limit | models
kun quota | kun quota wait <provider>
kun save work && kun use work             # profiles（WS4）
kun import 'kun://import?preset=…'        # 已有链接解析复用
```

全部走现有 admin HTTP 路由（`/v1/provider-config/*`、gateway clients），
不绕过事务预览/提交。放在 `kun/src/cli/provider-cli.ts` 与 `gateway-cli.ts`。

## 4. 分期与依赖

```
P0 (对外约定 + 接入基础)           P1 (路由与额度)            P2 (协议与生态)             P3
WS3.1 /v1/models 元数据 ─┐        WS5 rules/溢出/亲和落盘    WS3.8 Gemini ingress ──► WS4 第三批
WS3.2 hello + 发现文件   │        WS6 余额/计划额度注册表    WS5 嵌套组 + pace/smart    WS5 intent
WS3.3 命名 key 归因      ├─► WS4 第二批 adapter            WS7.1 extension 导出        WS7.2 OpenCode 壳(D1)
WS3.6 thinking 透传 ─────┘        WS8 CLI 核心               WS7.3 网关中间件           WS6 OTLP/session 归因
WS1 schema v2 + 首批预设          WS2 价格层级/wireId        WS1 第三批预设             LAN / remote kun
WS4 编辑库 + 首批 4 个接管模式                                https 导入落地页
```

每期的准入 gate：

- P0：Claude Code 开 thinking 通过网关跑完一个带工具的 turn；Codex 接管模式
  connect/disconnect 字节还原；`/v1/models` 对 Pi 与 OpenCode 显示档位；
  12 个新预设 URL 快照全绿。
- P1：rules 与溢出迁移的 trace 可在 Routing 页看到；DeepSeek/Kimi 余额显示；
  `kun provider add` 到 `kun claude` 一条龙在干净机器上跑通。
- P2：Gemini CLI 通过网关跑通；一个 extension provider 出现在 `/v1/models`；
  `model-map` 中间件生效且 fail-open 测试通过。
- P3：按 D1 决定是否发布 OpenCode 壳；LAN 仍默认关闭。

## 5. 风险与不做清单

- **不做** Claude binary bridge；不做默认开启的 LAN；不移植 magpie 的
  订阅登录实现（Devin/Qoder/Kiro/WorkBuddy 等）。
- **不直接复制代码**：magpie 是 Go，Kun 是 TS，只借设计；若借用片段须保留
  MIT 声明（现有 `docs/local-model-gateway.md` 已有此约束）。
- **700 行门槛**：magpie 的 `gateway.go` 4315 行、`claude_subscription.go`
  3125 行在 Kun 必须按上面的目录拆分；`model-gateway-core.ts` 已 635 行，
  WS3 开工第一步就是拆出 models 目录与 trace 模块。
- **契约一致性**：endpoint/URL 变更要同时检查 AGENTS.md 列出的 9 个消费者
  （write-inline、scheduled-task、model list、probe、chat 各自 body 不同）。
- **Settings 迁移**：regions 与 `-token-plan` 后缀、新增 pool 字段全部可选，
  v1 回退投影必须能表达，否则按现有规则阻止降级。
- **测试基线**：develop 现有红测试按 memory 清单区分，新工作线不得新增红项。

## 6. 概念对照（magpie → Kun）

| magpie | Kun |
| --- | --- |
| `provider/model` | `providerId/modelId`（网关 `exposeProviderModels` 开启时） |
| `group/<id>` | route pool 的公开别名 `modelId` |
| gateway key（`sk-magpie-key-…`） | gateway client key + policy |
| `magpie-<app>` 归因 key | D3 的命名归因 key |
| Agents 页 | Connection Center（WS4 后改名 Agents，双 tab） |
| Profiles（save/use） | WS4 `profiles.ts` |
| Routing 页的 trace | WS3.4 `/v1/kun/route` + Routing 页 |
| `magpie://import` | `kun://import`（已有） |
| Library（instructions/MCP/skills 下发） | 暂不覆盖；Kun 的 skills/MCP 配置是自己的体系 |
| Remote magpie | P3 LAN/remote kun |

## 7. 实施记录（2026-10-06）

D1、D2、D3 按第 2 节的建议执行。已实现：

- WS1：catalog schema v2（regions、分协议端点、header 提示、noList、端点提示、余额/计划额度来源），新增 14 个预设，Azure 使用 `api-key` 头，所有预设请求 URL 快照测试。
- WS2：`wireModelId` 上游改名（`*` 代表模型 id）与 `*` 供应商级默认档案（按字段回退）。
- WS3：`/v1/models` 元数据与 `?format=text`、`/api/hello`、`~/.kun/gateway.json`、`kun-<app>.` 归因前缀与按 agent 计量、`/v1/kun/route` 长轮询轨迹、Anthropic thinking 透传与按 tool-call id 还原签名、Gemini 原生入口。
- WS4：字节保留的 JSONC/TOML/dotenv 编辑器，Claude Code、Codex、OpenCode、Pi、Gemini CLI、Crush、Droid 七个适配器，Agents 面板、方案（profiles）与目录同步。
- WS5：轮次规则与意图分类、成员固定推理强度、手动选择、95% 窗口降级、嵌套路由、亲和落盘、账号组 `pace` 策略。
- WS6：SiliconFlow、StepFun、AiHubMix、new-api 余额，客户端密钥成本硬限额，额度重置提醒。
- WS7：网关中间件（模型映射、系统提示词、think 标签、脚本），扩展 provider 导出，ChatGPT 订阅的实验性导出开关。
- WS8：`kun gateway|agents|quota` 命令。

未实现：OpenCode 认证插件兼容壳。它需要在 Kun 内托管 npm 插件、复刻 OpenCode 的插件运行时与 AI SDK fetch 约定，工作量与 ToS 风险都超出本轮；D1 的结论是默认不导出订阅，扩展 provider 导出已提供受控的第三方模型来源。LAN/远程共享、embeddings/rerank、媒体导出仍属 P5 提案。
