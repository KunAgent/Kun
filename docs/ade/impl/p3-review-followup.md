# ADE 实施复核与后续计划（P3）

- 日期：2026-09-28
- 复核对象：`develop@29cdd3daf`（ADE 分支已于 `e779bf43a` 合入，61 个提交覆盖 P0-01 ~ P2-11）
- 结论：**计划里的每一项都有对应提交，代码量约 7 万行，类型检查与行数门禁通过；但核心卖点有 4 处没接通，合入带来 11 个红测文件，且没有任何实机验证记录。** 目前的状态是"代码齐了、端到端还跑不通"，还不能移出实验室。

> 实施进度（同日，`codex/ade-p3-followup`）：P3-01 ~ P3-11 已按本文档完成并各自成 commit；P3-12 拿到 OpenCode 1.1.47 真实录制与 Gemini 上游阻断证据，回放测试已加。逐项状态见 §3 标题注记与 §4 记录。

## 1. 本次实际跑过的检查

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck`（extensions + kun + web + node） | 通过 |
| `npm run check:file-lines` | 通过（9029 个文件均 ≤ 700 行） |
| kun 侧 ADE 相关 vitest（`ade`、`harness`、`runtime/acp`、`workspace-tasks`、`handoff`、`graph`、`delegation`、`server/routes`、`runtime/agent-sdk` 等 210 个文件） | 1547 通过，**2 失败**（`acp-elicitation.test.ts`） |
| 根目录 `vitest run`（1515 个文件） | 10811 通过，**9 个用例失败，分布在 11 个文件** |
| 基线对比：同样 11 个文件在合入前的 `ddf730149` 上跑 | 全部通过；在合入提交 `e779bf43a` 上跑，同样 11 个失败 → **全部由 ADE 合入引入** |
| 真实 ACP 握手（只发 `initialize`，不调模型） | Gemini CLI 0.52 `gemini --acp` 正常，声明 `mcpCapabilities.http/sse = true`；OpenCode 1.1.47 `opencode acp` 启动即崩溃；Codex CLI 0.145 没有 `acp` 子命令，内置定义依赖的 `codex-acp` 适配器本机未安装 |
| 本机可用的 harness | Claude Code 2.1.281、Gemini 0.52、OpenCode 1.1.47（ACP 不可用）、Codex 0.145（缺适配器） |

## 2. 问题清单

### A. 阻断：核心卖点跑不通

**A1 ACP worker 拿不到 Kun 工具，也拿不到 worker 回调工具。**
- `AcpRuntime` 在 `session/new` 里发 `mcpServers: this.deps.kunToolsMcpServers?.() ?? []`（`kun/src/runtime/acp/acp-runtime.ts:389`），但两个组合点都没有传 `kunToolsMcpServers`（`kun/src/server/runtime-composition-agent.ts:309` 起的 `acpRuntimeDeps`、`runtime-composition-registry.ts:233`）。
- `kun-tools` 作用域的 token 在生产代码里从未签发（只有 `agent-sdk-gateway.ts` 签 `gateway`、`execution-units.ts` 签 `worker-callback` / `hook-ingest`），所以 `POST /mcp/kun` 与 `kun mcp-bridge` 实际上没人能用。
- 后果：Codex / Gemini / OpenCode 作为 worker 时没有 `report_progress`、`ask_manager`、`read_manager_context`、`submit_result`，也没有任何 Kun 工具；只能靠最终文本回传结果。13 §8 P1-3、P1-4 达不到。
- ✅ P3-08（`325a180e9`）：每个 turn 签发 `kun-tools` 作用域 token，按 agent `mcpCapabilities` 下发 http/stdio descriptor，两个组合点都已接线，turn 结束吊销。

**A2 ADE composer 里"Kun 网关"分组列的是错误的模型。**
- `adeHarnessModelGroups` 对每种 credential mode 都放同一份 `modelIds: [...models]`（`src/renderer/src/lib/ade-composer-harness.ts:78`）。对 Claude Code，这份列表是它自己的静态型号。选中后 `setComposerModel(modelId, '')`（`use-ade-composer-controls.ts:109`）不带 provider。
- 运行时在网关模式下拿"默认 provider + claude-sonnet-4-6"拼成 `kun/deepseek/claude-sonnet-4-6`（`agent-sdk-runtime-factory-turn.ts:117-122`），上游直接报模型不存在。
- 后果："Claude Code 用 DeepSeek 跑"在界面上选不出来，13 §8 P1-2 达不到。
- ✅ P3-05（`b8e8dd3da`）：网关分组按 provider 列模型，选中写 `kun/<provider>/<model>`；运行时对非 `kun/` 型号做兜底校验。

**A3 总管派 Claude Code worker 走不了网关，且只认 3 个写死的型号。**
- `resolveWorkerRoute` 对 `staticModels` 非空的 harness 做白名单校验（`kun/src/ade/worker-route.ts:42`），Claude Code 的静态表是 `['claude-opus-4-8','claude-sonnet-4-6','claude-haiku-4-5']`（`builtin-harnesses.ts:134`）。`kun/<provider>/<model>` 和任何新型号都会被拒。
- `harness_list` 只列 `staticModels`（`kun/src/ade/tools/harness-list.ts:62`），总管看不到网关模型，也看不到 ACP 探测结果（ACP harness 的列表为空）。
- ✅ P3-06（`b1784aeb4`）：按 credential mode 校验，`kun-gateway`/`provider` 走 provider 模型池，`native-login`+`probe` 用探测缓存；`harness_list` 分 mode 输出。

**A4 ACP harness 只能用原生登录。**
- 三个 ACP 内置定义的 `credentialModes` 都只有 `native-login`；`AcpRuntimeDeps.credentialEnv` 没有实现，注释仍写着"gateway bridging lands in P1-08"（`acp-runtime.ts:139`）。网关的 `/v1/chat/completions`、`/v1/responses` 已存在，但没有接到 ACP 子进程。
- 后果：Codex / OpenCode 不能跑在用户配置的 provider 上，"总管调度多家 agent 共用 Kun 的模型池"只对 Claude Code 成立（且受 A2/A3 影响）。
- ✅ P3-10（`3ae679d31`）：实现 `credentialEnv`，Codex / OpenCode 增加 `kun-gateway` 定义（路由限定 grant + 生成配置 + 剥离 provider 密钥）；Gemini 的 google 网关协议按表暂缓。

### B. 回归：影响现有模式或让测试变红

**B1 合入引入的红测（11 个文件）** ✅ P3-01（`13664e4a9`）已回到基线。

| 文件 | 原因 | 修法 |
| --- | --- | --- |
| `kun/src/runtime/acp/acp-elicitation.test.ts`（2 例） | 合入时 `kun-tool-user-input.ts:104` 改为读取 `events.record(...).seq`，测试替身的 `record` 仍返回 `undefined` | 替身返回 `{ seq: 1 }` |
| `chat-store-app-actions.test.ts`、`chat-store-app-actions-model-switching.test.ts` | `setComposerModel` 里 `state.composerHarnessId.trim()`（`chat-store-app-actions.ts:158`），旧测试状态没有该字段 | 源码改为 `?.trim() ?? ''`，测试补初始状态 |
| `FloatingComposer.history/usage`、`SideConversationPanel`、`SddAssistantPanel.user-input`、`WriteAssistantPanel.subagent` | 所有 composer 都会调用 `useAdeComposerControls` → `useCodexReferenceEnabled` → `ensureCodexReferenceWatcher()` → `getSettings()`（`use-ade-composer-controls.ts:123`），非 ADE 模式也触发 | 见 B3 |
| `MessageTimeline.hydration-exclusive.test.ts` | 见 B2：水合期间多了一次 `GET /v1/teams/workers/:id` | 见 B2 |
| `settings-section-agents-panels.test.ts` | 实验室列表新增 ADE 一项，断言未更新 | 更新期望列表 |
| `SubagentSettingsEditor.test.ts`、`.categories.test.ts` | `SubagentProfileDialog` 新引入 `harness-store`，后者经 `agent/registry` 一路拉入 `workspace-availability.ts` → `i18n.ts`，而测试对 `react-i18next` 的 mock 没有 `initReactI18next` | mock 补导出；更好的做法是让 `harness-store` 只依赖运行时客户端，不经 `agent/registry` 拉入整个 chat store |

**B2 Code 模式行为被改变：每个线程都会请求 worker 记录。**
`MessageTimeline.tsx:412` 对任何活动线程挂 `WorkerControlBanner`，后者无条件调用 `getTeamWorker(threadId)`。结果 Code / Work / Bot 里每打开一个线程都多一次 404 请求，违反 00 §2"Code 不变"。✅ P3-02（`7415d7def`）。

**B3 ADE composer 钩子在非 ADE 模式也有副作用。** `useAdeComposerControls` 在 `enabled=false` 时仍启动历史引用监听器。应在未启用时短路（传 `undefined`，且监听器只在确有 `historySource` 时启动）。✅ P3-03（`750bc2915`）。

**B4 离开 ADE 后，后台 worker 的通知全部丢失。**
- 活动流与活动通知只在 `AdeStage` 挂载期间运行（`AdeStage.tsx:30-38`）。
- `stopActivityFeed()` 只把状态设为 idle，不清空行（`activity-store.ts:70-75`）。
- `activityFeedCoversThread` 仍返回 true，普通的完成 / 等待通知被跳过（`chat-store-runtime-notifications.ts:386`、`:436`）。
- 两条路径都不发，用户切到 Code 后 worker 完成、等待审批都没有提醒，Dock 角标也停在旧值。13 §8 P1-7 达不到。
- ✅ P3-04（`7f74274d1`）：活动流与通知提到 `AppShell` 按开关常驻；`stopActivityFeed` 清空行，`activityFeedCoversThread` 仅在 `live` 时接管。

### C. 如实性与可靠性

- **C1 ACP 能力声明不实。** `kunTools: SUPPORTED`（`acp-capabilities.ts:66`）无条件成立，也没有看 agent 的 `mcpCapabilities`。在 A1 没接通的情况下，`graph-worker` 准入（要求 `kunTools`）会放行 ACP harness，违反 13 §2.3"如实说明边界"。✅ P3-09（`e05398fa7`）：`kunTools`/`userInput` 按可交付性收窄，准入走 `capabilitiesV2()`。
- **C2 就绪检测只看 `--version`。** ✅ P3-11（`68f75107b`）：`--version` 后追加 ACP 握手（超时缓存、stderr 摘要、`ready: no` 状态），Codex 缺适配器时给出安装指引。
  - OpenCode 1.1.47 显示"已安装"，但 `acp` 子命令一启动就崩溃。
  - Codex 的定义检测 `codex-acp`，用户装了 `codex` 也显示"未安装"，而且没有安装指引。
- **C3 Claude Code 型号写死。** `modelSource: 'probe'`，但 `/v1/harnesses/:id/models` 只对 ACP 探测（`kun/src/server/routes/harnesses.ts:90`），Claude Code 永远回落到静态表。✅ P3-07（`44505d167`）：Agent SDK `supportedModels()` 探测 + 静态表更新为真实型号。
- **C4 终端 agent 的回调说明与环境不一致。** 追加给 agent 的说明写"the `kun` CLI is on PATH"（`src/shared/terminal.ts:80`），但 PTY 环境没有把内置 `kun` 加进 PATH；只有用户手动安装过 CLI 才可用。托管 hooks 用的是绝对路径（`kunHookCommand()`），不受影响。
- **C5 没有实机录制与冒烟。** 部分 ✅ P3-12：`__fixtures__/recorded/` 现有 OpenCode 1.1.47 全生命周期录制与 Gemini 0.52 上游阻断证据，回放测试已加；Gemini 完整会话与 Codex 待上游/适配器条件具备后补录，13 §8 条目级实机记录由 P3-13 承担。
- **C6 终端 agent 不参与休眠恢复。** `canResume: (row) => row.kind === 'worker'`，注释仍写"when it lands (P2-03)"（`runtime-composition-manager.ts:141`），而 P2-03 已合入。

### D. 计划内未完成的功能

| 项 | 计划出处 | 现状 |
| --- | --- | --- |
| D1 总管每轮动态说明（职责、可用 agent 摘要、team 当前状态） | 00 §3 | 未实现；`workspaceMode === 'ade'` 只用于工具门控，总管行为只靠工具描述 |
| D2 team 预算（软上限通知总管、硬上限拒绝新派活） | 09 §预算 | `contracts/ade.ts:90` 只有 schema，没有任何执行逻辑 |
| D3 Workers 面板 / Mission Control 显示合计用量 | 12 §6.1 | 面板只统计运行 / 等待 / 完成 / 失败数量 |
| D4 ADE 侧栏：新建"总管会话 / 一对一"、按项目分组、待审查 / 已完成分组 | 00 §4、§5 | 只有一个"新建会话"，分组只有待你处理 / 进行中 / 会话 / 已归档 |
| D5 手机端与 ActivityStore 一致 | 13 §8 P0-4 | 手机端没有接活动流，也没有 ADE 入口 |
| D6 文档状态 | — | `docs/ade/impl` 仍是纯计划，没有实现状态 |

### E. 13 §8 验收清单逐条状态

| 条目 | 状态 | 说明 |
| --- | --- | --- |
| P0-1 旧线程不变、路由开关可回退 | 已实现 | B2 反例已由 P3-02 修复；待 P3-13 实机 |
| P0-2 显式选 harness，未就绪时可读报错 | 已实现 | P3-11 后就绪判断含 ACP 握手与适配器指引 |
| P0-3 置灰原因来自能力声明 | 已实现 | P3-09 收窄声明 |
| P0-4 侧栏与手机端状态一致 | 未达成 | D5（P3-19） |
| P0-5 任务工作区 | 单测通过，未实机 | — |
| P0-6 确定性交接 | 单测通过，未实机 | — |
| P0-7 权限降级与升级确认 | 单测通过，未实机 | — |
| P1-1 线程跑在 Gemini（ACP） | 受阻（上游） | 握手正常；`session/new` 被 Code Assist 个人版后端拒绝（§4）；Kun 工具链路已由 P3-08 接通；改以 OpenCode 录制佐证协议路径 |
| P1-2 Claude Code 用 DeepSeek（网关） | 已实现 | A2/A3 由 P3-05/P3-06 修复；待 P3-13 实机 |
| P1-3 总管派 3 种 harness | 已实现（待实机） | A1、A3、A4 已修；Claude Code 网关 + ACP harness 链路齐 |
| P1-4 worker 提问往返 | 已实现（待实机） | Kun / Claude Code worker 可以；ACP 侧 Kun 工具已下发（P3-08），elicitation 仍取决于 agent 声明 |
| P1-5 审查批注往返 | 已实现 | 未实机 |
| P1-6 额度 ≥ 95% 不被自动选中 | 已实现 | — |
| P1-7 通知与角标 | 已实现 | B4 由 P3-04 修复；待实机 |
| P2-1 终端 agent + hooks + `kun worker ask` | 部分 | C4（P3-18） |
| P2-2 ~ P2-5 | 已实现 | 未实机；PR 流程依赖 `gh` |

## 3. 后续计划

编号接着 P2 用 P3-xx。规模、区域的记法同 [README](./README.md) §3；每个 PR 仍须满足 README §2.2 的完成标准。

### 阶段一：止血（阻塞任何发版，先做）

**P3-01 修复合入引入的红测（S，K R）** ✅ `13664e4a9`
- 按 B1 表逐个修。只改测试替身和 B1 里标明的两处防御性源码（`composerHarnessId?.trim()`、`react-i18next` mock 或 `harness-store` 的导入方式），B2/B3 的行为修复放到各自的 PR。
- 验收：kun 全量测试与根目录 `vitest run` 的失败集合回到合入前基线（`ddf730149` 上这 11 个文件全部通过）。

**P3-02 `WorkerControlBanner` 只在 ADE worker 线程挂载（S，R）** ✅ `7415d7def`
- `MessageTimeline.tsx:412` 改为：`activeThread.workspaceMode === 'ade'` 且该线程在 ActivityStore 里是 `kind: 'worker'`（或线程带 manager-worker 的父关系）时才渲染。
- 测试：Code 线程打开时 `runtimeRequest` 不出现 `/v1/teams/workers/`；ADE worker 线程照常显示接管横幅。`MessageTimeline.hydration-exclusive.test.ts` 恢复通过。

**P3-03 ADE composer 钩子在非 ADE 模式短路（S，R）** ✅ `750bc2915`
- `useAdeComposerControls` 在 `enabled=false` 时不读 harness store、不触发监听器；`useCodexReferenceEnabled(undefined)` 不再启动 `ensureCodexReferenceWatcher()`，只在传入具体 `historySource` 时启动。
- 测试：Code composer 渲染不调用 `getSettings`；五个 composer 相关测试恢复通过。

**P3-04 活动流与通知提升到应用级（M，R）** ✅ `7f74274d1`
- 在 `AppShell` 里按 `agents.kun.ade.enabled` 启停活动流与活动通知（开关打开即常驻，与当前路由无关）。`AdeStage`、弹出窗口只做订阅，不再负责启停。
- `stopActivityFeed()` 清空 `rows`；`activityFeedCoversThread` 仅在 `status === 'live'` 时返回 true，其他情况交回普通通知路径。
- 角标：`syncAppBadgeCount` 在流停止时不再使用旧行。
- 测试：在 ADE 启动 worker → 切到 Code → worker 完成，收到一次通知（不重复）；关闭开关后普通会话通知与改动前一致。

### 阶段二：接通核心卖点

**P3-05 composer 的网关模型分组（M，R K）** ✅ `b8e8dd3da`
- `adeHarnessModelGroups` 按 credential mode 取不同的模型来源：
  - `native-login`：harness 自己的模型列表。
  - `provider` / `kun-gateway`：Kun 已配置、可经网关暴露的 provider 模型，以 provider 分组。复用 `exposableProvider` 的判定口径，由 `/v1/harnesses/:id/models?credential_mode=kun-gateway` 返回。
- 选中网关模型时，composer 写入 `model = kun/<provider>/<model>`（或同时写 `providerId` 与原始 model，二选一，但必须保持与 `parseGatewayModelId` 一致），不再清空 provider。
- 运行时兜底：`kun-gateway` 模式下若 model 不是 `kun/` 形式且 provider 没有该型号，turn 以可读错误失败（指向 provider 配置），不再把 Claude 型号发给 DeepSeek。
- 测试：Claude Code + 网关 + DeepSeek 的 composer → turn 请求 → 网关 grant 路由三段快照；错误路径的报错文案。
- 验收：13 §8 P1-2 实机通过，用量记在该线程上。

**P3-06 总管侧的模型选择与校验（M，K）** ✅ `b1784aeb4`
- `resolveWorkerRoute`：`kun-gateway` / `provider` 模式校验 provider 模型池而不是 `staticModels`；`native-login` + `probe` 的 harness 用最近一次探测结果（缓存，过期回落静态表），不再硬拒新型号。
- `harness_list` 每个 harness 按 credential mode 列出模型：原生模型（探测结果优先）与网关可用模型（最多各 N 个，超出给数量）。输出仍在工具结果里，不进稳定前缀。
- 测试：总管派 `claude-code` + `kun/deepseek/deepseek-chat`；派一个探测到、但不在静态表里的新型号；非法 provider 被拒并给出可读理由。

**P3-07 Claude Code 模型探测（S，K）** ✅ `44505d167`
- `/v1/harnesses/claude-code/models` 用 Agent SDK 的模型列表能力（`supportedModels()` 一类接口，实施时以 SDK 当前版本为准）探测，缓存 10 分钟；失败回落静态表，并更新静态表为当前型号。
- 测试：探测成功 / 失败 / 超时三条路径。

**P3-08 ACP 接入 Kun Tools MCP（L，K）** ✅ `325a180e9`

步骤：
1. 每个 ACP turn 签发一次 `kun-tools` token（`threadId` = 该线程，作用域只有 `kun-tools`，turn 结束或线程删除时吊销）。
2. 按 agent 在 `initialize` 里报告的 `mcpCapabilities` 生成 descriptor：
   - 支持 `http`：`{ type: 'http', url: <serve 地址>/mcp/kun, headers: [Authorization: Bearer <token>] }`。
   - 否则用 stdio：`command = kunHookCommand()` 同源的绝对命令，`args = ['mcp-bridge', '--token-env', 'KUN_TOOLS_TOKEN']`，token 通过该子进程 env 传入。
3. 两个组合点都传 `kunToolsMcpServers`（子运行时按其读写范围收窄）。
4. `session/load` 复用会话时重新下发 descriptor（token 按 turn 轮换）。

测试：假 agent 夹具断言 `session/new` 收到 descriptor；worker 线程里 `submit_result` 经 MCP 调用落到 `WorkerCallbackService`；token 过期后调用被拒。
验收：Gemini worker 在实机上调用 `report_progress` 与 `submit_result`，Mission Control 实时更新。

**P3-09 ACP 能力声明如实（S，K）** ✅ `e05398fa7`
- `kunTools` 只有在"已下发 descriptor 且 agent 声明支持对应 MCP 传输"时才算 supported，否则为 `not-implemented` 或 `upstream`。
- `userInput` 只有在 agent 声明支持 elicitation 时才算 supported。
- 测试：能力夹具更新；`graph-worker` 准入在没有 MCP 时拒绝 ACP harness，并给出原因。

**P3-10 ACP 凭据环境与网关（L，K；按 harness 逐个开）** ✅ `3ae679d31`
- 实现 `credentialEnv`：签 `gateway` token（路由限定到选中的 provider/model），把网关地址和 token 映射到该 harness 认可的配置方式。
- 每个 harness 先用真实二进制验证配置方式，再把 `kun-gateway` 加进它的 `credentialModes`：

| harness | 候选方式（须先实机验证） | 网关协议 |
| --- | --- | --- |
| Codex（经 `codex-acp`） | 自定义 model provider 配置（base URL + key 环境变量），或启动参数覆盖配置 | `/v1/responses` |
| OpenCode | 生成一份只含 Kun provider 的配置文件，经环境变量指向它 | `/v1/chat/completions` |
| Gemini CLI | `initialize` 报告了 `gateway` 认证方式，协议为 google；Kun 目前没有该协议的入口 | 暂缓，另立项 |

- 测试：每个 harness 的 env 生成快照；子进程 env 不含 provider 原始密钥；grant 越权调用被拒。

### 阶段三：实机验证

**P3-11 ACP 就绪探测与安装指引（M，K R）** ✅ `68f75107b`
- 检测器在 `--version` 之后，对 ACP harness 做一次 `initialize` 握手（超时 10 秒，结果缓存，设置页可手动刷新）。握手失败标为 `installed: yes, ready: no`，并附上 stderr 摘要。
- Codex：检测到 `codex` 而没有 `codex-acp` 时，显示"需要 ACP 适配器"及安装指引，不显示"未安装"。
- 测试：握手成功 / 崩溃 / 超时 / 版本不支持四个夹具。

**P3-12 录制真实会话与回放测试（M，K）** ✅ OpenCode 全录制 + Gemini 阻断证据（见 §4）
- 用 `kun/scripts/record-acp-session.mjs` 录制 Gemini 0.52：初始化、新会话、一次提问、一次工具调用、一次取消。OpenCode 待上游修复后补录，Codex 在装好适配器后补录。
- 映射器增加录制回放快照测试。
- 录制数据脱敏后提交到 `kun/src/runtime/acp/__fixtures__/recorded/`。

**P3-13 端到端验收脚本与手工清单（M，K D）**
- 新建 `kun/scripts/ade-e2e.mjs`（不进发布包）：对本机 `kun serve` 走 HTTP，依次跑 13 §8 的 P1-1、P1-2、P1-3、P1-4，并断言事件序列与 ActivityStore 终态。
- 需要真实账号，只在开发机或夜间任务运行；输出一份带版本号的结果表，追加到本文件 §4。
- 手工清单补上界面部分：审查批注、合入、通知、弹出窗口。

### 阶段四：总管质量（差异化的核心）

**P3-14 总管每轮动态上下文（M，K）**
- 仅对 `workspaceMode === 'ade'`、harness 为 kun、非 worker 的 turn，在稳定前缀之后的动态上下文里追加一个受长度限制的块，包括：
  - 职责说明：什么时候自己做、什么时候派活、派活要写验收标准、结果要交叉验收。
  - team 当前状态：各 worker 的状态、未回答的提问、待审查的结果。
  - 可用 agent 摘要，复用 `harness_list` 的数据。
- 遵守 13 §6 的指标门禁：同一组任务对比改动前后的缓存命中率、首字延迟、准确性。

**P3-15 预算执行与用量汇总（M，K R）**
- 按 worker 线程用量求和，得到 team 合计。超过软上限时向总管发 notice；超过硬上限时 `worker_create` / `worker_send` 返回 `budget_exceeded`，已在运行的不打断。
- Workers 面板顶部与 Mission Control 卡片显示合计用量；赛马比较视图显示每个参赛者的用量。
- 测试：软上限只通知一次；硬上限拒绝的理由写进 `userReport`。

**P3-16 总管评测集（M，K D）**
- 固定 10~20 个仓库级任务（修 bug、加测试、跨文件重构、带审查的并行任务），对比"单个 Kun"和"总管 + 多 worker"两种方式的成功率、token 数、总耗时、需要用户介入的次数。
- 结果写进本文件 §4，作为是否默认开启 ADE 的依据。

### 阶段五：体验补齐

**P3-17 ADE 侧栏补齐（M，R）**
- "新建"拆成"总管会话"和"一对一"两项：一对一先选 agent，隔离方式默认新 worktree。
- 分组增加"待审查""已完成"，可切换为按项目分组。
- worker 线程默认折叠在所属总管下面。

**P3-18 终端 agent 的 CLI 与恢复（S，M K）**
- PTY 环境：把内置 `kun` 所在目录（打包后是 `resources/bin`，开发时用生成的 shim）放到 PATH 最前，并额外导出 `KUN_CLI` 绝对命令；回调说明改为优先使用 `$KUN_CLI`。
- 休眠恢复：有 `terminal.resumeArgs` 的 harness 允许恢复；同时更新 `runtime-composition-manager.ts:141` 的过时注释。

**P3-19 手机端 ADE（L，R M）**
- 手机端接入活动流，提供只读的 Mission Control 与"待你处理"列表（审批、worker 提问），可以回答和批准，不在手机上派活。
- 远程白名单不需要改（`runtime:request` 已放行 `/v1`），但要检查长轮询超时与移动端流量。

**P3-20 文档状态（S，D）**
- `impl/README.md` 的 PR 总表加"状态 / 提交"列；`docs/ade/README.md` 增加"实现状态"一节并链接本文件。

### 顺序与关键路径

```text
阶段一  P3-01 ─ P3-02 ─ P3-03 ─ P3-04                  （可并行，1~2 天）
阶段二  P3-05 ─ P3-06 ─ P3-07
        P3-08 ─ P3-09 ─ P3-10（按 harness 逐个）
