#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

function parseArgs(argv) {
  const o = { bookRoot: null, chapterId: null, scanBookS3: false, enforce: false, glob: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') o.bookRoot = argv[++i];
    else if (a === '--chapter-id') o.chapterId = argv[++i];
    else if (a === '--scan-book-s3') o.scanBookS3 = true;
    else if (a === '--glob') o.glob = argv[++i];
    else if (a === '--enforce') o.enforce = true;
  }
  return o;
}

function targetFiles(bookRoot, args) {
  const root = path.resolve(bookRoot);
  const names = fs.existsSync(root) ? fs.readdirSync(root) : [];
  if (args.scanBookS3) {
    return names.filter((n) => /^\[S3.*\.md$/i.test(n)).map((n) => path.join(root, n));
  }
  if (args.chapterId) {
    return names.filter((n) => n.endsWith('.md') && n.includes(args.chapterId)).map((n) => path.join(root, n));
  }
  return names.filter((n) => n.endsWith('.md')).map((n) => path.join(root, n));
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('用法: node scripts/audit-temporal-accuracy.mjs --book-root <本书根> [--scan-book-s3] [--chapter-id <ID>] [--enforce]');
    process.exit(2);
  }

  const files = targetFiles(args.bookRoot, args);
  if (files.length === 0) {
    console.log('audit-temporal-accuracy: 无匹配文件，跳过');
    process.exit(0);
  }

  const yearRe = /\b(19|20)\d{2}\b/g;
  const sourceHint = /(MAT-\d+|\[[0-9]+\]|https?:\/\/|来源|出处|\[\[时间:[^\]]+\]\])/;
  const violations = [];

  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (!yearRe.test(line)) return;
      yearRe.lastIndex = 0;
      if (!sourceHint.test(line)) {
        violations.push({ file: f, line: idx + 1, text: line.trim().slice(0, 120) });
      }
    });
  }

  console.log(`audit-temporal-accuracy: 检查文件=${files.length}, 违规=${violations.length}`);
  violations.slice(0, 30).forEach((v) => console.log(`  - ${v.file}:${v.line} ${v.text}`));

  if (args.enforce && violations.length > 0) process.exit(1);
  process.exit(0);
}

main();
