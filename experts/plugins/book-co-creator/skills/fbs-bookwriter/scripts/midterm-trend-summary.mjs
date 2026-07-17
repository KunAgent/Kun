#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

function listGovernanceReports(governanceDir) {
  if (!fs.existsSync(governanceDir)) return [];
  return fs
    .readdirSync(governanceDir)
    .filter((n) => /^midterm-governance-report-\d{4}-W\d{2}\.json$/.test(n))
    .sort()
    .map((n) => path.join(governanceDir, n));
}

function trend(values = []) {
  if (values.length < 2) return 'flat';
  const d = values[values.length - 1] - values[values.length - 2];
  if (d > 0) return 'up';
  if (d < 0) return 'down';
  return 'flat';
}

export function runMidtermTrendSummary({ bookRoot } = {}) {
  const root = path.resolve(bookRoot || process.cwd());
  const governance = path.join(root, '.fbs', 'governance');
  fs.mkdirSync(governance, { recursive: true });
  const files = listGovernanceReports(governance);
  const rows = files.map((f) => readJson(f, null)).filter(Boolean);
  const trigger = rows.map((r) => Number(r.summary?.triggerRate || 0));
  const temporal = rows.map((r) => Number(r.summary?.temporalRate || 0));
  const evidence = rows.map((r) => Number(r.summary?.evidenceRate || 0));
  const drift = rows.map((r) => Number(r.summary?.driftCount || 0));
  const recurrence = {};
  for (const r of rows) {
    for (const risk of r.risks || []) {
      const key = String(risk).slice(0, 40);
      recurrence[key] = (recurrence[key] || 0) + 1;
    }
  }
  const payload = {
    schemaVersion: '1.0.0',
    domain: 'governance',
    generatedAt: new Date().toISOString(),
    bookRoot: root,
    totals: { reports: rows.length },
    metrics: {
      trigger: { current: trigger.at(-1) || 0, trend: trend(trigger) },
      temporal: { current: temporal.at(-1) || 0, trend: trend(temporal) },
      evidence: { current: evidence.at(-1) || 0, trend: trend(evidence) },
      drift: { current: drift.at(-1) || 0, trend: trend(drift) },
    },
    recurrenceTop: Object.entries(recurrence)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([riskKey, count]) => ({ riskKey, count })),
  };
  const jsonPath = path.join(governance, 'midterm-trend-summary.json');
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { code: 0, message: 'ok', jsonPath, ...payload };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('用法: node scripts/midterm-trend-summary.mjs --book-root <本书根> [--json]');
    process.exit(2);
  }
  const out = runMidtermTrendSummary(args);
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else console.log(`[midterm-trend] reports=${out.totals.reports} trigger=${out.metrics.trigger.current}`);
  process.exit(out.code);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

