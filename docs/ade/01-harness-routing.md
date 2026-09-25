# 01 Harness：概念、目录、检测与路由

- 阶段：P0（路由、目录、设置）；P2（外部会话接续入口）
- 依赖：无
- 被依赖：02、03、04、09、10、12

## 1. 目标

1. 引入 **Harness**（执行一轮对话的引擎）作为一等概念，和现有的 **Provider**（凭据 + 模型路由）正交。
2. 把"哪个引擎跑这一轮"从 `providerId` 推断，改成显式的 `harnessId`，同时完全兼容现有线程。
3. 提供声明式的 harness 目录、本机检测（装没装、版本、登录态）和设置入口。

## 2. 为什么要和 Provider 分开

现状：外部 agent 被建模成 provider 的一种 `kind`（`kun/src/config/kun-config-application.ts:161`），
`agent-loop-turn-lifecycle.ts:128-139` 按 `turn.providerId ?? thread.providerId` 调 `sdkRuntime.handlesProvider()` 决定走哪个运行时。

问题：

- "Claude Code 这个引擎"和"Claude 订阅这份凭据"被绑死了，无法表达"Claude Code 的外壳 + DeepSeek 模型"（04 的协议桥需要）。
- 总管选 worker 时需要按引擎能力筛选（02），而 provider 维度看不出引擎能力。
- UI 上用户选的是"用哪个 agent"，不是"用哪个 provider"。

新模型：

```text
HarnessRoute = harnessId × providerId × model × credentialMode
  harnessId       谁来跑这一轮：kun | claude-code | cursor | antigravity | gemini-cli | codex | opencode | 自定义
  providerId      模型从哪来：现有 provider 配置（可为空，表示用 harness 自己的登录）
  model           模型 id
  credentialMode  native-login（harness 自己的登录）| provider（Kun provider 的凭据直连）| kun-gateway（经 Kun 网关）
```

## 3. 契约：`kun/src/contracts/harness.ts`（新增）

