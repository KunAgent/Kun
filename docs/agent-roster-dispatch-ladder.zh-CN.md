# Agent 名册与派活阶梯：设计稿

- 状态：设计稿，待评审
- 日期：2026-10-22
- 基线：本地 `develop` @ `b9f6e26f5`
- 范围：`kun/src/contracts`、`kun/src/delegation`、`kun/src/ade`、`kun/src/graph`、
  `kun/src/harness`、`kun/src/rooms`、`kun/src/adapters/tool`、`kun/src/server`、
  `src/main`、`src/shared`、`src/renderer/src`
- 关联：[kun-architecture.md](./kun-architecture.md)（Subagent 召回与派发、ADE 两节）、
  [graph-mode.md](./graph-mode.md)、[independent-agents.md](./independent-agents.md)、
  [AGENTS.md](./AGENTS.md)

本稿只做"注册与接线"层面的收敛。完成判定（verdict）、可分享的编排配方、长程多轮编排、
对外协议（以 Kun 作为 ACP server，或接入 A2A）都不在本稿范围内，见第 9 节。

---

## 0. 一页结论

**问题。** Kun 能把活派给很多 Agent，入口却有五个：`delegate_task`、`worker_create`、
`graph_define_plan`（兼容入口 `graph_create_run`）、`suggest_tasks`，以及 Code 对话（原 Rooms）
里的成员。这五个入口各读各的目录，各有一套发现方式和一套"选谁"的规则。结果是：
同一个 Agent 从不同入口进来，命运不一样；用户在界面上也看不出差别从哪来。

**目标。**

1. **一份名册。** 所有入口都从同一份名册选 Agent。名册条目 = 角色 +（可选的）引擎绑定。
   条目 id 就是现有的 profile id，不另开新的 id 空间。
2. **一条阶梯。** 派活按粒度分四档：自己做 → `delegate_task` → worker → Graph。
   入口之间只在粒度上有差别，能选的 Agent 是同一批。
3. **一致的失败。** 某一档不能运行某个条目时，在**选人那一刻**按统一的原因码拒绝，
   不允许静默退回到原生 loop。

**不做的事。** 不新增配置文件，不新增 id 空间，不改调度器、执行器和 `DelegatedTurnRuntime`
接口，名册也不进入稳定前缀或工具 schema。

**分期。** 阶段 0 只读名册加拆分超限文件，不改行为；阶段 1 让所有入口改读名册；
阶段 2 把阶梯写成规则，并统一 UI 用词；阶段 3 把 Graph 的学习表并进名册。详见第 6 节。

---

## 1. 先统一用词

现在的代码和界面里，"profile" 有三种含义，"Agent" 也有三种含义。本稿统一用下表的词，
后面各节都按这套词来写。

| 本稿用词 | 含义 | 现在的代码名 | 现在的 UI 叫法 |
|---|---|---|---|
| **角色** | 做什么、怎么做：提示词、工具策略、skills、权限 | `SubagentProfileConfig`（`contracts/capabilities-core.ts`） | 子代理 |
| **引擎** | 谁来跑：Kun 原生 loop、Claude Code、Codex、ACP agent…… | `HarnessDefinition`、`HarnessRoute`（`contracts/harness.ts`） | Agent（Agent Center、派活卡片） |
| **引擎启用项** | 引擎 × 凭据方式 × provider 的开关 | `HarnessEnabledProfile`（`harness/harness-catalog.ts`） | 连接/登录 |
| **成员** | 长期存在的参与者身份，带头像和记忆 | `AgentIdentity`（`contracts/agent-identities.ts`） | Agent（Code 对话） |
| **名册条目** | 角色 + 可选的引擎绑定 + 派生出来的能力事实 | 新增 `AgentRosterEntry` | 见第 4.6 节 |
| **名册** | 某个工作区、某个 surface 下全部有效条目 | 新增 `AgentRoster` | — |
| **档** | 派活的粒度：自己做、`delegate_task`、worker、Graph | — | — |
| **用途** | 准入规则的键 | `HarnessUsage`（`harness/usage-for-turn.ts`），规则在 `harness/harness-admission.ts` | — |

还有两个专有名词需要单独说明：

- Graph 里的 `GraphAgentProfileVersionV1` 是"项目级学习档案"，本稿称作**学习表**。
- 名册条目对模型使用的参数名统一叫 `profile`，因为 `delegate_task` 已经在用这个名字。
  这样做可以避免为了改名而改动工具 schema。

---

## 2. 现状：五个入口，四份目录

### 2.1 入口与选人依据（逐条核实）

| 入口 | 模型怎么指定角色 | 模型怎么指定引擎 | 没指定时怎么选 | 发现工具 |
|---|---|---|---|---|
| `delegate_task` | `profile`（可选） | **不能** | BM25 Top-5，再由小模型判断；不行就用 `defaultProfile` | `list_subagent_profiles` |
| `worker_create(_batch)` | 不能（`role` 只是显示文字） | `agent.harnessId/model/...` | `worker-selector`：profile 文档 + 引擎默认值，按评分选 | `harness_list` |
| `graph_define_plan` | **不能**，Lead 提示词明令禁止 | 每个任务可以写 `harnessId` | 先查学习表；查不到就按节点标题合成一个临时角色 | **没有** |
| `suggest_tasks` | 不能 | `route.agentId`（即引擎 id）+ `model` | 继承父会话 | 没有 |
| Code 对话成员 | 成员的 `presetId` | 成员的 `executor`（只允许 `CONVERSATION_HARNESS_IDS`） | 创建成员时固定 | `/v1/agents` |

