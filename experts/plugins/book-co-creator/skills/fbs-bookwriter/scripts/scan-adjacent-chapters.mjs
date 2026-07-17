#!/usr/bin/env node
/**
 * 按 .fbs/chapter-status.md 章节顺序，对相邻章正文做标题词 Jaccard 相似度扫描（复盘 P1：跨章重复预警）。
 *
 * 用法：
 *   node scripts/scan-adjacent-chapters.mjs --book-root <本书根> [--warn 0.35]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

function headings(text) {
  const set = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = /^(#{2,3})\s+(.+)$/.exec(line.trim());
    if (m) {
      const words = m[2].replace(/[`「」]/g, '').split(/[\s\u3000]+/).filter((w) => w.length > 1);
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

function resolveChapterPath(bookRoot, fileCell) {
  const raw = String(fileCell || '').trim();
  const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(raw);
  const rel = m ? m[2].trim() : raw.replace(/`/g, '').trim();
  if (!rel) return null;
  const abs = path.resolve(bookRoot, rel);
  return fs.existsSync(abs) ? abs : null;
}

function parseTableLine(line) {
  if (!/^\|/.test(line)) return null;
  const cells = line.split('|').map((s) => s.trim());
  if (cells.length < 3) return null;
  return cells.slice(1, -1);
}

function parseArgs(argv) {
  const o = { bookRoot: null, warn: 0.35 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--book-root') o.bookRoot = path.resolve(argv[++i] || '');
    else if (argv[i] === '--warn') o.warn = Number(argv[++i]) || 0.35;
  }
  return o;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('用法: node scripts/scan-adjacent-chapters.mjs --book-root <本书根> [--warn 0.35]');
    process.exit(2);
  }
  const statusPath = path.join(args.bookRoot, '.fbs', 'chapter-status.md');
  if (!fs.existsSync(statusPath)) {
    console.log('[scan-adjacent-chapters] 无 chapter-status，跳过');
    process.exit(0);
  }
  const lines = fs.readFileSync(statusPath, 'utf8').split(/\r?\n/);
  const paths = [];
  for (const line of lines) {
    const cells = parseTableLine(line);
    if (!cells || cells[0] === '章节ID' || /^[-—:]+$/.test(cells[0] || '')) continue;
    if (cells.length < 2) continue;
    const abs = resolveChapterPath(args.bookRoot, cells[1]);
    if (abs) paths.push(abs);
  }
  if (paths.length < 2) {
    console.log('[scan-adjacent-chapters] 可解析路径不足 2，跳过');
    process.exit(0);
  }
  let maxSim = 0;
  let worst = null;
  for (let i = 1; i < paths.length; i++) {
    const ta = fs.readFileSync(paths[i - 1], 'utf8');
    const tb = fs.readFileSync(paths[i], 'utf8');
    const sim = jaccard(headings(ta), headings(tb));
    if (sim > maxSim) {
      maxSim = sim;
      worst = [paths[i - 1], paths[i]];
    }
    console.log(
      `[scan-adjacent-chapters] ${path.basename(paths[i - 1])} vs ${path.basename(paths[i])} Jaccard=${sim.toFixed(3)}`
    );
    if (sim >= args.warn) {
      console.warn('[scan-adjacent-chapters] WARN: 相邻章标题词重叠较高，请核对扩写边界与差异化结构。');
    }
  }
  if (worst) {
    console.log(`[scan-adjacent-chapters] max=${maxSim.toFixed(3)} (${path.basename(worst[0])} vs ${path.basename(worst[1])})`);
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
