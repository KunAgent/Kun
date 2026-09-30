# 原生 Agent 适配层计划（P6）：统一会话抽象 + Codex App Server + Pi RPC

- 日期：2026-09-29
- 基线：`develop@3093f113b`（P4 已合入；P5 为界面计划，见 [p5-agent-setup-ui.md](./p5-agent-setup-ui.md)）
- 参考：Cindy `packages/maker-core` 的 `BaseAgent` / `AgentSessionHandle` / `AgentEvent`，以及 Claude Code（Agent SDK）、Codex（App Server）、Pi（`pi --mode rpc`）三个专属适配器。
- 背景：ADE 设计把"Codex 深度适配（app-server 协议）"列为待定项（[README](../README.md) §7 P2、[13](../13-governance-rollout.md) §7），先用 ACP 适配器顶上。实际使用中，Codex 必须另装第三方 `codex-acp`，这是 P4 诊断里最常见的"不可用"原因（[p4](./p4-usable-ade.md) §1.2）；而且 ACP 本身不提供插话、分叉、回退（`kun/src/runtime/acp/acp-capabilities.ts` 头注）。本文参照 Cindy 的分层，给 Kun 引入会话级的统一适配抽象，并在其上实现 Codex App Server 与 Pi RPC 两个原生适配器。
- 详细计划（本文是方向与决策篇，实施按下面两份执行）：
  - [p6a-session-codex.md](./p6a-session-codex.md)：P6-01~P6-08——共用会话层契约与文件清单、JSONL/JSON-RPC 传输规格、Codex 协议快照、会话/轮次/审批/事件映射表、网关接入、回退开关、真机验证矩阵。
  - [p6b-pi-acceptance.md](./p6b-pi-acceptance.md)：P6-09~P6-13——Pi RPC 集成规格、`kun-pi-bridge` 扩展、网关与登录态、真机验收矩阵、回退开关矩阵、Claude/Cursor 迁移评估。

## 1. Cindy 的分层（调研）

```text
Session（packages/maker-core/src/session.ts）
  宿主侧：预留 turn、事件扇出、持久化、交互分派、自动压缩与换窗
        │ 持有
AgentSessionHandle（base-agent.ts:1630）
  send / steer / abort / requestGracefulStop / setModel / setEffort /
  setPermissionMode / setPlanMode / compactSession / getContextUsage / detach
        │ 由 startSession() 返回
BaseAgent（base-agent.ts:1866）
  kind / capabilities / startSession / listAgentCommands / listAgentSkills /
  refreshLocalModels / readAccountRateLimits / oneShot / dispose
        │ 子类
  ├─ ClaudeCodeAgent → Claude Agent SDK
  ├─ CodexAgent      → Codex App Server（JSON-RPC over stdio）
  └─ PiAgent         → Pi RPC（pi --mode rpc，JSONL over stdio）
        │ 各自的 translator.ts 产出
AgentEvent（types/events.ts:143）
  type = text | thinking | tool_use | tool_result | agent_task_update | turn_diff |
         interaction_request | status | compact_boundary | session_id | done | error …
```

要点：

- **能力声明**：`types/capabilities.ts` 里每一项都是 `CapabilityStatus`，UI 按能力判断，而不是按引擎名写分支。
- **传输与协议分离**：Codex 的 `app-server/transport.ts` 和 Pi 的 `pi/transport.ts` 都只负责搬运字节流（本机 stdio 或 SSH 通道）；协议客户端不关心字节流从哪来。
- **Codex 共享进程**：`AppServerHost`（`codex/app-server/host.ts:1-24`）让一个 `codex app-server` 进程服务 N 个会话，按 `threadId` 分发通知。进程在首次使用时才启动；会话关闭时发 `thread/unsubscribe`，进程本身跟应用同生命周期。另外它缓存早到的通知，处理 `thread/start` 响应与 `thread/started` 通知之间的竞争。
- **Codex 用到的方法**（`codex/app-server/protocol.ts:1202-1233`）：
  - 会话与轮次：`initialize`，`thread/start|resume|fork|rollback|unsubscribe|settings/update`，`turn/start|steer|interrupt`。
  - 查询：`model/list`、`skills/list`、`mcpServerStatus/list`、`account/rateLimits/read`、`config/read`。
  - 服务端请求：`item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval`、`item/tool/requestUserInput`、`mcpServer/elicitation/request`、`item/tool/call`。
