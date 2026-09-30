# P6a：共用会话层与 Codex App Server（P6-01 ~ P6-08）

承接 `docs/ade/impl/p6-native-agent-adapters.md` 的 §0~§6（目标、架构、Codex/Pi 协议事实）与 §8 决定、§9 风险。
本文给出阶段 A 与阶段 B 的实现级细节；阶段 C/D 见 `p6b-pi-acceptance.md`。

已验证事实（本机 `codex-cli 0.145.0` 实跑）：

- `codex app-server generate-json-schema --out <dir>` **默认即输出 v1+v2 稳定协议**（89 个客户端方法），
  其中已包含 `turn/steer`、`thread/fork`、`thread/rollback`、`account/rateLimits/*`、
  `item/tool/requestUserInput`；`--experimental` 是增量开关，Kun 只用稳定集。
- `TurnStartParams` 含 `cwd / model / effort / sandboxPolicy / approvalPolicy / input / outputSchema`；
  `TurnSteerParams` 要求 `expectedTurnId`（插话显式锚定当前 turn）；
  `ThreadForkParams.lastTurnId` 可选（存在即支持到任意 turn 的子轮分叉）；
  `ThreadRollbackParams` 为 `{threadId, numTurns}`；v1 无 `thread/unsubscribe`。
- `SandboxPolicy` 枚举含 `readOnly / workspaceWrite / dangerFullAccess / externalSandbox`——
  `externalSandbox` 允许 Kun 自己提供沙箱语义（worktree 隔离 + 审批上限），
  与"宿主审批不超 Kun 天花板"的红线天然契合，映射表见 §P6-05。

## 0. 全局约定（对所有 P6 PR 生效）

| 约定 | 内容 |
| --- | --- |
| 分支命名 | `codex/ade-p6-<slug>`，基于 `origin/develop` 新 worktree；每 PR 一worktree，合入后删除 |
| 提交风格 | Angular 式（`feat(kun): …` / `docs(ade): …`），无需 DCO |
| 行数红线 | 所有受跟踪文本文件 ≤700 行；编辑前 `wc -l` 检查目标文件，超限先拆文件再动手 |
| 红线不变 | Kun 为唯一运行时；渲染进程仍走 `kun serve` HTTP/SSE；不复活旧进程管理器/双运行时 |
| 密钥 | 不落盘、不进 fixture/日志；stderr 诊断一律走 sanitize |
| 翻译 | 新增 UI 字符串补全 `src/renderer/src/locales/{en,zh,hi,ja,ko,ru,th}/common/ade.json`（i18n-usage 测试强制对齐） |
| 验证门槛 | 每 PR 合入前：`npm run typecheck` + 相关单测 + `npm run check:file-lines`；含 UI 改动另跑 `npm run smoke:development-ade` 与 `npm run build` |

## 1. 共用层规格（P6-02/P6-03 的契约基准）

### 1.1 类型（新增 `kun/src/session/harness-session.ts`，目标 ≤300 行）

```ts
// §3 接口的实现版；与 DelegatedTurnRuntime 协作的会话级抽象。
export interface HarnessAgent {
  /** 只做启动+协议握手+版本检查；探测模型走 listModels */
  initialize(init: HarnessAgentInit): Promise<HarnessAgentInfo>
  listModels(): Promise<HarnessModelInfo[]>
  /** providerSessionId 为空→新会话；非空→resume（失败抛 HarnessSessionResumeError） */
  ensureSession(input: HarnessSessionInput): Promise<HarnessSession>
  /** 中止当轮但保留会话（Codex turn/interrupt；ACP cancel；SDK interrupt） */
  interrupt?(sessionId: string): Promise<void>
  /** 会话级分叉/回退；无此能力则字段缺省，能力位在 HarnessCapabilities 体现 */
  forkSession?(input: HarnessForkInput): Promise<HarnessSessionBinding>
  rollback?(input: HarnessRollbackInput): Promise<void>
  /** 进程级关闭；pool 负责按 key 关闭 */
  dispose(): Promise<void>
}

export interface HarnessSession {
  readonly providerSessionId: string
  /** 运行中 turn 的原生 id（turn/steer、interrupt 需要）；无进行轮为 null */
  readonly activeTurnId: string | null
  /** 一轮；事件经 sink 流出，resolve 值为结构化轮结果 */
  runTurn(input: HarnessTurnInput, sink: HarnessTurnSink): Promise<HarnessTurnResult>
  /** 同轮插话；不支持则该方法缺省 */
  steer?(input: HarnessSteerInput): Promise<void>
  dispose(reason: HarnessSessionCloseReason): Promise<void>
}
```

