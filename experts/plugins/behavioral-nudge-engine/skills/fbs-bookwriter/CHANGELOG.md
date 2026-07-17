# 变更日志

本文文件记录 FBS-BookWriter 的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

---

## 版本基线说明（2.1.2）

- 当前正式发布版本：`2.1.2`
- 上一个正式版本：`2.1.1`（变更归纳见 `docs/history/version-baseline-v2.1.1.md`）
- `docs/history` 下内部迭代长记录用于追溯，发布包默认不分发

---

## [2.1.1] - 2026-04-13（长上下文钉住 · 阶段门禁执行锁 · 质检强制闭环）

> **定性**：解决实测发现的三条架构缺陷——S0 阶段可被绕过、质检只检部分条目、全书一致性无锚点。核心机制：**7锁文件体系**（系统记忆 + 文件真值 + 规则注入三位一体）防止长上下文漂移。  
> **来源**：`D:\201TEST\.fbs\复盘报告-2026-04-13.md`（第二份 WorkBuddy 实测复盘）

### Added（新增）

- **[A1] S0-Init 7锁文件初始化**：`workflow-s0.md` 新增 S0-Init 节，定义 7 个锚点文件的创建规范（`author-meta.md` / `术语锁定记录.md` / `commitments.md` / `character-registry.md` / `track-linkage.md` / `project-config.json[targetWordCount]` / `叙事策略.md`），S0-A 完成后立即触发。
- **[A2] S0 最小必填集降级方案**：`intake-and-routing.md` 新增「脚本不可用降级方案」章节，定义 `intake-router.mjs` 不可用时 AI 手动引导的 4 个步骤，完成前禁止进入 S3 成文。
- **[A3] 阶段推进门禁**：`intake-and-routing.md` 新增「阶段推进门禁」章节，S0→S1 到 S4→S5 每个边界都有前置条件检查表，不满足时 AI 拒绝推进并说明缺失项。
- **[A4] S4 质检 20+3 条完整勾选表**：`quality-check.md` 新增第 5 节「S4 质检强制规范」，包含 20 条 S/P/C/B 逐条勾选表 + 3 条附加必检项（承诺兑现率 / 品牌植入合规 / 字数完成度），零条目可跳过。
- **[A5] S4 分步执行规范**：质检改为 4 步分层执行，每步结果写入 `.fbs/quality/` 持久化，防止上下文压力导致跳检。
- **[A6] 全书承诺注册表模板**：`workflow-s0.md` 提供 `commitments.md` 初始化模板，ch00 成文后注册，每章更新，S4 全量核对。
- **[A7] 案例人物注册表模板**：`workflow-s0.md` 提供 `character-registry.md` 初始化模板，防止跨章同名冲突。
- **[A8] S0 锚点写入系统记忆规范**：`runtime-mandatory-contract.md` 新增 §5.1，定义 S0-Init 后须写入宿主系统记忆的 3 个锚点（主题锁 / 术语锁 / 字数目标）及跨会话对照机制。

### Changed（变更）

- **[C1] 版本升级至 2.1.1**：`SKILL.md`（frontmatter + 正文）、`package.json`、`_plugin_meta.json` 版本号同步升级；`plugin-id` 更新为 `fbs-bookwriter-v211`；`description_en` 增加「7-lock anti-drift anchors」描述。
- **[C2] C5 章节衔接升级为 P1 强制**：`quality-PLC.md` §C5 从「多路并行 P0 建议项」升级为 **P1 强制**，不区分串行/并行；新增「卷首过渡」第 4 检查项；C 层计分规则从 `÷4` 改为 `÷5`（C1–C5 共 5 条）；`SKILL.md` 质检速查卡同步更新。
- **[C3] A 类词表扩充**：`quality-S.md` 在程度副词表后新增「绝对化命令词」（必须 / 一定 / 务必 / 绝不能 / 无论如何），全书 ≤ 3 次阈值，超出 S2 判❌。
- **[C4] 字数完成度门禁**：`quality-PLC.md` 附加③明确：字数完成度 < 50% 时 S4 **强制不通过**，不论其他条目得分；`SKILL.md` 速查卡同步标注。
- **[C5] 承诺兑现率升级为 P0 门禁**：`quality-PLC.md` 附加①定义承诺兑现率 100% 为 S4 通过门槛，任一未兑现 = S4 不通过。
- **[C6] 质检任何❌不得高于 7.5 分**：`quality-check.md` §5.1 明确门禁规则，防止评分虚高掩盖质量问题（修复实测中「9.0 vs 7.21」差异的根因）。
- **[C7] SKILL.md 执行速查卡内联门禁**：在第一步「开场前必做」中直接内联 S0 最小必填集降级方案和阶段推进门禁表，确保 AI 在上下文中可见，不依赖读取外部文档。

