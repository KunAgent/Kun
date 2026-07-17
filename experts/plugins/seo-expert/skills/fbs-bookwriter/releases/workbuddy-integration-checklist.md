# WorkBuddy 审核 / 集成检查清单（FBS-BookWriter v2.1.2）

用于发布前核对：**技能包完整性、宿主最小集成、体验契约**。

## 发布包与单测说明

- **Marketplace ZIP** 为体积与合规考虑，**不包含** `vitest.config.mjs`、`scripts/test/`、开发依赖；宿主侧可用 **`npm run test:smoke`**（`validate-runtime-hints` + `env-preflight`，不依赖 Vitest）。
- **`run-p0-audits.mjs`**：须指定书稿根，可为 **`--book-root <书稿根>`** 或 **首个位置参数**（`node scripts/run-p0-audits.mjs <书稿根>`）；**`--skill-root` 可省略**，默认按脚本所在目录推断技能根（避免在书稿目录下执行时把工作目录误当技能根）。若需覆盖再显式传 `--skill-root`。

## A. 包内文件

- [ ] `dist/fbs-bookwriter-v212-workbuddy.zip` 可生成且无报错  
- [ ] `SKILL.md`、`workbuddy/channel-manifest.json`、`_plugin_meta.json` 版本号一致  
- [ ] `fbs-runtime-hints.json` 存在且 `version` 与包一致  
- [ ] `references/05-ops/search-preflight-contract.json` 存在  

## B. 宿主最小集成

- [ ] 发布前或疑难排障可运行 **`npm run doctor`**（聚合 `validate-skill-frontmatter`、`validate-runtime-hints`、`env-preflight`、Node 引擎检查）  
- [ ] 会话启动可调用 `scripts/host-capability-detect.mjs`（或接受其缓存策略）  
- [ ] 首响可调用 `scripts/intake-router.mjs --book-root <书根> --intent auto --json`  
- [ ] 用户退出时可调用 `scripts/session-exit.mjs --book-root <书根绝对路径> --json`（**勿**在书稿目录下用相对路径 `node scripts/session-exit.mjs`；见宿主文档 §1.1）  
- [ ] 展示结果前可调用 `scripts/host-consume-presentation.mjs`，并实际执行返回的 `preview_url` / `open_result_view`  
- [ ] 已读 [`references/06-plugin/workbuddy-host-integration.md`](../references/06-plugin/workbuddy-host-integration.md)  

## C. 体验契约（抽样）

- [ ] `npm run pack:skill-gates` 通过（或等价 CI 任务）  
- [ ] `node scripts/ux-flow-guard.mjs --skill-root . --book-root . --enforce` 通过  
- [ ] `intake-router --json` 含 `firstResponseContext`（首响环境三元组）；`session-exit` 退出后存在 `书稿根/.workbuddy/memory/当日.md` 叙事镜像（或显式 `--no-workbuddy-mirror`）  
- [ ] 排障：`npm run diagnostics:host -- --book-root <书稿根> --json` 可运行  

## D. Tier1 期望

- [ ] 支持文档中说明：用户 **无需** 安装全部 `preferredSkills`，降级为预期行为  

## E. 高绩效 UX 落地（v2.1.1+，与 intake 机读字段对齐）

以下项已在技能包内落地；宿主/验收可对照 `intake-router --json` 的 `firstResponseContext` 与推荐 `actions`。

### E1 续写、交付、升级后真值（A2/A3/A1）

- [ ] **`historicalBookShortcuts`**：`~/.workbuddy/fbs-book-projects.json` 中与**当前书稿不同**的最近登记项（最多 2 条），用于首屏「接着写」分流  
- [ ] **`deliveryAndPreview`**：`deliverables` 路径说明 + 是否 `presentationBridgeSupported`；详见 [`references/05-ops/workbuddy-delivery-tier2.md`](../references/05-ops/workbuddy-delivery-tier2.md)  
- [ ] **`capabilityRefresh`**：当 `~/.workbuddy/.skills-marketplace-version` 新于 `.fbs/host-capability.json` 探测时间时，提示刷新；并出现可选「刷新宿主能力快照」动作  

### E2 检索与交付策略（B1/B2）