要点：`HarnessTurnResult` = `{status: 'completed'|'failed'|'cancelled', failureClass?, error?, usage?}`；
`HarnessTurnInput` = `{instructionBlocks[], userText, images[], attachments[], workspace, model, effort?, steerable}`。
`HarnessTurnSink` 按 §3.3：content 方法写时间线，`approval/userInput/usage/diff/plan/quota/status`
走专门方法。会话层不关心 Kun threadId——绑定归属 `SessionTurnRuntime`。

### 1.2 `SessionTurnRuntime`（实现 `DelegatedTurnRuntime`）

```
runTurn(req):
  ctx      = resolveSessionTurnContext(req)          // thread/turn/user 项、目标上下文、权限
  route    = ctx.route
  binding  = bindings.findOrCreate(bindingKey(route, ctx))   // 沿用 delegated-session-binding
  conn     = await pool.acquire(connectionKey(route))        // 泛型化 AcpConnectionPool
  session  = await conn.agent.ensureSession({providerSessionId: binding.providerSessionId, ...ctx})
  binding.providerSessionId = session.providerSessionId      // 首会话/漂移后落库
  input    = buildTurnInput(ctx, binding)                    // 历史/交接/prompt 通用化
  sink     = new KunTimelineTurnSink(ctx, deps)              // §3.3：时间线+审批+用量+计划
  result   = await session.runTurn(input, sink)
  commitTurn(ctx, binding, result)                           // checkpoint/提交/用量聚合（提取自 acp-runtime）
```

- **依赖面**：`AcpRuntimeDeps` 拆解为 `SessionTurnRuntimeDeps`（时间线、绑定存储、审批、用量、
  provider 上下文、trace、failure 分类）+ `mediation`（fs/terminal host，**仅 ACP 会话使用**，
  `HarnessSessionInput.mediation?` 传递）。
- **注册**：`build-harness-runtimes.ts` 中 `acp` 分支换成 `new SessionTurnRuntime(new AcpAgentFactory(...))`；
  为平滑迁移保留 `AcpRuntime` 导出别名；`DelegatedProviderKind` 增 `'codex-app-server' | 'pi-rpc'`
  （`delegated-session-binding.ts`、`isParkedSession` 白名单同步加）。

### 1.3 传输/进程规格（P6-03）

```
kun/src/transport/
  jsonl-transport.ts        // LF 帧：行拆分/粘连/UTF-8/超长帧/背压计数；onLine/onClose/stderrTail
  harness-proc.ts           // 提取 startAcpProcess → startHarnessProcess：spawn、stderr 环形缓冲（sanitize）、
                            //   owned kill、exit 时拒绝全部 pending
  connection-pool.ts        // AcpConnectionPool<TConn> 泛型化：按 key 复用、idle 超时、失败排除、并发上限
kun/src/session/
  jsonrpc-client.ts         // 跑在 JsonlTransport 上的最小 JSON-RPC：id 递增、request/notify/onServerRequest/
                            //   onNotification、超时、dispose 全拒
```

约束：transport 不识方法语义（不知道什么是 turn）；session 不识 framing；单测覆盖拆行/粘连/
坏行/退出/超时/取消六类。

## 2. PR 明细

### P6-01 · 文档与决定落地

| 项 | 值 |
| --- | --- |
| commit | `docs(ade): land p6 native-adapter decisions` |
| 依赖 | 无 |
| 文件 | `docs/AGENTS.md`、`docs/ade/README.md`、`docs/ade/01-harness-routing.md`、`docs/ade/03-acp-runtime.md`、`docs/ade/04-model-gateway-bridge.md`、`docs/ade/05-worker-callbacks.md`、`docs/ade/12-workbench-ui.md`、`docs/ade/13-governance-rollout.md`、`docs/ade/impl/README.md`、`docs/ade/impl/p5-agent-setup-ui.md` |

步骤：

1. `docs/AGENTS.md`：ACP 优先条款修订为——"harness 默认走通用 ACP；仅当专用协议能力缺口超过
   ACP 能表达的（凭证、恢复、审批粒度、工具回调），才允许原生适配器，且必须实现
   `DelegatedTurnRuntime` + `HarnessAgent` 契约、走 Kun HTTP/SSE、受 harness 路由与治理约束"。
   附 Codex/Pi 能力缺口对照表（引 p6 §5）。