---

## [2.1.0] - 2026-04-11（主动恢复卡 · 检索闭环统一 · 主入口口径收口）

> **定性**：把检索闭环与恢复体验收口到主入口；消除「实现已升级、入口仍显旧版」与恢复链路过长的问题。  
> **内部测试说明**：自 **2.0.2** 之后至本版送审前为**内部迭代**，中间能力线（如原 **2.0.3**、Plugin Bus 探索线）**未单独上架**，条目已合入 2.1.0；演进归纳见 [`docs/history/version-baseline-v2.1.1.md`](docs/history/version-baseline-v2.1.1.md)。

### 工程化补丁（2026-04-13，semver 仍为 2.1.0）

> 不单独抬版本号；全文级列表如需追溯见 [`docs/history/`](docs/history/) 下归档页。

- **CI / 门禁**：GitHub Actions；`pack:skill-gates` 含 `validate-runtime-hints`；fixture 书根含 `next-action`、`chapter-status`、`search-ledger`、`pending-verification`；P0 审计 **`--strict`**。
- **可观测性**：`intake-router` JSON 增加 `intakeRouterRunAt`。
- **退出与宿主**：`session-exit` 必填 `--book-root`、原子写恢复卡；企微场景包失败提示「本地模式仍可用」；`credits-guide`、host-integration 补充。
- **策略 A/B/C**：`host-capability` 二进制登记、`firstResponseContext`、退出镜像、`memory-layer-matrix` / `lexicon-governance` / `teams-inbox-mapping`、`fbs-runtime-hints.strategiesABC`。
- **防卡顿 / UX**：`intake --fast`、场景包超时、`anti-stall`、记忆文件上限；终端首响提示；`ux-agent-playbook`、`userExperience`。
- **整改与拆分**：`audit:all` / `audit:all:strict` 默认书根；`release-checklist`；`test:contract` / `test:integration`；PR 模板。
- **文档清理（送审前）**：历史内部演进与长附录已归档至源码仓历史目录；发布口径统一参考 `docs/history/version-baseline-v2.1.1.md`；删除 `v2.1.0-migration-note.md`（机器路径类一次性信息）；删除 `releases/` 下 11 份内部闭环/打包/triage 重复说明，保留 review 与集成清单并加 [`releases/README.md`](releases/README.md)；`section-nlu` / 规范标题去旧版号标签。
- **编排策略**：新增 `references/05-ops/agent-task-strategy.md`（单智能体多任务、多智能体防断链、质量优先 + 过程信号弹性）；`fbs-runtime-hints.json` 增加 **`orchestration`**；`SKILL.md` 速查与核心导航、`fbs-team-lead`、`multi-agent-horizontal-sync`、`workbuddy-agent-briefings` 互链。
- **WorkBuddy 实测整改（2026-04-13）**：`intake-router` 默认快速开场（`--full` 才全量场景包）、首响 `recommendedOneLiner` 去 Tier/插件术语、运行时告警脱敏；`--search` + `~/.workbuddy/fbs-book-projects.json` 书稿索引（`session-exit` 登记）、子目录深度发现书稿根；`session-exit` 校验书根存在、`userMessage`/`userSummary` 双行摘要、`fbs-cli-bridge exit` 强制 `--book-root`；场景包降级 `userNotice` 用户向文案；`ux-agent-playbook` 补充退出与复述约定。**P0-01 宿主强制跑 intake** 仍以 JSON `compliance` 提示 + 文档为主，须 WorkBuddy 平台配合。
- **持续演进三阶段（2026-04-13）**：执行轨迹 JSONL（`fbs-trace-events.schema`、`fbs-trace-logger`、intake / session-exit / search-preflight 挂钩）；书稿片段索引 + `searchUnifiedBookRoots`；`scripts/generated/scripts-manifest.json` + `evolution-gate`（`pack:skill-gates` 默认执行，可用 `FBS_PACK_SKIP_EVOLUTION_GATE=1` 跳过）；`memory-adapter` 薄封装；`evolution-propose`；`fbs-runtime-hints` 增加 `trace` / `bookIndex` / `evolutionGate` / `contextCompression` / `auxiliaryTasks`；配套 ops 文档与 `validate-runtime-hints` 路径校验。
- **P2 体验与工程化（2026-04-13）**：`write-progress-snapshot.mjs` + `ux-optimization-rules` §E.1 可抽查说明；用户向 `fbs-value-one-pager.md`；`ux-agent-playbook` / `workbuddy-host-integration` Tier 话术表；CI 显式 `npm run manifest:scripts`；契约单测含 `evolution-gate`、`progress-snapshot`、`validate-runtime-hints` 负例。
- **WorkBuddy 实测复盘（2026-04-13）**：`intake-router` 首响 `openingGuidance` + 首屏≤3 选项；`session-exit` 增加 `agentGuidance.beforeExit`；`intake-and-routing` / `ux-optimization-rules` §G / `ux-agent-playbook` 4.1–4.3 / `workflow-s1` 白皮书预判；钩子错误与 Windows 命令缺失友好化；`fbs-context-compression` 长会话摘要示例。
- **WorkBuddy 复测（2026-04-13 12:34）**：`firstResponseContext.userFacingOneLiner` 专供用户可见一行摘要；SKILL/宿主文档明确禁止向用户区注入全文 JSON/SKILL；禁止首响后无目的 `list_dir` `.fbs/`；`workbuddy-session-snapshot` 优先解析「章节总数」等显式字段、`project-config.bookTitle`、万字估算；退出前确认措辞加强。
- **S0 阶段防无限停滞（2026-04-13 实测复盘）**：新增 `references/01-core/s0-material-phase-guard.md`；`SKILL.md` / `intake-and-routing.md` / `fbs-team-lead` 补充「继续」与 S0 达标后强制推进；`init-fbs-multiagent-artifacts` 增加 `.fbs/chapter-status.md` 阶段表与 `.fbs/quality-constraints.md`；`pack:team-handoff` 纳入新文档。
- **团队移交包**：`npm run pack:team-handoff`（别名 `pack:internal-docs`）→ **单个** `dist/fbs-bookwriter-team-handoff-v211.zip`，内含根目录 `说明.md` + `internal/` + 约定 `releases/`/`references/`/机读 JSON 等；与上架 `pack:workbuddy` 区分，见 `docs/internal/ZIP-交付说明.md`。
- **宿主展示与数据真值（2026-04-13 审计）**：文档与 `intake-router` 明确**禁止元指令泄露**（勿向用户复述「按规范/JSON 输出/不重复读」等）；`workbuddy-session-snapshot` 在合并 `project-config` 后对 **completedCount ≤ chapterCount** 钳制，修复「已完成章数大于总章数」展示；`readResumeCard` / `userFacingOneLiner` 同步钳制；发布 zip **排除** `scripts/wecom/connector-manifest.json`（草稿连接器清单，源码仓保留）；`INTERFACE_CONTRACT` 注明该文件不随发布包。

