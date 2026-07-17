#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function parseArgs(argv) {
  const o = { bookRoot: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') o.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--json') o.json = true;
  }
  return o;
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function mapItem(item = {}) {
  const issue = String(item.issue || '').toLowerCase();
  const tags = [];
  if (/检索|时效|时间/.test(issue)) tags.push('search-temporal');
  if (/退出|恢复|会话/.test(issue)) tags.push('session-resume');
  if (/终稿|交付|发布/.test(issue)) tags.push('release-governance');
  if (!tags.length) tags.push('general');
  const mapping = {
    rule: tags.includes('search-temporal') ? 'references/05-ops/web-search-strategy-deep.md' : 'SKILL.md',
    script:
      tags.includes('search-temporal')
        ? 'scripts/high-risk-dual-source-gate.mjs'
        : tags.includes('session-resume')
        ? 'scripts/session-exit.mjs'
        : 'scripts/midterm-execution-chain.mjs',
    test:
      tags.includes('search-temporal')
        ? 'scripts/test/midterm-governance-report.test.mjs'
        : 'scripts/test/midterm-execution-chain.test.mjs',
    doc: 'docs/reports/MIDTERM-HIGH-PERFORMANCE-ROADMAP-8W-20260416.md',
  };
  return { issueId: item.issueId || null, priority: item.priority || 'P2', issue: item.issue || '', tags, mapping };
}

export function runRetroMappingMatrix({ bookRoot } = {}) {
  const root = path.resolve(bookRoot || process.cwd());
  const fbs = path.join(root, '.fbs');
  const governance = path.join(fbs, 'governance');
  fs.mkdirSync(governance, { recursive: true });
  const retro = readJson(path.join(fbs, 'retro-action-items.json'), { items: [] }) || { items: [] };
  const unresolved = (retro.items || []).filter((x) => String(x.status || '') !== '已修复');
  const matrix = unresolved.map(mapItem);
  const payload = {
    schemaVersion: '1.0.0',
    domain: 'governance',
    generatedAt: new Date().toISOString(),
    bookRoot: root,
    totals: { unresolved: unresolved.length, mapped: matrix.length },
    matrix,
  };
  const jsonPath = path.join(governance, 'retro-mapping-matrix.json');
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { code: 0, message: 'ok', jsonPath, ...payload };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('用法: node scripts/retro-mapping-matrix.mjs --book-root <本书根> [--json]');
    process.exit(2);
  }
  const out = runRetroMappingMatrix(args);
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else console.log(`[retro-mapping] unresolved=${out.totals.unresolved} mapped=${out.totals.mapped}`);
  process.exit(out.code);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