代码位置：

- `delegate_task`：`adapters/tool/delegation-tool-provider.ts`、`delegation/subagent-router.ts`
- worker：`ade/manager-worker-inputs.ts`、`ade/worker-selector.ts`、`ade/manager-worker-create.ts`
- Graph：`graph/graph-intent-compiler.ts`（`GraphPlanIntentV2TaskBaseShape`、`GraphIntentTaskSchema`）、
  `graph/graph-attempt-routing.ts`（`routeOrCreateEphemeral`）、`prompt/graph-lead-mode.ts`
- `suggest_tasks`：`contracts/task-suggestions.ts`（`TaskSuggestionRouteSchema` 等同于
  `AgentDispatchAssignmentRouteSchema`）、`delegation/task-suggestion-launcher.ts`
- 成员：`contracts/agent-identities.ts`、`contracts/agent-executor.ts`、`rooms/room-request-runner.ts`

### 2.2 四份目录

1. **角色目录。** 由三层叠成：45 个内置角色（`delegation/builtin-agent-catalog.ts` +
   `builtin-profiles.ts`），叠上 `agents.kun.subagents.profiles[]`，再叠上工作区的
   `.kun/agents/*.md`（`delegation/workspace-agents.ts`）。合成的入口是
   `DelegationRuntime.listRoutingProfiles` / `resolveProfileSnapshot`
   （`delegation/delegation-runtime-base.ts`）。`delegate_task` 和 worker selector 读这一份。
2. **引擎目录。** `HarnessCatalog`（内置引擎 + 用户自定义 + extension 通过 `agents.register` 注册的），
   配合 `HarnessDetector` 提供 readiness，配合 `harness-capabilities` 提供能力矩阵。
3. **学习表。** `FileProjectAgentRegistry`（`graph/project-agent-registry.ts`），按项目隔离，
   有版本、生命周期（candidate → trusted …）和证据。默认是空的，只有 Graph 读它。
4. **成员表。** `/v1/agents`。`presetId` 指向角色目录，但读的是
   `mergeBuiltinSubagentProfiles(...).profiles`（`server/runtime-composition-rooms.ts`），
   **不包含工作区的 `.kun/agents/*.md`**。

### 2.3 具体的不一致

- **E1：同一个引擎绑定，两种结果。** `.kun/agents/reviewer.md` 里写了 `harness: codex`。
  - 走 `worker_create`：worker-selector 读 `doc.profile.harnessId`（`ade/worker-selector.ts`），
    结果跑在 Codex 上。
  - 走 `delegate_task(profile=reviewer)`：`runChild` 不传 `harnessId`
    （`adapters/tool/delegation-tool-provider.ts` 的 `runChild`），而 `harnessId` 被注释为
    "Frozen harness … (ADE worker route)"（`delegation/delegation-runtime-run.ts`）。
    结果跑在 Kun 原生 loop 上，而且没有任何提示。
  - 全仓库读 `profile.harnessId` 的消费方只有 worker-selector 和 harness-catalog。
- **E2：Graph 用不了现成的角色。** 45 个内置角色、用户配置的角色、`.kun/agents/*.md`，
  Graph 节点都选不到。intent 里没有角色字段；路由只查学习表，查不到就合成
  "You are a task executor specialized for: <title>" 这样的临时角色。
- **E3：三个入口三种发现方式，Graph 没有。**
  - `delegate_task` 用 `list_subagent_profiles`，只能看到角色，看不到引擎；
  - worker 用 `harness_list`，看到的是引擎；
  - Graph 规划时，`list_subagent_profiles` 在 `GRAPH_INCOMPATIBLE_TOOL_NAMES` 里被屏蔽，
    但 `harnessId` 又允许写，Lead 只能靠猜，等 `checkGraphPlanHarnesses` 报错后再改。
- **E4：同一个词，用户看到三种意思。** 派活卡片和 `suggest_tasks` 的 "Agent" 指引擎；
  Code 对话的 "Agent" 指成员；设置页的"子代理"指角色。
- **E5：成员看不到工作区角色。** 绑定了仓库的对话，成员的 `presetId` 不能指向该仓库
  `.kun/agents/*.md` 里的角色。
- **E6：给模型的名单信息不全。** `list_subagent_profiles` 每条只给 `id/name/description/toolPolicy`。
  模型不知道这个角色跑在哪个引擎上、能不能读本地文件、能不能续会话、
  在哪几档可用，也不知道主 agent 该把哪类活让给它。

### 2.4 已有、可以直接复用的部分

- `SubagentProfileConfig` 已经同时带角色字段和引擎字段（`harnessId`、`credentialMode`、
  `gatewayBinding`、`model`、`providerId`），还有 `delegationNotes` 和 `surfaces`。
  名册条目的"配置部分"不需要新的 schema。