### Changed（变更）

- **[C1] 主入口版本统一到 v2.1.0**：同步更新 `SKILL.md`、`package.json`、`intake-and-routing.md` 的版本展示与描述，减少入口判断偏差。
- **[C2] 会话恢复口径升级为默认主动恢复**：`SKILL.md` 与补充规范统一改为“新会话默认执行三级恢复检测并输出恢复卡”，`继续/接着写` 仅作为快捷入口，不再是必要前提。
- **[C3] 续写规则文档同步**：`intake-and-routing.md` 与 `skill-authoritative-supplement.md` 的续写/无信号话术改成主动恢复式表达，和 UX 规则中心保持一致。
- **[C4] 上架包补齐离线版→在线增强版收口**：新增 `references/01-core/offline-online-upgrade-guide.md`，同步修正 `_plugin_meta.json`、`SKILL.md`、`scene-pack-activation-guide.md` 的模式边界说明，并将 `references/03-product/` 纳入 `pack-v210` 审核包，消除用户索引断链与升级入口缺失。
- **[C5] 双通道双产物正式落地**：新增 `pack-workbuddy-marketplace.mjs`、`pack-codebuddy-plugin.mjs`、`pack-release.mjs`，正式拆分 WorkBuddy Marketplace 包与 CodeBuddy Plugin 包。
- **[C6] 插件级元数据随包交付**：`.codebuddy-plugin/plugin.json`、`.codebuddy/agents/`、`.codebuddy/providers/provider-registry.yml` 现在进入正式产物，`defaultAgent` 收口为 `fbs-team-lead`。
- **[C7] 组织反馈回流接入书稿流程**：新增 `scripts/release-feedback-bridge.mjs`，把发布后组织评审意见落盘到 `.fbs/org-feedback/`，并同步回 `releases/*-release.json` 与 `workspace-manifest.json`。
- **[C8] 任务-智能体映射补强**：基于 WorkBuddy 2.1.0 实测，`SKILL.md`、`skill-authoritative-supplement.md`、`workbuddy-agent-briefings.md` 明确收口为“探索 / 审计走只读子智能体，修复 / 写入走主智能体或可写成员”，禁止把 `code-explorer` 当修复执行者。
- **[C9] 批量执行工具改为 Python 优先**：无 Node / 批量文件 / 中文路径场景下，默认优先 Python，PowerShell 仅作为 `-File` 级补充，不再鼓励 `-Command` 内联脚本。
- **[C10] 长任务结果先落盘再摘要**：把“完整结果写入文件、返回只保留短摘要”的约束从质检子智能体扩展到通用长任务，并补入接管规则。
- **[C11] 批量替换新增抽样复核**：S4 / S5 批量替换后，要求每 10 条至少抽 1 条复核，高风险替换 100% 复核，验证不再只看残留数量。
- **[C12] Skill↔脚本↔CLI 插件化联动（非 MCP）**：新增 `scripts/fbs-cli-bridge.mjs` 作为检索前置合同、企微场景包工具、乐包查询、生命周期脚本的统一入口；`workbuddy/channel-manifest.json` 与 `codebuddy/channel-manifest.json` 增加 `scriptBridge`；补充 `references/01-core/skill-cli-bridge-matrix.md`、`_plugin_meta.json` 能力与 `fbs-runtime-hints.json` 机读字段；长链路能力仍通过 Skill 与脚本、CLI 联动，不拆 MCP Server。



