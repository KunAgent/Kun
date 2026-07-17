#!/usr/bin/env node
/**
 * 相邻章标题/小节标题 Jaccard 相似度（启发式，防扩写重复论点）。
 *
 * 用法：
 *   node scripts/adjacent-chapter-similarity.mjs --file-a <md> --file-b <md> [--warn 0.35]
 *
 * 退出码：0；相似度≥阈值时 stderr 警告。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);

function headings(text) {
  const set = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = /^(#{2,3})\s+(.+)$/.exec(line.trim());
    if (m) {
      const words = m[2].replace(/[`「」]/g, "").split(/[\s\u3000]+/).filter((w) => w.length > 1);
      words.forEach((w) => set.add(w));
    }
  }
  return set;
}

function jaccard(a, b) {
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function parseArgs(argv) {
  const o = { fileA: null, fileB: null, warn: 0.35 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--file-a") o.fileA = argv[++i];
    else if (argv[i] === "--file-b") o.fileB = argv[++i];
    else if (argv[i] === "--warn") o.warn = Number(argv[++i]) || 0.35;
  }
  return o;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.fileA || !args.fileB) {
    console.error("用法: node scripts/adjacent-chapter-similarity.mjs --file-a <md> --file-b <md> [--warn 0.35]");
    process.exit(2);
  }
  const ta = fs.readFileSync(args.fileA, "utf8");
  const tb = fs.readFileSync(args.fileB, "utf8");
  const ha = headings(ta);
  const hb = headings(tb);
  const sim = jaccard(ha, hb);
  console.log(`[adjacent-chapter-similarity] Jaccard=${sim.toFixed(3)} (${path.basename(args.fileA)} vs ${path.basename(args.fileB)})`);
  if (sim >= args.warn) {
    console.warn(
      `[adjacent-chapter-similarity] WARN: 相邻章标题词重叠较高，扩写时请核对「本章边界」避免论点重复。`
    );
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
