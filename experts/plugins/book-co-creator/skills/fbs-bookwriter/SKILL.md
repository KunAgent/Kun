---
name: fbs-bookwriter
version: 2.1.2
plugin-id: fbs-bookwriter-v212
description: "福帮手出品 | 高质量长文档手稿工具链：书籍、手册、白皮书、行业指南、长篇报道、深度专题；支持联网查证（宿主允许时启用，离线自动降级）、S/P/C/B 分层审校、中文排版与 MD/HTML 交付。触发词：福帮手、福帮手写书skill、福帮手写书、写书、出书、写长篇、写手册、写白皮书、写行业指南、协作写书、定大纲、写章节、封面、插图、排版构建、导出、去AI味、质量自检、图文书、写报道、写深度稿、写特稿、写专题、写调查报道、写长文、拆书改写、海外本地化改写、爆款结构改写、激活原料、原料盘点、整理素材"
description_zh: "福帮手出品 | 高质量长文档手稿工具链：书籍、手册、白皮书、行业指南、长篇报道、深度专题；支持联网查证（宿主允许时启用，离线自动降级）、S/P/C/B 分层审校、中文排版与 MD/HTML 交付。触发词：福帮手、福帮手写书skill、福帮手写书、写书、出书、写长篇、写手册、写白皮书、写行业指南、协作写书、定大纲、写章节、封面、插图、排版构建、导出、去AI味、质量自检、图文书、写报道、写深度稿、写特稿、写专题、写调查报道、写长文、拆书改写、海外本地化改写、爆款结构改写、激活原料、原料盘点、整理素材"
description_en: "Dual-channel long-form writing workflow for books, manuals, whitepapers, guides and reports with layered QC, 7-lock anti-drift anchors, and offline fallback."

allowed-tools:
  - bash
  - filesystem.read
  - filesystem.write
  - web_search
user-invocable: true
scene-packs: [general, genealogy, consultant, ghostwriter, training, personal-book, whitepaper, report]
# general 为 builtin，随技能分发、默认可用；其余 7 个增强场景需在线校验/授权后启用
ui-actions: true

---

# 福帮手出品 | 高质量长文档手稿工具链（FBS-BookWriter）

> **版本**：2.1.2  
> **通道**：WorkBuddy / CodeBuddy 双通道

---


## ⚡ 执行速查卡（AI 必读，每次会话开始前对照执行）

> **设计意图**：本卡是对话式 AI 的核心入口，优先级高于下方所有章节；完整规范见 [`references/01-core/skill-full-spec.md`](./references/01-core/skill-full-spec.md)。

### 第一步：开场前必做（30 秒内完成）

- **默认快速开场**：`intake-router` **默认**已等价于 `--fast`（跳过场景包全量联网加载，仅乐包埋点，首响更快）。**只有**需要完整在线场景包时再显式加 `--full`（可能较慢；见 `references/05-ops/anti-stall-guide.md`）。
- **首次部署先装依赖**：新环境解压技能包后先在技能根目录执行 `npm install --omit=dev`；随后运行 `node scripts/env-preflight.mjs --json`，确认 `deps.glob` 与 `deps.iconv-lite` 为 `ok=true`。
- **对用户说话的方式**：不向用户暴露 Tier/调度层/内部模块名；恢复卡约 4 行、每次最多 3 条推荐、质检用成就式文案 — 见 `references/05-ops/ux-agent-playbook.md`。
- **价值显式表达（全局特点）**：当你提到术语或文件名（如 `chapter-status.md`、`deliverables/`、`s0-exit-gate`）时，用一句话补充「这是做什么」+「对用户有什么价值」，避免只报名词不解释。
- **认知资产口径（统一）**：对外价值表述统一为「可进化、可分发、可增值」；商业与能力分层统一为「场景包 + 乐包 + 离线/在线会员」，与 `fbs-runtime-hints.json` → `cognitiveAsset` 及首响 `firstResponseContext.cognitiveAssetSnapshot` 对齐，避免各处口径不一。
- **首屏（只说「福帮手」时）**：先一句话状态 + **最多 3 个主选项**（写新书 / 接着写 / 质检或整理素材），勿首屏平铺长菜单；需求收齐后优先「一次性汇总确认再执行」— 见 `references/01-core/intake-and-routing.md`（WorkBuddy 实测复盘节）。
- **宿主与对话展示（P0）**：向终端用户**只展示** `intake-router --json` 中 `firstResponseContext.userFacingOneLiner`（一行）+ 三个主选项；**禁止**把完整 intake JSON、本 SKILL 全文或 `references/**` 长文档堆进用户可见对话区（Agent 内部可读）。恢复后**不要**无目的地 `list_dir` 整个 `.fbs/`（百级文件只会制造噪音）；**例外**：可用 `list_dir` 仅列**书稿根**以确认是否存在 `.fbs/` 子目录（见下条）；仅在用户要看结构/排障时再按需深入列目录。
- **项目锚定先行（P0）**：执行 `intake-router` 时若返回 `projectAnchor.status=ambiguous`，表示检测到多个候选项目根目录；**在用户确认 bookRoot 前，禁止读取任意 `.fbs/*` 内容**。先让用户确认路径，再用该路径重跑 `intake-router`。
- **渐进披露与场景包坐标（三波收口）**：`firstResponseContext.scenePackCoordinate` **仅提供** `scenePackId` 与 `references/scene-packs/<id>.md` 等**锚点相对路径**，不在首响向用户朗读全文；进入对应写作/质检阶段再 `read_file`。`session-resume-brief.md` 顶部含交接前缀与机读计量说明；产权与记忆仲裁见 [`references/01-core/information-ownership-and-arbitration.md`](./references/01-core/information-ownership-and-arbitration.md)。
- **宿主工具盲区（复盘 P0）**：部分宿主上 **`search_file` 不进入** dot-directory（`.fbs/`、`.workbuddy/` 等）。检查 `workbuddy-resume.json`、`esm-state.md`、`session-resume-brief.md` 等 **禁止**依赖 `search_file`；应 **`read_file` 直读已知路径**（`.fbs/…`），或 **`list_dir` 书稿根**确认 `.fbs/` 是否存在。**Found 0 不得**解读为「未初始化 FBS」。详见 [`references/01-core/skill-full-spec.md`](./references/01-core/skill-full-spec.md) §2.4。
- **禁止「元指令泄露」（P0）**：首句及正文**不要**复述内部执行口令（例如「按 v2.x 规范」「JSON 输出」「不重复读文件」「干净首屏」等）。这些是 Agent 自检用语，**不是**对用户说的话；直接输出 `userFacingOneLiner` 与人话选项即可。
- **S0 素材阶段防「无限 S0」（P0）**：素材**够用即可**；达标后**必须**提议进入 S1/S2，不得无期限响应细化要求。详见 [`references/01-core/s0-material-phase-guard.md`](./references/01-core/s0-material-phase-guard.md)。用户说「继续」若发生在**素材已达标**时，**优先作阶段推进**，而非默认「继续补素材」。
- **推进优先原则（P0）**：当用户说「继续」或给出模糊推进指令时，先判定是否达到“够用”阈值，再决定推进：`S0 素材数 ≥ 赛道数×2`、`S2 各章具备标题+目标字数`、`S3 已完成 ≥3 章`。达到即主动给出阶段切换建议；未达到则明确差距并继续当前阶段。
- **退出**：用户说退出前，**先问**「还需要别的吗」或说明会保存，再跑 `session-exit`（JSON 含 `agentGuidance.beforeExit`）。
- **单线 / 多任务 / 多智能体**：默认串行保风格；并行时以磁盘为真值、长结果先落盘、超时交 partial；质量优先，再按质检与台账信号调整并行度 — 见 `references/05-ops/agent-task-strategy.md`。
- **S3.5 扩写（复盘 P0）**：进入扩写前必须有 **书面** `.fbs/expansion-plan.md` 且用户确认；**扩写后字数必须以 `node scripts/expansion-word-verify.mjs` / `expansion-gate.mjs` 实测为准**，禁止仅报模型估算；`expansion-gate` **默认**会刷新 `chapter-status` 字数列并写 `.fbs/expansion-checkpoint.json`；写作类扩写 **并行≤3（推荐≤2，见 `fbs-runtime-hints.json`）**；**禁止**用 `code-explorer` 类子智能体承担正文扩写。全文规范见 [`references/01-core/s3-expansion-phase.md`](./references/01-core/s3-expansion-phase.md)。
- **触发保障（P0-G）**：脚本“存在”不等于“已触发”。阶段动作必须绑定门禁调用：`S0→S1` 前必跑 `s0-exit-gate`；`S3.5` 扩写前必跑 `expansion-gate`（含自动备份）；`S3.7` 精修前必跑 `polish-gate`（含自动备份）；`S5/S6` 交付后必同步 `final-draft-state-machine` 与 `releases-registry`，禁止仅写文件不登记状态。

