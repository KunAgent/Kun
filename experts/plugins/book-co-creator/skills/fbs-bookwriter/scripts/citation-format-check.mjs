#!/usr/bin/env node
/**
 * 引用格式快速检查：
 * - A 级：正文应出现至少一个来源标注（〔来源：...〕或（来源：...））
 * - C 级：应包含“本章数据来源索引”标题
 */
import fs from "fs";
import path from "path";

function parseArgs(argv) {
  const o = { chapterFile: null, enforce: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--chapter-file") o.chapterFile = argv[++i];
    else if (a === "--enforce") o.enforce = true;
  }
  return o;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.chapterFile) {
    console.error("用法: node scripts/citation-format-check.mjs --chapter-file <章.md> [--enforce]");
    process.exit(2);
  }
  const p = path.resolve(args.chapterFile);
  if (!fs.existsSync(p)) {
    console.error(`✖ 文件不存在: ${p}`);
    process.exit(1);
  }
  const t = fs.readFileSync(p, "utf8");
  const hasInline = /〔来源：[^〕]+〕|（来源：[^）]+）/.test(t);
  const hasIndex = /(^|\n)#{1,3}\s*本章数据来源索引/.test(t);

  const issues = [];
  if (!hasInline) issues.push("缺少正文来源标注（A级）");
  if (!hasIndex) issues.push("缺少“本章数据来源索引”章节（C级）");

  if (!issues.length) {
    console.log("citation-format-check: ✅ 通过");
    process.exit(0);
  }

  console.log("citation-format-check: ⚠ 未通过");
  issues.forEach((i) => console.log(`  - ${i}`));
  process.exit(args.enforce ? 1 : 0);
}

main();
