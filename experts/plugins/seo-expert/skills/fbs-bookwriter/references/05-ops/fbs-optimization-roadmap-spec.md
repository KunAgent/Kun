---
name: FBS 优化路线图规格（P0–P2）
description: 统筹上一轮洞察中的优化项，细化接口、数据形态、验收标准与依赖关系
version: 1.0.0
---

# FBS 优化路线图规格（P0–P2）

> **目的**：把「观测聚合、质检剖面、预检挂载、中断合流、CI 分层、词条真值校验」等待办项写成**可开发、可测试、可验收**的规格，避免只停留在原则层。  
> **真值关系**：本规格**不替代**已有权威文档（`runtime-mandatory-contract.md`、`fbs-source-of-truth-matrix.md`、`quality-S.md`）；若冲突以真源矩阵与版本发布说明为准。

---

## 0. 总则

### 0.1 术语

| 术语 | 含义 |
|------|------|
| **书稿根（bookRoot）** | 用户打开的书稿目录，含 `.fbs/`、`deliverables/` 等 |
| **技能根（skillRoot）** | FBS-BookWriter 仓库根（含 `scripts/`、`references/`） |
| **写作稿（manuscript）** | 面向读者交付的正文：典型路径 `chapters/**`、`deliverables/**` 下 Markdown |
| **规范文档（skill-doc）** | 技能包内 `references/**`、`SKILL.md` 等，允许规范性「必须」等用语 |
| **BookHealthSnapshot** | 一书稿一次可聚合的机器可读健康快照（见 §1.1） |
| **Profile** | 质检/门禁使用的扫描范围与告警策略组合（见 §1.3） |

### 0.2 设计原则

1. **可观测优先**：新能力优先产出 **JSON + 可选 Markdown 摘要**，便于宿主展示与 CI 判读。  
2. **默认不破坏**：新开关默认 **关闭** 或与当前 CLI 行为兼容；破坏性变更须 bump 次版本并写 `emit-upgrade-summary` 链。  
3. **单源命令**：对外「推荐命令」以 `package.json` `scripts` 与 `SKILL.md` 速查为准；本规格只引用别名，不重复长命令。  
4. **退出码契约**：门禁类脚本 **0=通过、非 0=失败**；快照生成类 **0=成功写出**（警告可写入 JSON 字段，不默认失败）。

---

## P0 规格（建议下一迭代优先）

### P0-1 BookHealthSnapshot（一书稿健康快照）

**目标**  
在单次调用或单次 CI 步骤中，聚合多脚本关键结果，避免人工翻多个报告。

**范围**  
- **纳入**：与「当前书稿能否继续写/能否交付」强相关的 **可机读** 指标（见下表）。  
- **不纳入**：大模型主观评分、需人工通读全书的判断（可作为 `notes` 文本字段附录）。

**输出**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `schemaVersion` | string | 是 | 如 `"1.0.0"` |
| `generatedAt` | string (ISO8601) | 是 | UTC |
| `bookRoot` | string | 是 | 绝对路径规范化 |
| `skillVersion` | string | 否 | `package.json` version 或 `SKILL` 元数据 |
| `intake` | object | 否 | 见下 |
| `env` | object | 否 | 见下 |
| `expansion` | object | 否 | 见下 |
| `imperativeClassA` | object | 否 | 见下 |
| `pendingVerification` | object | 否 | 见下 |
| `p0AuditSummary` | object | 否 | 可选：最近一次 `run-p0-audits` 退出码与步骤摘要 |
| `status` | string | 是 | 枚举：`ok` \| `warn` \| `block` |
| `blockers` | string[] | 否 | 人类可读短句，供宿主直接展示 |

**`intake`（可选）**

| 字段 | 类型 | 说明 |
|------|------|------|
| `lastIntakeAt` | string \| null | 若可读取 `.fbs` 或 trace 中最近一次 intake 时间 |
| `resumePresent` | boolean | `workbuddy-resume.json` 是否存在 |
| `chapterStatusPresent` | boolean | `.fbs/chapter-status.md` 是否存在 |

