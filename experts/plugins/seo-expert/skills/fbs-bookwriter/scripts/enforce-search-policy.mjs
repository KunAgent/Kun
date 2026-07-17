#!/usr/bin/env node
/**
 * 检索策略门禁（轻量实现，供 pre-s3 / chapter 验收）：
 * - 阶段覆盖（S0/S1/S2，必要时 S2.5）
 * - 账本原子字段完整性
 * - 章节最小检索次数（minQueriesPerChapter + 体裁覆写）
 * - 章节至少 1 条 L2/L3 证据（可由策略开关控制）
 *
 * 用法：
 *   node scripts/enforce-search-policy.mjs --skill-root <技能根> --book-root <本书根> --chapter-id Ch09 --verify-atomicity
 *   node scripts/enforce-search-policy.mjs --skill-root <技能根> --book-root <本书根> --verify-stages --stage-scope pre-s3
 */
import fs from "fs";
import path from "path";

function parseArgs(argv) {
  const o = {
    skillRoot: process.cwd(),
    bookRoot: null,
    chapterId: null,
    chapterFile: null,
    verifyAtomicity: false,
    verifyStages: false,
    stageScope: "pre-s3",
    noVerifyS0Timestamp: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--skill-root") o.skillRoot = argv[++i];
    else if (a === "--book-root") o.bookRoot = argv[++i];
    else if (a === "--chapter-id") o.chapterId = argv[++i];
    else if (a === "--chapter-file") o.chapterFile = argv[++i];
    else if (a === "--verify-atomicity") o.verifyAtomicity = true;
    else if (a === "--verify-stages") o.verifyStages = true;
    else if (a === "--stage-scope") o.stageScope = argv[++i] || "pre-s3";
    else if (a === "--no-verify-s0-timestamp") o.noVerifyS0Timestamp = true;
  }
  return o;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function normalizeStage(v) {
  return String(v || "").trim().toUpperCase().replace(/_/g, ".");
}

function deriveChapterIdFromFile(chapterFile) {
  const base = path.basename(chapterFile || "");
  const m = base.match(/\[S3-Ch(\d+)\]/i);
  if (!m) return null;
  return `Ch${String(parseInt(m[1], 10)).padStart(2, "0")}`;
}

function parseJsonl(p) {
  const out = [];
  const body = fs.readFileSync(p, "utf8");
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // skip invalid line
    }
  }
  return out;
}

function readPolicy(skillRoot) {
  const p = path.join(skillRoot, "references", "05-ops", "search-policy.json");
  if (!fs.existsSync(p)) return null;
  return readJson(p);
}

function readProjectConfig(bookRoot) {
  const p = path.join(bookRoot, ".fbs", "project-config.json");
  if (!fs.existsSync(p)) return {};
  try {
    return readJson(p);
  } catch {
    return {};
  }
}

function resolveMinQueries(policy, cfg) {
  let min = Number(policy?.chapterWriting?.minQueriesPerChapter || 2);
  const over = policy?.chapterWriting?.genreCheckPolicy?.overrides;
  const genreTag = String(cfg?.genreTag || "");
  if (Array.isArray(over) && genreTag) {
    for (const row of over) {
      const kws = Array.isArray(row?.matchKeywords) ? row.matchKeywords : [];
      if (kws.some((k) => genreTag.includes(String(k)))) {
        min = Number(row?.minQueriesPerChapter || min);
        break;
      }
    }
  }
  return Math.max(1, min);
}

function requiredStages(policy, cfg) {
  const mandatory = Array.isArray(policy?.mandatoryWebSearchStages)
    ? policy.mandatoryWebSearchStages.map(normalizeStage)
    : ["S0", "S1", "S2"];
  const out = mandatory.filter((s) => ["S0", "S1", "S2", "S3", "S5"].includes(s));
  if (Object.prototype.hasOwnProperty.call(cfg || {}, "s25ActionPlanStatus")) out.push("S2.5");
  return Array.from(new Set(out));
}

