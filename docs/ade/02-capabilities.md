# 02 能力声明 v2、准入矩阵与 UI 降级契约

- 阶段：P0
- 依赖：01
- 被依赖：03、05、09、10、12

## 1. 目标

1. 每个 harness 的每项能力要么"支持"，要么写明**为什么不支持**（上游没有 / Kun 没做 / 平台限制），UI 直接用这段说明做置灰提示。
2. 定义**准入矩阵**：每个使用场景（worker、Graph 节点、Rooms、定时任务、IM、计划构建……）要求哪些能力，不满足的 harness 在 kun 侧被拒绝，而不是只在 UI 里隐藏。
3. 让"降级"成为可测试的契约，而不是散落在各组件里的 `if`。

## 2. 现状

- `kun/src/contracts/events.ts:497` 的 `DelegatedRuntimeCapabilitiesSchema` 只有 7 个布尔值：`nativeResume / structuredStreaming / kunTools / externalApproval / liveSteering / nativeContextTelemetry / fork`；运行时类型里还多一个可选的 `roomToolPolicy`（`delegated-turn-runtime.ts`）。
- 前端在 `src/renderer/src/agent/kun-mapper-projection.ts:274` 解析，`chat-store-thread-queue-actions.ts:511` 用 `liveSteering === false` 拒绝"引导"消息。
- Rooms 的准入规则写在 `docs/kun-architecture.md`（"订阅 SDK 只有在声明并实际使用 Kun tool bridge、原生工具拦截、外部审批和 scoped workspace 时才能进入 Rooms"），由各运行时自己判断，没有统一函数。

## 3. 契约：`kun/src/contracts/harness-capabilities.ts`（新增）

```ts
import { z } from 'zod'

export const CapabilityStatusSchema = z.discriminatedUnion('supported', [
  z.object({ supported: z.literal(true) }).strict(),
  z.object({
    supported: z.literal(false),
    /** upstream：harness 本身没有；not-implemented：Kun 还没接；platform：当前平台/版本/登录态不支持 */
    reason: z.enum(['upstream', 'not-implemented', 'platform']),
    /** 可选的上游引用，便于追踪，例如 "acp: session/fork is unstable" */
    upstreamRef: z.string().max(256).optional(),
    /** 给用户看的一句话，直接用作 tooltip。i18n 键优先，缺省用原文 */
    messageKey: z.string().max(128).optional(),
    message: z.string().max(256).optional()
  }).strict()
])
export type CapabilityStatus = z.infer<typeof CapabilityStatusSchema>

export const HARNESS_CAPABILITY_KEYS = [
  // 会话
  'nativeResume', 'fork', 'rewind',
  // 流式与控制
  'structuredStreaming', 'reasoningStream', 'abort', 'sameTurnSteer',
  'switchModelMidSession', 'setPermissionModeMidSession', 'effort', 'planMode', 'manualCompact',
  // 工具与中介
  'kunTools', 'externalApproval', 'nativeToolInterception', 'fsMediated', 'terminalMediated',
  // 上下文与输入
  'nativeContextTelemetry', 'imageInput', 'fileInput', 'nativeCommands', 'modes',
  // 协作
  'userInput'
] as const
export type HarnessCapabilityKey = (typeof HARNESS_CAPABILITY_KEYS)[number]

export const HarnessCapabilitiesSchema = z.object({
  statuses: z.object(Object.fromEntries(
    HARNESS_CAPABILITY_KEYS.map((key) => [key, CapabilityStatusSchema])
  ) as Record<HarnessCapabilityKey, typeof CapabilityStatusSchema>).strict(),
  /** 不是布尔能力、而是事实的维度 */
  facts: z.object({
    /** 谁在执行边界上生效：host=Kun 的 sandbox 真正生效；native=harness 自带沙箱；none=都没有 */
    sandbox: z.enum(['host', 'native', 'none']),
    usageReporting: z.enum(['exact', 'estimated', 'none']),
    /** 这个 harness 是否由 Kun 管理上下文压缩（08 §7） */
    compactionOwner: z.enum(['kun', 'harness', 'none'])
  }).strict()
}).strict()
export type HarnessCapabilities = z.infer<typeof HarnessCapabilitiesSchema>
```