```ts
import { z } from 'zod'
import { HarnessCapabilitiesSchema } from './harness-capabilities.js' // 见 02

export const HarnessIdSchema = z.string().trim().regex(/^[a-z][a-z0-9-]{1,47}$/)
export type HarnessId = z.infer<typeof HarnessIdSchema>

/** 引擎的接入方式。决定由哪个 DelegatedTurnRuntime 实现来跑。 */
export const HarnessTransportSchema = z.enum([
  'native-loop',      // Kun 自己的 AgentLoop
  'agent-sdk',        // 现有 Claude Agent SDK 适配器
  'cursor-sdk',       // 现有 Cursor SDK 适配器
  'antigravity-cli',  // 现有 Antigravity CLI 适配器
  'acp',              // 通用 ACP 运行时（03）
  'terminal'          // 0 档：只在终端里跑，状态靠 hooks（05）
])

export const HarnessCredentialModeSchema = z.enum(['native-login', 'provider', 'kun-gateway'])

export const HarnessPermissionModeSchema = z.object({
  id: z.string().min(1).max(64),              // harness 自己的档位 id，如 'default' | 'acceptEdits' | 'bypassPermissions'
  label: z.string().min(1).max(64),
  /**
   * 映射到 Kun 的产品权限档（kun/src/contracts/policy.ts:39 的 KUN_TOOL_PERMISSION_MODES：
   * ask-for-approval < approve-for-me < full-access）。权限上限比较和准入矩阵都用这个口径。
   */
  kunPermissionMode: z.enum(KUN_TOOL_PERMISSION_MODES)
}).strict()

export const HarnessDefinitionSchema = z.object({
  id: HarnessIdSchema,
  displayName: z.string().min(1).max(64),
  transport: HarnessTransportSchema,
  /** 本机检测。native-loop 没有。 */
  detect: z.object({
    command: z.string().min(1).max(256),
    aliases: z.array(z.string().min(1).max(256)).max(8).default([]),
    versionArgs: z.array(z.string().max(64)).max(4).default(['--version']),
    versionPattern: z.string().max(256).optional(), // 从输出里取版本号的正则
    minVersion: z.string().max(32).optional()
  }).strict().optional(),
  /** acp / terminal 的启动命令。SDK 类 transport 由适配器自己决定。 */
  launch: z.object({
    command: z.string().min(1).max(256),
    args: z.array(z.string().max(1_024)).max(32).default([]),
    /** 只写非敏感变量；凭据通过 credentialMode 注入，永不写进配置。 */
    env: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), z.string().max(1_024)).default({})
  }).strict().optional(),
  credentialModes: z.array(HarnessCredentialModeSchema).min(1),
  /** 从严到宽排序：[0] 必须是最严档。无人值守回落时取 [0]（见 02 §4）。 */
  permissionModes: z.array(HarnessPermissionModeSchema).min(1),
  modelSource: z.enum(['static', 'probe', 'provider']),
  staticModels: z.array(z.string().min(1).max(256)).max(64).default([]),
  /** 与现有 history-sources 对接，用于"接续外部会话"（§8）。 */
  historySource: z.enum(['claude-code', 'codex', 'opencode']).optional(),
  /** 静态声明；运行时可以按版本或登录态进一步收窄（见 02 §3）。 */
  capabilities: HarnessCapabilitiesSchema,
  builtin: z.boolean()
}).strict()
export type HarnessDefinition = z.infer<typeof HarnessDefinitionSchema>

export const HarnessRouteSchema = z.object({
  harnessId: HarnessIdSchema,
  providerId: z.string().min(1).max(128).optional(),
  model: z.string().min(1).max(512),
  credentialMode: HarnessCredentialModeSchema
}).strict()
export type HarnessRoute = z.infer<typeof HarnessRouteSchema>

/** 检测结果。只含元数据，不含任何凭据或路径以外的敏感信息。 */
export const HarnessStatusSchema = z.object({
  harnessId: HarnessIdSchema,
  installed: z.enum(['yes', 'no', 'unknown']),
  version: z.string().max(64).optional(),
  versionSupported: z.boolean().optional(),
  login: z.enum(['signed-in', 'signed-out', 'unknown', 'not-required']),
  resolvedCommand: z.string().max(4_096).optional(),
  checkedAt: z.string().datetime(),
  message: z.string().max(512).optional()
}).strict()
export type HarnessStatus = z.infer<typeof HarnessStatusSchema>
```

线程与 turn 的字段（`kun/src/contracts/threads.ts`、`turns.ts`）：

```ts
// CreateThreadRequest / ThreadSchema / ThreadSummarySchema
harnessId: HarnessIdSchema.optional(),
// StartTurnRequest / TurnSchema
harnessId: HarnessIdSchema.optional(),
credentialMode: HarnessCredentialModeSchema.optional(),
```

- 线程上的 `harnessId` 是默认值；turn 上的覆盖它。已接纳的 turn 冻结自己的 `harnessId`，和现有 `providerId` 冻结语义一致。
- `ThreadSummarySchema.pick(...)`（`threads.ts:465` 附近）要加 `harnessId: true`，侧栏需要显示 agent 图标。

## 4. 内置目录：`kun/src/harness/builtin-harnesses.ts`（新增）

