#!/usr/bin/env node
/**
 * 构建虚拟书房：在本书根下初始化虚拟书房三层底座（`.fbs/` / `deliverables/` / `releases/`）与共享工件。
 *
 * 用法（技能包根目录）：
 *   node scripts/init-fbs-multiagent-artifacts.mjs --book-root <本书工作区根路径> [--force]
 *
 * 创建/更新（不覆盖已有非空文件，除非 --force）：
 *   .fbs/chapter-status.md          ← 【AUTHORITY】权威真相来源；本书根镜像为只读快照
 *   chapter-status.md（本书根，只读快照，勿单独维护）
 *   .fbs/chapter-dependencies.json
 *   .fbs/book-context-brief.md
 *   .fbs/GLOSSARY.md
 *   .fbs/project-config.json
 *   .fbs/expansion-plan.md          ← S3.5 扩写计划（见 references/01-core/s3-expansion-phase.md）
 *   .fbs/search-ledger.jsonl
 *   .fbs/member-heartbeats.json
 *   .fbs/task-queue.json
 *   .fbs/rate-budget.json           ← 全局限流预算追踪（A5/RC-1）
 *   .fbs/high-quality-domains.json  ← 优质域名台账（A6/RL-1）
 *   .fbs/material-library.md        ← 虚拟书房素材库（S0-E / materialLibrary）
 *   .fbs/author-meta.md             ← 作者元知识锁定（H1 / S0-M，声音基准）
 *   .fbs/insight-cards.md           ← 认知金句卡片（H4，三级沉淀第一级）
 *   .fbs/术语锁定记录.md            ← 概念锁定动态哨兵追踪文件（v1.8 新增，termConsistencyTracking）
 *   .fbs/规范执行状态.md            ← 规范执行状态运行时追踪（v1.8 新增，esmExecutionTracking）
 *   .fbs/esm-state.md               ← ESM 当前状态机读摘要（v1.8.0 审计落地；配合 fbs-record-esm-transition.mjs）
 *   .fbs/writing-notes/pending-verification.md ← 待核实台账（pendingVerificationTracking / P1-4 CLI）
 *   .fbs/writing-notes/_chapter-closure-template.md ← 章末工作记忆模板（search-policy writingNotes）
 *   --- v2.0 新增（快速起步模式 / 三条路径 / 会议机制）---
 *   .fbs/material-inventory.md      ← S0-A 原料盘点表（路径A：原料驱动）
 *   .fbs/work-intelligence.md       ← S0-B 作品情报站（六维情报 + 风格试笔 + 对比报告）
 *   .fbs/reader-language.md         ← L5 读者语言感知（词汇表 + 关切清单 + 禁忌清单）
 *   .fbs/story-bank.md              ← 故事库（可用故事/案例，按章节分配）
 *   .fbs/sessions-summary.md        ← 所有会议关键决策汇总（用户只看这一个文件）
 *   .fbs/sessions/creative-session.md  ← 创意会纪要
 *   .fbs/sessions/reader-session.md    ← 读者会纪要
 *   .fbs/sessions/adversarial-session.md ← 对抗会纪要
 *   .fbs/sessions/review-session.md    ← 评审会纪要
 *   deliverables/                   ← S5 对外交付区（md/html/package 按运行时生成）
 *   releases/                       ← S6 发布准备区（<chapterId>-release.json 按运行时生成）
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
  ensureEntryContractSnapshot,
  ensureWorkspaceGovernanceSnapshot,
  loadEntryContractPolicy,
  resolveFirstUsableSurface,
} from "./lib/entry-contract-runtime.mjs";
import { ensureStandardResultDirs } from "./lib/runtime-result-store.mjs";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SKILL_ROOT = path.resolve(__dirname, "..");

let currentWriteOptions = { quiet: false, logger: console };


function parseArgs(argv) {
  const o = { bookRoot: null, skillRoot: null, force: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = argv[++i];
    else if (a === "--skill-root") o.skillRoot = argv[++i];
    else if (a === "--force") o.force = true;
    else if (a === "--help" || a === "-h") {
      console.log(`
init-fbs-multiagent-artifacts.mjs — 虚拟书房底座初始化

用法:
  node scripts/init-fbs-multiagent-artifacts.mjs --book-root <本书根> [选项]

选项:
  --book-root <路径>     书稿工程根目录（必填）
  --skill-root <路径>    FBS-BookWriter 技能包根目录（DESIGN-001：可选，默认为脚本所在目录的上级）
                         当书稿目录与技能包目录分离时使用，例如：
                           node scripts/init-fbs-multiagent-artifacts.mjs \\
                             --book-root /path/to/my-book \\
                             --skill-root /path/to/FBS-BookWriter
  --force                强制覆盖已有非空文件
  -h, --help             显示此帮助

说明:
  在 --book-root 下创建虚拟书房三层底座（.fbs/ / deliverables/ / releases/）
  与所有共享工件模板（GLOSSARY、chapter-status、task-queue 等）。
  已有非空文件默认跳过（不覆盖），加 --force 强制重写。
`);
      process.exit(0);
    }
  }
  return o;
}

function writeIfAbsent(filePath, content, force, options = {}) {
  const { quiet = currentWriteOptions.quiet, logger = currentWriteOptions.logger } = options;

  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(filePath)) {
    const cur = fs.readFileSync(filePath, "utf8").trim();
    if (cur.length > 0 && !force) {
      if (!quiet) {
        logger.log("skip (exists):", filePath);
      }
      return;
    }
  }
  fs.writeFileSync(filePath, content, "utf8");
  if (!quiet) {
    logger.log("write:", filePath);
  }
}


const CHAPTER_STATUS = `# 章节完成状态台账（多路并行 S3）
<!-- AUTHORITY: 本文件是章节状态的唯一权威来源（Single Source of Truth）。
     本书根 chapter-status.md 为只读快照，仅供工具扫描；日常维护只更新本文件。
     修改后可通过 node scripts/sync-book-chapter-index.mjs 同步快照。 -->

> **单一真相来源**（测试报告 01）：team-lead 与各 Writer 同步更新；**勿**仅依赖宿主 MEMORY 口头「全完成」而跳过磁盘核对。  
> **权威路径**：\`.fbs/chapter-status.md\`（本文件）；本书根 \`chapter-status.md\` 为只读快照，由 \`sync-book-chapter-index.mjs\` 自动同步，**请勿手动维护快照**。  
> 建议每次合并前运行：\`node scripts/sync-book-chapter-index.mjs --book-root <本书根> --json-out .fbs/chapter-scan-result.json\`

## 工作流阶段（与 esm-state 对齐，便于恢复）
> 复盘 2026-04-13：仅记章节进度时，恢复会话易忽略「卡在 S0」。此处**显式**记阶段与 \`esm-state.md\` 一致。

| 项 | 内容 |
|----|------|
| **当前阶段** | S0（与 \`.fbs/esm-state.md\` 同步；切换时更新） |
| **阶段备注** | 例：素材达标、待进入 S1 / 需求确认中 |

最后更新：（ISO 时间）

| 章节ID | 文件名 | 状态 | 完成时间 | 字数 | 依赖章节 | 质量自检(综合/10) | 易多义缩写已核对 |
|--------|--------|------|----------|------|----------|-------------------|------------------|
| ch01 | [S3-Ch01] 第一章.md | 未开始 | — | — | — |  |  |

状态建议：\`未开始\` / \`进行中\` / \`待审\` / \`已完成\`。
`;

const CHAPTER_DEPS = {
  version: 1,
  _warning: "以下 chapters 均为示例数据，请在 S2 目录确认后全部替换为实际章节",
  description:
    "章节依赖图：team-lead 按 S2 实际改 id / fileNameContains / dependsOn / batch；配合 sync-book-chapter-index 与 chapter-scheduler-hint",
  chapters: [
    {
      id: "ch06",
      title: "第六章（示例：双线对决）",
      fileNameContains: "第六章",
      dependsOn: ["ch04", "ch05"],
      batch: 2,
    },
    {
      id: "ch04",
      title: "第四章（示例）",
      fileNameContains: "第四章",
      dependsOn: [],
      batch: 1,
    },
    {
      id: "ch05",
      title: "第五章（示例）",
      fileNameContains: "第五章",
      dependsOn: [],
      batch: 1,
    },
    {
      id: "ch07",
      title: "第七章（示例：易漏章）",
      fileNameContains: "第七章",
      dependsOn: [],
      batch: 1,
    },
  ],
};

const QUALITY_CONSTRAINTS = `# 写作阶段质量约束（.fbs/quality-constraints.md）

> **用途**：用户在 S0/S1 提出、但**适合在写作阶段再落细**的要求（赛道均衡、案例唯一性等），记在此，避免 S0 无限循环。  
> **维护**：team-lead 与用户确认后追加；进入 S3 前可再扫一遍。

| 日期 | 来源（用户原话摘要） | 约束类型 | 计划执行阶段 | 状态 |
|------|---------------------|----------|--------------|------|
| — | — | — | S3+ | 待生效 |

`;

const GLOSSARY = `# 本书术语表（.fbs/GLOSSARY.md）

> **并行写作 P0**（测试报告 02）：多义缩写必须在本表锁定**本书唯一含义**；Writer 任务须附带本路径。

## 缩写与专名

| 缩写/专名 | 本书唯一含义 | 禁止混用的其他含义 |
|-----------|-------------|-------------------|
| OPC | （主编填写，如 One-Person Company） | 须与 abbreviation-audit-lexicon.json 对照 |
| MCP | Model Context Protocol（首次可写全称） | — |

（可增删行；**terminology-gate.mjs --strict** 将检查多义词条是否在本表出现。）
`;

const BOOK_CONTEXT = `# 全书上下文摘要（并行写作共享）

> 各 Writer 写作前读一遍；更新后通过 broadcast 或 team-lead 通知刷新。

## 全书脉络锚（corePremise）

**核心脉络**：{待 S2.5 填写，≤25字，全书论证的唯一中心主张}

## 已锁定数据点（跨章须一致）

| 数据点 | 数值/表述 | 来源 | 锁定章节 |
|--------|-----------|------|----------|
| （示例） |  |  |  |

## 术语与缩写（本书唯一含义）

见 \`.fbs/GLOSSARY.md\` 或 S1/S2 术语表；勿在正文自创第二含义。

## 各章核心结论与末段钩子（防重复与断档）

| 章 | 一句结论 | 末段是否指向下章 | updatedAt |
|----|----------|------------------|-----------|
|  |  |  |  |
`;

const PROJECT_CONFIG = {
  description: "FBS-BookWriter 本书项目配置（多智能体对齐）",
  skillVersion: "2.0",
  lockedAt: "",
  skillVersionNote:
    "默认按当前技能版本 2.0.3 初始化；lockedAt 记录 ISO 日期。技能包升级后由 team-lead 评估是否更新（见 SKILL.md「技能包版本与本书锁定」）。",
  skillPolicyVersionNote: "与 references/05-ops/search-policy.json version 对齐维护",
  multiAgentMode: "parallel_writing",
  multiAgentModeNote:
    "parallel_writing = 多 Writer 并行；single_writer = 单会话逐章。见 references/05-ops/architecture-modes.md",
  genreLevel: "",
  genreTag: "",
  genreNote:
    "S0/S1 后必须写入：genreLevel=\"A\"/\"B\"/\"C\"；genreTag 为体裁标签（如 历史通史/商业手册/白皮书）。S3 门禁将据此决定流程深度与检索基线。",
  bookTitle: "",
  bookTitleNote:
    "正式书名（与宿主展示、workbuddy-resume 一致）；S1 定名后填写，避免快照 bookTitle 为空。",
  plannedChapterTotal: "",
  plannedChapterTotalNote:
    "规划总章数（填数字）；当 chapter-status 未写「章节总数」时，快照用此与 Markdown 标题计数对齐。",
  plannedChapterMin: "",
  plannedChapterMax: "",
  plannedChapterRangeNote:
    "可选：规划章数区间（与目录冻结一致）；用于 writing-contract-gate 校验 plannedChapterTotal 是否落在此区间。",
  chapterDraftWordMin: "",
  chapterDraftWordMax: "",
  chapterDraftWordRangeNote:
    "可选：每章初稿目标字数区间（字）；与 targetWordCount、plannedChapterTotal 交叉校验，防碎片补写与口径漂移。",
  materialGatherNotesMaxChars: "",
  materialGatherNotesMaxCharsNote:
    "可选：material-inventory.md / 素材侧笔记累计字符上限（防无限扩写）；超限为 Warning，扩预算须用户确认。见 search-policy.json → materialGatherBudget。",
  outlineFreezeVersion: "",
  outlineFrozenAt: "",
  outlineFreezeNote:
    "大纲冻结后变更须走 references/01-core/outline-freeze.md 变更单；与 plannedChapter* 对齐。",
  writingContractRef: "references/05-ops/scale-tiers.json",
  targetWordCount: "",
  targetWordCountNote:
    "目标总字数（字）；台账未汇总出字数时，恢复卡与用户可见一行摘要可回退使用该目标。",
  s0TimestampBaseline: "",
  s0TimestampQuery: "",
  s0TimestampNote:
    "S0 第一轮强制检索当前日期后写入，例如：s0TimestampBaseline=2026-04-01，s0TimestampQuery=今天日期。",
  s0SearchStatus: "pending",
  s0SearchStatusNote:
    "pending / partial-failed / all-failed-model-knowledge-only / ok。检索失败不得静默继续。",
  s25Enabled: false,
  s25EnabledNote: "S2.5 阶段启动时由 team-lead 改为 true；enforce-search-policy 将据此要求账本含 S2.5 记录",
  s25ActionPlanStatus: "",
  s25ActionPlanStatusNote: "S2.5 行动计划状态：acknowledged-incomplete（用户知情接受）/ skipped / done",
  writingTrack: "",
  writingTrackNote: "快车道（fast）/ 慢车道（deep）；S1 定位后写入，影响每章 Brief 粒度与检索密度",
  briefGranularity: "",
  briefGranularityNote: "章节 Brief 粒度：minimal / standard / detailed；S2 目录确认后写入",
  materialLibraryReady: false,
  materialLibraryReadyNote: "S0-E 虚拟书房初始化后改为 true；false 时进入 S3 会发出素材充分度预警",
  fbsInitMode: "",
  fbsInitModeNote: "auto（脚本初始化）/ manual-minimal（手动最小初始化）；由初始化脚本或用户手动写入",
  parallelWriting: {
    enabled: true,
    defaultEnableG4ForCitation: true,
    requireChapterStatusUpdates: true,
    fileNamingConvention: "[S3-ChNN] 第N章-标题.md",
  },
};

const HEARTBEATS = {
  version: 1,
  members: {},
  note: "成员每 ≤60s 由宿主或人工更新 lastHeartbeat（ISO）；team-lead 检查本文件中各成员时间戳巡检超时",
};

const TASK_QUEUE = {
  version: 1,
  tasks: [],
  note: "记录待处理与失败任务；失败后 retry 计数见各 task，由 team-lead 人工或宿主重派",
};

/** A5/RC-1：全局限流预算追踪初始模板 */
const RATE_BUDGET = {
  _note: "本文件记录本书项目的累计限流命中率，供跨会话续写时感知累积限流压力；每次触发限流时由宿主或 team-lead 手动更新，或通过集成脚本自动维护。",
  totalRateLimitHits: 0,
  totalSearches: 0,
  rateLimitRate: 0,
  sessionStartMs: 0,
  sessionDurationMs: 0,
  lastRateLimitHitMs: 0,
  guideline: "rateLimitRate > 0.3 时建议：1) 降低 s0MaxConcurrentQueries；2) 增大 minIntervalBetweenQueriesMs；3) 使用 M2 编级预检索模式",
};