各项含义：

| 键 | 含义 | 典型不支持的情况 |
| --- | --- | --- |
| nativeResume | 能恢复 harness 自己的原生会话 | Antigravity CLI |
| fork / rewind | 能在原生会话层分叉 / 回退 | 多数 ACP agent |
| structuredStreaming | 事件是结构化流，不是只有最终文本 | Antigravity |
| reasoningStream | 能流式给出思考内容 | 取决于模型 |
| abort | 能中断进行中的一轮 | 几乎都支持 |
| sameTurnSteer | 能把补充输入插进正在进行的一轮 | 现有 3 个外部运行时都不支持 |
| switchModelMidSession | 同一原生会话里能换模型 | 大多数；即使支持，也按 08 §6 视为重建 |
| setPermissionModeMidSession | 会话中能改权限档 | 取决于 harness |
| effort / planMode / manualCompact | 推理强度、计划模式、手动压缩 | |
| kunTools | 能用 Kun 独有工具（memory、画布、worker 回调……） | Antigravity（`kunTools: false`） |
| externalApproval | 每次工具调用都回到 Kun 的审批 | Antigravity、终端 agent |
| nativeToolInterception | Kun 能拦截并禁用 harness 原生工具 | Cursor SDK（`kun-architecture.md` 已注明） |
| fsMediated | 文件读写经 Kun（ACP `fs/*` 客户端方法） | SDK 类 harness 自己写盘 |
| terminalMediated | 命令执行经 Kun 的受管终端 | 同上 |
| nativeContextTelemetry | harness 报告上下文占用 | |
| imageInput / fileInput | 能接收图片 / 文件输入 | |
| nativeCommands | 能列出 harness 自己的斜杠命令 | |
| modes | 能列出并切换 harness 自己的模式 | |
| userInput | 能向用户提结构化问题（Kun 的 user_input 面板） | 无 kunTools 时不支持 |

## 4. 静态声明与运行时收窄

```text
effective = intersect(
  definition.capabilities,          // 01 的目录里静态声明
  runtimeReported,                  // 运行时握手结果，例如 ACP initialize 的 agentCapabilities
  routeConstraints,                 // credentialMode 带来的限制，例如 kun-gateway 下的 imageInput
  detectorConstraints               // 版本过低、未登录 → platform
)
```

实现：`kun/src/harness/effective-capabilities.ts`

```ts
export function intersectCapabilities(...layers: HarnessCapabilities[]): HarnessCapabilities {
  const statuses = {} as Record<HarnessCapabilityKey, CapabilityStatus>
  for (const key of HARNESS_CAPABILITY_KEYS) {
    // 取第一个不支持的层作为原因，保证 tooltip 说的是"最根本"的那个限制
    statuses[key] = layers.map((l) => l.statuses[key]).find((s) => !s.supported) ?? { supported: true }
  }
  return {
    statuses,
    facts: {
      sandbox: weakestSandbox(layers.map((l) => l.facts.sandbox)),          // none < native < host
      usageReporting: weakestUsage(layers.map((l) => l.facts.usageReporting)),
      compactionOwner: layers[layers.length - 1]!.facts.compactionOwner
    }
  }
}
```

权限档排序规则（来自参考项目的经验，写成不变量）：

- `HarnessDefinition.permissionModes` 必须**从严到宽**排序，`[0]` 是最严档。
- 无人值守路径（定时任务、IM、总管派活时用户不在场）如果请求的档位不被支持，**回落到 `[0]`**，绝不回落到更宽的档。
- 测试守护：`builtin-harnesses.test.ts` 断言每个内置 harness 的 `permissionModes` 按 `KUN_TOOL_PERMISSION_MODES` 顺序单调不减。

