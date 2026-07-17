#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_TOP_LEVEL_FIELDS = [
  'corePreviewComponents',
  'supportEvidenceComponents',
  'allowedComponents',
  'screenBlueprints',
  'forbiddenInventedComponents',
  'lowConfidence',
  'warnings',
];

const FORBIDDEN_TOP_LEVEL_FIELDS = [
  'strategy',
  'families',
  'decisions',
  'coverageSummary',
  'plan',
  'selectedComponents',
  'componentsOnly',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function normalizeComponentEntry(entry, index, failures, fieldName) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    failures.push(`${fieldName}[${index}] must be an object`);
    return undefined;
  }

  const slug = typeof entry.slug === 'string' ? entry.slug.trim() : '';
  if (!slug) {
    failures.push(`${fieldName}[${index}].slug is required`);
    return undefined;
  }

  const evidenceFile = typeof entry.evidenceFile === 'string'
    ? entry.evidenceFile
    : typeof entry.evidence === 'string'
      ? entry.evidence
      : `components/_evidence/${slug}.json`;

  const reason = typeof entry.reason === 'string'
    ? entry.reason
    : typeof entry.basis === 'string'
      ? entry.basis
      : typeof entry.role === 'string'
        ? entry.role
        : '';
  if (!reason) {
    failures.push(`${fieldName}[${index}].reason is required`);
  }

  const normalized = { slug, reason, evidenceFile };
  if (Number.isFinite(entry.priority)) {
    normalized.priority = entry.priority;
  }
  if (typeof entry.slot === 'string' && entry.slot) {
    normalized.slot = entry.slot;
  }
  return normalized;
}

function normalizeScreenBlueprint(entry, index, failures) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    failures.push(`screenBlueprints[${index}] must be an object`);
    return undefined;
  }

  const name = typeof entry.name === 'string'
    ? entry.name
    : typeof entry.slug === 'string'
      ? entry.slug
      : null;
  const purpose = typeof entry.purpose === 'string' ? entry.purpose : '';
  const role = typeof entry.role === 'string' ? entry.role : '';
  const componentSlugs = Array.isArray(entry.componentSlugs)
    ? entry.componentSlugs
    : Array.isArray(entry.components)
      ? entry.components
      : [];
  const layoutIntent = typeof entry.layoutIntent === 'string' ? entry.layoutIntent : purpose;

  // componentSlugs is optional — LLM assigns components to screens at runtime
  // using the allowedComponents whitelist. Generator intentionally leaves this empty.

  const normalized = {
    name,
    componentSlugs: unique(componentSlugs.map((slug) => typeof slug === 'string' ? slug.trim() : '')),
  };
  if (purpose) normalized.purpose = purpose;
  if (layoutIntent && layoutIntent !== purpose) normalized.layoutIntent = layoutIntent;
  if (role) normalized.role = role;
  if (typeof entry.primaryAction === 'string' && entry.primaryAction) normalized.primaryAction = entry.primaryAction;
  return normalized;
}

function loadEvidenceSlugs(evidenceIndexPath, failures) {
  if (!evidenceIndexPath) {
    return undefined;
  }
  if (!fs.existsSync(evidenceIndexPath)) {
    failures.push(`evidence index missing: ${evidenceIndexPath}`);
    return undefined;
  }

  try {
    const evidenceIndex = readJson(evidenceIndexPath);
    return new Set(
      (Array.isArray(evidenceIndex.components) ? evidenceIndex.components : [])
        .map((component) => component?.slug)
        .filter(Boolean),
    );
  } catch (error) {
    failures.push(`failed to parse evidence index: ${error.message}`);
    return undefined;
  }
}

function loadComponentContractSlugs(componentIndexPath, componentsDirPath, failures) {
  if (!componentIndexPath && !componentsDirPath) {
    return undefined;
  }
  if (!componentIndexPath) {
    failures.push('--component-index is required when --components-dir is provided');
    return undefined;
  }
  if (!componentsDirPath) {
    failures.push('--components-dir is required when --component-index is provided');
    return undefined;
  }
  if (!fs.existsSync(componentIndexPath)) {
    failures.push(`component index missing: ${componentIndexPath}`);
    return undefined;
  }

  try {
    const componentIndex = readJson(componentIndexPath);
    const entries = Array.isArray(componentIndex?.components)
      ? componentIndex.components
      : Array.isArray(componentIndex)
        ? componentIndex
        : [];
    const slugs = entries
      .map((component) => typeof component?.slug === 'string' ? component.slug.trim() : '')
      .filter(Boolean);
    const existing = new Set();
    for (const slug of slugs) {
      const componentPath = path.join(componentsDirPath, `${slug}.json`);
      if (!fs.existsSync(componentPath)) {
        failures.push(`component contract missing: ${componentPath}`);
      } else {
        existing.add(slug);
      }
    }
    return existing;
  } catch (error) {
    failures.push(`failed to parse component index: ${error.message}`);
    return undefined;
  }
}