2. `01-harness-routing.md`：transport 枚举增 `codex-app-server / pi-rpc`（新增值而非复用 `acp`），
   `transportOverrides` 语义（P6-07 落地）。
3. `03-acp-runtime.md`：§现状改为"ACP 是通用委托运行时之一；会话职责正迁入 `kun/src/session`"。
4. `04-model-gateway-bridge.md`：codex 网关段注明"P6-06 起 App Server 复用同一 CODEX_HOME 生成器"。
5. `05-worker-callbacks.md`：补"原生 harness 经 Kun Tools MCP 暴露工具（P6-10 决策 D3）"。
6. `12-workbench-ui.md`：Agent Center 交通标签约定（`App Server / Pi RPC / ACP`）。
7. `13-governance-rollout.md`：原生适配器准入清单（协议快照、录制回放、真机冒烟、回退开关）。
8. `impl/README.md` 与 `p5-agent-setup-ui.md`：加 p6a/p6b 索引与交叉引用。

DoD：纯文档；`check:file-lines` 过。回滚：revert。

### P6-02 · 会话层抽出（行为不变重构）

| 项 | 值 |
| --- | --- |
| commit | `refactor(kun): extract session turn runtime from acp` |
| 依赖 | P6-01 |
| 新增 | `kun/src/session/{harness-session.ts,session-turn-runtime.ts,turn-context.ts,turn-sink.ts,history-handoff.ts,turn-trace.ts,failure.ts,credentials.ts}`、`kun/src/session/acp/acp-agent.ts` |
| 修改 | `kun/src/runtime/acp/acp-runtime.ts`（瘦身至工厂/委托）、`acp-runtime-deps.ts`（拆分类型）、`build-harness-runtimes.ts`、`delegated-session-binding.ts`、`delegated-session-binding-store.ts`、相关测试 |

步骤（严格按序，保证每步可编译）：

1. 纯移动：把 `acp-runtime.ts` 的"取 thread/turn/user 项、目标上下文、权限模式"整段剪入
   `turn-context.ts`（导出 `resolveSessionTurnContext`）；trace/failure/凭据辅助剪入
   `turn-trace.ts`/`failure.ts`/`credentials.ts` 并去 acp 命名。
2. `turn-sink.ts`：实现 `KunTimelineTurnSink`（包现有时间线写入与审批桥；mediation 接口保留）。
3. `harness-session.ts`：落地 §1.1 类型。
4. `session-turn-runtime.ts`：按 §1.2 编排。
5. `acp/acp-agent.ts`：`AcpAgent`/`AcpSession` 包住 pool 连接上的 `session/new|load|prompt|cancel|fork`；
   ACP 特有（availableCommands、mode set、mediation fs/terminal host）留在 ACP 会话内部。
6. `acp-runtime.ts` 改为薄封装；`DelegatedProviderKind` + `isParkedSession` 白名单扩展。

测试：现有 acp 单测**不改语义全绿**为验收核心；新增
`session-turn-runtime.test.ts`（假 `HarnessAgent`：恢复漂移→新会话、cancel→interrupt 调用、
审批透传、用量聚合）；`turn-sink`/`history-handoff` 单测。

DoD：`npx vitest run kun/src/runtime kun/src/session kun/src/delegation` 绿；typecheck 绿；
行数检查过（acp-runtime 旧文件若超限须先拆）。回滚：单 PR revert。

风险：重构面大——坚持"先剪贴后改接口"，禁止顺手改行为；ACP 录制回放测试是行为基准网。

### P6-03 · 共用传输与进程规格

| 项 | 值 |
| --- | --- |
| commit | `feat(kun): share jsonl/jsonrpc transport for native harnesses` |
| 依赖 | P6-02 |
| 新增 | §1.3 三个 transport 文件 + `session/jsonrpc-client.ts` |
| 修改 | `kun/src/runtime/acp/acp-connection-pool.ts`（泛型化）、`kun/src/host/owned-process.ts`（提取 spawn/sanitize/kill 公共件，`acp-process.ts` 变薄） |

步骤：① 提取 `startHarnessProcess`（不动 acp 调用点签名）；② `JsonlTransport`+单测；
③ `JsonRpcClient`+单测（并发 pending、server request 回调、dispose 拒绝）；④ pool 泛型化，
ACP 站点换用，行为测试不变。

