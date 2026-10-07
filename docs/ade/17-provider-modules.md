# 17 Provider 模块：按引擎收口 Agent 接入

- 日期：2026-10-08
- 基线：`develop@8e699533d`
- 状态：方案，未实施；待用户决定实施范围（见 §7）
- 设计输入：多 agent 控制台（`/Users/zxy/codeproject/ds_project/paseo@4417d7c`，下称"参考项目"）。
  按 [README](./README.md) 的约束，参考项目只作设计输入；源码、文件名、类名、注释、i18n 键里不得出现它的名字。

## 1. 为什么要改

2026-10-08 一天内修了六组"Agent 接不上"的故障，每一组都落在一个按 harness id 分支的不同文件里：

| 故障 | 根因所在 | 改动位置 |
| --- | --- | --- |
| Antigravity 每轮挂到超时 | 启动 `agy` 时用了 shell 工具的环境白名单，代理变量被剥掉 | `runtime/antigravity/antigravity-process.ts` |
| Antigravity 部分模型报错 | 1.3.1 按模型校验 `--effort`，Kun 固定传 medium | 同上 + 新建 `antigravity-model-selection.ts` |
| OpenCode 1.18 "需要检查就绪状态" | 模式改为 `configOptions[mode]` 上报，插件替换了 build/plan | `runtime/acp/acp-session-*.ts`、`harness/acp-handshake-probe.ts` |
| OpenCode / OpenCode2 无登录不能启用 | 就绪硬性要求本地凭据证据 | `harness/harness-readiness.ts`、`harness-login-probes.ts` |
| Cursor "Agent 默认模型"失败 | `default` 被当真实模型名查 provider 模型池 | `harness/harness-readiness.ts`、`runtime/cursor/...` |
| Codex 原生登录失败 | 残留 `defaults.codex.providerId`，界面无处清除 | `src/shared/harness-enablement.ts` |

另外，加一个和 OpenCode 几乎相同的 CodeMaker 改了 12 个文件（契约、目录、凭据路径、登录探测、密钥白名单、网关配置、检测指纹、会话准入、图标、类型联合、文档）。

当前 `kun/src/harness/` 有 68 个源文件、约 1.37 万行。按 harness id 字面量分支的热点：

| 文件 | id 字面量分支数 |
| --- | --- |
| `harness-readiness-profile.ts` | 23 |
| `harness-login-probes.ts` | 7 |
| `harness-readiness.ts` | 6 |
| `src/renderer/src/components/agent-icon.tsx` | 5 |
| `harness-secret-env.ts` / `harness-installation.ts` / `harness-detector.ts` | 各 3 |

根因有三条：

1. **引擎知识横向散落在"阶段"文件里**（检测、登录、凭据、网关、握手、图标、会话准入），而不是纵向聚在引擎模块里。每个引擎的差异要在七八个 `switch (definition.id)` 里各补一刀，漏一处就是一个故障。
2. **就绪把"本地必须找到凭据"当硬门槛**。真实情况是：OpenCode 自带免费模型；Codex 的 ChatGPT 账号在 app-server 内部，本地只有 `tokens` 不是 API key；CodeMaker 有自己的 token 记录格式。今天修 OpenCode/Codex 时验证过的正确边界是：**协议握手返回 `authRequired` 才是硬门槛，凭据是诊断信息**。参考项目正是这样做的（§2.3）。
3. **三套互相重叠的发现系统**：`HarnessDetector`（安装/版本/登录/ready）、`HarnessReadinessService`（proof、warm、identity）、四个模型探测（acp/codex/agent-sdk/pi）各自 spawn 一次进程。参考项目一次刷新 = 可启动性 + 目录（模型+模式+思考档位）一个进程。

## 2. 参考项目的 provider 模型

只摘与 Kun 相关的要点，带文件位置便于对照。

### 2.1 一个 provider 一份契约

`packages/server/src/server/agent/agent-sdk-types.ts:729` 的 `AgentClient`：

- `isAvailable()` / `getDiagnostic()`：可启动性 + 多行诊断文本；
- `fetchCatalog()`：模型、模式、思考档位和默认值，**一次调用**，注释明确"调用方拿不到单独的模型/模式探测"；
- `createSession()` / `resumeSession()`：会话由 provider 持有，持久化句柄对核心不透明；
- `listCommands()` / `listFeatures()` / `listImportableSessions()` / `importSession()`：可选能力；
- `capabilities: AgentCapabilityFlags`：布尔能力位。