> **S0 最小必填集降级方案（v2.1.1 新增，P0）**：若 `intake-router.mjs` 无法执行（Node.js 不可用或脚本报错），AI **必须** 手动引导用户完成以下最小集，**完成前不得进入 S3 成文**：
> 1. `author-meta.md`：核心主张（1句）+ 目标读者（1句）+ 作者声音标签（1个）+ 目标字数
> 2. `术语锁定记录.md`：5–10 个核心术语（标准写法 + 禁用变体）
> 3. `character-registry.md`：3–5 个预制案例人物（姓名 + 背景 + 适用场景）
> 4. `commitments.md`：创建空承诺注册表（承诺 / 出处 / 兑现章节 / 状态），待 ch00 成文后注册
> 
> 完成后在 `esm-state.md` 标记 `phase: S0_done`，方可推进至 S1。未完成须向用户说明原因，**禁止静默跳过**。

> **阶段推进门禁（v2.1.1 新增，P0）**：每次推进阶段前，AI 必须读取 `esm-state.md` 并检查前置条件，不满足时**拒绝推进**并向用户说明缺失项：
> 
> | 推进方向 | 前置条件 | 不满足时 |
> |---------|---------|---------|
> | S0 → S1 | `author-meta.md` 核心主张已填写 | 提示补填，不推进 |
> | S1 → S2 | 大纲已确认 + `story-bank.md ≥ 3 条` | 提示补案例 |
> | S2 → S3 | 目录已确认 + `commitments.md` 已创建 + 大纲冻结已登记（[`outline-freeze.md`](./references/01-core/outline-freeze.md) / `project-config.outlineFreezeVersion`） | 提示补冻结信息与变更单 |
> | S3 → S3.5（扩写，可选） | 用户明确要求「扩写/加厚」等 | 须先产出并确认 `.fbs/expansion-plan.md`，详见 [`s3-expansion-phase.md`](./references/01-core/s3-expansion-phase.md)；**禁止**无计划开工 |
> | S3.5 → S3.7（精修，可选） | 用户要求润色、收口事实、去重等 | 见 [`s3-refinement-phase.md`](./references/01-core/s3-refinement-phase.md)；`esm-state.iterationPhase` 可置 `refinement` |
> | S3.5 / S3.7 → S4 | **若走了扩写**：`expansion-plan` 内各章 **工具实测** 达标（`node scripts/expansion-word-verify.mjs` 或 `node scripts/expansion-gate.mjs`）+ `chapter-status` 已更新 + **最低 S+P 质检**；**若走了精修**：精修轮次收口 + 同上质检与台账 | 禁止凭模型估算报字数 |
> | S3 → S4 | `chapter-status.md` 全部标「成文」；**若本书走过 S3.5/S3.7**，须已满足上行收口条件 | 提示未完成章节或未收口扩写/精修 |
> | S4 → S5 | S4 质检 20 条逐条通过 + 字数完成度 ≥ 50% | 提示不达标项 |

