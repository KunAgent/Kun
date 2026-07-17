#!/usr/bin/env node
/**
 * 扩写字数实测：UTF-8 字符长度（与复盘报告 Node 统计一致），禁止仅凭模型估算报字数。
 *
 * 用法：
 *   node scripts/expansion-word-verify.mjs --book-root <根> --file <章节 md> --target-chars <N> [--min-ratio 0.9]
 *   node scripts/expansion-word-verify.mjs --book-root <根> --from-plan .fbs/expansion-plan.md [--min-ratio 0.9]
 *
 * 退出码：0 全部达标；1 有未达标；2 参数/文件错误
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const o = {
    bookRoot: null,
    file: null,
    targetChars: null,
    fromPlan: null,
    minRatio: 0.9,
    json: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = path.resolve(argv[++i]);
    else if (a === "--file") o.file = argv[++i];
    else if (a === "--target-chars") o.targetChars = Number(argv[++i]);
    else if (a === "--from-plan") o.fromPlan = argv[++i];
    else if (a === "--min-ratio") o.minRatio = Math.max(0.1, Math.min(1, Number(argv[++i]) || 0.9));
    else if (a === "--json") o.json = true;
  }
  return o;
}

/** 与复盘报告 `readFileSync(...,'utf8').length` 一致，使用 JS 字符串长度 */
function charLength(text) {
  return text.length;
}

/**
 * 机读表「文件」列若指向台账/配置等非正文，会导致 actual 与目标字符完全不可比（实测 P2：chapter-status.md 全文 vs 单章目标）。
 */
export function isVerifiableChapterPlanFile(absPath) {
  const base = path.basename(absPath).toLowerCase();
  if (
    /^(chapter-status|esm-state|material-library|material-inventory|book-context-brief|next-action|retro-action-items)\.md$/i.test(
      base
    )
  ) {
    return false;
  }
  return true;
}

/**
 * 简化解析 expansion-plan.md 中表格：表头须含 章节 / 文件 / 目标 等关键字之一。
 * @param {{ filterMeta?: boolean }} [options] filterMeta=false 时保留占位行（供 verify-expansion-plan-structure 统计）；默认 true 供字数实测。
 */
export function parsePlanTable(planPath, bookRoot, options = {}) {
  const filterMeta = options.filterMeta !== false;
  const raw = fs.readFileSync(planPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const rows = [];
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\|.+\|$/.test(lines[i]) && /目标.*字符|targetChars|目标字数/i.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return rows;

  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\|/.test(line)) break;
    if (/^[\|\s\-:]+$/.test(line)) continue;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
    if (cells.length < 3) continue;
    const chapterId = cells[0];
    const fileRel = cells[1].replace(/^`+|`+$/g, "");
    const target = Number(String(cells[2]).replace(/,/g, ""));
    if (!fileRel || !Number.isFinite(target) || target <= 0) continue;
    const abs = path.isAbsolute(fileRel) ? fileRel : path.join(bookRoot, fileRel);
    if (filterMeta && !isVerifiableChapterPlanFile(abs)) continue;
    rows.push({ chapterId, file: abs, targetChars: target });
  }
  return rows;
}

export function verifyOne(fileAbs, targetChars, minRatio) {
  if (!fs.existsSync(fileAbs)) {
    return { ok: false, actual: 0, minRequired: 0, targetChars, file: fileAbs, error: "file_missing" };
  }
  const text = fs.readFileSync(fileAbs, "utf8");
  const actual = charLength(text);
  const minRequired = Math.floor(targetChars * minRatio);
  return {
    ok: actual >= minRequired,
    actual,
    minRequired,
    targetChars,
    file: fileAbs,
    error: null,
  };
}

export function runExpansionWordVerify(opts) {
  const minRatio = opts.minRatio ?? 0.9;
  const results = [];

  if (opts.fromPlan) {
    const planAbs = path.isAbsolute(opts.fromPlan) ? opts.fromPlan : path.join(opts.bookRoot, opts.fromPlan);
    if (!fs.existsSync(planAbs)) {
      return { code: 2, results: [], message: `plan not found: ${planAbs}` };
    }
    const rows = parsePlanTable(planAbs, opts.bookRoot, { filterMeta: true });
    if (!rows.length) {
      const raw = fs.readFileSync(planAbs, "utf8");
      const hasMachineHeader = /目标.*字符|targetChars|目标字数/i.test(raw) && /\|.*章节/.test(raw);
      if (hasMachineHeader) {
        return {
          code: 0,
          results: [],
          message:
            "skip: expansion-plan machine table has no verifiable chapter files (e.g. placeholder points to chapter-status.md); add real .md paths under deliverables/chapters",
        };
      }
      return { code: 2, results: [], message: "no parseable rows in expansion-plan (need table with 章节|文件|目标字符)" };
    }
    for (const row of rows) {
      results.push(verifyOne(row.file, row.targetChars, minRatio));
    }
  } else if (opts.file && opts.targetChars != null && Number.isFinite(opts.targetChars)) {
    const fileAbs = path.isAbsolute(opts.file) ? opts.file : path.join(opts.bookRoot, opts.file);
    results.push(verifyOne(fileAbs, opts.targetChars, minRatio));
  } else {
    return { code: 2, results: [], message: "need --file + --target-chars or --from-plan" };
  }

  const failed = results.filter((r) => !r.ok);
  return { code: failed.length ? 1 : 0, results, message: null };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error(
      "用法: node scripts/expansion-word-verify.mjs --book-root <根> (--file <md> --target-chars <N> | --from-plan .fbs/expansion-plan.md) [--min-ratio 0.9] [--json]"
    );
    process.exit(2);
  }

  const out = runExpansionWordVerify({
    bookRoot: args.bookRoot,
    file: args.file,
    targetChars: args.targetChars,
    fromPlan: args.fromPlan,
    minRatio: args.minRatio,
  });

  if (out.message && out.code === 2) {
    console.error("[expansion-word-verify]", out.message);
    process.exit(2);
  }

  if (args.json) {
    console.log(JSON.stringify({ code: out.code, message: out.message ?? null, results: out.results }, null, 2));
  } else {
    if (out.message) {
      console.log(`[expansion-word-verify] ${out.message}`);
    }
    for (const r of out.results) {
      const status = r.error ? `ERROR ${r.error}` : r.ok ? "PASS" : "FAIL";
      console.log(
        `[expansion-word-verify] ${status} ${r.file} actual=${r.actual} minRequired=${r.minRequired} (target=${r.targetChars} × ${args.minRatio})`
      );
    }
  }

  process.exit(out.code);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