插件侧是更小的事件契约（`plugins/antigravity-provider/server/provider.ts`，171 行实现了完整 provider）：`ProviderRegistration { id, label, icon, command, status(launch), getCatalogCacheKey, connect(request) }` → `ProviderConnection { send(input), onEvent, close }`。输入只有 `catalog` / `session.open` / `session.prompt` / `session.configure` / `session.interrupt` / `session.close`；事件有 `session.opened` / `session.config` / `session.ready` / `session.turn` / `session.prompt_result` / `timeline.item` / `request.completed` / `request.failed`。能力按字符串协商（`prompt.message`、`prompt.image`、`session.configure`、`session.persistence`、`prompt.steer`）。

### 2.2 注册、覆盖、派生

`provider-registry.ts`：`RegisteredProviderDefinition`（manifest + `optionsSchema` + `createClient`）叠加用户覆盖得到 `ProviderDefinition`。覆盖 schema 在 `packages/protocol/src/provider-config.ts`：

```ts
ProviderOverride = {
  extends?: builtinId | 'acp'      // 派生：Z.AI 继承 claude；自定义 ACP 继承 acp + command
  label?, description?, command?: string[], env?: Record<string,string>,
  models?, additionalModels?,      // 目录覆盖或追加
  disallowedTools?, enabled?, order?
}
ProviderRuntimeSettings = { command?: {mode:'default'|'append'|'replace', ...}, env?, disallowedTools? }
```

启动解析在 `provider-launch-config.ts`：`resolveProviderLaunch`（默认/追加/替换命令）、`checkProviderLaunchAvailable`、`resolveShellEnv`（继承用户 shell 环境，代理不会丢）。

### 2.3 发现与诊断

`provider-snapshot-manager.ts:1004-1064` 的 `refreshProvider`：`availability` 活动 → `fetchCatalog` → 快照 `{ status: ready | loading | error | unavailable, enabled, models, modes, diagnostic }`，按 cwd 缓存，变更广播。失败时 `getDiagnostic()` 返回多行文本（`diagnostic-utils.ts`）：

```
OpenCode
  Command: opencode acp            (命令解析行)
  Binary: /opt/homebrew/bin/opencode  version 1.18.35
  Auth: <opencode auth list 输出>   (仅诊断，不门控)
```

认证不门控：provider 处理自己的认证（`AGENTS.md`："agent providers handle their own auth"），未登录在 prompt 时以 `authRequired` 错误浮现。

### 2.4 模式、权限、会话内控件

- 模式是 manifest 里的静态表（`provider-manifest.ts`），带 `icon` / `colorTier` / `isUnattended`；文件自带 TODO：应改为运行时由 `session/new` 上报再叠 UI 元数据。Kun 今天已经是运行时上报（ACP `modes` / `configOptions`）。
- 权限请求统一为 `AgentPermissionRequest { kind: tool | plan | question | mode | other, actions: [{ behavior: allow | deny, variant, intent }] }`（`protocol/agent-types.ts:445-480`）。
- 会话内设置 `AgentFeature = toggle | select` 由 provider 在 `session.config` 里发布，composer 通用渲染；provider 可在模型变化后改变可用控件。
- timeline 以**完整快照项**发布（同 id 重发即更新），核心算 delta。

### 2.5 ACP 与插件

`runAcpProvider({ command, transformers })`：shim 拥有进程、能力映射、会话、权限、timeline 转换；`transformers` 只做厂商差异（Zod 校验，不认识的原样放过）。通用 ACP agent 244 行。provider 插件可从 npm/Git/目录安装。

### 2.6 不适合照搬的部分

参考项目没有 rooms/总管、Kun 网关、原生网络策略、能力 v2 交集、owned-process 启动器，也没有显式启用的同意模型；它的认证完全不门控。这些是 Kun 的差异化（README §2），保留。

## 3. 对照

