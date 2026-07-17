#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runIntakeRouter } from './intake-router.mjs';

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = {
    skillRoot: SCRIPT_ROOT,
    bookRoot: process.cwd(),
    mode: 'runtime',
    enforce: false,
    minReasonCoverage: 90,
    jsonOut: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skill-root') out.skillRoot = path.resolve(argv[++i] || out.skillRoot);
    else if (a === '--book-root') out.bookRoot = path.resolve(argv[++i] || out.bookRoot);
    else if (a === '--mode') out.mode = String(argv[++i] || out.mode).toLowerCase();
    else if (a === '--enforce') out.enforce = true;
    else if (a === '--min-reason-coverage') out.minReasonCoverage = Number(argv[++i] || out.minReasonCoverage);
    else if (a === '--json-out') out.jsonOut = path.resolve(argv[++i] || '');
  }
  return out;
}

function hasNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function checkNarrationShape(narration) {
  return !!(
    narration &&
    hasNonEmptyString(narration.beforeAction) &&
    hasNonEmptyString(narration.inProgress) &&
    hasNonEmptyString(narration.afterSuccess) &&
    hasNonEmptyString(narration.afterFallback)
  );
}

function runStaticChecks(skillRoot) {
  const intakePath = path.join(skillRoot, 'scripts', 'intake-router.mjs');
  const hintsPath = path.join(skillRoot, 'fbs-runtime-hints.json');
  const intake = fs.readFileSync(intakePath, 'utf8');
  const hints = JSON.parse(fs.readFileSync(hintsPath, 'utf8'));
  return {
    hasNarrationFieldInIntake: intake.includes('userVisibleTechActionNarration'),
    hasGoalImpactInIntake: intake.includes('goalImpact'),
    hasActionSelectionPolicyInIntake: intake.includes('actionSelectionPolicy'),
    hasNarrationPathInHints: hasNonEmptyString(hints?.hostPresentation?.techActionNarrationJsonPath),
    hasActionPolicyPathInHints: hasNonEmptyString(hints?.hostPresentation?.actionSelectionPolicyJsonPath),
    hasGoalImpactPathInHints: hasNonEmptyString(hints?.hostPresentation?.actionGoalImpactJsonPath),
  };
}

async function runRuntimeChecks(bookRoot) {
  const intents = ['new-session', 'resume', 'edit', 'rewrite', 'qc', 'inspect', 'exit'];
  let nonWritingTotal = 0;
  let nonWritingWithReason = 0;
  let narrationCompleteCount = 0;
  let policyAlignedCount = 0;

  for (const intent of intents) {
    const result = await runIntakeRouter({ bookRoot, intent, fast: true });
    const actions = Array.isArray(result?.actions) ? result.actions : [];
    const first = result?.firstResponseContext || {};
    if (checkNarrationShape(first.userVisibleTechActionNarration)) {
      narrationCompleteCount += 1;
    }
    if (
      first?.actionSelectionPolicy?.primaryUserGoal === 'writing' &&
      first?.actionSelectionPolicy?.hideNonWritingFromPrimary === true
    ) {
      policyAlignedCount += 1;
    }
    for (const action of actions) {
      if (action?.goalImpact !== 'writing') {
        nonWritingTotal += 1;
        if (hasNonEmptyString(action.reason) || hasNonEmptyString(action.action)) {
          nonWritingWithReason += 1;
        }
      }
    }
  }

  const reasonCoverage = nonWritingTotal === 0 ? 100 : Number(((nonWritingWithReason / nonWritingTotal) * 100).toFixed(2));
  return {
    intentsChecked: intents.length,
    nonWritingActionCount: nonWritingTotal,
    nonWritingReasonCoverage: reasonCoverage,
    narrationCompleteRate: Number(((narrationCompleteCount / intents.length) * 100).toFixed(2)),
    actionSelectionPolicyAlignedRate: Number(((policyAlignedCount / intents.length) * 100).toFixed(2)),
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

export async function runVisibleTechActionKpi({
  skillRoot = SCRIPT_ROOT,
  bookRoot = process.cwd(),
  mode = 'runtime',
  enforce = false,
  minReasonCoverage = 90,
  jsonOut = null,
} = {}) {
  const normalizedMode = mode === 'static' ? 'static' : 'runtime';
  const reportPath = path.resolve(
    jsonOut || path.join(bookRoot, '.fbs', 'governance', 'visible-tech-action-kpi.json'),
  );
  const staticChecks = runStaticChecks(skillRoot);
  const staticPassed = Object.values(staticChecks).every(Boolean);
  const runtimeChecks = normalizedMode === 'runtime' ? await runRuntimeChecks(bookRoot) : null;
  const runtimePassed =
    normalizedMode === 'static'
      ? true
      : runtimeChecks.narrationCompleteRate === 100 &&
        runtimeChecks.actionSelectionPolicyAlignedRate === 100 &&
        runtimeChecks.nonWritingReasonCoverage >= Number(minReasonCoverage || 90);

  const status = staticPassed && runtimePassed ? 'passed' : 'failed';
  const payload = {
    generatedAt: new Date().toISOString(),
    mode: normalizedMode,
    skillRoot: path.resolve(skillRoot),
    bookRoot: path.resolve(bookRoot),
    status,
    thresholds: {
      minReasonCoverage: Number(minReasonCoverage || 90),
    },
    staticChecks,
    runtimeChecks,
  };
  writeJson(reportPath, payload);
  const code = enforce && status !== 'passed' ? 1 : 0;
  return { code, reportPath, ...payload };
}

async function main() {
  const args = parseArgs(process.argv);
  const out = await runVisibleTechActionKpi(args);
  console.log(`[visible-tech-kpi] mode=${out.mode} status=${out.status}`);
  console.log(`[visible-tech-kpi] report=${out.reportPath}`);
  process.exit(out.code);
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith('visible-tech-action-kpi.mjs')) {
  main().catch((e) => {
    console.error(`[visible-tech-kpi] failed: ${e?.message || e}`);
    process.exit(1);
  });
}

