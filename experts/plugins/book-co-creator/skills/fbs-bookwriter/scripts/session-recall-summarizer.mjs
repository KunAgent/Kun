#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

function parseArgs(argv) {
  const out = { bookRoot: null, query: '', jsonOut: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') out.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--query') out.query = String(argv[++i] || '');
    else if (a === '--json-out') out.jsonOut = path.resolve(argv[++i] || '');
  }
  return out;
}

function readTextSafe(abs) {
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return '';
  }
}

function clip(s, n = 140) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}

function collectCandidates(bookRoot) {
  const files = [];
  const fbs = path.join(bookRoot, '.fbs');
  const direct = ['workbuddy-resume.json', 'memory-brief.md', 'chapter-status.md'];
  for (const rel of direct) {
    const abs = path.join(fbs, rel);
    if (fs.existsSync(abs)) files.push(abs);
  }
  const reports = path.join(fbs, 'reports');
  if (fs.existsSync(reports)) {
    const rows = fs
      .readdirSync(reports)
      .map((x) => path.join(reports, x))
      .filter((x) => fs.statSync(x).isFile())
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      .slice(0, 8);
    files.push(...rows);
  }
  return files;
}

export function runSessionRecallSummarizer({ bookRoot, query = '', jsonOut = null } = {}) {
  if (!bookRoot) return { code: 2, message: 'missing --book-root' };
  const root = path.resolve(bookRoot);
  if (!fs.existsSync(root)) return { code: 2, message: `book-root not exists: ${root}` };
  const q = String(query || '').trim().toLowerCase();
  const candidates = collectCandidates(root);
  const hits = [];
  for (const abs of candidates) {
    const text = readTextSafe(abs);
    if (!text) continue;
    const lines = text.split(/\r?\n/);
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    if (!q) {
      hits.push({ file: rel, excerpt: clip(lines.find((x) => x.trim()) || '') });
      continue;
    }
    const hitLine = lines.find((x) => x.toLowerCase().includes(q));
    if (hitLine) hits.push({ file: rel, excerpt: clip(hitLine) });
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    bookRoot: root,
    query: query || null,
    hitCount: hits.length,
    summary: hits.slice(0, 6).map((h, i) => `${i + 1}. [${h.file}] ${h.excerpt}`),
    evidence: hits.slice(0, 12),
  };
  const outPath = path.resolve(jsonOut || path.join(root, '.fbs', 'session-recall-summary.json'));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return { code: 0, reportPath: outPath, ...payload };
}

function main() {
  const args = parseArgs(process.argv);
  const out = runSessionRecallSummarizer(args);
  if (out.code !== 0) {
    console.error(`[session-recall-summarizer] ${out.message}`);
    process.exit(out.code);
  }
  console.log(`[session-recall-summarizer] hits=${out.hitCount}`);
  console.log(`[session-recall-summarizer] report=${out.reportPath}`);
}

if (process.argv[1] && process.argv[1].endsWith('session-recall-summarizer.mjs')) {
  main();
}