- `ADMISSION_RULES`（`harness/harness-admission.ts`）已经按用途分好了准入规则，
  包括 `manager-worker`、`graph-worker`、`room-conversation` 等，**唯独没有 `delegate_task`
  子代理这一项**。
- `HarnessCapabilitiesSchema` 已经是一份带"不支持原因"的能力矩阵，比一个布尔标签更完整。
- 派发时冻结快照、权限取交集只降不升、宿主管理 worktree，这几条都已经是现行原则。

---

## 3. 设计纪律

1. **一份名册，所有入口都读它。** 入口之间的差异只能在"粒度"上（隔离方式、回注方式、
   监工方式），不能在"能选谁"上。任何入口想选名册之外的东西，要么是显式的一次性
   临时角色（`custom_agent`、临时节点），要么不允许。
2. **角色和引擎正交。** 名册条目 = 角色 +（可选的）引擎绑定。成员是名册之上的一层：
   成员引用一个条目，并且可以用自己的 `executor` 覆盖引擎。
3. **上层字段必须是执行层字段的子集。** 名册条目上能声明的东西，每一档都要兑现，
   兑现不了就在选人时拒绝。补的方式是让执行层支持，而不是在上层把字段删掉。
4. **名册是动态数据。** 名册只能出现在工具结果和每回合的动态上下文里，
   不进稳定前缀，也不进工具 schema 的 `enum` 或描述。这条服从
   [AGENTS.md](./AGENTS.md) 的缓存约束。代价是模型必须先调用一次列表工具才知道有谁，
   这个代价是可以接受的。
5. **能力正反都写。** 给模型的标签同时写 `local-files` 和 `no-local-files`，
   因为"没写"和"不支持"对模型来说分不清。
6. **派发时冻结快照。** 条目在派发那一刻被解析成快照，之后编辑名册不影响正在跑的任务。
7. **id 就是约定俗成的名字。** 条目 id 沿用 profile id。`.kun/agents/<id>.md` 已经是可以
   进 git、可以带到别人机器上的形式，别的入口引用这个名字就能用。

---

## 4. 目标模型

### 4.1 名册条目（新契约 `kun/src/contracts/agent-roster.ts`）

```ts
export const AgentRosterSourceSchema = z.enum([
  'builtin', 'configured', 'workspace', 'extension', 'learned'
])

/** 档：一次派活的粒度。键值与 HarnessUsage 一一对应。 */
export const AgentRosterLaneSchema = z.enum(['delegate', 'worker', 'graph', 'conversation'])

export const AgentRosterEngineSchema = z.discriminatedUnion('kind', [
  // 未绑定引擎：沿用这一档的默认选法（delegate 继承主会话路由，worker 走 selector）
  z.object({ kind: z.literal('lane-default') }).strict(),
  z.object({
    kind: z.literal('bound'),
    harnessId: HarnessIdSchema,
    credentialMode: HarnessCredentialModeSchema,
    model: z.string().min(1).max(512).optional(),
    providerId: z.string().min(1).max(128).optional(),
    gatewayBinding: HarnessGatewayBindingSchema.optional()
  }).strict()
])

/** 从 HarnessCapabilities 和角色派生，只读，不允许手填。 */
export const AgentRosterFactsSchema = z.object({
  writes: z.boolean(),            // toolPolicy !== 'readOnly'
  readsLocalFiles: z.boolean(),   // 引擎能读宿主文件系统（原生 loop、本地 ACP 恒为 true）
  resumable: z.boolean(),         // statuses.nativeResume
  liveProgress: z.boolean(),      // statuses.structuredStreaming
  kunTools: z.boolean(),          // statuses.kunTools
  userInput: z.boolean()          // statuses.userInput
}).strict()

export const AgentRosterLaneStatusSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).strict(),
  z.object({
    ok: z.literal(false),
    code: z.enum([
      'engine_not_ready', 'capability_missing', 'sandbox_insufficient',
      'surface_mismatch', 'mode_mismatch', 'disabled'
    ]),
    message: z.string().max(512)
  }).strict()
])

export const AgentRosterEntrySchema = z.object({
  id: z.string().min(1).max(128),
  source: AgentRosterSourceSchema,
  name: z.string().min(1).max(128),
  description: z.string().max(2_048),
  owns: z.string().max(300).optional(),
  surfaces: z.array(SubagentSurface),
  mode: SubagentMode,
  engine: AgentRosterEngineSchema,
  facts: AgentRosterFactsSchema,
  lanes: z.record(AgentRosterLaneSchema, AgentRosterLaneStatusSchema)
}).strict()
```

几点说明：

- **`facts` 和 `lanes` 只能派生，不能配置。** 它们回答的是"这个条目实际能干什么"，
  来源是引擎握手和能力矩阵，不是人手写的声明。这样可以避免"配置说支持、实际不支持"的情况。
- **`owns` 是唯一新增的配置字段**，加在 `SubagentProfileConfig` 上，最长 300 字符，
  用来写"主 agent 不要自己做什么"。它和 `description` 回答的问题不同：
  `description` 说这个角色能做什么，模型在挑人时读；`owns` 说主 agent 遇到哪类活应该交出去，
  模型在动手之前就要读到。内置的 `general` 角色永远不带 `owns`。