/** A6/RL-1：优质域名台账初始模板（searchEnhancement.sourceQualityTracking 对齐） */
const HIGH_QUALITY_DOMAINS = {
  _note: "本文件记录本书检索过程中发现的高质量信息源（qualityScore≥4）；后续章节检索优先向此表域名发起 WebFetch。",
  _schema: "{ domain, firstSeenAt, sourceType, qualityScore, notes }",
  domains: [],
  lastUpdatedAt: "",
};

/** 智能记忆用户偏好档案初始模板（R-12） */
const USER_PREFERENCE_PROFILE = {
  _schema: "fbs-user-preference-profile-v1",
  version: "2.1.1",
  updatedAt: "",
  writingStyle: {
    tone: "professional",
    formality: "medium",
    aiFlavorTolerance: "low",
    verbosity: "medium"
  },
  interaction: {
    defaultMode: "interactive",
    collaboration: "single_agent",
    recommendationStyle: "progressive"
  },
  output: {
    showDraftFirst: true,
    preferredFormats: ["markdown"]
  },
  memoryPolicy: {
    allowAutoLearning: true,
    requireVisibleHintBeforeApply: true
  },
  learningState: {
    isFrozen: false,
    frozenAt: null,
    freezeReason: "",
    lastRollbackAt: null,
    lastRollbackSource: null
  },
  acceptedSuggestions: [],
  rejectedSuggestions: [],
  forbiddenRecommendations: [],
  feedbackSignals: {
    acceptCount: 0,
    rejectCount: 0
  }
};


