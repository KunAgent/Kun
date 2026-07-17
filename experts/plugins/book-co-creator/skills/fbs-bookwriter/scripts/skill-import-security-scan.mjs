#!/usr/bin/env node
import fs from 'fs';
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

function walkFiles(dir, rows) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkFiles(abs, rows);
      continue;
    }
    if (/\.(md|json|jsonl)$/i.test(ent.name)) rows.push(abs);
  }
}

function createFinding(absPath, type, detail) {
  return { file: absPath.replace(/\\/g, '/'), type, detail };
}

export function runSkillImportSecurityScan({ skillRoot, enforce = false, jsonOut = null } = {}) {
  const root = path.resolve(skillRoot || process.cwd());
  const files = [];
  walkFiles(path.join(root, 'references', 'scene-packs'), files);
  const skillMd = path.join(root, 'SKILL.md');
  if (fs.existsSync(skillMd)) files.push(skillMd);
  const findings = [];

  for (const abs of files) {
    let text = '';
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (/\.\.\/\.\.\//.test(text)) findings.push(createFinding(abs, 'path-traversal', '发现 ../../ 路径穿越片段'));
    if (/[A-Za-z]:\\/.test(text)) findings.push(createFinding(abs, 'absolute-path', '发现绝对盘符路径，可能破坏可移植性'));
    if (/```(?:bash|shell|powershell)[\s\S]*?(curl|Invoke-WebRequest|wget)\b/i.test(text)) {
      findings.push(createFinding(abs, 'network-shell-snippet', '发现联网脚本片段，建议人工复核来源可信度'));
    }
    if (/(import|load|include)\s+https?:\/\//i.test(text)) {
      findings.push(createFinding(abs, 'remote-import', '发现远程导入语义，建议改为本地固定版本'));
    }
  }

  const status = findings.length === 0 ? 'passed' : 'warn';
  const reportPath = path.resolve(jsonOut || path.join(root, '.fbs', 'governance', 'skill-import-security-scan.json'));
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    skillRoot: root,
    scannedFiles: files.length,
    status,
    findings,
  };
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  const code = enforce && findings.length > 0 ? 1 : 0;
  return { code, reportPath, ...payload };
}

function main() {
  const args = parseArgs(process.argv);
  const out = runSkillImportSecurityScan(args);
  console.log(`[skill-import-security-scan] status=${out.status} findings=${out.findings.length}`);
  console.log(`[skill-import-security-scan] report=${out.reportPath}`);
  process.exit(out.code);
}

if (process.argv[1] && process.argv[1].endsWith('skill-import-security-scan.mjs')) {
  main();
}

