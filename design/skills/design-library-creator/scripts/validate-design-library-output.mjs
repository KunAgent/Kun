#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { validateDesignLibraryOutput } from './check-design-library-phase.mjs';

function exists(filePath) {
  return fs.existsSync(filePath);
}

function parseArgs(argv) {
  const args = {
    outputDir: undefined,
    maxMs: undefined,
    tokenInput: undefined,
    requireUiKitPlan: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--max-ms') {
      args.maxMs = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--token-input') {
      args.tokenInput = argv[index + 1];
      index += 1;
    } else if (arg === '--require-uikit-plan') {
      args.requireUiKitPlan = true;
    } else if (arg === '--json') {
      // JSON output is the default; keep the flag for explicit callers.
    } else if (!arg.startsWith('--') && !args.outputDir) {
      args.outputDir = arg;
    }
  }

  return args;
}

const { outputDir, maxMs, tokenInput, requireUiKitPlan } = parseArgs(process.argv.slice(2));

if (!outputDir) {
  console.error('Usage: validate-design-library-output.mjs <output_dir> [--max-ms N] [--token-input design-tokens.json] [--require-uikit-plan] [--json]');
  process.exit(2);
}

const rootDir = path.resolve(outputDir);
if (!exists(rootDir) || !fs.statSync(rootDir).isDirectory()) {
  console.error(`Output directory does not exist: ${rootDir}`);
  process.exit(2);
}

// Auto-enable uikit-plan validation when the plan file exists in the output dir,
// so the final (phase=all) validation never silently skips the component allowlist check.
// Auto-enabled mode is ADVISORY: uikit-plan gate findings are downgraded to warnings
// (legacy outputs without data-component markers must not start failing the final gate).
// Explicit --require-uikit-plan keeps them as hard failures.
const autoEnabled = !requireUiKitPlan && exists(path.join(rootDir, 'uikit-plan.json'));

const summary = validateDesignLibraryOutput(rootDir, {
  phase: 'all',
  tokenInput,
  requireUiKitPlan: requireUiKitPlan || autoEnabled,
});

if (autoEnabled) {
  const planFailures = summary.failures.filter((failure) => failure.gate === 'uikit-plan');
  if (planFailures.length > 0) {
    summary.failures = summary.failures.filter((failure) => failure.gate !== 'uikit-plan');
    summary.warnings.push(
      ...planFailures.map((failure) => ({ ...failure, reason: `${failure.reason} (advisory: auto-enabled uikit-plan check; pass --require-uikit-plan to enforce)` })),
    );
    summary.ok =
      summary.failures.length === 0 &&
      summary.jsonFailures.length === 0 &&
      summary.undefinedCssVars.length === 0 &&
      summary.localCssVarDeclarations.length === 0 &&
      summary.previewLinkFailures.length === 0 &&
      summary.localImageRefFailures.length === 0 &&
      summary.uiKitFailures.length === 0 &&
      summary.componentSlugMismatches.length === 0;
  }
}
if (Number.isFinite(maxMs) && summary.elapsedMs > maxMs) {
  summary.warnings.push({
    file: '.',
    reason: `validator exceeded max-ms: ${summary.elapsedMs} > ${maxMs}`,
  });
}
console.log(JSON.stringify(summary, undefined, 2));
process.exit(summary.ok ? 0 : 1);
