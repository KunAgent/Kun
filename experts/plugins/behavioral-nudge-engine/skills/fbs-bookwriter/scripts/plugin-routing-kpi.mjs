#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

function parseArgs(argv) {
  const out = {
    bookRoot: null,
    window: 50,
    enforce: false,
    minFirstRouteRate: 90,
    minSamples: 5,
    jsonOut: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') out.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--window') out.window = Number(argv[++i] || out.window);
    else if (a === '--enforce') out.enforce = true;
    else if (a === '--min-first-route-rate') out.minFirstRouteRate = Number(argv[++i] || out.minFirstRouteRate);
    else if (a === '--min-samples') out.minSamples = Number(argv[++i] || out.minSamples);
    else if (a === '--json-out') out.jsonOut = path.resolve(argv[++i] || '');
  }
  return out;
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  const out = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // ignore bad line
    }
  }
  return out;
}

function pct(n, d) {
  if (!d) return 0;
  return Number(((n / d) * 100).toFixed(2));
}

export function runPluginRoutingKpi({
  bookRoot,
  window = 50,
  enforce = false,
  minFirstRouteRate = 90,
  minSamples = 5,
  jsonOut = null,
} = {}) {
  if (!bookRoot) return { code: 2, message: 'missing --book-root' };
  const root = path.resolve(bookRoot);
  const logPath = path.join(root, '.fbs', 'governance', 'intake-routing-kpi.jsonl');
  const rows = readJsonl(logPath).slice(-Math.max(1, Number(window) || 50));
  const total = rows.length;
  const firstRouteOk = rows.filter((x) => Number(x.firstRouteEffective) === 1).length;
  const avgTtfwSec = total
    ? Number((rows.reduce((s, x) => s + (Number(x.ttfwSeconds) || 0), 0) / total).toFixed(2))
    : 0;
  const firstRouteRate = pct(firstRouteOk, total);
  const status = total < minSamples ? 'skipped' : firstRouteRate >= minFirstRouteRate ? 'passed' : 'failed';
  const payload = {
    generatedAt: new Date().toISOString(),
    bookRoot: root,
    windowSize: total,
    thresholds: { minFirstRouteRate },
    minSamples,
    metrics: {
      firstRouteRate,
      avgTtfwSec,
    },
    status,
    source: { intakeRoutingJsonl: logPath },
  };
  const outPath = path.resolve(jsonOut || path.join(root, '.fbs', 'governance', 'plugin-routing-kpi.json'));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  const code = enforce && status === 'failed' ? 1 : 0;
  return { code, reportPath: outPath, ...payload };
}

function main() {
  const args = parseArgs(process.argv);
  const out = runPluginRoutingKpi(args);
  console.log(`[plugin-routing-kpi] status=${out.status} firstRouteRate=${out.metrics?.firstRouteRate ?? 0}%`);
  console.log(`[plugin-routing-kpi] report=${out.reportPath}`);
  process.exit(out.code);
}

if (process.argv[1] && process.argv[1].endsWith('plugin-routing-kpi.mjs')) {
  main();
}