---

## [2.0.3] - 2026-04-11（内部能力线，未单独上架，已合入 2.1.0）

> **摘要**：修正 Tier/xlsx/wechat 国际版等链路；宿主三分支检测；humanizer；记忆持久化规则；品牌与 `brand-platform-convention` 三列表。  
> **历史说明**：该内部能力线已并入正式版本口径，归纳见 `docs/history/version-baseline-v2.1.1.md`。

---

## [3.0-internal-track] - 2026-04-11（Plugin Bus 探索线，未单独上架，已合入 2.1.0）

> **摘要**：Provider 架构、`fbs-team-lead`、Tier1 技能与多 Provider 文档；S0/S5/S6 增强能力线。  
> **历史说明**：该探索线已并入正式版本口径，归纳见 `docs/history/version-baseline-v2.1.1.md`。

---

## [2.0.2] - 2026-04-09（WorkBuddy 宿主深度适配与智能记忆分层收口）

> **定性**：WorkBuddy 宿主环境深度适配，消除三项结构性错配，统一质检报告落盘，解锁原生 Sub-Agent 能力。

### Added（新增）

- **[A1] Sub-Agent 声明式定义（5个 Agent）**：新建 `.codebuddy/agents/` 目录，包含 `fbs-researcher.md`（情报研究员）、`fbs-writer.md`（章节写作员）、`fbs-reviewer-p.md`（P层审查员）、`fbs-reviewer-c.md`（C层审查员）、`fbs-reviewer-b.md`（B层审查员）；每个 Sub-Agent 含 YAML frontmatter、最小化工具授权、写入边界声明，激活 WorkBuddy 原生 Sub-Agent 自动委派能力
- **[A2] 宿主能力检测器**：新建 `scripts/host-capability-detect.mjs`，检测宿主类型（workbuddy/codebuddy/node-cli）、Node.js 环境（含 execPath）、Sub-Agent 支持、Git 可用性，输出 `.fbs/host-capability.json`（缓存60分钟），提供 `routingMode`（hybrid/sub-agent-only/script-only/dialog-only）
- **[B2] Node.js 环境检测模块**：新建 `scripts/lib/node-env-check.mjs`，提供 `checkNodeEnv(minVersion)` / `resolveNodeExecPath()` / `assertNodeEnv(minVersion)` 三个导出函数；`resolveNodeExecPath()` 返回 `process.execPath` 替代 `spawn('node', ...)`，解决 WorkBuddy 内置 Node 不注入系统 PATH 导致子进程静默失败的问题
- **[D2] 会话快照生成器**：新建 `scripts/workbuddy-session-snapshot.mjs`，从 `esm-state.md`/`chapter-status.md` 自动读取当前状态，输出 `.fbs/workbuddy-resume.json`（含 `currentStage/lastAction/nextSuggested/bookTitle/wordCount/updatedAt`），将续写前置轮次从 5–8 轮压缩到 1–2 轮
- **[D2] XL 分卷初始化器**：新建 `scripts/xl-project-init.mjs`，自动检测书稿规模（S/M/L/XL 四级，XL≥100万字），生成 `.fbs/volumes-index.json`，在 `project-config.json` 写入 `projectScale`，支持 `--resume-from-volume` 断点续检
- **[E1] 质检规则覆盖率审计器**：新建 `scripts/quality-coverage-auditor.mjs`，从 `quality-S.md`/`quality-PLC.md` 提取规则 ID，与 `quality-auditor-lite.mjs` 实现比对，输出 `.fbs/qc-coverage-report.md`
- **[E1] S5 Buzzword 词表扩展**：`references/02-quality/s5-buzzword-lexicon.json` 从 33 词扩充至 100+ 词（新增互联网黑话、企业管理术语、AI 写作高频词）
- **[E1] AI 写作特征模式词库**：新建 `references/02-quality/ai-pattern-lexicon.json`，包含 30 个 AI 写作特征模式（AI-P01–AI-P30），含 `riskLevel`/`suggestion`/`thresholds` 字段
- **[E3] 8 个场景包 local-rule 文件**：为所有 8 个场景包新建体裁感知质量规则补丁文件（`references/scene-packs/*-local-rule.md`），在四级降级链 L3 阶段自动读取，解决离线时体裁感知退化为通用规范的问题；每个文件含：体裁专属质量规则 ID 表、L3 离线告知模板

