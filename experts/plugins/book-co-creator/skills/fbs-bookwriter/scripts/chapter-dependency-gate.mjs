#!/usr/bin/env node
/**
 * 章节依赖门禁：校验 chapter-dependencies.json 中某章节依赖是否已完成。
 */
import fs from "fs";
import path from "path";

function parseArgs(argv) {
  const o = { bookRoot: null, chapter: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = argv[++i];
    else if (a === "--chapter") o.chapter = argv[++i];
  }
  return o;
}

function parseCompleted(statusMd) {
  const done = new Set();
  for (const line of statusMd.split(/\r?\n/)) {
    if (!/^\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((s) => s.trim());
    if (cells.length < 3) continue;
    const id = cells[0];
    const st = cells[2] || "";
    if (/^ch\d+$/i.test(id) && /已完成|✅|完成/.test(st)) done.add(id.toLowerCase());
  }
  return done;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot || !args.chapter) {
    console.error("用法: node scripts/chapter-dependency-gate.mjs --book-root <本书根> --chapter <章节id>");
    process.exit(2);
  }

  const root = path.resolve(args.bookRoot);
  const depPath = path.join(root, ".fbs", "chapter-dependencies.json");
  const stPath = path.join(root, ".fbs", "chapter-status.md");
  if (!fs.existsSync(depPath) || !fs.existsSync(stPath)) {
    console.log("chapter-dependency-gate: 缺少依赖文件，跳过");
    process.exit(0);
  }

  const dep = JSON.parse(fs.readFileSync(depPath, "utf8"));
  const done = parseCompleted(fs.readFileSync(stPath, "utf8"));
  const key = String(args.chapter).toLowerCase();
  const row = (dep.chapters || {})[key] || dep[key] || null;
  const need = Array.isArray(row?.dependsOn) ? row.dependsOn.map((x) => String(x).toLowerCase()) : [];
  const miss = need.filter((x) => !done.has(x));

  if (!miss.length) {
    console.log("chapter-dependency-gate: ✅ 依赖已满足");
    process.exit(0);
  }

  console.error(`chapter-dependency-gate: ✖ 依赖未满足: ${JSON.stringify(miss)}`);
  process.exit(1);
}

main();