| 关注点 | Kun 现在 | 参考项目 | 本方案 |
| --- | --- | --- | --- |
| 引擎定义 | `builtin-harnesses.ts` 数组 + `expanded-cli-harnesses.ts` 规格 + `application-harnesses.ts` + custom/terminal 配置 | 每 provider 一个注册对象 + 覆盖 | 每引擎一个模块目录，目录由注册表组装 |
| 引擎差异 | 7 个阶段文件里的 id 分支 | 全在 provider 实现内 | 模块 hook，阶段文件只分派 |
| 发现 | Detector + Readiness + 4 个模型探测，多次 spawn | 一次 refresh：可用性 + 目录 | `ProviderSnapshotService`，一次 spawn |
| 就绪门槛 | 安装 ∧ 配置 ∧ 凭据证据 ∧ 协议 | 可启动即 ready，认证在 prompt 时报错 | 安装 ∧ 配置 ∧ 协议；凭据变诊断；握手 `authRequired` 是唯一认证门槛 |
| 诊断 | `detail` 单句，各处拼接 | 多行诊断表（命令/二进制/版本/认证） | 诊断行数组，Agent 中心表格化展示 |
| 启动配置 | `binaryPaths` 替换路径；`custom[]`；`terminalAgents[]`；`transportOverrides` | `command {default|append|replace}` + env + `extends` | 统一 `harnesses.providers[<id>]` 覆盖，旧字段一次性迁移 |
| 派生引擎 | 手写（CodeMaker 复制 OpenCode 定义） | `extends` | `module.derive(overrides)`，配置层也可派生 |
| 会话内控件 | 逐引擎特例（OpenCode 原生 Agent、Devin fusion、Codex effort） | `session.config.settings[toggle|select]` | 统一进 `harness_session_state`，composer 通用渲染 |
| 权限请求 | ACP / Codex / Claude 三条映射 | 一个 `AgentPermissionRequest` | 同一结构进现有审批管线 |
| 插件 provider | 无 | npm/Git 安装 | `packages/extension-api` server 侧注册 + ACP shim |
| 渲染层映射 | 图标、会话准入 id 列表、历史源、类型联合都写死 id | 由 provider 元数据驱动 | 全部来自定义字段 |

## 4. 目标设计

所有改动仍在 `kun serve` 的 HTTP/SSE 边界内，`DelegatedTurnRuntime` 与 `HarnessRoute` 不变，符合 [AGENTS.md](../AGENTS.md) 的扩展路径与 [13 治理](./13-governance-rollout.md) 的准入要求。

### 4.1 `AgentProviderModule`

每个引擎一个目录 `kun/src/harness/providers/<id>/`，导出一个模块对象。今天散落在阶段文件里的 id 分支，变成模块上的可选 hook；阶段文件只对 hook 分派，缺省实现就是今天的通用行为：

```ts
// kun/src/harness/providers/provider-module.ts
export interface AgentProviderModule {
  /** 现有 HarnessDefinition 契约不变，继续作为对外 manifest。 */
  definition: HarnessDefinition
  launch?: {
    /** 默认 argv；用户覆盖按 default/append/replace 合并。 */
    defaults: { command: string; args: string[]; env?: Record<string, string> }
    /** 'inherit-proxy'：继承代理变量（CLI 自己联网）；'minimal'：shell 工具白名单。 */
    shellEnv?: 'inherit-proxy' | 'minimal'
  }
  credentials?: {
    files?(env: Env, home: string): string[]
    envKeys?: readonly string[]
    /** 只返回"是否配置 + 指纹"，值绝不出模块。 */
    evidence?(env: Env): Promise<{ configured: boolean; fingerprint: string }>
    loginOptional?: boolean
  }
  /** Agent 中心诊断行：命令解析、二进制、版本、认证、网络。 */
  diagnostics?(launch: ResolvedLaunch, env: Env, signal: AbortSignal): Promise<DiagnosticRow[]>
  /** 模型 + 模式 + 思考档位 + 默认值，一次 spawn。 */
  catalog(launch: ResolvedLaunch, env: Env, ctx: RefreshContext): Promise<ProviderCatalog>
  /** kun-gateway 模式下生成引擎配置文件并返回要注入的环境。 */
  gateway?: { env(input: GatewayEnvInput): Record<string, string> }
  /** 握手/启动错误到用户可读说明（如 OpenCode 共享库冲突、Gemini 客户端退役）。 */
  explainFailure?(error: string): string | undefined
  /** 运行时工厂；ACP 引擎只需声明 'acp' 并可附 transformers。 */
  runtime: ProviderRuntimeFactory | { kind: 'acp'; transformers?: AcpTransformer[] }
  /** 派生：同一引擎的改名/魔改版本只覆盖差异。 */
  derive?(overrides: ProviderModuleOverrides): AgentProviderModule
}
```