- [ ] **`searchStrategyHints`**：按已探测到的市场能力生成 **Agent 内**检索路由提示（中文/学术/深度等），**不向用户念技能 ID**  
- [ ] Tier2 交付顺序与文档：[`workbuddy-delivery-tier2.md`](../references/05-ops/workbuddy-delivery-tier2.md)  

### E3 记忆、编排、质检口径（A4/B3/B4）

- [ ] **`memoryDirectoryNudge`**：仅 `memery` 存在而 `memory` 不存在时，轻量迁移提示（可选）  
- [ ] **`teamOrchestrationHint`**：当探测到编排类市场能力时的 Agent 内说明  
- [ ] 宿主 `qc-*` 与 FBS 并存时：[`host-qc-and-fbs-reports.md`](../references/05-ops/host-qc-and-fbs-reports.md)  

### E4 画像、索引、组织闭环（C1/C3/C2）

- [ ] **退出与会话摘要**：`session-exit` → `apply-book-memory-template` 默认 **`includeHostProfileInBrief`**，在 `session-resume-brief.md` 顶部追加 **USER/IDENTITY/SOUL 摘要**（若存在）  
- [ ] **S4 合并后索引**：`merge-chapters.mjs` 成功后调用 `upsertBookSnippetIndex`，与 `session-exit` 登记互补  
- [ ] **组织向（可选）**：对外交付前可运行宿主 **`skills-sec-audit`**，结果建议落 `.fbs/org-feedback/` 或 `.fbs/reports/`（见 `channel-manifest` workflows）  

### E5 健康矩阵与宿主展示契约（与 `fbs-runtime-hints.json` → `hostPresentation` 对齐）

- [ ] **`runtime.healthMatrix`**：含 `overallSeverity`、`checks[].severity`、`userHint`；调试/折叠面板可展示完整矩阵  
- [ ] **`firstResponseContext.healthUserHint`**：主对话区仅在 `overallSeverity != "healthy"` 时追加 **一行**人话（与 §1.0 伪代码一致）  
- [ ] 机读路径已登记：`fbs-runtime-hints.json` 中 `healthUserHintJsonPath`、`runtimeHealthMatrixJsonPath`、`showHealthHintWhenDegradedOnly`  
- [ ] 类型与示例：[`references/06-plugin/workbuddy-host-integration.md`](../references/06-plugin/workbuddy-host-integration.md) §1.0.1–§1.0.2  

### E6 渠道默认、长任务契约与安全说明（A/B 波次）

- [ ] **`skillRuntimeHints.channelSessionDefaults`**：宿主会话级覆盖；未覆盖时采用机读默认  
- [ ] **`firstResponseContext.subTaskDecompositionContract`** 与 [`references/05-ops/fbs-subtask-contract.md`](../references/05-ops/fbs-subtask-contract.md) 对齐（worker / 编排侧）  
- [ ] **执行与安全边界**：向终端用户说明见 [`workbuddy-host-integration.md`](../references/06-plugin/workbuddy-host-integration.md)「执行与安全边界」；**勿**公网暴露高权限宿主入口  

## F. 宿主实测复盘整改（2026-04-15 skill-audit 对齐）

对照书稿侧审计报告（如 `.fbs/skill-audit-*.md`）与下列技能包行为：

- [ ] **A 类命令词**：`scripts/lib/s2-quality-lexicon.mjs` 对非命令语境弱化后再计数；健康快照 / `quality-auditor` 共用该逻辑  
- [ ] **合并稿**：`merge-chapters` 覆盖已有输出前默认写 `*.merge-backup-<时间戳>.md`（`--no-backup` 可关）；控制台标明**本次合并稿非空白字符**及与台账口径差异说明；`--dry-run` 仅预览  
- [ ] **MAT 残留**：`book-health-snapshot` 在代码块/HTML 注释外统计 `待核实-MAT` 与方括号标签，降低误报  
- [ ] **复盘清单可读性**：`retro-unresolved.md` 含「简要说明（给作者）」段落  
- [ ] **run-p0-audits 与复盘 P0**：存在未修复 P0 时审计失败属**预期门禁信号**；用户选择不修复时仍可继续写作，但应知悉 `enforce-p0` 类流水线会红灯  
