#!/usr/bin/env node
/**
 * validate-intent.mjs
 * Advisory check: validates component intent JSON files after Phase 3 synthesis.
 *
 * Usage:
 *   node validate-intent.mjs --intent-dir <path> --vars-file <path> [--strict]
 *
 * Exit codes:
 *   0 = check completed; schema issues are reported as warnings by default
 *   1 = validation errors found only when --strict is passed
 */

import { readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { parseArgs } from 'util';
import { CSS_VAR_NAME } from './css-utils.mjs';

const { values } = parseArgs({
  options: {
    'intent-dir': { type: 'string' },
    'vars-file': { type: 'string' },
    strict: { type: 'boolean', default: false },
  },
});

const intentDir = values['intent-dir'];
const varsFile = values['vars-file'];
const strict = values.strict === true;

if (!intentDir || !varsFile) {
  console.error('Usage: node validate-intent.mjs --intent-dir <path> --vars-file <path> [--strict]');
  process.exit(2);
}

const VALID_CATEGORIES = ['Action', 'Display', 'Overlay', 'Form', 'Navigation', 'Feedback'];
const ADVISORY_SIZE_BYTES = 3072;

function extractAvailableVariableNames(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw && typeof raw === 'object' && Array.isArray(raw.cssVariables)) {
    return raw.cssVariables;
  }
  if (raw && typeof raw === 'object') {
    return Object.keys(raw);
  }
  throw new Error('vars-file has no cssVariables[] and is not an object/array');
}

// Load available variables — accepts .css (extracts custom properties) or .json (legacy)
let availableVars;
try {
  const content = readFileSync(varsFile, 'utf-8');
  if (varsFile.endsWith('.css')) {
    availableVars = new Set(
      [...content.matchAll(new RegExp(`--([${CSS_VAR_NAME}]+)\\s*:`, 'g'))].map(m => m[1])
    );
  } else {
    const raw = JSON.parse(content);
    availableVars = new Set(extractAvailableVariableNames(raw));
  }
} catch (e) {
  console.error(`Failed to read vars file: ${e.message}`);
  process.exit(2);
}

// Find all intent JSON files (exclude index.json and _evidence/)
const files = readdirSync(intentDir)
  .filter(f => f.endsWith('.json') && f !== 'index.json' && !f.startsWith('_'));

const results = { valid: [], invalid: [], warnings: [] };
const parsedIntents = new Map();

