#!/usr/bin/env node
/**
 * 对照 expansion-plan 中的素材要求与 material-library 条目规模（启发式 Warning）。
 *
 * 用法：
 *   node scripts/expansion-plan-vs-material.mjs --book-root <本书根>
 *
 * 退出码：0 始终（仅打印 Warning）；不阻断 CI。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);

function countMaterialItems(text) {
  const matHeaders = text.match(/^##\s+素材条目\s*·\s*MAT-/gim);
  return matHeaders ? matHeaders.length : 0;
}

function parseArgs(argv) {
  const o = { bookRoot: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--book-root") o.bookRoot = path.resolve(argv[++i]);
  }
  return o;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error("用法: node scripts/expansion-plan-vs-material.mjs --book-root <本书根>");
    process.exit(2);
  }
  const planPath = path.join(args.bookRoot, ".fbs", "expansion-plan.md");
  const libPath = path.join(args.bookRoot, ".fbs", "material-library.md");
  if (!fs.existsSync(planPath)) {
    console.log("[expansion-plan-vs-material] skip: no expansion-plan.md");
    process.exit(0);
  }
  const plan = fs.readFileSync(planPath, "utf8");
  let libCount = 0;
  if (fs.existsSync(libPath)) {
    libCount = countMaterialItems(fs.readFileSync(libPath, "utf8"));
  }
  const needsS0 = /需先补\s*S0|需补充素材|严重不足/i.test(plan);
  if (needsS0 && libCount < 5) {
    console.warn(
      `[expansion-plan-vs-material] WARN: 计划标注需补 S0 但 material-library 条目较少（约 ${libCount}），请先补素材再扩写。`
    );
  } else if (libCount === 0 && /目标字符|扩写/i.test(plan)) {
    console.warn("[expansion-plan-vs-material] WARN: material-library 未见素材条目，扩写指标可能缺支撑。");
  } else {
    console.log(`[expansion-plan-vs-material] OK: material-library 条目约 ${libCount}（启发式）`);
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
