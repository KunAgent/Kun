# Kun ADE 计划总览

- 日期：2026-09-25
- 基线：`develop@0cd036104`
- 状态：计划，未实施
- 参考项目（只作为设计输入；下文分别简称"终端编排台"、"连接层产品"、"多 agent 控制台"）：
  - 终端编排台：`github.com/stablyai/orca`（`122b8c25`），终端优先的多 agent 编排台
  - 连接层产品：`/Users/zxy/codeproject/ds_project/cindy`（`e70e335b2`），多 harness 连接层 + Lead/Worker 协同
  - 多 agent 控制台：`github.com/getpaseo/paseo`（`e3c853d`），UI 设计参考
- 实现约束：参考项目只作为设计输入。**源码、文件名、类名、注释、i18n 键里都不要出现参考项目的名字**，按 Kun 自己的语义命名（harness、worker、dispatch、activity、task workspace 等）。

---

## 1. 目标

新增一个独立的 **ADE 模式**（Agentic Development Environment），与 Work、Code、Bot 并列（2026-09-26 决策，见 [00-ade-mode.md](./00-ade-mode.md)）。Code 模式保持不变。ADE 模式里有两种使用方式，共用一个底座：

1. **一对一**：用户直接和某一个 agent 对话。这个 agent 可以是 Kun 原生 agent，也可以是 Claude Code、Codex、Gemini CLI、Cursor 等外部 agent。
2. **总管模式**：用户对 Kun 原生 agent（总管）说话，总管负责拆任务、选 agent、派活、盯进度、验收、汇报；每个 worker 可以是任意 agent，各自在一个由宿主创建的 worktree 里工作。

两种模式可以互转：一对一的会话可以被总管收编成 worker；任何 worker 也可以被用户点开接管、一对一继续。

## 2. 差异化：总管是宿主自己的 loop

参考项目都支持"一个 agent 管其他 agent"，但总管都是外部 agent，靠 prompt、skill 或 MCP 工具去约束它：

| | 总管 | 约束方式 |
| --- | --- | --- |
| 终端编排台 | 任意外部 agent，通过 CLI 派活 | skill 文档 + worker 自己记得调用完成命令 |
| 连接层产品 | Claude Code / Codex / Pi 会话，通过 MCP 派活 | prompt + 工具 handler 校验，文档里有大量约束外部 lead 行为的不变量 |
| 多 agent 控制台 | 外部 agent，通过 MCP 或 CLI 派活 | 同上 |
| **Kun** | **Kun 原生 loop** | **宿主代码** |

Kun 的结构性优势：

- **完成判定不靠 worker 自觉**：外部 worker 的一轮就是 `DelegatedTurnRuntime.runTurn()`，宿主天然知道它何时结束、结果如何。
- **别家写进 prompt 的规则，Kun 写成代码**：派单幂等、只在真实派发后结束总管的 turn、权限不扩大、完成不等于通过，都在宿主里强制。
- **成本结构不同**：总管可以跑在便宜的 DeepSeek 上，worker 用 Claude / ChatGPT 订阅干重活。
- **总管掌握全局**：记忆、Graph、Rooms、手机和 IM 入口、定时任务都在 Kun 手里。

## 3. 现状基线（已经有的）

