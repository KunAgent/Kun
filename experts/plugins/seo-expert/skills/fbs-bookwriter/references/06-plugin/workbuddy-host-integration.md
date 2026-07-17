# WorkBuddy 宿主集成说明（最小契约）

> **版本**：2.1.2  
> **受众**：WorkBuddy 宿主 / 插件加载器实现方  

## 1. 会话启动时必须可调用的脚本（与 `workbuddy/channel-manifest.json` → `entry` 对齐）

| 键 | 路径 | 用途 |
|----|------|------|
| `hostCapability` | `scripts/host-capability-detect.mjs` | 探测 `~/.workbuddy`、Tier1 技能目录、插件；写 `.fbs/host-capability.json` |
| `intakeRouter` | `scripts/intake-router.mjs` | 首响路由、恢复优先、输出 JSON 动作列表 |
| `sessionSnapshot` | `scripts/workbuddy-session-snapshot.mjs` | 生成/刷新恢复卡 |
| `profileBridge` | `scripts/workbuddy-user-profile-bridge.mjs` | 宿主画像 → 开场协议 |
| `presentationConsumer` | `scripts/host-consume-presentation.mjs` | 解析交付预览；返回 `hostAction`，**不自动打开 UI** |
| `feedbackBridge` | `scripts/release-feedback-bridge.mjs` | 组织反馈可选 |

**建议调用顺序**：新会话 → `host-capability-detect`（或依赖缓存）→ `intake-router --intent auto --json` → 模型按输出执行。仅挂载 skill 文本而不执行上述脚本时，**功能会显著降级**。

### 1.0 用户可见区与注入物（机读：`fbs-runtime-hints.json` → **`hostPresentation`**）

> 与两轮 WorkBuddy 实测对齐：**用户面对的是服务，不是开发文档**。

**默认行为（建议作为宿主默认实现）**

| 区域 | 内容 |
|------|------|
| **主对话 / 用户消息区** | 仅 `intake-router` JSON → `firstResponseContext.userFacingOneLiner`（一行）+ **≤3** 个主按钮/选项（与 `hostPresentation.maxPrimaryActionsInChat` 一致） |
| **技术处理提示（可选）** | 当宿主即将展示可见技术处理时，优先使用 `firstResponseContext.userVisibleTechActionNarration`（先解释“为什么做 + 对写作价值”） |
| **健康提示（可选）** | 当 `runtime.healthMatrix.overallSeverity != "healthy"` 时，可在主对话区追加 `firstResponseContext.healthUserHint` 一行人话提示（不展示内部字段） |
| **开发者 / 调试 / 折叠面板** | 完整 `intake-router` JSON、原始 `stdout`、可选 SKILL 片段 |
| **禁止** | 将 **SKILL.md 全文**、**完整 intake JSON**、`references/**` 长规范**默认注入**到用户可见对话流 |
| **禁止** | 将模型/编排层的**元指令**（如「按 v* 规范」「JSON 输出」「不重复读」「干净首屏」）与主对话气泡混排；此类内容仅应留在折叠「过程/调试」或系统日志 |

**其它**

- **list_dir `.fbs/`**：默认不要做；用户明确要看目录结构或排障时再扫（`hostPresentation.listDirFbsOnlyOnDemand`）。
- **书稿根边界**：Agent 默认只读写当前会话 **bookRoot**；无用户明示时**不要**读取工作区内其他书稿/白皮书工程路径（防多项目漂移）。
- **退出**：见 §1.1；执行 `session-exit` 前须有软确认（见 JSON `agentGuidance.beforeExit`）。

**实现检查清单（产品侧自验）**

1. 新会话首条用户可见内容是否 **≤1 行摘要 + 3 动作**，且无整页 JSON。  
2. 若健康矩阵降级，是否仅追加 **1 行** `healthUserHint`（不含脚本名、字段名、Tier 名）。  
3. 退出路径是否先确认再调用 `sessionExit`。

### 执行与安全边界（终端用户可见）