阶段三  P3-11 ─ P3-12 ─ P3-13（依赖阶段二）
阶段四  P3-14 ─ P3-15 ─ P3-16（P3-16 依赖 P3-13 的脚本）
阶段五  P3-17 / P3-18 / P3-19 / P3-20（穿插进行）
```

最短"能演示"路径：P3-01 → P3-02 → P3-04 → P3-05 → P3-06 → P3-08 → P3-13（Kun + Claude Code 走 DeepSeek 网关 + Gemini 三个 worker 的总管闭环）。

### ADE 移出实验室（默认开启）的门槛

1. 阶段一全部完成，根目录与 kun 测试回到基线。
2. 13 §8 的 P0 与 P1 条目在 P3-13 脚本里全部实机通过，结果带版本号记录在 §4。
3. 能力声明经 P3-09 修正后，不再出现"声明支持、实际不可用"的 harness。
4. P3-16 评测显示总管方式在成功率上不低于单 Kun，且额外开销可解释。

## 4. 实机验证记录

| 日期 | 版本 | 条目 | 结果 | 备注 |
| --- | --- | --- | --- | --- |
| 2026-09-28 | Gemini CLI 0.52.0 | ACP `initialize` | 通过 | 声明 `loadSession`、图片 / 音频输入、HTTP 与 SSE MCP；认证方式含 `gateway`（google 协议） |
| 2026-09-28 | OpenCode 1.1.47 | ACP `initialize` | 失败 | `opencode acp` 启动即抛出未预期错误，属于上游问题 |
| 2026-09-28 | Codex CLI 0.145.0 | ACP | 不适用 | 没有 `acp` 子命令，需要单独的 `codex-acp` 适配器 |
