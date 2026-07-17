#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { globSync } from 'glob';

function parseArgs(argv) {
  const o = { bookRoot: null, enforce: false, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') o.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--enforce') o.enforce = true;
    else if (a === '--json') o.json = true;
  }
  return o;
}

function needsCheck(line) {
  return /最新|当前|目前|今年|截至|as of|latest|current|\b(19|20)\d{2}\b/i.test(line);
}

function hasAnchor(line) {
  return /\[\[时间:[^\]]+\]\]|https?:\/\/|来源|出处|MAT-\d+/i.test(line);
}

export function runTemporalAnchorMissingChecklist({ bookRoot, enforce = false } = {}) {
  const root = path.resolve(bookRoot || process.cwd());
  const governance = path.join(root, '.fbs', 'governance');
  fs.mkdirSync(governance, { recursive: true });
  const files = globSync('**/*.md', {
    cwd: root,
    absolute: true,
    nodir: true,
    ignore: ['**/.fbs/**', '**/node_modules/**', '**/dist/**'],
  });
  const checklist = [];
  for (const file of files) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (!needsCheck(line)) return;
      if (hasAnchor(line)) return;
      checklist.push({
        file,
        line: idx + 1,
        issue: 'temporal_anchor_missing',
        snippet: line.trim().slice(0, 120),
        fixHint: '补充 [[时间:YYYY-MM-DD]] 与来源链接/出处',
      });
    });
  }
  const payload = {
    schemaVersion: '1.0.0',
    domain: 'governance',
    generatedAt: new Date().toISOString(),
    bookRoot: root,
    totals: { filesScanned: files.length, missingAnchors: checklist.length },
    checklist,
  };
  const jsonPath = path.join(governance, 'temporal-anchor-missing-checklist.json');
  const mdPath = path.join(governance, 'temporal-anchor-missing-checklist.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const mdLines = ['# Temporal Anchor Missing Checklist', '', `- missingAnchors: ${checklist.length}`, ''];
  for (const item of checklist.slice(0, 200)) mdLines.push(`- ${item.file}:${item.line} ${item.snippet}`);
  fs.writeFileSync(mdPath, `${mdLines.join('\n')}\n`, 'utf8');
  return { code: enforce && checklist.length > 0 ? 1 : 0, message: 'ok', jsonPath, mdPath, ...payload };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('用法: node scripts/temporal-anchor-missing-checklist.mjs --book-root <本书根> [--enforce] [--json]');
    process.exit(2);
  }
  const out = runTemporalAnchorMissingChecklist(args);
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else console.log(`[temporal-checklist] missing=${out.totals.missingAnchors} files=${out.totals.filesScanned}`);
  process.exit(out.code);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