- 技能包脚本在**用户信任的书稿根**下读写与执行约定命令；**不等于**操作系统级沙箱隔离（与通用 Agent Harness 的本地模式风险模型类似）。
- **勿**在未鉴权网络或公网暴露具备「任意读写书稿 / 执行宿主命令」能力的入口；生产环境应通过反向代理、鉴权与网络隔离收敛暴露面。
- 机读摘要：`fbs-runtime-hints.json` → `executionSafety.userVisiblePrinciplesZh`；宿主可在「关于 / 安全说明」折叠区引用，**勿**与主对话气泡混排。

### 渠道与会话默认（集中配置）

- 默认策略集中在 `fbs-runtime-hints.json` → **`channelSessionDefaults`**（如 `recursionLimit`、`defaultIntakeFast`、`subagentOrWorkerTasksDefault` 等）。
- 宿主（企微 / 飞书 / WorkBuddy）宜在**会话级**覆盖：未覆盖时采用 `intake-router --json` 顶层 **`skillRuntimeHints.channelSessionDefaults`** 与首响 **`firstResponseContext.channelSessionDefaults`** 的并集语义（以后者为用户可见会话实例）。
- 长任务 / worker 契约见 `references/05-ops/fbs-subtask-contract.md`；机读锚点：`skillRuntimeHints.subTaskContract`、`firstResponseContext.subTaskDecompositionContract`。

### 1.0.1 宿主消费示例（伪代码）

```javascript
// 输入：intake-router --json 的完整对象 result
const oneLiner = result?.firstResponseContext?.userFacingOneLiner ?? "";
const blockedHint = result?.firstResponseContext?.blockedDecisionHint ?? "";
const primaryOptions = (result?.firstResponseContext?.openingGuidance?.primaryOptionsHint ?? []).slice(0, 3);
const secondaryOptions = result?.firstResponseContext?.maintenanceSecondaryOptionsHint ?? [];
const techNarration = result?.firstResponseContext?.userVisibleTechActionNarration ?? null;
const actionSelectionPolicy = result?.firstResponseContext?.actionSelectionPolicy ?? null;
const dangerousPolicy = result?.firstResponseContext?.dangerousOperationPolicy ?? null;
const clarifyContracts = result?.firstResponseContext?.clarifyContracts ?? null;

// 契约字段来自 fbs-runtime-hints.json -> hostPresentation
const health = result?.runtime?.healthMatrix;
const healthHint = result?.firstResponseContext?.healthUserHint ?? "";
const needHealthHint = health?.overallSeverity && health.overallSeverity !== "healthy";

renderChat(oneLiner);                  // 主对话区第 1 行
if (blockedHint) renderChat(blockedHint); // 阻断时追加 1 行决策提示
if (needHealthHint && healthHint) {
  renderChat(healthHint);              // 仅追加 1 行人话健康提示
}
renderPrimaryActions(primaryOptions);  // 主按钮最多 3 个（写作优先）
renderSecondaryActions(secondaryOptions); // 二级入口：质检/素材/修复
// 可选：actions 列表使用 goalImpact 做分组展示（不要直接替代主按钮）
const grouped = groupBy((result?.actions ?? []), (x) => x.goalImpact ?? "maintenance");

// 若要执行用户可见技术处理，先解释“原因 + 价值”
if (techNarration) {
  renderSystemHint(techNarration.beforeAction);
}
if (dangerousPolicy?.highRisk === "confirm") {
  bindDangerousActionConfirmDialog();
}
if (clarifyContracts?.qualityScope) {
  bindQualityScopeOptions(clarifyContracts.qualityScope.options);
}

// 完整 JSON / 调试字段进折叠面板，不进主对话区
renderDebugPanel(result);
```

### 1.0.2 TypeScript 最小类型（可直接复用）

