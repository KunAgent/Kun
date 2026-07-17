# Experts / Collaboration / MoA / Automation / Design 迁移功能测试报告

- 测试日期：2026-07-16
- 测试环境：Windows 11，Electron 43.1.0，Node.js 24.15.0
- 被测分支：`my`（相对 `origin/my` ahead 16，工作区含未提交迁移代码）
- 设计基线：`docs/superpowers/specs/2026-07-15-experts-moa-automation-migration-design.md`
- 测试方式：隔离 Electron profile + Chrome DevTools Protocol 黑盒操作 + preload IPC + Kun HTTP + 定向源码定位 + Vitest
- 结论：**不通过，不具备发布或合并条件**

## 1. 结论摘要

应用可以构建并启动，但本次迁移尚未形成任何可供用户使用的完整链路。

| 验收能力 | 结果 | 核心证据 |
|---|---:|---|
| Electron 启动 | 通过 | 主窗口正常打开，`/health` 返回 200 |
| 专家广场与专家选择 | 失败 | UI 无入口；IPC 拒绝；HTTP 404 |
| 自定义专家 CRUD | 失败 | 服务有方法，但没有对应路由和 GUI |
| 专家人格注入 | 失败 | loop hook 没有收到 `expertId`，hook 修改也未被模型请求消费 |
| 专家团协作 | 失败 | Collaboration contracts/services/routes/UI 全部缺失 |
| MoA 预设选择 | 失败 | 模型菜单只有 DeepSeek；无 MoA 设置或 thread 字段 |
| MoA 推理 | 失败 | 注册顺序错误，provider 数为 0；手动注册又发生重复 provider 冲突 |
| Automation 任务 | 失败 | 正确注册路由后，任务仍抛出 runtime proxy placeholder 错误 |
| Automation 调度 | 失败 | 只有 schema，没有新 automation scheduler；当前 Scheduled tasks 是既有 GUI schedule |
| Design 资源库 | 失败 | 三个设计资源目录均不存在，接口只能返回空数组 |

发现问题共 16 项：P0 7 项、P1 8 项、P2 1 项。迁移功能健康度评估为 **18/100**，主要得分仅来自可编译、可启动和部分领域单元测试。

## 2. 测试证据

### 2.1 桌面应用截图

1. 首屏没有专家、专家团、MoA 或迁移 Automation 入口：
   [initial-workbench.png](../../../.gstack/qa-reports/screenshots/initial-workbench.png)
2. New Agent 只创建普通 Kun thread，没有专家选择：
   [new-agent.png](../../../.gstack/qa-reports/screenshots/new-agent.png)
3. 模型菜单只有 DeepSeek，没有 MoA preset：
   [model-selector.png](../../../.gstack/qa-reports/screenshots/model-selector.png)
4. Settings 没有 Experts、MoA、Automation 扩展配置：
   [settings.png](../../../.gstack/qa-reports/screenshots/settings.png)
5. Scheduled tasks 是既有 schedule 页面，未接入 `kun/src/automation`：
   [scheduled-tasks.png](../../../.gstack/qa-reports/screenshots/scheduled-tasks.png)

### 2.2 黑盒接口结果

Electron 启动后的真实调用结果：

| 调用 | 结果 |
|---|---|
| `window.kunGui.runtimeRequest('/health', 'GET')` | 200 |
| `window.kunGui.runtimeRequest('/v1/experts', 'GET')` | IPC 校验拒绝：`runtime request path is not allowed` |
| `/v1/collaboration/plans` | IPC 拒绝；直接 HTTP 404 |
| `/v1/automation/tasks` | IPC 拒绝；直接 HTTP 404 |
| `/v1/design/libraries` | IPC 拒绝；直接 HTTP 404 |
| `/v1/design/skills` | IPC 拒绝；直接 HTTP 404 |
| `/v1/moa/presets` | IPC 拒绝；直接 HTTP 404 |

GUI 生成的 `kun-data/config.json` 中没有 `extensions` 字段。

使用 QA harness 手工注入扩展配置并调用正确 seam 后：