- **Pi 的做法**（`docs/dev-rules/pi-harness.md` §1、§4）：
  - 帧格式是严格的 JSONL，只按 LF 切分，不能用 `readline`（它会在 JSON 字符串里合法的 U+2028/U+2029 处断行）。
  - Pi 本身**没有工具审批**，Cindy 注入自有的 bridge 扩展，在 `tool_call` 处拦截，经 `extension_ui_request` 转成宿主的审批请求。权限档写在按会话的文件里，每次调用都重新读，所以可以热切换。
  - 模型写进 `PI_CODING_AGENT_DIR/models.json`，密钥用 `$ENV` 插值，不落盘。
  - 启动时固定带 `--no-approve --no-extensions`，再显式装回自有扩展。
  - 同一会话重建时，spawn env 必须逐字节不变。
  - 用户输入以 `/` 开头时要转义，否则会被当成扩展命令执行。
  - 权限档从严到宽排序。
- **代价**：抽象没有消灭各引擎自己的复杂度，只是把它圈在了子类里——`codex/index.ts` 12,387 行，`claude-code/index.ts` 6,812 行，`pi/index.ts` 6,622 行。Kun 有 700 行上限，必须按内聚功能拆文件（§5）。

## 2. Kun 现状与对照

```text
AgentLoop turn 生命周期
  → HarnessRouter（kun/src/harness/harness-router.ts）按 HarnessRoute 选运行时
  → DelegatedTurnRuntime.runTurn(threadId, turnId, signal, providerId)
     （kun/src/runtime/delegated-turn-runtime.ts:21-44；一个 runtime 拥有整轮）
       ├─ agent-sdk        Claude Code（Agent SDK）
       ├─ cursor-sdk       Cursor（SDK）
       ├─ antigravity-cli  Antigravity（CLI）
       └─ acp              通用 ACP：Gemini CLI、Codex（经 codex-acp）、OpenCode、自定义
  → 各自的 event-mapper 直接产出 Kun 的 RuntimeEventDraft / TurnItem
```

| 维度 | Cindy | Kun | 判断 |
| --- | --- | --- | --- |
| 抽象粒度 | 会话句柄：长生命周期，带 send / steer / abort / set* | turn 级：`runTurn` 拥有整轮，原生会话靠 `DelegatedSessionCoordinator` 绑定 | 缺一个会话级接口 |
| 统一事件 | `AgentEvent`（厂商中立，`Session` 再落库） | 直接映射到 Kun timeline 的 `RuntimeEventDraft` | Kun 的 timeline 契约就是统一事件；**不再加一层内容事件**，否则等于两次翻译（对应 Cindy "禁止双重转义"原则） |
| 能力声明 | `Capabilities` | `HarnessCapabilities` v2（`contracts/harness-capabilities.ts`，24 项能力 + 3 项事实） | 已经等价 |
| 共用逻辑 | `BaseAgent` 加 `agents/shared/`（自动压缩、自动审查、用量统计等） | 只共用 `DelegatedSessionCoordinator`；event-mapper、tool-bridge、lifecycle、trace、失败映射每个 runtime 各写一份（`kun/src/runtime/` 非测试代码约 16k 行） | 需要抽共用层 |
| Claude Code | Agent SDK | Agent SDK | 一致 |
| Codex | App Server | ACP，经第三方 `codex-acp` | 要换成原生协议 |
| Pi | `pi --mode rpc` | 没有 | 要新增 |

结论：

1. Kun **不照搬** `AgentEvent`。文本、推理、工具这些内容仍由各适配器直接映射成 `RuntimeEventDraft`。
2. 需要统一的是**会话生命周期和控制面**：会话的新建、恢复、停泊，审批，用户输入，用量，上下文占用，计划，diff，插话，中断，失败分类。
3. 做法是在 `DelegatedTurnRuntime` 之下加一层会话级适配接口，再写一个通用 runtime 实现 `DelegatedTurnRuntime`。以后新增一个原生 agent，只需要写协议客户端和内容映射。

## 3. 目标设计

### 3.1 三个接口（`kun/src/runtime/session/`）

