#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function parseArgs(argv) {
  const o = { bookRoot: null, json: false, streakTarget: 3 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') o.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--json') o.json = true;
    else if (a === '--streak-target') o.streakTarget = Math.max(1, Number(argv[++i] || 3));
  }
  return o;
}

function listReports(governanceDir) {
  if (!fs.existsSync(governanceDir)) return [];
  return fs
    .readdirSync(governanceDir)
    .filter((n) => /^midterm-governance-report-\d{4}-W\d{2}\.json$/.test(n))
    .sort()
    .map((n) => path.join(governanceDir, n));
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function isQualified(r) {
  const s = r?.summary || {};
  return (
    Number(s.triggerRate || 0) >= 95 &&
    Number(s.temporalRate || 0) >= 90 &&
    Number(s.resumeRate || 0) >= 90 &&
    Number(s.evidenceRate || 0) >= 95 &&
    Number(s.driftCount || 0) === 0
  );
}

export function runMidtermTargetStreakCheck({ bookRoot, streakTarget = 3 } = {}) {
  const root = path.resolve(bookRoot || process.cwd());
  const governance = path.join(root, '.fbs', 'governance');
  fs.mkdirSync(governance, { recursive: true });
  const rows = listReports(governance).map(readJson).filter(Boolean);
  let streak = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (isQualified(rows[i])) streak += 1;
    else break;
  }
  const payload = {
    schemaVersion: '1.0.0',
    domain: 'governance',
    generatedAt: new Date().toISOString(),
    bookRoot: root,
    totals: { reports: rows.length, currentStreak: streak, streakTarget },
    qualified: streak >= streakTarget,
  };
  const jsonPath = path.join(governance, 'midterm-target-streak.json');
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { code: 0, message: 'ok', jsonPath, ...payload };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('用法: node scripts/midterm-target-streak-check.mjs --book-root <本书根> [--streak-target 3] [--json]');
    process.exit(2);
  }
  const out = runMidtermTargetStreakCheck(args);
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else console.log(`[target-streak] streak=${out.totals.currentStreak}/${out.totals.streakTarget} qualified=${out.qualified}`);
  process.exit(out.code);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

