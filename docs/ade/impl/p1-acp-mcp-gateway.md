# P1-01 ~ P1-09：ACP 运行时、工具桥宿主、MCP server、网关协议桥

设计依据：[03](../03-acp-runtime.md)、[04](../04-model-gateway-bridge.md)、[05](../05-worker-callbacks.md)。

---

## P1-01 ACP：JSON-RPC、进程、假 agent 夹具（M，K）

- 分支：`codex/ade-acp-transport`；提交：`feat(acp): json-rpc transport and owned agent process`
- 依赖：P0-04

### 新增

| 文件 | 内容 |
| --- | --- |
| `kun/src/runtime/acp/acp-schema.ts` | 协议类型。**先确认**官方 TypeScript 类型包的包名与版本并 pin（写入 `kun/package.json`）；若只引类型，用 `import type` 保证运行时零依赖。zod 解析器只覆盖 Kun 读取的字段，未知字段 `passthrough` |
| `kun/src/runtime/acp/acp-jsonrpc.ts` | `AcpJsonRpc`：逐行 JSON 帧；`request(method, params, { timeoutMs, signal })`；`notify()`；`onRequest(method, handler)`（agent → 客户端）；`onNotification(method, handler)`；`close()` |
| `kun/src/runtime/acp/acp-process.ts` | `startAcpProcess()`：`spawnOwnedProcess(command, args, { env, stdio: ['pipe','pipe','pipe'], windowsHide: true })`；stderr 环形缓冲 64 KiB；`exit` promise；`stop(graceMs)` 调 `stopOwnedProcess` |
| `kun/src/harness/harness-env.ts` | `HARNESS_CREDENTIAL_ENV_DENYLIST`、`buildHarnessEnv({ base, strip, add })`；Claude SDK 的 `buildScopedEnv` 改为调用它（行为不变的测试守护） |
| `kun/src/runtime/acp/__fixtures__/fake-acp-agent.mjs` | 读 stdin 行，按 `FAKE_ACP_SCENARIO` 环境变量指向的 JSON 场景回应：握手、会话、按脚本发 update、发客户端请求并等待回复 |
| `kun/src/runtime/acp/__fixtures__/scenarios/*.json` | 基础对话、工具调用 + diff、权限请求、取消、崩溃、加载会话回放、畸形输出 |

### JSON-RPC 细节

- 帧：每行一个 JSON 对象，`\n` 分隔；读取端用增量缓冲，单行上限 8 MiB，超过则关闭连接并报 `harness_protocol_error`。
- id：客户端请求用自增整数；收到 agent 发来的请求时按其 id 回复。
- 超时：每个请求独立计时；超时后从 pending 表删除并拒绝 promise，迟到的响应丢弃并记 debug。
- 背压：写入用 `stdin.write` 的返回值与 `drain` 事件排队，避免大 prompt 丢数据。
- 关闭：进程退出时拒绝所有 pending 请求，错误里附 stderr 尾部（脱敏：去掉形如令牌、`Bearer`、`sk-` 前缀的片段）。

### 测试

| 用例 | 期望 |
| --- | --- |
| 并发 10 个请求 | 各自拿到正确响应 |
| agent 主动请求 | 注册的 handler 被调用，回复带相同 id |
| 半行 / 粘包 | 正确分帧 |
| 超长行 | 连接关闭，错误码正确 |
| 进程退出 | pending 全部拒绝，附脱敏 stderr |
| env | denylist 中的变量不出现在子进程环境；Claude SDK 现有 env 测试通过 |

---

## P1-02 ACP：会话管理、config options、能力推导（M，K）

- 分支：`codex/ade-acp-session`；依赖：P1-01

### 新增

| 文件 | 内容 |
| --- | --- |
| `kun/src/runtime/acp/acp-connection-pool.ts` | 03 §4.3；key = `${harnessId}:${credentialIdentity}`；`acquire / release / markUnhealthy / onExit`；空闲释放定时器 |
| `kun/src/runtime/acp/acp-connection.ts` | 包装一个进程 + JSON-RPC + `initResult`；`initialize()`（03 §4.2）；`sessionUpdates` 分发器（按 sessionId 路由到订阅者） |
| `kun/src/runtime/acp/acp-session-manager.ts` | `ensureSession(ctx, conn)`（03 §5.1）、`applyConfigOptions()`（03 §5.3）、`commit(session, ctx)` |
| `kun/src/runtime/acp/acp-capabilities.ts` | `capabilitiesFromAcp(initResult, sessionFacts)`（03 §10） |

