#!/usr/bin/env node
/**
 * 合流 / 并行取消 结构化报告 — 规格见 references/05-ops/fbs-optimization-roadmap-spec.md §P1-2
 *
 * 用法：
 *   node scripts/write-merge-report.mjs --book-root <本书根> --reason batch_merge [--diff-summary <文本>]
 *   [--verify <命令>]（可重复） [--file <相对路径>:<action>]（可重复，action=scanned|merged|rolled_back）
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __filename = fileURLToPath(import.meta.url);

function sha256Short(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

export function buildMergeReportPayload({
  bookRoot,
  reason,
  diffSummary = '',
  verifyCommands = [],
  fileEntries = [],
}) {
  const files = fileEntries.map(({ relPath, action, absPath }) => {
    const abs = absPath || path.join(bookRoot, relPath);
    const out = { path: relPath.replace(/\\/g, '/'), action };
    if (fs.existsSync(abs)) {
      out.sizeBytes = fs.statSync(abs).size;
      out.sha256 = sha256Short(abs);
    }
    return out;
  });
  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    reason,
    files,
    diffSummary,
    verifyCommands,
  };
}

export function writeMergeReportFiles(bookRoot, payload) {
  const fbs = path.join(bookRoot, '.fbs');
  fs.mkdirSync(fbs, { recursive: true });
  const latest = path.join(fbs, 'last-merge-report.json');
  fs.writeFileSync(latest, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const stamped = path.join(fbs, `merge-report-${ts}.json`);
  fs.writeFileSync(stamped, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return { latest, stamped };
}

function parseArgs(argv) {
  const o = {
    bookRoot: null,
    reason: 'batch_merge',
    diffSummary: '',
    verifyCommands: [],
    fileEntries: [],
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') o.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--reason') o.reason = argv[++i] || '';
    else if (a === '--diff-summary') o.diffSummary = argv[++i] || '';
    else if (a === '--verify') o.verifyCommands.push(argv[++i] || '');
    else if (a === '--file') {
      const raw = argv[++i] || '';
      const [rel, action = 'scanned'] = raw.split(':');
      if (rel) o.fileEntries.push({ relPath: rel, action, absPath: null });
    }
  }
  return o;
}

function main() {
  const o = parseArgs(process.argv);
  if (!o.bookRoot) {
    console.error('用法: node scripts/write-merge-report.mjs --book-root <本书根> --reason <batch_merge|parallel_cancel> ...');
    process.exit(2);
  }
  const payload = buildMergeReportPayload({
    bookRoot: o.bookRoot,
    reason: o.reason,
    diffSummary: o.diffSummary,
    verifyCommands: o.verifyCommands,
    fileEntries: o.fileEntries.map((e) => ({
      ...e,
      absPath: path.join(o.bookRoot, e.relPath),
    })),
  });
  const { latest } = writeMergeReportFiles(o.bookRoot, payload);
  console.log(`write-merge-report: 已写入 ${latest}`);
}

const entry = process.argv[1] && path.resolve(process.argv[1]);
if (entry && path.resolve(entry) === path.resolve(__filename)) {
  main();
}
