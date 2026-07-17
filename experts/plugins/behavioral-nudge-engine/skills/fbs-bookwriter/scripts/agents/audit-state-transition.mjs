#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

function arg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

const bookRoot = arg('--book-root');
if (!bookRoot) {
  console.error('用法: node scripts/agents/audit-state-transition.mjs --book-root <本书根>');
  process.exit(2);
}

const p = path.join(path.resolve(bookRoot), '.fbs', 'esm-state.md');
if (!fs.existsSync(p)) {
  console.error(`缺少 ${p}`);
  process.exit(1);
}

const t = fs.readFileSync(p, 'utf8');
const state = (t.match(/^currentState:\s*"?([A-Z_]+)"?/m) || [])[1];
const prev = (t.match(/^previousState:\s*"?([A-Z_]+)"?/m) || [])[1];
if (!state || !prev) {
  console.error('状态字段缺失: currentState/previousState');
  process.exit(1);
}
if (state === prev && !/lastTransitionAt:\s*"?\d{4}-\d{2}-\d{2}/m.test(t)) {
  console.error('状态未变化且缺少有效 lastTransitionAt');
  process.exit(1);
}

console.log(`audit-state-transition: ✅ 通过 (${prev} -> ${state})`);
process.exit(0);