```ts
type HealthSeverity = "healthy" | "warn" | "critical";

interface IntakeHealthCheckItem {
  id: string;
  ok: boolean;
  status: "ok" | "degraded";
  severity: "info" | "warn" | "critical";
  detail: string;
  meta?: Record<string, unknown>;
}

interface IntakeHealthMatrix {
  summary: string;
  overallSeverity: HealthSeverity;
  degradedCount: number;
  userHint: string;
  checks: IntakeHealthCheckItem[];
  generatedAt: string;
}

interface IntakeFirstResponseContext {
  userFacingOneLiner: string;
  blockedDecisionHint?: string;
  openingGuidance?: {
    primaryOptionsHint?: string[];
  };
  maintenanceSecondaryOptionsHint?: string[];
  userVisibleTechActionNarration?: {
    beforeAction?: string;
    inProgress?: string;
    afterSuccess?: string;
    afterFallback?: string;
  };
  actionSelectionPolicy?: {
    primaryUserGoal?: "writing" | "quality" | "maintenance";
    primaryOptionsSource?: string;
    secondaryOptionsSource?: string;
    hideNonWritingFromPrimary?: boolean;
  };
  dangerousOperationPolicy?: {
    strategy?: "dual-track";
    lowRisk?: "auto";
    highRisk?: "confirm";
    denyExamples?: string[];
    policyScript?: string;
  };
  clarifyContracts?: {
    qualityScope?: {
      question?: string;
      options?: Array<{ id: string; label: string }>;
      defaultOptionId?: string;
    };
    rewriteEntry?: {
      question?: string;
      options?: Array<{ id: string; label: string }>;
      defaultOptionId?: string;
    };
  };
  promptLayerCacheContract?: {
    enabled?: boolean;
    layers?: string[];
    invalidateWhen?: string[];
  };
  healthUserHint?: string;
}

interface IntakeAction {
  step: number;
  label: string;
  goalImpact?: "writing" | "quality" | "maintenance";
  priorityTier?: "primary" | "secondary";
  required?: boolean;
  cmd?: string | null;
  action?: string | null;
}

interface IntakeRouterResult {
  runtime?: {
    healthMatrix?: IntakeHealthMatrix;
  };
  firstResponseContext?: IntakeFirstResponseContext;
  actions?: IntakeAction[]; // 供 Agent/编排执行，不作为用户主按钮来源
}
```

## 1.1 退出（session-exit）调用约束（P0）

用户说「退出 / 停止 / 退出福帮手」时，宿主或自动化须执行 `entry.sessionExit` 指向的脚本以写入 `.fbs/workbuddy-resume.json` 与摘要。

- **必须**传入 `--book-root <书稿根目录绝对路径>`。本脚本**不再**默认把 `process.cwd()` 当作书根。
- **禁止**在「仅切换到书稿目录」后使用相对路径 `node scripts/session-exit.mjs`：Node 会把入口解析为「书稿根下的 `scripts/session-exit.mjs`」，该路径不存在，报错类似 `Cannot find module '…<书稿根>\\scripts\\session-exit.mjs'`。
- **推荐**其一：
  - 使用技能安装目录内脚本的**绝对路径**调用 `session-exit.mjs`；
  - 或在**技能包根目录**下执行：  
    `node scripts/fbs-cli-bridge.mjs exit -- --book-root <书稿根绝对路径> --json`  
    （`fbs-cli-bridge` 会固定解析到本包内的 `session-exit.mjs`。）

乐包与行为激励说明见 [`../05-ops/credits-guide.md`](../05-ops/credits-guide.md)。

### 1.2 写作类任务：并行度、子智能体与写入截断（与技能包协同）

> **对应技能包**：`references/01-core/s3-expansion-phase.md`、`search-policy.json` → `expansionS35`、`references/05-ops/agent-task-strategy.md`。

| 领域 | 建议宿主默认 | 说明 |
|------|--------------|------|
| **并行扩写章节数** | **≤2** | 技能包已按此约束；若编排器默认更高，易引发风格分叉与半篇覆盖。 |
| **正文写作 Subagent** | 使用写作类角色；**勿**将 `code-explorer` / 纯检索类 subagent 默认用于改稿 | 复盘 2026-04-14：误用检索类 subagent 导致无写作质检链。 |
| **单次写入 / token** | 若模型输出被截断仍报成功，须视为 **宿主缺陷** 或与技能包协同展示「可能不完整」 | 技能包侧以 `expansion-word-verify` 实测长度兜底，避免虚报字数。 |
| **取消并行任务** | 取消后暴露「已写入路径列表」，便于用户 diff | 技能包约定：`.expanded.md` 临时稿 → 验证后再替换正式稿。 |

