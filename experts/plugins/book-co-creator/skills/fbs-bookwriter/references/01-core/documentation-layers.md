# 文档分层说明

> **版本**：2.1.2
> **更新日期**：2026-04-12

---

## 概述

FBS-BookWriter 采用三侧分层架构：

| 侧别 | 目标用户 | 主要内容 |
|------|---------|---------|
| 🟢 用户侧 | 写作者 / 主编 | 技能入口、工作流、质量规则、交付说明 |
| 🔵 企业侧 | 机构 / 组织协作 | 场景包、协同机制、组织级执行规范 |
| ⚙️ 平台侧 | 维护者 / CI / 发布 | 打包、分发、构建、审核、运行守卫 |

---

## 🟢 用户侧（本包默认包含）

### 核心入口

- `SKILL.md` - 技能主入口与执行速查卡
- `references/01-core/skill-full-spec.md` - 完整规范
- `references/01-core/section-3-workflow.md` - 工作流总入口
- `references/01-core/workflow-volumes/` - 各阶段分卷执行规范
- `references/01-core/intake-and-routing.md` - 快速起步与路径分发
- `references/01-core/session-protocols.md` - 四类会议机制

### 质量体系

- `references/02-quality/quality-check.md` - 评分体系权威入口
- `references/02-quality/quality-PLC.md` - P / C / B 规则权威源
- `references/02-quality/quality-S.md` - S 层句级规则
- `references/02-quality/s5-buzzword-lexicon.json` - buzzword 词库
- `references/02-quality/abbreviation-audit-lexicon.json` - 缩写审计词表（**当前本包已包含**）

### 价值与培训（可选）

- `references/03-product/fbs-value-one-pager.md` - 用户向一页纸：能力边界、触发词、离线/在线（与 `SKILL.md` 一致）

### 运行与交付

- `scripts/quality-auditor-lite.mjs` - 轻量质量审计器
- `scripts/init-fbs-multiagent-artifacts.mjs` - 虚拟书房初始化
- `scripts/host-capability-detect.mjs` - 宿主能力快照
- `scripts/host-consume-presentation.mjs` - 结果展示消费入口
- `assets/build.mjs` - Markdown → HTML / PDF / DOCX 构建

---

## 🔵 企业侧（按授权范围提供）

以下内容可能出现在企业侧或组织协作包中，是否随当前用户包分发以实际授权为准：

- `references/04-business/scene-pack-spec.md` - 场景包规范
- `references/04-business/team-protocol.md` - 协同机制
- `references/01-core/workbuddy-agent-briefings.md` - 多智能体委派话术
- `references/01-core/execution-contract-brief.md` - 执行契约简报

> 如需企业侧扩展，请联系 **商务 / 授权**：`unique@u3w.com`

---

## ⚙️ 平台侧（维护 / 发布 / CI）

- `.codebuddy-plugin/plugin.json` - CodeBuddy 插件元数据
- `.codebuddy/providers/provider-registry.yml` - Provider 注册表
- `.codebuddy/agents/` - team-lead / researcher / writer / reviewer agents
- `codebuddy/channel-manifest.json` - CodeBuddy 通道清单
- `workbuddy/channel-manifest.json` - WorkBuddy 通道清单
- `scripts/pack-workbuddy-marketplace.mjs` - WorkBuddy 审核包入口
- `scripts/pack-release.mjs` - 三通道打包入口（WorkBuddy + CodeBuddy + OpenClaw）
- `references/05-ops/release-checklist.md` - 发版与产物核对清单
- `dist/` - 打包产物与 verification 报告目录

### 持续改进与机读约定（与 `fbs-runtime-hints.json` 对齐）

- `references/05-ops/fbs-continuous-improvement.md` — 执行轨迹（JSONL）、演进提案、`evolution-gate` 与发版同级
- `references/05-ops/fbs-context-compression.md` — 上下文压缩策略边界
- `references/05-ops/fbs-auxiliary-tasks.md` — 辅助任务用途与路由约定
- `fbs-runtime-hints.json` — 顶层键 `trace` / `bookIndex` / `evolutionGate` / `contextCompression` / `auxiliaryTasks`；变更时需同步 `scripts/validate-runtime-hints.mjs` 中 `REQUIRED_TOP` 与 `PATH_CHECKS`，并跑 `npm run validate:runtime-hints`
- `scripts/generated/scripts-manifest.json` — `npm run manifest:scripts` 生成；`npm run gate:evolution` 校验存在性

### 分发产物说明

- `dist/` 为**分发产物目录**，可由本地或 CI 构建生成
- 常用命令：
  - `npm run pack:workbuddy`
  - `npm run pack:release`
- 送审 / 验收以 `dist/*.verification.json` 为最终校验真值

---

## 通道与宿主说明

| 通道 | 主清单 | 说明 |
|------|--------|------|
| WorkBuddy | `workbuddy/channel-manifest.json` | 审核包、Tier1 本地市场能力 |
| CodeBuddy | `.codebuddy-plugin/plugin.json` + `codebuddy/channel-manifest.json` | 插件包、Tier2 宿主插件能力 |

> 源仓库采用 **WorkBuddy / CodeBuddy 双通道分轨**，不是 WorkBuddy-only 单通道。

### 记忆分层与宿主策略（A / B / C）

- 真值与契约：[`memory-layer-matrix.md`](./memory-layer-matrix.md)（与 `runtime-mandatory-contract.md` §5 配套）
- Teams 与收件箱：[`../05-ops/teams-inbox-mapping.md`](../05-ops/teams-inbox-mapping.md)
- 词表演进：[`../05-ops/lexicon-governance.md`](../05-ops/lexicon-governance.md)

### 质检分层与 CI 建议

| 层级 | 脚本 / 入口 | 适用场景 |
|------|-------------|----------|
| 轻量（默认） | `quality-auditor-lite`（`npm run quality:audit`） | 日常写作、单文件快速检查；不扫描 `references/**` |
| 全量（enforce） | `quality-auditor` + `references/**/*.md`（`npm run quality:audit:full`） | 发布前、PR、CI；与 `pack:release` 产物一致时需以 `dist` 内校验为准 |

- **CI**：建议至少跑 `npm test`、`npm run pack:skill-gates`（内含 `validate-runtime-hints`）、`npm run quality:audit:full`；`run-p0-audits --strict` 与 fixture 书根见 `fixtures/ci-book-root/`（含 `next-action.md`、`search-ledger.jsonl`、`writing-notes/pending-verification.md` 等，避免 UX / P0 严模式跳过或失败）。
- **断链审计**：以 `npm run pack:release` 生成的 `dist` 为准；若只改源文件未打包，可先 `npm run build:check`。

---

## 联系方式

- **技术支持**：`dev@u3w.com`
- **商务 / 授权**：`unique@u3w.com`
- **主页**：`https://fbs-bookwriter.u3w.com/`
- **公司**：悟空共创（杭州）智能科技有限公司
