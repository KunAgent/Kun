#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { detectHostCapability } from './host-capability-detect.mjs';

function parseArgs(argv) {
  const out = {
    bookRoot: null,
    skillRoot: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'),
    intent: 'auto',
    jsonOut: null,
    enforce: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') out.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--skill-root') out.skillRoot = path.resolve(argv[++i] || '');
    else if (a === '--intent') out.intent = String(argv[++i] || 'auto');
    else if (a === '--json-out') out.jsonOut = path.resolve(argv[++i] || '');
    else if (a === '--enforce') out.enforce = true;
  }
  return out;
}

function readCurrentStage(bookRoot) {
  const resume = path.join(bookRoot, '.fbs', 'workbuddy-resume.json');
  if (!fs.existsSync(resume)) return 'S0';
  try {
    const j = JSON.parse(fs.readFileSync(resume, 'utf8'));
    return String(j.currentStage || 'S0');
  } catch {
    return 'S0';
  }
}

function resolveRecommendedPlugins({ stage, intent, enabled }) {
  const light = ['find-skills', 'docx', 'pdf', 'xlsx'];
  const heavy = ['playwright-cli', 'pptx'];
  const s = String(stage || 'S0').toUpperCase();
  const i = String(intent || 'auto').toLowerCase();
  const base = s.startsWith('S4') || s.startsWith('S5') || s.startsWith('S6') ? [...light, ...heavy] : [...light];
  if (i === 'qc' || i === 'inspect') base.push('playwright-cli');
  const uniq = [...new Set(base)];
  const available = uniq.filter((x) => enabled.includes(x));
  const missing = uniq.filter((x) => !enabled.includes(x));
  return { targetSet: uniq, available, missing };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

export async function runPluginCapabilitySnapshot({
  bookRoot,
  skillRoot,
  intent = 'auto',
  jsonOut = null,
  enforce = false,
} = {}) {
  if (!bookRoot) return { code: 2, message: 'missing --book-root' };
  const root = path.resolve(bookRoot);
  const stage = readCurrentStage(root);
  const cap = await detectHostCapability({ bookRoot: root, skillRoot, force: true });
  const enabled = Array.isArray(cap?.plugins?.enabled) ? cap.plugins.enabled : [];
  const rec = resolveRecommendedPlugins({ stage, intent, enabled });
  const budget = {
    maxPrimaryOptions: 3,
    maxPrimaryCapabilities: 3,
    hideNonWritingFromPrimary: true,
  };
  const payload = {
    generatedAt: new Date().toISOString(),
    bookRoot: root,
    intent,
    currentStage: stage,
    hostType: cap?.hostType || null,
    routingMode: cap?.routingMode || null,
    pluginsEnabled: enabled,
    pluginRouting: rec,
    capabilityBudget: budget,
    status: 'passed',
  };
  const outPath = path.resolve(jsonOut || path.join(root, '.fbs', 'governance', 'plugin-capability-snapshot.json'));
  writeJson(outPath, payload);
  const shouldFail = enforce && rec.available.length === 0;
  return {
    code: shouldFail ? 1 : 0,
    reportPath: outPath,
    ...payload,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const out = await runPluginCapabilitySnapshot(args);
  console.log(`[plugin-capability-snapshot] stage=${out.currentStage} enabled=${(out.pluginsEnabled || []).length}`);
  console.log(`[plugin-capability-snapshot] report=${out.reportPath}`);
  process.exit(out.code);
}

if (process.argv[1] && process.argv[1].endsWith('plugin-capability-snapshot.mjs')) {
  main().catch((e) => {
    console.error(`[plugin-capability-snapshot] ${e.message}`);
    process.exit(1);
  });
}