for (const file of files) {
  const filePath = join(intentDir, file);
  const errors = [];

  let intent;
  try {
    const content = readFileSync(filePath, 'utf-8');

    const sizeBytes = Buffer.byteLength(content, 'utf-8');
    if (sizeBytes > ADVISORY_SIZE_BYTES) {
      results.warnings.push({
        file,
        warning: `large intent JSON (${sizeBytes}B > ${ADVISORY_SIZE_BYTES}B advisory); kept because structure is valid`,
      });
    }

    intent = JSON.parse(content);
    parsedIntents.set(file, intent);
  } catch (e) {
    errors.push(`parse error: ${e.message}`);
    results.invalid.push({ file, errors });
    continue;
  }

  // Required fields (v6 evidence-based schema)
  const required = ['slug', 'name', 'category', 'summary', 'controlMatrix', 'geometry', 'patterns', 'contentPolicy'];
  for (const field of required) {
    if (intent[field] === undefined || intent[field] === null) {
      errors.push(`missing required field: ${field}`);
    }
  }

  // Category enum
  if (intent.category && !VALID_CATEGORIES.includes(intent.category)) {
    errors.push(`invalid category "${intent.category}" — must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }

  // controlMatrix checks
  if (intent.controlMatrix && typeof intent.controlMatrix === 'object') {
    if (!intent.controlMatrix.dimensions || !Array.isArray(intent.controlMatrix.dimensions) || intent.controlMatrix.dimensions.length < 1) {
      errors.push('controlMatrix.dimensions must be a non-empty array');
    }
  }

  // geometry checks
  if (intent.geometry && typeof intent.geometry === 'object') {
    if (!intent.geometry.sizing) {
      errors.push('geometry.sizing is required');
    }
  }

  // patterns checks
  if (intent.patterns && typeof intent.patterns === 'object') {
    // componentAnatomy is recommended but not strictly required
    // listModel is optional
  }

  // contentPolicy checks
  if (intent.contentPolicy && typeof intent.contentPolicy === 'object') {
    if (!intent.contentPolicy.uiCopySamples || !Array.isArray(intent.contentPolicy.uiCopySamples)) {
      errors.push('contentPolicy.uiCopySamples must be an array');
    }
  }

  // renderObligations advisory check (advisory → warning, not error)
  if (intent.renderObligations && Array.isArray(intent.renderObligations) && intent.renderObligations.length < 1) {
    results.warnings.push({ file, warning: 'renderObligations should contain at least 1 obligation' });
  }

  // iconSlots advisory check
  if (intent.iconSlots && Array.isArray(intent.iconSlots)) {
    for (let i = 0; i < intent.iconSlots.length; i++) {
      const slot = intent.iconSlots[i];
      if (!slot.name || !slot.role) {
        errors.push(`iconSlots[${i}] missing name/role`);
        break;
      }
    }
  }

  if (errors.length === 0) {
    results.valid.push(file);
  } else {
    results.invalid.push({ file, errors });
  }
}

// Advisory: check componentRef cross-references in componentAnatomy / listModel
const availableSlugs = new Set(files.map(f => basename(f, '.json')));
for (const file of files) {
  const intent = parsedIntents.get(file);
  if (!intent) continue;

  const refs = [];
  // Collect componentRef from componentAnatomy slots (recursive)
  function collectRefs(node) {
    if (!node) return;
    if (node.componentRef) refs.push(node.componentRef);
    if (Array.isArray(node.children)) node.children.forEach(collectRefs);
  }
  const anatomy = intent.patterns?.componentAnatomy ?? intent.componentAnatomy;
  if (anatomy?.scenarios) {
    for (const sc of anatomy.scenarios) collectRefs(sc.root);
  }
  // Collect from listModel itemSlots structure
  const listModel = intent.patterns?.listModel ?? intent.listModel;
  if (listModel?.itemSlots) {
    for (const slot of listModel.itemSlots) {
      if (slot.structure?.componentRef) refs.push(slot.structure.componentRef);
    }
  }
  // Collect from tableModel columns
  const tableModel = intent.patterns?.tableModel ?? intent.tableModel;
  if (tableModel?.columns) {
    for (const col of tableModel.columns) {
      if (col.componentRef) refs.push(col.componentRef);
      if (col.cellRenderer?.componentRef) refs.push(col.cellRenderer.componentRef);
    }
  }
  // Collect from segmentedGroups
  const segGroups = intent.patterns?.segmentedGroups ?? intent.segmentedGroups;
  if (Array.isArray(segGroups)) {
    for (const group of segGroups) {
      if (group.componentRef) refs.push(group.componentRef);
      if (Array.isArray(group.segments)) {
        for (const seg of group.segments) {
          if (seg.componentRef) refs.push(seg.componentRef);
        }
      }
    }
  }

  for (const ref of refs) {
    if (ref.slug && !availableSlugs.has(ref.slug)) {
      results.warnings.push({
        file,
        warning: `componentRef references unknown slug "${ref.slug}" — no matching intent JSON found`,
      });
    }
  }
}

// Output
const summary = {
  mode: strict ? 'strict' : 'advisory',
  total: files.length,
  valid: results.valid.length,
  invalid: results.invalid.length,
  failures: results.invalid,
  warnings: results.warnings,
};

console.log(JSON.stringify(summary, null, 2));
process.exit(strict && results.invalid.length > 0 ? 1 : 0);