| 检查 | 结果 |
|---|---|
| `parseServeOptions()` 解析后扩展 ID | `[]`，配置被丢弃 |
| 实际 `buildRouter()` 路由 | 所有迁移端点 404 |
| 手工注册正确 seam 后 `GET /v1/experts` | `expertService.listExperts is not a function` |
| 无 token 请求 `GET /v1/automation/tasks` | 200，路由未鉴权 |
| 无 token 请求 `GET /v1/design/libraries` | 200，路由未鉴权 |
| `POST /v1/automation/tasks` | `Kun runtime proxy not yet implemented` |
| MoA 初始化后的 provider 数 | 0 |
| 手工注册 MoA provider | `model provider already registered: moa` |
| 专家扫描结果 | 233 个专家 + 38 个专家团，33 个插件校验失败 |

### 2.3 构建与测试结果

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `npm run typecheck` | 通过 |
| `npm test -- src/seam src/experts src/moa src/design`（`kun/`） | 10 文件、57 用例通过 |
| `npm test -- src/automation`（`kun/`） | 失败：没有测试文件 |
| `npx vitest run`（根目录） | 3833 通过、2 跳过、1 失败；失败为 Windows symlink 权限，与本迁移无关 |
| `npm run test` | 在 `create-kun-extension` 前置测试提前失败，未进入主应用测试 |

没有执行真实付费模型请求。原因不是缺少测试意愿，而是 MoA 在进入模型请求前已经被 UI、配置、路由、hook 和 client 注册多层阻断；同时本次测试没有获得使用真实付费 API 的授权。

## 3. 问题与修复方案

### ISSUE-001 [P0] GUI Extension Seam 仍是 Stage 0 空实现

**现象**

- Renderer、Main、Shared 三侧 enabled feature 数组均为空。
- `renderExtensionPanels()`、`extensionRoutes()`、`registerExtensionIpc()`、`mergeExtensionSettings()` 均为 no-op。
- `App.tsx:27` 计算了 `extRoutes`，但从未使用。
- 用户看不到专家广场、专家团、MoA、Automation 或迁移后的 Design Library。

**定位**

- `src/renderer/src/seam/index.ts:4`
- `src/renderer/src/seam/features/index.ts:2`
- `src/main/seam/index.ts:4`
- `src/main/seam/features/index.ts:2`
- `src/shared/seam/index.ts:4`
- `src/shared/seam/features/index.ts:2`
- `src/renderer/src/App.tsx:27`

**修复方案**

1. 为 Experts、Collaboration、MoA、Automation、Design 分别实现 renderer/main/shared feature 模块并加入各自 enabled registry。
2. 不要只在 `App.tsx` 旁挂孤立 panel。把扩展 route/panel 接入现有 Workbench route、Sidebar、Settings 和模型选择数据流。
3. 增加 Electron E2E，断言每个入口可见且能完成一次核心操作。

### ISSUE-002 [P0] `extensions` 配置在 GUI 和 CLI 链路中丢失

**现象**

- Electron settings 没有扩展配置 bag。
- GUI 生成的 Kun `config.json` 没有 `extensions`。
- `KunServeConfigSchema` 接受 `serve.extensions`，`ServeOptionsSchema` 也有字段，但 `parseServeOptions()` 构建 merged options 时遗漏该字段。
- QA 配置文件合法，解析后 `extensionsPresentAfterParse=false`。

**定位**

- `kun/src/config/kun-config.ts:343`
- `kun/src/cli/cli-options.ts:77`
- `kun/src/cli/serve.ts:170`
- `src/shared/seam/index.ts:4`
- `src/main/kun-process.ts`

**修复方案**

1. 统一配置契约。按设计文档使用顶层 `config.extensions`，或明确改为 `config.serve.extensions`，不能两种语义并存。
2. 在 `KunConfigSchema`、`parseServeOptions()`、`KunServeRuntimeOptions`、main 生成 config、settings normalize/save 全链路透传同一个 bag。
3. 增加 round-trip 测试：AppSettings -> generated `config.json` -> `parseServeOptions()` -> `createKunServeRuntime()`，逐项断言 5 个 feature config 完整保留。

### ISSUE-003 [P0] `buildRouter()` 导入了错误的 seam

**现象**