- `DelegatedProviderKind`（`delegated-session-binding.ts:9`）加 `'acp'`；`providerStateDir('acp', …)` 目前不需要存东西，但保持接口一致。
- 加载阶段过滤：`AcpSessionHandle.phase` 在 `session/load` 请求返回之前为 `loading`，此期间收到的 `user_message_chunk` / `agent_message_chunk` / `agent_thought_chunk` / `tool_call*` 全部丢弃，只处理 `available_commands_update`、`current_mode_update`、`config_option_update`。
- 效果推导：`effort` 可设置 ⇔ 存在 `category: 'thought_level'` 的选项；`modes` ⇔ 存在 `category: 'mode'` 的选项或旧的 modes 列表。

### 测试

| 用例 | 期望 |
| --- | --- |
| loadSession 能力为 true 且绑定有 nativeSessionId | 调用 `session/load`，回放不产生 Kun item |
| load 失败 | `rejectResume` → `session/new` |
| config options 中无精确模型 | 不调用 set，记 debug |
| 同 key 两次 acquire | 复用同一进程 |
| 进程退出 | 该连接上的会话绑定被标为 native_state_unavailable |

---

## P1-03 ACP：事件映射与工具调用映射（L，K）

- 分支：`codex/ade-acp-mapper`；依赖：P1-02

### 新增

| 文件 | 内容 |
| --- | --- |
| `kun/src/runtime/acp/acp-event-mapper.ts` | `AcpEventMapper`：`apply(update)`、`flush()`；持有本轮文本 / 推理累积、工具调用状态机 |
| `kun/src/runtime/acp/acp-tool-call-mapper.ts` | `toolItemKind(kind)`、`toKunToolCallItem(update)`、`toKunToolResult(update)`、diff 内容的结构化 |
| `kun/src/contracts/events.ts` | 新事件 `harness_session_state`（03 §7.3） |

### 与 Kun 事件记录的对接

外部运行时写事件的方式沿用现有 SDK 映射器（`agent-sdk/sdk-event-mapper.ts`）：通过 `TurnService.applyItem / updateItem` 写 item，通过 `RuntimeEventRecorder.record` 写流式事件。映射器只产出"草稿"，由 `acp-runtime.ts` 统一写入，便于测试。

```ts
type MapperOutput =
  | { kind: 'text_delta'; text: string }                                     // → assistant_text_delta（增量）
  | { kind: 'reasoning_delta'; text: string }
  | { kind: 'tool_call_ready'; item: ToolCallTurnItemDraft }
  | { kind: 'tool_call_started'; callId: string }
  | { kind: 'tool_call_finished'; callId: string; result: ToolResultDraft }
  | { kind: 'todos'; todos: TodoDraft[] }
  | { kind: 'usage'; usage: UsageSnapshot }
  | { kind: 'context'; snapshot: ContextSnapshotDraft }
  | { kind: 'session_state'; state: HarnessSessionStateDraft }
```

- **文本增量**：只发本次 chunk，不发累计全文（Claude SDK 接入时的教训：GUI 对 `assistant_text_delta` 是追加）。`flush()` 时写完整 `assistant_text` item（替换语义）。
- **工具调用状态机**：`Map<toolCallId, { phase: 'pending' | 'running' | 'done', item }>`；先到的 `tool_call_update` 建占位；重复终态忽略；turn 结束时仍未终态的调用标为 `interrupted`。
- **toolName**：`acp:${kind}`（例如 `acp:edit`），标题用 `title`；`arguments` 放 `{ title, kind, locations, rawInput? }`（`rawInput` 超过 16 KiB 截断）。
- **diff**：`tool_result` 的结构化输出 `{ diffs: Array<{ path, oldText: string | null, newText }> }`，渲染层按现有 file_change 工具的展示方式显示；这些 diff 同时供 11 的归属账本（P2-06）使用。

### 测试

用 P1-01 的场景夹具驱动映射器（不启进程），逐条断言输出：