```ts
export const BUILTIN_HARNESSES: readonly HarnessDefinition[] = [
  {
    id: 'kun', displayName: 'Kun', transport: 'native-loop',
    credentialModes: ['provider'],
    // 直接复用 KUN_TOOL_PERMISSION_MODES 三档，按从严到宽；每档的 approvalPolicy/sandboxMode
    // 由现有 kunToolPermissionModeSettings(mode) 解析，不另建映射。
    permissionModes: KUN_TOOL_PERMISSION_MODES.map((mode) => ({ id: mode, label: mode, kunPermissionMode: mode })),
    modelSource: 'provider', staticModels: [],
    capabilities: KUN_NATIVE_CAPABILITIES, builtin: true
  },
  {
    id: 'claude-code', displayName: 'Claude Code', transport: 'agent-sdk',
    detect: { command: 'claude', aliases: [], versionArgs: ['--version'] }, // 随包二进制优先（§5.2）
    credentialModes: ['native-login', 'kun-gateway'],
    permissionModes: [
      { id: 'default', label: 'Ask', kunPermissionMode: 'ask-for-approval' },
      // acceptEdits 改文件不经任何审批，approve-for-me（agent 代审）覆盖不了它，保守记为 full-access
      { id: 'acceptEdits', label: 'Accept edits', kunPermissionMode: 'full-access' },
      { id: 'bypassPermissions', label: 'Full access', kunPermissionMode: 'full-access' }
    ],
    modelSource: 'probe', staticModels: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    historySource: 'claude-code',
    capabilities: CLAUDE_CODE_CAPABILITIES, builtin: true
  },
  { id: 'cursor', transport: 'cursor-sdk', /* 现有 cursor-sdk provider 的能力 */ },
  { id: 'antigravity', transport: 'antigravity-cli', /* kunTools: false */ },
  {
    id: 'gemini-cli', displayName: 'Gemini CLI', transport: 'acp',
    detect: { command: 'gemini' },
    launch: { command: 'gemini', args: ['--experimental-acp'], env: {} },
    credentialModes: ['native-login'], /* ... */
  },
  {
    id: 'codex', displayName: 'Codex', transport: 'acp',
    detect: { command: 'codex' },
    launch: { command: 'codex-acp', args: [], env: {} }, // 通过 ACP adapter；P2 评估 app-server 深度适配
    historySource: 'codex', /* ... */
  },
  { id: 'opencode', displayName: 'OpenCode', transport: 'acp',
    launch: { command: 'opencode', args: ['acp'], env: {} }, historySource: 'opencode' /* ... */ }
]
```

说明：

- `kunPermissionMode` 是**保守上界**：harness 档位在任一维度（文件写入、命令执行、网络、审批者）比某个 Kun 档位宽，就不能映射到它。权限上限比较（09 §7）只看这个字段。
- 支持外部审批的 harness（`externalApproval` 能力为 supported，见 02）：每次工具调用都回到 Kun 的 `ApprovalGate`，harness 自己的档位由 Kun 当前档位推导（沿用现有 `mapApprovalPolicyToPermissionMode`），用户不单独选。只有不支持外部审批的 harness（Antigravity、终端 agent）才让用户选 harness 档位。
- 具体的启动参数以实现时各 CLI 当前版本为准，**在 P1 开始前用真实二进制验证一遍**，不凭记忆写死。验证结果写进测试夹具（13 §5）。
- 用户自定义 harness：只允许 `transport: 'acp'`，通过设置页添加（命令、参数、非敏感环境变量）。`builtin: false`。
- 目录是**只读数据**，放在 kun 里；GUI 通过 `GET /v1/harnesses` 读取，不在 renderer 里再维护一份。

## 5. 检测：`kun/src/harness/harness-detector.ts`（新增）

### 5.1 流程

```ts
export class HarnessDetector {
  private readonly cache = new Map<HarnessId, { status: HarnessStatus; expiresAt: number }>()

  constructor(private readonly deps: {
    definitions: () => readonly HarnessDefinition[]
    overrides: () => Record<HarnessId, { binaryPath?: string }>   // 来自设置
    spawnCaptured: SpawnCaptured                                  // 复用 kun 现有受管 spawn 封装
    probeLogin: (def: HarnessDefinition, command: string) => Promise<HarnessStatus['login']>
    nowMs: () => number
    ttlMs?: number                                                // 默认 60s；设置页"重新检测"强制刷新
  }) {}

  async status(id: HarnessId, opts: { force?: boolean } = {}): Promise<HarnessStatus> {
    const cached = this.cache.get(id)
    if (!opts.force && cached && cached.expiresAt > this.deps.nowMs()) return cached.status
    const def = this.definition(id)
    if (def.transport === 'native-loop') return this.store(id, nativeStatus(def))
    const command = await this.resolveCommand(def)               // override > 随包 > PATH（detect.command + aliases）
    if (!command) return this.store(id, { harnessId: id, installed: 'no', login: 'unknown', checkedAt: iso() })
    const version = await this.readVersion(def, command)         // 超时 5s，失败则 installed=unknown
    const login = await this.deps.probeLogin(def, command)       // 各 harness 自己的探测器（§5.3）
    return this.store(id, { harnessId: id, installed: 'yes', version: version?.text,
      versionSupported: version ? semverGte(version.text, def.detect?.minVersion) : undefined,
      login, resolvedCommand: command, checkedAt: iso() })
  }
}
```

