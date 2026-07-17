#!/usr/bin/env node
/**
 * S2.5 -> S3 启动门禁（机制化）：
 * - project-config multiAgentMode 与启动模式一致
 * - S2.5 行动清单已核销（或显式风险接受）
 * - 素材库不处于「严重不足 ❌」（除非显式风险接受）
 * - author-meta 工件存在且非空
 * - genreLevel/genreTag 已写入 project-config（P0）
 * - S0 时间戳检索证据存在于 search-ledger（P0）
 * - 当 genreLevel=B 时，证据台账/MVD/Report Brief 三项产出物存在且非空（P0）
 * - （可选）阶段级检索账本 pre-s3 完整
 *
 * 用法：
 *   node scripts/s3-start-gate.mjs --skill-root <技能根> --book-root <本书根>
 *   node scripts/s3-start-gate.mjs --skill-root . --book-root <本书根> --mode parallel_writing --verify-stages
 *
 * 时间标签（审计05 / 升级后闭环）：
 *   当本书根已存在 ≥1 个 [S3]*.md 且本门禁其它项均通过时，默认自动调用
 *   `audit-temporal-accuracy.mjs --scan-book-s3`（仅警告，不阻断）。
 *   --audit-temporal-enforce  → 有 P0 时间违规时与本门禁一并 exit 1
 *   --no-audit-temporal       → 跳过上述子审计
 *
 * 术语一致性（审计09 / P0-6 配套）：
 *   有成稿且「术语锁定记录」中已有禁用变体时，默认自动调用
 *   `audit-term-consistency.mjs --scan-book-s3`（脚本内无变体或无 S3 文件则快速跳过）。
 *   --audit-term-enforce      → 禁用变体出现在正文时阻断
 *   --no-audit-term           → 跳过
 *
 * 检索自评 queryOptimization（审计 P2 / search-policy → queryOptimizationAudit）：
 *   当存在 [S3]*.md 且 .fbs/search-ledger.jsonl 存在时，默认自动调用
 *   `audit-query-optimization.mjs`（仅警告；policy 中 enabled=false 时跳过）。
 *   --audit-query-opt-enforce → 缺失自评字段时与本门禁一并 exit 1
 *   --no-audit-query-opt      → 跳过
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { loadScenePack } from "./wecom/scene-pack-loader.mjs";
import { writeTestResultArtifacts } from "./lib/runtime-result-store.mjs";


const DEFAULT_MODE = "parallel_writing";
const MIN_BRIEF_CHARS = 200;
const ACCEPT_RISK_RE = /(接受风险[，,\s]*继续|accept\s+risk|risk\s+accepted)/i;
const BRIEF_COVERAGE_HINT = "   💡 当前仍需先补齐 Chapter Brief；会员绕过能力尚未开放，后续若恢复会以 verify-member.mjs 等正式验证链路接入。";
const HELP_TEXT = `S2.5 → S3 启动门禁（s3-start-gate）

用法：
  node scripts/s3-start-gate.mjs --skill-root <技能根> --book-root <本书根>
  node scripts/s3-start-gate.mjs --skill-root . --book-root <本书根> --mode parallel_writing --verify-stages

选项：
  --skill-root <path>            技能根目录（默认当前目录）
  --book-root <path>             书稿根目录
  --mode <parallel_writing|single_writer>
  --verify-stages                输出前置阶段核验详情
  --no-audit-temporal            跳过时间标签子审计
  --audit-temporal-enforce       时间标签子审计失败时阻断
  --no-audit-term                跳过术语一致性子审计
  --audit-term-enforce           术语一致性子审计失败时阻断
  --no-audit-query-opt           跳过检索自评子审计
  --audit-query-opt-enforce      检索自评子审计失败时阻断
  --help                         显示帮助信息
`;

function parseArgs(argv) {
  const o = {
    skillRoot: process.cwd(),
    bookRoot: null,
    mode: null,
    verifyStages: false,
    noAuditTemporal: false,
    auditTemporalEnforce: false,
    noAuditTerm: false,
    auditTermEnforce: false,
    noAuditQueryOpt: false,
    auditQueryOptEnforce: false,
    // v2.0.3 [B3]：存量项目迁入模式，跳过 .fbs/ 缺失的硬阻断
    legacyProject: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--skill-root") o.skillRoot = argv[++i];
    else if (a === "--book-root") o.bookRoot = argv[++i];
    else if (a === "--mode") o.mode = argv[++i];
    else if (a === "--verify-stages") o.verifyStages = true;
    else if (a === "--no-audit-temporal") o.noAuditTemporal = true;
    else if (a === "--audit-temporal-enforce") o.auditTemporalEnforce = true;
    else if (a === "--no-audit-term") o.noAuditTerm = true;
    else if (a === "--audit-term-enforce") o.auditTermEnforce = true;
    else if (a === "--no-audit-query-opt") o.noAuditQueryOpt = true;
    else if (a === "--audit-query-opt-enforce") o.auditQueryOptEnforce = true;
    else if (a === "--legacy-project") o.legacyProject = true;
    else if (a === "--help" || a === "-h") o.help = true;
  }
  return o;
}


function hasS3MarkdownFiles(bookRoot) {
  if (!fs.existsSync(bookRoot)) return false;
  return fs.readdirSync(bookRoot).some((n) => /^\[S3.*\.md$/i.test(n));
}

function normalizeEsmStageToken(raw) {
  const v = String(raw || "").trim().replace(/^["']|["']$/g, "").toUpperCase();
  const map = {
    S0: "S0",
    S1: "S1",
    S2: "S2",
    S3: "S3",
    S4: "S4",
    S5: "S5",
    S6: "S6",
    IDLE: "S0",
    INTAKE: "S0",
    RESEARCH: "S1",
    PLAN: "S2",
    WRITE: "S3",
    REVIEW: "S4",
    DELIVER: "S5",
  };
  return map[v] || null;
}

/** 从 .fbs/esm-state.md 读取 YAML 顶栏 currentState */
function readEsmCurrentState(bookRoot) {
  const p = path.join(bookRoot, ".fbs", "esm-state.md");
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, "utf8");
  const table = text.match(/\|\s*(?:当前状态|当前阶段)\s*\|\s*[^|\r\n]*?(S[0-6])(?![0-9])/i);
  if (table?.[1]) return table[1].toUpperCase();
  const m = text.match(/^currentState:\s*([^\r\n]+)/m);
  return m ? normalizeEsmStageToken(m[1]) : null;
}