```text
1. 强制入口（首次 / bookRoot 变更 / 仅激活时都先执行）：
   node scripts/intake-router.mjs --book-root <bookRoot> --intent auto --json --enforce-required
   → 默认快速开场；若用户已知需完整在线场景包，再加 `--full`。可按书名关键词检索历史书稿目录：`--search <关键词>`（依赖曾成功退出后登记在 ~/.workbuddy/fbs-book-projects.json 的索引）。
   → 该脚本会自动完成：宿主检测、恢复卡补写、session-resume-brief 补写、首响路由判断

2. 恢复优先（按脚本输出执行，不要先 list_dir 再反推状态）：
   - IF exists(.fbs/workbuddy-resume.json) → 读取恢复卡 → 恢复会话
   - ELSE IF exists(.fbs/chapter-status.md) → 读取章节台账 → 自动补写恢复卡后恢复
   - ELSE → 进入 S0.5 轻量引导

3. 融合顺序：
   - 先读 .fbs/workbuddy-resume.json
   - 再读 .fbs/smart-memory/session-resume-brief.md
   - 再吸收宿主画像 / 宿主记忆

4. 禁止重复读取：SKILL.md 已由 use_skill 注入上下文，本次会话内禁止再次 read_file 读取 SKILL.md

5. 阶段推荐上限：每次最多 3 条用户可执行的下一步动作（与 `.fbs/next-action.md` 写入规则一致）。
```

> **架构盲区（审计 P0，必读）**：宿主把本 Skill 当作「参考文档」注入时，**不会**自动执行任何 `node scripts/…`。若你**未**运行上表第 1 步的 `intake-router.mjs`，则视为 **FBS 流程未启动**：`.fbs/esm-state.md` 可能仍停在 IDLE、场景包/乐包埋点（`loadScenePack` → `registerBook`）未经过开场路径。合规主文档：[`references/01-core/runtime-mandatory-contract.md`](./references/01-core/runtime-mandatory-contract.md)。

> **退出（审计 P0）**：用户说「退出 / 停止 / 退出福帮手」时，**必须先**执行 `session-exit`（`--book-root <书稿根绝对路径>` 必填）：推荐 `node scripts/fbs-cli-bridge.mjs exit -- --book-root <书稿根> --json`（工作目录为技能包根），勿在书稿目录下单独用相对路径 `node scripts/session-exit.mjs`。再回复用户；回复须包含脚本 JSON 中的 **`userMessage`**（「已记录当前状态。下次输入『福帮手』可从上次位置继续。」），禁止仅用「收到」等敷衍收束。


### 第二步：意图 → 脚本 触发速查

