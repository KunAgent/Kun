# 专家 / 专家团 / MoA / 自动化 迁移设计

- 状态：草案（待评审）
- 日期：2026-07-15
- 目标仓库：`D:\soft\Kun`（`kun-gui`，上游 `github.com/KunAgent/Kun`）
- 来源仓库：`D:\soft\workStone`（同结构，已实现全部功能）

## 1. 背景与约束

将 workStone 中的以下能力迁移到 Kun：

- 专家 / 专家团（experts）
- 专家团协作编排（collaboration）
- MoA（Mixture of Agents）
- 自动化（automation）
- 资源目录：`experts/plugins/`（305 个插件）、`design/`（设计库 + runtime skills）

### 硬约束

1. **上游 = 整个 `github.com/KunAgent/Kun`**（GUI + 内嵌 `kun/` 运行时一起更新）。
2. **同步频繁**（周 / 月级），必须最小化 merge 冲突面。
3. **完全融入主代码流程**（非 feature-flag、非可选插件加载；运行时主流程直接使用）。
4. **上游当前完全没有这些功能**（纯新增，验证过 `kun/src/services/expert*` 与 `contracts/experts*` 均不存在）。
5. **必须支持后续持续新增自定义功能，且新增时零上游文件改动。**

### 关键技术事实（已核实）

- `kun/` 用自定义 `Router`（`kun/src/server/router.js`），API 为 `router.add('METHOD', '/path', handler)`，**不是 Express**。
- 运行时组合根：`createKunServeRuntime`（`kun/src/server/runtime-factory.ts`）。
- 路由构建：`buildRouter(runtime: ServerRuntime): Router`（`kun/src/server/routes/index.ts`）。
- Agent loop：`kun/src/loop/agent-loop.ts`。
- 配置 schema：`kun/src/config/kun-config.ts`。
- 模型客户端：`kun/src/adapters/model/*`（`multi-provider-model-client.ts`）。
- GUI 接入点：`src/renderer/src/App.tsx`、`src/main/ipc/register-app-ipc-handlers.ts`、`src/shared/app-settings-types.ts`、`src/shared/kun-endpoints.ts`。

## 2. 方案选型

已评估三种方案：

- **A. Feature Module 分层 + Extension Seam（采用）**
- B. Vendor Fork + Patch 机制（拒绝：复杂度高、不符合"完全融入"）
- C. 完全 Flat Merge（拒绝：冲突面大、无法回退、可维护性差）

采用 A，并在其基础上引入 **Extension Seam（扩展接缝）** 机制解决"集成点随功能增长而膨胀"的隐患。

### 核心思想

把上游文件的修改次数**固定为一次性接入**。之后所有功能（含未来自定义功能）都在**我们完全拥有的扩展目录**内自注册，永不再碰上游文件。

- 上游文件修改点：**固定 ~7 处，永不增长**。
- 每个接缝在上游文件里只调用一行（route/service/hook/config/schema 分发）。
- 新增功能 = 新增自有目录 + 一个 `*.feature.ts` 自注册文件。

### 命名空间澄清（关键）

**区分两个独立系统：**

1. **现有 `kun/src/extensions/`** = **MCP 扩展平台**
   - 管理第三方 MCP 扩展（npm packages）
   - 包含 ExtensionManager、registry.ts（931行）、host-process、package-manager 等
   - **生产代码，不能修改**

2. **新建 `kun/src/seam/`** = **Kun Extension Seam（本方案）**
   - 用于集成 workStone 的专家/团队/MoA/自动化功能
   - 独立命名空间，避免与 MCP 扩展冲突
   - 本次迁移的核心基础设施

## 3. Extension Seam 架构

### 3.1 后端扩展中枢（我们拥有，上游永远没有）

```
kun/src/seam/                    # Extension Seam 基础设施（独立命名空间）
├── index.ts                     # 唯一聚合入口：5 个 dispatch 函数
├── registry.ts                  # ExtensionRegistry：收集 routes/services/loop-hooks/model-clients
├── types.ts                     # KunExtension 接口 + LoopHookBus 定义
└── features/
    ├── index.ts                 # ENABLED_FEATURES 数组
    ├── experts.feature.ts       # 专家 + 协作 自注册（Stage 1+）
    ├── moa.feature.ts           # MoA 自注册（Stage 3+）
    ├── automation.feature.ts    # 自动化 自注册（Stage 4+）
    ├── design.feature.ts        # 设计库 + runtime skills 自注册（Stage 5+）
    └── <future>.feature.ts      # 未来功能只加这里
```

