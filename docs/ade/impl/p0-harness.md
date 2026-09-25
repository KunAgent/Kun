# P0-01 ~ P0-06：红线文档、harness、准入、设置桥

设计依据：[01](../01-harness-routing.md)、[02](../02-capabilities.md)、[13 §3–§4](../13-governance-rollout.md)。

---

## P0-01 红线文档改写（S，D）

- 分支：`codex/ade-docs-redlines`；提交：`docs(agents): allow external agent harnesses inside kun serve`
- 依赖：无。**必须最先合入**，否则后续 PR 会被按现有红线判为违规。

改动：

| 文件 | 改什么 |
| --- | --- |
| `docs/AGENTS.md` | "Forbidden Paths"两条改写、"Allowed Extension Path"加第 6 条（原文见 13 §4.1–§4.2） |
| `docs/AGENTS.zh-CN.md` | 同步中文版 |
| `AGENTS.md`（根） | "Do not recreate …"后补一句例外说明（13 §4.4） |
| `docs/kun-architecture.md` / `.en.md` | "GUI 要拆的东西"与 Settings 两处措辞；新增"ADE：总管与 worker"小节，只放不变量并链接 `docs/ade/README.md` |

验证：`git diff --check`；`npm run check:file-lines`。

完成标准：四个文件的措辞彼此一致；原有禁令（AgentSwitcher 切换运行时、CodeWhale/Reasonix 路径、运行时诊断面板）全部保留。

---

## P0-02 harness 契约、内置目录、能力 v2（M，K S）

- 分支：`codex/ade-harness-contracts`；提交：`feat(harness): add harness contracts, builtin catalog and capability statuses`
- 依赖：P0-01
- 只加纯数据与纯函数，不接线，不改变任何运行行为。

### 新增文件

| 文件 | 内容 |
| --- | --- |
| `kun/src/contracts/harness-capabilities.ts` | `CapabilityStatusSchema`、`HARNESS_CAPABILITY_KEYS`、`HarnessCapabilitiesSchema`（02 §3） |
| `kun/src/contracts/harness.ts` | `HarnessIdSchema`、`HarnessTransportSchema`、`HarnessCredentialModeSchema`、`HarnessPermissionModeSchema`（`kunPermissionMode: z.enum(KUN_TOOL_PERMISSION_MODES)`）、`HarnessDefinitionSchema`、`HarnessRouteSchema`、`HarnessStatusSchema`（01 §3） |
| `kun/src/harness/builtin-harnesses.ts` | `BUILTIN_HARNESSES`：kun、claude-code、cursor、antigravity（P1-05 再加 ACP 三个） |
| `kun/src/harness/effective-capabilities.ts` | `intersectCapabilities()`、`capabilitiesV2FromLegacy()`、`weakestSandbox()`、`weakestUsage()` |
| `src/shared/harness-capabilities.ts` | renderer 用的同一组类型与 `capabilitiesV2FromLegacy`（不能 import kun，复制一份纯函数） |
| `kun/src/harness/__fixtures__/capability-fixtures.ts` | 两端共用的测试夹具（renderer 测试通过相对路径读 JSON 版本 `capability-fixtures.json`） |

### 实现要点

1. `HARNESS_CAPABILITY_KEYS` 用 `as const` 数组；`HarnessCapabilitiesSchema.statuses` 用 `z.object(Object.fromEntries(...))`，并对外导出类型 `Record<HarnessCapabilityKey, CapabilityStatus>`。
2. 内置 harness 的能力声明：
   - `kun`：全部 supported；facts `{ sandbox: 'host', usageReporting: 'exact', compactionOwner: 'kun' }`。
   - `claude-code`：按现有 `agent-sdk-runtime-stream.ts:14` 的布尔值推导，`sameTurnSteer`、`fork`、`nativeContextTelemetry` 为 `{ supported: false, reason: 'upstream' }`；facts `{ sandbox: 'native', usageReporting: 'exact', compactionOwner: 'harness' }`。
   - `cursor`：按 `cursor-sdk-runtime-trace.ts:112`；`nativeToolInterception` 为 `{ supported: false, reason: 'upstream', upstreamRef: 'cursor sdk has no native tool interception' }`。
   - `antigravity`：按 `antigravity-cli-runtime.ts:508`，`kunTools`、`externalApproval`、`structuredStreaming` 均不支持；facts `{ sandbox: 'none', usageReporting: 'none', compactionOwner: 'harness' }`。