function runTemporalAuditScanS3(skillRoot, bookRoot, enforce) {
  const script = path.join(skillRoot, "scripts", "audit-temporal-accuracy.mjs");
  const argv = [script, "--book-root", bookRoot, "--scan-book-s3"];
  if (enforce) argv.push("--enforce");
  return spawnSync(process.execPath, argv, { stdio: "inherit" });
}

function runTermAuditScanS3(skillRoot, bookRoot, enforce) {
  const script = path.join(skillRoot, "scripts", "audit-term-consistency.mjs");
  const argv = [script, "--book-root", bookRoot, "--scan-book-s3"];
  if (enforce) argv.push("--enforce");
  return spawnSync(process.execPath, argv, { stdio: "inherit" });
}

function loadQueryOptimizationAuditEnabled(skillRoot) {
  try {
    const policyPath = path.join(skillRoot, "references", "05-ops", "search-policy.json");
    const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    const cfg = policy.queryOptimizationAudit;
    return cfg && cfg.enabled !== false;
  } catch {
    return true;
  }
}

function runQueryOptimizationAudit(skillRoot, bookRoot, enforce) {
  const script = path.join(skillRoot, "scripts", "audit-query-optimization.mjs");
  const argv = [script, "--skill-root", skillRoot, "--book-root", bookRoot];
  if (enforce) argv.push("--enforce");
  return spawnSync(process.execPath, argv, { stdio: "inherit" });
}

/** esm-state.md 顶栏 genre 与 project-config.genreLevel 交叉校验 */
function readEsmGenreLine(bookRoot) {
  const p = path.join(bookRoot, ".fbs", "esm-state.md");
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, "utf8");
  const m = text.match(/^genre:\s*"([^"]*)"/m);
  return m && m[1].trim() ? m[1].trim().toUpperCase() : null;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function findS25File(bookRoot) {
  const names = fs.existsSync(bookRoot) ? fs.readdirSync(bookRoot) : [];
  const hit = names.find((n) => /^\[S2\.5\].*\.md$/i.test(n));
  return hit ? path.join(bookRoot, hit) : null;
}