```ts
/** 一种接入方式（与 HarnessTransport 一一对应）的适配器；进程级，可服务多个会话。 */
interface HarnessAgent {
  readonly transport: HarnessTransport            // 'acp' | 'codex-app-server' | 'pi-rpc' | …
  capabilities(route: HarnessRoute): HarnessCapabilities
  startSession(input: HarnessSessionStart): Promise<HarnessSession> // 新建，或按 nativeSessionId 恢复
  listModels?(route: HarnessRoute): Promise<HarnessModelList>
  readAccount?(identity: CredentialIdentity): Promise<HarnessAccountSnapshot> // 登录态 + 额度
  startLogin?(methodId: string): Promise<HarnessLoginFlow>                     // agent 自己的登录
  dispose(): Promise<void>
}

/** 一个原生会话。所有控制方法都是能力位可选的，缺失时由能力表显式标为 unsupported。 */
interface HarnessSession {
  readonly nativeSessionId: string
  prompt(input: HarnessTurnInput, sink: HarnessTurnSink, signal: AbortSignal): Promise<HarnessTurnResult>
  steer?(input: HarnessTurnInput): Promise<void>
  interrupt(): Promise<void>
  setModel?(model: string, effort?: string): Promise<void>
  setPermissionMode?(modeId: string): Promise<void>
  fork?(): Promise<{ nativeSessionId: string }>
  compact?(): Promise<void>
  close(reason: 'park' | 'release' | 'shutdown'): Promise<void>
}

/** 适配器 → 通用 runtime 的唯一出口。内容走 timeline，控制面走专门的方法。 */
interface HarnessTurnSink {
  timeline(draft: RuntimeEventDraft): void
  requestApproval(request: HarnessApprovalRequest): Promise<HarnessApprovalDecision>
  requestUserInput(request: HarnessUserInputRequest): Promise<HarnessUserInputAnswer>
  usage(usage: HarnessUsage): void
  contextUsage(used: number, size: number): void
  plan(steps: HarnessPlanStep[]): void
  diff(unifiedDiff: string): void
  rateLimits(snapshot: HarnessRateLimitSnapshot): void
}
```

### 3.2 通用 runtime：`SessionTurnRuntime implements DelegatedTurnRuntime`

以下职责从现有 `AcpRuntime` 中抽出来，由通用 runtime 统一承担，适配器不再各写一份：

| 职责 | 现在的位置 | 抽取后 |
| --- | --- | --- |
| 路由准入、不可变代次 | `handlesRoute` / `resolveProvider` | 通用 |
| 会话绑定、停泊、代次校验 | `acp-session-manager.ts` + `DelegatedSessionCoordinator` | 通用；适配器只提供 `startSession` |
| 新会话注入交接简报（08） | `acp-runtime.ts` | 通用 |
| 凭据环境（原生登录 / 网关令牌 / 生成的配置） | `acp-credential-env.ts` | 通用框架 + 每个适配器提供自己的"生成配置"函数 |
| Kun Tools MCP 注入（P1-07） | `kun-tools-mcp.ts` | 通用 |
| 审批 → Kun 审批流水线（策略 → reviewer → 用户） | `acp-permission.ts` | 通用；适配器只负责协议形状的转换 |
| 用户输入与 elicitation（P2-10） | `acp-elicitation.ts` | 通用 |
| 草稿落 timeline | `acp-turn-emitter.ts` | 通用 |
| 用量、流限制、trace、失败 → `finishTurn` 映射 | `acp-runtime-support.ts` | 通用 |
| 真实 turn 失败时回写就绪状态（P4-03） | 分散 | 通用 |

### 3.3 进程宿主与传输（`kun/src/runtime/session/`）

- **`JsonLineTransport`**：严格按 LF 分帧，可剥离行尾的 CR，单行有最大字节数保护，stderr 尾部脱敏。ACP（`acp-jsonrpc.ts`）、Codex（JSON-RPC，线上不带 `jsonrpc` 字段）、Pi（带 `id` 的 JSONL）三者共用这一个实现。
- **`HarnessProcessHost`**：把 `acp-connection-pool.ts` 推广成通用组件。
  - 按 `${harnessId}:${credentialIdentity}` 引用计数，空闲超时后释放。
  - 进程意外退出时，把它承载的会话绑定标记为 `native_state_unavailable`。
  - 进程一律经 `spawnOwnedProcess` 启动（`kun/src/process/owned-process.ts`），沿用受管启动器与退出屏障。
- **多路复用方式**：
  - Codex：一个 app-server 进程承载多个 thread，与 Cindy 的 `AppServerHost` 相同。
  - Pi：RPC 是单会话的，一个进程对应一个会话，空闲时停泊。
  - ACP：保持现状，一个进程承载多个会话。