**工单跟踪（宿主团队）**：将「默认并行写作 ≤2」纳入编排器配置项，并与 FBS `expansionS35.maxParallelChapters` 对齐。

## 2. CodeBuddy 通道

`codebuddy/channel-manifest.json` 的 `entry` 与 WorkBuddy **对齐同一套脚本路径**，便于双通道宿主复用集成逻辑。

## 3. 结果展示

宿主必须在适当时机调用返回体中的 `preview_url` / `open_result_view`；`host-consume-presentation.mjs` 的 JSON 中含 `hostIntegrationNote` 字段说明此点。

## 4. 相关文件

- 发布核验清单：[`../../releases/workbuddy-integration-checklist.md`](../../releases/workbuddy-integration-checklist.md)  
- Tier1 与仓库快照：[`tier1-marketplace-faq.md`](./tier1-marketplace-faq.md)  
- 交付链与 Tier2 插件顺序：[`../05-ops/workbuddy-delivery-tier2.md`](../05-ops/workbuddy-delivery-tier2.md)  
- 宿主 qc 与 FBS 报告落盘：[`../05-ops/host-qc-and-fbs-reports.md`](../05-ops/host-qc-and-fbs-reports.md)  
- 运行时提示（可选读取）：[`../../fbs-runtime-hints.json`](../../fbs-runtime-hints.json)  

**`intake-router --json` 扩展（调试/编排侧可折叠展示）**：`firstResponseContext` 含 `historicalBookShortcuts`、`capabilityRefresh`、`deliveryAndPreview`、`searchStrategyHints`、`memoryDirectoryNudge`、`teamOrchestrationHint`、`healthUserHint`、`channelSessionDefaults`、`subTaskDecompositionContract`、`executionSafetyBrief`、`userValueSnapshot`（价值一句话+要点，新会话或恢复信息薄时 `showAsSecondaryLine`）、`stallPreventionUserHint`（体量黄/红区时的人话一句）、`versionObservability`（运行版本/目标版本/数据兼容状态）；当执行全量质检后，结果对象含 `bookQualityConclusion`（终稿/单章汇总结论、不可比说明、下一步建议）；`runtime.healthMatrix` 含分级检查项（含 **`file-growth`**），`runtime.hostKpiSignals` 提供恢复/路由/展示/升级提示的机读信号；顶层含 `skillRuntimeHints`（含 `channelSessionDefaults`、`subTaskContract`、`executionSafety`、`performanceUx`）。**主对话区仍以 `userFacingOneLiner` + ≤3 主选项为准**；价值快照与健康/体量提示放副行或折叠，勿堆成整页 JSON。

## 5. 宿主系统级记忆（create / update / delete）

若宿主向模型暴露**系统级记忆**能力，建议与福帮手约定如下语义（具体工具名以实现为准）：

| 操作 | 说明 |
|------|------|
| **create** | 创建新记忆。 |
| **update** | 更新已有记忆，**调用方须提供宿主分配的记忆 ID**。 |
| **delete** | 删除记忆；适用于用户**明确推翻**先前已写入宿主的信息。 |

福帮手侧：**书稿长篇真值**仍以 `书稿根/.fbs/` 内文件为准；宿主记忆宜承载**短摘要、可检索条目**，并在 `update` 时保证 ID 传递闭环。详细执行契约见 [`../01-core/runtime-mandatory-contract.md`](../01-core/runtime-mandatory-contract.md) §5。

## 6. 对用户话术与日志（Tier / 探测字段）

- **日志与 API 响应**可保留原始字段名（如 Tier、脚本路径），便于排障与自动化。  
- **展示给终端用户的文案**应脱敏：不把 Tier、内部模块名、脚本文件名**原样**抛给用户；口语化转述见 [`../05-ops/ux-agent-playbook.md`](../05-ops/ux-agent-playbook.md) §6 对照表。  
- **例外**：用户为开发者且主动索要「原始 JSON / 日志」时，可提供，并标注为调试信息。
