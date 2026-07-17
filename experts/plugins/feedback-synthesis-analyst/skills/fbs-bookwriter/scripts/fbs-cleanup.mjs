#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

function parseArgs(argv) {
  const args = {
    bookRoot: null,
    target: 'stale-caches',
    json: false,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root' && argv[i + 1]) args.bookRoot = path.resolve(argv[++i]);
    else if (a === '--target' && argv[i + 1]) args.target = String(argv[++i]).trim();
    else if (a === '--json') args.json = true;
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

function staleByAge(filePath, maxHours) {
  try {
    const ageMs = Date.now() - fs.statSync(filePath).mtimeMs;
    return ageMs > maxHours * 3600000;
  } catch {
    return false;
  }
}

function cleanupStaleCaches(bookRoot, dryRun) {
  const fbsDir = path.join(bookRoot, '.fbs');
  const removed = [];
  const kept = [];
  const notes = [];
  if (!fs.existsSync(fbsDir)) {
    return { removed, kept, notes: ['.fbs 不存在，跳过'] };
  }

  const p0Report = path.join(fbsDir, 'p0-audit-report.json');
  if (fs.existsSync(p0Report)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(p0Report, 'utf8'));
      const sourceReport = typeof parsed.sourceReport === 'string' ? parsed.sourceReport : null;
      const sourceExists = sourceReport ? fs.existsSync(sourceReport) : false;
      const isStale = staleByAge(p0Report, 24);
      if (isStale && (!sourceReport || !sourceExists)) {
        if (!dryRun) fs.unlinkSync(p0Report);
        removed.push(p0Report);
      } else {
        kept.push(p0Report);
      }
    } catch {
      if (staleByAge(p0Report, 24)) {
        if (!dryRun) fs.unlinkSync(p0Report);
        removed.push(p0Report);
      } else {
        kept.push(p0Report);
      }
    }
  }

  const gatesDir = path.join(fbsDir, 'gates');
  if (fs.existsSync(gatesDir)) {
    const files = fs.readdirSync(gatesDir).filter((n) => n.endsWith('.last.json'));
    for (const name of files) {
      const abs = path.join(gatesDir, name);
      if (staleByAge(abs, 72)) {
        if (!dryRun) fs.unlinkSync(abs);
        removed.push(abs);
      } else {
        kept.push(abs);
      }
    }
  }

  notes.push(`removed=${removed.length}`, `kept=${kept.length}`);
  return { removed, kept, notes };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('用法: node scripts/fbs-cleanup.mjs --book-root <本书根> [--target stale-caches] [--dry-run] [--json]');
    process.exit(2);
  }
  if (args.target !== 'stale-caches') {
    console.error(`不支持的 target: ${args.target}`);
    process.exit(2);
  }

  const result = {
    target: args.target,
    bookRoot: args.bookRoot,
    dryRun: args.dryRun,
    timestamp: new Date().toISOString(),
    ...cleanupStaleCaches(args.bookRoot, args.dryRun),
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`fbs-cleanup(${args.target}): removed=${result.removed.length}, kept=${result.kept.length}\n`);
}

main();