### 3.4 `CodexAppServerAgent`

- **启动**：`codex app-server`，配置用 `-c key=value` 覆盖。本机 `codex-cli 0.145.0` 已经带这个子命令，但标注为 `[experimental]`，另有 `generate-ts` 和 `generate-json-schema` 两个子命令可以生成协议定义。**不再需要 `codex-acp`**。
- **协议类型**：新脚本 `scripts/update-codex-app-server-schema.mjs` 用固定版本的 `codex app-server generate-json-schema` 生成 schema，只挑出用到的子集，写成 zod 放在 `kun/src/runtime/codex/protocol/`，在边界处校验。同时录制真实二进制的会话，放进 `__fixtures__/recorded/`，做回放测试（沿用 ACP 的做法）。
- **映射**：

| Kun 需要的 | App Server | 落点 |
| --- | --- | --- |
| 新建 / 恢复 / 分叉 | `thread/start` / `thread/resume` / `thread/fork` | `startSession`、`fork` |
| 一轮 | `turn/start`（文本 + 图片、cwd、模型、推理档位、审批策略 / 沙箱）→ `turn/started`、`item/*`、`turn/completed` | `prompt` |
| 运行中插话 | `turn/steer` | `steer`，`sameTurnSteer` 能力变为支持 |
| 中断 | `turn/interrupt` | `interrupt` |
| 审批 | `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval` | `sink.requestApproval` |
| 提问 | `item/tool/requestUserInput`；`mcpServer/elicitation/request` | `sink.requestUserInput` |
| Kun 工具 | 用 `-c mcp_servers.kun=…` 配置 Kun Tools MCP（P1-07） | 通用 MCP 注入 |
| 用量 / 上下文 | `thread/tokenUsage/updated` | `sink.usage`、`sink.contextUsage` |
| 计划 | `turn/plan/updated` | `sink.plan` |
| diff | `turn/diff/updated` | `sink.diff`（审查面板的提示） |
| 模型 | `model/list`（含推理档位） | `listModels`，取代 ACP 的 `session/new` 探测 |
| 登录态 | `account/read` | `readAccount`，取代现在一律为 `unknown` 的 ACP 登录态 |
| 额度 | `account/rateLimits/read` | `sink.rateLimits`；供 worker 选择的额度快照使用（P1-15） |
| 登录 | `account/login/start` / `account/login/cancel`（浏览器或设备码） | `startLogin`；凭据由 Codex 自己写入，Kun 只转交链接和设备码（P5 §5.4） |
| 走 Kun 网关 | 复用 `acp-credential-env.ts` 的 `codexConfig`：生成 `CODEX_HOME/config.toml`，其中 `model_providers.kun` 设 `wire_api = "responses"` | 通用凭据环境 |

- **注意事项**：
  - app-server 仍是实验性接口，版本升级可能改动协议（风险与对策见 §6）。
  - 上游 README 写明：带 `cwd` 调用 `thread/start`、且沙箱为可写或完全访问时，会把该项目标记为受信任，写入用户的 `config.toml`。原生登录模式用的是用户自己的 `CODEX_HOME`，这个副作用会落到用户配置里（见 D5）。网关模式用的是 Kun 生成的 `CODEX_HOME`，不受影响。

### 3.5 `PiRpcAgent`

- **启动**：`pi --mode rpc --no-approve --no-extensions --extension <kun-pi-bridge> --session-dir <dataDir>/harness/pi/sessions`。前三个参数的用法沿用 Cindy 不变量 8；启动参数以实机的 `pi --help` 为准。
- **原生登录与网关**（与 Codex 对称，见 D2）：
  - 原生登录：用 Pi 默认的 agent 目录，也就是用户自己的登录。
  - 走 Kun 网关：`PI_CODING_AGENT_DIR` 指向 Kun 生成的目录，其中 `models.json` 只有一个 `kun` provider：`api` 为 `openai-completions`（对应网关 `/v1/chat/completions`）或 `anthropic-messages`（对应网关的 messages 入口），`baseUrl` 指向本机网关，`apiKey` 用 `$KUN_PI_GATEWAY_TOKEN` 插值。令牌是按路由限定的 `kgw_`，和其他 harness 一样。