/** 虚拟书房素材库初始模板（S0-E / materialLibrary 对齐） */
const MATERIAL_LIBRARY = `# 虚拟书房素材库（.fbs/material-library.md）

> **用途**：统一存放作者提供素材、联网搜索存盘素材、临时追加素材。S3 成文时优先从本库取用。  
> **权威字段**：\`search-policy.json → materialLibrary\` 与 \`materialSufficiency\`。  
> **更新方式**：
> - 用户说「补充素材：[内容]」→ 模型自动追加
> - S0/S3 检索发现高质量片段 → 自动存盘（kind=material）
> - 章内自审卡完成后 → 更新已取用条目状态

## 充分度快照（S2.5 盘点时填写）

- **全书预计字数**：{N}万字
- **建议最低素材条数**：{M}条（来自 \`materialSufficiency.thresholds\`）
- **当前已入库**：{X}条（案例 {a}条 / 数据 {d}条 / 引言 {q}条 / 其他 {o}条）
- **充分度评级**：{充足 ✅ / 偏少 ⚠️ / 严重不足 ❌}
- **盘点时间**：{ISO}

> 阈值速查（来源：\`search-policy.json\` → \`materialSufficiency.thresholds\`）：  
> 5–10万字 → 推荐≥30条，<10条=严重不足❌ | 10–30万字 → 推荐≥80条，<25条=❌  
> 30–100万字 → 推荐≥200条，<60条=❌ | >100万字 → 推荐≥500条，<150条=❌

---

## 素材条目

<!-- 格式参考：
## 素材条目 · MAT-001

- **类型**：案例
- **来源**：用户提供 / WebSearch:{query} / 模型知识（需标注）
- **适用章节**：ch03 / 通用
- **内容摘要**（≤200字）：...
- **状态**：待取用 / 已取用（ch03）/ 放弃（原因）
- **入库时间**：{ISO}
-->

（暂无素材，请在 S0 调研完成后按 S0-E「虚拟书房初始化」协议补充）
`;