**`env`（可选）**  
来自 `env-preflight.mjs` 的 JSON 子集：`allOk`、`checks[]`（id + ok + detail）。

**`expansion`（可选）**

| 字段 | 类型 | 说明 |
|------|------|------|
| `planPresent` | boolean | `.fbs/expansion-plan.md` 是否存在 |
| `gateLastExitCode` | number \| null | 若运行了 `expansion-gate` 则记录 |

**`imperativeClassA`（可选）**

| 字段 | 类型 | 说明 |
|------|------|------|
| `bookTotal` | number \| null | 对**写作稿** glob 扫描汇总的 A 类词合计（与 `quality-auditor` 逻辑一致） |
| `threshold` | number | 默认 `3`，与 `quality-S.md` 对齐 |
| `exceedsThreshold` | boolean | `bookTotal > threshold` |

**`pendingVerification`（可选）**

| 字段 | 类型 | 说明 |
|------|------|------|
| `count` | number | `audit-pending-verification` 可解析的未勾选条数（若脚本无此输出则 `null`） |

**落地方式（任选其一，实现阶段定稿）**

- **方案 A**：新增 `scripts/book-health-snapshot.mjs --book-root <根> --json-out <路径>`，内部 `spawn` 已有脚本并聚合。  
- **方案 B**：在 `intake-router --inspect` 增强时输出嵌套字段（改动面大，需单独评估）。

**验收标准**

1. 在 fixture 书稿上运行，生成 **合法 JSON**，`status` 与 `blockers` 与人工对照一致。  
2. 文档中增加一节：「发版/交付前可运行 `node scripts/book-health-snapshot.mjs …`」。  
3. `npm test` 增加轻量快照测试（mock 子进程或 fixture）。

**依赖**  
`env-preflight`、`expansion-gate`、`quality-auditor`（汇总 imperative）、`audit-pending-verification` 的稳定输出。

---

### P0-2 A 类命令词「全书门禁」操作规格

**目标**  
消除「只扫了部分文件却以为全书达标」的语义歧义；与 `quality-S.md` 全书 ≤3 次对齐。

**规范**

1. **扫描范围**（写作稿）  
   - 默认 glob 建议：  
     `"{chapters,deliverables}/**/*.md"`  
   - 排除：`node_modules`、`.git`、`.fbs` 内台账（除非产品明确要扫台账）— **排除列表须与 `quality-runtime` 策略一致**，并在文档中写死一行。

2. **命令形态**（对外单一推荐）  
   - 使用 `quality-auditor.mjs`：`--glob` + `--book-root` + `--enforce-imperative-book`。  
   - **不得**宣称「已清零」除非 exit code 为 0 且 JSON 中 `imperativeBookTotal <= 3`。

3. **与 `quick-scan.ps1` 关系**  
   - `quick-scan` 输出 **命中数**；**门禁判定**以 `quality-auditor` 的 `--enforce-imperative-book` 为准（两者词表同源 `s2-quality-machine-lexicon.json`）。

**验收标准**

1. `SKILL.md` 或 `quality-check.md` 中增加 **「全书 A 类词」** 小节：范围 + 一条推荐命令 + 阈值说明。  
2. 一致性审计或 `scripts/test` 中校验：文档中提到的 flag 与 `quality-auditor.mjs` `parseArgs` 一致。

**依赖**  
`s2-quality-machine-lexicon.json`、现有 `quality-auditor` 实现。

---

### P0-3 质检 Profile（manuscript / skill-doc）

**目标**  
在「规范文档」与「写作稿」之间分流 **告警策略**，避免规范文档中的「必须」拖垮写作稿门禁可信度。

**Profile 定义**

| Profile | 典型 glob / 根 | 默认 `warnImperative` | 默认 `enforceImperativeBook` | 说明 |
|---------|------------------|------------------------|------------------------------|------|
| `manuscript` | `bookRoot` 下 `chapters/**`、`deliverables/**` | **建议 true**（或显式 `--warn-imperative`） | **可 true**（发版前） | 对正文用语敏感 |
| `skill-doc` | `skillRoot` 下 `references/**`、`SKILL.md` | **false** | **false** | 规范用语不触发 A 类词告警 |

