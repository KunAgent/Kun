#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

function parseArgs(argv) {
  const o = { skillRoot: process.cwd(), bookRoot: null, enforce: false, requireLedger: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skill-root') o.skillRoot = argv[++i];
    else if (a === '--book-root') o.bookRoot = argv[++i];
    else if (a === '--enforce') o.enforce = true;
    else if (a === '--require-ledger') o.requireLedger = true;
  }
  return o;
}


function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('用法: node scripts/audit-query-optimization.mjs --book-root <本书根> [--enforce] [--require-ledger]');
    process.exit(2);
  }


  const ledger = path.join(path.resolve(args.bookRoot), '.fbs', 'search-ledger.jsonl');
  if (!fs.existsSync(ledger)) {
    if (args.requireLedger || args.enforce) {
      console.error(`audit-query-optimization: 未找到账本 ${ledger}（严格模式失败）`);
      process.exit(1);
    }
    console.log(`audit-query-optimization: 未找到账本 ${ledger}，跳过`);
    process.exit(0);
  }


  const lines = fs.readFileSync(ledger, 'utf8').split(/\r?\n/).filter(Boolean);
  let total = 0;
  const missing = [];

  for (const [idx, line] of lines.entries()) {
    try {
      const row = JSON.parse(line);
      if (row.kind !== 'search' || row.ok === false) continue;
      total += 1;
      const q = row.queryOptimization;
      if (!q || (typeof q === 'string' && !q.trim())) {
        missing.push({ line: idx + 1, stage: row.stage || row.workflowStage || 'unknown', query: row.query || '' });
      }
    } catch {
      // ignore invalid lines
    }
  }

  console.log(`audit-query-optimization: 搜索记录=${total}, 缺失queryOptimization=${missing.length}`);
  if (missing.length) {
    for (const m of missing.slice(0, 20)) {
      console.log(`  - line ${m.line} [${m.stage}] ${m.query}`);
    }
  }

  if (args.enforce && missing.length > 0) process.exit(1);
  process.exit(0);
}

main();
