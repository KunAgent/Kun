#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

function parseJsonl(filePath) {
  const out = [];
  if (!fs.existsSync(filePath)) return out;
  const body = fs.readFileSync(filePath, 'utf8');
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {}
  }
  return out;
}

function topicKey(query = '') {
  return String(query).toLowerCase().replace(/\d{4}/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 36) || 'unknown';
}

function isHighRisk(text) {
  return /价格|pricing|法规|监管|合规|版本|version|模型|model|费率|sla|政策/.test(String(text || '').toLowerCase());
}

export function runHighRiskDualSourceGate({ bookRoot, enforce = false } = {}) {
  const root = path.resolve(bookRoot || process.cwd());
  const fbs = path.join(root, '.fbs');
  const governance = path.join(fbs, 'governance');
  fs.mkdirSync(governance, { recursive: true });
  const entries = parseJsonl(path.join(fbs, 'search-ledger.jsonl')).filter((e) => (e.kind || 'search') === 'search' && e.ok !== false);
  const groups = new Map();
  for (const e of entries) {
    const q = String(e.query || '');
    const summary = String(e.resultSummary || '');
    if (!isHighRisk(`${q} ${summary}`)) continue;
    const key = `${String(e.chapterId || 'global')}::${topicKey(q || summary)}`;
    if (!groups.has(key)) groups.set(key, { chapterId: String(e.chapterId || 'global'), topic: topicKey(q || summary), urls: new Set(), samples: [] });
    const g = groups.get(key);
    if (e.url) g.urls.add(String(e.url));
    if (g.samples.length < 3) g.samples.push({ query: q, url: e.url || null });
  }
  const violations = [];
  for (const [, g] of groups) {
    if (g.urls.size < 2) violations.push({ chapterId: g.chapterId, topic: g.topic, sourceCount: g.urls.size, samples: g.samples });
  }
  const payload = {
    schemaVersion: '1.0.0',
    domain: 'governance',
    generatedAt: new Date().toISOString(),
    bookRoot: root,
    totals: { highRiskTopics: groups.size, violations: violations.length },
    violations,
  };
  const jsonPath = path.join(governance, 'high-risk-dual-source-gate.json');
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { code: enforce && violations.length > 0 ? 1 : 0, message: 'ok', jsonPath, ...payload };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('用法: node scripts/high-risk-dual-source-gate.mjs --book-root <本书根> [--enforce] [--json]');
    process.exit(2);
  }
  const out = runHighRiskDualSourceGate(args);
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else console.log(`[dual-source-gate] topics=${out.totals.highRiskTopics} violations=${out.totals.violations}`);
  process.exit(out.code);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