function checkS25Checklist(text) {
  const lines = text.split(/\r?\n/);
  const unchecked = lines.filter((l) => /^\s*[-*]\s*\[\s\]/.test(l));
  const hasRiskAccept = ACCEPT_RISK_RE.test(text);
  return {
    ok: unchecked.length === 0 || hasRiskAccept,
    uncheckedCount: unchecked.length,
    hasRiskAccept,
  };
}

function normalizeStage(v) {
  return String(v || "").trim().toUpperCase().replace(/_/g, ".");
}

function readStageLedger(bookRoot) {
  const p = path.join(bookRoot, ".fbs", "search-ledger.jsonl");
  if (!fs.existsSync(p)) return { exists: false, seen: new Set(), path: p, entries: [] };
  const seen = new Set();
  const entries = [];
  const body = fs.readFileSync(p, "utf8");
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const e = JSON.parse(t);
      entries.push(e);
      if (e.kind !== "search" || e.ok === false) continue;
      const s = normalizeStage(e.stage || e.workflowStage || e.phase || e.stageId);
      if (s) seen.add(s);
    } catch {
      // skip
    }
  }
  return { exists: true, seen, path: p, entries };
}

/**
 * 验证 search-ledger 中是否存在完整的搜索前置合同宣告（kind=search_preflight），
 * 用于实现 search-policy.json blockedIfMissingAnnouncement:true 的运行时 enforce。
 */
function checkSearchPreflightAnnouncement(bookRoot, policy) {
  const preflightCfg = policy?.searchPreflightContract;
  if (!preflightCfg?.enabled || !preflightCfg?.blockedIfMissingAnnouncement) return null;

  const ledgerPath = path.join(bookRoot, ".fbs", "search-ledger.jsonl");
  if (!fs.existsSync(ledgerPath)) {
    return "search-ledger 不存在，无法验证搜索前置合同宣告";
  }

  const body = fs.readFileSync(ledgerPath, "utf8");
  const requiredFields = Array.isArray(preflightCfg.requiredFields)
    ? preflightCfg.requiredFields
    : ["whyNow", "searchScope", "nextStepAfterSearch", "offlineFallback"];

  let hasValidPreflight = false;
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const e = JSON.parse(t);
      if (e.kind !== "search_preflight" || e.ok === false) continue;
      const missing = requiredFields.filter((f) => !String(e[f] || "").trim());
      if (missing.length === 0) {
        hasValidPreflight = true;
        break;
      }
    } catch {
      // skip
    }
  }

  if (!hasValidPreflight) {
    return `缺少完整的搜索前置合同宣告（kind=search_preflight，需包含 ${requiredFields.join("/")}）；请先运行 record-search-preflight.mjs 记录宣告，或确认 search-ledger 中已有完整条目`;
  }
  return null;
}

function requiredPreS3Stages(projectConfig, policy) {
  const mandatory = Array.isArray(policy.mandatoryWebSearchStages)
    ? policy.mandatoryWebSearchStages.map(normalizeStage)
    : ["S0", "S1", "S2"];
  const out = mandatory.filter((s) => ["S0", "S1", "S2"].includes(s));
  const hasS25Status = !!(projectConfig && Object.prototype.hasOwnProperty.call(projectConfig, "s25ActionPlanStatus"));
  if (hasS25Status) out.push("S2.5");
  return Array.from(new Set(out));
}

function hasS0TimestampEvidence(bookRoot) {
  const p = path.join(bookRoot, ".fbs", "search-ledger.jsonl");
  if (!fs.existsSync(p)) return false;
  const hints = ["今天日期", "当前年月日", "今天是哪年哪月哪日", "当前日期", "当前年月", "today date"];
  const body = fs.readFileSync(p, "utf8");
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const e = JSON.parse(t);
      if (e.kind !== "search" || e.ok === false) continue;
      const stage = normalizeStage(e.stage || e.workflowStage || e.phase || e.stageId || e.chapterId);
      if (stage !== "S0") continue;
      const q = String(e.query || e.keyword || "");
      if (hints.some((h) => q.includes(h))) return true;
    } catch {
      // skip
    }
  }
  return false;
}