| 场景 | 期望 |
| --- | --- |
| 基础对话 | 若干 text_delta，flush 后一条完整 assistant_text |
| 思考 + 回答 | reasoning 与 text 分开 |
| 工具调用正常顺序 | ready → started → finished |
| update 先于 tool_call | 占位后补全，不重复 |
| 重复终态 | 只 finished 一次 |
| diff | 结构化结果正确，`oldText: null` 表示新文件 |
| plan | todos 映射（状态、优先级） |
| usage | usage + context 输出 |
| 未知 sessionUpdate | 忽略并记 debug |

---

## P1-04 ACP：客户端方法（L，K）

- 分支：`codex/ade-acp-client-host`；依赖：P1-02、P0-10

### 新增

| 文件 | 内容 |
| --- | --- |
| `kun/src/runtime/acp/acp-client-host.ts` | 注册 agent → 客户端的方法；`contextFor(sessionId)` 找到线程 / turn / 工作区 / 审批 |
| `kun/src/runtime/acp/acp-fs.ts` | `readTextFile`、`writeTextFile`（03 §8.1） |
| `kun/src/runtime/acp/acp-terminal-registry.ts` | `create / output / waitForExit / kill / release`；句柄 `Map<terminalId, { child, buffer, turnId }>`；turn 结束时 `stopOwnedProcess` 全部 |
| `kun/src/runtime/acp/acp-permission.ts` | `requestPermission`（03 §8.3）；`PendingPermissions`：按 sessionId 跟踪，`cancelAll(sessionId)` |

### 关键逻辑

- **路径**：`resolveInside(roots, path)`：`path.resolve` 后 `realpath`（不存在的写入目标取父目录的 realpath 再拼文件名），必须以某个根 + 分隔符开头；Windows 下大小写不敏感比较。
- **写入审批去重**：`ApprovalMemo`：`Map<turnId, Set<string>>`，记录本轮已允许的 `(kind, target)`；`request_permission` 允许后把 `toolCall.locations[].path` 加进去；`writeTextFile` 命中则不再询问。
- **检查点**：写入前调用 turn 生命周期里已有的 `awaitWorkspaceCheckpoint`（`agent-loop-turn-lifecycle.ts:249` 附近委派路径就是这么做的），保证变更前有快照。
- **写入记录**：写完产出一条 `file_change` 类的 tool 结果（`toolName: 'acp:fs.write'`），这样 Changes 面板与工作现场都能看到。
- **终端输出**：环形缓冲，按 `outputByteLimit` 截断，`output` 返回 `{ output, truncated, exitStatus? }`。
- **取消**：`session/cancel` 前先 `cancelAll(sessionId)`，让挂起的权限请求都回复 `{ outcome: 'cancelled' }`。

### 测试

| 用例 | 期望 |
| --- | --- |
| 读工作区外文件（含符号链接逃逸） | JSON-RPC 错误 |
| 写入：未审批 | 触发审批；deny 时返回错误且文件未改 |
| 写入：同一工具调用已允许 | 不二次审批 |
| 写入前检查点 | 被调用 |
| 权限：永不选 allow_always（有 allow_once 时） | 断言 |
| 终端：输出超限 | `truncated: true` |
| 终端：turn 取消 | 进程被回收（真实进程测试，POSIX 与 Windows CI 各一） |
| 取消时挂起的权限 | 回复 cancelled |

---

## P1-05 ACP：运行时装配、内置定义、冒烟（M，K）

- 分支：`codex/ade-acp-runtime`；依赖：P1-03、P1-04、P1-07

### 改动

| 文件 | 改什么 |
| --- | --- |
| `kun/src/runtime/acp/acp-runtime.ts`（新） | `AcpRuntime implements DelegatedTurnRuntime`：`handlesRoute(route) = route.transport === 'acp'`；`capabilitiesV2(route)`；`runTurn()`（03 §6） |
| `kun/src/harness/build-harness-runtimes.ts` | 注册 `acp` |
| `kun/src/harness/builtin-harnesses.ts` | 加 `gemini-cli`、`codex`、`opencode` 三个定义 |
| `kun/src/server/routes/harnesses.ts` | `GET /v1/harnesses/:id/models` 对 ACP harness 用"探测会话"取模型（开一个 `session/new`、读 config options、立即丢弃；结果缓存 10 分钟） |

### 内置定义的落地流程

在写定义之前，用真实二进制跑一遍并录制：