### 5.2 命令解析顺序

1. 设置里的 `binaryPath` 覆盖（用户显式指定）。
2. 随包二进制：Claude Code 复用现有 `resolveBundledClaudeBinary`；其他 harness 暂无随包。
3. PATH 查找：`detect.command`，再依次试 `aliases`。Windows 下沿用现有进程启动封装，不使用 `shell: true`。

### 5.3 登录探测

| harness | 探测方式 | 备注 |
| --- | --- | --- |
| claude-code | 复用 `src/main/claude-subscription-auth.ts` 的状态检测逻辑，下沉到 kun | 不跑模型请求 |
| cursor | 是否配置了 Cursor API key | 现有 provider 字段 |
| antigravity | 复用现有 Antigravity 启动器的登录检测 | |
| ACP 类 | `initialize` 返回的 `authMethods` 为空，或 `authenticate` 不需要交互 | 见 03 §4 |

探测不得触发付费调用；只读本地状态或做一次协议握手。

## 6. 路由：`HarnessRouter`

### 6.1 解析规则：`kun/src/harness/resolve-turn-harness.ts`

```ts
const KIND_TO_HARNESS: Record<string, HarnessId> = {
  'agent-sdk': 'claude-code',
  'cursor-sdk': 'cursor',
  'antigravity-cli': 'antigravity'
}

export function resolveTurnHarness(input: {
  thread: Pick<ThreadRecord, 'harnessId' | 'providerId'>
  turn?: Pick<TurnRecord, 'harnessId' | 'providerId' | 'credentialMode'>
  providers: Record<string, Pick<ServeProviderConfig, 'kind'>>
}): { harnessId: HarnessId; providerId?: string; credentialMode: HarnessCredentialMode } {
  const providerId = input.turn?.providerId?.trim() || input.thread.providerId?.trim() || undefined
  const explicit = input.turn?.harnessId ?? input.thread.harnessId
  if (explicit) {
    return { harnessId: explicit, providerId,
      credentialMode: input.turn?.credentialMode ?? defaultCredentialMode(explicit, providerId, input.providers) }
  }
  // 向后兼容：没有 harnessId 的历史线程，按 provider kind 推断。
  const kind = providerId ? input.providers[providerId]?.kind : undefined
  const legacy = kind ? KIND_TO_HARNESS[kind] : undefined
  return legacy
    ? { harnessId: legacy, providerId, credentialMode: 'native-login' }
    : { harnessId: 'kun', providerId, credentialMode: 'provider' }
}
```

`defaultCredentialMode`：

- harness 是 `kun` → `provider`。
- providerId 的 kind 正好是这个 harness 的原生 kind（例如 claude-code + agent-sdk provider）→ `native-login`。
- 其余情况（例如 claude-code + deepseek provider）→ `kun-gateway`，并要求 04 的网关已启用，否则 turn 准入失败（02 §5）。

### 6.2 `DelegatedTurnRuntime` 扩展

`kun/src/runtime/delegated-turn-runtime.ts`：

```ts
export interface DelegatedTurnRuntime {
  handlesProvider(providerId: string | undefined): boolean
  /** 新增。未实现时回退到 handlesProvider(route.providerId)。 */
  handlesRoute?(route: ResolvedHarnessRoute): boolean
  capabilities(providerId: string | undefined): DelegatedRuntimeCapabilities | undefined
  /** 新增。能力声明 v2（见 02）；未实现时由旧的 7 个布尔值推导。 */
  capabilitiesV2?(route: ResolvedHarnessRoute): HarnessCapabilities | undefined
  resolveProvider?(providerId: string | undefined): DelegatedTurnRuntime | undefined
  runTurn(threadId: string, turnId: string, signal: AbortSignal, providerId?: string): Promise<TurnRunOutcome>
}

export type ResolvedHarnessRoute = {
  harnessId: HarnessId
  transport: HarnessTransport
  providerId?: string
  model: string
  credentialMode: HarnessCredentialMode
}
```