3. `messageKey` 统一用 `harness.capability.<key>.<reason>`，i18n 在 P0-05 补。

### 测试

| 用例 | 断言 |
| --- | --- |
| schema：每个内置定义 `HarnessDefinitionSchema.parse` 通过 | 不抛错 |
| 权限档单调：每个定义的 `permissionModes` 按 `ask-for-approval < approve-for-me < full-access` 不减 | 断言成立（02 §4 的不变量） |
| `intersectCapabilities`：两层中第二层某键不支持 | 结果该键不支持，reason 来自第二层 |
| 同上：两层都不支持 | 取第一层的原因 |
| facts：`host` 与 `none` 相交 | `none` |
| `capabilitiesV2FromLegacy`：三个现有运行时的旧布尔值 | 与快照一致 |
| 两端一致：kun 与 `src/shared` 的推导对同一夹具 | 输出深相等 |

验证：`cd kun && npx vitest run src/harness src/contracts`；根目录 `npx vitest run src/shared/harness-capabilities`。

---

## P0-03 HarnessDetector 与只读接口（M，K）

- 分支：`codex/ade-harness-detector`；提交：`feat(harness): detect installed harnesses and expose read-only routes`
- 依赖：P0-02

### 新增

| 文件 | 内容 |
| --- | --- |
| `kun/src/harness/harness-catalog.ts` | `HarnessCatalog`：`list()`、`get(id)`；合并内置定义与 config 里的自定义 ACP 定义（P0-06 之前只有内置） |
| `kun/src/harness/harness-detector.ts` | 01 §5 的 `HarnessDetector` |
| `kun/src/harness/harness-login-probes.ts` | 每个 harness 的登录探测函数表 |
| `kun/src/server/routes/harnesses.ts` | 处理函数：`listHarnesses`、`probeHarness`、`listHarnessModels` |
| `kun/src/server/routes/register-harness-routes.ts` | `router.add('GET', '/v1/harnesses', …)` 等；由 `register-core-routes.ts` 调用 |

### 实现步骤

1. `resolveCommand(def)`：顺序为设置覆盖路径 → 随包二进制 → PATH。PATH 查找复用 `owned-process.ts` 里已有的可执行文件解析（`resolveCommand`，非导出的话先导出一个只读的 `resolveExecutable(command, env)`，不改变原行为）。
2. `readVersion`：`spawnOwnedProcess(command, def.detect.versionArgs, { stdio: ['ignore', 'pipe', 'pipe'] })`，5 秒超时后 `stopOwnedProcess`；取 stdout 第一行，按 `versionPattern`（缺省 `/\d+\.\d+\.\d+/`）解析。
3. 登录探测：
   - `claude-code`：把 `src/main/claude-subscription-auth.ts` 里的本地凭据检测（只读 `~/.claude/.credentials.json` 是否存在且可解析，macOS 钥匙串只作提示）移到 `kun/src/harness/harness-login-probes.ts`，主进程改为调用 kun 接口或共享同一函数（放 `packages/` 不合适，就在两边各保留一份并用同一测试夹具）。
   - `cursor`：config 里对应 provider 是否有凭据绑定（`credentialSourceId`）。
   - `antigravity`：复用现有 Antigravity 启动器的检测。
   - `kun`：`not-required`。
4. 缓存 60 秒；`probe` 强制刷新；检测过程中同一 harness 的并发请求共享同一个 promise。
5. 路由：`GET /v1/harnesses` 返回 `{ harnesses: Array<{ definition, status, effectiveCapabilities }> }`，`status` 取缓存（没有缓存时返回 `installed: 'unknown'` 并在后台触发一次检测，不阻塞）。`GET /v1/harnesses/:id/models` P0 阶段只返回 `staticModels` 与 provider 配置的模型；`probe` 型在 P1-05 / P1-09 补。

### 测试

