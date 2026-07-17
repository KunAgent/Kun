#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const RISK_RULES = [
  { id: 'self-harm', level: 'high', re: /(自杀|自残|kill myself|suicide)/i },
  { id: 'violence-illegal', level: 'high', re: /(制作炸弹|爆炸物|枪支改造|weaponize)/i },
  { id: 'hate', level: 'high', re: /(种族灭绝|仇恨言论|hate speech)/i },
  { id: 'fraud', level: 'medium', re: /(诈骗脚本|洗钱|伪造证件|phishing kit)/i },
];

function parseArgs(argv) {
  const out = { inputFile: null, text: '', jsonOut: null, enforce: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input-file') out.inputFile = path.resolve(argv[++i] || '');
    else if (a === '--text') out.text = argv[++i] || '';
    else if (a === '--json-out') out.jsonOut = path.resolve(argv[++i] || '');
    else if (a === '--enforce') out.enforce = true;
  }
  return out;
}

function loadText(args) {
  if (args.inputFile) {
    try {
      return fs.readFileSync(args.inputFile, 'utf8');
    } catch {
      return '';
    }
  }
  return String(args.text || '');
}

export function runContentSafetyPrecheck({ inputFile = null, text = '', jsonOut = null, enforce = false } = {}) {
  const payloadText = inputFile ? (fs.existsSync(inputFile) ? fs.readFileSync(inputFile, 'utf8') : '') : String(text || '');
  const findings = [];
  for (const r of RISK_RULES) {
    if (r.re.test(payloadText)) findings.push({ id: r.id, level: r.level });
  }
  const maxLevel = findings.some((x) => x.level === 'high') ? 'high' : findings.length ? 'medium' : 'none';
  const status = maxLevel === 'none' ? 'passed' : maxLevel === 'medium' ? 'warn' : 'blocked';
  const out = {
    generatedAt: new Date().toISOString(),
    inputFile: inputFile ? path.resolve(inputFile) : null,
    textLength: payloadText.length,
    status,
    findings,
    recommendation:
      status === 'passed'
        ? '内容安全预检通过。'
        : '检测到潜在敏感内容，建议人工复核并改写为合规表达。',
  };
  if (jsonOut) {
    fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
    fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2) + '\n', 'utf8');
  }
  const code = enforce && status !== 'passed' ? 1 : 0;
  return { code, ...out };
}

function main() {
  const args = parseArgs(process.argv);
  const loadedText = loadText(args);
  const out = runContentSafetyPrecheck({
    inputFile: args.inputFile,
    text: loadedText,
    jsonOut: args.jsonOut,
    enforce: args.enforce,
  });
  console.log(`[content-safety-precheck] status=${out.status} findings=${out.findings.length}`);
  process.exit(out.code);
}

if (process.argv[1] && process.argv[1].endsWith('content-safety-precheck.mjs')) {
  main();
}

