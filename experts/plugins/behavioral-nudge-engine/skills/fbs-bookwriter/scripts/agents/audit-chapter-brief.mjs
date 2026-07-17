#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

function arg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

const bookRoot = arg('--book-root');
const chapterId = arg('--chapter-id') || '';
if (!bookRoot) {
  console.error('用法: node scripts/agents/audit-chapter-brief.mjs --book-root <本书根> --chapter-id <章节ID>');
  process.exit(2);
}

const dir = path.join(path.resolve(bookRoot), '.fbs', 'writing-notes');
const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
const hit = files.find((f) => /brief/i.test(f) && (!chapterId || f.includes(chapterId)));
if (!hit) {
  console.error('未找到章节简报文件（writing-notes/*brief*）');
  process.exit(1);
}

const text = fs.readFileSync(path.join(dir, hit), 'utf8');
const checks = ['主题', '目标', '范围'];
const miss = checks.filter((k) => !text.includes(k));
if (miss.length) {
  console.error(`章节简报缺少字段: ${miss.join(', ')}`);
  process.exit(1);
}

console.log(`audit-chapter-brief: ✅ 通过 (${hit})`);
process.exit(0);