export function normalizeUiKitPlan(plan, options = {}) {
  const failures = [];
  const warnings = [];

  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { ok: false, failures: ['uikit plan must be a JSON object'], warnings };
  }

  for (const field of FORBIDDEN_TOP_LEVEL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(plan, field)) {
      failures.push(`forbidden top-level field "${field}" indicates planner intermediate schema`);
    }
  }

  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(plan, field)) {
      failures.push(`missing top-level field "${field}"`);
    }
  }

  const corePreviewComponents = (Array.isArray(plan.corePreviewComponents) ? plan.corePreviewComponents : [])
    .map((entry, index) => normalizeComponentEntry(entry, index, failures, 'corePreviewComponents'))
    .filter(Boolean);
  const supportEvidenceComponents = (Array.isArray(plan.supportEvidenceComponents) ? plan.supportEvidenceComponents : [])
    .map((entry, index) => normalizeComponentEntry(entry, index, failures, 'supportEvidenceComponents'))
    .filter(Boolean);
  const screenBlueprints = (Array.isArray(plan.screenBlueprints) ? plan.screenBlueprints : [])
    .map((entry, index) => normalizeScreenBlueprint(entry, index, failures))
    .filter(Boolean);

  if (corePreviewComponents.length === 0) {
    failures.push('corePreviewComponents must not be empty');
  }
  // No upper-bound validation — count is controlled by generate-uikit-plan.mjs LIMITS config.

  const computedAllowed = unique([
    ...corePreviewComponents.map((entry) => entry.slug),
    ...supportEvidenceComponents.map((entry) => entry.slug),
    ...screenBlueprints.flatMap((entry) => entry.componentSlugs),
  ]);
  const allowedComponents = unique(Array.isArray(plan.allowedComponents)
    ? plan.allowedComponents.map((slug) => typeof slug === 'string' ? slug.trim() : '')
    : []);

  if (allowedComponents.length === 0) {
    failures.push('allowedComponents must not be empty');
  }

  const missingFromAllowed = computedAllowed.filter((slug) => !allowedComponents.includes(slug));
  const extraAllowed = allowedComponents.filter((slug) => !computedAllowed.includes(slug));
  if (missingFromAllowed.length > 0 || extraAllowed.length > 0) {
    failures.push(
      `allowedComponents must equal selected component union; missing=[${missingFromAllowed.join(', ')}], extra=[${extraAllowed.join(', ')}]`,
    );
  }

  const evidenceSlugs = loadEvidenceSlugs(options.evidenceIndexPath, failures);
  if (evidenceSlugs) {
    const unknownAllowed = allowedComponents.filter((slug) => !evidenceSlugs.has(slug));
    if (unknownAllowed.length > 0) {
      failures.push(`allowedComponents not found in evidence index: ${unknownAllowed.join(', ')}`);
    }
  }
  const componentSlugs = loadComponentContractSlugs(options.componentIndexPath, options.componentsDirPath, failures);
  if (componentSlugs) {
    const unknownAllowed = allowedComponents.filter((slug) => !componentSlugs.has(slug));
    if (unknownAllowed.length > 0) {
      failures.push(`allowedComponents not found in component index: ${unknownAllowed.join(', ')}`);
    }
  }

  const forbiddenInventedComponents = Array.isArray(plan.forbiddenInventedComponents)
    ? unique(plan.forbiddenInventedComponents.map((slug) => typeof slug === 'string' ? slug.trim() : ''))
    : [];
  const normalizedWarnings = Array.isArray(plan.warnings)
    ? plan.warnings.filter((item) => typeof item === 'string')
    : [];

  const headBoilerplate = typeof plan.headBoilerplate === 'string'
    ? plan.headBoilerplate
    : '<link rel="stylesheet" href="../../colors_and_type.css">';
  if (typeof plan.headBoilerplate !== 'string') {
    warnings.push('defaulted-headBoilerplate');
  } else if (!plan.headBoilerplate.includes('colors_and_type.css')) {
    failures.push('uikit-plan missing or invalid headBoilerplate field');
  }

  if (typeof plan.lowConfidence !== 'boolean') {
    failures.push('lowConfidence must be a boolean');
  }

  // 透传已知附加字段（layout/selectionPolicy/slotAssignments 等），
  // 这些字段被 phase-4 模板（sidebarColumnWidth/fixed-slots 诊断）和场景化链路消费，剥离会使下游契约失效
  const passthrough = {};
  if (plan.layout && typeof plan.layout === 'object' && !Array.isArray(plan.layout)) {
    passthrough.layout = plan.layout;
  }
  if (typeof plan.selectionPolicy === 'string' && plan.selectionPolicy) {
    passthrough.selectionPolicy = plan.selectionPolicy;
  }
  if (Array.isArray(plan.slotAssignments)) {
    passthrough.slotAssignments = plan.slotAssignments;
  }
  if (Array.isArray(plan.missingFixedSlots)) {
    passthrough.missingFixedSlots = plan.missingFixedSlots;
  }
  if (Array.isArray(plan.fallbackComponents)) {
    passthrough.fallbackComponents = plan.fallbackComponents;
  }
  if (typeof plan.needsNarrative === 'boolean') {
    passthrough.needsNarrative = plan.needsNarrative;
  }
  if (plan.productNarrative && typeof plan.productNarrative === 'object' && !Array.isArray(plan.productNarrative)) {
    passthrough.productNarrative = plan.productNarrative;
  }

  const normalized = {
    schemaVersion: Number.isFinite(plan.schemaVersion) ? plan.schemaVersion : 1,
    headBoilerplate,
    corePreviewComponents,
    supportEvidenceComponents,
    allowedComponents,
    screenBlueprints,
    ...(plan.productContext && typeof plan.productContext === 'object' && !Array.isArray(plan.productContext)
      ? { productContext: plan.productContext }
      : {}),
    ...passthrough,
    forbiddenInventedComponents,
    lowConfidence: Boolean(plan.lowConfidence),
    warnings: normalizedWarnings,
  };

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    plan: normalized,
  };
}