### 3.2 扩展契约（已实现）

```typescript
// kun/src/seam/types.ts
import type { Router } from '../server/router.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'

export const LOOP_HOOK_NAMES = ['beforeLoop', 'afterModelSelect', 'beforeToolCall', 'afterTurn'] as const
export type LoopHookName = (typeof LOOP_HOOK_NAMES)[number]

export type LoopHookContext = {
  threadId: string
  turnId: string
  [key: string]: unknown  // 各功能读写自己的字段
}

export type LoopHookFn = (ctx: LoopHookContext) => Promise<void> | void

export interface LoopHookBus {
  on(name: LoopHookName, fn: LoopHookFn): void
  emit(name: LoopHookName, ctx: LoopHookContext): Promise<void>
}

export type ExtensionRuntimeServices = Record<string, unknown>
export type RouteRegistrar = (router: Router, runtime: ServerRuntime) => void

export interface KunExtension {
  id: string
  /** 向自定义 Router 注册路由（router.add(...)） */
  registerRoutes?: RouteRegistrar
  /** 读取 config.extensions[id]，用自己的 schema 验证，返回服务挂到 runtime.extensions[id] */
  initializeServices?(featureConfig: unknown, runtime: ServerRuntime): Promise<Record<string, unknown>>
  /** 注册 agent loop 钩子 */
  registerLoopHooks?(bus: LoopHookBus): void
  /** 注册模型客户端（如 MoA） */
  registerModelClients?(registry: unknown): void
}
```

### 3.3 后端集成点（上游文件，一次性接入，Stage 0 已完成）

| # | 上游文件 | 一次性改动 | 状态 |
|---|---------|-----------|------|
| 1 | `kun/src/server/routes/index.ts` | `buildRouter` 末尾调用 `registerExtensionRoutes(router, runtime)` | ✅ 已实现 |
| 2 | `kun/src/server/runtime-factory.ts` | 服务组装后调用 `initializeExtensionServices(config, runtime)`，结果并入 runtime | ✅ 已实现 |
| 3 | `kun/src/loop/agent-loop.ts` | 在既定时机 `await emitLoopHook('...', ctx)` | 待实现 |
| 4 | `kun/src/config/kun-config.ts` + `kun/src/cli/cli-options.ts` + `kun/src/server/runtime-factory.ts` | 一次性加入 `extensions?: Record<string, unknown>` passthrough 字段 | 待实现 |
| 5 | `kun/src/adapters/model/multi-provider-model-client.ts` | 允许 registry 注入扩展 model client（如 `moa`） | 待实现 |

**已实现的接缝函数（`kun/src/seam/index.ts`）：**

```typescript
// Seam #1: Routes
export function registerExtensionRoutes(router: Router, runtime: ServerRuntime): void

// Seam #2: Runtime services
export async function initializeExtensionServices(
  config: Record<string, unknown>,
  runtime: ServerRuntime
): Promise<ExtensionRuntimeServices>

// Seam #3: Agent loop hooks
export async function emitLoopHook(name: LoopHookName, ctx: LoopHookContext): Promise<void>

// Seam #5: Model clients
export function registerExtensionModelClients(clientRegistry: unknown): void
```

### 3.4 GUI 扩展中枢（新建目录，避免与 MCP 扩展冲突）

```
src/renderer/src/seam/
├── index.ts              # renderExtensionPanels() / extensionRoutes()
├── panel-registry.ts     # 面板 / 路由注册表
└── features/
    ├── experts.panel.tsx        # 专家广场面板（Stage 1+）
    ├── collaboration.panel.tsx  # 协作面板（Stage 2+）
    ├── design.panel.tsx         # 设计库面板（Stage 5+）
    └── <future>.panel.tsx

src/main/seam/
├── index.ts              # registerExtensionIpc()
└── features/
    ├── experts.ipc.ts           # 专家相关 IPC（Stage 1+）
    ├── design.ipc.ts            # 设计库相关 IPC（Stage 5+）
    └── <future>.ipc.ts

src/shared/seam/
├── index.ts              # mergeExtensionSettings() / extension endpoint 常量聚合
└── features/
    ├── experts.settings.ts      # 专家配置类型（Stage 1+）
    ├── design.settings.ts       # 设计库配置类型（Stage 5+）
    └── <future>.settings.ts
```

### 3.5 GUI 集成点（上游文件，一次性接入）

