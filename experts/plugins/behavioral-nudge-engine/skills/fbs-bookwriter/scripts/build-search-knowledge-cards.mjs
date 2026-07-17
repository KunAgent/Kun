#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

function parseArgs(argv) {
  const o = { bookRoot: null, json: false, minSummaryLen: 4 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') o.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--json') o.json = true;
    else if (a === '--min-summary-len') o.minSummaryLen = Math.max(1, Number(argv[++i] || 4));
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
    } catch {
      // ignore bad line
    }
  }
  return out;
}

function cardId(entry) {
  const key = `${entry.query || ''}|${entry.url || ''}|${entry.stage || ''}|${entry.chapterId || ''}`.toLowerCase();
  return `KC-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 10)}`;
}

function normalizeRiskTier(text) {
  const s = String(text || '').toLowerCase();
  if (/价格|pricing|法规|监管|compliance|版本|version|模型|model|费率|sla/.test(s)) return 'high';
  if (/市场|规模|份额|排名|数据/.test(s)) return 'medium';
  return 'low';
}

function toCard(entry, minSummaryLen) {
  const summary = String(entry.resultSummary || entry.summary || entry.message || '').trim();
  const query = String(entry.query || entry.searchScope || '').trim();
  const url = String(entry.url || '').trim();
  if (!query || !url || summary.length < minSummaryLen) return null;
  return {
    cardId: cardId(entry),
    statement: summary,
    sourceUrl: url,
    query,
    stage: String(entry.stage || entry.workflowStage || '').toUpperCase() || null,
    chapterId: String(entry.chapterId || 'global'),
    timestamp: entry.timestamp || new Date().toISOString(),
    riskTier: normalizeRiskTier(`${query} ${summary}`),
    invalidAfter: null,
  };
}

function writeMd(outPath, payload) {
  const lines = [];
  lines.push('# Search Knowledge Cards');
  lines.push('');
  lines.push(`- generatedAt: ${payload.generatedAt}`);
  lines.push(`- total: ${payload.totals.all}`);
  lines.push(`- highRisk: ${payload.totals.highRisk}`);
  lines.push('');
  lines.push('## Cards');
  for (const c of payload.cards.slice(0, 120)) {
    lines.push(`- [${c.cardId}] (${c.riskTier}) ${c.statement}`);
    lines.push(`  - source: ${c.sourceUrl}`);
    lines.push(`  - query: ${c.query}`);
  }
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
}

export function runBuildSearchKnowledgeCards({ bookRoot, minSummaryLen = 4 } = {}) {
  const root = path.resolve(bookRoot || process.cwd());
  const fbs = path.join(root, '.fbs');
  const ledgerPath = path.join(fbs, 'search-ledger.jsonl');
  const entries = parseJsonl(ledgerPath).filter((e) => e.kind === 'search' || e.kind === 'search_preflight' || !e.kind);
  const cards = [];
  const seen = new Set();
  for (const e of entries) {
    const card = toCard(e, minSummaryLen);
    if (!card) continue;
    if (seen.has(card.cardId)) continue;
    seen.add(card.cardId);
    cards.push(card);
  }
  const governanceDir = path.join(fbs, 'governance');
  fs.mkdirSync(governanceDir, { recursive: true });
  const payload = {
    schemaVersion: '1.0.0',
    domain: 'governance',
    generatedAt: new Date().toISOString(),
    bookRoot: root,
    sourceLedger: ledgerPath,
    totals: {
      all: cards.length,
      highRisk: cards.filter((x) => x.riskTier === 'high').length,
    },
    cards,
  };
  const jsonPath = path.join(governanceDir, 'search-knowledge-cards.json');
  const mdPath = path.join(governanceDir, 'search-knowledge-cards.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  writeMd(mdPath, payload);
  return { code: 0, message: 'ok', jsonPath, mdPath, ...payload };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('用法: node scripts/build-search-knowledge-cards.mjs --book-root <本书根> [--json]');
    process.exit(2);
  }
  const out = runBuildSearchKnowledgeCards(args);
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`[knowledge-cards] ${out.message}`);
    console.log(`[knowledge-cards] cards=${out.totals.all} json=${out.jsonPath}`);
  }
  process.exit(out.code);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