| 能力 | 位置 | ADE 中的用途 |
| --- | --- | --- |
| 外部 agent 接管整轮 turn | `kun/src/runtime/delegated-turn-runtime.ts` | 所有外部 harness 的统一入口 |
| Claude SDK / Cursor SDK / Antigravity CLI 适配器 | `kun/src/runtime/{agent-sdk,cursor,antigravity}/` | 首批深度 harness |
| 原生会话绑定（native / portable） | `kun/src/runtime/delegated-session-binding.ts` | harness 会话续接、停泊会话 |
| 历史回放 transcript | `kun/src/runtime/agent-sdk/sdk-context-assembler.ts` | 被确定性交接替换 |
| 能力事件 `delegated_runtime` | `kun/src/contracts/events.ts:497` | 升级为能力声明 v2 |
| 子代理执行（可跑在外部 agent 上） | `kun/src/delegation/child-agent-executor.ts:265` | worker 执行底座 |
| 子代理路由（BM25 + 小模型） | `kun/src/delegation/subagent-router.ts` | 扩展为 角色 × harness × 模型 |
| Graph（lead / worker / review / integration） | `kun/src/graph/` | 总管的结构化形态 |
| Graph 宿主 worktree 与合入 | `kun/src/graph/graph-write-coordinator.ts` | 抽成通用任务工作区服务 |
| 后台子任务完成后唤醒父线程 | `kun/src/delegation/delegation-detached-handoff.ts` | worker 完成后唤醒总管 |
| 线程活动游标与长轮询 | `kun/src/services/thread-activity-registry.ts` | 单一状态存储的模板 |
| 本地模型网关（chat / responses） | `kun/src/server/routes/openai-model-gateway.ts` | harness × 模型协议桥 |
| 订阅额度服务 | `kun/src/services/provider-quota-service*.ts` | 额度感知的 worker 选择 |
| 外部会话历史引用 | `kun/src/history/`、`/v1/history-sources/*` | 接续外部会话、交接检索 |
| turn 幂等键 `clientRequestId` | `kun/src/contracts/turns.ts:184` | 派单只投递一次 |
| Dev 浏览器元素拾取 | `src/renderer/src/components/DevBrowserContent.tsx` | 已有，不重复做 |
| 项目看板 | `src/renderer/src/project-board/` | Mission Control 的数据来源之一 |

## 4. 总体架构

```text
Renderer（React + Zustand）
  模式：Work / Code（不变）/ ADE（新）/ Bot
  ADE：Mission Control / 一对一会话 / 总管会话 / Workers 轨道 / 审查面板
      |  window.kunGui.runtimeRequest / startSse / activity 长轮询
      v
Preload -> Main（DesktopProcessStack、PTY、通知、Dock 角标）
      |  HTTP + SSE（唯一边界，GUI 不直接连外部 agent）
      v
kun serve
  ├─ HarnessRouter ──> 原生 AgentLoop（harness = kun）
  │                 └> DelegatedTurnRuntime
  │                      ├─ agent-sdk（Claude Code）
  │                      ├─ cursor-sdk
  │                      ├─ antigravity-cli
  │                      └─ acp（Gemini CLI、Codex adapter、OpenCode 等）
  ├─ Manager 控制面（worker_* 工具、DispatchStore、TeamStore）
  ├─ TaskWorkspaceService（worktree 创建、环境补齐、采集、合入、清理）
  ├─ ActivityStore（执行单元状态，唯一一份，所有读者订阅）
  ├─ HandoffAssembler（确定性交接简报）
  ├─ Worker 回调通道（Kun Tools MCP server、kun CLI 回调、hook ingest）
  └─ 模型网关（chat / responses / messages 入口，harness × 模型）
```

硬性边界：

- 外部 agent 只能以 kun 内部的 `DelegatedTurnRuntime` 身份进入。GUI 永远只和 `kun serve` 通信。
- 唯一例外是 0 档终端 agent：它的 PTY 在主进程（沿用现有终端），但状态必须经 hook ingest 写进 kun 的 ActivityStore，GUI 不自己推断状态。
- 设置只加在 `agents.kun` 下（`docs/AGENTS.md` 的既有规则）。

## 5. 核心术语