export function validateUiKitPlanFile(planPath, options = {}) {
  const failures = [];
  let rawPlan;
  try {
    rawPlan = readJson(planPath);
  } catch (error) {
    return {
      ok: false,
      failures: [`failed to parse uikit plan: ${error.message}`],
      warnings: [],
    };
  }

  const result = normalizeUiKitPlan(rawPlan, options);
  failures.push(...result.failures);

  if (failures.length === 0 && options.outPaths?.length) {
    const content = `${JSON.stringify(result.plan, null, 2)}\n`;
    for (const outPath of options.outPaths) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, content);
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings: result.warnings,
    plan: result.plan,
  };
}

function parseArgs(argv) {
  const args = {
    outPaths: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--plan') {
      args.planPath = argv[++index];
    } else if (arg === '--evidence-index') {
      args.evidenceIndexPath = argv[++index];
    } else if (arg === '--component-index') {
      args.componentIndexPath = argv[++index];
    } else if (arg === '--components-dir') {
      args.componentsDirPath = argv[++index];
    } else if (arg === '--out') {
      args.outPaths.push(argv[++index]);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.planPath) {
      throw new Error('--plan is required');
    }
    if (args.evidenceIndexPath && (args.componentIndexPath || args.componentsDirPath)) {
      throw new Error('choose either --evidence-index or --component-index/--components-dir, not both');
    }
    const result = validateUiKitPlanFile(path.resolve(args.planPath), {
      evidenceIndexPath: args.evidenceIndexPath ? path.resolve(args.evidenceIndexPath) : undefined,
      componentIndexPath: args.componentIndexPath ? path.resolve(args.componentIndexPath) : undefined,
      componentsDirPath: args.componentsDirPath ? path.resolve(args.componentsDirPath) : undefined,
      outPaths: args.outPaths.map((outPath) => path.resolve(outPath)),
    });
    const summary = {
      ok: result.ok,
      failures: result.failures,
      warnings: result.warnings,
      allowedComponents: result.plan?.allowedComponents || [],
      coreCount: result.plan?.corePreviewComponents?.length || 0,
      supportCount: result.plan?.supportEvidenceComponents?.length || 0,
    };
    if (!result.ok) {
      console.error(JSON.stringify(summary, null, 2));
      process.exit(1);
    }
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, failures: [error.message], warnings: [] }, null, 2));
    process.exit(1);
  }
}