| 用例 | 输入 | 期望 |
| --- | --- | --- |
| 找不到命令 | PATH 为空 | `installed: 'no'` |
| 版本解析 | stdout `claude 2.3.4 (build x)` | `version: '2.3.4'` |
| 超时 | 注入永不退出的进程 | 5 秒后 `installed: 'unknown'`，进程被回收 |
| 缓存 | 60 秒内两次 `status()` | 只 spawn 一次 |
| 并发 | 同时三次 `status()` | 只 spawn 一次 |
| 路由 | `GET /v1/harnesses` 无缓存 | 立即返回 unknown，不阻塞 |

验证：`cd kun && npx vitest run src/harness src/server/routes/harnesses`。

---

## P0-04 线程/turn 字段、HarnessRouter、工具上下文（L，K）

- 分支：`codex/ade-harness-router`；提交：`feat(harness): route turns by harness with legacy provider inference`
- 依赖：P0-02
- 开关：`agents.kun.ade.harnessRouter`（字段在 P0-06 才进设置；本 PR 先读 config 里的 `ade.harnessRouter`，缺省 true）

### 改动清单

| 文件 | 改什么 |
| --- | --- |
| `kun/src/contracts/threads.ts` | `CreateThreadRequest`、`ThreadSchemaBase`（`providerId` 旁，约 382 行）、`ThreadSummary` 的 pick（约 465 行）加 `harnessId: HarnessIdSchema.optional()` |
| `kun/src/contracts/turns.ts` | `StartTurnRequest`、`TurnSchema` 加 `harnessId`、`credentialMode` |
| `kun/src/services/thread-service-metadata-operations.ts:183` | `createThreadRecord` 透传 `harnessId` |
| `kun/src/services/turn-service-admission-operations.ts:~244` | 准入时冻结：`turnHarnessId = resolveAdmissionHarness(...)`，写入 `createTurnRecord` |
| `kun/src/harness/resolve-turn-harness.ts`（新） | `resolveTurnHarness()`、`resolveAdmissionHarness()` |
| `kun/src/harness/harness-router.ts`（新） | `HarnessRouter`、`HarnessAdmissionError` |
| `kun/src/harness/build-harness-runtimes.ts`（新） | 两个组合点共用的工厂 |
| `kun/src/runtime/delegated-turn-runtime.ts` | 可选的 `handlesRoute?()`、`capabilitiesV2?()`；导出 `ResolvedHarnessRoute` |
| `kun/src/loop/agent-loop-options.ts` | 加 `harnessRouter?: HarnessRouter`（保留 `sdkRuntime`） |
| `kun/src/loop/agent-loop-turn-lifecycle.ts:125-139` | 分派点改用 `harnessRouter`（见下） |
| `kun/src/server/runtime-composition-agent.ts:250` | `buildMainDelegatedRuntime` 改为用 `buildHarnessRuntimes` + `HarnessRouter`；`ReplaceableDelegatedTurnRuntime` 的热替换改为替换 router |
| `kun/src/server/runtime-composition-registry.ts:73` | `createChildDelegatedRuntime` 同样改用工厂，返回子作用域 router |
| `kun/src/delegation/child-agent-executor.ts:128,265` | `createDelegatedRuntime` 的返回类型改为 `{ router: HarnessRouter }`，AgentLoop 注入 `harnessRouter` |
| `kun/src/ports/tool-host.ts` | `ToolHostContext` 加 `harnessId?`、`executionUnitKind?: 'worker'` |
| `kun/src/loop/tool-context-factory.ts`、`tool-discovery-context-factory.ts` | 从线程 / turn 填这两个字段（`harnessId` 取 turn 冻结值；`executionUnitKind` 取 `thread.executionUnit?.kind`，字段在 P1-10 才出现，本 PR 先读 `undefined`） |
| `kun/src/runtime/agent-sdk/agent-sdk-runtime-factory-context.ts:435`、Cursor 对应处 | 外部运行时构造工具上下文时填 `harnessId` |

### 实现步骤

