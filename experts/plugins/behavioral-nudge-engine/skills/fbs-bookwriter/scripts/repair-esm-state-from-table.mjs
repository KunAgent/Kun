#!/usr/bin/env node
/**
 * 修复 .fbs/esm-state.md 中 frontmatter currentState 与正文表格「当前状态」不一致的问题（WorkBuddy 实测 P0-01）。
 * 策略：以 Markdown 表格为准，覆盖 frontmatter 中的 currentState 为 S0–S6。
 *
 * 用法：node scripts/repair-esm-state-from-table.mjs --book-root <本书根> [--dry-run] [--json]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseFrontmatterCurrentState } from "./workbuddy-session-snapshot.mjs";

const __filename = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const o = { bookRoot: null, dryRun: false, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = path.resolve(argv[++i] || "");
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--json") o.json = true;
  }
  return o;
}

function parseTableStageS(content) {
  const rowRes = [
    /\|\s*当前状态\s*\|\s*[^|\r\n]*?(S[0-6])(?![0-9])/i,
    /\|\s*当前阶段\s*\|\s*[^|\r\n]*?(S[0-6])(?![0-9])/i,
  ];
  for (const re of rowRes) {
    const m = content.match(re);
    if (m && m[1]) return m[1].toUpperCase();
  }
  return null;
}

function replaceCurrentStateInFrontmatter(raw, tableStage) {
  const m = raw.match(/^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!m) return { changed: false, next: raw };
  const inner = m[2].replace(/^(\s*currentState:\s*)([^\r\n]+)/m, `$1"${tableStage}"`);
  if (inner === m[2]) return { changed: false, next: raw };
  return { changed: true, next: m[1] + inner + m[3] + raw.slice(m[0].length) };
}

export function repairEsmStateFromTable(bookRoot, { dryRun = false } = {}) {
  const root = path.resolve(bookRoot);
  const p = path.join(root, ".fbs", "esm-state.md");
  if (!fs.existsSync(p)) {
    return { ok: false, code: 2, message: `missing ${p}`, path: p };
  }
  const raw = fs.readFileSync(p, "utf8");
  const tableStage = parseTableStageS(raw);
  if (!tableStage) {
    return { ok: false, code: 1, message: "未在表格中解析到 S0–S6，跳过", path: p };
  }
  const fmStage = parseFrontmatterCurrentState(raw);
  if (fmStage === tableStage) {
    return { ok: true, code: 0, message: "frontmatter 与表格阶段已一致，无需写入", path: p, tableStage };
  }

  const { changed, next } = replaceCurrentStateInFrontmatter(raw, tableStage);
  if (!changed) {
    return { ok: false, code: 1, message: "无法替换 frontmatter 内 currentState（缺少字段或格式异常）", path: p };
  }
  if (!dryRun) {
    fs.writeFileSync(p, next, "utf8");
  }
  return {
    ok: true,
    code: 0,
    message: dryRun ? "dry-run：将同步 frontmatter 至表格阶段" : "已同步 frontmatter currentState 至表格阶段",
    path: p,
    tableStage,
    dryRun,
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error("用法: node scripts/repair-esm-state-from-table.mjs --book-root <本书根> [--dry-run] [--json]");
    process.exit(2);
  }
  const r = repairEsmStateFromTable(args.bookRoot, { dryRun: args.dryRun });
  if (args.json) console.log(JSON.stringify(r, null, 2));
  else console.log(`[repair-esm-state-from-table] ${r.message} ${r.tableStage || ""}`);
  process.exit(r.code === 0 || r.code === 1 ? 0 : 2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