| # | 上游文件 | 一次性改动 | 状态 |
|---|---------|-----------|------|
| 6 | `src/renderer/src/App.tsx` | 渲染 `renderExtensionPanels()` / 合并 `extensionRoutes()` | 待实现 |
| 7 | `src/main/ipc/register-app-ipc-handlers.ts` | 调用 `registerExtensionIpc(...)` | 待实现 |
| 8 | `src/shared/app-settings-types.ts` | `mergeExtensionSettings(BaseAppSettings)` | 待实现 |
| 9 | `src/shared/kun-endpoints.ts` | 聚合 `extensionEndpoints` | 待实现 |
| 10 | `src/main/kun-process.ts` | 传递 `experts/moa/automation/design` 配置 + 资源根路径到 kun serve | 待实现 |

> 注：后端 3 个接缝函数已实现，2 个待实现；GUI 侧 5 个接入点待实现。新增功能不再增加接入点。

## 4. 领域模块设计（迁移后的目标结构）

### 4.1 experts 领域

```
kun/src/experts/
├── contracts/
│   ├── experts.ts               # ExpertProfile, ExpertTeam, CreateCustom*（zod）
│   └── collaboration.ts         # CollaborationPlan/Task/State/Limits（zod）
├── services/
│   ├── expert-service.ts        # 插件扫描 + 自定义专家 CRUD + enable/disable
│   ├── expert-status-store.ts   # 状态持久化
│   ├── collaboration-orchestrator.ts   # 编排引擎：派发/依赖/并发/终止
│   ├── collaboration-plan-service.ts   # 计划 CRUD/验证/确认
│   ├── collaboration-task-service.ts   # 任务派发/生命周期/clarification
│   └── collaboration-store.ts   # 计划/任务 JSON 持久化
├── adapters/
│   ├── expert-plugin-resolver.ts       # 扫描 .codebuddy-plugin/plugin.json
│   ├── expert-profile-mapper.ts        # manifest -> profile/team
│   └── collaboration-tool-provider.ts  # 注入协作工具到子任务 agent
├── loop/
│   └── expert-context-hook.ts   # 注入专家 systemPrompt（经 loop hook）
└── routes/
    ├── experts.ts               # GET/POST /v1/experts, /v1/experts/:id ...
    └── collaboration.ts         # /v1/collaboration/plans, /tasks ...
```

### 4.2 moa 领域

```
kun/src/moa/
├── contracts/moa-types.ts       # MoaPreset, MoaModelReference
├── adapters/
│   ├── moa-config.ts            # 解析 settings.moa
│   ├── moa-model-client.ts      # 聚合多模型推理
│   ├── moa-reference-view.ts    # 模型引用解析
│   └── moa-trace.ts             # 推理轨迹
└── routing/moa-routing.ts       # 路由 MoA vs 普通模型（经 loop hook）
```

### 4.3 automation 领域

```
kun/src/automation/
├── contracts/automation-types.ts
├── services/
│   ├── automation-runtime.ts    # 调度运行时
│   ├── automation-task-store.ts # 任务存储
│   └── automation-policy-engine.ts
└── adapters/automation-kun-runner.ts
```

### 4.4 design 领域（新增，集成现有设计功能）

```
kun/src/design/
├── contracts/
│   ├── design-library-types.ts  # DesignLibrary, DesignComponent, DesignAsset
│   └── skill-types.ts           # RuntimeSkill, SkillMetadata
├── services/
│   ├── design-library-service.ts    # 扫描 design/design_libraries/
│   ├── design-component-service.ts  # 组件 CRUD + 搜索
│   ├── design-asset-service.ts      # 资源管理（图片、字体等）
│   └── skill-service.ts             # runtime-skills 扫描 + 执行
├── adapters/
│   ├── design-library-resolver.ts   # 扫描文件系统 design_libraries
│   ├── skill-resolver.ts            # 扫描 runtime-skills + skills
│   └── design-tool-provider.ts      # 注入设计工具到 agent
├── loop/
│   └── design-context-hook.ts   # 注入设计库上下文（经 loop hook）
└── routes/
    ├── design-libraries.ts      # GET/POST /v1/design/libraries, /components ...
    └── skills.ts                # GET /v1/design/skills, /skills/:id/execute
```

### 4.5 GUI 领域模块

```
src/shared/experts/           <- kun-experts-api.ts, kun-collaboration-api.ts
src/shared/automation/        <- automation-*.ts (types)
src/shared/design/            <- kun-design-api.ts, design-library-types.ts, skill-types.ts
src/renderer/src/experts/     <- components/experts/*, stores/expert-plaza-store.ts, lib/expert-recents.ts
src/renderer/src/collab-board/ <- collab-board/*
src/renderer/src/design/      <- components/design-library/*, stores/design-library-store.ts
src/main/experts/             <- 专家相关 main 逻辑
src/main/automation/          <- automation-*.ts
src/main/design/              <- 设计库相关 main 逻辑
```