| 用户说了什么 | 立即执行 | 备注 |
|------------|---------|------|
| 首次进入 / `bookRoot` 变更 / 仅激活 | `node scripts/intake-router.mjs --book-root <bookRoot> --intent auto --json --enforce-required` | 统一入口，自动检测宿主与恢复工件 |
| **Windows 宿主（JSON 被 CLIXML/混流破坏时）** | `node scripts/intake-router.mjs --book-root <bookRoot> --intent auto --json --json-out .fbs/intake-router.last.json --enforce-required` | 与上等价，**JSON 落盘**；读完 `.fbs/intake-router.last.json` 再解析（见 [`references/05-ops/windows-host-cli.md`](./references/05-ops/windows-host-cli.md)） |
| **拆书式改写**（旧书升级 / 海外落地 / 爆款重构） | `node scripts/intake-router.mjs --book-root <bookRoot> --intent rewrite --json --enforce-required` | 先锁定来源边界与改写模式，再按 S3 串行约束推进（每轮最多 2 文件） |
| 拆书改写计划模板 | `node scripts/rewrite-plan-bootstrap.mjs --book-root <bookRoot> --json` | 生成 `.fbs/rewrite-plan.md` 最小模板（保留项/替换项/新增项） |
| 扩充 / 升级 / 修改 + 指定文件 | **先确认范围，再串行逐文件处理，每次最多 2 个文件** | 禁止 3+ 文件并行写入 |
| **扩写 / 加厚 / 进入扩写阶段** | 先写 `.fbs/expansion-plan.md` 并经用户确认 → 再执行；扩写前可跑 **`node scripts/verify-expansion-plan-structure.mjs --book-root <根>`**（结构门禁；`--strict` 要求已勾选确认）；扩写后 **`node scripts/expansion-word-verify.mjs`** 或 **`node scripts/expansion-gate.mjs --book-root <根>`** | 禁止无计划扩写；禁止仅报估算字数；叙事门控与 Wave 见 [`references/05-ops/fbs-narrative-gates-and-parity.md`](./references/05-ops/fbs-narrative-gates-and-parity.md) |
| **素材 vs 计划（启发式）** | `node scripts/expansion-plan-vs-material.mjs --book-root <根>` | 可选 |
| **相邻章重叠预警** | `node scripts/adjacent-chapter-similarity.mjs --file-a <a.md> --file-b <b.md>` | 可选 |
| **按台账顺序扫相邻章** | `node scripts/scan-adjacent-chapters.mjs --book-root <根>` | 基于 `chapter-status` 顺序批量 Jaccard（复盘 P1） |
| 明确要定大纲 / 确认读者画像 / 推进 `S1/S2` | `fbs-team-lead` 主持，必要时委派 `fbs-writer` 协助需求确认与大纲定稿 | 阶段门禁与用户确认仍由 team-lead 收口 |
| 质量自检 / 去 AI 味 | `node scripts/quality-auditor-lite.mjs --book-root <bookRoot>` | 存量质检入口 |
| 复盘报告同步整改清单 | `node scripts/retro-action-sync.mjs --book-root <根> [--report <报告.md>] [--enforce-p0]` | 从 `.fbs/福帮手运行复盘报告*.md` 提取待整改项，产出 `.fbs/retro-action-items.json` 与 `.fbs/retro-unresolved.md` |
| 复盘候选沉淀（Action→Skill） | `node scripts/retro-to-skill-candidates.mjs --book-root <根> [--json]` | 将未修复整改项转为可复用流程候选，输出 `.fbs/retro-skill-candidates.json` |
| 运行时阶段提醒（Nudge） | `node scripts/runtime-nudge.mjs --book-root <根> [--json]` | 基于 `esm-state` + 复盘项生成本轮必做/可选提醒，输出 `.fbs/runtime-nudges.json` |
| 终稿状态机 | `node scripts/final-draft-state-machine.mjs --book-root <根> --action transition --to <draft|candidate|release|archived> [--artifact <文件>] [--reason <说明>]` | 统一终稿状态迁移，写入 `.fbs/final-draft-state.json`，并记录产物 hash |
| **终稿治理器（唯一终稿）** | `node scripts/release-governor.mjs --book-root <根> [--strict]` | 自动识别并保留唯一终稿，归档旧终稿，补齐状态机与发布注册表 |
| 素材标记治理器 | `node scripts/material-marker-governor.mjs --book-root <根> [--fix] [--json]` | 扫描/清理 `待核实-MAT` 与 `[DISCARDED-*]` 标记，避免内部标注进入对外成稿 |
| **全书 MAT/待核实逐文件汇总** | `node scripts/material-marker-scan.mjs --book-root <根> --output .fbs/material-marker-scan.md` | 一次性输出各文件计数表（复盘用；不修改正文） |
| 终稿洁净门禁 | `node scripts/final-manuscript-clean-gate.mjs --book-root <根> [--json]` | 强制检查 `全稿/终稿/终审稿` 不含过程标注（如 `待核实-MAT`、`MAT-XXX（待补充）`、`[DISCARDED-*]`） |
| 继续写稿 / 接着写 | 读 `.fbs/workbuddy-resume.json` 或 `.fbs/chapter-status.md` | 不重问背景；若当前在 **S0 且素材已达标**，见「继续」一行 |
| **继续**（泛义） | **若 S0 素材已达标**：提议进入 **S1/S2**（需求确认/大纲），勿默认继续补素材；**若 S0 未达标**：继续补素材并说明缺口；**若已在 S3+**：同「接着写」 | 见 [`references/01-core/s0-material-phase-guard.md`](./references/01-core/s0-material-phase-guard.md) §3 |
| 退出 / 退出福帮手 / 停止 | `node scripts/session-exit.mjs --book-root <bookRoot> --json` | 默认先保存恢复卡与会话摘要，再确认退出 |
| 看看能做什么 | `list_dir` 最多 2 层 | 不先全量读文件 |
| 初始化书房 / 新建项目 | `node scripts/init-fbs-multiagent-artifacts.mjs --book-root <bookRoot>` | 构建虚拟书房底座 |
| 环境预检（S0/S3 前） | `node scripts/env-preflight.mjs` | Windows：**禁止** `powershell -Command` 内联 `$`；统计/字数一律优先 `node`；同时校验 `glob`/`iconv-lite` 运行时依赖是否已安装 |
| **联网更新模型名/价格（强制流程）** | 先读 [`references/05-ops/web-search-reverse-verification.md`](./references/05-ops/web-search-reverse-verification.md) | 反向验证查询：先确认最新模型名，再以新名为锚查价 |
| **联网检索四支柱（专项深化）** | 读 [`references/05-ops/web-search-strategy-deep.md`](./references/05-ops/web-search-strategy-deep.md) | 知识截止补强、时效锚定、时态验证、方法论与技能知识库增强 |
| **S0退出门禁（强制）** | `node scripts/s0-exit-gate.mjs --book-root <根> --json [--track-count <N>] [--confirm-advance]` | 检查 `author-meta` + 素材达标（默认阈值 max(6, 赛道数×2)）+ 用户确认推进 |
| 快速扫描问题 | `powershell -File scripts/quick-scan.ps1 -BookRoot <bookRoot> -Output <path.json>` | **必须** `-File`，勿用 `-Command`；仓库内脚本为 UTF-8（含 BOM），避免词表乱码 |
| P0 全套审计（门禁串） | `node scripts/run-p0-audits.mjs <书稿根>` 或 `--book-root <书稿根>` | `--skill-root` 可省略（默认脚本所在技能根）；产出 `.fbs/p0-audit-report.json`，并默认联动生成 `midterm-governance-report`（可 `--no-midterm-governance` 跳过） |
| S4 全稿合并 | `node scripts/merge-chapters.mjs --book-root <根> --output deliverables/[S4]书名.md [--record-artifacts]` | 跨平台；`--record-artifacts` 写入 `.fbs/merge-chapters.last.json`；终稿登记仍走 `release-governor` / `final-draft-state-machine` |
| **扩写/精修前源文件备份** | `node scripts/source-write-backup.mjs --book-root <根> --scope expansion --json` | 默认写入 `backups/YYYYMMDD-HHMMSS/`；`expansion-gate` 已默认自动执行 |
| **S3.7 精修门禁（含备份）** | `node scripts/polish-gate.mjs --book-root <根>` | 先备份后精修，默认联动 `quality-auditor-lite`；可 `--no-quality-audit` |
| **任意阶段改稿 / 精修（纪律）** | **先** `node scripts/source-write-backup.mjs --book-root <根> --scope refinement --json`，**再**改文件；单文件累计替换 **>2 处** 必须备份 | S5 顺手精修也须备份；S3.7 优先整包走 `polish-gate` |
| 台账字数对齐 | `node scripts/sync-chapter-status-chars.mjs --book-root <根>` | 扩写后刷新 `.fbs/chapter-status.md` 字数列 |
| 一书稿健康快照 | `node scripts/book-health-snapshot.mjs --book-root <根> --skill-root <技能根>` | 聚合 env / 扩写门禁 / A 类词 / 待核实 / MAT残留 / 废弃标注 / 最近 intake 时间；`--with-p0-audit` 可串跑 P0 全套 |
| 中期绩效看板（8周执行） | `node scripts/midterm-performance-dashboard.mjs --book-root <根> --days 7 --json` | 自动生成 `.fbs/governance/midterm-performance-dashboard-<week>.json/.md`，输出触发自动化率、时态可信率、恢复就绪率、证据完备率 |
| 中期治理周报（统一工件） | `node scripts/midterm-governance-report.mjs --book-root <根> [--week-label 2026-W16] --json` | 汇总 `门禁状态 + KPI + 整改建议` 到 `.fbs/governance/midterm-governance-report-<week>.json/.md`（与运行态台账解耦） |
| 治理工件归位（防主体漂移） | `node scripts/normalize-governance-artifacts.mjs --book-root <根> [--dry-run] [--prune-duplicates] [--prune-on-exists] --json` | 将误落在 `.fbs/reports` 的 `midterm-*` 工件迁移回 `.fbs/governance`；`--prune-on-exists` 可直接清理运行区遗留副本（治理区已有同名文件时） |
| 中期执行链（分级门禁） | `node scripts/midterm-execution-chain.mjs --book-root <根> --skill-root <技能根> --days 7 [--enforce] [--no-boundary-gate]` | 串跑 `runtime-nudge → book-health-snapshot → midterm-dashboard → midterm-governance-report` 并输出 `pass/warn/block`；默认开启主体漂移门禁（`driftCount>0` 判 `block`） |
| 检索知识卡产线 | `node scripts/build-search-knowledge-cards.mjs --book-root <根> --json` | 将 `.fbs/search-ledger.jsonl` 结构化为 `.fbs/governance/search-knowledge-cards.json/.md` |
| 知识复用率 KPI | `node scripts/knowledge-reuse-kpi.mjs --book-root <根> --json` | 统计知识卡被正文回引比例（URL 或 `[KC:<id>]`），输出 `.fbs/governance/knowledge-reuse-kpi.json` |
| 高风险双源门禁 | `node scripts/high-risk-dual-source-gate.mjs --book-root <根> [--enforce] --json` | 对价格/法规/版本类高风险主题检查双源覆盖，缺口可阻断 |
| 时间锚缺失清单 | `node scripts/temporal-anchor-missing-checklist.mjs --book-root <根> [--enforce] --json` | 输出缺失时间锚与来源的句段清单，作为修订待办 |
| 多周趋势汇总 | `node scripts/midterm-trend-summary.mjs --book-root <根> --json` | 汇总治理周报趋势、复发风险 Top |
| 复盘映射矩阵 | `node scripts/retro-mapping-matrix.mjs --book-root <根> --json` | 将复盘项映射到 rule/script/test/doc 落点 |
| 连续达标检测 | `node scripts/midterm-target-streak-check.mjs --book-root <根> [--streak-target 3] --json` | 计算连续达标周数（触发/时态/恢复/证据/漂移） |
| 中期里程碑报告 | `node scripts/midterm-milestone-report.mjs --book-root <根> [--week-label <YYYY-Www>] --json` | 一键生成中期收口报告（趋势 + 映射 + 连续达标 + 复用率） |