| 术语 | 含义 | 代码命名 |
| --- | --- | --- |
| Harness | 执行一轮对话的引擎：Kun 原生 loop 或某个外部 agent | `HarnessId`、`HarnessDefinition` |
| Harness 路由 | harness + provider + model 的组合 | `HarnessRoute` |
| 执行单元 | 一个可见、可管理的工作单元：worker、侧边对话、Graph 节点尝试 | `ExecutionUnit` |
| Worker | 总管派活的执行单元，是挂在总管线程下的侧边线程 | `WorkerRecord` |
| Team | 一个总管线程当前的 worker 集合 | `TeamRecord` |
| Dispatch | 一次派活，带唯一 dispatchId | `DispatchRecord` |
| 任务工作区 | 宿主为一个执行单元创建的工作目录（worktree 或普通目录） | `TaskWorkspace` |
| Activity 行 | 执行单元的当前状态，唯一真相 | `ActivityRow` |
| Verdict | 质量裁决，与执行状态正交 | `QualityVerdict` |
| 交接简报 | 代码确定性生成的上下文包 | `HandoffBrief` |

用户可见文案统一用：agent、worker、工作区、派活、待你处理、审查。不要在 UI 里出现 harness、dispatch、execution unit 这些内部词。

## 6. 文档地图

| 文件 | 内容 | 阶段 |
| --- | --- | --- |
| [00-ade-mode.md](./00-ade-mode.md) | ADE 作为独立模式：边界、线程归属 `workspaceMode`、界面结构、P0-17 模式外壳（**优先于其它文档**） | P0 |
| [01-harness-routing.md](./01-harness-routing.md) | Harness 概念、目录、检测、路由、设置 | P0 |
| [02-capabilities.md](./02-capabilities.md) | 能力声明 v2、准入矩阵、UI 降级契约 | P0 |
| [03-acp-runtime.md](./03-acp-runtime.md) | ACP 通用接入运行时 | P1 |
| [04-model-gateway-bridge.md](./04-model-gateway-bridge.md) | harness × 模型：网关协议桥 | P1 |
| [05-worker-callbacks.md](./05-worker-callbacks.md) | Kun Tools MCP server、CLI 回调、托管 hooks、终端 agent | P1–P2 |
| [06-activity-store.md](./06-activity-store.md) | 单一状态存储、三态生命周期、休眠 | P0 |
| [07-task-workspace.md](./07-task-workspace.md) | 宿主持有的任务工作区、环境补齐、采集与合入 | P0 |
| [08-handoff-context.md](./08-handoff-context.md) | 确定性交接、停泊会话、上下文读取授权 | P0 |
| [09-manager-control-plane.md](./09-manager-control-plane.md) | 总管控制面：team、worker、dispatch、唤醒、权限上限 | P1 |
| [10-worker-selection-quality.md](./10-worker-selection-quality.md) | worker 选择、额度感知、验收、交叉审查、赛马 | P1–P2 |
| [11-review-ship.md](./11-review-ship.md) | 审查闭环、批注回传、AI 行归属、提交与 PR | P1–P2 |
| [12-workbench-ui.md](./12-workbench-ui.md) | 工作台 UI：Mission Control、轨道、一对一、通知 | P1 |
| [13-governance-rollout.md](./13-governance-rollout.md) | 安全、测试、红线文档修改、开关、分阶段验收 | 全程 |
| [impl/](./impl/README.md) | **实施拆解**：按 PR 列出依赖、文件、函数级步骤、测试、验收；流程时序；契约汇总；2026-09-25 核对过的代码事实 | 全程 |

## 7. 阶段与里程碑

### P0：地基（总管能跑起来之前必须有的东西）

| 项 | 文档 | 验收 |
| --- | --- | --- |
| Harness 路由（向后兼容现有 provider kind） | 01 | 现有 Claude 订阅、Cursor、Antigravity 线程行为不变；新线程可显式指定 harness |
| 能力声明 v2 | 02 | 前端置灰原因来自 `CapabilityStatus.message`；准入矩阵在 kun 侧拒绝不满足的组合 |
| 单一状态存储 | 06 | 桌面侧栏、手机、`/v1/activity` 读到同一行；忽略一处，处处消失 |
| 任务工作区服务 | 07 | 宿主创建 worktree，环境补齐后交给执行单元；采集和合入复用 Graph 逻辑并通过原有测试 |
| 确定性交接 | 08 | 切换 harness 时注入确定性简报；新旧 harness 都能按需检索更早历史 |
| 权限上限 | 09 §7、13 §2 | 任何 worker 的有效权限都是总管快照与 profile 的交集；升到免审批必须宿主向用户确认 |