**接口（建议）**

- `quality-auditor.mjs` 增加 `--profile manuscript|skill-doc`（内部映射为默认 glob 与 flag 组合）；**若同时指定 `--glob`，以 `--glob` 覆盖**。  
- 或仅在 `quality-auditor-lite.mjs` 实现 profile，**二选一**须在实现 PR 中写清，避免双实现分叉。

**验收标准**

1. 对同一份含大量「必须」的 `references/01-core/*.md` 跑 `skill-doc`，**不产生** imperative 阻断（除非显式开 warn）。  
2. 对 `deliverables` 下测试稿跑 `manuscript`，能稳定产生与 `quality-S` 一致的告警语义。  
3. 文档：`quality-check.md` 或 `writing-phase-alert-tiers.md` 增加 Profile 说明。

**依赖**  
`quality-auditor` / `quality-auditor-lite` 的 glob 与 flag；`gates` 索引（`fbs-runtime-hints.json`）可链到本规格。

---

## P1 规格（短期）

### P1-1 env-preflight 挂载到 intake / inspect

**目标**  
让「环境预检」从独立脚本变为**可选的主线信号**，便于宿主展示「环境受限」。

**行为**

1. **触发条件**（建议）  
   - `intake-router` 在 `--intent inspect` 或显式 `--with-env-preflight` 时执行。  
2. **输出**  
   - 写入 `.fbs/env-preflight.json`（或并入 `BookHealthSnapshot` 的 `env` 字段，二者二选一防重复）。  
3. **失败策略**  
   - `env-preflight` 非 0：**不阻断** intake 默认路径（与复盘「先能跑起来」一致），但在 JSON 中标记 `env.allOk: false`，供 team-lead 首响提示。

**验收标准**

1. 文档：`intake-and-routing.md` 或 `section-6-tech.md` 增加「inspect 会刷新 env-preflight」一句。  
2. fixture 测试：inspect 后文件存在且可读。

**依赖**  
`scripts/env-preflight.mjs`（已存在）。

---

### P1-2 并行取消 / 合流 diff 报告（结构化）

**目标**  
将 `multi-agent-horizontal-sync` §2.1 的「合流」落到**可机读清单**，减少口头汇报。

**输出文件**（建议路径）

- `.fbs/merge-report-{timestamp}.json` 或固定最新 `.fbs/last-merge-report.json`

**建议字段**

| 字段 | 类型 | 说明 |
|------|------|------|
| `schemaVersion` | string | |
| `generatedAt` | string | |
| `reason` | string | 如 `parallel_cancel` \| `batch_merge` |
| `files` | array | 每项：`path`, `action`（`scanned` \| `merged` \| `rolled_back`）, `sha256` 或 `sizeBytes`（可选） |
| `diffSummary` | string | 人类可读摘要 |
| `verifyCommands` | string[] | 已执行的验证命令，如 `expansion-word-verify`、`quality-auditor` |

**落地方式**  
- 优先：**扩展** `merge-expansion-batch.mjs` 或新增 `scripts/write-merge-report.mjs`，由 team-lead 文档引用。  
- 与 `BookHealthSnapshot` 可合并：`p0AuditSummary` 或 `merge` 子对象。

**验收标准**

1. `fbs-team-lead` 或 `multi-agent-horizontal-sync` 中引用路径与字段名一致。  
2. 至少一条自动化测试：fixture 下生成 JSON 合法。

---

### P1-3 CI 分层（fast / release）

**目标**  
PR 快速反馈，发版仍严格。

**分层定义**

| 层级 | 建议命令组合 | 耗时目标 | 失败策略 |
|------|----------------|----------|----------|
| **fast** | `npm test` + `validate:runtime-hints` + `audit:consistency` | 分钟级 | 阻断合并 |
| **release** | fast + `audit:all` + `manifest:scripts` + `gate:evolution` | 10–20 分钟可接受 | 阻断发版 |