> 交付硬约束：素材核实/待补充等写作过程信息不应出现在作品中；**全稿/终稿/终审稿绝对禁止**保留此类标注，发布前必须通过 `final-manuscript-clean-gate`。

### 质量标准化硬约束（防歧义 / 防偷懒）

- **先证据后结论**：凡是“已完成/已通过/已修复”，必须给出可复核证据（脚本命令、输出文件路径、门禁结果）；禁止口头宣称完成。
- **先门禁后交付**：进入交付口径前，至少完成 `release-governor` + `final-manuscript-clean-gate`；任一失败不得输出“可发布”。
- **先明确边界再执行**：用户请求含糊时，先确认范围（目录/章节/阶段）；禁止“默认全量改动”。
- **先最小改动再扩面**：默认逐文件、逐阶段推进；未经确认不得做大范围批量替换。
- **结果可追溯**：每轮动作必须落地到 `.fbs/` 或 `releases/` 的可追溯工件，避免只存在于对话描述。
- **版本口径单一**：对外统一使用 `2.1.1` 基线；历史版本仅引用 `docs/history/version-baseline-v2.1.1.md`，不展开内部迭代流水。
| 台账字数漂移检测 | `node scripts/chapter-status-drift.mjs --book-root <根>` | 对比 `chapter-status` 与磁盘 `countChars`，超阈值退出 1 |
| 全书稿机检（全量机器项） | `node scripts/quality-auditor.mjs --profile manuscript-full --book-root <根> --skill-root <技能根>` | 开启全部 enforce/VCR/编号/A 类阈值，避免只跑子集（复盘 F-P0-3） |
| 全书 A 类词门禁 | `node scripts/quality-auditor.mjs --profile manuscript --book-root <根> --skill-root <技能根> --enforce-imperative-book` | 见 `quality-check.md` §0.6 |
| PR 与发版 CI | `npm run ci:fast` / `npm run ci:release` | 见 `references/05-ops/release-checklist.md` §0 |
| 记忆 / 偏好查看 | `node scripts/smart-memory-core.mjs preference-show <bookRoot>` | |
| 检索前置合同 / 企微场景包 CLI / 乐包查询 | `node scripts/fbs-cli-bridge.mjs help` | 统一入口，**非 MCP**；完整矩阵见 [`references/01-core/skill-cli-bridge-matrix.md`](./references/01-core/skill-cli-bridge-matrix.md)；乐包规则见 [`references/05-ops/credits-guide.md`](./references/05-ops/credits-guide.md) |


### 第三步：写作执行约束（S3 阶段强制）

```text
串行原则：每轮最多修改 2 个文件。完成 1 个文件 → 汇报结果 → 再进行下一个。
可见性：修改前说明“我接下来修改哪个文件、改哪几处、大概需要多久”。
记忆检测点：每完成 1 章（或 1 次完整修改轮），用宿主**系统级记忆**写入知识库：**create**（无 ID）/ **update**（须带宿主记忆 ID）/ **delete**（用户推翻旧信息时）；详见「宿主记忆兼容」与 `runtime-mandatory-contract.md` §5。
防卡顿：单文件操作超过 30 秒无输出时，输出一行进度提示。
```

### 第三步（附）：S3.5 扩写阶段强制

```text
计划：无用户确认的 .fbs/expansion-plan.md → 不得改写正文扩写。
字数：改写后必须用 node scripts/expansion-word-verify.mjs 实测；对用户汇报的字数必须与脚本一致。
并行：扩写类任务并行章数 ≤3（推荐≤2）；禁止 code-explorer 式子智能体写正文。
台账：每章扩写验证通过后更新 chapter-status.md（字数、时间）；可用 `node scripts/sync-chapter-status-chars.mjs --book-root <根>` 按磁盘真值对齐字数列。
中断：用户取消并行任务时，扫描目标文件差异，必要时回滚或合并 .expanded.md 临时稿。
```

### 第四步：按需加载（降低上下文噪音）

```text
本次会话用不到 → 不主动读取：
  - references/scene-packs/               → 仅在用户触发体裁场景包时读取
  - references/02-quality/                → 仅在进入 S4 质检阶段时读取
  - references/05-ops/search-policy.json  → 仅在进入 S0/S1/S2 检索时读取
  - references/01-core/skill-full-spec.md → 仅在需要完整规范、边界或细则时读取

S3 分卷按需加载（防卡顿）：
  - workflow-s3.md            → 仅加载导航入口（索引页，约 20 行）
  - workflow-s3-core.md       → 开始 S3 前必读（入口条件/Auto-Run/骨架检测）
  - workflow-s3-writing-guide.md → 进入正式写稿时加载（Brief 格式/评分流程）
  - workflow-s3-closure.md    → S3 全部章节写完时加载（收口清单/S4 进入条件）
  禁止一次性 read_file 全量加载上述三个子卷。
```