- `kun/src/server/routes/index.ts` 从 `../seam/index.js` 导入，实际命中 `kun/src/server/seam/index.ts`。
- 该文件仍是带 TODO 的占位实现，不注册任何路由。
- 真正实现位于 `kun/src/seam/index.ts`，因此所有迁移 HTTP 端点为 404。

**定位**

- `kun/src/server/routes/index.ts:68`
- `kun/src/server/seam/index.ts:17`
- `kun/src/seam/index.ts:19`

**修复方案**

1. 将 import 修正为 `../../seam/index.js`。
2. 删除或重命名 `kun/src/server/seam/` 占位目录，避免再次被错误解析。
3. 新增真实 `buildRouter(runtime)` 集成测试，不能再用只有 `add()` 的 fake router 判断“可调用”。

### ISSUE-004 [P0] Expert 与 MoA loop hook 实际不生效

**现象**

- `beforeLoop` 在读取 thread 之前触发，只传 `{ threadId, turnId }`。
- Expert hook 读取 `ctx.expertId`，MoA hook 读取 `ctx.moaPresetId`，两者永远拿不到值。
- hook 修改的 `ctx.systemPrompt/providerId/model` 没有被保存，也没有传给 `ModelStepService`。
- 即使路由和 UI 修好，专家人格和 MoA 路由仍不会影响模型请求。

**定位**

- `kun/src/loop/agent-loop.ts:664`
- `kun/src/loop/agent-loop.ts:666`
- `kun/src/experts/loop/expert-context-hook.ts`
- `kun/src/moa/routing/moa-routing.ts:23`

**修复方案**

1. 在读取 thread/turn 后构造单个可变上下文，包含 `expertId`、`expertTeamId`、`moaPresetId`、当前 model/provider/system prompt。
2. hook 执行后显式应用返回值到本轮 `ModelRequest`，不要依赖修改一个随后被丢弃的临时对象。
3. 更稳妥的方案是新增 `beforeModelRequest` hook，输入和输出均为受 schema 约束的 request override。
4. 加入端到端 model-client fake：断言专家 prompt 和 MoA provider/model 真正到达 `ModelClient.stream()`。

### ISSUE-005 [P0] MoA client 注册和路由架构不可工作

**现象**

- `registerExtensionModelClients(modelClient)` 在 extension services 初始化前调用，因此 `moaConfigAdapter` 为空，provider 数为 0。
- 手工在初始化后注册时，两个启用 preset 都注册为 `providerId='moa'`，第二个立即报重复 provider。
- `MultiProviderModelClient` 只按 providerId 路由，无法在同一 `moa` provider 下按 model 选择多个 preset。
- runtime config apply 的 `replace()` 还会覆盖额外注册的 seam provider。

**定位**

- `kun/src/server/runtime-factory.ts:367`
- `kun/src/server/runtime-factory.ts:1107`
- `kun/src/seam/features/moa.feature.ts:47`
- `kun/src/seam/features/moa.feature.ts:59`
- `kun/src/adapters/model/multi-provider-model-client.ts:29`

**修复方案**

1. 注册动作必须发生在 MoA config 初始化之后。
2. 只注册一个 `MoaDispatchModelClient` 到 provider `moa`，由它根据 `request.model` 查 preset；不要每个 preset 注册同一个 provider。
3. 将 seam provider 纳入 `replace()` 的稳定 provider 源，配置热更新后重新构建且不丢失。
4. 测试至少覆盖 2 个启用 preset、配置热更新和并发请求。

### ISSUE-006 [P0] Automation 任务执行器是未完成 placeholder

**现象**

- `kunRuntimeRequest` 无条件抛 `Kun runtime proxy not yet implemented`。
- 手工注册路由并提交有效 digital employee 任务后，任务立即失败。
- 这意味着 Automation 即使补齐 UI、配置、路由，也不能执行任务。

**定位**

- `kun/src/seam/features/automation.feature.ts:59`
- `kun/src/automation/services/automation-runtime.ts:287`

**修复方案**

1. 不要让 runtime 内部通过未知 baseUrl 回调自己。向 AutomationRuntime 注入受控的 `ThreadService`、`TurnService` 和 run-turn adapter，或注入已鉴权的内部 RuntimeClient。
2. 为任务执行增加 abort signal、超时、SSE/事件等待和明确的失败状态映射。
3. 使用 fake model client 做完整任务测试：create thread -> start turn -> assistant output -> policy -> approval/completed。

