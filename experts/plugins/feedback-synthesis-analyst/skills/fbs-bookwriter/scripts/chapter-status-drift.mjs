#!/usr/bin/env node
/**
 * 对比 .fbs/chapter-status.md「字数」列与磁盘正文 countChars 真值（复盘 P0：台账虚报）
 *
 * 用法：
 *   node scripts/chapter-status-drift.mjs --book-root <本书根> [--max-drift-ratio 0.2] [--json]
 *
 * 退出码：0 无漂移或表格缺失；1 存在超阈值漂移；2 参数错误
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { countChars } from './lib/quality-runtime.mjs';

const __filename = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const o = { bookRoot: null, maxDriftRatio: 0.2, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') o.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--max-drift-ratio') o.maxDriftRatio = Number(argv[++i]) || 0.2;
    else if (a === '--json') o.json = true;
  }
  return o;
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

export function analyzeChapterStatusDrift(bookRoot, maxDriftRatio = 0.2) {
  const root = path.resolve(bookRoot);
  const statusPath = path.join(root, '.fbs', 'chapter-status.md');
  if (!fs.existsSync(statusPath)) {
    return { ok: true, rows: [], message: 'no chapter-status.md' };
  }
  const lines = fs.readFileSync(statusPath, 'utf8').split(/\r?\n/);
  let wordColIndex = -1;
  for (const line of lines) {
    const cells = parseTableLine(line);
    if (!cells) continue;
    const wi = cells.indexOf('字数');
    const ci = cells.indexOf('字符数');
    const idx = wi >= 0 ? wi : ci;
    if (idx < 0) continue;
    wordColIndex = idx;
    break;
  }
  if (wordColIndex < 0) {
    return { ok: true, rows: [], message: 'no 字数/字符数 column' };
  }

  const rows = [];
  for (const line of lines) {
    const cells = parseTableLine(line);
    if (!cells || cells.length <= wordColIndex) continue;
    if (cells[0] === '章节ID' || /^[-—:]+$/.test(cells[0])) continue;
    const fileCell = cells[1] || '';
    const abs = resolveChapterPath(root, fileCell);
    if (!abs) continue;
    const claimed = Number(String(cells[wordColIndex]).replace(/,/g, ''));
    if (!Number.isFinite(claimed)) continue;
    const actual = countChars(fs.readFileSync(abs, 'utf8'));
    const drift = claimed === 0 ? (actual === 0 ? 0 : 1) : Math.abs(actual - claimed) / claimed;
    rows.push({
      chapterId: cells[0],
      file: abs,
      claimed,
      actual,
      driftRatio: Number(drift.toFixed(4)),
      exceeds: drift > maxDriftRatio,
    });
  }
  const bad = rows.filter((r) => r.exceeds);
  return { ok: bad.length === 0, rows, bad, maxDriftRatio };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('用法: node scripts/chapter-status-drift.mjs --book-root <本书根> [--max-drift-ratio 0.2] [--json]');
    process.exit(2);
  }
  const r = analyzeChapterStatusDrift(args.bookRoot, args.maxDriftRatio);
  if (args.json) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    if (r.message) console.log(`[chapter-status-drift] ${r.message}`);
    for (const row of r.bad || []) {
      console.warn(
        `[chapter-status-drift] DRIFT ${row.chapterId}: 台账=${row.claimed} 实测=${row.actual} (ratio>${args.maxDriftRatio})`
      );
    }
    if (r.ok) console.log('[chapter-status-drift] ✅ 无超阈值漂移');
    else console.error(`[chapter-status-drift] ❌ ${r.bad.length} 行超阈值，请先 sync-chapter-status-chars`);
  }
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