---

## 一句话定位

**福帮手是一套专为 3 万字以上长文档手稿设计的 AI 写作与交付工具链**，覆盖 S0–S6 工作流、S/P/C/B 四层质检、8 大场景包、跨会话恢复、宿主画像桥接，以及 MD/HTML 为主的多格式交付。

## 触发词（显式植入）

- **主触发描述**：福帮手出品 | 高质量长文档手稿工具链：书籍、手册、白皮书、行业指南、长篇报道、深度专题；支持联网查证（宿主允许时启用，离线自动降级）、S/P/C/B 分层审校、中文排版与 MD/HTML 交付。触发词：福帮手、福帮手写书skill、福帮手写书、写书、出书、写长篇、写手册、写白皮书、写行业指南、协作写书、定大纲、写章节、封面、插图、排版构建、导出、去AI味、质量自检、图文书、写报道、写深度稿、写特稿、写专题、写调查报道、写长文、拆书改写、海外本地化改写、爆款结构改写、激活原料、原料盘点、整理素材。
- **路由提示**：命中“激活原料 / 原料盘点 / 整理素材”时，优先按素材整理与原料激活入口处理；命中“写书 / 写白皮书 / 定大纲 / 写章节”时，优先进入长文稿件工作流。

## 核心导航（先看这些）

| 场景 | 文档 |
|------|------|
| 完整规范 | [`references/01-core/skill-full-spec.md`](./references/01-core/skill-full-spec.md) |
| 工作流总入口 | [`references/01-core/section-3-workflow.md`](./references/01-core/section-3-workflow.md) |
| 分阶段详规 | `workflow-volumes/workflow-s0.md` ～ `workflow-volumes/workflow-s6.md` |
| 快速起步 / 路由 | [`references/01-core/intake-and-routing.md`](./references/01-core/intake-and-routing.md) |
| **S3.5 扩写**（计划 · 字数实测 · 并行≤3） | [`references/01-core/s3-expansion-phase.md`](./references/01-core/s3-expansion-phase.md) |
| **S3.7 精修** | [`references/01-core/s3-refinement-phase.md`](./references/01-core/s3-refinement-phase.md) |
| **真源矩阵 / 发版** | [`references/05-ops/fbs-source-of-truth-matrix.md`](./references/05-ops/fbs-source-of-truth-matrix.md) |
| **运行复盘模板** | [`references/05-ops/fbs-run-retrospective-template.md`](./references/05-ops/fbs-run-retrospective-template.md) |
| 质量评分权威 | [`references/02-quality/quality-check.md`](./references/02-quality/quality-check.md) |
| S 层规则权威 | [`references/02-quality/quality-S.md`](./references/02-quality/quality-S.md) |
| P/C/B 规则权威 | [`references/02-quality/quality-PLC.md`](./references/02-quality/quality-PLC.md) |
| 场景包激活与降级 | [`references/01-core/scene-pack-activation-guide.md`](./references/01-core/scene-pack-activation-guide.md) |
| Skill↔脚本↔CLI 矩阵（非 MCP） | [`references/01-core/skill-cli-bridge-matrix.md`](./references/01-core/skill-cli-bridge-matrix.md) |
| 单智能体/多任务/多智能体编排 | [`references/05-ops/agent-task-strategy.md`](./references/05-ops/agent-task-strategy.md) |
| 维护者 / CI：轨迹 · 演进 · 压缩策略 | [`references/05-ops/fbs-continuous-improvement.md`](./references/05-ops/fbs-continuous-improvement.md) · [`references/01-core/skill-index.md`](./references/01-core/skill-index.md)（平台侧索引） |
| 用户向价值一页纸（培训/采购） | [`references/03-product/fbs-value-one-pager.md`](./references/03-product/fbs-value-one-pager.md) |
| 认知资产「三化」与商业机制对齐 | [`references/05-ops/cognitive-asset-threeization.md`](./references/05-ops/cognitive-asset-threeization.md) |
| 文档总索引 | [`references/01-core/skill-index.md`](./references/01-core/skill-index.md) |


### workflow-volumes 分卷阅读（推荐）

- [`references/01-core/workflow-volumes/workflow-s0.md`](./references/01-core/workflow-volumes/workflow-s0.md)
- [`references/01-core/workflow-volumes/workflow-s1.md`](./references/01-core/workflow-volumes/workflow-s1.md)
- [`references/01-core/workflow-volumes/workflow-s2.md`](./references/01-core/workflow-volumes/workflow-s2.md)
- [`references/01-core/workflow-volumes/workflow-s2.5.md`](./references/01-core/workflow-volumes/workflow-s2.5.md)
- [`references/01-core/workflow-volumes/workflow-s3.md`](./references/01-core/workflow-volumes/workflow-s3.md) — **导航入口**（索引页，按需再加载以下子卷）
  - [`workflow-s3-core.md`](./references/01-core/workflow-volumes/workflow-s3-core.md) — 入口条件 · Auto-Run · 骨架检测（开始 S3 前必读）
  - [`workflow-s3-writing-guide.md`](./references/01-core/workflow-volumes/workflow-s3-writing-guide.md) — 写稿规范 · Brief 格式 · 评分流程
  - [`workflow-s3-closure.md`](./references/01-core/workflow-volumes/workflow-s3-closure.md) — 收口清单 · S3→S4 进入条件
- [`references/01-core/workflow-volumes/workflow-s4.md`](./references/01-core/workflow-volumes/workflow-s4.md)
- [`references/01-core/workflow-volumes/workflow-s5.md`](./references/01-core/workflow-volumes/workflow-s5.md)
- [`references/01-core/workflow-volumes/workflow-s6.md`](./references/01-core/workflow-volumes/workflow-s6.md)

---

## 场景包速查（8 大垂直场景）