- **条目解析成快照时，仍然产出现有的 `SubagentProfileConfig`。** 执行层（`runChild`、
  `GraphAssignmentResolver`、`room-execution`）的入参不变。

### 4.2 名册服务（新模块 `kun/src/delegation/agent-roster.ts`）

```ts
export interface AgentRoster {
  list(input: { workspace?: string; surface: ThreadAgentSurface; lane?: AgentRosterLane }): Promise<AgentRosterEntry[]>
  resolve(id: string, input: {
    workspace?: string
    surface: ThreadAgentSurface
    lane: AgentRosterLane
    /** 调用方显式指定的引擎（卡片切换、worker_create.agent、Graph 任务的 harnessId）。 */
    engineOverride?: HarnessRoute
  }): Promise<AgentRosterResolution>
}

export type AgentRosterResolution =
  | { ok: true; id: string; source: AgentRosterSource; profile: SubagentProfileConfig; route?: HarnessRoute }
  | { ok: false; code: AgentRosterLaneFailure; message: string }
```

- **数据来源**，从弱到强：`extension` < `builtin` < `configured` < `workspace`。
  前三层沿用 `mergeBuiltinSubagentProfiles` 的逐个 id 深合并语义，最后叠上
  `loadWorkspaceAgentProfiles`。`learned` 在阶段 3 加入，只读。
- **引擎的选择优先级**：调用方显式指定 > 成员的 `executor` > 条目绑定的引擎 > 这一档的默认值。
  无论最终选了谁，都必须通过这一档的准入检查。
- **用途映射**：`delegate` → 新增 `delegate-child`，`worker` → `manager-worker`，
  `graph` → `graph-worker`，`conversation` → `room-conversation`（对话执行仍沿用
  `room-execution`）。全部复用 `checkHarnessAdmission`。
- **新增 `delegate-child` 准入规则**（`harness/usage-for-turn.ts` 的 `HARNESS_USAGES` 加一项，
  `harness/harness-admission.ts` 的 `ADMISSION_RULES` 加对应规则）：

  ```ts
  'delegate-child': { required: ['abort', 'structuredStreaming'], sandbox: 'isolated-or-native' }
  ```

  `delegate_task` 的子代理不建工作区，所以带写权限的条目要求引擎自带沙箱。
  只读条目（`toolPolicy: 'readOnly'`）在检查时视作 `workspace.isolated = true`，
  前提是该引擎的权限档位能映射到 Kun 的只读档。这个"只读放行"的条件要在 PR 1.2 里
  用真实引擎验证，不能只看 mock。
- **缓存。** 名册在每次 config apply 时重建。注意已知的坑：
  `runtime-composition-config.ts` 的 `nextRegistry` 会丢掉启动后才 `registerProvider` 的工具。
  名册服务必须在 `runtime-composition-agent.ts` 里构造，并在重建 registry 时重新传入。
- **成本。** 引擎的 readiness 只读 `HarnessDetector` 的缓存状态，`list()` 不触发任何探测。
  这样做是为了避免名单在回合中途缩水，导致模型围着一个正在消失的选项做计划。

### 4.3 派活阶梯

| 档 | 入口 | 什么时候用 | 工作区 | 结果怎么回来 | 准入用途 |
|---|---|---|---|---|---|
| 0 | 主 agent 自己做 | 不需要换角色、不需要并行 | 当前 | — | — |
| 1 | `delegate_task` | 一个角色做一件事，结果要回到本回合 | 父会话，权限取交集 | 工具结果，或后台通知 | `delegate-child` |
| 2 | `worker_create(_batch)` | 独立任务：自己的工作区或分支，可以并行、可以赛马、要验收 | task workspace | 派活卡片、通知、`worker_verdict` | `manager-worker` |
| 3 | `graph_define_plan` | 多步、有依赖、需要监工和逐节点审查 | 节点隔离 | Lead 审查后交给下游 | `graph-worker` |

另外有两个东西不是新的一档，而是"来源"或"界面"：

- **`suggest_tasks`** 是把任务交给**用户**，结果是用户拥有的子会话，不是派给某个 Agent。
  它可以引用名册条目作为子会话的角色（见 4.5），但不算阶梯上的一档。
- **Code 对话**是对话界面。成员是身份，真正执行时仍然走上面的阶梯。
  `workbench-bridge` 把任务交给 Code，也落在这四档里。

阶梯的规则（阶段 2 写进每回合的动态上下文，见 4.4）：

1. 每一档都从名册选人；模型给的 `profile` 必须是名册里的 id。
2. 一个条目在它的 `lanes[lane].ok === false` 的那一档里不能被选中：
   显式选中时，返回统一的错误码和原因；自动路由时直接排除，并在路由说明里写明原因。
3. 不允许静默降级：绑定了引擎的条目，不会因为某一档不支持该引擎就悄悄改用原生 loop 去跑。

### 4.4 名册给模型看

