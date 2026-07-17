#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { runRuntimeNudge } from './runtime-nudge.mjs';
import { runMidtermPerformanceDashboard } from './midterm-performance-dashboard.mjs';
import { runMidtermGovernanceReport } from './midterm-governance-report.mjs';
import { runBuildSearchKnowledgeCards } from './build-search-knowledge-cards.mjs';
import { runHighRiskDualSourceGate } from './high-risk-dual-source-gate.mjs';
import { runTemporalAnchorMissingChecklist } from './temporal-anchor-missing-checklist.mjs';
import { handleSessionExit } from './session-exit.mjs';
import { appendTraceEvent } from './lib/fbs-trace-logger.mjs';
import { governanceArtifactPath } from './lib/governance-artifacts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILL_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const o = {
    bookRoot: null,
    skillRoot: DEFAULT_SKILL_ROOT,
    days: 7,
    enforce: false,
    withSessionExit: false,
    sessionNote: '',
    json: false,
    jsonOut: null,
    blockTriggerRate: 95,
    blockTemporalRate: 90,
    blockResumeRate: 90,
    blockEvidenceRate: 95,
    warnDelta: 10,
    boundaryGate: true,
    noDualSourceGate: false,
    noTemporalChecklistGate: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') o.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--skill-root') o.skillRoot = path.resolve(argv[++i] || '');
    else if (a === '--days') o.days = Math.max(1, Number(argv[++i] || 7));
    else if (a === '--enforce') o.enforce = true;
    else if (a === '--with-session-exit') o.withSessionExit = true;
    else if (a === '--session-note') o.sessionNote = String(argv[++i] || '');
    else if (a === '--json') o.json = true;
    else if (a === '--json-out') o.jsonOut = path.resolve(argv[++i] || '');
    else if (a === '--warn-delta') o.warnDelta = Math.max(1, Number(argv[++i] || 10));
    else if (a === '--block-trigger-rate') o.blockTriggerRate = Number(argv[++i] || o.blockTriggerRate);
    else if (a === '--block-temporal-rate') o.blockTemporalRate = Number(argv[++i] || o.blockTemporalRate);
    else if (a === '--block-resume-rate') o.blockResumeRate = Number(argv[++i] || o.blockResumeRate);
    else if (a === '--block-evidence-rate') o.blockEvidenceRate = Number(argv[++i] || o.blockEvidenceRate);
    else if (a === '--no-boundary-gate') o.boundaryGate = false;
    else if (a === '--no-dual-source-gate') o.noDualSourceGate = true;
    else if (a === '--no-temporal-checklist-gate') o.noTemporalChecklistGate = true;
  }
  return o;
}

