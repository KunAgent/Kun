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
  if (args.scanBookS3) return names.filter((n) => /^\[S3.*\.md$/i.test(n)).map((n) => path.join(root, n));
  if (args.chapterId) return names.filter((n) => n.endsWith('.md') && n.includes(args.chapterId)).map((n) => path.join(root, n));
  return names.filter((n) => n.endsWith('.md')).map((n) => path.join(root, n));
}

function parseVariantMap(lockText) {
  const map = [];
  const lines = lockText.split(/\r?\n/);
  for (const line of lines) {
    const arrow = line.match(/([^\s|`“”"']+)\s*(?:->|→|=>|替换为)\s*([^\s|`“”"']+)/);
    if (arrow) {
      map.push({ from: arrow[1].trim(), to: arrow[2].trim() });
      continue;
    }
    const cols = line.split('|').map((x) => x.trim()).filter(Boolean);
    if (cols.length >= 2 && cols[0] !== '禁用变体' && cols[1] !== '标准术语' && !/^[-:]+$/.test(cols[0])) {
      if (cols[0].length > 1 && cols[1].length > 1) map.push({ from: cols[0], to: cols[1] });
    }
  }
  const dedup = new Map();
  for (const item of map) dedup.set(`${item.from}=>${item.to}`, item);
  return [...dedup.values()];
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('用法: node scripts/audit-term-consistency.mjs --book-root <本书根> [--scan-book-s3] [--chapter-id <ID>] [--enforce]');
    process.exit(2);
  }

  const root = path.resolve(args.bookRoot);
  const lockFile = path.join(root, '.fbs', '术语锁定记录.md');
  if (!fs.existsSync(lockFile)) {
    console.log(`audit-term-consistency: 未找到术语锁定记录 ${lockFile}，跳过`);
    process.exit(0);
  }

  const variantMap = parseVariantMap(fs.readFileSync(lockFile, 'utf8'));
  if (variantMap.length === 0) {
    console.log('audit-term-consistency: 未解析到禁用变体，跳过');
    process.exit(0);
  }

  const files = targetFiles(root, args);
  const violations = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const pair of variantMap) {
      if (text.includes(pair.from)) {
        violations.push({ file: f, from: pair.from, to: pair.to });
      }
    }
  }

  console.log(`audit-term-consistency: 规则=${variantMap.length}, 文件=${files.length}, 违规=${violations.length}`);
  violations.slice(0, 30).forEach((v) => console.log(`  - ${v.file}: ${v.from} -> ${v.to}`));

  if (args.enforce && violations.length > 0) process.exit(1);
  process.exit(0);
}

main();
