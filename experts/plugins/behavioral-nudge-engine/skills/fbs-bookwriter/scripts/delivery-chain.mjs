#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

function parseArgs(argv) {
  const out = {
    bookRoot: null,
    skillRoot: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'),
    runRefine: false,
    strict: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') out.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--skill-root') out.skillRoot = path.resolve(argv[++i] || '');
    else if (a === '--run-refine') out.runRefine = true;
    else if (a === '--strict') out.strict = true;
  }
  return out;
}

function runNode(scriptPath, args) {
  const r = spawnSync(process.execPath, [scriptPath, ...args], { stdio: 'inherit' });
  return typeof r.status === 'number' ? r.status : 2;
}

function writeReport(bookRoot, payload) {
  const out = path.join(bookRoot, '.fbs', 'governance', 'delivery-chain-last.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return out;
}

export function runDeliveryChain({ bookRoot, skillRoot, runRefine = false, strict = false } = {}) {
  if (!bookRoot) return { code: 2, message: 'missing --book-root' };
  const scriptsRoot = path.join(skillRoot, 'scripts');
  const startedAt = new Date().toISOString();
  const steps = [];

  const qualityArgs = ['--book-root', bookRoot];
  if (strict) qualityArgs.push('--strict');
  const qualityCode = runNode(path.join(scriptsRoot, 'fbs-quality-full.mjs'), qualityArgs);
  steps.push({ id: 'quality', code: qualityCode, cmd: `node scripts/fbs-quality-full.mjs ${qualityArgs.join(' ')}` });
  if (qualityCode !== 0) {
    const reportPath = writeReport(bookRoot, { startedAt, finishedAt: new Date().toISOString(), status: 'failed', steps });
    return { code: qualityCode, reportPath, status: 'failed' };
  }

  if (runRefine) {
    const refineArgs = ['--book-root', bookRoot, '--strict'];
    const refineCode = runNode(path.join(scriptsRoot, 'polish-gate.mjs'), refineArgs);
    steps.push({ id: 'refine', code: refineCode, cmd: `node scripts/polish-gate.mjs ${refineArgs.join(' ')}` });
    if (refineCode !== 0) {
      const reportPath = writeReport(bookRoot, { startedAt, finishedAt: new Date().toISOString(), status: 'failed', steps });
      return { code: refineCode, reportPath, status: 'failed' };
    }
  } else {
    steps.push({ id: 'refine', code: 0, skipped: true, reason: 'run with --run-refine to enable polish-gate' });
  }

  const exportArgs = ['--book-root', bookRoot];
  const exportCode = runNode(path.join(scriptsRoot, 'merge-chapters.mjs'), exportArgs);
  steps.push({ id: 'export', code: exportCode, cmd: `node scripts/merge-chapters.mjs ${exportArgs.join(' ')}` });
  const status = exportCode === 0 ? 'passed' : 'failed';
  const reportPath = writeReport(bookRoot, {
    startedAt,
    finishedAt: new Date().toISOString(),
    status,
    steps,
  });
  return { code: exportCode, reportPath, status };
}

function main() {
  const args = parseArgs(process.argv);
  const out = runDeliveryChain(args);
  console.log(`[delivery-chain] status=${out.status}`);
  console.log(`[delivery-chain] report=${out.reportPath}`);
  process.exit(out.code);
}

if (process.argv[1] && process.argv[1].endsWith('delivery-chain.mjs')) {
  main();
}