/** 作者元知识锁定初始模板（H1 / S0-M 对齐） */
const AUTHOR_META = `# 作者元知识（.fbs/author-meta.md）

> **用途**：锁定全书声音基准——核心主张、目标读者画像、作者风格、判断标准、变现路径。  
> **更新时机**：S0-M「作者元知识锁定」阶段由作者填写；写作过程中可追加但不可随意改动已锁定字段。  
> **引用方式**：每章 Chapter Brief 自动引用「作者声音」字段作为文风约束。

## 一、全书核心主张（P0 必填）

> 读者合上书记住的那一句话（≤25字）

**核心主张**：{待填写}  
**锁定时间**：{ISO}

---

## 二、目标读者画像

**职位/行业/痛点**：{待填写}  
**读完本书后能做到**：{待填写}

---

## 三、作者声音（风格元知识）

**风格标签**（填写字母或自定义）：{待填写}

> A. 平实直白，说人话  B. 专业严谨，有数据  C. 故事驱动，有温度
> D. 启发式追问，留白  E. 犀利观点，敢亮剑  F. 自定义：___

**补充说明**（可选）：{待填写}

---

## 四、判断标准

**什么样的内容「值得写进这本书」**：{待填写}  
**什么是这本书「绝对不写」的**：{待填写}

---

## 五、变现路径意图

**选择的变现路径**：{出版 / 电子书 / ToB采购 / 课程配套 / 品牌建设 / 其他}  
**优先级说明**：{待填写}
`;

/** 认知金句卡片初始模板（H4 / 三级沉淀第一级 对齐） */
const INSIGHT_CARDS = `# 认知金句卡片（.fbs/insight-cards.md）

> **用途**：沉淀每章最值得被记住的 1–3 句话（三级沉淀第一级：洞察级），供跨章引用、S6书摘提取和作品进化迭代使用。  
> **更新时机**：每章章内自审卡「认知金句卡片」字段填写后，模型自动追加。  
> **使用方式**：后续章节引用时，可通过「呼应金句」加强全书思想连贯性；S6 可一键提取为「全书精华书摘」。

## 金句总览

| 编号 | 金句 | 来源章节 | 类型 | 已被引用 |
|------|------|---------|------|--------|
| IC-001 | （暂无，待章节完成后填入） | — | — | — |

---

## 金句详情

<!-- 格式参考：
## IC-001

- **金句**：书不是写出来的，是素材喂出来的。
- **来源**：ch03 · §素材管理
- **类型**：方法论 / 观点 / 数据 / 故事 / 比喻
- **字数**：16字
- **已被引用**：ch07（呼应）/ 未引用
- **入库时间**：{ISO}
-->

（暂无金句，S3 成文后按章内自审卡「认知金句卡片」字段自动填入）
`;

/** 概念锁定动态哨兵追踪文件（termConsistencyTracking / v1.8 新增） */
const TERM_LOCK_RECORD = `# 术语锁定记录（.fbs/术语锁定记录.md）

> **用途**：S0 概念定义后锁定全书核心术语，防止跨章节术语漂移（概念锁定动态哨兵，P0）。  
> **更新时机**：S0 简报出现「新概念定义」节后立即创建/追加；每章成文前 Chapter Brief 须查询本文件。  
> **CLI审计**：node scripts/audit-term-consistency.mjs --book-root <书稿根> --glob "chapters/*.md"

## 锁定期术语

| 术语 | 标准写法 | 首次定义位置 | 锁定时间 | 确认状态 |
|------|---------|------------|---------|---------|
| （暂无，S0 概念定义后填写） | — | — | — | pending |

## 禁用变体

| 禁用变体 | 建议替换 | 原因 |
|---------|---------|------|
| （暂无，发现变体时追加） | — | — |

## 替换记录

（追加模式：时间 | 原表述 | 替换为 | 章节）
`;

/** 规范执行状态运行时追踪（esmExecutionTracking / v1.8 新增） */
const NORM_EXEC_STATE = `# 规范执行状态（.fbs/规范执行状态.md）

> **用途**：运行时追踪当前书稿对 FBS-BookWriter P0 规范的执行状态，供跨会话审计使用。  
> **更新时机**：每次状态切换（ESM 状态转换宣告）后更新本文件；S5 终审时须核对全部 P0 项。  
> **参考规范**：search-policy.json → esmAnnouncementAtomicity / termConsistencyTracking / yearSourceLedger

## ESM 状态追踪

| 时间 | 旧状态 | 新状态 | 触发原因 | 出口条件 |
|------|--------|--------|---------|---------|
| （ISO） | IDLE | INTAKE | 项目初始化 / 用户触发 | — |

## 切换日志

（新记录追加在**本段最上方**；每次 ESM 切换建议运行：\`node scripts/fbs-record-esm-transition.mjs --book-root <本书根> --from <旧> --to <新> --reason "..."\`）

## P0 执行检查单

| P0 项目 | 要求 | 当前状态 | 最后核查时间 |
|---------|------|---------|------------|
| S0 时间基准 | 简报首行有「时间基准：YYYY年MM月DD日」 | ⬜ 待核查 | — |
| 事实标注协议 | 具体数字/比例/绝对化陈述已标注来源 | ⬜ 待核查 | — |
| 概念锁定动态哨兵 | .fbs/术语锁定记录.md 已创建且完整 | ⬜ 待核查 | — |
| ESM 状态宣告原子化 | 状态切换宣告与 ESM 自检同一次输出 | ⬜ 待核查 | — |
| S3 门禁 | s3-start-gate.mjs 已通过 | ⬜ 待核查 | — |

## CLI 自动化进度（升级后审计 · 可勾选）

> 主编或 CI 每完成一步可将「⬜」改为「✅」并填日期（手工即可，无需脚本）。

| 步骤 | 命令摘要 | 已执行 |
|------|----------|--------|
| 构建虚拟书房底座 | \`node scripts/init-fbs-multiagent-artifacts.mjs --book-root <本书根>\` | ⬜ |
| S3 启动门禁 | \`node scripts/s3-start-gate.mjs --skill-root <技能根> --book-root <本书根>\`（有成稿时**自动**跑时间标签 + 术语 \`--scan-book-s3\`，默认警告） | ⬜ |
| 时间标签阻断模式 | S3 门禁加 \`--audit-temporal-enforce\` | ⬜ |
| 术语阻断模式 | S3 门禁加 \`--audit-term-enforce\`（禁用变体出现在正文则阻断） | ⬜ |
| 时间标签单独全扫 | \`node scripts/audit-temporal-accuracy.mjs --book-root <本书根> --scan-book-s3\` | ⬜ |
| 术语单独全扫 | \`node scripts/audit-term-consistency.mjs --book-root <本书根> --scan-book-s3\` | ⬜ |
| S5 待核实清零 | \`node scripts/audit-pending-verification.mjs --book-root <本书根> --enforce\` | ⬜ |
| P0→CLI 总表 | \`references/05-ops/p0-cli-map.md\` | ⬜ |
| ESM 落盘 | \`node scripts/fbs-record-esm-transition.mjs --book-root <本书根> --from … --to … --reason "…"\` | ⬜ |

## 违规记录

（追加模式：时间 | P0项 | 违规描述 | 处理方式）
`;

