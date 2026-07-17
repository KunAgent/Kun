#!/usr/bin/env node
/**
 * 全书素材标注扫描：一次性输出各文件 MAT/待核实/DISCARDED 等计数（WorkBuddy 复盘 2026-04-16）。
 *
 * 用法：
 *   node scripts/material-marker-scan.mjs --book-root <本书根> [--output <path.json|path.md>] [--json]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { runMaterialMarkerFullScan } from "./material-marker-governor.mjs";

const __filename = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const o = { bookRoot: null, output: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = path.resolve(argv[++i] || "");
    else if (a === "--output" || a === "-o") o.output = argv[++i];
    else if (a === "--json") o.json = true;
  }
  return o;
}

function toMarkdown(report) {
  const lines = [
    `# 素材标注扫描报告`,
    ``,
    `- 生成时间：${report.generatedAt}`,
    `- 书稿根：${report.bookRoot}`,
    `- 文件数：${report.fileCount}`,
    ``,
    `## 合计`,
    ``,
    `| 指标 | 数量 |`,
    `|------|------|`,
    `| staleMat | ${report.totals.staleMat} |`,
    `| 待核实占位 | ${report.totals.pendingMatPlaceholder} |`,
    `| MAT todo suffix | ${report.totals.matTodoSuffix} |`,
    `| DISCARDED | ${report.totals.discardedTag} |`,
    `| 畸形待核实行 | ${report.totals.malformedPendingLine} |`,
    ``,
    `## 逐文件`,
    ``,
    `| 文件 | staleMat | 占位 | MAT后缀 | DISCARDED | 畸形 | 合计 |`,
    `|------|----------|------|---------|-----------|------|------|`,
  ];
  for (const r of report.rows) {
    lines.push(
      `| ${r.file} | ${r.staleMat} | ${r.pendingMatPlaceholder} | ${r.matTodoSuffix} | ${r.discardedTag} | ${r.malformedPendingLine} | ${r.totalMarkers} |`,
    );
  }
  return lines.join("\n") + "\n";
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error(
      "用法: node scripts/material-marker-scan.mjs --book-root <本书根> [--output <path>] [--json]",
    );
    process.exit(2);
  }
  if (!fs.existsSync(args.bookRoot)) {
    console.error("material-marker-scan: book-root 不存在");
    process.exit(2);
  }

  const report = runMaterialMarkerFullScan(args.bookRoot);
  const outPath = args.output
    ? path.isAbsolute(args.output)
      ? args.output
      : path.join(args.bookRoot, args.output)
    : null;

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const isMd = outPath.toLowerCase().endsWith(".md");
    const body = isMd ? toMarkdown(report) : JSON.stringify(report, null, 2) + "\n";
    fs.writeFileSync(outPath, body, "utf8");
    if (args.json) {
      console.log(JSON.stringify({ ok: true, written: outPath, fileCount: report.fileCount }, null, 2));
    } else {
      console.log(`[material-marker-scan] 已写入 ${outPath}（${report.fileCount} 个文件）`);
    }
  } else if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[material-marker-scan] 文件数=${report.fileCount} 合计 markers=${report.totals.totalMarkers}`);
    console.log(toMarkdown(report));
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
