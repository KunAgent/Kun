#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

function arg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

const bookRoot = arg('--book-root');
if (!bookRoot) {
  console.error('用法: node scripts/agents/audit-esm-self-check.mjs --book-root <本书根>');
  process.exit(2);
}

const p = path.join(path.resolve(bookRoot), '.fbs', 'esm-state.md');
if (!fs.existsSync(p)) {
  console.error(`缺少 ${p}`);
  process.exit(1);
}

const t = fs.readFileSync(p, 'utf8');
const hasState = /^currentState:\s*"?[A-Z_]+"?/m.test(t);
const hasTransition = /^lastTransitionAt:/m.test(t);
if (!hasState || !hasTransition) {
  console.error('esm-state.md 缺少必要字段 currentState/lastTransitionAt');
  process.exit(1);
}

console.log('audit-esm-self-check: ✅ 通过');
process.exit(0);
