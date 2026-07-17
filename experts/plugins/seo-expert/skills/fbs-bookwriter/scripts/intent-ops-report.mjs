#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NaturalLanguageEngine } from './nlu-optimization.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {
    out: path.join(ROOT, '.fbs', 'governance', 'intent-ops-report.json'),
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) out.out = path.resolve(argv[++i]);
  }
  return out;
}

const SAMPLE_CASES = [
  '福帮手',
  '帮我写一本白皮书',
  '继续上次第3章',
  '质量自检一下',
  '导出pdf',
  '退出福帮手',
  '好',
  '可以',
  '帮我看看',
];

function main() {
  const args = parseArgs(process.argv);
  const engine = new NaturalLanguageEngine();
  const rows = SAMPLE_CASES.map((text) => ({ text, ...engine.recognizeIntent(text) }));
  const total = rows.length;
  const clarifyCount = rows.filter((r) => r.shouldClarify).length;
  const lowCount = rows.filter((r) => r.confidenceBand === 'low').length;
  const payload = {
    generatedAt: new Date().toISOString(),
    version: '2.1.2',
    totalCases: total,
    clarifyRate: Number(((clarifyCount / total) * 100).toFixed(2)),
    lowConfidenceRate: Number(((lowCount / total) * 100).toFixed(2)),
    rows,
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(payload, null, 2));
}

main();