| 包名 | 触发场景 | 默认策略 |
|------|---------|---------|
| `general` | 通用书籍 / 知识类 | **builtin 内置场景**，默认启用且无需授权 |
| `genealogy` | 家谱 / 家史 | 自动识别，需通过在线校验；未满足条件则回退 `general` |
| `consultant` | 顾问 / 咨询报告 | 自动识别，需通过在线校验；未满足条件则回退 `general` |
| `ghostwriter` | 代撰 / 影子写作 | 自动识别，需通过在线校验；未满足条件则回退 `general` |
| `training` | 培训教材 / 课程 | 自动识别，需通过在线校验；未满足条件则回退 `general` |
| `personal-book` | 自传 / 回忆录 | 自动识别，需通过在线校验；未满足条件则回退 `general` |
| `whitepaper` | 白皮书 / 研究报告 | 自动识别，需通过在线校验；未满足条件则回退 `general` |
| `report` | 调查报告 / 深度报道 | 自动识别，需通过在线校验；未满足条件则回退 `general` |


### 四级降级链（固定口径）

```text
disk_cache → offline_cache → local_rule → no_pack
```

- `local_rule`：先读取 `references/scene-packs/<包名>-local-rule.md`，再叠加 `references/scene-packs/<包名>.md`
- `no_pack`：必须显式告知“当前以通用规范执行，场景包不可用”，禁止静默降级

---

## 宿主与通道说明

### 双通道分轨

- 源仓库采用 **WorkBuddy / CodeBuddy 双通道**：
  - `.codebuddy-plugin/plugin.json` → `codebuddy/channel-manifest.json`
  - WorkBuddy 审核包 → `workbuddy/channel-manifest.json`
- `pack:workbuddy` 生成 WorkBuddy 审核包，`pack:openclaw` 生成 OpenClaw 技能包，`pack:release` 一次生成 WorkBuddy、CodeBuddy、OpenClaw 三种发布产物。
- 宿主真值统一以 `node scripts/host-capability-detect.mjs --book-root <bookRoot>` 的输出为准；首响的 `intake-router.mjs` 会自动调用该探测。
- Tier1 本地市场能力只在 **WorkBuddy** 可用；**CodeBuddy** 走 Tier2 宿主插件与内置脚本兜底。


### Full Team 与并行口径

- **Full Team 完全可用**，不是宿主能力缺失。
- 风险点在 **任务拆分、写入隔离、team-lead 编排、成员失响恢复**，而不在“是否支持并行”。
- 正文写作默认不主动推荐 Full Team，但用户明确要求且边界清晰时可直接使用 Team API。

### 宿主记忆兼容

- 宿主记忆目录采用 **`memory/` 优先，兼容 legacy `memery/`** 的双读策略。
- 恢复链路统一以 `.fbs/workbuddy-resume.json`、宿主画像桥接与 Smart Memory 为准。
- **系统级记忆 API**（由宿主提供，名称以宿主实现为准，如 `create_memory` / `update_memory` / `delete_memory`）：
  - **create**：新建一条宿主记忆（无既有 ID 时）。
  - **update**：更新已有记忆，**须携带宿主分配的记忆 ID**。
  - **delete**：用户**推翻、否定**先前结论时删除对应条目，再视需要用 create 写入新真值。
- 书稿级长篇状态仍以 **`.fbs/smart-memory/` 与脚本落盘**为准；宿主记忆宜存 **短摘要、可检索关键词**，与 team-lead 中「关键时刻写宿主知识库」规则一致。

---

## 已知限制与执行边界

### 入口去术语化

首响优先说人话，先说明“先整理材料 / 先明确主题 / 先一起找方向”，不要把 `S0`、`WP1`、`虚拟书房` 等内部术语直接甩给用户。

### WP1/WP2 绑定

- `WP1` = 起步工作面：先确认材料、主题、方向三分流
- `WP2` = 书稿工作面：`.fbs/` + `deliverables/` + `releases/`
- `WP1` 锁定后再进入 `WP2`，禁止在起步阶段提前展开质检 / 发布术语

### 首个可用工作面固定

完成工作区初始化后，默认把 `.fbs/`、`deliverables/`、`releases/` 视为首个可用工作面，并先向用户说明“资料 / 进度 / 交付都在当前工作区”。

### workspace 真值边界

项目真值只落在当前 `bookRoot` 的 `.fbs/`、`deliverables/`、`releases/`；宿主记忆、artifact 文档、对话摘要不能替代工作区真值。

### 搜索前置合同

进入 `S0 / S1 / S2` 检索前，先用一句话说明：**为什么查、查什么、查完进哪一步、离线时如何降级**。未宣告不得把联网搜索当静默背景动作。

**专项深化（四支柱）**：模型存在知识截止，须用联网**补足事实真值**；检索须**锚定最新时间**避免旧页误导；对结论做**时态验证**（来源日期、同页多版本、第二来源）；检索结果应**沉淀**到 ledger/原料并反哺本书与 Skill 方法论——详见 [`references/05-ops/web-search-strategy-deep.md`](./references/05-ops/web-search-strategy-deep.md)。

### 轻量入口优先

当用户只说“福帮手 / 写书 / 继续”时，优先走恢复卡、工作面判断与自然语言引导；不要先全量扫描仓库。

### 上下文复用优先

已有上下文时，**不得重复 `list_dir + read_file`** 去重新扫同一批文件；先复用恢复卡、章节台账与宿主记忆。

### 全景质检默认增量

默认先走 `quality:audit:incremental`；只有范围扩大或风险升高时，再升级到 Panorama / Deep。

### 超时与收束

长任务必须设置超时、允许返回 partial 结果，并向用户说明已完成范围、剩余范围与建议下一步。

### 大段删改（replace 失败时）

同一文件需删除或替换大段正文时：**先通读目标区间**，再尽量 **单次** `replace` 完整旧块；若工具对过长 `old_string` 不稳定，改为 **分小段顺序替换** 或 **重写该小节片段**（先备份），避免无反馈重试。用户选数字菜单后，先复述「你选的是 [n]，将处理 ××」再动手（杜氏审计 P1-01 / P1-02）。

### 退出处理（命中“退出 / 退出福帮手 / 停止”时强制）

默认先执行 `node scripts/session-exit.mjs --book-root <bookRoot> --json`，写入：
- `.fbs/workbuddy-resume.json`
- `.fbs/smart-memory/session-resume-brief.md`

