#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

function parseArgs(argv) {
  const o = { bookRoot: null, enforce: false, requireLedger: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') o.bookRoot = argv[++i];
    else if (a === '--enforce') o.enforce = true;
    else if (a === '--require-ledger') o.requireLedger = true;
  }
  return o;
}


function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('用法: node scripts/audit-pending-verification.mjs --book-root <本书根> [--enforce] [--require-ledger]');
    process.exit(2);
  }


  const root = path.resolve(args.bookRoot);
  const candidates = [
    path.join(root, '.fbs', 'writing-notes', 'pending-verification.md'),
    path.join(root, '.fbs', 'writing-notes', '.pending-verification.md')
  ];
  const target = candidates.find(fs.existsSync);
  if (!target) {
    if (args.requireLedger || args.enforce) {
      console.error('audit-pending-verification: 未找到待核实台账（严格模式失败）');
      process.exit(1);
    }
    console.log('audit-pending-verification: 未找到待核实台账，视为通过');
    process.exit(0);
  }


  const text = fs.readFileSync(target, 'utf8');
  const unchecked = text.split(/\r?\n/).filter((l) => /^\s*[-*]\s*\[\s\]/.test(l));
  console.log(`audit-pending-verification: 文件=${target}`);
  console.log(`  未核实条目: ${unchecked.length}`);
  unchecked.slice(0, 20).forEach((x) => console.log(`  - ${x.trim()}`));

  if (args.enforce && unchecked.length > 0) process.exit(1);
  process.exit(0);
}

main();