### ISSUE-007 [P0] Collaboration 迁移完全缺失

**现象**

- 没有 collaboration contracts、plan/task/store/orchestrator/routes。
- 没有 collab-board UI。
- `/v1/collaboration/plans` 永远 404。
- Automation 中只有 `collaborationMode` 字段，无法调用任何协作能力。

**修复方案**

按设计文档 Stage 2 完整迁移 collaboration domain，至少实现计划创建/校验/确认、依赖任务派发、并发限制、clarification、终止、持久化和 GUI 看板。完成前不能宣称“专家团”或“协作编排”已实现。

### ISSUE-008 [P1] Extension service envelope 与消费者类型不一致

**现象**

- Registry 将 feature 返回值保存为 `services[ext.id]`。
- Experts feature 返回 `{ experts: service }`，实际结构为 `runtime.extensions.experts.experts`。
- 路由却把 `runtime.extensions.experts` 当作 `ExpertService`，导致 `listExperts is not a function`。
- Automation 的 employees 路由同样从错误层读取，配置有 1 个 employee 时仍返回空数组。

**定位**

- `kun/src/seam/registry.ts:39`
- `kun/src/seam/features/experts.feature.ts:23`
- `kun/src/seam/features/automation.feature.ts:85`

**修复方案**

定义单一、可泛型化的契约：`initializeServices()` 返回该 feature 的 service envelope，消费者只读取 `runtime.extensions[featureId]` 的同一 shape。删除 `as ExpertService`、`as any` 等掩盖结构错误的断言，并新增真实 runtime integration test。

### ISSUE-009 [P1] preload IPC 白名单拒绝全部迁移端点

**现象**

`runtimeRequestPayloadSchema` 的 endpoint 列表没有 Experts、Collaboration、MoA、Automation、Design 常量，renderer 调用在到达 main runtime adapter 前就失败。

**定位**

- `src/main/ipc/app-ipc-schemas/runtime.ts:54`
- `src/main/ipc/app-ipc-schemas/runtime.ts:135`
- `src/shared/seam/index.ts:10`

**修复方案**

1. 在 shared seam 定义每个 endpoint template 和允许方法。
2. 将扩展 endpoint templates 合并到 IPC schema 的 ENDPOINTS，而不是在 renderer 绕过校验。
3. 为每个路径和 HTTP method 添加 allow/deny 单测，覆盖 query string 与 `:id` 参数。

### ISSUE-010 [P1][安全] 扩展路由没有 Bearer 鉴权

**现象**

手工注册正确 seam 后，无 Authorization header 的 Automation/Design 请求返回 200。Experts 路由也在无 token 时进入 handler，只是随后因 envelope 错误抛异常。核心 `/v1/*` 路由会调用 `authorize()`，迁移路由没有。

**修复方案**

1. 不允许 feature 自己记住鉴权。让 `RouteRegistrar` 接收由 server 提供的 `authenticated(handler)` wrapper，或在 seam 注册层统一包装所有 `/v1/*` 路由。
2. 添加无 token=401、错 token=401、正确 token=2xx 的集成测试。
3. 在修复鉴权前不要只修正错误 import 并暴露这些路由。

### ISSUE-011 [P1] Experts API 不完整，状态持久化目录错误

**现象**

- ExpertService 有 create team/create expert/delete/setEnabled 方法，但 feature 只注册两个 GET 路由。
- 自定义专家、启停、删除无法从 GUI/API 使用。
- `ExpertStatusStore` 的 dataDir 使用 `pluginRoots[0]`，会把状态写到资源目录下的 `experts/status.json`；打包后资源通常只读，也会污染仓库资源。

**定位**

- `kun/src/seam/features/experts.feature.ts:26`
- `kun/src/seam/features/experts.feature.ts:45`
- `kun/src/experts/services/expert-service.ts:69`
- `kun/src/experts/services/expert-service.ts:140`
- `kun/src/experts/services/expert-service.ts:199`

**修复方案**

补齐 create/update/delete/enable/disable/refresh/diagnostics 路由和 schema 校验。状态目录必须来自 Kun `dataDir` 或显式 `statusDataDir`，插件资源目录只读。