function runNodeScript(scriptPath, args, cwd) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  return {
    code: typeof result.status === 'number' ? result.status : 1,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

function asNumber(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function classifyKpi(rate, blockThreshold, warnDelta) {
  if (rate >= blockThreshold) return 'pass';
  if (rate >= blockThreshold - warnDelta) return 'warn';
  return 'block';
}

function evaluateGate(dashboard, governance, dualSource, temporalChecklist, args) {
  const kpi = dashboard?.kpi || {};
  const triggerRate = asNumber(kpi?.triggerAutomationRate?.rate);
  const temporalRate = asNumber(kpi?.temporalTrustRate?.rate);
  const resumeRate = asNumber(kpi?.resumeReadinessRate?.rate);
  const evidenceRate = asNumber(kpi?.evidenceCompletenessRate?.rate);
  const driftCount = asNumber(governance?.summary?.driftCount);
  const legacyReportsUsed = Boolean(governance?.summary?.legacyReportsUsed);
  const dualSourceViolations = asNumber(dualSource?.totals?.violations);
  const temporalMissing = asNumber(temporalChecklist?.totals?.missingAnchors);

  const checks = [
    {
      id: 'triggerAutomationRate',
      rate: triggerRate,
      threshold: args.blockTriggerRate,
      level: classifyKpi(triggerRate, args.blockTriggerRate, args.warnDelta),
      label: `触发自动化率 ${triggerRate}%（阈值 ${args.blockTriggerRate}%）`,
    },
    {
      id: 'temporalTrustRate',
      rate: temporalRate,
      threshold: args.blockTemporalRate,
      level: classifyKpi(temporalRate, args.blockTemporalRate, args.warnDelta),
      label: `时态可信率 ${temporalRate}%（阈值 ${args.blockTemporalRate}%）`,
    },
    {
      id: 'resumeReadinessRate',
      rate: resumeRate,
      threshold: args.blockResumeRate,
      level: classifyKpi(resumeRate, args.blockResumeRate, args.warnDelta),
      label: `会话恢复就绪率 ${resumeRate}%（阈值 ${args.blockResumeRate}%）`,
    },
    {
      id: 'evidenceCompletenessRate',
      rate: evidenceRate,
      threshold: args.blockEvidenceRate,
      level: classifyKpi(evidenceRate, args.blockEvidenceRate, args.warnDelta),
      label: `证据完备率 ${evidenceRate}%（阈值 ${args.blockEvidenceRate}%）`,
    },
  ];

  if (args.boundaryGate) {
    let boundaryLevel = 'pass';
    if (driftCount > 0) boundaryLevel = 'block';
    else if (legacyReportsUsed) boundaryLevel = 'warn';
    checks.push({
      id: 'governanceBoundaryDrift',
      rate: driftCount,
      threshold: 0,
      level: boundaryLevel,
      label: `主体漂移项 ${driftCount}（legacy=${legacyReportsUsed ? 'yes' : 'no'}）`,
    });
  }
  if (!args.noDualSourceGate) {
    checks.push({
      id: 'highRiskDualSource',
      rate: dualSourceViolations,
      threshold: 0,
      level: dualSourceViolations > 0 ? 'block' : 'pass',
      label: `高风险双源缺口 ${dualSourceViolations}`,
    });
  }
  if (!args.noTemporalChecklistGate) {
    checks.push({
      id: 'temporalAnchorChecklist',
      rate: temporalMissing,
      threshold: 0,
      level: temporalMissing > 0 ? 'warn' : 'pass',
      label: `时间锚缺失项 ${temporalMissing}`,
    });
  }

  let status = 'pass';
  if (checks.some((x) => x.level === 'block')) status = 'block';
  else if (checks.some((x) => x.level === 'warn')) status = 'warn';
  return { status, checks };
}

export async function runMidtermExecutionChain(raw = parseArgs(process.argv)) {
  const defaults = {
    bookRoot: null,
    skillRoot: DEFAULT_SKILL_ROOT,
    days: 7,
    enforce: false,
    withSessionExit: false,
    sessionNote: '',
    json: false,
    jsonOut: null,
    blockTriggerRate: 95,
    blockTemporalRate: 90,
    blockResumeRate: 90,
    blockEvidenceRate: 95,
    warnDelta: 10,
    boundaryGate: true,
  };
  const args = {
    ...defaults,
    ...raw,
    bookRoot: raw.bookRoot ? path.resolve(raw.bookRoot) : null,
    skillRoot: path.resolve(raw.skillRoot || defaults.skillRoot),
  };
  if (!args.bookRoot) {
    throw new Error('用法: node scripts/midterm-execution-chain.mjs --book-root <本书根> [--skill-root <技能根>] [--days 7] [--enforce] [--no-boundary-gate] [--no-dual-source-gate] [--no-temporal-checklist-gate]');
  }
  fs.mkdirSync(path.join(args.bookRoot, '.fbs', 'reports'), { recursive: true });

  const steps = [];

  const nudge = runRuntimeNudge({ bookRoot: args.bookRoot });
  steps.push({
    id: 'runtime-nudge',
    ok: nudge?.code === 0,
    outputPath: nudge?.outputPath || null,
    detail: `required=${nudge?.totals?.required || 0}, all=${nudge?.totals?.all || 0}`,
  });

  const healthScript = path.join(args.skillRoot, 'scripts', 'book-health-snapshot.mjs');
  const health = runNodeScript(
    healthScript,
    ['--book-root', args.bookRoot, '--skill-root', args.skillRoot, '--skip-expansion-gate'],
    args.skillRoot
  );
  const healthJsonPath = path.join(args.bookRoot, '.fbs', 'book-health-snapshot.json');
  const healthJson = fs.existsSync(healthJsonPath) ? JSON.parse(fs.readFileSync(healthJsonPath, 'utf8')) : null;
  steps.push({
    id: 'book-health-snapshot',
    ok: health.code === 0,
    outputPath: healthJsonPath,
    detail: healthJson?.status ? `status=${healthJson.status}` : 'snapshot generated',
  });

  const knowledgeCards = runBuildSearchKnowledgeCards({ bookRoot: args.bookRoot });
  steps.push({
    id: 'build-search-knowledge-cards',
    ok: knowledgeCards?.code === 0,
    outputPath: knowledgeCards?.jsonPath || null,
    detail: `cards=${knowledgeCards?.totals?.all || 0}`,
  });

  const dualSource = runHighRiskDualSourceGate({ bookRoot: args.bookRoot, enforce: false });
  steps.push({
    id: 'high-risk-dual-source-gate',
    ok: dualSource?.code === 0,
    outputPath: dualSource?.jsonPath || null,
    detail: `violations=${dualSource?.totals?.violations || 0}`,
  });

  const temporalChecklist = runTemporalAnchorMissingChecklist({ bookRoot: args.bookRoot, enforce: false });
  steps.push({
    id: 'temporal-anchor-missing-checklist',
    ok: temporalChecklist?.code === 0,
    outputPath: temporalChecklist?.jsonPath || null,
    detail: `missing=${temporalChecklist?.totals?.missingAnchors || 0}`,
  });

  const dashboard = runMidtermPerformanceDashboard({
    bookRoot: args.bookRoot,
    days: args.days,
  });
  steps.push({
    id: 'midterm-dashboard',
    ok: dashboard?.code === 0,
    outputPath: dashboard?.jsonPath || null,
    detail: `trigger=${dashboard?.kpi?.triggerAutomationRate?.rate || 0} temporal=${dashboard?.kpi?.temporalTrustRate?.rate || 0}`,
  });

  let sessionExit = null;
  if (args.withSessionExit) {
    sessionExit = await handleSessionExit({
      bookRoot: args.bookRoot,
      note: args.sessionNote || 'midterm-execution-chain auto session-exit',
      quiet: true,
      mirrorWorkbuddyMemory: true,
    });
    steps.push({
      id: 'session-exit',
      ok: Boolean(sessionExit?.saved),
      outputPath: sessionExit?.files?.resumeCard || null,
      detail: 'session-exit completed',
    });
  }

  const preGate = evaluateGate(dashboard, null, dualSource, temporalChecklist, args);
  const governancePre = runMidtermGovernanceReport({
    bookRoot: args.bookRoot,
    weekLabel: dashboard?.weekLabel || null,
    executionChainPayload: {
      status: preGate.status,
    },
  });
  const gate = evaluateGate(dashboard, governancePre, dualSource, temporalChecklist, args);
  const governance = runMidtermGovernanceReport({
    bookRoot: args.bookRoot,
    weekLabel: dashboard?.weekLabel || null,
    executionChainPayload: {
      status: gate.status,
    },
  });
  steps.push({
    id: 'midterm-governance-report',
    ok: governance?.code === 0,
    outputPath: governance?.jsonPath || null,
    detail: `status=${governance?.status || 'unknown'}`,
  });

  const result = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    bookRoot: args.bookRoot,
    skillRoot: args.skillRoot,
    enforce: args.enforce,
    status: gate.status,
    steps,
    gate,
    artifacts: {
      dashboardJson: dashboard?.jsonPath || null,
      dashboardMd: dashboard?.mdPath || null,
      governanceJson: governance?.jsonPath || null,
      governanceMd: governance?.mdPath || null,
      healthSnapshot: healthJsonPath,
      runtimeNudges: path.join(args.bookRoot, '.fbs', 'runtime-nudges.json'),
    },
  };

  const outPath =
    args.jsonOut ||
    governanceArtifactPath(args.bookRoot, `midterm-execution-chain-${String(new Date().toISOString().slice(0, 10))}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  result.outputPath = outPath;

  appendTraceEvent({
    bookRoot: args.bookRoot,
    skillRoot: args.skillRoot,
    script: 'midterm-execution-chain.mjs',
    event: 'midterm_execution_chain',
    exitCode: args.enforce && gate.status === 'block' ? 1 : 0,
    payloadSummary: {
      status: gate.status,
      enforce: args.enforce,
      triggerAutomationRate: dashboard?.kpi?.triggerAutomationRate?.rate || 0,
      temporalTrustRate: dashboard?.kpi?.temporalTrustRate?.rate || 0,
      resumeReadinessRate: dashboard?.kpi?.resumeReadinessRate?.rate || 0,
      evidenceCompletenessRate: dashboard?.kpi?.evidenceCompletenessRate?.rate || 0,
    },
  });

  return result;
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    const out = await runMidtermExecutionChain(args);
    if (args.json) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(`[midterm-execution-chain] status=${out.status}`);
      for (const step of out.steps) {
        console.log(`- ${step.id}: ${step.ok ? 'ok' : 'fail'}${step.detail ? ` (${step.detail})` : ''}`);
      }
      console.log(`[midterm-execution-chain] report=${out.outputPath}`);
      if (out.gate.status !== 'pass') {
        for (const c of out.gate.checks.filter((x) => x.level !== 'pass')) {
          console.log(`  - [${c.level}] ${c.label}`);
        }
      }
    }
    if (args.enforce && out.status === 'block') process.exit(1);
    process.exit(0);
  } catch (err) {
    console.error(`[midterm-execution-chain] 失败: ${err.message}`);
    process.exit(2);
  }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