### 4.1 旧布尔值的推导

```ts
export function capabilitiesV2FromLegacy(
  legacy: DelegatedRuntimeCapabilities,
  base: HarnessCapabilities            // 目录里的静态声明
): HarnessCapabilities {
  const upstream = (ref: string): CapabilityStatus => ({ supported: false, reason: 'upstream', upstreamRef: ref })
  return intersectCapabilities(base, {
    statuses: {
      ...base.statuses,
      nativeResume: legacy.nativeResume ? { supported: true } : upstream('runtime'),
      structuredStreaming: legacy.structuredStreaming ? { supported: true } : upstream('runtime'),
      kunTools: legacy.kunTools ? { supported: true } : upstream('runtime'),
      externalApproval: legacy.externalApproval ? { supported: true } : upstream('runtime'),
      sameTurnSteer: legacy.liveSteering ? { supported: true } : upstream('runtime'),
      nativeContextTelemetry: legacy.nativeContextTelemetry ? { supported: true } : upstream('runtime'),
      fork: legacy.fork ? { supported: true } : upstream('runtime')
    },
    facts: base.facts
  })
}
```

现有三个运行时先不改，由 `capabilitiesV2FromLegacy` 推导；新 ACP 运行时直接实现 `capabilitiesV2`。

## 5. 准入矩阵

### 5.1 使用场景

```ts
export const HARNESS_USAGES = [
  'one-to-one',          // Code 一对一
  'manager-worker',      // 总管派的 worker（09）
  'graph-worker',        // Graph 工作节点
  'graph-lead',          // Graph 规划/监督（现有 delegated-graph-turn-policy）
  'room-execution',      // Rooms 已授权的执行阶段
  'scheduled',           // 定时任务
  'im',                  // IM 入口
  'plan-build',          // 计划构建（worktree 协议）
  'design'               // 设计任务（GUI 画布工具）
] as const
```

### 5.2 要求

| 场景 | 必须支持 | 额外事实要求 | 说明 |
| --- | --- | --- | --- |
| one-to-one | abort | — | 最宽松，任何装好、登录的 harness 都能用 |
| manager-worker | abort、structuredStreaming | sandbox ≠ none **或** 工作区是宿主 worktree | 总管要看过程；无沙箱的 agent 只能在隔离 worktree 里跑 |
| graph-worker | abort、structuredStreaming、kunTools | 同上 | Graph worker 必须能调用结果/证据相关工具 |
| graph-lead | kunTools、nativeToolInterception | — | 与现有 `delegatedGraphTurnPolicy` 的 `disableNativeTools: true` 一致 |
| room-execution | kunTools、externalApproval、nativeToolInterception | sandbox = host | 把 `kun-architecture.md` 里的 Rooms 规则落成数据 |
| scheduled / im | abort | 请求档位不支持时回落最严档 | 无人值守 |
| plan-build | abort | 工作区必须是宿主 worktree（07） | 外部 agent 不执行 Kun 的 worktree 提示协议 |
| design | kunTools | — | 画布工具是 Kun 独有工具 |

`userInput` 不支持时：场景仍准入，但该 turn 设 `disableUserInput: true`（现有字段），问题改走 worker 回调的 `ask_manager`（05）或直接失败说明原因。

### 5.3 实现：`kun/src/harness/harness-admission.ts`