1. **准入冻结**（与 provider 冻结同一处，保证热更新不会改变运行中的 turn）：

   ```ts
   // turn-service-admission-operations.ts，turnProviderId 计算之后
   const turnHarnessId = input.request.harnessId
     ?? thread.harnessId
     ?? legacyHarnessForProvider(turnProviderId, this['deps'].providerKinds())   // 'default' 映射到默认 provider 的 kind
   const turnCredentialMode = input.request.credentialMode
     ?? defaultCredentialMode(turnHarnessId, turnProviderId, this['deps'].providerKinds())
   ```

   `providerKinds()` 是新增的 TurnService 依赖：返回 `{ byId: Record<string, kind>, defaultKind: kind }`，由组合根从 `activeOptions.providers` 与 `defaultIsAgentSdk / defaultIsCursorSdk / defaultIsAntigravity` 生成。**注意 `'default'` 别名**：`turnProviderId` 可能是 `'default'`，推断时要用 `defaultKind`。
2. `resolveTurnHarness(thread, turn)` 在分派时只读 turn 上冻结的值；历史 turn（没有冻结值）才走 01 §6.1 的推断。
3. **分派点**：

   ```ts
   const owningThread = await this.opts.threadStore.get(threadId)
   const turnRecord = owningThread?.turns.find((t) => t.id === turnId)
   let delegatedSdkRuntime: DelegatedTurnRuntime | undefined
   let delegatedProviderId: string | undefined
   if (this.opts.harnessRouter?.enabled() && owningThread && turnRecord) {
     const resolved = this.opts.harnessRouter.resolve(owningThread, turnRecord)   // 同步；必须在任何 await 之前
     if (!resolved.ok) {
       const settlement = await settle({ status: 'failed', error: resolved.error.userMessage, code: resolved.error.code })
       return statusFromSettlement(settlement, 'failed')
     }
     delegatedSdkRuntime = resolved.runtime                // native-loop 时为 undefined
     delegatedProviderId = resolved.route.providerId
   } else if (this.opts.sdkRuntime) {
     /* 现有 provider 推断代码原样保留（开关关闭时的回退路径） */
   }
   ```

   `resolve()` 返回 `{ ok: true, runtime?, route } | { ok: false, error }`，不抛异常；`settle` 与 `statusFromSettlement` 是该函数里已有的局部工具。
4. **`HarnessRouter.resolve()`**：按 01 §6.2；对现有三个运行时，`handlesRoute` 未实现时回退 `handlesProvider(route.providerId)`，所以现有线程行为不变。
5. **`buildHarnessRuntimes(deps)`**：把现在 `buildMainDelegatedRuntime` 里构造 `sdkRuntimeDeps / antigravityRuntimeDeps / cursorRuntimeDeps` 的代码搬进来，返回 `Partial<Record<HarnessTransport, DelegatedTurnRuntime>>`；主运行时与子运行时各传自己的依赖。
6. **热替换**：`model.refreshModelConnectionDelegatedDeps` 现在替换 `ReplaceableDelegatedTurnRuntime` 的内部实现；改为 `harnessRouter.replaceRuntimes(buildHarnessRuntimes(...))`。已开始的 turn 持有自己解析出的 runtime 引用，不受影响（与现有不变量一致）。
7. **工具上下文**：两个 factory 里加 `harnessId: turn.harnessId ?? 'kun'`；外部运行时的上下文加 `harnessId: route.harnessId`。

### 测试

| 用例 | 输入 | 期望 |
| --- | --- | --- |
| 兼容：agent-sdk provider 的历史线程（无 harnessId） | 旧 thread + turn | 路由到 agent-sdk 运行时（与改动前相同） |
| 兼容：cursor / antigravity / http | 同上 | 分别到 cursor / antigravity / 原生 loop |
| `'default'` 别名 | turn.providerId = 'default'，默认 provider 是 agent-sdk | 冻结 `harnessId: 'claude-code'` |
| 显式 harness | turn.harnessId = 'kun'，provider 是 agent-sdk | 走原生 loop（显式优先） |
| 热更新 | turn 已准入后把 provider kind 改掉 | 该 turn 仍用冻结的 harness |
| 未知 harness | turn.harnessId = 'nope' | turn failed，code `harness_unknown`，无运行时被调用 |
| 运行时缺失 | harness transport 为 acp（P1 前未注册） | failed，`harness_unavailable` |
| 开关关闭 | `ade.harnessRouter = false` | 走旧分支，现有测试全部通过 |
| 子任务 | runChild 指定 providerId 为 agent-sdk | child 走子作用域 router 的 agent-sdk 运行时 |
| 工具上下文 | 原生 turn / SDK turn | `harnessId` 分别为 `kun` / `claude-code` |
| 回归 | `kun/src/loop`、`kun/src/runtime`、`kun/src/delegation` 现有测试 | 全绿 |

