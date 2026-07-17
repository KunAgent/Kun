#!/usr/bin/env node
/**
 * 为缺失 v2.1.1 扩写计划契约区块的 expansion-plan.md 追加最小骨架（用户确认 + 空机读表占位），
 * 便于后续人工补全；不覆盖已有「## 用户确认」。
 *
 * 用法：node scripts/repair-expansion-plan-skeleton.mjs --book-root <本书根> [--dry-run]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { globSync } from "glob";

const __filename = fileURLToPath(import.meta.url);

function buildTemplateWithDetectedRow(bookRoot) {
  const cands = globSync("**/*.md", {
    cwd: bookRoot,
    nodir: true,
    windowsPathsNoEscape: true,
    ignore: ["**/.fbs/**", "**/node_modules/**", "**/dist/**", "**/references/**", "**/docs/**"],
  });
  const best = cands.find((p) => /(chapter|chapters|ch\d+|全稿|deliverables)/i.test(p)) || cands[0] || "chapters/ch01.md";
  const abs = path.resolve(bookRoot, best);
  let targetChars = 8000;
  try {
    if (fs.existsSync(abs)) {
      const n = fs.readFileSync(abs, "utf8").replace(/\s+/g, "").length;
      if (n > 0) targetChars = Math.max(3000, Math.min(20000, n + 2000));
    }
  } catch {
    // ignore
  }
  return `

## 全书目标

- 本轮扩写按章节逐步推进，优先保证事实一致与结构完整。

## 执行策略

- 推荐并行度：2（上限不超过 3）
- 每章扩写后先跑字数核验与台账同步，再进入下一章。

## 用户确认

用户确认记录：待会话记录补全（relaxed 模式不阻断）。

## 章节扩写目标表（机读）

| 章节ID | 文件 | 目标字符 | 备注 |
|--------|------|----------|------|
| CH01 | \`${best.replace(/\\/g, "/")}\` | ${targetChars} | 自动生成占位行，请按真实计划补全 |

`;
}

function parseArgs(argv) {
  const o = { bookRoot: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = path.resolve(argv[++i] || "");
    else if (a === "--dry-run") o.dryRun = true;
  }
  return o;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error("用法: node scripts/repair-expansion-plan-skeleton.mjs --book-root <本书根> [--dry-run]");
    process.exit(2);
  }
  const planPath = path.join(args.bookRoot, ".fbs", "expansion-plan.md");
  if (!fs.existsSync(planPath)) {
    console.error(`[repair-expansion-plan-skeleton] 缺少 ${planPath}`);
    process.exit(2);
  }
  let raw = fs.readFileSync(planPath, "utf8");
  if (/##\s*用户确认/i.test(raw) && /##\s*章节扩写目标表|机读/i.test(raw)) {
    console.log("[repair-expansion-plan-skeleton] 关键区块已存在，跳过");
    process.exit(0);
  }
  raw += buildTemplateWithDetectedRow(args.bookRoot);
  if (!args.dryRun) {
    fs.writeFileSync(planPath, raw, "utf8");
  }
  console.log(`[repair-expansion-plan-skeleton] ${args.dryRun ? "dry-run：" : ""}已追加最小骨架 -> ${planPath}`);
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