/** ESM 机读状态初值（与 section-3-workflow ESM  IDLE 对齐） */
const ESM_STATE_INITIAL = `---
currentState: "IDLE"
previousState: "IDLE"
lastTransitionAt: ""
transitionReason: ""
genre: ""
iterationPhase: "none"
expansionRound: 0
refinementRound: 0
lastInterruptAt: ""
lastInterruptReason: ""
maintainedBy: "init-fbs-multiagent-artifacts.mjs"
---

# ESM 当前状态（.fbs/esm-state.md）

> 每次状态切换后运行 \`node scripts/fbs-record-esm-transition.mjs\` 更新；或手工与对话宣告保持一致。  
> **迭代子阶段**：\`iterationPhase\` = \`none\` | \`expansion\` | \`refinement\`（见 \`s3-expansion-phase.md\` / \`s3-refinement-phase.md\`）。

| 字段 | 值 |
|------|-----|
| 当前状态 | **IDLE** |
| 上一状态 | IDLE |
| 切换时间 | （待首次切换） |
| 原因 | — |
| 体裁等级 | — |
| iterationPhase | none |
| expansionRound | 0 |
| refinementRound | 0 |
| lastInterruptAt | — |
`;

const PENDING_VERIFICATION = `# 待核实项台账（pendingVerificationTracking）

> **CLI**：\`node scripts/audit-pending-verification.mjs --book-root <本书根>\`（S5 前加 \`--enforce\`）  
> **映射**：\`references/05-ops/p0-cli-map.md\`

## 说明

检索暂不可执行、但已在正文触及的事实句，在此登记；S5 终审前须**勾选完成**或删除，避免遗漏。

## 当前队列

（在此追加 \`- [ ] …\` 行；暂无待核实项则保留本说明即可。）

`;

/** 章末工作记忆模板（search-policy.json → writingNotes.chapterClosureTemplate） */
const EXPANSION_PLAN = `# 扩写计划（.fbs/expansion-plan.md）

> **阶段**：S3.5 内容扩写 · **门禁**：用户确认本计划前**禁止**执行扩写改写  
> **权威**：\`references/01-core/s3-expansion-phase.md\`（相对 FBS-BookWriter 技能包根；书稿目录无此文件时以技能包内文档为准）

## 全书目标

- 扩写原因：（用户原话摘要）
- 目标总字数区间：
- 优先级与章序：

## 章节扩写目标表（机读 · expansion-word-verify 解析）

| 章节ID | 文件（相对本书根） | 目标字符数 | 素材评估 | 新增事实 MAT 要求 | 与前后章边界（防重复） |
|--------|---------------------|------------|----------|-------------------|-------------------------|
| （示例 ch00） | （示例 chapters/[S3-Ch00]xxx.md） | 15000 | 充足 / 偏少 / 需先补 S0 | 新增须 \`[MAT-xxx]\` 或标「待证实」 | 本章仅钩子+概览，详细论证见 Ch01 |

> 填表后执行：\`node scripts/expansion-word-verify.mjs --book-root <本书根> --from-plan .fbs/expansion-plan.md\`

## 执行策略

- 并行度（≤2 章）：
- 临时文件命名（并行时）：\`*.expanded.md\` → 验证通过后再替换正式稿

## Wave 编排（可选 · 对标叙事依赖波次）

| 波次 | 章节ID | 说明（依赖 / 为何同波） |
|------|--------|-------------------------|
| 1 | （示例 ch00） | 可并行时填多章；单波串行可写「单波」或留空 |

> **语义**：同波内宜共享已冻结的 \`.fbs/narrative-context.md\` 与术语表；下一波依赖上一波已落地的论点时再放入。并行度仍须 ≤3（推荐≤2）。详见 \`references/05-ops/fbs-narrative-gates-and-parity.md\`。

## 用户确认

- [ ] 用户已确认本计划（日期 / 方式）：

`;

/** 叙述 CONTEXT 冻结（对标「讨论阶段」产出；大规模扩写 / 多章并行前填充） */
const NARRATIVE_CONTEXT = `# 叙述 CONTEXT 冻结（.fbs/narrative-context.md）

> **门禁**：进入 **S3.5 多章并行扩写** 前建议填至可执行；与 \`author-meta.md\`、\`术语锁定记录.md\` 一致。  
> **模板全文**：\`references/05-ops/template-narrative-context.md\`（技能包内）

## 读者与立场

- 主读者：（待填）
- 本书承诺：（与 author-meta 对齐的一句话）

## 叙述参数（扩写前必填）

| 维度 | 说明 |
|------|------|
| 篇幅节奏 | 偏案例 / 偏论述 / 均衡 |
| 案例深度 | 姓名化 / 匿名 / 仅数据 |

## 与大纲的边界

- 本章独有论点：（待填）
- 须引用而非重复：（待填）

## 冻结记录

- [ ] 已与用户对齐（日期 / 方式）：

`;


const CHAPTER_CLOSURE_TEMPLATE = `# 章末工作记忆（每章初稿完成后复制为 {chapterId}.closure.md 或写入本文件 § 对应章）

> **用途**：冻结本章已定事实与未决项，减少后续章节反复回溯全文。  
> **权威**：\`references/05-ops/search-policy.json\` → \`writingNotes\`

## 本章已定事实（3–5 条）

- 

## 未决项 / 待下章承接

- 

## 术语与数据锚点（如有）

- 

## 素材取用状态（ledger 对齐）

- 已引用 ledger 条目 ID：  
- 待后续章取用：

`;