### P1：总管能派、能看、能判断

| 项 | 文档 | 验收 |
| --- | --- | --- |
| ACP 运行时 + 首批 2 个 ACP agent | 03 | 一个 Code 线程跑在 ACP agent 上，审批、diff、中断、用量正常 |
| 网关协议桥（messages 入口） | 04 | Claude Code harness 能以 DeepSeek 模型运行 |
| Kun Tools MCP server + worker 回调工具 | 05 | ACP / SDK worker 能调用 `ask_manager`、`report_progress` |
| 总管控制面 | 09 | 总管一次派 3 个 worker（3 种 harness），完成后被唤醒并汇总 |
| worker 选择 + 额度感知 + 验收 | 10 | 快用完额度的订阅不会被选中；验收结论独立于完成状态 |
| 审查闭环 | 11 | diff 批注批量回传给对应 worker 或总管 |
| Mission Control + 轨道 + 通知 | 12 | 看板分列正确，待你处理的项会通知 |

### P2：扩展面

- 0 档终端 agent + 托管 hooks + CLI 回调（05）
- 同题赛马、AI 行归属、PR 与 CI 视图（10、11）
- 外部会话一键接续（01 §8，复用现有 history-sources）
- Codex 深度适配（app-server 协议）、远程主机上的 worker（13 §8 待定项）

## 8. 需要拍板的决策

1. **agent 是否活过应用重启**：参考项目用常驻 PTY 守护进程做到了；Kun 现行规则是关窗即退出、停掉所有受管进程（`docs/AGENTS.md`）。本计划默认**不改**，把"长任务续跑"做成 worker 可恢复（resume）而不是进程常驻。详见 13 §7。
2. **总管默认模型**：建议默认用 `roles.smallModel` 之外的主模型，允许在设置中单独指定"总管模型"。详见 09 §2。
3. **一个线程能否中途换 harness**：允许，但交接用确定性简报，并在 UI 明确提示"换 agent = 新原生会话"。详见 08。
4. **worker 默认权限**：默认沿用总管当前权限档，不默认免审批。详见 09 §7。

## 9. 参考来源映射

| 设计点 | 来源 | 落在 |
| --- | --- | --- |
| 能力声明带不支持原因 | 连接层产品 | 02 |
| 权限档按从严到宽排序、无人值守回落最严 | 连接层产品 | 02 |
| harness × 模型协议桥 | 连接层产品 | 04 |
| 确定性交接、停泊会话 + 增量 | 连接层产品 | 08 |
| 执行单元三态、worker 两类生命周期 | 连接层产品 | 06、09 |
| 控制面工具集、派单两段式凭据 | 连接层产品 | 09 |
| 完成不等于通过 | 连接层产品 | 10 |
| 声明式 agent 目录、托管 hooks | 终端编排台 | 01、05 |
| 单一状态存储、主 agent 状态与折叠状态 | 终端编排台 | 06 |
| worktree 生命周期、环境补齐 | 终端编排台 | 07 |
| 派单防重（dispatchId）、群发地址 | 终端编排台 | 09 |
| 批量行级批注回传、AI 行归属、赛马 | 终端编排台 | 10、11 |
| 看板、通知、休眠 | 终端编排台 | 06、12 |
| 视觉原则、状态分组侧栏、composer 轨道、Explorer | 多 agent 控制台 | 12 |
| 关闭与归档分离、父 agent 收到子 agent 权限通知 | 多 agent 控制台 | 06、09 |