## 5. 资源目录迁移

| 源 | 来源 | 目标 | 必需性 | 说明 |
|------|------|------|--------|------|
| 专家插件（305） | `workStone/experts/plugins/` | `Kun/experts/plugins/` | **必需** | 专家系统内容库 |
| 设计库（17） | `workStone/design/design_libraries/` | `Kun/design/design_libraries/` | **必需** | 现有设计功能的核心资源 |
| runtime skills | `workStone/design/runtime-skills/` | `Kun/design/runtime-skills/` | **必需** | agent 运行时可用的设计技能 |
| design skills | `workStone/design/skills/` | `Kun/design/skills/` | **必需** | 静态设计指导文档 |

### 资源目录结构

```
Kun/
├── experts/
│   └── plugins/               # 305 个专家插件（.codebuddy-plugin/）
│       ├── frontend-expert/
│       ├── backend-expert/
│       └── ...
└── design/
    ├── design_libraries/      # 17 个设计库
    │   ├── material-design/
    │   ├── ant-design/
    │   └── ...
    ├── runtime-skills/        # 运行时技能（agent 可动态加载）
    │   ├── design-patterns.md
    │   ├── color-theory.md
    │   └── ...
    └── skills/                # 静态技能（编译时参考）
        ├── ui-components.md
        ├── layout-principles.md
        └── ...
```

### 资源加载机制

- **`experts/plugins/`** 由 `expert-service` 启动时扫描 `pluginRoots`；单插件失败不阻塞其它插件（错误进 `validationErrors`）。
- **`design/design_libraries/`** 由 `design-library-service` 扫描，每个设计库包含 manifest.json + 组件定义。
- **`design/runtime-skills/`** 由 `skill-service` 动态加载，可通过 API 查询并注入到 agent context。
- **`design/skills/`** 为静态参考文档，编译时可选地打包到系统提示。
- 资源根路径由 `src/main/kun-process.ts` 通过配置传给 kun serve（接入点 #10）。
- 所有资源目录**上游没有**，纯新增，无冲突。

> 决策（2026-07-15 定稿）：`design/` 资源本次迁移一并纳入（必需），与 workStone 中已有的设计功能对齐；automation 与 experts/collaboration/moa 同批推进；阶段 0（Extension Seam 骨架）已部分落地，需完成剩余接入点并通过"空接缝回归"验证，再迁移具体功能。

## 6. 配置模型（单一 passthrough bag，避免每功能改上游）

Kun 的配置流为 `config.json -> KunConfigSchema -> ServeOptions -> KunServeRuntimeOptions -> runtime`。`KunConfigSchema` 与 `ServeOptionsSchema` 均为 `.strict()` 且字段一一对应。

**结论**：不采用"每功能各加一个顶层命名空间"（那会迫使每个功能同时改 `KunConfigSchema` + `ServeOptionsSchema` + `KunServeRuntimeOptions` + CLI 映射，共 3~4 处上游改动/功能）。改为**一次性**加入单一透传字段：

```
config.extensions            = { [featureId]: <任意 JSON> }   # 单一 bag
  例：config.extensions.experts   = { pluginRoots, customExpertsDir, collaborationDataDir }
      config.extensions.moa       = { presets, defaultPreset }
      config.extensions.automation= { enabled, tasksDir }
      config.extensions.design    = { librariesRoot, runtimeSkillsRoot, skillsRoot, defaultLibrary }
```

Stage 0 一次性在三处加入 `extensions?: Record<string, unknown>`（passthrough，不校验内层）：
`KunConfigSchema`、`ServeOptionsSchema`、`KunServeRuntimeOptions`（含 CLI 映射透传）。

- 每个功能在自己的 `initializeServices` 里读取 `config.extensions[this.id]`，用**自己的 Zod schema** 校验并解析。
- 功能拥有自己的配置校验，坏配置在功能内 fail-fast，不污染中央 `.strict()`。
- GUI 侧同理：`AppSettings.extensions[featureId]`，经 `mergeExtensionSettings` 合并。

> 这取代了早期草案里"merge 每功能 raw shape 进 KunConfigSchema"的做法（那只覆盖配置流第一跳，仍需改 ServeOptions/RuntimeOptions）。

## 7. 迁移阶段（每阶段独立可测、可验证）