// ─── v2.0 新增工件模板（快速起步模式 / 三条路径 / 会议机制 / S6 转化）───

/** S0-A 原料盘点表（路径A：原料驱动） */
const MATERIAL_INVENTORY = `# 原料盘点表（.fbs/material-inventory.md）

> **适用场景**：路径A（原料驱动）——用户有大量现成素材时，在 S0 阶段执行 S0-A 原料盘点。  
> **更新时机**：S0-A 执行后填写；写作过程中可追加条目或更新状态。  
> **规范参考**：\`references/01-core/intake-and-routing.md\` → S0-A 原料盘点

## 原料清单

| 编号 | 原料名称/描述 | 类型 | 大小/数量 | 可信度 | 状态 | 备注 |
|------|-------------|------|---------|--------|------|------|
| M-001 | （暂无，S0-A 执行后填写） | — | — | — | 待盘点 | — |

**原料类型参考**：原始文件 / 访谈记录 / 调研报告 / OCR提取 / 民间资料 / 网络来源 / 其他

**可信度分级**：  
★★★ 一手文献（原始文件 / 官方档案）  
★★  二手整理（转述报告 / 专业编辑内容）  
★   待核实（OCR提取 / 民间传说 / 来源不明）

---

## 已知/未知地图

### 已知（原料覆盖的内容）

（S0-A 执行后填写，按主题分组）

### 未知/盲区（原料未覆盖，需补充）

（S0-A 执行后填写，标注是否可通过联网检索补充）

---

## 盲区探测结论

（S0-A 完成后，基于原料填写：哪些关键内容需要额外调研？优先级如何？）
`;

/** S0-B 作品情报站（六维情报 + 风格试笔 + 对比报告） */
const WORK_INTELLIGENCE = `# 作品情报站（.fbs/work-intelligence.md）

> **适用场景**：S0-B 阶段，对同类作品进行六维深度解读，用他人成果点燃写作灵感。  
> **更新时机**：S0 调研阶段，有原料或有主题时触发；每部作品分析后追加。  
> **规范参考**：\`references/05-ops/search-policy.json\` → s0WorkIntelPolicy

## 情报汇总

| 序号 | 作品名 | 作者 | 出版年 | 语言 | 主题内核 | 留白/空缺 | 可借鉴手法 |
|------|--------|------|--------|------|---------|---------|---------|
| W-001 | （暂无，S0-B 执行后填写） | — | — | — | — | — | — |

---

## 作品详细情报

<!-- 格式参考（每部作品一节）：
## W-001 · 《书名》

**基本信息**：作者 | 出版年 | 语言 | 豆瓣/亚马逊评分

### 六维情报

| 维度 | 内容 |
|------|------|
| 主题内核 | 核心论点/核心叙事是什么（一句话） |
| 结构策略 | 全书如何组织，章节逻辑是什么 |
| 叙事风格 | 论证/故事/案例/数据密度等特征 |
| 读者假设 | 作者预设读者是谁，默认知识水平 |
| 留白与空缺 | 作品没覆盖但本书可以填补的方向 |
| 可借鉴手法 | 结构/开篇/收尾/图表/引言等具体手法 |

### 风格试笔

（用该作品的口吻和结构写本书的某个段落，≤200字）
-->

（暂无，S0-B 执行后按模板填写）

---

## 作品情报对比报告

（全部作品解读后输出：四象限对比 + 可借鉴手法清单 + 本书差异化方向建议 ≥3条）
`;

/** L5 读者语言感知（词汇表 + 关切清单 + 禁忌清单） */
const READER_LANGUAGE = `# 读者语言感知（.fbs/reader-language.md）

> **适用场景**：L5 读者语言感知，通过联网搜索采集目标读者真实讨论，产出词汇表和关切清单。  
> **更新时机**：S0 读者分析阶段执行；读者会必须加载本文件。  
> **规范参考**：\`references/05-ops/search-policy.json\` → searchPurposeLayers.L5_readerLanguage

## 读者词汇表（高频词）

> 来源：知乎/微博/豆瓣/小红书等读者真实讨论

| 序号 | 词汇 | 使用频率 | 典型句式 | 情感色彩 |
|------|------|---------|---------|---------|
| — | （暂无，L5 搜索执行后填写） | — | — | — |

---

## 读者关切清单

> 目标读者最关心的问题（来自真实讨论）

1. （暂无，L5 搜索执行后填写）

---

## 词汇禁忌清单

> 读者反感的表述（过于官方/过度包装/不接地气）

| 禁用表述 | 建议替换 | 反感原因 |
|---------|---------|---------|
| — | — | — |

---

## 搜索来源记录

| 来源 | 查询词 | 时间 | 有效内容摘要 |
|------|--------|------|------------|
| — | — | — | — |
`;

/** 故事库（可用故事/案例，按章节分配） */
const STORY_BANK = `# 故事库（.fbs/story-bank.md）

> **适用场景**：从 S0 调研和作品情报中提炼可用故事/案例，按章节分配，避免每章重新挖掘。  
> **更新时机**：S0 完成后整理；S3 成文时优先从本库取用；取用后更新状态。  
> **规范参考**：\`references/01-core/intake-and-routing.md\` → 故事库（story-bank）

## 故事库总览

| 编号 | 故事/案例名称 | 类型 | 来源 | 可用章节 | 状态 | 核心价值 |
|------|-------------|------|------|---------|------|---------|
| SB-001 | （暂无，S0 完成后填写） | — | — | — | 待取用 | — |

**类型参考**：历史案例 / 当代案例 / 数据故事 / 人物故事 / 失败案例 / 对比案例 / 数字故事

---

## 故事详情

<!-- 格式参考：
## SB-001 · 故事名称

- **类型**：历史案例
- **来源**：WebSearch:{query} / 用户提供 / 作品情报（W-001）/ 模型知识（需标注）
- **核心价值**（≤30字）：这个故事能说明什么道理
- **可用章节**：ch03 / ch05（作为开篇案例）/ 通用
- **状态**：待取用 / 已取用（ch03）/ 放弃（原因）
- **内容摘要**（≤200字）：...
- **入库时间**：{ISO}
-->

（暂无故事，S0 调研或 S0-B 作品情报完成后按模板填写）
`;