### ISSUE-012 [P1] 305 个专家插件并未全部成功加载

**现象**

- 顶层插件目录数量为 305。
- 实际得到 233 个专家、38 个专家团，共 271 个可用条目。
- 33 个插件 manifest 校验失败，样例包括 `adort-design-expert`、`data`、`data-analysis`、`deep-research`、`design-to-code`。
- 现有集成测试只在列表非空时做条件断言，没有断言 305 或 validationErrors=0。

**修复方案**

1. 统计来源仓库 manifest 的真实版本和形状，增加兼容 mapper，而不是让所有旧 manifest 强行满足单一新 schema。
2. 建立迁移清单：每个顶层插件必须映射为 expert/team、明确标记“不适用”，或记录可接受的校验失败原因。
3. 验收测试断言 `topLevelPluginCount=305`、`unaccounted=0`，并对失败名单做 snapshot。

### ISSUE-013 [P1] Automation 领域仍缺调度、发送与正确存储

**现象**

- `ScheduledTaskSchema` 和 `schedules` 配置存在，但没有 scheduler/cron runner。
- policy 的 `send` 只把任务标为 completed，没有外部发送 adapter。
- cancel 不会中断已运行的 Kun turn。
- task store 硬编码为相对目录 `.kun`，未使用 runtime dataDir。
- feature 即使 `enabled=false` 仍会初始化 runtime 和 store。
- `kun/src/automation` 没有任何测试文件。

**定位**

- `kun/src/seam/features/automation.feature.ts:47`
- `kun/src/automation/services/automation-runtime.ts`
- `kun/src/automation/contracts/automation-types.ts`

**修复方案**

拆分 scheduler、task runner、delivery adapter、approval service 和 store；所有持久化使用 runtime dataDir；`enabled=false` 时不注册执行面；实现 abort；增加 store、policy、runtime、routes、scheduler 和 Electron E2E 测试。不要把既有 `Scheduled tasks` 页面当成新 Automation 已接入的证据。

### ISSUE-014 [P1] Design 必需资源缺失，服务启动扫描还存在竞态

**现象**

- `design/design_libraries`、`design/runtime-skills`、`design/skills` 全部不存在。
- 服务打印 `ENOENT`，正确注册路由后 libraries/skills 都是空数组。
- 两个 service constructor 使用 `void this.scan...()`，初始化完成不等于资源扫描完成；即使补资源，首个请求仍可能读到空结果。
- 现有测试只创建临时 fixture，不验证真实 17 个库和随包资源。

**定位**

- `kun/src/design/services/design-library-service.ts:31`
- `kun/src/design/services/skill-service.ts:28`
- `kun/src/design/design.test.ts`

**修复方案**

复制并校验设计文档列出的全部资源；`initializeServices()` 显式 await `scanLibraries()` 和 `scanSkills()`；打包配置加入资源；增加真实资源计数、首屏接口非空和 packaged app 测试。

### ISSUE-015 [P1] MoA 内置 preset 的 provider 引用不成立

**现象**

- 内置模型写成 `claude-3-5-sonnet...`、`gpt-4o`、`gemini...`，没有 `providerId/modelId` 前缀。
- `parseModelReference()` 对这种值返回 `providerId=undefined`。
- 最终所有 proposer/aggregator 都会走 GUI 默认 provider；当前默认是 DeepSeek，必然把 Claude/GPT/Gemini model id 发到 DeepSeek endpoint。

**定位**

- `kun/src/moa/contracts/moa-types.ts:141`
- `kun/src/moa/contracts/moa-types.ts:150`
- `kun/src/moa/adapters/moa-config.ts:83`

**修复方案**

内置 preset 必须引用明确 provider，且启动时验证所需 provider/account 都已配置。GUI 要展示缺失 provider、预计调用数和成本，未满足依赖时禁用 preset，而不是回退到默认 provider。

### ISSUE-016 [P2] 现有测试与完成文档产生“假绿”

**现象**