```ts
export type AdmissionResult =
  | { ok: true; effective: HarnessCapabilities; permissionMode: string }
  | { ok: false; code: 'capability_missing' | 'sandbox_insufficient' | 'harness_not_ready';
      missing: HarnessCapabilityKey[]; message: string }

export function checkHarnessAdmission(input: {
  usage: HarnessUsage
  harness: HarnessDefinition
  effective: HarnessCapabilities
  status: HarnessStatus
  workspace: { isolated: boolean }            // 是否是宿主创建的隔离 worktree（07）
  requestedPermissionMode?: string
  unattended: boolean
  allowUnattendedFullAccess: boolean
}): AdmissionResult {
  if (input.harness.transport !== 'native-loop' &&
      (input.status.installed !== 'yes' || input.status.login === 'signed-out')) {
    return fail('harness_not_ready', [], statusMessage(input.status))
  }
  const rule = ADMISSION_RULES[input.usage]
  const missing = rule.required.filter((key) => !input.effective.statuses[key].supported)
  if (missing.length) return fail('capability_missing', missing, firstMessage(input.effective, missing))
  if (rule.sandbox === 'host' && input.effective.facts.sandbox !== 'host') {
    return fail('sandbox_insufficient', [], 'harness sandbox cannot be enforced by Kun')
  }
  if (rule.sandbox === 'isolated-or-native' &&
      input.effective.facts.sandbox === 'none' && !input.workspace.isolated) {
    return fail('sandbox_insufficient', [], 'harness without sandbox must run in an isolated worktree')
  }
  return { ok: true, effective: input.effective,
    permissionMode: resolvePermissionMode(input.harness, input.requestedPermissionMode,
      input.unattended, input.allowUnattendedFullAccess) }
}

/**
 * 请求的档位不存在时回落 permissionModes[0]。
 * 无人值守时，完全访问档只有在用户显式打开 agents.kun.ade.allowUnattendedFullAccess
 * （默认 false，13 §2）时才保留，否则同样回落 [0]。
 */
export function resolvePermissionMode(
  def: HarnessDefinition,
  requested: string | undefined,
  unattended: boolean,
  allowUnattendedFullAccess: boolean
): string {
  const found = def.permissionModes.find((m) => m.id === requested)
  if (!found) return def.permissionModes[0]!.id
  if (unattended && found.kunPermissionMode === 'full-access' && !allowUnattendedFullAccess) {
    return def.permissionModes[0]!.id
  }
  return found.id
}
```

### 5.4 执行点

准入必须在 kun 里执行，不能只靠 UI：

1. `HarnessRouter.resolve()`（01 §6.2）：根据 turn 的 `clientSurface`、`roomContext`、`orchestration`、`agentSurface` 推出 usage，调用 `checkHarnessAdmission`，失败抛 `HarnessAdmissionError`，turn 以可读错误结束。
2. 总管的 `worker_create`（09 §4）：派活前检查，失败时工具结果里返回缺什么能力，总管可以换一个 harness。
3. Graph 计划校验：节点 assignment 指定 harness 时，在 `graph_define_plan` 阶段就检查（10 §3）。
4. `GET /v1/harnesses?usage=manager-worker`：返回每个 harness 的准入结果，UI 选择器据此置灰并显示原因。

usage 推导：

```ts
export function usageForTurn(thread: ThreadRecord, turn: Turn): HarnessUsage {
  if (thread.roomContext) return 'room-execution'
  if (turn.orchestration === 'graph') return turn.graphLeadLifecycle || turn.graphPlanningLifecycle ? 'graph-lead' : 'graph-worker'
  if (thread.executionUnit?.kind === 'worker') return 'manager-worker'            // 09 新增字段
  if (turn.imContext === true || turn.clientSurface === 'im') return 'im'
  if (turn.disableUserInput === true) return 'scheduled'                            // 无人值守：定时任务、headless API
  if (turn.agentSurface === 'design') return 'design'
  return 'one-to-one'
}

/** 无人值守的唯一判据：turn 上的 disableUserInput（contracts/turns.ts，IM 与 headless 运行都会设置） */
export const isUnattendedTurn = (turn: Turn): boolean => turn.disableUserInput === true || turn.imContext === true
```

turn 上没有定时任务 id 字段（2026-09-25 核对 `contracts/turns.ts`）；无人值守统一按 `disableUserInput` / `imContext` 判定。

## 6. 事件与前端

### 6.1 `delegated_runtime` 事件扩展（`kun/src/contracts/events.ts:507`）