/** 所有会议关键决策汇总（用户只看这一个文件） */
const SESSIONS_SUMMARY = `# 会议纪要汇总（.fbs/sessions-summary.md）

> **适用场景**：所有会议（创意会/读者会/对抗会/评审会）关键决策汇聚一处，用户只看这一个文件即可了解所有会议结论。  
> **更新时机**：每次会议完成后，由主编或 team-lead 追加（在本段最上方插入最新记录）。  
> **规范参考**：\`references/01-core/session-protocols.md\` + \`references/05-ops/search-policy.json\` → sessionProtocols.sessionSummaryFile

## 会议记录（最新在上）

| 时间 | 会议类型 | 核心决策（≤3条） | 待执行事项 | 详情文件 |
|------|---------|--------------|---------|---------|
| — | — | — | — | — |

---

## 说明

每次会议后追加一行（在表格上方插入），格式：
\`| {ISO时间} | {创意会/读者会/对抗会/评审会} | 决策1；决策2；决策3 | 待执行1；待执行2 | .fbs/sessions/{文件名} |\`

详细纪要见对应的 sessions/ 子目录文件。
`;



export function initFbsArtifacts({ bookRoot, skillRoot = DEFAULT_SKILL_ROOT, force = false, quiet = false, logger = console }) {
  if (!bookRoot) {
    throw new Error("用法: node scripts/init-fbs-multiagent-artifacts.mjs --book-root <本书根> [--force]");
  }
  const root = path.resolve(bookRoot);
  const resolvedSkillRoot = path.resolve(skillRoot || DEFAULT_SKILL_ROOT);
  const policy = loadEntryContractPolicy(resolvedSkillRoot);
  const fbs = path.join(root, ".fbs");
  const deliverablesDir = path.join(root, "deliverables");
  const releasesDir = path.join(root, "releases");
  currentWriteOptions = { quiet, logger };

  const { agentResultsDir, testResultsDir } = ensureStandardResultDirs(root);
  fs.mkdirSync(deliverablesDir, { recursive: true });
  fs.mkdirSync(releasesDir, { recursive: true });


  writeIfAbsent(path.join(fbs, "chapter-status.md"), CHAPTER_STATUS, force);
  writeIfAbsent(path.join(fbs, "quality-constraints.md"), QUALITY_CONSTRAINTS, force);

  // SL-2/A6：本书根镜像改为只读快照声明（注释头说明权威路径）
  const rootStatusContent = CHAPTER_STATUS.replace(
    /^# 章节完成状态台账/,
    '# 章节完成状态台账（本书根快照，只读）\n<!-- SNAPSHOT: 本文件为只读快照，权威来源在 .fbs/chapter-status.md；由 sync-book-chapter-index.mjs 自动同步 -->\n<!-- 请勿直接编辑本文件；如需更新请修改 .fbs/chapter-status.md 后执行同步脚本 -->'
  );
  writeIfAbsent(path.join(root, "chapter-status.md"), rootStatusContent, force);
  writeIfAbsent(path.join(fbs, "chapter-dependencies.json"), JSON.stringify(CHAPTER_DEPS, null, 2) + "\n", force);
  writeIfAbsent(path.join(fbs, "book-context-brief.md"), BOOK_CONTEXT, force);
  writeIfAbsent(path.join(fbs, "GLOSSARY.md"), GLOSSARY, force);
  writeIfAbsent(path.join(fbs, "project-config.json"), JSON.stringify(PROJECT_CONFIG, null, 2) + "\n", force);
  writeIfAbsent(path.join(fbs, "expansion-plan.md"), EXPANSION_PLAN, force);
  writeIfAbsent(path.join(fbs, "narrative-context.md"), NARRATIVE_CONTEXT, force);
  writeIfAbsent(path.join(fbs, "member-heartbeats.json"), JSON.stringify(HEARTBEATS, null, 2) + "\n", force);
  writeIfAbsent(path.join(fbs, "task-queue.json"), JSON.stringify(TASK_QUEUE, null, 2) + "\n", force);
  // A5/RC-1：限流预算追踪工件
  writeIfAbsent(path.join(fbs, "rate-budget.json"), JSON.stringify(RATE_BUDGET, null, 2) + "\n", force);
  // A6/RL-1：优质域名台账工件
  writeIfAbsent(path.join(fbs, "high-quality-domains.json"), JSON.stringify(HIGH_QUALITY_DOMAINS, null, 2) + "\n", force);
  // S0-E / materialLibrary：虚拟书房素材库（素材充分性六项策略对齐）
  writeIfAbsent(path.join(fbs, "material-library.md"), MATERIAL_LIBRARY, force);
  // H1 / S0-M：作者元知识锁定（声音基准）
  writeIfAbsent(path.join(fbs, "author-meta.md"), AUTHOR_META, force);
  // H4 / 三级沉淀第一级：认知金句卡片
  writeIfAbsent(path.join(fbs, "insight-cards.md"), INSIGHT_CARDS, force);

  // R-12：用户偏好档案（智能记忆分层学习）
  const smartMemoryDir = path.join(fbs, "smart-memory");
  fs.mkdirSync(smartMemoryDir, { recursive: true });
  writeIfAbsent(
    path.join(smartMemoryDir, "user-preference-profile.json"),
    JSON.stringify(USER_PREFERENCE_PROFILE, null, 2) + "\n",
    force
  );

  // termConsistencyTracking（v1.8）：概念锁定动态哨兵追踪文件
  writeIfAbsent(path.join(fbs, "术语锁定记录.md"), TERM_LOCK_RECORD, force);
  // esmExecutionTracking（v1.8）：规范执行状态运行时追踪
  writeIfAbsent(path.join(fbs, "规范执行状态.md"), NORM_EXEC_STATE, force);
  writeIfAbsent(path.join(fbs, "esm-state.md"), ESM_STATE_INITIAL, force);

  const writingNotes = path.join(fbs, "writing-notes");
  fs.mkdirSync(writingNotes, { recursive: true });
  writeIfAbsent(path.join(writingNotes, "pending-verification.md"), PENDING_VERIFICATION, force);
  writeIfAbsent(path.join(writingNotes, "_chapter-closure-template.md"), CHAPTER_CLOSURE_TEMPLATE, force);

  // ─── v2.0 新增工件（快速起步模式 / 三条路径 / 会议机制 / S6 转化）───
  // S0-A 原料盘点表（路径A：原料驱动）
  writeIfAbsent(path.join(fbs, "material-inventory.md"), MATERIAL_INVENTORY, force);
  // S0-B 作品情报站
  writeIfAbsent(path.join(fbs, "work-intelligence.md"), WORK_INTELLIGENCE, force);
  // L5 读者语言感知
  writeIfAbsent(path.join(fbs, "reader-language.md"), READER_LANGUAGE, force);
  // 故事库
  writeIfAbsent(path.join(fbs, "story-bank.md"), STORY_BANK, force);
  // 会议纪要汇总
  writeIfAbsent(path.join(fbs, "sessions-summary.md"), SESSIONS_SUMMARY, force);
  // 四种会议纪要子目录
  const sessions = path.join(fbs, "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  writeIfAbsent(path.join(sessions, "creative-session.md"), `# 创意会纪要（.fbs/sessions/creative-session.md）\n\n> 创意会完成后由主编填写；格式见 \`references/01-core/workbuddy-agent-briefings.md\` 创意会话术。\n\n（暂无记录）\n`, force);
  writeIfAbsent(path.join(sessions, "reader-session.md"), `# 读者会纪要（.fbs/sessions/reader-session.md）\n\n> 读者会完成后由主编填写；须加载 .fbs/reader-language.md。\n\n（暂无记录）\n`, force);
  writeIfAbsent(path.join(sessions, "adversarial-session.md"), `# 对抗会纪要（.fbs/sessions/adversarial-session.md）\n\n> 对抗会完成后由主编填写；含加固后的最强表述 + 预防性回应建议。\n\n（暂无记录）\n`, force);
  writeIfAbsent(path.join(sessions, "review-session.md"), `# 评审会纪要（.fbs/sessions/review-session.md）\n\n> 评审会完成后由主编填写；含 P0/P1/P2 分级问题清单。\n\n（暂无记录）\n`, force);

  const ledger = path.join(fbs, "search-ledger.jsonl");

  if (!fs.existsSync(ledger) || force) {
    fs.writeFileSync(ledger, "", "utf8");
    if (!quiet) {
      logger.log("write:", ledger);
    }
  } else if (!quiet) {
    logger.log("skip (exists):", ledger);
  }

  const firstUsableSurface = resolveFirstUsableSurface(policy);
  ensureEntryContractSnapshot(root, policy, { force });
  ensureWorkspaceGovernanceSnapshot(root, policy, { force });

  if (!quiet) {
    logger.log(
      `✅ 首个可用工作面（${firstUsableSurface.id} / ${firstUsableSurface.label}）已就绪。资料、进度与交付都在当前工作区。下一步: shared-knowledge-base · sync-book-chapter-index · chapter-scheduler-hint · chapter-dependency-gate · citation-format-check · terminology-gate\n` +
      "书房三层说明:\n" +
      "  .fbs/                        ← 内部台账与过程工件\n" +
      "  deliverables/               ← S5 对外交付区（md/html/package 按运行时生成）\n" +
      "  releases/                   ← S6 发布准备区（release.json 按运行时生成）\n" +
      "  .fbs/entry-contract.json    ← WP1/WP2 与搜索前置合同运行时快照\n" +
      "  .fbs/workspace-governance.json ← workspace 真值边界运行时快照\n" +
      "  .fbs/rate-budget.json       ← 限流预算追踪，由 SearchBundle 自动更新，无需手动修改\n" +
      "  .fbs/high-quality-domains.json ← 优质域名台账，检索发现高质量来源时追加写入\n" +
      "  .fbs/agent-results/        ← 长任务/多轮扫描的标准结果落盘目录\n" +
      "  .fbs/test-results/         ← 门禁/差异扫描/回归测试的标准结果目录\n" +
      "  .fbs/material-library.md    ← 虚拟书房素材库，S0-E 初始化后按协议补充素材条目\n" +

      "  .fbs/author-meta.md         ← 作者元知识锁定，S0-M 阶段由作者填写声音基准\n" +
      "  .fbs/insight-cards.md       ← 认知金句卡片，每章自审卡完成后自动追加\n" +
      "  .fbs/smart-memory/user-preference-profile.json ← 用户偏好档案（R-12，跨会话偏好学习）\n" +
      "  .fbs/chapter-status.md      ← 【权威来源】章节状态台账，日常维护请只更新此文件\n" +
      "  chapter-status.md（本书根） ← 只读快照，勿直接编辑，由 sync-book-chapter-index.mjs 同步\n" +
      "  .fbs/术语锁定记录.md        ← 概念锁定动态哨兵，S0 概念定义后填写（v1.8 新增）\n" +
      "  .fbs/规范执行状态.md        ← 规范执行状态运行时追踪，每次 ESM 状态切换后更新（v1.8 新增）\n" +
      "  .fbs/esm-state.md            ← ESM 机读当前状态（v1.8.0；配合 fbs-record-esm-transition.mjs）\n" +
      "  .fbs/writing-notes/pending-verification.md ← 待核实台账（audit-pending-verification.mjs）\n" +
      "  --- v2.0 新增工件 ---\n" +
      "  .fbs/material-inventory.md  ← S0-A 原料盘点表（路径A：有现成素材时填写）\n" +
      "  .fbs/work-intelligence.md   ← S0-B 作品情报站（六维情报 + 风格试笔 + 对比报告）\n" +
      "  .fbs/reader-language.md     ← L5 读者语言感知（词汇表 + 关切清单 + 禁忌清单）\n" +
      "  .fbs/story-bank.md          ← 故事库（可用故事/案例，按章节分配）\n" +
      "  .fbs/sessions-summary.md    ← 【用户看这里】所有会议关键决策汇总\n" +
      "  .fbs/sessions/creative-session.md  ← 创意会纪要\n" +
      "  .fbs/sessions/reader-session.md    ← 读者会纪要\n" +
      "  .fbs/sessions/adversarial-session.md ← 对抗会纪要\n" +
      "  .fbs/sessions/review-session.md    ← 评审会纪要"
    );
  }

  return { root, fbs, deliverablesDir, releasesDir, agentResultsDir, testResultsDir, firstUsableSurface };

}




export function main() {
  const { bookRoot, skillRoot, force } = parseArgs(process.argv);
  try {
    initFbsArtifacts({ bookRoot, skillRoot: skillRoot || undefined, force });
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main();
}


