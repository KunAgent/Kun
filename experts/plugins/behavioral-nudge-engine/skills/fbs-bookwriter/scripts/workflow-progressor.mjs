#!/usr/bin/env node
/**
 * 工作流阶段清单（轻量）：输出 chapter-status 中待处理章节摘要。
 */
import fs from "fs";
import path from "path";

function parseArgs(argv) {
  const o = { bookRoot: process.cwd(), current: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = argv[++i];
    else if (a === "--current") o.current = argv[++i];
  }
  return o;
}

function main() {
  const args = parseArgs(process.argv);
  const stPath = path.join(path.resolve(args.bookRoot), ".fbs", "chapter-status.md");
  if (!fs.existsSync(stPath)) {
    console.error(`workflow-progressor: 缺少 ${stPath}`);
    process.exit(2);
  }

  const pending = [];
  for (const line of fs.readFileSync(stPath, "utf8").split(/\r?\n/)) {
    if (!/^\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((s) => s.trim());
    if (cells.length < 3) continue;
    const id = cells[0];
    const status = cells[2] || "";
    if (!/^ch\d+$/i.test(id)) continue;
    if (!/已完成|✅|完成/.test(status)) pending.push({ id, status });
  }

  console.log(`workflow-progressor: 当前阶段=${args.current || "(未指定)"}`);
  if (!pending.length) {
    console.log("  ✅ 无待处理章节");
    process.exit(0);
  }
  console.log(`  待处理章节 ${pending.length} 个（前20项）：`);
  pending.slice(0, 20).forEach((p) => console.log(`  - ${p.id}: ${p.status}`));
  process.exit(0);
}

main();