function hasS0TimestampEvidence(entries) {
  const hints = ["今天日期", "当前年月日", "今天是哪年哪月哪日", "当前日期", "当前年月", "today date"];
  return entries.some((e) => {
    if (e.kind !== "search" || e.ok === false) return false;
    const stage = normalizeStage(e.stage || e.workflowStage || e.phase || e.stageId || e.chapterId);
    const q = String(e.query || e.keyword || "");
    const dim = String(e.s0Dimension || e.dimension || "").toLowerCase();
    const yearConfirmed = e.yearSourceConfirmed === true;

    if (stage === "S0" && hints.some((h) => q.includes(h))) return true;
    if (stage === "S0" && yearConfirmed) return true;
    if (dim === "timestampcheck" || dim === "ts") return true;
    return false;
  });
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error("用法: node scripts/enforce-search-policy.mjs --skill-root <技能根> --book-root <本书根> [--chapter-id ChNN|--chapter-file <文件>] [--verify-stages] [--verify-atomicity]");
    process.exit(2);
  }

  const skillRoot = path.resolve(args.skillRoot || process.cwd());
  const bookRoot = path.resolve(args.bookRoot);
  const policy = readPolicy(skillRoot) || {};
  const cfg = readProjectConfig(bookRoot);

  const ledgerPath = path.join(bookRoot, ".fbs", "search-ledger.jsonl");
  if (!fs.existsSync(ledgerPath)) {
    console.error(`✖ 缺少检索账本: ${ledgerPath}`);
    process.exit(1);
  }
  const entries = parseJsonl(ledgerPath);
  const failures = [];

  if (!args.noVerifyS0Timestamp && !hasS0TimestampEvidence(entries)) {
    failures.push("未发现 S0 时间基准检索证据");
  }

  if (args.verifyStages || args.stageScope === "pre-s3") {
    const need = requiredStages(policy, cfg);
    const seen = new Set(
      entries
        .filter((e) => e.kind === "search" && e.ok !== false)
        .map((e) => normalizeStage(e.stage || e.workflowStage || e.phase || e.stageId || e.chapterId))
        .filter(Boolean)
    );
    const miss = need.filter((s) => !seen.has(s));
    if (miss.length) failures.push(`pre-s3 阶段检索缺失: ${JSON.stringify(miss)}`);
  }

  if (args.verifyAtomicity) {
    const required = ["timestamp", "query", "url", "ok", "resultSummary", "chapterId", "depthLevel"];
    const bad = entries
      .filter((e) => e.kind === "search")
      .find((e) => required.some((k) => !Object.prototype.hasOwnProperty.call(e, k)));
    if (bad) {
      const miss = required.filter((k) => !Object.prototype.hasOwnProperty.call(bad, k));
      failures.push(`检索账本原子字段缺失: ${JSON.stringify(miss)}`);
    }
  }

  if (chapterId) {

    const minQ = resolveMinQueries(policy, cfg);
    const chapterEntries = searchEntries.filter((e) => {
      const c = String(e.chapterId || e.chapter || e.stageId || "").toLowerCase();
      return c === String(chapterId).toLowerCase();
    });


    if (chapterEntries.length < minQ) {
      failures.push(`${chapterId} 检索次数不足：${chapterEntries.length} < ${minQ}`);
    }

    const requireL2 = policy?.chapterWriting?.requireL2EvidencePerChapter !== false;
    if (requireL2) {
      const hasL2 = chapterEntries.some((e) => ["L2", "L3"].includes(String(e.depthLevel || "").toUpperCase()));
      if (!hasL2) failures.push(`${chapterId} 缺少 L2/L3 一手来源证据`);
    }
  }

  if (failures.length) {
    console.error("enforce-search-policy: ✖ 未通过");
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }

  console.log("enforce-search-policy: ✅ 通过");
  process.exit(0);
}

main();