新增 `kun/src/harness/harness-router.ts`：

```ts
export class HarnessRouter {
  constructor(private readonly deps: {
    catalog: HarnessCatalog                      // 内置 + 自定义定义
    runtimes: Partial<Record<HarnessTransport, DelegatedTurnRuntime>>
    providers: () => Record<string, ServeProviderConfig>
  }) {}

  /** 返回 undefined 表示走原生 AgentLoop。 */
  resolve(thread: ThreadRecord, turnId: string): { runtime?: DelegatedTurnRuntime; route: ResolvedHarnessRoute } {
    const turn = thread.turns.find((t) => t.id === turnId)
    const r = resolveTurnHarness({ thread, turn, providers: this.deps.providers() })
    const def = this.deps.catalog.get(r.harnessId)
    if (!def) throw new HarnessAdmissionError('harness_unknown', r.harnessId)
    const route = { ...r, transport: def.transport, model: turn?.model ?? thread.model }
    if (def.transport === 'native-loop') return { route }
    const runtime = this.deps.runtimes[def.transport]
    if (!runtime) throw new HarnessAdmissionError('harness_unavailable', r.harnessId)
    const accepts = runtime.handlesRoute?.(route) ?? runtime.handlesProvider(route.providerId)
    if (!accepts) throw new HarnessAdmissionError('route_unsupported', r.harnessId)
    return { runtime: runtime.resolveProvider?.(route.providerId) ?? runtime, route }
  }
}
```

### 6.3 接入点：`kun/src/loop/agent-loop-turn-lifecycle.ts:125-139`

替换现有的 provider 推断块：

```ts
const owningThread = await this.opts.threadStore.get(threadId)
let delegatedSdkRuntime: DelegatedTurnRuntime | undefined
let delegatedRoute: ResolvedHarnessRoute | undefined
if (this.opts.harnessRouter && owningThread) {
  try {
    const resolved = this.opts.harnessRouter.resolve(owningThread, turnId)
    delegatedSdkRuntime = resolved.runtime
    delegatedRoute = resolved.route
  } catch (error) {
    if (error instanceof HarnessAdmissionError) {
      const settlement = await settle({ status: 'failed', error: error.userMessage, code: error.code })
      return statusFromSettlement(settlement, 'failed')
    }
    throw error
  }
} else if (this.opts.sdkRuntime) {
  // 旧路径保留一个版本周期，便于回滚（13 §6 的开关关闭时走这里）。
}
const delegatedProviderId = delegatedRoute?.providerId
```

注意：

- `resolveProvider` 必须在任何 await 生命周期之前调用，保持现有"一轮开始后配置热更新不能换运行时"的不变量（`delegated-turn-runtime.ts` 注释）。
- 线程里记录的 `harnessId` 要写进 `delegated_runtime` 事件（02 §6），前端据此显示 agent。

### 6.4 组合根：`kun/src/server/runtime-composition-agent.ts:250`

`buildMainDelegatedRuntime` 现在返回 `composeDelegatedTurnRuntimes([...])`。改成分别构造，交给 `HarnessRouter`：

```ts
const runtimes = {
  'agent-sdk': createAgentSdkRuntime(sdkRuntimeDeps),
  'antigravity-cli': new AntigravityCliRuntime(antigravityRuntimeDeps),
  'cursor-sdk': createCursorSdkRuntime(cursorRuntimeDeps),
  acp: createAcpRuntime(acpRuntimeDeps)          // 03
}
const harnessRouter = new HarnessRouter({ catalog, runtimes, providers: () => core.activeOptions.providers ?? {} })
```