注册表 `buildProviderRegistry(modules, overrides)` 输出今天 `HarnessCatalog` 需要的定义列表；`builtin-harnesses.ts` 退化为模块索引。CodeMaker 变成 `opencode.derive({ id: 'codemaker', launch: {...}, credentials: {...}, acpClientWrites: false })`。

### 4.2 `ProviderSnapshotService`

替换 `HarnessDetector.status()` 的发现部分和四个模型探测。一次刷新：

1. `resolveLaunch`（默认 + 覆盖 + `binaryPaths` 迁移值）；
2. 可用性：命令可解析、不是应用启动器、身份匹配（保留今天的别名回退，见 Cursor CLI 修复）；
3. `module.catalog()`：一个进程拿回版本、模型、模式、思考档位、默认值；
4. 快照 `{ status: ready | unavailable | error | loading, version, catalog, diagnostics: DiagnosticRow[], fingerprint }`，按引擎（必要时按 cwd）缓存并广播。

`HarnessReadinessService` 保留"显式启用 + proof + identity 指纹 + warm 刷新"的准入语义（这是 Kun 的同意模型，不放弃），但四项检查改为：

| 检查 | 现在 | 之后 |
| --- | --- | --- |
| installation | 安装 ∧ 版本受支持 | 快照 `status !== 'unavailable'` |
| configuration | provider/模型池/网关别名 | 不变；`default` 模型对 provider 模式表示"交给引擎"（已修） |
| credentials | 本地凭据证据硬门槛 | **诊断行**；只有握手 `authRequired` 才判 `missing` |
| protocol | 握手 | 握手 + 目录（来自快照，不再单独 spawn） |

今天的 `loginOptional` 过渡字段在此阶段退役：所有引擎都走"握手不报 authRequired 即可启用"。CodeMaker 这类 `authenticate` 为空实现的引擎，由其模块把"未登录"做成诊断行并在握手阶段按 `authRequired` 分类（今天已验证可行）。

### 4.3 启动与覆盖配置

新的设置节（`src/shared/app-settings-kun-harness.ts` + `kun/src/config/kun-config-harnesses.ts`）：

```ts
harnesses.providers?: Record<string, {
  extends?: string            // 内置 id 或 'acp' / 'terminal'
  label?: string
  command?: { mode: 'default' } | { mode: 'append'; args: string[] } | { mode: 'replace'; argv: string[] }
  env?: Record<string, string>
  secretEnv?: { name: string; secretRef: string }[]
  models?: string[]; additionalModels?: string[]
  enabled?: boolean; order?: number
  acpClientWrites?: boolean
}>
```

一次性迁移：`binaryPaths[id]` → `command: { mode: 'replace', argv: [path] }`；`custom[]` → `extends: 'acp'`；`terminalAgents[]` → `extends: 'terminal'`；`transportOverrides` 保留。Agent 中心的"指定命令路径"、"添加 Agent"、派生引擎三个入口复用一个表单。

### 4.4 会话契约收口

在现有 `DelegatedTurnRuntime` 之上统一三件事，不新增运行时边界：

- **会话配置事件**：`harness_session_state` 扩展为 `{ model, mode, thinking, models, modes, thinkingOptions, settings: (toggle | select)[] }`，由各运行时在会话建立和配置变更后发布；composer 通用渲染 `settings`，替代 OpenCode 原生 Agent 选择器、Devin fusion、Codex effort 的特例代码。用户改动走一个 `session.configure` 请求。
- **权限请求**：ACP `request_permission`、Codex 审批、Claude `canUseTool` 映射到同一 `{ kind, title, detail, actions }`，再进现有审批管线（策略 → 审阅者 → 用户门）。
- **timeline**：运行时发布完整快照项，核心以现有 `liveDeltaSeqFloor` 机制去重；流式 delta 仍由核心计算。

### 4.5 插件 provider

`packages/extension-api` 已有客户端 `registerProvider`（模型供应商）；新增 server 侧 `registerAgentProvider(module)`，模块形状同 §4.1；ACP 引擎只需 `acpProvider({ id, label, icon, command, transformers })`。provider 插件意味着启动进程权限，沿用 extension 的信任模型并在 manifest 里声明。