function nonEmptyFileExists(filePath) {
  return fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8").trim().length > 0;
}

function printHelp() {
  console.log(HELP_TEXT);
}

function readChapterStatusEntries(statusPath) {
  const entries = [];
  let chapterIndex = 0;
  let statusIndex = 3;

  for (const line of fs.readFileSync(statusPath, "utf8").split(/\r?\n/)) {
    if (!/^\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((s) => s.trim());
    if (!cells.length) continue;

    const headerChapterIndex = cells.findIndex((cell) => cell === "章节");
    const headerStatusIndex = cells.findIndex((cell) => cell === "状态");
    if (headerChapterIndex >= 0 && headerStatusIndex >= 0) {
      chapterIndex = headerChapterIndex;
      statusIndex = headerStatusIndex;
      continue;
    }

    const chapterId = cells[chapterIndex] || "";
    const status = cells[statusIndex] || "";
    if (!/^ch\d+$/i.test(chapterId)) continue;
    entries.push({ chapterId, status });
  }

  return entries;
}

function resolveBriefCandidates(writingNotesDir, chapterId) {
  const normalized = String(chapterId || "").trim();
  const match = normalized.match(/^ch0*(\d+)$/i);
  const number = match ? String(Number(match[1])).padStart(2, "0") : null;
  const candidates = [
    path.join(writingNotesDir, `${normalized}.brief.md`),
    path.join(writingNotesDir, `${normalized.toLowerCase()}.brief.md`),
    path.join(writingNotesDir, `${normalized.toUpperCase()}.brief.md`),
  ];

  if (number) {
    candidates.push(
      path.join(writingNotesDir, `ch${number}.brief.md`),
      path.join(writingNotesDir, `Ch${number}.brief.md`),
      path.join(writingNotesDir, `brief-ch${number}.md`),
      path.join(writingNotesDir, `brief-Ch${number}.md`)
    );
  }

  return [...new Set(candidates)];
}

function hasValidBrief(candidatePath) {
  if (!fs.existsSync(candidatePath)) return false;
  return fs.readFileSync(candidatePath, "utf8").trim().length >= MIN_BRIEF_CHARS;
}

function checkBriefCoverage(bookRoot, fbs) {
  const statusPath = path.join(fbs, "chapter-status.md");
  if (!fs.existsSync(statusPath)) {
    return {
      ok: false,
      reason: `缺少章节状态台账: ${statusPath}`,
      pendingChapters: [],
      missingBriefs: [],
    };
  }

  const entries = readChapterStatusEntries(statusPath);
  const pendingChapters = entries
    .filter(({ status }) => !/(已完成|✅|done|初稿完成|完成)/i.test(status))
    .map(({ chapterId }) => chapterId);

  if (pendingChapters.length === 0) {
    return {
      ok: true,
      pendingChapters: [],
      missingBriefs: [],
    };
  }

  const writingNotesDir = path.join(fbs, "writing-notes");
  if (!fs.existsSync(writingNotesDir)) {
    return {
      ok: false,
      reason: `缺少 Brief 目录: ${writingNotesDir}`,
      pendingChapters,
      missingBriefs: pendingChapters,
    };
  }

  const missingBriefs = pendingChapters.filter((chapterId) => {
    const candidates = resolveBriefCandidates(writingNotesDir, chapterId);
    return !candidates.some(hasValidBrief);
  });

  return {
    ok: missingBriefs.length === 0,
    pendingChapters,
    missingBriefs,
  };
}

function resolveScenePackGenre(cfg) {
  const candidates = [cfg?.scenePackGenre, cfg?.genreTag, cfg?.genreLevel, 'general'];
  return candidates.find((item) => String(item || '').trim()) || 'general';
}

async function ensureScenePackReady(bookRoot, cfg, warnings) {
  const requestedGenre = resolveScenePackGenre(cfg);
  const result = await loadScenePack(bookRoot, requestedGenre, 'S3');
  if (result?.meta?.degraded && result.meta.degradeReason && result.meta.degradeReason !== 'no_pack') {
    warnings.push(`场景包已降级为 ${result.meta.degradeReason}，当前使用 ${result.meta.label || result.meta.genre || requestedGenre}`);
  }
  return {
    requestedGenre,
    result,
    ok: result?.meta?.degradeReason !== 'no_pack',
  };
}

async function main() {

  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (!args.bookRoot) {
    console.error(
      "用法: node scripts/s3-start-gate.mjs --skill-root <技能根> --book-root <本书根> " +
        "[--mode parallel_writing|single_writer] [--verify-stages] " +
        "[--no-audit-temporal] [--audit-temporal-enforce] [--no-audit-term] [--audit-term-enforce] " +
        "[--no-audit-query-opt] [--audit-query-opt-enforce]"
    );
    process.exit(2);
  }

  const skillRoot = path.resolve(args.skillRoot || process.cwd());
  const bookRoot = path.resolve(args.bookRoot);
  const fbs = path.join(bookRoot, ".fbs");
  const currentStage = readEsmCurrentState(bookRoot);

  if (currentStage && ["S4", "S5", "S6"].includes(currentStage)) {
    const warnings = [`当前阶段 ${currentStage}，S3 启动门禁不适用，已自动跳过。`];
    const stagesChecked = ["stage_applicability"];
    console.log("s3-start-gate: 结果");
    warnings.forEach((w) => console.log(`  ⚠ ${w}`));
    console.log(`  ✅ 通过（skip; stage=${currentStage}）`);
    appendGateRunLog(fbs, {
      exitCode: 0,
      failures: [],
      warnings,
      mode: "cli",
      stagesChecked,
      bookRoot,
      event: "s3_gate_skip_not_applicable",
    });
    process.exit(0);
  }

  const failures = [];
  const warnings = [];
  const stagesChecked = [];
  let hasBriefCoverageFailure = false;

  // v2.0.3 [B3]：存量项目自动检测
  // 若书稿根有 .md 文件但无 .fbs/ 目录，自动标记为存量迁入模式
  let isLegacyProject = args.legacyProject;
  if (!isLegacyProject && !fs.existsSync(fbs)) {
    const hasMdFiles = fs.existsSync(bookRoot) &&
      fs.readdirSync(bookRoot).some(f => f.endsWith('.md'));
    if (hasMdFiles) {
      isLegacyProject = true;
      warnings.push(
        '[legacy] 检测到存量项目（有 .md 文件但无 .fbs/ 目录），已自动进入存量迁入模式。' +
        '建议运行 node scripts/init-fbs-multiagent-artifacts.mjs 完成初始化后重试，' +
        '或追加 --legacy-project 参数确认此模式。'
      );
      // 为存量项目创建最小 .fbs/ 结构
      try {
        fs.mkdirSync(fbs, { recursive: true });
        const initCfg = { multiAgentMode: DEFAULT_MODE, genreLevel: 'A', genreTag: 'general', isLegacy: true, createdAt: new Date().toISOString() };
        fs.writeFileSync(path.join(fbs, 'project-config.json'), JSON.stringify(initCfg, null, 2), 'utf8');
        warnings.push('[legacy] 已自动创建初始 .fbs/project-config.json（genreLevel=A，可后续修改）');
      } catch { /* ignore */ }
    }
  }

  const cfgPath = path.join(fbs, "project-config.json");

  if (!fs.existsSync(cfgPath)) {
    if (isLegacyProject) {
      warnings.push(`[legacy] 缺少配置 ${cfgPath}，存量模式下降级为警告（不阻断）`);
    } else {
      failures.push(`缺少配置: ${cfgPath}`);
    }
  }
  const cfg = fs.existsSync(cfgPath) ? readJson(cfgPath) : null;

  const expectedMode = (args.mode || DEFAULT_MODE).trim();
  const currentMode = cfg && typeof cfg.multiAgentMode === "string" ? cfg.multiAgentMode.trim() : "";
  if (!currentMode) {
    failures.push("project-config.json 缺少 multiAgentMode");
  } else if (currentMode !== expectedMode) {
    failures.push(`multiAgentMode 不一致：配置=${currentMode}，启动参数=${expectedMode}`);
  }
  stagesChecked.push("mode_config");


  const genreLevel = cfg && typeof cfg.genreLevel === "string" ? cfg.genreLevel.trim().toUpperCase() : "";
  const genreTag = cfg && typeof cfg.genreTag === "string" ? cfg.genreTag.trim() : "";
  if (!["A", "B", "C"].includes(genreLevel)) {
    failures.push('project-config.json 缺少有效 genreLevel（必须为 "A"/"B"/"C"）');
  }
  if (!genreTag) {
    failures.push("project-config.json 缺少 genreTag（S1 后必须写入）");
  }
  stagesChecked.push("genre_config");

  const authorMetaPath = path.join(fbs, "author-meta.md");

  if (!fs.existsSync(authorMetaPath) || !fs.readFileSync(authorMetaPath, "utf8").trim()) {
    failures.push(`缺少或为空: ${authorMetaPath}`);
  }
  stagesChecked.push("author_meta");

  // P0: s0SearchStatus=all-failed-model-knowledge-only 时直接阻断（规范 §素材充分度基线检查）

  if (cfg && cfg.s0SearchStatus === "all-failed-model-knowledge-only") {
    failures.push("S0 全部检索失败（s0SearchStatus=all-failed-model-knowledge-only），禁止进入 S3；须先完成 S0 联网检索或明确启用模型知识兜底协议后解除阻断");
  }

  if (!hasS0TimestampEvidence(bookRoot)) {
    failures.push("未发现 S0 时间戳检索证据（search-ledger 需含「今天日期/当前年月日」类查询）");
  }
  stagesChecked.push("s0_timestamp");

  // P0: 搜索前置合同宣告验证（blockedIfMissingAnnouncement:true 的运行时 enforce）
  {
    const policyPath = path.join(skillRoot, "references", "05-ops", "search-policy.json");
    if (fs.existsSync(policyPath)) {
      try {
        const policy = readJson(policyPath);
        const preflightError = checkSearchPreflightAnnouncement(bookRoot, policy);
        if (preflightError) failures.push(preflightError);
      } catch {
        warnings.push("search-policy.json 解析失败，跳过前置合同宣告验证");
      }
    }
  }
  stagesChecked.push("search_preflight_contract");

  if (genreLevel === "B") {
    const bRequired = [
      path.join(bookRoot, "[S1] 证据台账.md"),
      path.join(bookRoot, "[S1] 最小成果包.md"),
      path.join(fbs, "writing-notes", "report-brief.md"),
    ];
    for (const fp of bRequired) {
      if (!nonEmptyFileExists(fp)) failures.push(`B级门禁未通过：缺少或为空 ${fp}`);
    }
  }
  stagesChecked.push("genre_b_artifacts");

  const s25Path = findS25File(bookRoot);

  if (!s25Path) {
    warnings.push("未找到 [S2.5]*.md，无法核销行动清单（建议补齐）");
  } else {
    const s25 = fs.readFileSync(s25Path, "utf8");
    const c = checkS25Checklist(s25);
    if (!c.ok) failures.push(`S2.5 未核销：未勾选项 ${c.uncheckedCount} 条，且未见“接受风险继续”`);
    else if (c.uncheckedCount > 0 && c.hasRiskAccept) warnings.push(`S2.5 存在 ${c.uncheckedCount} 条未勾选，按风险接受放行`);
  }
  stagesChecked.push("s25_checklist");

  const briefCheck = checkBriefCoverage(bookRoot, fbs);
  if (!briefCheck.ok) {
    hasBriefCoverageFailure = true;
    const briefMsg = briefCheck.missingBriefs?.length > 0
      ? `Brief 覆盖率不足：${briefCheck.missingBriefs.join("、")} 缺少 .fbs/writing-notes/{chId}.brief.md（或字符数 <${MIN_BRIEF_CHARS}）`
      : `Brief 覆盖率检查失败：${briefCheck.reason}`;
    // v2.0.3 [B3]：存量项目迁入模式下，Brief 门禁降级为警告（不触发 exit 1）
    if (isLegacyProject) {
      warnings.push(`[legacy] ${briefMsg}${BRIEF_COVERAGE_HINT}`);
    } else {
      failures.push(briefMsg);
    }
  }
  stagesChecked.push("brief_coverage");

  const materialPath = path.join(fbs, "material-library.md");
  if (fs.existsSync(materialPath)) {
    const mat = fs.readFileSync(materialPath, "utf8");
    if (/严重不足\s*❌/.test(mat) && !ACCEPT_RISK_RE.test(mat)) {
      failures.push("素材库评级为“严重不足 ❌”且未显式风险接受，阻断进入 S3");
    }
  } else {
    warnings.push(`未找到素材库: ${materialPath}`);
  }
  stagesChecked.push("material_library");

  try {
    const scenePack = await ensureScenePackReady(bookRoot, cfg, warnings);
    if (!scenePack.ok) {
      failures.push(`场景包未就绪：requested=${scenePack.requestedGenre}，degradeReason=${scenePack.result?.meta?.degradeReason || 'unknown'}`);
    }
  } catch (error) {
    failures.push(`场景包加载失败：${error.message}`);
  }
  stagesChecked.push("scene_pack");

  // P0: 无条件检查账本阶段覆盖（S0/S1/S2，若有S2.5则含S2.5）——不依赖 --verify-stages 开关


  {
    const policyPath = path.join(skillRoot, "references", "05-ops", "search-policy.json");
    if (!fs.existsSync(policyPath)) {
      warnings.push(`缺少策略文件，跳过账本阶段覆盖检查: ${policyPath}`);
    } else {
      const policy = readJson(policyPath);
      const req = requiredPreS3Stages(cfg, policy);
      const ledger = readStageLedger(bookRoot);
      if (!ledger.exists) {
        failures.push(`缺少检索账本: ${ledger.path}`);
      } else {
        const miss = req.filter((s) => !ledger.seen.has(s));
        if (miss.length) failures.push(`阶段检索未达标（pre-s3）：缺失 ${JSON.stringify(miss)}`);
        else if (args.verifyStages) {
          const passed = req.filter((s) => ledger.seen.has(s));
          console.log(`  已通过前置阶段：${JSON.stringify(passed)}`);
        }
      }
    }
  }
  stagesChecked.push("stage_ledger");

  // ESM 与正文时间标签：升级后审计建议「关键门禁内自动触发子审计」

  const early = currentStage;
  if (early && ["S0", "S1"].includes(early)) {
    warnings.push(
      `.fbs/esm-state.md 当前状态为 ${early}，进入 S3 前请确认已完成 PLAN/结构锁定并与对话宣告一致（可运行 fbs-record-esm-transition.mjs 修正）`
    );
  }

  const esmG = readEsmGenreLine(bookRoot);
  if (esmG && genreLevel && esmG !== genreLevel) {
    warnings.push(
      `体裁不一致：project-config.genreLevel=${genreLevel}，但 .fbs/esm-state.md genre=${esmG}；请运行 fbs-record-esm-transition.mjs 带 --genre 修正或更新配置`
    );
  }

  if (failures.length === 0 && !args.noAuditTemporal && hasS3MarkdownFiles(bookRoot)) {
    console.log("s3-start-gate: 运行时间标签审计（--scan-book-s3）…");
    const tr = runTemporalAuditScanS3(skillRoot, bookRoot, args.auditTemporalEnforce);
    if (tr.error) {
      warnings.push(`时间标签子进程启动失败: ${tr.error.message}`);
    } else if (tr.status !== 0) {
      if (args.auditTemporalEnforce) {
        failures.push("时间标签审计未通过（--audit-temporal-enforce）：正文存在未核实年份等 P0 问题");
      } else {
        warnings.push(
          `时间标签审计子进程退出码 ${tr.status}（默认仅提示；若需阻断请加 --audit-temporal-enforce）`
        );
      }
    }
    stagesChecked.push("temporal_audit");
  }

  if (failures.length === 0 && !args.noAuditTerm && hasS3MarkdownFiles(bookRoot)) {
    console.log("s3-start-gate: 运行术语一致性审计（--scan-book-s3）…");
    const ur = runTermAuditScanS3(skillRoot, bookRoot, args.auditTermEnforce);
    if (ur.error) {
      warnings.push(`术语审计子进程启动失败: ${ur.error.message}`);
    } else if (ur.status !== 0) {
      if (args.auditTermEnforce) {
        failures.push("术语一致性审计未通过（--audit-term-enforce）：正文中出现禁用变体");
      } else {
        warnings.push(
          `术语审计子进程退出码 ${ur.status}（默认仅提示；若需阻断请加 --audit-term-enforce）`
        );
      }
    }
    stagesChecked.push("term_audit");
  }

  const ledgerPath = path.join(bookRoot, ".fbs", "search-ledger.jsonl");
  if (
    failures.length === 0 &&
    !args.noAuditQueryOpt &&
    hasS3MarkdownFiles(bookRoot) &&
    fs.existsSync(ledgerPath) &&
    loadQueryOptimizationAuditEnabled(skillRoot)
  ) {
    console.log("s3-start-gate: 运行检索自评审计（audit-query-optimization）…");
    const qr = runQueryOptimizationAudit(skillRoot, bookRoot, args.auditQueryOptEnforce);
    if (qr.error) {
      warnings.push(`检索自评审计子进程启动失败: ${qr.error.message}`);
    } else if (qr.status !== 0) {
      if (args.auditQueryOptEnforce) {
        failures.push(
          "检索自评审计未通过（--audit-query-opt-enforce）：search-ledger 中 kind=search 缺 queryOptimization"
        );
      } else {
        warnings.push(
          `检索自评审计子进程退出码 ${qr.status}（默认仅提示；阻断请加 --audit-query-opt-enforce；可在 search-policy queryOptimizationAudit.enabled 关闭）`
        );
      }
    }
    stagesChecked.push("query_optimization_audit");
  }

  console.log("s3-start-gate: 结果");
  if (warnings.length) warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  if (failures.length) {
    failures.forEach((f) => console.error(`  ✖ ${f}`));
    if (hasBriefCoverageFailure) console.error(BRIEF_COVERAGE_HINT);
    appendGateRunLog(fbs, { exitCode: 1, failures, warnings, mode: "cli", stagesChecked, bookRoot });
    process.exit(1);
  }
  console.log(`  ✅ 通过（mode=${currentMode || "unknown"}）`);
  appendGateRunLog(fbs, { exitCode: 0, failures: [], warnings, mode: "cli", stagesChecked, bookRoot });
}


// v2.1.1：S3 门禁结果同步写入 `.fbs/test-results/`，并保留 gate-run-log.jsonl 兼容条目
function appendGateRunLog(fbs, result) {
  try {
    const ts = new Date().toISOString();
    const taskId = `gate-${ts.replace(/[:.]/g, "-").slice(0, 19)}`;

    const report = {
      $schema: "fbs-qc-report-v2.1",
      taskId,
      layer: "GATE",
      ts,
      event: result.event ?? "s3_gate_run",
      exitCode: result.exitCode,
      passed: result.exitCode === 0,
      failureCount: result.failures?.length ?? 0,
      failures: result.failures?.map(f => f.split("\n")[0]) ?? [],
      warnings: result.warnings ?? [],
      mode: result.mode ?? "cli",
      stagesChecked: result.stagesChecked ?? [],
      bookRoot: result.bookRoot,
    };

    const markdown = `# S3 启动门禁结果\n\n- **taskId**：${taskId}\n- **结论**：${report.passed ? '通过' : '失败'}\n- **失败数**：${report.failureCount}\n- **检查项**：${report.stagesChecked.join('、') || '—'}\n\n## Failures\n${report.failures.length ? report.failures.map(item => `- ${item}`).join('\n') : '- 无'}\n\n## Warnings\n${report.warnings.length ? report.warnings.map(item => `- ${item}`).join('\n') : '- 无'}\n`;

    const persisted = writeTestResultArtifacts({
      bookRoot: result.bookRoot,
      artifactId: `${taskId}-s3-gate`,
      jsonPayload: report,
      markdownContent: markdown,
    });

    const legacyEntry = {
      ts,
      event: report.event,
      exitCode: report.exitCode,
      failureCount: report.failureCount,
      failures: report.failures,
      warnings: report.warnings,
      mode: report.mode,
      stagesChecked: report.stagesChecked,
      bookRoot: report.bookRoot,
      qcReportPath: persisted.jsonPath,
      markdownPath: persisted.markdownPath,
    };
    const legacyPath = path.join(fbs, "gate-run-log.jsonl");
    fs.appendFileSync(legacyPath, JSON.stringify(legacyEntry) + "\n", "utf8");
  } catch {
    // 日志写入失败不阻断主流程
  }
}

main().catch((error) => {
  console.error(`s3-start-gate 执行失败: ${error.message}`);
  process.exit(1);
});