`ReplaceableDelegatedTurnRuntime` 的热替换语义保留：`HarnessRouter` 本身也做成可替换（`model.refreshModelConnectionDelegatedDeps` 里一起替换）。

外部运行时有**两个**组合点，都要改：

1. 主运行时：`runtime-composition-agent.ts:250` 的 `buildMainDelegatedRuntime`（上面的代码）。
2. 子运行时：`runtime-composition-registry.ts:73` 的 `createChildDelegatedRuntime`，它用子任务专用的 registry、`childToolHost`、child turns / stores 组合同样三个运行时，经 `child-agent-executor.ts:128` 的 `createDelegatedRuntime` 注入每个子任务的 AgentLoop。这里同样改为构造一个子作用域的 `HarnessRouter`（运行时实例用 child 依赖），worker 才能按 `harnessId` 选引擎（09 依赖这一点）。

两处共用一个 `buildHarnessRuntimes(deps)` 工厂，避免两份装配逻辑漂移。

## 7. 设置与配置桥

### 7.1 GUI 设置：`agents.kun.harnesses`

`src/shared/app-settings-types-kun-runtime.ts`：

```ts
export type KunHarnessSettingsV1 = {
  /** 用户关掉的内置 harness 不出现在选择器里。 */
  disabledIds: string[]
  /** 按 harness 覆盖本机命令路径。 */
  binaryPaths: Record<string, string>
  /** 用户自定义的 ACP harness。 */
  custom: Array<{
    id: string; displayName: string; command: string; args: string[]; env: Record<string, string>
  }>
  /** 每个 harness 的默认权限档（值为 permissionModes[].id）。缺省用最严档。 */
  defaultPermissionMode: Record<string, string>
  /** 新建一对一会话时默认选哪个 harness。 */
  defaultHarnessId: string
}
```

四层同步（历史上漏过，必须全部改）：

1. `src/shared/app-settings-kun.ts`：normalize，未知字段丢弃，`custom[].id` 与内置 id 冲突时丢弃并记日志。
2. `src/main/ipc/app-ipc-schemas/settings-model.ts:328` 的 `kunRuntimePatchSchema`（`.strict()`）加 `harnesses` 字段。不加会被静默拒绝。
3. `src/main/runtime/kun-runtime-model-config.ts`：新增 `harnessesConfigForRuntime(settings)`，写入 config.json 顶层 `harnesses` 段。
4. `kun/src/config/kun-config-application.ts:370` 的 `KunConfigSchema` 加 `harnesses: HarnessesConfigSchema.optional()`；`src/main/runtime/kun-runtime-config-service.ts:472` 的 `sanitizeKunConfigSections` 登记这一段。

`harnessesConfigForRuntime` 必须是纯函数、输出稳定排序，否则 config 每次同步都不同，会触发重启死循环（Codex session_id 那次的教训）。

### 7.2 凭据

harness 的凭据不进 config.json：

- `native-login`：harness 自己读本机登录（例如 `~/.claude`），Kun 只负责剥离会干扰它的环境变量（沿用 `buildScopedEnv`）。
- `provider`：沿用现有 `credentialSourceId` 机制。
- `kun-gateway`：运行时签发的短期令牌（04 §4），不落盘。

## 8. 外部会话接续（P2）

已有 `/v1/history-sources/{codex,claude-code,opencode}/*` 和"从历史创建分支"（`docs/codex-reference-branches.md`），目前在实验室开关后面。ADE 里：

- 一对一新建会话时，如果选的 harness 有 `historySource`，显示"接续本机会话"入口，调用现有 `sessions` 列表接口。
- 选中后调用现有 `POST /v1/threads/reference-branches` 建 Kun 分支，并把新线程的 `harnessId` 设为同一个 harness。
- 模型通过现有 `read_source_history` 工具按需读旧历史（不自动灌进上下文），和 08 的交接检索口径一致。
- 这一项只是接线，不新增存储。

## 9. HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/harnesses` | 定义 + 缓存的状态 + 生效能力（02）。不触发检测 |
| POST | `/v1/harnesses/:id/probe` | 强制重新检测一个 harness |
| GET | `/v1/harnesses/:id/models` | `modelSource: 'probe'` 时调用 harness 的模型列表（Claude 走现有 `supportedModels()` 路径；ACP 走 `session/new` 返回值或配置） |

