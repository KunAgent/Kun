#!/usr/bin/env node
/**
 * 按磁盘真值刷新 .fbs/chapter-status.md 中的「字数」列（扩写后台账 P0/P2）
 *
 * 用法：
 *   node scripts/sync-chapter-status-chars.mjs --book-root <本书根> [--dry-run]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { countChars } from './lib/quality-runtime.mjs';

const __filename = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const o = { bookRoot: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') o.bookRoot = argv[++i];
    else if (a === '--dry-run') o.dryRun = true;
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

/**
 * @returns {{ updated: number, statusPath: string, dryRun: boolean }}
 */
export function syncChapterStatusChars(bookRoot, { dryRun = false } = {}) {
  const root = path.resolve(bookRoot);
  const statusPath = path.join(root, '.fbs', 'chapter-status.md');
  if (!fs.existsSync(statusPath)) {
    throw new Error(`syncChapterStatusChars: 未找到 ${statusPath}`);
  }

  const text = fs.readFileSync(statusPath, 'utf8');
  const lines = text.split(/\r?\n/);
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
    throw new Error('syncChapterStatusChars: 未找到表头「字数」或「字符数」列');
  }

  const out = [];
  let updated = 0;

  for (const line of lines) {
    const cells = parseTableLine(line);
    if (!cells || cells.length <= wordColIndex) {
      out.push(line);
      continue;
    }
    if (cells[0] === '章节ID' || /^[-—:]+$/.test(cells[0])) {
      out.push(line);
      continue;
    }
    const fileCell = cells[1] || '';
    const abs = resolveChapterPath(root, fileCell);
    if (!abs) {
      out.push(line);
      continue;
    }
    const chars = countChars(fs.readFileSync(abs, 'utf8'));
    const prev = cells[wordColIndex];
    if (String(prev) !== String(chars)) updated += 1;
    const nextCells = [...cells];
    nextCells[wordColIndex] = String(chars);
    out.push(`| ${nextCells.join(' | ')} |`);
  }

  const next = out.join('\n');
  if (!dryRun) {
    fs.writeFileSync(statusPath, next, 'utf8');
  }
  return { updated, statusPath, dryRun };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('sync-chapter-status-chars: 请指定 --book-root');
    process.exit(2);
  }
  try {
    const { updated, statusPath, dryRun } = syncChapterStatusChars(args.bookRoot, { dryRun: args.dryRun });
    console.log(`sync-chapter-status-chars: ${dryRun ? '（dry-run）' : ''}约 ${updated} 行字数已对齐 → ${statusPath}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