### 4.6 渲染层去硬编码

- 图标：`definition.icon`（SVG 资源名或 monogram），`agent-icon.tsx` 不再按 id 分支；
- 会话准入：`CONVERSATION_HARNESS_IDS` → `definition.conversation?: { gate: 'mode' | 'sandbox' }`，`isConversationalRoomEngine` 读字段；
- 历史源：`historySource` → `module.history`；
- `coding-agent-client.ts` 等类型联合改为 `string`，由运行时校验。

## 5. 分阶段计划

每阶段可独立合入 `develop`，全程保持现有测试通过，不改 HTTP 接口形状（P3 只扩展事件字段）。

### P0 模块化（无行为变化）

- 新建 `kun/src/harness/providers/{provider-module.ts, registry.ts, <id>/index.ts}`，首批：claude-code、codex、opencode（含 codemaker 派生）、opencode2、antigravity、cursor、devin、pi、deepseek-harness、gemini-cli；expanded CLI 规格批量转换。
- 把 `harness-readiness-profile.ts`、`harness-login-probes.ts`、`harness-secret-env.ts`、`acp-credential-env.ts`、`harness-detector.ts`（identity 路径）、`acp-handshake-probe.ts`（`knownStartupFailure`）、`harness-installation.ts` 里的 id 分支搬进模块 hook。
- 验收：现有 kun/renderer 测试全绿；上述阶段文件中 harness id 字面量为 0（加一个 lint 测试守住）；`npm run check:file-lines`。

### P1 快照与诊断

- `ProviderSnapshotService` + `DiagnosticRow` 契约 + `/v1/harnesses/:id/snapshot` 路由（替代 detect/models 两次往返）；
- 就绪四项按 §4.2 调整，`loginOptional` 退役；
- Agent 中心显示诊断表（命令解析 / 二进制 / 版本 / 认证 / 网络 / 协议）；
- 验收：今天六组故障的回归用例；真机 audit 脚本（`createHarnessComposition` + 逐引擎 `readiness.test`）对本机已安装引擎全部 usable 或给出可操作诊断；Electron smoke `--coding-agent-only`。

### P2 配置覆盖与派生

- `harnesses.providers` schema、迁移、设置 UI 合并三个入口；
- 验收：旧设置文件迁移后行为不变（快照测试）；派生 ACP 引擎从 UI 可添加并启用。

### P3 会话契约

- `harness_session_state` 扩展、composer 通用 settings、权限请求统一；
- 逐引擎删除特例 UI；
- 验收：OpenCode 原生 Agent、Devin fusion、Codex effort 三个场景的 smoke 走通用控件。

### P4 插件 provider

- extension-api server 侧注册、ACP shim、信任声明；
- 验收：一个目录安装的示例 provider 完成握手、目录、真实一轮。

### 风险

- 每个文件 700 行门槛：模块目录天然拆分，注册表与快照服务按操作拆文件；
- 三道隐藏门（admission usage、loop 的 room tool policy、主进程 IPC 白名单）只在 smoke 暴露，每阶段必跑；
- 凭据门槛放宽后，未登录的引擎会在首轮失败而不是启用时失败——用诊断行和握手 `authRequired` 兜住，并在 Agent 中心把"未登录"标成警告而非错误。

## 6. 不采纳

- 不做无门控认证：保留显式启用、proof 与 identity 指纹；只把"凭据证据"降为诊断。
- 不引入第二条运行时边界或新的进程启动器：仍用 owned-process 与 `kun serve`。
- 不把静态 modes 的 `icon` / `colorTier` 搬进 manifest：Kun 的 `kunPermissionMode` 梯度已更严格，模式元数据按运行时上报叠加。
- 不复制 timeline 渲染插件体系：Kun 已有 extension 渲染通道。

## 7. 待决策

1. 实施范围：建议先做 P0 + P1（纯收口 + 诊断，直接消灭今天这类故障的复发面），P2 起视反馈推进。
2. 凭据门槛：建议所有引擎统一改为诊断，握手 `authRequired` 作为唯一认证硬门槛。
3. 插件 provider 的信任声明粒度（整体信任 vs 按能力）。