### Fixed（修复）

- **[A1] workbuddy-agent-briefings.md 错误声明修正**：修正第 13 行"WorkBuddy 不支持 Agent Teams"错误声明，替换为完整的 WorkBuddy 多 Agent 使用规范（Sub-Agent 适用场景、Team 适用场景、通信规范），激活宿主原生多 Agent 能力
- **[B1] parseMemeryFiles() schema gap 修复**：`workbuddy-user-profile-bridge.mjs` 的 `parseMemeryFiles()` 新增 `RAW_JSON_START...RAW_JSON_END` JSON 段优先解析路径，JSON 解析成功时从 `data.workContext`/`data.uid`/`data.memoryBlock` 提取结构化字段，失败时回退 Markdown 正则路径；消除 `projectTypes` 被赋值为整段 memoryBlock 文本的 bug
- **[B1] extractProjectTypes() 去实例化**：替换为覆盖 8 大场景包的通用体裁词汇表，不再硬编码特定用户项目名
- **[B3] 存量项目迁入阻断修复**：`s3-start-gate.mjs` 新增 `--legacy-project` 标志与自动检测（有 `.md` 无 `.fbs/`），`legacyProject` 模式下 Brief 覆盖率门禁从 exit 1 降级为警告，消除存量项目用户在第一个检查点被系统性拒绝的问题
- **[C1] 入口压缩**：`references/01-core/intake-and-routing.md` 新增"首响极速启动（1+1模式）"章节，建立 12 意图群路由表（替代原 66 条离散指令），将首次响应前置分析从 2–3 轮压缩到 1 轮；新增会话快速恢复章节（`workbuddy-resume.json` 优先读取）
- **[E2] 质检报告落盘路径统一**：`s3-start-gate.mjs` 的 `appendGateRunLog()` 重构为 JSON Schema v2.1 标准报告，主落盘到 `.fbs/qc-output/{taskId}-GATE.json`，兼容性追加 `gate-run-log.jsonl`（含 `qcReportPath` 指针），消除 `gate-run-log.jsonl` / `qc-output/` / `memory/qc-*.md` 三分裂

### Changed（变更）