1. **阶段 0 — Extension Seam 骨架**（部分完成）：
   - ✅ 已完成：`kun/src/seam/` 基础设施（index.ts、registry.ts、types.ts、features/index.ts）
   - ✅ 已接入：Seam #1（routes）、Seam #2（services）
   - 待完成：Seam #3（agent-loop hooks）、Seam #4（config passthrough）、Seam #5（model clients）
   - 待完成：GUI 5 个接入点（`src/renderer/src/seam/`、`src/main/seam/`、`src/shared/seam/`）
   - 验证：`npm run build:kun` + `npm run build` 通过，功能与上游一致（空接缝回归）

2. **阶段 1 — experts 基础**：迁移 experts contracts/service/adapters/routes + `src/shared/experts` + 专家广场 UI；`experts.feature.ts` 注册。资源：复制 `experts/plugins/`。

3. **阶段 2 — collaboration**：迁移 orchestrator/plan/task/store + collab-board UI + loop hook（expert-context-hook）。

4. **阶段 3 — MoA**：迁移 moa/* + model client 注册 + moa-routing loop hook + MoA 设置面板。

5. **阶段 4 — automation**：迁移 automation/* + 自动化 UI（与前序同批纳入本次迁移）。

6. **阶段 5 — design 功能集成**：
   - 迁移 `kun/src/design/` 领域模块（contracts/services/adapters/loop/routes）
   - 迁移 GUI design 模块（`src/shared/design/`、`src/renderer/src/design/`、`src/main/design/`）
   - `design.feature.ts` 注册到 Extension Seam
   - 资源：复制 `design/`（design_libraries + runtime-skills + skills，本次必需）
   - 验证：设计库扫描、组件搜索、runtime skill 执行、agent context 注入

> 阶段 0 为**独立验证关卡**：骨架落地后必须先通过"空接缝回归"（未启用任何 feature 时行为与上游完全一致），才进入阶段 1。

## 8. 验证策略

- 每阶段：`npm run typecheck` + 相关 `vitest` + `npm run build:kun` + `npm run build`。
- 迁移测试文件（`*.test.ts`）随源码一起迁移，保持 workStone 的测试覆盖。
- 阶段 0 完成后做一次"空接缝回归"：确认未启用任何 feature 时行为与上游完全一致。
- 端到端：专家广场加载 305 插件、创建自定义专家、专家团协作计划确认与派发、MoA 推理。

## 9. 上游合并规程（写入 AGENTS.md）

- 所有扩展代码只允许出现在 `**/seam/**` 与各领域目录（`kun/src/{experts,collaboration,moa,automation,design}`、`src/{shared,main,renderer/src}/{experts,collab-board,automation,design}`）。
- 10 个一次性接缝在上游文件中以 `// SEAM: <name>` 注释标记，merge 冲突时优先保留接缝调用行。
- 新增功能严禁修改上游文件；只新增自有目录 + 一个 `*.feature.ts` 到 `kun/src/seam/features/`。
- 维护 `docs/MIGRATION_INTEGRATION_POINTS.md` 记录 10 个接缝的位置与作用。
- **命名空间隔离**：`kun/src/extensions/` 为 MCP 扩展平台（生产代码，禁止修改）；`kun/src/seam/` 为 Kun Extension Seam（本方案独占）。

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 上游重构了某个接缝所在文件 | 接缝调用行有 `// EXT-SEAM` 标记，冲突时人工重新落位；接缝逻辑本身在我们的目录里不受影响 |
| loop hook 时机与上游演进不一致 | LoopHookBus 用命名事件；上游 agent-loop 变化时只需确认 emit 点仍在语义正确的位置 |
| 305 插件加载性能 | expert-service 异步扫描 + 错误隔离；必要时懒加载 profile 详情 |
| 自定义 Router 与 workStone 的 Express 差异 | workStone 的 route handler 需适配为 `router.add(method, path, handler)` 形态（迁移时改写路由注册层，业务逻辑不变） |

## 11. 交付物

- Extension Seam 骨架（后端 `kun/src/seam/` + GUI `src/{renderer/src,main,shared}/seam/`）
- experts / collaboration / moa / automation / design 五个领域模块
- 资源目录：
  - `experts/plugins/`（305 个专家插件）
  - `design/design_libraries/`（17 个设计库）
  - `design/runtime-skills/`（agent 运行时技能）
  - `design/skills/`（静态设计指导文档）
- `docs/MIGRATION_INTEGRATION_POINTS.md`（记录 10 个接缝位置）
- AGENTS.md 新增"Extension Seam 与新增功能规则"章节（含命名空间隔离说明）
- 迁移的单元测试保持通过