1. 在开发机安装三个 CLI 的当前版本，记录版本号。
2. 用一个最小脚本（`kun/scripts/record-acp-session.mjs`，不进发布包）以正确参数启动每个 agent，完成：initialize、session/new、一次提问、一次工具调用、一次取消。
3. 保存 JSON-RPC 往返记录，脱敏后放进 `kun/src/runtime/acp/__fixtures__/recorded/<harness>-<version>.jsonl`。
4. 定义里的 `launch.args`、`detect.minVersion` 以录制时确认可用的为准。
5. 映射器测试增加"录制回放"用例：把录制的 agent 输出喂给映射器，断言产出的 Kun 事件序列（快照）。

### 冒烟清单（手动或夜间）

对每个 ACP harness：一对一会话里完成一轮对话、一次需要审批的写文件、一次终端命令、一次中断、关闭应用再打开后继续对话（native 或 portable）。

---

## P1-06 抽取 `KunToolBridgeHost`（M，K）

- 分支：`codex/ade-tool-bridge-host`；提交：`refactor(runtime): share kun tool execution across delegated runtimes`
- 依赖：无。**纯重构，行为不变。**

步骤：

1. 新建 `kun/src/harness/kun-tool-bridge-host.ts`，定义 05 §3.2 的接口。
2. 把 `agent-sdk-runtime-factory-tools.ts:123` 起 `createAgentSdkToolRuntimeDeps().executeKunTool` 的函数体整体移入 `createKunToolBridgeHost(deps, context).execute`；`listTools` 从 `agent-sdk-runtime-factory-turn.ts:340` 附近"取可桥接工具 + `selectBridgeableTools`"的代码抽出。
3. Claude SDK 工厂改为调用宿主；Cursor 工具桥（`cursor-sdk-tool-bridge.ts`）的执行回调也改为调用宿主。
4. SDK 特有的部分留在原处：`mapKunResultToSdkContent`、`jsonSchemaToZodShape`、`toSdkMcpServer`、Cursor 的 `SDKCustomTool` 适配。

测试：`kun/src/runtime/agent-sdk`、`kun/src/runtime/cursor` 现有测试全部通过；新增宿主的单测（计划上下文、审批、画布回执三条路径各一）。

---

## P1-07 `HarnessTokenService`、Kun Tools MCP server、stdio 桥（M，K）

- 分支：`codex/ade-kun-tools-mcp`；依赖：P1-06

### 新增

| 文件 | 内容 |
| --- | --- |
| `kun/src/harness/harness-token-service.ts` | 04 §4 的令牌服务，grant 带 `scopes: Array<'gateway' \| 'kun-tools' \| 'worker-callback' \| 'hook-ingest'>`；`issue / verifyScope / revokeThread` |
| `kun/src/server/routes/kun-tools-mcp.ts` | 05 §3.3 |
| `kun/src/server/kgw-token-guard.ts` | 在路由分发前检查：请求带 `kgw_` 令牌时，只允许其 scope 对应的路径前缀，其余一律 401（放在现有运行时令牌鉴权之前） |
| `kun/src/cli/mcp-bridge-cli.ts` | `kun mcp-bridge --token-env <VAR>`：stdio ↔ `POST /mcp/kun` 转发，逐条请求，不支持批量 |

### MCP 协议版本

`initialize` 协商：维护 `SUPPORTED_MCP_PROTOCOL_VERSIONS`（实现时以 MCP 官方规范列出的 streamable HTTP 版本为准，选 2–3 个）；客户端请求的版本在列表中则回同一版本，否则回列表中最新的版本；客户端不接受时由它断开。

### 测试

| 用例 | 期望 |
| --- | --- |
| 无令牌 / 错误签名 / 错误 scope | 401 |
| `kgw_` 令牌访问 `/v1/threads` | 401（guard 拦截） |
| tools/list | 与 SDK 路径同一 turn 的可桥接工具集合一致 |
| tools/call 无运行中 turn | 返回工具错误 |
| tools/call 需要审批的工具 | 走 ApprovalGate |
| stdio 桥 | 两个请求往返正确；令牌不出现在 argv |

---

## P1-08 网关公共部分抽取 + Anthropic messages 入口（L，K）

- 分支：先 `codex/ade-gateway-core`（重构），再 `codex/ade-gateway-messages`（新入口）；两个 PR
- 依赖：无

### PR A：抽取（行为不变）

`kun/src/server/routes/openai-model-gateway.ts`（400 行）拆为：