- **发现工具。** 继续用 `list_subagent_profiles`，工具名和参数 schema 都不变，只扩展输出。
  每条变成：

  ```json
  {
    "id": "reviewer",
    "name": "Code Reviewer",
    "description": "…",
    "owns": "owns code review. Do not review diffs yourself.",
    "engine": "codex · gpt-5.5-codex",
    "tags": ["read-only", "local-files", "resumable", "no-live-progress"],
    "lanes": { "delegate": "ok", "worker": "ok", "graph": "capability_missing: kunTools" }
  }
  ```

  没绑定引擎的条目，`engine` 写成 `"inherits main route"`。
- **在 Graph 规划时放开这个工具。** 把 `list_subagent_profiles` 从 `GRAPH_INCOMPATIBLE_TOOL_NAMES`
  （`graph/graph-tool-boundary.ts`）里拿出来，`delegate_task` 仍然屏蔽。屏蔽的初衷是
  "不让 Graph 规划阶段做普通的子代理分发"，而只读的列表工具并不会分发任何东西。
  `prompt/graph-lead-mode.ts` 里那句"不要使用 guessed profile ids"相应改成
  "只使用 `list_subagent_profiles` 返回的 id"。这是 mode system instruction 的一次性改动，
  会让 Graph 回合的缓存失效一次，之后恢复。
- **`harness_list` 保留。** 它回答的是引擎的就绪、登录和配额状态，和名册不重复。
  `worker_create` 的描述里改成先引导模型看名册。
- **`owns` 的投放位置。** 只在当前回合持有派活工具时，通过
  `prompt/kun-prompt-context.ts` 的 `KunTurnContextBlock` 注入一段"委派"块，
  列出带 `owns` 的条目。不进稳定前缀；没有派活工具的回合不渲染这段，
  否则会出现"不让自己做、又没法交出去"的死局。

### 4.5 各入口的接法

| 入口 | 新增的模型面字段 | 解析 | 冲突规则 |
|---|---|---|---|
| `delegate_task` | 无（已有 `profile`） | `roster.resolve(id, {lane: 'delegate'})`，把 `route` 传进 `runChild` | `custom_agent` 仍然只继承主会话路由，不能绑定引擎 |
| `worker_create` | `profile?: string` | `roster.resolve(id, {lane: 'worker', engineOverride: input.agent})` | `agent.harnessId` 和条目绑定的引擎不一致时，显式指定的赢，但必须通过准入 |
| `graph_define_plan` | 任务上加 `profile?: string` | 编译时解析成 `ephemeral` 引用，同时写入 `rosterProfileId` 溯源字段 | `profile` 和 `harnessId` 同时出现且不一致，就报 schema issue |
| `graph_create_run`（兼容） | 同上 | 同上 | 同上 |
| `suggest_tasks` | `route.profileId?` | 只接受 `mode` 为 `primary` 或 `all` 的条目，用作子会话的线程角色 | `subagent-only` 的条目返回 `mode_mismatch` |
| Code 对话成员 | 无（`presetId` 已有） | `presetId` 改为经名册解析；绑定仓库时带上工作区角色 | `executor` 覆盖条目的引擎 |
| 派活卡片 | `assignments[].profileId?` | RoutePicker 按引擎分组列出名册条目，也可以只选引擎 + 模型 | 每次切换都重启自动派发倒计时（现有规则） |

关于 Graph 的设计取舍：

- 阶段 1 **不新增**引用类型。`ephemeral` 引用已经带齐了 `systemPrompt`、`harnessId`、`model`、
  `toolPolicy`、黑名单等字段，编译时把名册快照拷进去就行。
  新增的只有两个可选溯源字段：`ephemeral` 引用上的 `rosterProfileId`，以及
  `GraphAssignmentSnapshotV1` 上的 `rosterProfileId`。
- `routeOrCreateEphemeral` 在学习表没命中时，阶段 2 改为先用 `SubagentRouter` 在名册里召回，
  仍然没有才合成临时角色。

### 4.6 UI 用词（待用户拍板，见 9.2）

推荐方案：

- 界面上的 **"Agent" 指名册条目**，也就是"角色 @ 引擎"。
- Claude Code、Codex 这些叫 **"引擎"**，Agent Center 的标题和分组相应调整。
- Code 对话里长期存在的叫 **"成员"**。成员详情页里显示"基于 Agent：<条目名>"。
- 设置页"子代理"改名为"Agent"，每个条目显示引擎绑定、各档的可用状态和 `owns`。

---

## 5. 代码落点

按 [AGENTS.md](./AGENTS.md) 的扩展顺序排列：先 contracts，再 runtime，再路由，再 main/preload，
最后 renderer。行数是基线上的数字，下表标 **⚠** 的文件已经接近 700 行上限，
**必须先拆分，再改动**。

### 5.1 contracts

| 文件 | 改动 |
|---|---|
| 新增 `kun/src/contracts/agent-roster.ts` | 4.1 的全部 schema，以及 `AgentRosterLaneFailure` |
| `kun/src/contracts/capabilities-core.ts` | `SubagentProfileConfig` 加 `owns`；`harnessId` 的注释从 "ADE worker binding" 改为"所有档都兑现的引擎绑定" |
| `kun/src/contracts/graph-core.ts` | `ephemeral` 引用和 `GraphAssignmentSnapshotV1` 各加可选的 `rosterProfileId` |
| `kun/src/contracts/agent-dispatch-intents.ts` | `AgentDispatchAssignmentRouteSchema` 加可选的 `profileId`（`TaskSuggestionRouteSchema` 是同一个 schema，自动获得） |
| `kun/src/contracts/agent-identities.ts` | 不改；在注释里写明 `presetId` 是名册 id |