测试矩阵（`jsonl-transport.test.ts` / `jsonrpc-client.test.ts`）：拆行、粘连多帧、非法 JSON
（记诊断不崩）、>1MB 帧拒绝、写背压、进程退出时 pending 全拒、超时、AbortSignal 取消、
stderr 环尾 sanitize（注入假 `sk-` 串断言不泄漏）。

DoD：单测绿 + typecheck；回滚 revert。

### P6-04 · Codex 协议快照与 CodexClient

| 项 | 值 |
| --- | --- |
| commit | `feat(kun): add codex app-server protocol client` |
| 依赖 | P6-03 |
| 新增 | `kun/src/protocol/codex-app-server/`：`schema-snapshot.sha256`、`schema/`（快照 JSON）、`types.ts`（手写稳定子集）、`codex-client.ts`、`codex-protocol.test.ts`、`codex-client.test.ts`、`fixtures/`（脚本生成的清洗录制） |
| 新增脚本 | `kun/scripts/update-codex-schema.mjs`（调 `codex app-server generate-json-schema`→清洗→落 `schema/`→更新 sha256）、`kun/scripts/record-codex-session.mjs`（连真机跑一段脚本化会话，落清洗 JSONL） |
| 修改 | `package.json`（`protocol:codex` 脚本）；`.eslintignore`/构建配置如需 |

`types.ts` 覆盖稳定子集（手写接口+运行时校验，不从 schema 生成代码——快照只做漂移检测）：

- 客户端：`initialize / initialized / thread/{start,resume,fork,rollback,archive,unsubscribe(v2),
  compact/start,loadedList,list,read,metadata/update,name/set} / turn/{start,steer,interrupt} /
  review/start / model/list / skills/list / app/list / feedback/upload / command/exec /
  command/login/write / config/{read,value/write,batchWrite} / mcpServer/{status/list,tool/call,
  oauth/login/complete} / account/{login/start,login/cancel,logout,read,rateLimits/read,usage/read} /
  experimentalFeature/{list,enablement/update} / windowsSandbox/setupStart / fuzzyFileSearch /
  reviewDelivery/{list,upsert}`
