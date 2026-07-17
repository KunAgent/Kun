#!/usr/bin/env node
/**
 * 扩写门禁统一入口：若存在可解析的 .fbs/expansion-plan.md，则运行 expansion-word-verify；
 * 通过后默认刷新 chapter-status 字数列并写入 expansion-checkpoint（复盘 P0）。
 *
 * 用法：
 *   node scripts/expansion-gate.mjs --book-root <本书根> [--skill-root <技能根>] [--min-ratio 0.9] [--strict] [--no-sync-status]
 *        [--no-source-backup] [--backup-scope expansion|refinement|all] [--force]
 *
 * --strict：无计划或计划无数据行时退出 2（用于 CI 强制扩写验收）
 * --no-sync-status：跳过 sync-chapter-status-chars（仅调试）
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { runExpansionWordVerify } from "./expansion-word-verify.mjs";
import { syncChapterStatusChars } from "./sync-chapter-status-chars.mjs";
import { runSourceWriteBackup } from "./source-write-backup.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SKILL = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const o = {
    bookRoot: null,
    skillRoot: DEFAULT_SKILL,
    minRatio: 0.9,
    strict: false,
    syncStatus: true,
    sourceBackup: true,
    backupScope: "expansion",
    force: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = path.resolve(argv[++i]);
    else if (a === "--skill-root") o.skillRoot = path.resolve(argv[++i]);
    else if (a === "--min-ratio") o.minRatio = Number(argv[++i]) || 0.9;
    else if (a === "--strict") o.strict = true;
    else if (a === "--no-sync-status") o.syncStatus = false;
    else if (a === "--no-source-backup") o.sourceBackup = false;
    else if (a === "--backup-scope") o.backupScope = String(argv[++i] || "expansion").toLowerCase();
    else if (a === "--force") o.force = true;
  }
  return o;
}

function resolveEsmStageFromState(raw) {
  const v = String(raw || "").trim().replace(/^["']|["']$/g, "").toUpperCase();
  const map = {
    S0: "S0",
    S1: "S1",
    S2: "S2",
    S3: "S3",
    S4: "S4",
    S5: "S5",
    S6: "S6",
    INTAKE: "S0",
    IDLE: "S0",
    RESEARCH: "S1",
    PLAN: "S2",
    WRITE: "S3",
    WRITE_MORE: "S3",
    REVIEW: "S4",
    DELIVER: "S5",
  };
  return map[v] || null;
}

function detectCurrentStage(bookRoot) {
  const p = path.join(bookRoot, ".fbs", "esm-state.md");
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, "utf8");
  const table = text.match(/\|\s*(?:当前状态|当前阶段)\s*\|\s*[^|\r\n]*?(S[0-6])(?![0-9])/i);
  if (table?.[1]) return table[1].toUpperCase();
  const fm = text.match(/^\s*currentState:\s*([^\r\n]+)/m);
  return fm ? resolveEsmStageFromState(fm[1]) : null;
}

/** 与 expansion-word-verify 内解析一致：表头含「目标字符」 */
function planHasDataRows(planPath) {
  if (!fs.existsSync(planPath)) return false;
  const raw = fs.readFileSync(planPath, "utf8");
  if (!/目标字符/.test(raw)) return false;
  const lines = raw.split(/\r?\n/);
  let foundHeader = false;
  for (const line of lines) {
    if (/^\|.+\|$/.test(line) && /目标字符/.test(line)) foundHeader = true;
    if (foundHeader && /^\|.+\|$/.test(line) && !/^\|[\s\-:]+\|/.test(line) && !/章节ID/.test(line)) {
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 3 && /\d/.test(cells[2])) return true;
    }
  }
  return false;
}

