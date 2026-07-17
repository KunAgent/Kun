#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getIsoWeekLabel } from './book-state-weekly-export.mjs';
import { runMidtermTrendSummary } from './midterm-trend-summary.mjs';
import { runRetroMappingMatrix } from './retro-mapping-matrix.mjs';
import { runMidtermTargetStreakCheck } from './midterm-target-streak-check.mjs';
import { runKnowledgeReuseKpi } from './knowledge-reuse-kpi.mjs';

function parseArgs(argv) {
  const o = { bookRoot: null, weekLabel: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') o.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--week-label') o.weekLabel = String(argv[++i] || '').trim() || null;
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

export function runMidtermMilestoneReport({ bookRoot, weekLabel = null } = {}) {
  const root = path.resolve(bookRoot || process.cwd());
  const governance = path.join(root, '.fbs', 'governance');
  fs.mkdirSync(governance, { recursive: true });
  const week = weekLabel || getIsoWeekLabel(new Date());
  const governanceReport = readJson(path.join(governance, `midterm-governance-report-${week}.json`), {});
  const trend = runMidtermTrendSummary({ bookRoot: root });
  const retro = runRetroMappingMatrix({ bookRoot: root });
  const streak = runMidtermTargetStreakCheck({ bookRoot: root });
  const reuse = runKnowledgeReuseKpi({ bookRoot: root });
  const payload = {
    schemaVersion: '1.0.0',
    domain: 'governance',
    generatedAt: new Date().toISOString(),
    weekLabel: week,
    bookRoot: root,
    status: governanceReport?.status || 'unknown',
    summary: {
      governanceStatus: governanceReport?.status || 'unknown',
      trend: trend.metrics || {},
      unresolvedRetro: retro.totals?.unresolved || 0,
      targetStreak: streak.totals?.currentStreak || 0,
      targetQualified: streak.qualified || false,
      knowledgeReuseRate: reuse.totals?.reuseRate || 0,
    },
    artifacts: {
      governanceReport: path.join(governance, `midterm-governance-report-${week}.json`),
      trendSummary: trend.jsonPath,
      retroMapping: retro.jsonPath,
      targetStreak: streak.jsonPath,
      knowledgeReuse: reuse.jsonPath,
    },
  };
  const jsonPath = path.join(governance, `midterm-milestone-report-${week}.json`);
  const mdPath = path.join(governance, `midterm-milestone-report-${week}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const md = [
    `# Midterm Milestone Report (${week})`,
    '',
    `- status: ${payload.status}`,
    `- targetStreak: ${payload.summary.targetStreak}`,
    `- targetQualified: ${payload.summary.targetQualified}`,
    `- knowledgeReuseRate: ${payload.summary.knowledgeReuseRate}%`,
    '',
    '## Artifacts',
    ...Object.entries(payload.artifacts).map(([k, v]) => `- ${k}: ${v}`),
    '',
  ].join('\n');
  fs.writeFileSync(mdPath, `${md}\n`, 'utf8');
  return { code: 0, message: 'ok', jsonPath, mdPath, ...payload };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('用法: node scripts/midterm-milestone-report.mjs --book-root <本书根> [--week-label 2026-W16] [--json]');
    process.exit(2);
  }
  const out = runMidtermMilestoneReport(args);
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else console.log(`[milestone] status=${out.status} json=${out.jsonPath}`);
  process.exit(out.code);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