```ts
export const DelegatedRuntimeEvent = RuntimeEventBase.extend({
  kind: z.literal('delegated_runtime'),
  providerKind: z.enum(['agent-sdk', 'cursor-sdk', 'antigravity-cli', 'acp']),   // 加 acp
  providerId: z.string().min(1),
  harnessId: HarnessIdSchema.optional(),                                          // 新增
  phase: z.enum(['portable', 'resumed', 'rebased']),
  reason: /* 不变 */,
  capabilities: DelegatedRuntimeCapabilitiesSchema,                               // 保留，旧前端依赖
  capabilitiesV2: HarnessCapabilitiesSchema.optional()                            // 新增
})
```

- 旧字段保留一个版本周期；新前端优先读 `capabilitiesV2`，缺失时自己用 `capabilitiesV2FromLegacy` 推导（renderer 侧复制一份纯函数，放 `src/shared/harness-capabilities.ts`，两边用同一组测试夹具）。
- 原生 loop 的 turn 也发一次该事件（`providerKind` 不适用时，新增 `kind: 'harness_runtime'` 事件更干净——实现时二选一，推荐新事件，避免 `providerKind` 语义被滥用）。

### 6.2 UI 降级契约

放在 `src/renderer/src/agent/harness-capability-ui.ts`，所有组件只调这里的函数：

| 能力不支持 | UI 行为 |
| --- | --- |
| sameTurnSteer | "引导"按钮置灰，tooltip 用 message；输入进入排队轨道（12 §5） |
| abort | 停止按钮置灰；显示"该 agent 不支持中断"（理论上不应准入） |
| switchModelMidSession | 模型选择器在会话中只显示当前模型，切换项改为"用新模型开新会话" |
| effort | 推理强度控件隐藏 |
| planMode | 计划模式开关隐藏；计划任务改走 Kun 原生 |
| modes / nativeCommands | 不显示 harness 模式图标 / 斜杠菜单里不出现 harness 命令 |
| imageInput | 附件按钮只允许文件；粘贴图片时提示 |
| kunTools | 记忆、画布、worker 回调相关入口不出现在该会话 |
| nativeContextTelemetry | 上下文容量表显示"未知"，不显示估算百分比 |
| usageReporting = none | 用量显示"不可用"，不显示 0 |
| rewind / fork | 对应菜单项置灰，tooltip 用 message |

规则：置灰优先于隐藏；只有"这个 harness 永远不会有"（reason = upstream）且入口在主路径上会造成干扰时才隐藏。

## 7. 测试

| 测试 | 断言 |
| --- | --- |
| `harness-capabilities.test.ts` | schema 解析；`intersectCapabilities` 取最先出现的不支持原因；facts 取最弱值 |
| `capabilities-v2-legacy.test.ts` | 现有三个运行时的旧布尔值推导结果（快照） |
| `harness-admission.test.ts` | 准入矩阵每一行至少一个通过和一个拒绝用例；无沙箱 + 非隔离工作区被拒；无人值守回落 `[0]` |
| `builtin-harnesses.test.ts` | 权限档从严到宽排序；每个内置定义都通过 schema |
| renderer `harness-capability-ui.test.ts` | 每一行降级规则 |
| 跨端一致性 | kun 与 `src/shared` 两份推导函数对同一组夹具输出一致 |

## 8. 文件清单

新增：

- `kun/src/contracts/harness-capabilities.ts`
- `kun/src/harness/effective-capabilities.ts`、`harness-admission.ts`、`usage-for-turn.ts`
- `src/shared/harness-capabilities.ts`
- `src/renderer/src/agent/harness-capability-ui.ts`

修改：

- `kun/src/contracts/events.ts`
- `kun/src/runtime/delegated-turn-runtime.ts`（`capabilitiesV2` 可选方法）
- `kun/src/harness/harness-router.ts`（调用准入）
- `src/renderer/src/agent/kun-mapper-projection.ts`、`thread-runtime-types.ts`
- `src/renderer/src/store/chat-store-thread-queue-actions.ts`（改用 `harness-capability-ui`）
