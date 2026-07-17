#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureGovernanceDir } from './lib/governance-artifacts.mjs';

function parseArgs(argv) {
  const o = {
    bookRoot: null,
    dryRun: false,
    pruneDuplicates: false,
    pruneOnExists: false,
    json: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') o.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--prune-duplicates') o.pruneDuplicates = true;
    else if (a === '--prune-on-exists') o.pruneOnExists = true;
    else if (a === '--json') o.json = true;
  }
  return o;
}

function legacyCandidates(reportsDir) {
  if (!fs.existsSync(reportsDir)) return [];
  const re = /^midterm-(performance-dashboard|governance-report|execution-chain)-.+\.(json|md)$/i;
  return fs
    .readdirSync(reportsDir)
    .filter((n) => re.test(n))
    .map((n) => path.join(reportsDir, n));
}

export function runNormalizeGovernanceArtifacts({
  bookRoot,
  dryRun = false,
  pruneDuplicates = false,
  pruneOnExists = false,
} = {}) {
  const root = path.resolve(bookRoot || process.cwd());
  const reportsDir = path.join(root, '.fbs', 'reports');
  const governanceDir = ensureGovernanceDir(root);
  const files = legacyCandidates(reportsDir);
  const moved = [];
  const skipped = [];
  const pruned = [];

  for (const src of files) {
    const filename = path.basename(src);
    const dest = path.join(governanceDir, filename);
    if (fs.existsSync(dest)) {
      if (pruneOnExists) {
        if (!dryRun) fs.unlinkSync(src);
        pruned.push({ src, dest, reason: 'exists_pruned' });
        continue;
      }
      if (pruneDuplicates) {
        const srcBody = fs.readFileSync(src, 'utf8');
        const destBody = fs.readFileSync(dest, 'utf8');
        if (srcBody === destBody) {
          if (!dryRun) fs.unlinkSync(src);
          pruned.push({ src, dest, reason: 'duplicate_pruned' });
          continue;
        }
      }
      skipped.push({ src, dest, reason: 'destination_exists' });
      continue;
    }
    if (!dryRun) fs.renameSync(src, dest);
    moved.push({ src, dest });
  }

  const out = {
    code: 0,
    message: 'ok',
    bookRoot: root,
    reportsDir,
    governanceDir,
    dryRun,
    pruneDuplicates,
    pruneOnExists,
    found: files.length,
    movedCount: moved.length,
    prunedCount: pruned.length,
    skippedCount: skipped.length,
    moved,
    pruned,
    skipped,
  };
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('用法: node scripts/normalize-governance-artifacts.mjs --book-root <本书根> [--dry-run] [--prune-duplicates] [--prune-on-exists] [--json]');
    process.exit(2);
  }
  const out = runNormalizeGovernanceArtifacts(args);
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`[normalize-governance] ${out.message}`);
    console.log(`- found=${out.found} moved=${out.movedCount} pruned=${out.prunedCount} skipped=${out.skippedCount}`);
    console.log(`- reportsDir=${out.reportsDir}`);
    console.log(`- governanceDir=${out.governanceDir}`);
  }
  process.exit(0);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

