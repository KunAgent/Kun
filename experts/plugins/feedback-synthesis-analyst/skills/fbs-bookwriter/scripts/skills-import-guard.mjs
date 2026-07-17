#!/usr/bin/env node
export { runSkillImportSecurityScan as runSkillsImportGuard } from './skill-import-security-scan.mjs';
import { runSkillImportSecurityScan } from './skill-import-security-scan.mjs';
import path from 'path';

function parseArgs(argv) {
  const out = { skillRoot: process.cwd(), enforce: false, jsonOut: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skill-root') out.skillRoot = path.resolve(argv[++i] || out.skillRoot);
    else if (a === '--enforce') out.enforce = true;
    else if (a === '--json-out') out.jsonOut = path.resolve(argv[++i] || '');
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const out = runSkillImportSecurityScan(args);
  console.log(`[skills-import-guard] status=${out.status} findings=${out.findings.length}`);
  process.exit(out.code);
}

if (process.argv[1] && process.argv[1].endsWith('skills-import-guard.mjs')) {
  main();
}