验证：`cd kun && npx vitest run src/harness src/loop src/runtime src/delegation src/services/turn-service`；`npm run build:kun`；`npm run typecheck`。

回滚：把开关改为 false 即回到旧分派；契约字段都是可选的，不需要迁移。

---

## P0-05 准入矩阵、能力事件、前端降级函数（M，K R S）

- 分支：`codex/ade-harness-admission`；提交：`feat(harness): enforce harness admission and publish capability statuses`
- 依赖：P0-04

### 改动

| 文件 | 改什么 |
| --- | --- |
| `kun/src/harness/usage-for-turn.ts`（新） | `usageForTurn()`、`isUnattendedTurn()`（02 §5.4，已按核对结果修正） |
| `kun/src/harness/harness-admission.ts`（新） | `ADMISSION_RULES`、`checkHarnessAdmission()`、`resolvePermissionMode()` |
| `kun/src/harness/harness-router.ts` | `resolve()` 在选出运行时后调用准入；失败返回 `{ ok: false, error: HarnessAdmissionError(code, missing, message) }` |
| `kun/src/contracts/events.ts:497-520` | `DelegatedRuntimeEvent.providerKind` 加 `'acp'`；加可选 `harnessId`、`capabilitiesV2`；新增 `harness_runtime` 事件（原生 loop 也发，只带 `harnessId: 'kun'` 与能力） |
| 三个现有运行时发 `delegated_runtime` 的位置 | 补 `harnessId` 与 `capabilitiesV2`（用 `capabilitiesV2FromLegacy`） |
| `src/renderer/src/agent/thread-runtime-types.ts:60-80` | `DelegatedRuntimeState` 加 `harnessId?`、`capabilitiesV2?` |
| `src/renderer/src/agent/kun-mapper-projection.ts:274` | `delegatedRuntimeFromCore` 接受 `'acp'`；解析 `capabilitiesV2`，缺失时本地推导；新增 `harnessRuntimeFromCore` |
| `src/renderer/src/agent/harness-capability-ui.ts`（新） | 02 §6.2 的降级函数：`canSteer(state)`、`disabledReason(state, key, t)` 等 |
| `src/renderer/src/store/chat-store-thread-queue-actions.ts:511-516` | 改为调用 `canSteer()`，行为不变 |
| `src/renderer/src/locales/{en,zh}/common.json` | `harness.capability.*`、`harness.admission.*` 文案 |

### 准入规则的实现细节

```ts
const ADMISSION_RULES: Record<HarnessUsage, {
  required: readonly HarnessCapabilityKey[]
  sandbox?: 'host' | 'isolated-or-native'
}> = {
  'one-to-one':     { required: ['abort'] },
  'manager-worker': { required: ['abort', 'structuredStreaming'], sandbox: 'isolated-or-native' },
  'graph-worker':   { required: ['abort', 'structuredStreaming', 'kunTools'], sandbox: 'isolated-or-native' },
  'graph-lead':     { required: ['kunTools', 'nativeToolInterception'] },
  'room-execution': { required: ['kunTools', 'externalApproval', 'nativeToolInterception'], sandbox: 'host' },
  'scheduled':      { required: ['abort'] },
  'im':             { required: ['abort'] },
  'plan-build':     { required: ['abort'], sandbox: 'isolated-or-native' },
  'design':         { required: ['kunTools'] }
}
```

- `workspace.isolated` 的来源：turn 所在线程绑定了任务工作区（P0-10 之后由 `thread.executionUnit?.taskWorkspaceId` 或一对一线程的 `taskWorkspaceId` 判断）；P0 阶段没有任务工作区时一律 `false`。
- **Rooms 等价性**：在合入前，用现有 Rooms 测试验证：对三个现有运行时，`room-execution` 的准入结果与它们现在各自判断的结果一致（Claude SDK 允许、Cursor 与 Antigravity 拒绝）。不一致就说明规则写错了，不能改测试迁就。
- 准入失败的错误码：`harness_not_ready`、`capability_missing`、`sandbox_insufficient`，用户文案走 i18n `harness.admission.<code>`，`missing` 列表渲染成能力名。

