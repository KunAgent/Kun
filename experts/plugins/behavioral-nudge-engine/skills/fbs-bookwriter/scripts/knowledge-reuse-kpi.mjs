#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { globSync } from 'glob';

function parseArgs(argv) {
  const o = { bookRoot: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') o.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--json') o.json = true;
  }
  return o;
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function scanManuscripts(bookRoot) {
  const files = globSync('**/*.md', {
    cwd: bookRoot,
    absolute: true,
    nodir: true,
    ignore: ['**/.fbs/**', '**/node_modules/**', '**/dist/**'],
  });
  return files;
}

export function runKnowledgeReuseKpi({ bookRoot } = {}) {
  const root = path.resolve(bookRoot || process.cwd());
  const governanceDir = path.join(root, '.fbs', 'governance');
  fs.mkdirSync(governanceDir, { recursive: true });
  const cardsPayload = readJson(path.join(governanceDir, 'search-knowledge-cards.json'), { cards: [] }) || { cards: [] };
  const cards = Array.isArray(cardsPayload.cards) ? cardsPayload.cards : [];
  const files = scanManuscripts(root);
  const reuseMap = new Map();
  for (const c of cards) reuseMap.set(c.cardId, 0);
  for (const file of files) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const c of cards) {
      const byTag = text.includes(`[KC:${c.cardId}]`);
      const byUrl = c.sourceUrl && text.includes(c.sourceUrl);
      if (byTag || byUrl) reuseMap.set(c.cardId, (reuseMap.get(c.cardId) || 0) + 1);
    }
  }
  const reused = [...reuseMap.values()].filter((n) => n > 0).length;
  const total = cards.length;
  const rate = total > 0 ? Number(((reused / total) * 100).toFixed(1)) : 0;
  const payload = {
    schemaVersion: '1.0.0',
    domain: 'governance',
    generatedAt: new Date().toISOString(),
    bookRoot: root,
    sourceCards: path.join(governanceDir, 'search-knowledge-cards.json'),
    totals: { cards: total, reusedCards: reused, reuseRate: rate, filesScanned: files.length },
    topUnused: cards
      .filter((c) => (reuseMap.get(c.cardId) || 0) === 0)
      .slice(0, 20)
      .map((c) => ({ cardId: c.cardId, statement: c.statement })),
  };
  const jsonPath = path.join(governanceDir, 'knowledge-reuse-kpi.json');
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { code: 0, message: 'ok', jsonPath, ...payload };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('用法: node scripts/knowledge-reuse-kpi.mjs --book-root <本书根> [--json]');
    process.exit(2);
  }
  const out = runKnowledgeReuseKpi(args);
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else console.log(`[knowledge-reuse] reuseRate=${out.totals.reuseRate}% cards=${out.totals.cards}`);
  process.exit(out.code);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