路由注册放在新文件 `kun/src/server/routes/register-harness-routes.ts`，由 `register-core-routes.ts` 调用；响应用 `contracts/harness.ts` 里的 schema `parse` 后返回，和 `project-boards.ts` 的写法一致。

## 10. Renderer

- `src/renderer/src/agent/kun-runtime.ts`：新增 `listHarnesses()`、`probeHarness(id)`、`listHarnessModels(id)`。
- 设置页：在现有 Settings → Agents 下新增"Agents"分组（harness 列表，每行：图标、名称、版本、登录态、开关、kebab 菜单里"重新检测 / 设置命令路径 / 默认权限"）。遵循 12 §2 的行规范。
- composer：模型选择器前加 agent 选择器（12 §6）。
- 线程列表：`ThreadSummary.harnessId` 决定行首图标。

## 11. 兼容与迁移

- 历史线程没有 `harnessId`：解析时按 provider kind 推断，**不回写**，避免批量改历史数据。
- 现有 `claude-subscription` / cursor / antigravity preset 保持不变；它们是这些 harness 的 `native-login` 凭据来源。
- `ServeProviderConfigSchema.kind` 的枚举保留，新增的 ACP harness 不走 provider kind。
- `docs/AGENTS.md` 的 "No AgentSwitcher" 条目需要改写（13 §4），明确"选择 harness 是选择 turn 引擎，不是切换运行时"。

## 12. 测试

| 测试 | 位置 | 断言 |
| --- | --- | --- |
| 解析兼容 | `kun/src/harness/resolve-turn-harness.test.ts` | 无 harnessId 时 agent-sdk / cursor-sdk / antigravity-cli / http 四种 provider 的推断结果与现状一致 |
| 显式 harness | 同上 | turn 覆盖 thread；未知 harness 抛 `harness_unknown` |
| credentialMode 默认值 | 同上 | claude-code + agent-sdk provider → native-login；claude-code + http provider → kun-gateway |
| 路由准入 | `harness-router.test.ts` | runtime 缺失 → `harness_unavailable`；`handlesRoute` 拒绝 → `route_unsupported`，且 turn 以可读错误失败 |
| 生命周期不回归 | 现有 `agent-loop` 相关测试 | 原有委派测试全部通过 |
| 检测 | `harness-detector.test.ts` | 注入 spawn：找不到命令、版本解析失败、超时、缓存 TTL、force 刷新 |
| 配置同步稳定 | `kun-runtime-model-config.test.ts` | 同一份设置两次生成的 `harnesses` 段逐字节相同 |
| IPC schema | `settings-model` 相关测试 | 带 `harnesses` 的 patch 通过 strict 校验且字段完整保留 |

## 13. 文件清单

新增：

- `kun/src/contracts/harness.ts`
- `kun/src/harness/builtin-harnesses.ts`、`harness-catalog.ts`、`harness-detector.ts`、`harness-router.ts`、`resolve-turn-harness.ts`
- `kun/src/server/routes/register-harness-routes.ts`

修改：

- `kun/src/contracts/threads.ts`、`turns.ts`、`events.ts`
- `kun/src/runtime/delegated-turn-runtime.ts`
- `kun/src/loop/agent-loop-turn-lifecycle.ts`、`agent-loop-options.ts`
- `kun/src/server/runtime-composition-agent.ts`、`runtime-composition-registry.ts`
- `kun/src/delegation/child-agent-executor.ts`
- `kun/src/config/kun-config-application.ts`
- `src/shared/app-settings-types-kun-runtime.ts`、`app-settings-kun.ts`
- `src/main/ipc/app-ipc-schemas/settings-model.ts`
- `src/main/runtime/kun-runtime-model-config.ts`、`kun-runtime-config-service.ts`
- `src/renderer/src/agent/kun-runtime.ts`、`kun-mapper-projection.ts`、`thread-runtime-types.ts`
