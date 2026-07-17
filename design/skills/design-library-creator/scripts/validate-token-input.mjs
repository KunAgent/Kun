#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { readDataFile, resolveDataPath } from './jsonl-utils.mjs';

const MAX_TOKEN_BYTES = 65536;
const OLD_SCHEMA_FIELDS = ['brandSignals', 'unresolvedReferences', 'rawSpecAnnotations'];

function parseArgs(argv) {
  const args = {
    tokenPath: undefined,
    legacyCssPath: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--legacy-css') {
      args.legacyCssPath = argv[index + 1];
      index += 1;
    } else if (arg === '--json') {
      // JSON output is the only output mode; keep flag for explicit callers.
    } else if (!arg.startsWith('--') && !args.tokenPath) {
      args.tokenPath = arg;
    }
  }

  return args;
}

function legacyExists(legacyCssPath) {
  return Boolean(legacyCssPath && fs.existsSync(legacyCssPath) && fs.statSync(legacyCssPath).isFile());
}

function fail(summary, reason, legacyCssPath) {
  summary.errors.push(reason);
  if (legacyExists(legacyCssPath)) {
    summary.ok = true;
    summary.mode = 'bundle';
    summary.fallbackReason = reason;
  } else {
    summary.ok = false;
    summary.mode = 'fail';
  }
  return summary;
}

function hasOldVariablesValues(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => hasOldVariablesValues(entry));
  if (Array.isArray(value.variables)) {
    return value.variables.some((variable) => variable && typeof variable === 'object' && 'values' in variable);
  }
  return Object.values(value).some((entry) => hasOldVariablesValues(entry));
}

const { tokenPath, legacyCssPath } = parseArgs(process.argv.slice(2));
const summary = {
  ok: false,
  mode: 'fail',
  status: 'unknown',
  size: 0,
  errors: [],
  warnings: [],
};

if (!tokenPath) {
  summary.errors.push('Usage: validate-token-input.mjs <design-tokens.json> [--legacy-css <colors_and_type.css>] [--json]');
  console.log(JSON.stringify(summary, undefined, 2));
  process.exit(2);
}

const absoluteTokenPath = resolveDataPath(path.resolve(tokenPath));
if (!fs.existsSync(absoluteTokenPath)) {
  console.log(JSON.stringify(fail(summary, `design-tokens file missing: ${absoluteTokenPath}`, legacyCssPath), undefined, 2));
  process.exit(summary.ok ? 0 : 1);
}

const raw = fs.readFileSync(absoluteTokenPath, 'utf8');
summary.size = Buffer.byteLength(raw);
// Size check: warn but do not block — sub-agent handles large files via chunked reads
// (warning is appended after quality extraction below to avoid being overwritten)

let tokens;
try {
  tokens = readDataFile(absoluteTokenPath);
} catch (error) {
  console.log(JSON.stringify(fail(summary, `design-tokens file parse failed: ${error.message}`, legacyCssPath), undefined, 2));
  process.exit(summary.ok ? 0 : 1);
}

const oldField = OLD_SCHEMA_FIELDS.find((field) => field in tokens);
if (oldField) {
  console.log(JSON.stringify(fail(summary, `old schema field present: ${oldField}`, legacyCssPath), undefined, 2));
  process.exit(summary.ok ? 0 : 1);
}

if (hasOldVariablesValues(tokens)) {
  console.log(JSON.stringify(fail(summary, 'old schema variables[].values present', legacyCssPath), undefined, 2));
  process.exit(summary.ok ? 0 : 1);
}

const quality = tokens.themeSignals?.quality;
summary.status = quality?.status || 'unknown';
summary.errors = Array.isArray(quality?.errors) ? quality.errors.map((issue) => issue.message || issue.code || String(issue)) : [];
summary.warnings = Array.isArray(quality?.warnings) ? quality.warnings.map((issue) => issue.message || issue.code || String(issue)) : [];

if (quality?.status === 'fail') {
  summary.warnings.push('themeSignals.quality.status is fail; continuing in degraded token mode');
}

if (summary.size >= MAX_TOKEN_BYTES) {
  summary.warnings.push(
    `design-tokens file is ${summary.size} bytes (> ${MAX_TOKEN_BYTES}); token sub-agent should use offset/limit chunked reads`
  );
  summary.chunked = true;
}

summary.ok = true;
summary.mode = 'llm';
console.log(JSON.stringify(summary, undefined, 2));