- **审批**：Pi 没有原生审批。Kun 在仓库里维护一个很小的 `kun-pi-bridge` 扩展：
  - 在 `tool_call` 处拦截，经 `extension_ui_request` 转进 `sink.requestApproval`。
  - 权限档写在按会话的文件里，每次调用重新读，支持热切换。
  - 扩展源码的哈希算进启动身份，内容不变时才能复用进程。
  - "完全访问"不是安全边界：Pi 的 bash 能读到父进程环境。这一点照 Cindy `pi-harness.md` §1 的写法，在界面和文档里如实说明（与 13 §2.3 一致）。
- **映射**：
  - 输入：`prompt` / `steer` / `follow_up` / `abort`。
  - 输出：`message_update`（文本与推理增量）；`tool_execution_start|update|end`；compaction 相关事件。
  - **一轮的结束以 `agent_settled` 为准**，不是 `agent_end`：`agent_end` 之后仍可能有重试或后续工作（Pi 官方 `docs/rpc.md`）。
  - 模型：`get_available_models`、`set_model`、`set_thinking_level`。用量：`get_session_stats`。恢复与分叉：`switch_session` / `fork`。
  - 用户输入以 `/` 开头时先转义（Cindy 不变量 3）。
- **安装**：本机未安装 Pi；安装命令和包名以官方文档为准，实施 P6-09 时核对后写进 `setup` 元数据。

### 3.6 为什么需要专属适配器（修订红线的依据）

`docs/AGENTS.md` 现在的规则是："优先通用 ACP 运行时；只有 ACP 提供不了的能力才需要专用适配器。"下表说明 Codex 和 Pi 满足这个条件：

| 能力 | ACP（Codex 经 `codex-acp`） | Codex App Server | Pi RPC |
| --- | --- | --- | --- |
| 免装第三方适配器 | 否 | 是 | 是（不需要 `pi-acp`） |
| 同一轮插话 | 否 | `turn/steer` | `steer` |
| 分叉 / 回退 | 否 | `thread/fork` / `thread/rollback` | `fork` / 会话树 |
| 模型与推理档位 | `session/new` 的 config options | `model/list` | `get_available_models` + thinking levels |
| 登录态 | 只有 `authMethods`，不等于未登录（P5 §3 #6） | `account/read` | 待实机核对 |
| 订阅额度 | 否 | `account/rateLimits/read` | 否 |
| 审批粒度 | `request_permission` | 命令 / 文件 / 权限三类 | 需要 Kun 扩展 |
| 本轮 diff | 否 | `turn/diff/updated` | 否 |

Gemini CLI、OpenCode 和自定义 agent 继续走 ACP：它们原生支持 ACP，另写适配器没有收益。

### 3.7 对界面的影响（与 P5 衔接）

- Codex 不再有"缺适配器"这一状态。P5 向导中 Codex 的分支变成"安装 CLI → 在应用内登录（`account/login/start`）"；设备码的展示照 Cindy 的 `OAuthDeviceCodeCard`。
- Agent 中心的 Codex 详情页显示订阅额度；总管挑选 worker 时，避开快用完额度的订阅（10 §3.2 的选择算法终于有了 Codex 的额度数据来源）。
- Pi 作为内置 agent 出现，模型来源可选"本机 Pi 账号"或"某个 provider · 经 Kun 网关"。
- Codex 和 Pi 支持插话后，12 §7.3 的"运行中发送"对它们走 `steer`，不再排队等下一轮。

## 4. 迁移原则

1. **先抽取，后新增**：P6-02 只把 `AcpRuntime` 中与协议无关的部分搬进 `SessionTurnRuntime`，行为不变，单独提交（README §2.1 规定抽取重构与新功能分开）。现有 ACP 单测和录制回放测试不改就要全部通过。
2. **Claude Agent SDK 和 Cursor SDK 不强制迁移**：它们是进程内 SDK，会话语义各不相同。等 Codex 和 Pi 落地后再评估，只有确实能消掉重复的 tool-bridge、trace、失败映射时才迁（D4）。Antigravity 不动。
3. **Codex 过渡期保留回退**：一个版本内保留隐藏配置 `agents.kun.harnesses.transportOverrides.codex = 'acp'`，按 README §2.2 做四层同步；之后删除。已有的 Codex 线程如果无法用 `thread/resume` 接上原来的原生会话（需要实测 `codex-acp` 产生的会话能否被读取），就按 `native_state_unavailable` 走确定性交接（08），不静默丢失上下文。
4. **稳定前缀不变**：适配器差异只进每轮的动态上下文和工具结果，不影响 `kun-system-prompt.ts`（13 §6）。

