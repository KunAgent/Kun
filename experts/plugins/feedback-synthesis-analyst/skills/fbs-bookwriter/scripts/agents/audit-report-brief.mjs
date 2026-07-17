#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

function arg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

const bookRoot = arg('--book-root');
if (!bookRoot) {
  console.error('用法: node scripts/agents/audit-report-brief.mjs --book-root <本书根>');
  process.exit(2);
}

const p = path.join(path.resolve(bookRoot), '.fbs', 'writing-notes', 'report-brief.md');
if (!fs.existsSync(p)) {
  console.error(`缺少 ${p}`);
  process.exit(1);
}

const text = fs.readFileSync(p, 'utf8');
const required = ['结论', '风险', '建议'];
const miss = required.filter((k) => !text.includes(k));
if (miss.length) {
  console.error(`report-brief 缺少字段: ${miss.join(', ')}`);
  process.exit(1);
}

console.log('audit-report-brief: ✅ 通过');
process.exit(0);
