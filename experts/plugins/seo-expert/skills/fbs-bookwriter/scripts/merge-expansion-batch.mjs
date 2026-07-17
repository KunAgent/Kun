#!/usr/bin/env node
/**
 * 列出书稿根下 *.expanded.md 与对应正式稿路径（合流前人工确认用）。
 *
 * 用法：
 *   node scripts/merge-expansion-batch.mjs --book-root <本书根> [--write-report]
 *
 * 不自动覆盖正式稿；仅输出建议 rename 清单。`--write-report` 时写入 `.fbs/last-merge-report.json`（见 write-merge-report.mjs）。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildMergeReportPayload, writeMergeReportFiles } from "./write-merge-report.mjs";

const __filename = fileURLToPath(import.meta.url);

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".fbs") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith(".expanded.md")) out.push(p);
  }
}

function main() {
  let bookRoot = null;
  let writeReport = false;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--book-root") bookRoot = path.resolve(process.argv[++i]);
    else if (process.argv[i] === "--write-report") writeReport = true;
  }
  if (!bookRoot) {
    console.error("用法: node scripts/merge-expansion-batch.mjs --book-root <本书根> [--write-report]");
    process.exit(2);
  }
  const found = [];
  walk(bookRoot, found);
  if (!found.length) {
    console.log("[merge-expansion-batch] 未发现 *.expanded.md");
    process.exit(0);
  }
  const fileEntries = [];
  for (const exp of found) {
    const base = exp.replace(/\.expanded\.md$/i, ".md");
    const target = base !== exp ? base : exp.replace(".expanded", "");
    const relExp = path.relative(bookRoot, exp);
    const relTarget = path.relative(bookRoot, target);
    console.log(`[merge-expansion-batch] 临时稿: ${relExp}`);
    console.log(`  → 建议替换: ${relTarget}（须先 expansion-word-verify 与质检）`);
    fileEntries.push({ relPath: relExp, action: "scanned", absPath: exp });
  }
  if (writeReport) {
    const payload = buildMergeReportPayload({
      bookRoot,
      reason: "batch_merge",
      diffSummary: "merge-expansion-batch：发现 .expanded.md 与建议正式稿路径（未自动覆盖）",
      verifyCommands: [
        "node scripts/expansion-word-verify.mjs --book-root <本书根>",
        "node scripts/quality-auditor-lite.mjs --book-root <本书根>",
      ],
      fileEntries,
    });
    const { latest } = writeMergeReportFiles(bookRoot, payload);
    console.log(`[merge-expansion-batch] 已写合流报告: ${latest}`);
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