- **[C2] 运行时可观测性**：`intake-and-routing.md` 新增 ESM 状态仪表盘格式、三级进度推送规范、错误翻译表（将技术错误码翻译为用户可理解的中文描述）
- **[D1] NLU 脚本归档**：`nlu-optimization.mjs`（31.37KB）和 `nlu-optimization-enhanced.mjs`（30.14KB）移入 `scripts/_deprecated/`，以 Sub-Agent `description` 字段替代，减少约 61KB 冗余加载
- **[D1] section-3-workflow.full.md 归档**：128.85KB 超长全流程文档移入 `scripts/_deprecated/`，日常运行使用精简版 `section-3-workflow.md`
- **[E3] scene-pack-activation-guide.md 更新**：补充 L3 降级路径详解章节，明确各场景包 local-rule 文件位置与合并读取顺序，规范 L3 离线告知格式

### Deprecated（归档）

- `scripts/nlu-optimization.mjs` → `scripts/_deprecated/nlu-optimization.mjs`
- `scripts/nlu-optimization-enhanced.mjs` → `scripts/_deprecated/nlu-optimization-enhanced.mjs`
- `references/01-core/section-3-workflow.full.md` → `scripts/_deprecated/section-3-workflow.full.md.archived`

---



## 附录：2.0.2-patch 分支修复记录（2026-04-11，未单独发布）

> **说明**：该分支记录为 `2.0.2` 之后、`2.0.3 / 2.1.0` 之前的补丁整理，不再作为正式版本号参与发布序列，保留在附录仅用于追溯。

### P0 修复

- **[P0-B1] 防卡顿心跳**：`quality-panorama-orchestrator.mjs` 将 `runNodeWithJsonOut` 从 `spawnSync` 同步阻塞改为 `spawn` + `setInterval` 心跳（≤15秒输出一行进度、超时终止返回 partial），消除无声黑箱风险；同步将完整调用链（`runMachineScan/runLiteAudit/runMachineScanInBatches/runLiteAuditInBatches/runDeepAudit/runPanoramaAudit/runQualityPanorama`）全面改为 async/await
- **[P0-A2] 搜索前置合同 enforce**：`s3-start-gate.mjs` 新增 `checkSearchPreflightAnnouncement()` 函数，在 S3 启动门禁中自动验证 search-ledger 是否含有完整 `kind=search_preflight` 宣告条目（四字段），缺失时 exit 1，将 `blockedIfMissingAnnouncement:true` 从声明性字段升级为运行时强制检查

### P1 修复

- **[P1-A1] WP1 边界守卫**：`scripts/lib/entry-contract-runtime.mjs` 新增 `checkWP1BoundaryTerms(text, policy)` 和 `checkWP1ToWP2Transition(bookRoot, policy)` 两个导出函数，分别用于检测 WP1 内禁止术语调用、验证 WP1→WP2 切换前置条件（搜索前置合同宣告是否完整），供调用链 enforce 使用
- **[P1-B3] quality-auditor-lite 落盘**：`quality-auditor-lite.mjs` 完成质检后额外写入 `.workbuddy/memory/qc-{taskId}.md`（含 `<!-- FBS_QC_META ... -->` 元数据），taskId 含时间戳唯一标识；落盘失败不阻断主流程
- **[P1-B6] S0 离线自动标注**：`record-search-preflight.mjs` 新增 `detectOnlineStatus()` DNS 探测（2秒超时），离线时自动填充 `offlineFallback` 默认值并在 message 头部插入「【离线降级】」标注，无需手工传 `--offline-fallback` 参数

### P2 修复

- **[P2-B2] maxTurns 批次限制**：`runMachineScanInBatches` 和 `runLiteAuditInBatches` 批次循环内加入 `opts.maxTurns` 计数检查，达上限时 console.warn 并 break，避免无限循环

### 更多（术语门禁、入口契约、UX 文案、文档注入等）

该补丁附录已归档，发布口径以 `docs/history/version-baseline-v2.1.1.md` 为准。

---

## [2.0.1] - 2026-04-08

### 新增
- WorkBuddy/CodeBuddy 宿主适配版本
- P0 规则速查清单（quality-gates-brief.md）
- 文档分层说明（标注企业侧/平台侧参考文档范围）
- package.json 添加 engines 字段（workbuddy >=1.1, codebuddy >=1.0）
- package.json 添加 author 字段