**验收标准**

1. `release-checklist.md` 或 `platform-ops-brief.md` 中写明 **fast vs release** 与适用场景（PR vs tag）。  
2. （可选）CI 配置文件若存在，注释与上表一致。

---

## P2 规格（中期）

### P2-1 quality-S 与 `s2-imperative-lexicon.json` 集合校验

**目标**  
防止「规范正文列举的词」与「机读 JSON」漂移。

**规则（建议）**

- 解析 `quality-S.md` 中「绝对化命令词」列表（固定小节标题或正则）。  
- 集合 **等于** `s2-imperative-lexicon.json` 的 `terms`（顺序无关）。  
- 不等则 `consistency-audit` 或独立测试 **失败**。

**验收标准**

1. 在 CI 的 `audit:consistency` 或 `npm test` 中覆盖。  
2. 文档：`quality-S.md` 已声明 JSON 为真源时，本规则**禁止**仅改文档不改 JSON。

---

### P2-2 `run-p0-audits` 步骤并行化（可选）

**目标**  
缩短 `audit:all` 在 CI 中的 wall time。

**约束**

- 仅当步骤 **无共享写同一文件** 且无顺序依赖时可并行。  
- 默认保持 **串行**，`--parallel` 为实验性开关。

**验收标准**

1. 并行模式与串行模式对**同一 fixture** exit code 一致。  
2. 文档标注「实验性」。

---

### P2-3 对外示例一致性（合并命令）

**目标**  
减少外部文章/旧 PR 仍传播 bash `$OUTPUT` 合并示例。

**方法**

- 仓库内 grep：`section-3-workflow.full.md`、打包说明、博客引用 **仅保留** `merge-chapters.mjs` 推荐命令。  
- 可选：在 `pack-release` 或 `upgrade-diff-scan` 中增加 **关键词告警**（`merge-chapters.sh`、`$OUTPUT`）。

**验收标准**

1. 主文档无已废弃 bash 合并模板（或明确标注「仅非 Windows 参考」）。  
2. 发版说明中提及「合并请用 Node」。

---

## 附录 A：优先级与依赖 DAG（摘要）

```
P0-3 Profile ─┐
              ├──► P0-1 Snapshot（聚合字段更干净）
P0-2 A 类门禁 ─┘

P1-1 env-preflight ──► P0-1 Snapshot.env

P1-2 merge-report ──► P0-1 Snapshot（可选合并）

P2-1 lexicon 集合 ──► 现有 consistency-audit

P2-2 并行 audit ──► 无硬依赖，注意 CI 稳定性
```

---

## 附录 B：验收总表（产品侧一眼）

| ID | 交付物 | 最低验收 |
|----|--------|----------|
| P0-1 | `book-health-snapshot` + JSON schema + 文档 | fixture 测试通过 |
| P0-2 | 文档单命令 + 语义「全书」 | 审计/测试通过 |
| P0-3 | `--profile` 或 lite 等价 + 文档 | 双路径用例通过 |
| P1-1 | `.fbs/env-preflight.json` + 文档 | fixture 存在 |
| P1-2 | merge 报告 JSON + 文档对齐 | 样例 JSON 合法 |
| P1-3 | release 文档 + CI 注释 | 团队确认 |
| P2-1 | 集合校验 | CI 失败可复现 |
| P2-2 | 可选 `--parallel` | 串并行一致 |
| P2-3 | 内文档无冲突命令 | grep 清零或标注 |

---

## 附录 C：与「真源矩阵」对齐

本规格中的路径、脚本名、阈值默认引用：

- `references/05-ops/fbs-source-of-truth-matrix.md`  
- `fbs-runtime-hints.json` → `gates`  

若版本升级，**先更新真源矩阵与 hints，再更新本规格附录版本号**。

---

*文档版本：1.0.0 · 可与 `fbs-continuous-improvement.md` 演进条目互链。*