### 5.2 Kun runtime

| 文件 | 行数 | 改动 |
|---|---|---|
| 新增 `kun/src/delegation/agent-roster.ts` | — | 名册服务：来源合并、快照解析、引擎优先级 |
| 新增 `kun/src/delegation/agent-roster-facts.ts` | — | 从 `HarnessCapabilities` 和角色派生 `facts`、`tags` |
| 新增 `kun/src/delegation/agent-roster-lanes.ts` | — | 档 → 用途映射，调用 `checkHarnessAdmission`，把失败映射到统一原因码 |
| `kun/src/harness/usage-for-turn.ts`、`harness/harness-admission.ts` | — | `HARNESS_USAGES` 加 `delegate-child`，`ADMISSION_RULES` 加对应规则 |
| `kun/src/delegation/delegation-runtime-base.ts` | ⚠ 682 | `listRoutingProfiles` 和 `resolveProfileSnapshot` 改为委托给名册；先把这两个方法连同 `listWorkspaceProfiles` 拆到 `delegation-runtime-profiles.ts` |
| `kun/src/adapters/tool/delegation-tool-provider.ts` | ⚠ 689 | 先把 `list_subagent_profiles` 拆到 `delegation-roster-tool.ts`；`runChild` 把条目快照里的 `route` 一起传下去；`list_subagent_profiles` 的输出扩展为 4.4 的形状 |
| `kun/src/delegation/delegation-runtime-run.ts` | — | `harnessId` 不再只是 ADE 专用：`delegate_task` 子代理在准入通过后，走 `child-agent-executor.ts` 已有的 delegated runtime 分支；权限沿用 `ade/permission-clamp.ts` 的映射 |
| `kun/src/ade/worker-selector.ts` | 419 | 候选改为 `roster.list({lane: 'worker'})`，加上纯引擎候选；评分逻辑不变 |
| `kun/src/ade/manager-worker-inputs.ts` | 67 | `WorkerCreateInputSchema` 加 `profile` |
| `kun/src/ade/manager-worker-create.ts`、`ade/worker-route.ts` | — | 有 `profile` 时先解析名册，再与 `agent` 合并 |
| `kun/src/adapters/tool/manager-tool-provider.ts` | ⚠ 641 | `worker_create` 的 JSON schema 加 `profile`，描述改为先引导看名册；动之前先把 worker 相关的 schema 拆到 `manager-worker-tool-schemas.ts` |
| `kun/src/graph/graph-intent-compiler.ts` | ⚠ 612 | V1 和 V2 任务都加 `profile`；`compileGraphIntent` 接收一个 `resolveProfile` 回调；先把 V2 schema 拆到 `graph-intent-schemas.ts` |
| `kun/src/adapters/tool/graph-define-plan-tool.ts` | ⚠ 611 | 编译前调用名册解析，失败时返回结构化 issue（路径是 `tasks[i].profile`）；与 `checkGraphPlanHarnesses` 合并成一个 issue 列表 |
| `kun/src/adapters/tool/graph-create-run-tool.ts` | 302 | 同上（兼容入口） |
| `kun/src/graph/graph-tool-boundary.ts` | — | 从 `GRAPH_INCOMPATIBLE_TOOL_NAMES` 移除 `list_subagent_profiles` |
| `kun/src/prompt/graph-lead-mode.ts` | — | 改写"guessed profile ids"那一句 |
| `kun/src/graph/graph-attempt-routing.ts` | 111 | 阶段 2：学习表没命中时，先在名册里召回 |
| `kun/src/delegation/task-suggestion-launcher.ts` | 262 | `route.profileId` → 线程角色；`mode` 检查 |
| `kun/src/server/runtime-composition-rooms.ts` | — | `profiles` 改为由名册提供；绑定仓库的对话带上工作区角色 |
| `kun/src/rooms/room-context.ts`、`room-execution.ts`、`room-request-runner.ts` | — | `deps.profiles()[presetId]` 改为 `roster.resolve(presetId, {lane: 'conversation'})`；`presetSnapshot` 语义不变 |
| `kun/src/prompt/kun-prompt-context.ts` | — | 阶段 2：新增"委派"类的 `KunTurnContextBlock` |
| `kun/src/server/runtime-composition-agent.ts`、`runtime-composition-manager.ts`、`runtime-composition-config.ts` | — | 只构造一次名册，注入 delegation、manager、graph、rooms、tasks；config apply 时重建并重新传入 |

### 5.3 HTTP 与 main/preload

| 文件 | 改动 |
|---|---|
| 新增 `kun/src/server/routes/agent-roster.ts` | `GET /v1/agent-roster?workspace=&surface=&lane=`，返回 `AgentRosterEntry[]`；只读 |
| `src/main/ipc/app-ipc-schemas/runtime.ts` | 把 `/v1/agent-roster` 加进 runtime 请求白名单（漏加会报 "runtime request path is not allowed"） |
| `src/main/runtime/kun-runtime-subagent-config.ts` | 把 `owns` 映射进 Kun 的 profiles |
| `src/shared/app-settings-types-kun-runtime.ts` | `KunSubagentProfileV1` 加 `owns?`（`mergeKunSubagentsSettings` 整体替换 `profiles`，无需额外合并逻辑） |