若以 `--json` 调用，标准输出对象固定包含：
- `saved`：是否写盘成功
- `bookRoot`：本次处理的书稿根目录
- `note`：附加备注；未传时为 `null`
- `files.resumeCard / files.memoryBrief / files.memorySnapshot`：实际落盘路径
- `snapshotSummary.currentStage / bookTitle / nextSuggested / wordCount / chapterCount / completedCount`：恢复摘要字段
- `sessionChangeSummary`：git 可用时含 `changedFiles`（与恢复卡钉住同一份列表）
- `userMessage`：给用户的标准恢复提示（git 有变更时另附一行「可核对变更路径 N 条」）
- 恢复卡 `.fbs/workbuddy-resume.json` 含 `lastAction`、`nextRecommendations`（与 `nextSuggested` 同义）、`modifiedFiles`（git 可用时），供杜氏类审计要求的「退出可量化、下次可续」

随后再回复用户：**已记录当前状态，下次输入“福帮手”可继续**。只有用户明确说“不保存”，才允许跳过写盘直接退出。

**兜底（宿主未执行脚本时）**：若无法运行 `session-exit`，至少人工更新 `workbuddy-resume.json` 的 `lastAction` 与 `modifiedFiles`（或 `session-resume-brief.md` 中写明本次改动文件），避免再次出现「改了稿但恢复卡为空」。


### 规模与质检策略（合并口径）

**单一真源**：[`references/05-ops/scale-tiers.json`](./references/05-ops/scale-tiers.json)（写作策略档位 + `xl-project-init` 成稿字符分档）。脚本：`scripts/lib/scale-tiers.mjs`、`node scripts/xl-project-init.mjs`、`node scripts/writing-contract-gate.mjs`。

| 规模 | 文件 / 章节数 | 字数级别 | 默认策略 |
|------|---------------|---------|---------|
| S | ≤10 | ≤5万 | 全量精检 |
| M | 11-50 | 5-50万 | Panorama → Deep |
| L | 51-150 | 50-200万 | Panorama + 高风险抽样精检 |
| XL | >150 | >200万 | 分卷 / 分目录批次执行 |

> 目标范围 **> 50** 时，先说明推荐策略与预计耗时，再决定是否继续全量扫描。

---

## 质检与交付速记

### 四层质量体系

| 层 | 定位 | 当前规则数 |
|---|---|---:|
| S | 句级 | 6（+ A类词扩充：必须/务必/绝不能） |
| P | 段级 | 4（+ 承诺兑现率 附加必检项） |
| C | 章级 | 5（C5 章节衔接升级为 P1 强制项） |
| B | 篇级 | 6（`B0/B1/B2_1/B2_2/B2_C/B3`，+ 品牌植入合规 附加必检项） |

> **v2.1.1 变更**：C5 从「建议项」升级为 P1 强制，不区分串行/并行。S4 质检须输出 20+3 条完整勾选表，字数完成度 < 50% 时不得判「通过」。

### 评分公式

```text
综合分 = (S + P + C + B) ÷ 4
```

| 层 | 计算方式 | 规则来源 |
|---|---|---|
| S | 通过条数 ÷ 6 × 10 | [`quality-S.md`](./references/02-quality/quality-S.md) |
| P | 通过条数 ÷ 4 × 10 | [`quality-PLC.md` §P](./references/02-quality/quality-PLC.md) |
| C | 通过条数 ÷ 5 × 10（C5 升级为 P1 强制，纳入计分） | [`quality-PLC.md` §C](./references/02-quality/quality-PLC.md) |
| B | 通过条数 ÷ 6 × 10 | [`quality-PLC.md` §B](./references/02-quality/quality-PLC.md) |

> B 层当前机读项固定为 `B0 / B1 / B2_1 / B2_2 / B2_C / B3`，与 `quality-check.md`、`quality-PLC.md`、reviewer 定义保持一致。

### G 分项：门禁制

```text
G = pass / fail（不并入综合分，单独列示）
```

- 任一 G 项触发红灯，该章或该轮结果**不得宣称通过**，即使综合分 ≥ 7.5
- G 结果必须与综合分并列展示，不能只报分不报门禁
- G 分项适用于：事实核查、版权核查、数据来源核查、定制规范核查等人工复核场景
- 通过条件：综合分 ≥ 7.5 **且** G 全绿；否则为弱通过或不通过

> 完整 G 分项定义见 [`quality-check.md` §1.4](./references/02-quality/quality-check.md)。

### 结果展示

- 先执行 `node scripts/host-consume-presentation.mjs --book-root "<bookRoot>" --json`，由宿主统一解析最终展示入口
- `workbuddy/channel-manifest.json` 中的 `presentationConsumer` 是**宿主结果展示入口**，负责返回下一步 `hostAction`，不是**自动执行脚本**
- 有 HTML 时优先走 `preview_url`
- 非 HTML 结果再走 `open_result_view`
- 仅返回 `hostAction` / `url` / `target_file` 不等于“已经打开”；宿主仍需实际调用 `preview_url` / `open_result_view`
- 禁止把 `references/`、`SKILL.md`、`.fbs/` 台账当最终交付直接展示


---

## 详细规范指针

- **完整行为规范**：[`references/01-core/skill-full-spec.md`](./references/01-core/skill-full-spec.md)
- **场景包加载与 local-rule**：[`references/01-core/scene-pack-activation-guide.md`](./references/01-core/scene-pack-activation-guide.md)
- **并行治理与写入隔离**：[`references/05-ops/multi-agent-horizontal-sync.md`](./references/05-ops/multi-agent-horizontal-sync.md)
- **S3 写入约束（每轮文件数等）**：[`references/05-ops/s3-write-constraints.md`](./references/05-ops/s3-write-constraints.md) · 运行时提示见根目录 `fbs-runtime-hints.json`
- **搜索前置合同（机读）**：[`references/05-ops/search-preflight-contract.json`](./references/05-ops/search-preflight-contract.json)
- **WorkBuddy 宿主最小集成**：[`references/06-plugin/workbuddy-host-integration.md`](./references/06-plugin/workbuddy-host-integration.md)
- **平台运维与交付链路**：[`references/05-ops/platform-ops-brief.md`](./references/05-ops/platform-ops-brief.md)
- **文档导航与联系方式**：[`references/01-core/skill-index.md`](./references/01-core/skill-index.md)