## 5. 实施计划

编号 P6-xx，记法同 [README](./README.md) §3；每个 PR 都要满足 README §2.2 的完成标准。改到 `kun/` 的 PR 要跑 `npm run build:kun`；改到界面的要跑 `npm run smoke:development-ade`。

### 阶段 A：规则与共用层

**P6-01 红线与设计文档修订（S，D）**
- `docs/AGENTS.md`（及 `AGENTS.zh-CN.md`）的 Allowed Extension Path 第 6 条、`13-governance-rollout.md` 的 §4.2（同一条文）、§5（真实二进制冒烟改为 Codex App Server）与 §7（Codex 深度适配改为采纳）、`01-harness-routing.md` 的 transport 枚举：加上 `codex-app-server` 与 `pi-rpc`，并把 §3.6 的对照表写成专属适配器的准入条件。
- 在 `contracts.md` 登记新的 transport、新的隐藏配置和新增的原因码。

**P6-02 抽取会话层：`HarnessAgent` / `HarnessSession` / `HarnessTurnSink` + `SessionTurnRuntime`（L，K）**
- 按 §3.2 的表从 `acp-runtime*.ts` 搬出通用部分；ACP 改为 `AcpAgent implements HarnessAgent`，行为不变。
- 目录 `kun/src/runtime/session/`，每个文件不超过 700 行；`acp-runtime.ts` 现有 661 行，要先拆再搬。
- 测试：ACP 的全部单测和录制回放测试不改就能通过；新增接口的契约测试：一个只实现必需方法的最小假适配器，能跑完整轮、审批、中断和恢复。

**P6-03 共用 JSONL 传输与进程宿主（M，K）**
- 实现 §3.3 的 `JsonLineTransport` 与 `HarnessProcessHost`；ACP 改用它们。
- 测试：U+2028/U+2029 不会被当成断行；CRLF 输入正常；超长行会关闭连接；进程意外退出后会话标为不可用；空闲超时后释放。

### 阶段 B：Codex App Server

**P6-04 协议快照与客户端（M，K）**
- 生成 schema 的脚本、zod 子集、客户端（请求/响应关联、服务端请求路由、按 `threadId` 分发通知、缓存早到的通知）；用本机 `codex-cli 0.145.0` 录制回放夹具。
- 定义最低版本，版本过低时状态为 `version_too_low`（P4-05 的原因码）。

**P6-05 `CodexAppServerAgent`：会话、轮次、内容映射（L，K）**
- 实现 §3.4 映射表的前四行和内容映射；接入 `SessionTurnRuntime`。
- 测试：回放一轮对话，覆盖文本、推理、命令、文件修改、结束；验证插话、中断和恢复；验证 `thread/start` 响应和 `thread/started` 通知的先后竞争。

**P6-06 Codex：审批、提问、Kun 工具、网关（M，K）**
- 三类审批映射到 Kun 审批流水线；`requestUserInput` 和 elicitation；Kun Tools MCP 注入（D3）；网关模式复用 `codexConfig`。
- 测试：审批允许、拒绝与"本轮已批准"；网关模式下子进程环境里只有 `kgw_` 令牌，拿不到 provider 的原始密钥。

**P6-07 Codex：模型、账号、额度、登录（M，K R M）**
- `model/list` 接入 harness 的模型列表接口；`account/read` 接入登录态探测；`account/rateLimits/read` 接入额度快照；`account/login/start|cancel` 接入 P5-03 的登录接口（agent 类登录方式）。
- 渲染层：Agent 中心 Codex 详情页显示额度；登录用设备码卡片。
- 测试：未登录、ChatGPT 登录、API Key 三种账号状态；额度快照进入 worker 选择；登录取消。

**P6-08 Codex 切换与回退（S，K S）**
- 内置定义改为 `transport: 'codex-app-server'`，删掉 `setup.adapter`；加隐藏配置 `transportOverrides.codex` 并做四层同步；实测已有 Codex 线程的恢复路径。
- 测试：两次生成的配置逐字节相同；设为 `acp` 后回到旧路径；恢复不了原生会话时走交接。

### 阶段 C：Pi RPC

**P6-09 Pi 定义、检测与启动（M，K）**
- 内置定义（transport `pi-rpc`、`setup`、权限档从严到宽排序）；按 §3.5 生成启动参数和网关 agent 目录；spawn env 逐字节稳定。
- 测试：生成的 `models.json` 里没有明文密钥；同一会话重建时 env 不变；不传 `--no-extensions` 就不允许启动。