### 5.4 renderer

| 文件 | 改动 |
|---|---|
| `src/renderer/src/agent/kun-runtime.ts` | 新增 `listAgentRoster` |
| `src/renderer/src/components/subagents/SubagentProfileDialog.tsx`、`SubagentProfileControls.tsx` | 角色编辑里加引擎绑定（复用 `ade/AgentSettingsModelPicker.tsx`）和 `owns` 输入 |
| `src/renderer/src/components/subagents/subagent-settings-support.ts` | 读写 `owns`：trim，空串视为未设置 |
| `src/renderer/src/components/subagents/SubagentCatalogViews.tsx`、`SubagentDetailPanel.tsx` | 每个条目显示引擎、各档的可用状态和原因 |
| `src/renderer/src/components/chat/AgentDispatchRoutePicker.tsx`、`agent-dispatch-card-model.ts` | 选项改为名册条目（按引擎分组）+ 纯引擎；写入 `profileId` |
| `src/renderer/src/components/rooms/workbench-agent-selection.ts`、`AgentProfileForm.tsx` | 成员预设的下拉改读名册 |
| `src/renderer/src/components/ade/AgentCenter.tsx`、`AgentDetail.tsx` | 引擎详情加"被 N 个 Agent 使用"的反向链接 |
| i18n `en`、`zh` | 新增用词和原因码文案（zh 的复数形式要写 `_other`，避免被 en 的 `_other` 覆盖） |

### 5.5 测试

| 测试 | 覆盖 |
|---|---|
| 新增 `kun/src/delegation/agent-roster.test.ts` | 四层来源的优先级；`.kun/agents` 覆盖内置角色；extension 来源；引擎优先级；每个原因码 |
| 新增 `kun/src/delegation/agent-roster-lanes.test.ts` | 四档 × {原生 loop、Claude Code、Codex、ACP 无 kunTools} 的准入矩阵 |
| `adapters/tool/delegation-tool-provider*.test.ts` | `delegate_task(profile)` 把引擎带到 `runChild`；引擎未就绪时报错，不静默降级 |
| `ade/worker-selector.test.ts` | 黄金对照：名册候选和旧候选在同一组输入下排序一致 |
| `graph/graph-intent-compiler.test.ts` | `profile` 编译成带溯源的 `ephemeral`；冲突报 issue；未知 id 报 issue |
| `server/runtime-collaboration-tools.integration.test.ts` | config 连续 apply 两次后，名册和 `list_subagent_profiles` 仍然可用 |
| `scripts/smoke-development-ade.cjs` 新增 `--roster-only` | 用桩 ACP 引擎，三个入口用同一个条目，派出的都是同一个引擎 |

---

## 6. 迁移步骤

每个 PR 都能单独合并、单独回滚。分支名用 `kun/roster-*`，提交信息按 Angular 风格。

### 阶段 0：只读名册，不改行为

- **PR 0.1 拆分超限文件。** 拆 `delegation-tool-provider.ts`、`delegation-runtime-base.ts`、
  `manager-tool-provider.ts`、`graph-intent-compiler.ts`、`graph-define-plan-tool.ts`。
  纯搬运，零行为变化，通过 `npm run check:file-lines`。
- **PR 0.2 契约 + 名册服务 + 只读路由。** 新增 `agent-roster*.ts` 和
  `GET /v1/agent-roster`；`owns` 进 schema 和设置。还没有任何入口消费名册。
- **PR 0.3 扩展 `list_subagent_profiles` 的输出。** 只在工具结果里加字段，
  工具 schema 不变，稳定前缀不变。

验收：类型检查、相关 vitest、构建都通过；热回合的缓存命中率不变（仍高于 90%）。

### 阶段 1：所有入口改读名册

- **PR 1.1 worker selector 改读名册。** 先用黄金测试证明候选集合和排序不变。
- **PR 1.2 `delegate_task` 兑现引擎绑定。** 新增 `delegate-child` 准入规则。
  这是一次行为变化，用开关保护：`agents.kun.subagents.honorEngineBinding`。
  - 本 PR 默认关闭。关闭时行为和现在一样，但在 `list_subagent_profiles` 的 `lanes.delegate` 里
    如实写 `"runs on main route (engine binding not honored)"`。
  - 用 smoke 和真实引擎验证后，在 PR 1.6 默认打开。
- **PR 1.3 Graph 支持 `profile`。** 两个建图工具加字段；编译期解析；溯源字段；
  在 graph 边界放开 `list_subagent_profiles`；改写 Lead 提示词那一句。
- **PR 1.4 `worker_create` 支持 `profile`，派活卡片和 `suggest_tasks` 的路由带 `profileId`。**
- **PR 1.5 Code 对话成员改读名册。** 成员的 `presetId` 经名册解析，绑定仓库的对话带上工作区角色。
- **PR 1.6 默认打开 `honorEngineBinding`。** 发布说明里写清楚：
  `.kun/agents/*.md` 里的 `harness:` 现在对 `delegate_task` 也生效。