- 57 个迁移测试全绿，但没有覆盖 CLI config、真实 `buildRouter`、preload allowlist、GUI 入口、loop request、MoA 多 preset 注册、Automation 任务或真实资源。
- Experts 集成测试在 0 个结果时也不失败。
- Automation 无测试。
- Stage 3 文档宣称 complete，但同文档又写 thread field/UI/tracing 等待后续实现；迁移进度文档与实际代码状态也互相矛盾。

**修复方案**

建立设计验收矩阵并作为 CI gate：每个设计交付物必须有至少一个跨层测试。完成文档由可复现命令和计数生成，不能手写“全部通过”后忽略缺失交付物。

## 4. 额外 MoA 实现风险

以下问题尚未成为独立 P0，是因为 MoA 当前更早就被阻断，但修主链路时必须一并处理：

1. `moa-model-client.ts:106` 在分批前就创建了全部 async promise，所谓 `maxConcurrentProposers` 实际不能限制并发。应按切片后再创建 promise。
2. trace 保存在共享 client 实例字段 `this.trace`，多请求并发会互相污染，且 layers 会跨请求累积。trace 必须是 `stream()` 内的请求局部状态。
3. dynamic router 仍是永远返回 true 的 placeholder，不能宣称已经实现 Pyramid MoA。
4. token/cost trace 字段仍为空，无法支持文档所述的成本与性能分析。

## 5. 建议修复顺序

1. **安全与基础接缝**：修正 router import，同时先统一鉴权 wrapper。
2. **配置链路**：完成 AppSettings -> config -> CLI -> runtime 的 extension bag round-trip。
3. **服务契约**：修正 extension service envelope，移除 fake `ServerRuntime` 和错误类型断言。
4. **IPC 与 GUI**：补 endpoint allowlist、shared/main/renderer registries 和实际 Workbench 入口。
5. **Agent loop**：让 expert/MoA hook 的输入和输出真正进入 ModelRequest。
6. **Experts + Collaboration**：补 CRUD、状态目录、33 个 manifest 兼容和完整协作域。
7. **MoA**：单 provider dispatcher、多 preset、provider/account 依赖、并发与 trace 修复。
8. **Automation**：实现内部 runtime adapter、scheduler、delivery、abort、dataDir 和测试。
9. **Design**：复制资源、await 扫描、打包验证。
10. **质量门禁**：Electron E2E + HTTP 鉴权 + 跨层 config/router/model tests，更新完成文档。

## 6. 回归验收清单

修复后必须至少通过以下场景：

- [ ] 隔离 profile 启动应用，首屏可进入专家广场、Automation，Settings 可配置 MoA。
- [ ] GUI 可加载并解释全部 305 个插件，未映射和校验失败数量为 0，或有经过评审的明确白名单。
- [ ] 创建、启停、删除自定义专家，重启后状态仍存在，且不会写入资源目录。
- [ ] 带 `expertId` 的 thread 实际发送包含专家 roleDefinition 的 ModelRequest。
- [ ] 专家团计划可创建、确认、派发、等待 clarification、终止和恢复。
- [ ] 至少两个 MoA preset 可选择；每个 underlying request 到达正确 provider；并发上限生效。
- [ ] MoA 缺 provider/account 时在请求前阻止并给出可操作错误。
- [ ] Automation 手动任务可完成；高风险任务进入 approval；拒绝/批准/取消可回归。
- [ ] Automation schedule 在可控 fake clock 下触发，重启不重复执行。
- [ ] 17 个设计库和 runtime/static skills 随包存在，首次 API 请求即非空。
- [ ] 所有迁移 `/v1/*` 路由：无 token 401，错 token 401，正确 token 才允许访问。
- [ ] preload 只允许声明的路径和方法，非法路径继续被拒绝。
- [ ] `npm run typecheck`、`npm run test`、`npm run build` 全部通过。
- [ ] Windows Electron E2E 从 UI 完成一次 Experts、Collaboration、MoA、Automation 核心流程。

## 7. 发布判定

当前版本只能说明“若干领域类和 seam 骨架可以编译、部分单元测试通过”，不能说明迁移功能已经实现。建议将 Stage 1-5 的状态统一回退为 **In Progress**，在 ISSUE-001 至 ISSUE-010 全部关闭前禁止发布；在 16 项问题全部有回归证据前，不应再次标记 migration complete。
