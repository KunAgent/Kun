#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

function parseArgs(argv) {
  const out = {
    bookRoot: null,
    maxPerFileKb: 512,
    maxTotalMb: 8,
    enforce: false,
    jsonOut: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') out.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--max-per-file-kb') out.maxPerFileKb = Number(argv[++i] || out.maxPerFileKb);
    else if (a === '--max-total-mb') out.maxTotalMb = Number(argv[++i] || out.maxTotalMb);
    else if (a === '--enforce') out.enforce = true;
    else if (a === '--json-out') out.jsonOut = path.resolve(argv[++i] || '');
  }
  return out;
}

function scanDir(baseDir, relDir, rows) {
  const dir = path.join(baseDir, relDir);
  if (!fs.existsSync(dir)) return;
  const walk = (current) => {
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const abs = path.join(current, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = path.relative(baseDir, abs).replace(/\\/g, '/');
      const ext = path.extname(rel).toLowerCase();
      if (!['.json', '.jsonl', '.md', '.txt', '.log'].includes(ext)) continue;
      try {
        const stat = fs.statSync(abs);
        rows.push({
          path: rel,
          bytes: stat.size,
          kb: Number((stat.size / 1024).toFixed(2)),
        });
      } catch {
        // ignore
      }
    }
  };
  walk(dir);
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

export function runToolOutputBudgetGate({
  bookRoot,
  maxPerFileKb = 512,
  maxTotalMb = 8,
  enforce = false,
  jsonOut = null,
} = {}) {
  if (!bookRoot) return { code: 2, message: 'missing --book-root' };
  const root = path.resolve(bookRoot);
  if (!fs.existsSync(root)) return { code: 2, message: `book-root not exists: ${root}` };

  const rows = [];
  scanDir(root, '.fbs', rows);
  scanDir(root, 'qc-output', rows);
  const totalBytes = rows.reduce((sum, x) => sum + x.bytes, 0);
  const totalMb = Number((totalBytes / 1024 / 1024).toFixed(2));
  const oversized = rows.filter((x) => x.kb > maxPerFileKb).sort((a, b) => b.kb - a.kb);
  const overTotal = totalMb > maxTotalMb;
  const status = oversized.length === 0 && !overTotal ? 'passed' : 'warn';
  const outPath = path.resolve(jsonOut || path.join(root, '.fbs', 'governance', 'tool-output-budget-gate.json'));
  const payload = {
    generatedAt: new Date().toISOString(),
    bookRoot: root,
    status,
    thresholds: { maxPerFileKb, maxTotalMb },
    totals: { files: rows.length, totalMb },
    oversized,
    recommendations: [
      '将超大工具输出外置到 .fbs/governance 或 qc-output，并在对话中返回路径指针。',
      '优先保留 summary 字段，避免把整份 JSON 回注到主上下文。',
    ],
  };
  writeJson(outPath, payload);
  const code = enforce && status !== 'passed' ? 1 : 0;
  return { code, reportPath: outPath, ...payload };
}

function main() {
  const args = parseArgs(process.argv);
  const out = runToolOutputBudgetGate(args);
  if (out.reportPath) {
    console.log(`[tool-output-budget-gate] status=${out.status} total=${out.totals?.totalMb ?? '?'}MB`);
    console.log(`[tool-output-budget-gate] report=${out.reportPath}`);
  } else {
    console.log(`[tool-output-budget-gate] ${out.message}`);
  }
  process.exit(out.code);
}

if (process.argv[1] && process.argv[1].endsWith('tool-output-budget-gate.mjs')) {
  main();
}