验收：见第 8 节的场景 1–5。

### 阶段 2：把阶梯写成规则

- **PR 2.1 动态"委派"块。** 写入阶梯规则和 `owns`，只在持有派活工具的回合出现。
- **PR 2.2 统一选人失败的原因码。** 四个入口用同一组原因码和同一套文案；
  自动路由的说明里写明被排除的条目和原因。
- **PR 2.3 Graph 在学习表没命中时，先在名册里召回。**
- **PR 2.4 UI 用词统一**（按 9.2 的决定执行）。

### 阶段 3：学习表并入名册

- 学习表以名册 id 为键：`builtin` 和 `user` 来源的学习档案从名册导入，
  学习表只保留证据和评分。
- 状态为 `trusted` 的 `learned` 条目，以 `source: 'learned'` 只读地出现在名册里。
- "转正"可以选择导出成 `.kun/agents/<id>.md`。这一步与可分享的编排配方相衔接，留给那份设计稿。

---

## 7. 兼容与回滚

- **配置。** 不新增必填字段，`owns` 可选。旧的 `agents.kun.subagents.profiles[]` 和
  `.kun/agents/*.md` 原样有效；不迁移数据，不搬文件。
- **持久化记录。** 旧的 child run 记录、Graph 快照、派活卡片和 task suggestion 都没有
  `rosterProfileId` 或 `profileId`。读的时候按原来的字段显示，不回填。
- **行为变化只有一处**，就是 PR 1.2 / 1.6 的引擎绑定，由开关保护，关掉即回滚。
- **缓存。** 名册不进稳定前缀和工具 schema。三个工具 schema 的新增可选字段
  （`worker_create.profile`、两个建图工具的 `tasks[].profile`）会各让缓存失效一次。
  Graph Lead 提示词改一句话，也会让缓存失效一次。每个 PR 合并前都要检查缓存遥测。
- **禁区复核。** 本稿不新增运行时切换器、进程管理器或诊断面板，
  外部引擎仍然只通过 `DelegatedTurnRuntime` 进入，符合 [AGENTS.md](./AGENTS.md) 的 Forbidden Paths。

---

## 8. 验收场景

在 `.kun/agents/reviewer.md` 里写 `harness: codex`、`toolPolicy: readOnly`、`owns: owns code review`：

1. `delegate_task(profile=reviewer)`、`worker_create(profile=reviewer)`、Graph 任务
   `profile: reviewer` 三者都在 Codex 上运行，child 记录和 Graph 快照里都能看到 `reviewer`。
2. 把 Codex 的引擎启用项关掉：上面三个入口都在选人那一刻用同一个原因码拒绝；
   自动路由会跳过 `reviewer`，并在路由说明里写明原因；设置页的条目显示"不可用"和原因。
3. Graph 任务写 `profile: explore`，执行者拿到的是内置 `explore` 的角色提示词和只读策略，
   而不是合成出来的临时角色。
4. `list_subagent_profiles` 能列出 `reviewer` 的引擎、标签和各档状态；
   Graph 规划回合也能调用它。
5. config 热更新两次之后，名册、`list_subagent_profiles`、派活卡片的选人器都正常。
6. 绑定仓库的 Code 对话里，可以选 `reviewer` 作为成员预设。

命令（最后一条的 `--roster-only` 参数在 PR 1.3 新增）：

```bash
npm run typecheck
```

```bash
npm run test
```

```bash
npm run build
```

```bash
npm run check:file-lines
```

```bash
node scripts/smoke-development-ade.cjs --roster-only
```

单元测试是用 `makeHarness` 跑原生 loop 的，覆盖不到"room 的准入门"和"main 进程 IPC 白名单"
这两道关；涉及 Code 对话和新路由的 PR 必须跑一次 Electron smoke。

---

## 9. 不在范围 / 待决问题

### 9.1 不在范围

以下内容各自单独出设计稿，都建立在本稿的名册之上：

- 完成判定：跑完不等于做成，需要自动判定、`exception` 状态，以及 continue / abandon / replan。
- 可分享的编排配方：放在 `.kun/playbooks/` 下，按名册 id 引用 Agent，编译成 Graph intent。
- 长程多轮编排：按轮推进，用 journal 和 backlog 交接，事后回滚越权写入。
- 对外协议：Kun 作为 ACP server；A2A 只放在宿主这一层。

### 9.2 待决问题（需要拍板）

1. **UI 用词。** "Agent" 指名册条目（推荐，见 4.6），还是继续指引擎？
   这会影响 Agent Center、派活卡片和设置页的标题。
2. **引擎绑定的默认值。** PR 1.6 是否默认打开 `honorEngineBinding`，还是一直保持手动开启？
3. **只读放行条件。** 只读条目在 `delegate_task` 上放行外部引擎，是否接受
   "引擎权限档位映射到只读"这个条件？还是要求引擎必须自带沙箱？
4. **`custom_agent` 能否绑定引擎。** 推荐不能，保持"一次性角色只继承主会话路由"。
5. **学习表并入的时机。** 推荐等完成判定上线、有了可靠的证据之后再做阶段 3。