- `model-gateway-core.ts`：`guardFor`、`authorizePublicGateway`、`readJsonBody` 包装、`gatewayMessagesToTurnItems`（从 `makeModelRequest` 里"消息 → TurnItem"的部分抽出，定义中间形态 `GatewayMessage`）、`parseTools`、错误辅助。
- `openai-model-gateway.ts`：chat / responses 的入站解析与出站 SSE / JSON。

测试：`openai-model-gateway.test.ts` 不改并通过。

### PR B：messages 入口

| 文件 | 内容 |
| --- | --- |
| `kun/src/server/routes/anthropic-messages-gateway.ts` | `gatewayMessages(runtime, request)`、`gatewayCountTokens(runtime, request)`；入站 04 §5.3，出站 04 §5.4 |
| `kun/src/server/routes/register-core-routes.ts:69-71` | 加 `POST /v1/messages`、`POST /v1/messages/count_tokens` |

- 本 PR 只支持**路由池模型**（与现有公共网关一致）；直接寻址与 harness 令牌在 P1-09。
- `count_tokens`：用 kun 现有的请求 token 估算函数（上下文容量计算用的那个），响应加头 `x-kun-estimate: true`。

### 测试

| 用例 | 期望 |
| --- | --- |
| 文本流式 | 事件序列：message_start → content_block_start(text) → delta… → stop → message_delta → message_stop |
| 工具调用（有 tool_call_delta 的 provider） | input_json_delta 逐段 |
| 工具调用（只有 complete） | 一次性 input_json_delta |
| 多轮 tool_use / tool_result 往返 | 历史转成 TurnItem 正确，孤儿 tool_result 被修复逻辑丢弃 |
| thinking 块回传 | 入站丢弃，不报签名错误 |
| 非流式 | 与流式累积结果一致 |
| 图片 + 非视觉模型 | 400 并说明 |

---

## P1-09 网关直接寻址、用量归属、Claude SDK 网关模式（M，K）

- 分支：`codex/ade-gateway-harness`；依赖：P1-08、P1-07、P0-04

### 改动

| 文件 | 改什么 |
| --- | --- |
| `kun/src/harness/gateway-model-id.ts`（新） | `parseGatewayModelId` / `formatGatewayModelId` |
| `model-gateway-core.ts` | 鉴权顺序：先 `harnessTokens.verifyScope(token, 'gateway')`，失败再试公共凭据；harness grant 允许 `kun/<provider>/<model>` 寻址且必须在 grant 的 routes 里；grant 的请求体上限 32 MiB、并发 4 |
| 用量 | 网关完成后按 04 §6 记账：`usage` 事件加 `source: 'harness-gateway'`、`harnessId`；`ModelRequest.threadId` 用 grant 的线程，`turnId` 用 ActivityStore 里该线程当前运行的 turn |
| `kun/src/contracts/harness.ts` | `HarnessDefinition.gateway`（04 §8） |
| `kun/src/runtime/agent-sdk/sdk-options-builder.ts` | `credentialMode === 'kun-gateway'` 时：`buildHarnessEnv` 注入 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_MODEL`、`ANTHROPIC_SMALL_FAST_MODEL`，剥离 `CLAUDE_CODE_OAUTH_TOKEN` 等；`resolveSdkModel` 对 `kun/` 前缀不做回退 |
| `kun/src/runtime/agent-sdk/agent-sdk-runtime-core.ts` | `handlesRoute(route)`：`route.harnessId === 'claude-code' && (route.credentialMode === 'native-login' \|\| route.credentialMode === 'kun-gateway')` |
| 用量去重 | 网关模式下，SDK 自己报告的 usage 事件只写 `context_snapshot`，不写 `usage`（避免同一次调用计两遍） |
| `src/renderer` 用量面板 | `source` 为 `harness-gateway` 的行显示"经 Kun 网关" |

### 测试

| 用例 | 期望 |
| --- | --- |
| harness grant 请求 grant 外的模型 | 404 |
| 公共凭据请求 `kun/...` | 404 |
| 用量归属 | 记在 grant 的线程与当前 turn；没有运行中 turn 时记线程级 |
| 去重 | 同一轮只有网关一条 usage |
| Claude SDK 网关模式环境 | 子进程环境有 BASE_URL / AUTH_TOKEN，没有 OAUTH_TOKEN 与 provider 密钥 |
| 端到端（夜间） | 真实 Claude Code + 网关 + DeepSeek 完成"读文件 → 修改 → 回答" |