- 服务端请求：`item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、
  `item/permissions/requestApproval`、`item/tool/requestUserInput`、`item/tool/call`（默认拒绝）、
  账号 token 刷新类（v1 legacy；一律拒绝+诊断）、`windowsSandbox/setupStart`（非 mac/win 拒）
- 通知：`thread/*`、`turn/*`、`item/*` 全量见快照；client 侧"未识别通知→诊断丢弃"不崩。

`codex-client.ts`：握手序列 `initialize → initialized`；`codexErrorInfo`/error response 规整为
`CodexProtocolError`（保 `code/additionalDetails`）；server request 统一走 `onServerRequest` 注册表；
仅 JSONL over stdio（socket/websocket 明确不做）。

测试：`codex-protocol.test.ts` 用快照校验手写类型与 schema 字段一致性（枚举/必填 diff 脚本）；
`codex-client.test.ts` 用假子进程：握手、版本门、通知派发、server request 往返、连接丢失。

DoD：单测绿；`npm run protocol:codex -- --check`（新增 check 模式）本地过。回滚 revert。

### P6-05 · Codex 会话/轮/事件/审批映射

| 项 | 值 |
| --- | --- |
| commit | `feat(kun): implement codex app-server harness agent` |
| 依赖 | P6-02、P6-04 |
| 新增 | `kun/src/session/codex/`：`codex-agent.ts`、`codex-session.ts`、`codex-event-map.ts`、`codex-approvals.ts`、`codex-models.ts`、`codex-session-binding.ts`、三个 `.test.ts` |
| 修改 | `kun/src/harness/harness-runtime.ts`（transport 分发）、`build-harness-runtimes.ts`、`kun/src/server/routes/harnesses.ts`（`modelSource:'probe'` 分发加 `codex-app-server`） |

映射表（实现基准）：

| Kun 语义 | App Server |
| --- | --- |
| ensureSession（无 id） | `thread/start {cwd: workspace, model, modelProvider?, approvalPolicy, sandbox, serviceName:'kun'}` |
| ensureSession（有 id） | `thread/resume {threadId, model, cwd, approvalPolicy, sandbox}`；`codexErrorInfo=threadNotFound`→落新会话并记漂移 |
| runTurn | `turn/start {threadId, input: UserInput[], model, effort, cwd, sandboxPolicy}`→`turn.id` 绑定 activeTurnId；完成信号=该 turnId 的 `turn/completed` |
| 同轮插话 | `turn/steer {threadId, expectedTurnId, input}`；无活动轮时转为新 turn |
| cancel | `turn/interrupt {threadId, turnId}` + 进程失效时 dispose |
| 审批 | `item/commandExecution|fileChange|permissions/requestApproval` → Kun 审批门；Kun 拒绝→`decline`，Kun 取消→`cancel`，"本会话记住"→`acceptForSession`（若 schema 枚举含） |
| 用户提问 | `item/tool/requestUserInput` → sink.userInput |
| 事件 | `item/agentMessage/delta`→text、`reasoning/*Delta`→thinking、`commandExecution/*`→command 工具、`fileChange/*|patchUpdated`→diff、`mcpToolCall|webSearch`→tool、`plan/delta`+`turn/plan/updated`→plan、`turn/diff/updated`→diff 快照、`tokenUsage/updated`→usage |
| 分叉/回退 | `forkSession`→`thread/fork`（带 `lastTurnId` 支持子轮）；`rollback`→`thread/rollback` |
| 额度 | `account/rateLimits/read`+`account/usage/read`→`quota-snapshot` 的 codex 通道（native-login 时启用，失败降级 unknown 不阻塞选路） |
| 登录态 | `account/read`→`authStateProbe: 'codex-app-server'`（ready/needs-login/unknown） |

`permissionMode → {approvalPolicy, sandbox}` 映射表放进 `codex-agent.ts` 顶部常量并写测试钉住
（`externalSandbox` 留给 Kun 全权托管档；映射细节合入前按 Kun 权限档定稿并在 doc 内留 TODO 锚点）。

`harness-runtime.ts`：`resolveRuntime` 按 `definition.transport==='codex-app-server'` →
`CodexSessionTurnRuntime`（= `SessionTurnRuntime` + `CodexAgentFactory`）。

测试：`codex-event-map.test.ts` 全通知→时间线草稿快照；`codex-approvals.test.ts` 四类审批×四种裁决；
`codex-agent.test.ts` 走录制回放 fixture（握手→thread/start→两轮→steer→interrupt→resume→fork）。
录制由 `record-codex-session.mjs` 产出，明文 secret 归零校验进测试。

DoD：三测试文件绿 + typecheck；回放 fixture 与快照同 commit。回滚 revert（builtin 未切换，无用户面影响）。

### P6-06 · Codex 网关接入

| 项 | 值 |
| --- | --- |
| commit | `feat(kun): route codex app-server through kun gateway` |
| 依赖 | P6-05 |
| 新增 | `kun/src/session/codex/codex-gateway-config.test.ts` |
| 修改 | `kun/src/acp/acp-kun-gateway-generator.ts`（提取 `writeCodexHomeConfig` 公共件，文件名可不动或拆 `kun/src/harness/codex-home-config.ts`）、`acp-launch-env.ts`/launch env 构建处（env `CODEX_HOME` 对两种 transport 统一）、`kun/src/server/routes/local-model-gateway.ts`（健康端点同步逻辑如适用）、`builtin-harnesses.ts`（codex 定义的 `gateway.providerSurface` 对 app-server 生效） |

步骤：① 把 CODEX_HOME/config.toml 生成器抽为 transport 无关；② codex-app-server 会话 spawn env
注入同一 `CODEX_HOME`；③ 网关健康/密钥轮换后既有同步链路复用（config.toml 重写即热生效，
不杀进程——Codex 每线程读配置，需用测试钉住"新会话读到新密钥"）；④ `provider` 凭据档：
`modelProvider` 字段映射 Kun provider 定义。

测试：生成器快照（三种 modelProvider 形态）、密钥轮换→新 thread 生效、凭据不入日志断言。

DoD：网关测试全绿。回滚 revert。

### P6-07 · 内置定义、检测与回退开关

| 项 | 值 |
| --- | --- |
| commit | `feat(kun): add codex app-server transport behind override` |
| 依赖 | P6-05、P6-06 |
| 修改 | `kun/src/contracts/harness.ts`（transport 枚举）、`kun/src/config/kun-config-harnesses.ts`（`transportOverrides` schema）、`kun/src/harness/builtin-harnesses.ts`（codex 定义 + `CODEX_ACP_FALLBACK`）、`harness-catalog.ts`（override 应用点）、`harness-detector.ts`（codex `--version` 解析+最低版本）、`harness-login-probes.ts`（`codex-app-server` 分支）、`services/harness-test-service.ts`（handshake case）、`kun/src/server/routes/harnesses.ts`（probe 分发）、`src/shared/ade-harnesses.ts`、`src/renderer/src/components/ade/AgentCenter*.tsx`、`settings-section-agents-harnesses.tsx`、7 语种 `ade.json` |

步骤：

1. 契约：`HarnessTransport` 加 `'codex-app-server' | 'pi-rpc'`；kun-config schema 加
   `adeHarnesses.transportOverrides?: Record<string, 'acp'>`（现仅 codex 有意义，默认空）。
2. builtin：codex 定义 `transport:'codex-app-server'`、`detect.command:'codex'`（`--version` 解析）、
   `adapterHint` 更新为"无需适配器"；旁挂 `CODEX_ACP_FALLBACK`（即现 ACP 定义克隆，hidden）。
   `harness-catalog.ts`：`transportOverrides.codex==='acp'` 时以 fallback 定义替换路由与目录条目。
3. 检测：`harness-detector` 对 codex 跑 `codex --version`+最低版本判定（P6-04 快照版本为地板，
   低版本→`blocked`+reasonCode `codex_app_server_below_min_version`，高版本 warn-only）；
   `probeReady` 分支加 app-server 初始化探测。
4. `harness-test-service`：`case 'codex-app-server'` → client initialize+`model/list`；
   trial 复用 `runDelegatedTrial`。
5. UI：`adeAgentTransport` 标签加 `App Server`/`Pi RPC`；codex 行副标题显示"App Server（ACP 回退可用）"
   或 override 生效时"ACP（回退模式）"；reasonCode/翻译补全。

DoD：detector/test-service/catalog override 单测绿；`smoke:development-ade` 绿；翻译齐全。回滚 revert。

### P6-08 · 切换默认 + 对比 + 移交

| 项 | 值 |
| --- | --- |
| commit | `feat(kun): default codex to app-server transport` |
| 依赖 | P6-07 + 真机矩阵通过 |
| 修改 | `builtin-harnesses.ts`（翻转时机=本 PR 前已默认新值，此 PR 删过渡注释/定稿文案）、`docs/ade/13-governance-rollout.md`（Codex 迁移节）、`docs/ade/impl/README.md` 状态表 |

步骤：① 真机矩阵（§3）跑通并记录结果进 PR 描述；② 评测集对拍 ACP/App Server 各一轮基线；
③ 更新文档"ACP 为 codex 隐藏回退"表述；④ 确认 `transportOverrides` 在 release note 中可见。

DoD/回滚：回退=用户/管理设 `transportOverrides.codex='acp'`，无需发版；严重缺陷→revert 本 PR。

## 3. Codex 真机验证矩阵（P6-08 前置，手工/夜间跑）

| # | 场景 | 期望 |
| --- | --- | --- |
| 1 | 未登录 codex | `account/read`→needs-login；Agent Center 显示登录动作 |
| 2 | 登录（device/browser） | `account/login/start`→`login/completed` 通知；状态转 ready |
| 3 | 一轮普通对话 | text/thinking/usage/diff 时间线齐；`turn/completed` 收尾 |
| 4 | 命令审批 accept/decline/cancel | 三裁决均正确回传，无悬挂 request |
| 5 | 文件改动审批+`turn/diff/updated` | diff 卡与审批结果一致 |
| 6 | `turn/steer` 同轮插话 | steer 输入并入当轮；`expectedTurnId` 不匹配时不丢消息 |
| 7 | interrupt | turn interrupted；会话可继续 |
| 8 | resume（重开 kun serve） | binding→thread/resume 命中历史 |
| 9 | fork（含 lastTurnId 子轮） | 新 binding，历史独立 |
| 10 | 网关档 | 走 Kun gateway；密钥轮换后新线程生效；无明文密钥落盘 |
| 11 | rateLimits/usage | 额度快照进 worker 选路输入 |
| 12 | 低版本 codex | blocked + `codex_app_server_below_min_version`，UI 给升级指引 |

矩阵全部过才允许 P6-08 合入。