**P6-10 `kun-pi-bridge` 扩展与审批（M，K）**
- 扩展源码、源码哈希、按会话的权限文件、`extension_ui_request` ↔ `sink.requestApproval`。
- 测试：三个权限档的放行与拦截；运行中切换权限档；无法判定时一律拒绝。

**P6-11 `PiRpcAgent`：会话、轮次、内容映射（L，K）**
- 实现 §3.5 的映射；以 `agent_settled` 作为一轮结束；用户输入以 `/` 开头时转义。
- 测试：用假 Pi 进程回放一轮对话，覆盖文本、推理、工具、结束；覆盖插话、中断、恢复、分叉、`agent_end` 之后的重试。

### 阶段 D：验收

**P6-12 真实二进制冒烟与评测（M，D M）**
- 按 13 §5 测试策略表里的"真实二进制冒烟"跑 Codex（原生登录和网关各一遍）与 Pi：一轮对话、一次审批、一次文件修改、一次中断、一次恢复、一次插话。
- ADE 冒烟：Codex 卡片不再出现"缺适配器"；总管派出一个 Codex worker 并收到额度快照。
- 用 P3-16 的评测集对比 ACP 路径与 App Server 路径的完成率和 token 用量（13 §6）。

**P6-13 Claude / Cursor 迁移评估（S，D）**
- 只写评估，不改代码：哪些重复代码能消掉、迁移的风险、结论。

### 顺序

```text
A  P6-01 ─ P6-02 ─ P6-03
B        P6-04 ─ P6-05 ─ P6-06 / P6-07 ─ P6-08
C        P6-09 ─ P6-10 ─ P6-11              （B、C 可并行）
D  P6-12（B、C 各完成时各跑一遍）；P6-13 最后
```

## 6. 风险与对策

| 风险 | 对策 |
| --- | --- |
| app-server 仍是实验性接口，升级可能改协议 | 设最低版本门槛；schema 快照和回放夹具随版本更新；过渡期保留 ACP 回退；真实二进制冒烟进入发布检查清单 |
| 原生登录模式下，Codex 会把项目标记为受信任，写进用户的 `config.toml` | 见 D5 |
| Pi "完全访问"不是安全边界 | 界面与文档如实说明；需要硬边界时用询问档；OS 沙箱另立项（13 §7） |
| Pi 一个进程只服务一个会话，进程会变多 | 空闲停泊并按超时释放；总管并发派 Pi worker 时受现有并发上限约束 |
| P6-02 的抽取影响现有 ACP agent | 行为不变、单独提交、现有测试不改就要通过；出问题整体回滚这一个 PR |
| 700 行上限 | 参考 Cindy 的规模（每个适配器 6k–12k 行），按协议客户端、映射、审批、账号、生命周期拆文件，每个 PR 先列出文件清单 |

## 7. 待决策

| # | 问题 | 选项 | 建议 |
| --- | --- | --- | --- |
| D1 | Codex 什么时候默认切到 App Server | a. P6-08 合入后直接默认，保留隐藏回退；b. 先作为实验室开关，由用户手动开启 | **a**。缺适配器是当前最大的使用障碍；回退只保留一个版本 |
| D2 | Pi 原生登录用哪个目录 | a. 用户默认目录，与 Codex 对称；b. 始终用 Kun 私有目录（Cindy 的做法），登录也在 Kun 里完成 | **a**。Kun 不管理第三方 CLI 的凭据（P5 §8） |
| D3 | Codex 用哪种方式调 Kun 工具 | a. MCP（稳定）；b. `item/tool/call` 动态工具（实验性） | **a**。与其他 harness 走同一套 Kun Tools MCP |
| D4 | Claude Agent SDK 和 Cursor SDK 是否迁到新层 | a. 不承诺，P6-13 评估后再说；b. 一并迁移 | **a** |
| D5 | 原生登录下 Codex 的"项目受信任"副作用 | a. 接受，并在首次使用时提示；b. 原生登录也改用 Kun 生成的 `CODEX_HOME`，再把用户的 `auth.json` 链接进去；c. 仅在只读沙箱下启动 thread | **a**。b 相当于替用户管理凭据文件，c 会限制 worker 的能力；上游行为以实测为准 |