function writeExpansionCheckpoint(bookRoot, { gateCode, resultCount, syncUpdated }) {
  const fbs = path.join(bookRoot, ".fbs");
  fs.mkdirSync(fbs, { recursive: true });
  const payload = {
    schemaVersion: "1.0.0",
    updatedAt: new Date().toISOString(),
    expansionGateExitCode: gateCode,
    verifiedRows: resultCount,
    chapterStatusCharsSynced: typeof syncUpdated === "number" ? syncUpdated : null,
    note: "中断恢复：以磁盘章节与 chapter-status 真值为准；并行任务取消后请对比 .expanded 临时稿",
  };
  fs.writeFileSync(path.join(fbs, "expansion-checkpoint.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function writeGateSnapshot(bookRoot, payload) {
  try {
    const gatesDir = path.join(bookRoot, ".fbs", "gates");
    fs.mkdirSync(gatesDir, { recursive: true });
    fs.writeFileSync(
      path.join(gatesDir, "expansion-gate.last.json"),
      JSON.stringify({ gateId: "expansion-gate", updatedAt: new Date().toISOString(), ...payload }, null, 2) + "\n",
      "utf8",
    );
  } catch {
    // ignore
  }
}

export function runExpansionGate(
  bookRoot,
  skillRoot,
  { minRatio = 0.9, strict = false, syncStatus = true, sourceBackup = true, backupScope = "expansion", force = false } = {}
) {
  const currentStage = detectCurrentStage(bookRoot);
  if (!force && currentStage && currentStage !== "S3") {
    return { code: 0, message: `skip: current stage ${currentStage} is not expansion stage S3` };
  }

  const planPath = path.join(bookRoot, ".fbs", "expansion-plan.md");
  if (!fs.existsSync(planPath)) {
    if (strict) return { code: 2, message: "strict: missing .fbs/expansion-plan.md" };
    return { code: 0, message: "skip: no expansion-plan.md" };
  }
  if (!planHasDataRows(planPath)) {
    if (strict) return { code: 2, message: "strict: expansion-plan has no data rows" };
    return { code: 0, message: "skip: expansion-plan empty table" };
  }

  let backupResult = null;
  if (sourceBackup) {
    backupResult = runSourceWriteBackup({ bookRoot, scope: backupScope });
    if (backupResult.code !== 0) {
      return { code: 2, message: `source backup failed: ${backupResult.message}`, results: null, syncUpdated: null };
    }
  }

  const out = runExpansionWordVerify({
    bookRoot,
    fromPlan: planPath,
    minRatio,
  });
  let syncUpdated = null;
  if (out.code === 0 && syncStatus) {
    try {
      const s = syncChapterStatusChars(bookRoot, { dryRun: false });
      syncUpdated = s.updated;
    } catch (e) {
      console.warn(`[expansion-gate] sync-chapter-status 跳过: ${e instanceof Error ? e.message : e}`);
    }
    try {
      writeExpansionCheckpoint(bookRoot, { gateCode: out.code, resultCount: out.results?.length ?? 0, syncUpdated });
    } catch (e) {
      console.warn(`[expansion-gate] checkpoint 写入失败: ${e instanceof Error ? e.message : e}`);
    }
  } else if (out.code !== 0) {
    try {
      writeExpansionCheckpoint(bookRoot, { gateCode: out.code, resultCount: out.results?.length ?? 0, syncUpdated: null });
    } catch {
      /* ignore */
    }
  }
  return { code: out.code, message: out.message || null, results: out.results, syncUpdated, backup: backupResult };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error(
      "用法: node scripts/expansion-gate.mjs --book-root <本书根> [--skill-root <技能根>] [--min-ratio 0.9] [--strict] [--no-sync-status]"
      + " [--no-source-backup] [--backup-scope expansion|refinement|all] [--force]"
    );
    process.exit(2);
  }
  const r = runExpansionGate(args.bookRoot, args.skillRoot, {
    minRatio: args.minRatio,
    strict: args.strict,
    syncStatus: args.syncStatus,
    sourceBackup: args.sourceBackup,
    backupScope: args.backupScope,
    force: args.force,
  });
  if (r.message) console.log(`[expansion-gate] ${r.message}`);
  writeGateSnapshot(args.bookRoot, {
    code: r.code,
    message: r.message || null,
    verifiedRows: Array.isArray(r.results) ? r.results.length : 0,
    backupDir: r.backup?.backupDir || null,
  });
  if (r.backup?.backupDir) {
    console.log(`[expansion-gate] source backup -> ${r.backup.backupDir} (${r.backup.count} files)`);
  }
  if (r.results) {
    for (const x of r.results) {
      const st = x.ok ? "PASS" : "FAIL";
      console.log(`[expansion-gate] ${st} ${x.file} actual=${x.actual} min=${x.minRequired}`);
    }
  }
  if (typeof r.syncUpdated === "number") {
    console.log(`[expansion-gate] chapter-status 字数列已同步（${r.syncUpdated} 行变更）`);
  }
  process.exit(r.code);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