### 测试

| 用例 | 期望 |
| --- | --- |
| 准入表每一行：一个通过、一个拒绝 | 结果与 code 正确 |
| Rooms 等价 | 三个现有运行时的结果与现状一致 |
| 无人值守 + 请求完全访问 + 开关关闭 | 回落 `permissionModes[0]` |
| 无人值守 + 开关打开 | 保留完全访问 |
| 事件：SDK turn | 发出的 `delegated_runtime` 带 `harnessId: 'claude-code'` 与 v2 能力 |
| 前端：旧事件（没有 v2） | `delegatedRuntimeFromCore` 本地推导出 v2 |
| 前端：`canSteer` | 与改动前 `liveSteering === false` 的判断结果一致 |

验证：`cd kun && npx vitest run src/harness src/rooms`；`npx vitest run src/renderer/src/agent src/renderer/src/store/chat-store-thread-queue`；`npm run typecheck`。

---

## P0-06 设置桥：`agents.kun.harnesses`、`agents.kun.ade`（M，S M K）

- 分支：`codex/ade-settings-bridge`；提交：`feat(settings): add harness and ade settings with runtime config sync`
- 依赖：P0-02

### 四层同步

| 层 | 文件 | 改什么 |
| --- | --- | --- |
| 类型 | `src/shared/app-settings-types-kun-runtime.ts:351` 附近 | `KunRuntimeSettingsV1` 加 `harnesses: KunHarnessSettingsV1`、`ade: KunAdeSettingsV1`（定义见 01 §7.1、13 §3.1） |
| 默认值与规范化 | `src/shared/app-settings-kun-defaults.ts`、`app-settings-kun.ts` | `defaultKunHarnessSettings()`、`defaultKunAdeSettings()`；规范化：未知键丢弃、数值夹紧（`softWorkers` 1–16、`hardWorkers` ≥ soft 且 ≤ 32、`idleMinutes` 1–1440）、`custom[].id` 与内置冲突时丢弃 |
| IPC | `src/main/ipc/app-ipc-schemas/settings-model.ts:328` | `kunRuntimePatchSchema`（strict）加 `harnesses`、`ade` 两个可选对象（各自 strict） |
| config 生成 | `src/main/runtime/kun-runtime-model-config.ts` | `harnessesConfigForRuntime(settings)`、`adeConfigForRuntime(settings)`：纯函数，数组按 id 排序，对象键按固定顺序输出 |
| kun 配置 | `kun/src/config/kun-config-application.ts:370` | `KunConfigSchema` 加 `harnesses: HarnessesConfigSchema.optional()`、`ade: AdeConfigSchema.optional()`（都 strict） |
| sanitize | `src/main/runtime/kun-runtime-config-service.ts:472` | `sanitizeKunConfigSections` 登记两段 |
| kun 读取 | `kun/src/server/runtime-composition-config.ts`（或 `activeOptions` 解析处） | 把两段放进 `activeOptions`，支持热更新 |

`AdeConfigSchema` 里只放 kun 运行时需要的字段：`enabled`、`harnessRouter`、`deterministicHandoff`、`managerModel`、`managerMayApprove`、`allowUnattendedFullAccess`、`limits`、`budget`、`hibernation`、`stall`、`approvedWorktreeConfigs`（P0-11 填）。通知设置只在 GUI 侧，不进 config。

### 测试

| 用例 | 期望 |
| --- | --- |
| 同一份设置生成两次 config | `harnesses` 与 `ade` 段逐字节相同（防重启死循环） |
| 带全部新字段的 patch | 通过 strict 校验，字段不丢 |
| 带未知子键的 patch | 被拒绝（strict） |
| 旧设置文件（没有两段） | 规范化后得到默认值，保存后文件只多出这两段 |
| kun 读取 config | `activeOptions.ade.harnessRouter` 等值正确；缺省段落时使用默认值 |
| sanitize | 手工写坏的 `ade` 段被丢弃，运行时正常启动 |

验证：`npx vitest run src/shared/app-settings src/main/runtime/kun-runtime-model-config src/main/ipc`；`cd kun && npx vitest run src/config`；`npm run typecheck`。