### 修复
- 版本号对齐：plugin-id 从 fbs-bookwriter-v200 更新为 fbs-bookwriter-v201
- 自动生成 LICENSE 文件（从 _plugin_meta.json 推断）
- 排除测试文件（scripts/test/ 目录）
- 编码格式验证（UTF-8 统一）

### 改进
- 打包脚本优化：自动跳过测试目录和测试文件
- 质量门禁文档：添加 P0 规则速查清单
- 文档索引：明确标注三侧文档可用性

### 变更
- 版本号从 2.0 升级至 2.0.1
- plugin-id 从 fbs-bookwriter-v200 更新为 fbs-bookwriter-v201

---

## [2.0] - 2026-04-06

### 新增
- **v2.0.1 核心工作流重构**
  - ESM 状态机：+1 状态（IDLE → INTAKE → RESEARCH → PLAN → WRITE → REVIEW → WRITE_MORE → DELIVER）
  - 快速启动模式：三条路径（路径A：材料驱动、路径B：中主题驱动、路径C：网络检索驱动）
  - S0 感知策略：自动路径分发
  - S6 转化：知识层级产品转化
- **三侧会议机制**
  - 创意会（激励型、程序型、读者型）
  - 读者会（新建、有基础、摘取读者）
  - 对抗会（支持者、反对者、综合者）
  - 评审会（内容专家、表达专家、总理论者）
- **Team 模式并行执行**
  - 多 Writer 并行
  - 依赖与特殊管理
  - 心跳与超时处理
  - 缓盘协议
- **S/P/C/B 四层质量检查**
  - S 层（章级）：S1-S6 规则
  - P 层（段级）：P1-P4 规则
  - C 层（句级）：C1-C4 规则
  - B 层（书级）：B0-B3 规则
- **质量门禁系统**
  - P0 强制检查（主题锁、时间戳检索、材料原子性）
  - P1 重要检查（问题驱动、对话体转译）
  - P2 建议检查（标题编号统一、段落平衡）
- **强制联网检索**
  - S0-S2 阶段强制检索
  - 时间标签证据
  - 事实绑定写入
- **MAT 要素编号体系**
  - 统一引用格式
  - 全书一致
- **构建管线**
  - Markdown → HTML（markdown-it）
  - H1-H9 后处理
  - PDF 生成（puppeteer，可选）
  - DOCX 生成（html-to-docx，可选）

### 变更
- **重新定位企业微信集成**
  - v2.0.1 移除微信集成作为章节写入目标
  - 改为本地舒盘输出优先
- **场景包降级路径优化**
  - 4 级降级链（disk_cache → offline_cache → local_rule → no_pack）
- **工作流前置**
  - 支持跳过 S2/S4/S5（实际项目可跳过）
  - 默认完整流程保留

### 修复
- 多项目用户反馈问题修复
- 断链审计三侧零问题（P0/P1）（用户侧52文件/企业侧82文件/平台侧167文件）

### 文档
- 完整的技能规范（SKILL.md）
- 核心工作流（section-3-workflow.md）
- 质量规则（quality-S.md、quality-PLC.md、quality-check.md）
- 宿主集成指南（skill-authoritative-supplement.md）

---

## [1.60] - 2025-12-15

### 新增
- 企业微信集成（章节写入目标）
- 场景包基础框架
- 用户分层（L0/T1/T2/T3）
- 评分体系

### 已知
- 微信集成为章节写入目标（v2.0.1 已移除）
- 场景包规则不完整

---

## [1.0] - 2025-08-20

### 新增
- FBS-BookWriter 首次发布
- 基础写作功能
- Markdown 输出
- 简单质量检查

---

## 版本说明

### 版本编号规则
- **主版本号（Major）：** 不兼容的 API 修改
- **次版本号（Minor）：** 向下兼容的功能新增
- **修订号（Patch）：** 向下兼容的问题修正

### 三侧版本说明
- **用户侧：** 写作者、主编直接使用（52 文件）
- **企业侧：** 场景、主编、集成使用（82 文件）
- **平台侧：** 维护者、CI 使用（167 文件）

---

## 联系方式

- **团队：** 福帮手AI团队
- **公司：** 悟空共创（杭州）智能科技有限公司
- **邮箱：** Unique@u3w.com
- **主页：** https://fbs-bookwriter.u3w.com/
- **许可证：** MIT License
