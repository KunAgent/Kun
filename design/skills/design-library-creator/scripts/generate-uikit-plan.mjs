#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateUiKitPlanFile } from './validate-uikit-plan.mjs';
import { readDataFile, resolveDataPath } from './jsonl-utils.mjs';
import { CSS_VAR_NAME } from './css-utils.mjs';

// --- Component count limits (centralized for easy tuning) ---
const LIMITS = {
  CORE_TARGET_FIGMA: 6,    // Figma bundle route: first-batch core cap (remaining via support evidence / expand-components)
  CORE_TARGET_NON_FIGMA: 6,     // from-scratch / structured-spec: capped
  CORE_MIN: 4,                  // below this count → lowConfidence warning
  SUPPORT_MAX: 8,               // max support-only evidence components
};

const FIXED_CORE_SLOTS = [
  { slot: 'button', semanticTypes: ['button'], aliases: [/button/i, /btn/i, /按钮/, /按键/] },
  { slot: 'navigation', semanticTypes: ['navigation'], aliases: [/navigation/i, /\bnav\b/i, /sidebar/i, /topbar/i, /导航/, /侧导航/, /顶导航/] },
  { slot: 'menu', semanticTypes: ['menu'], aliases: [/\bmenu\b/i, /菜单/] },
  { slot: 'card', semanticTypes: ['card'], aliases: [/\bcards?\b/i, /panel/i, /tile/i, /卡片/] },
  { slot: 'tag', semanticTypes: ['tag'], aliases: [/\btags?\b/i, /badges?/i, /chip/i, /标签/] },
  { slot: 'table', semanticTypes: ['table'], aliases: [/\btables?\b/i, /datagrid/i, /\bgrid\b/i, /表格/] },
];

const PREFERRED_SUPPORT_SLOTS = [
  { slot: 'tabs', semanticTypes: ['tabs'], aliases: [/\btabs?\b/i, /segmented/i, /标签页/] },
];

const NON_COMPONENT_SLUGS = new Set([
  'internal-only-canvas',
  'unnamed',
  'unknown',
  'icon',
  'icons',
  'image',
  'images',
  'typography',
  'grid',
  'layout',
  'space',
]);


function readJson(filePath) {
  const resolved = resolveDataPath(filePath);
  return readDataFile(resolved);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function normalizeEvidencePath(slug) {
  return `components/_evidence/${slug}.json`;
}

function normalizeComponentContractPath(slug) {
  return `components/${slug}.json`;
}

function topSemantic(evidenceEntry) {
  return evidenceEntry?.semanticTypeCandidates?.[0] ?? { type: 'generic', confidence: 0 };
}

function isExcluded(candidate, evidenceEntry) {
  const slug = candidate.slug;
  const semantic = topSemantic(evidenceEntry);
  const riskText = [...(candidate.riskSignals ?? []), ...(candidate.confidenceSignals ?? [])].join(' ').toLowerCase();
  return (
    NON_COMPONENT_SLUGS.has(slug) ||
    /^internal[-_]/.test(slug) ||
    /^unnamed/.test(slug) ||
    semantic.type === 'image' ||
    riskText.includes('weak-component-name')
  );
}

function fallbackRank(candidate, evidenceEntry) {
  const semantic = topSemantic(evidenceEntry);
  return Math.round(
    Number(evidenceEntry?.priorityHint ?? 0)
    + Number(semantic.confidence ?? 0) * 20
    + Number(candidate.estimatedUIKitValue ?? 0) * 0.1
    + Number(evidenceEntry?.sourceSignals?.instanceUsageCount ?? 0),
  );
}

function selectSlotCandidate(entries, slot, selected) {
  const matches = entries
    .filter((entry) => !selected.has(entry.slug))
    .map((entry) => {
      const semantic = topSemantic(entry.evidenceEntry);
      const text = `${entry.slug} ${entry.candidate?.name ?? ''} ${(entry.candidate?.slotSignals ?? []).join(' ')}`.toLowerCase();
      const semanticHit = slot.semanticTypes.includes(semantic.type);
      const signalHit = (entry.candidate?.slotSignals ?? []).some((signal) => signal.startsWith(`slot:${slot.slot}:`));
      const aliasHit = slot.aliases.some((pattern) => pattern.test(text));
      if (!semanticHit && !signalHit && !aliasHit) return null;
      const reason = semanticHit ? 'semantic' : (signalHit ? 'slot-signal' : 'name');
      const quality = Number(entry.candidate?.evidenceQuality?.score ?? entry.evidenceEntry?.evidenceQuality?.score ?? 0);
      const instanceUsage = Number(entry.evidenceEntry?.sourceSignals?.instanceUsageCount ?? 0);
      const compositePenalty = slot.slot === 'button' && /\b(button[-_ ]?group|group|segmented|组合)\b/.test(text) ? 150 : 0;
      const semanticOnlyPenalty = semanticHit && !signalHit && !aliasHit ? 90 : 0;
      const strength = (semanticHit ? 100 : 0)
        + (signalHit ? 40 : 0)
        + (aliasHit ? 20 : 0)
        + Number(semantic.confidence ?? 0) * 10
        + quality
        + Math.min(5, instanceUsage)
        - compositePenalty
        - semanticOnlyPenalty;
      return { ...entry, fixedSlot: slot.slot, slotReason: reason, slotStrength: strength };
    })
    .filter(Boolean)
    .sort((a, b) => b.slotStrength - a.slotStrength || a.slug.localeCompare(b.slug));
  return matches[0];
}

function buildReason(rankedCandidate) {
  const semantic = topSemantic(rankedCandidate.evidenceEntry);
  const slot = rankedCandidate.fixedSlot ? `fixed slot "${rankedCandidate.fixedSlot}"` : 'fallback after fixed slots';
  return `${slot}; semantic=${semantic.type}:${semantic.confidence ?? 0}; policy=fixed-slots-first`;
}

function toPlanEntry(rankedCandidate, priority) {
  return {
    slug: rankedCandidate.slug,
    reason: buildReason(rankedCandidate),
    evidenceFile: rankedCandidate.evidenceEntry?.evidenceFile
      || rankedCandidate.candidate?.evidenceFile
      || normalizeEvidencePath(rankedCandidate.slug),
    priority,
    slot: rankedCandidate.fixedSlot,
  };
}

function slugify(value) {
  return String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function readComponentIndexEntries(componentIndex) {
  if (Array.isArray(componentIndex?.components)) {
    return componentIndex.components;
  }
  if (Array.isArray(componentIndex)) {
    return componentIndex;
  }
  return [];
}

function inferSemanticType(component, slug) {
  const explicit = Array.isArray(component?.semanticTypeCandidates)
    ? component.semanticTypeCandidates[0]?.type
    : undefined;
  const category = typeof component?.category === 'string' ? component.category : '';
  const name = typeof component?.name === 'string' ? component.name : '';
  const text = `${explicit || ''} ${category} ${name} ${slug}`.toLowerCase();
  const rules = [
    ['button', /\b(button|btn|cta)\b|按钮/],
    ['navigation', /\b(navigation|nav|sidebar|topbar|bottomnav|bottom-nav)\b|导航/],
    ['menu', /\bmenu\b|菜单/],
    ['card', /\b(card|panel|tile|product-card)\b|卡片/],
    ['tag', /\b(tag|badge|chip)\b|标签/],
    ['table', /\b(table|data-grid|datagrid|grid)\b|表格/],
    ['tabs', /\b(tab|tabs|segmented)\b|标签页/],
    ['input', /\b(input|field|form|search)\b|输入/],
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0] || explicit || slug || 'generic';
}

function componentPriority(component, indexEntry) {
  const hint = component?.usageHints?.priorityHint
    ?? component?.priorityHint
    ?? indexEntry?.priorityHint
    ?? component?.estimatedUIKitValue
    ?? 50;
  return Number.isFinite(Number(hint)) ? Number(hint) : 50;
}

function componentVariantCount(component) {
  if (Number.isFinite(component?.variantCount)) return component.variantCount;
  if (Array.isArray(component?.representativeVariants)) return component.representativeVariants.length;
  if (component?.variantDimensions && typeof component.variantDimensions === 'object') {
    return Object.keys(component.variantDimensions).length;
  }
  return 0;
}

function loadComponentContractCandidates(componentIndexPath, componentsDirPath, brandData = {}) {
  const componentIndex = readJson(componentIndexPath);
  const componentEntries = readComponentIndexEntries(componentIndex);
  const candidateComponents = [];
  const evidenceComponents = [];
  const warnings = [];

  for (const entry of componentEntries) {
    const slug = slugify(entry?.slug || entry?.name);
    if (!slug) {
      warnings.push('component-index-entry-missing-slug');
      continue;
    }
    const contractPath = path.join(componentsDirPath, `${slug}.json`);
    if (!fs.existsSync(contractPath)) {
      warnings.push(`component-contract-missing:${slug}`);
      continue;
    }
    const component = readJson(contractPath);
    const name = typeof component?.name === 'string' ? component.name : (entry?.name || slug);
    const semanticType = inferSemanticType(component, slug);
    const priorityHint = componentPriority(component, entry);
    const evidenceFile = normalizeComponentContractPath(slug);
    const semanticTypeCandidates = Array.isArray(component?.semanticTypeCandidates) && component.semanticTypeCandidates.length > 0
      ? component.semanticTypeCandidates.map((candidate) => ({
          type: candidate?.type || semanticType,
          confidence: Number(candidate?.confidence ?? 0.75),
          evidence: candidate?.evidence,
        }))
      : [{ type: semanticType, confidence: 0.75 }];

    candidateComponents.push({
      slug,
      name,
      evidenceFile,
      fullJsonFile: evidenceFile,
      confidenceSignals: [`semantic:${semanticType}:0.75`, `source:${component?.sourceKind || entry?.sourceKind || 'non-figma'}`],
      riskSignals: Array.isArray(component?.doNotInvent) && component.doNotInvent.length > 0 ? ['has-do-not-invent'] : [],
      estimatedUIKitValue: priorityHint,
      slotSignals: Array.isArray(component?.usageHints?.slotSignals) ? component.usageHints.slotSignals : [],
    });

    evidenceComponents.push({
      slug,
      name,
      evidenceFile,
      fullJsonFile: evidenceFile,
      variantCount: componentVariantCount(component),
      primitiveCount: Array.isArray(component?.anatomy) ? component.anatomy.length : 0,
      semanticTypeCandidates,
      recommendedForUIKit: priorityHint >= 45,
      priorityHint,
      sourceKind: component?.sourceKind || entry?.sourceKind || 'non-figma',
      evidenceQuality: component?.evidenceQuality,
      sourceSignals: component?.sourceSignals || {},
      tokenHints: component?.tokenHints,
    });
  }

  return {
    planningInput: {
      schemaVersion: 1,
      libraryName: componentIndex?.libraryName || brandData?.libraryName || null,
      candidateComponents,
      productSignals: componentIndex?.productSignals || {
        pageNames: [],
        selectedFrameNames: [],
        dominantCopy: [],
        specHeadings: [],
      },
      visualSignals: {
        tokenFile: 'colors_and_type.css',
        previewFiles: candidateComponents.map((component) => `preview/component-${component.slug}.html`),
      },
      warnings,
    },
    evidenceIndex: {
      schemaVersion: 1,
      sourceKind: 'component-contract',
      components: evidenceComponents,
    },
  };
}

// 设计系统 token 陈列页名模式（Colors/Typography/Spacing 等），这类页名不是产品场景，不可作为 screen 提示
const TOKEN_PAGE_NAME_PATTERN = /colors?|typography|spacing|grid|icons?|shadows?|borders?|illustrations?|logos?|patterns?|avatars?|色彩|颜色|字体|排版|间距|栅格|图标|阴影|插画/i;

// Figma 母版常见占位符文案（出现占比高说明文件无真实产品文案）
const PLACEHOLDER_COPY_PATTERN = /^(button text|badge text|label|placeholder text|text|input text|helper text|link text|nav link|list item|cell text|secondary text|first action|first step|write some text)/i;

/** 检测规划输入是否退化（纯设计系统文件，无产品场景信号） */
function detectDegradedProductSignals(productSignals) {
  const pageNames = (productSignals?.pageNames ?? []).filter(Boolean);
  const dominantCopy = (productSignals?.dominantCopy ?? []).filter(Boolean);
  const tokenPageRatio = pageNames.length
    ? pageNames.filter((name) => TOKEN_PAGE_NAME_PATTERN.test(name)).length / pageNames.length
    : 0;
  const placeholderRatio = dominantCopy.length
    ? dominantCopy.filter((copy) => PLACEHOLDER_COPY_PATTERN.test(copy.trim())).length / dominantCopy.length
    : 0;
  return tokenPageRatio > 0.5 || placeholderRatio > 0.7;
}

function buildBlueprints(corePreviewComponents, supportEvidenceComponents, productSignals, degraded) {
  // screenBlueprints 只提供 screen 数量和名称提示，不限定每个 screen 的组件列表
  // LLM 根据 allowedComponents 白名单 + 场景设计自行分配组件到各 screen
  const frameNames = (productSignals?.selectedFrameNames ?? []).filter(Boolean);
  const pageNames = (productSignals?.pageNames ?? []).filter(Boolean);
  // 退化输入（token 陈列页名）不可作为 screen 名提示，置空交由场景叙事步骤填充
  const usableHints = degraded ? [] : (frameNames.length >= 2 ? frameNames.slice(0, 3) : (pageNames.length >= 2 ? pageNames.slice(0, 3) : []));

  const screenCount = Math.min(3, Math.max(2, usableHints.length || 3));
  return Array.from({ length: screenCount }, (_, i) => ({
    name: usableHints[i] || null,
    role: i === 0 ? 'primary' : 'secondary',
  }));
}

export function generateUiKitPlan(planningInput, evidenceIndex, brandData = {}, availableVars = null, { coreTarget = LIMITS.CORE_TARGET_NON_FIGMA } = {}) {
  const failures = [];
  const warnings = Array.isArray(planningInput?.warnings) ? [...planningInput.warnings] : [];
  const evidenceComponents = Array.isArray(evidenceIndex?.components) ? evidenceIndex.components : [];
  const evidenceBySlug = new Map(evidenceComponents.map((entry) => [entry.slug, entry]));
  const candidates = Array.isArray(planningInput?.candidateComponents) ? planningInput.candidateComponents : [];
  const forbiddenInventedComponents = [];
  const usable = [];

  for (const candidate of candidates) {
    const slug = typeof candidate?.slug === 'string' ? candidate.slug.trim() : '';
    if (!slug) {
      continue;
    }
    const evidenceEntry = evidenceBySlug.get(slug);
    if (!evidenceEntry) {
      warnings.push(`candidate-not-in-evidence-index:${slug}`);
      continue;
    }
    if (isExcluded({ ...candidate, slug }, evidenceEntry)) {
      forbiddenInventedComponents.push(slug);
      continue;
    }
    const entry = { slug, candidate: { ...candidate, slug }, evidenceEntry };
    if (availableVars?.cssVariables) {
      const varSet = new Set(availableVars.cssVariables);
      const hints = evidenceEntry?.tokenHints?.cssVariables ?? [];
      if (hints.length > 0) {
        const missing = hints.filter(v => !varSet.has(v) && !varSet.has(v.replace(/^--/, '')));
        if (missing.length / hints.length > 0.5) {
          warnings.push(`high-unresolved-vars:${slug} (${missing.length}/${hints.length})`);
        }
      }
    }
    usable.push(entry);
  }

  if (usable.length === 0 && evidenceComponents.length > 0) {
    failures.push('no usable UIKit component candidates after deterministic filtering');
    return { ok: false, failures, warnings, plan: undefined };
  }

  const selected = new Set();
  const slotAssignments = [];
  const missingFixedSlots = [];
  const coreEntries = [];

  for (const slot of FIXED_CORE_SLOTS) {
    const match = selectSlotCandidate(usable, slot, selected);
    if (!match) {
      missingFixedSlots.push(slot.slot);
      warnings.push(`missing-fixed-slot:${slot.slot}`);
      continue;
    }
    selected.add(match.slug);
    match.fixedSlot = slot.slot;
    coreEntries.push(match);
    slotAssignments.push({ slot: slot.slot, slug: match.slug, reason: match.slotReason });
  }

  const supportPreferred = [];
  for (const slot of PREFERRED_SUPPORT_SLOTS) {
    const match = selectSlotCandidate(usable, slot, selected);
    if (!match) continue;
    selected.add(match.slug);
    match.fixedSlot = slot.slot;
    supportPreferred.push(match);
    slotAssignments.push({ slot: slot.slot, slug: match.slug, reason: match.slotReason, preferredSupport: true });
  }

  const fallbackPool = usable
    .filter((entry) => !selected.has(entry.slug))
    .sort((a, b) => fallbackRank(b.candidate, b.evidenceEntry) - fallbackRank(a.candidate, a.evidenceEntry) || a.slug.localeCompare(b.slug));
  const fallbackComponents = [];
  while (coreEntries.length < coreTarget && fallbackPool.length > 0) {
    const entry = fallbackPool.shift();
    entry.fixedSlot = undefined;
    fallbackComponents.push(entry.slug);
    coreEntries.push(entry);
    selected.add(entry.slug);
  }

  const corePreviewComponents = coreEntries.slice(0, coreTarget).map((entry, index) => toPlanEntry(entry, index + 1));
  const supportEvidenceComponents = [...supportPreferred, ...fallbackPool].slice(0, LIMITS.SUPPORT_MAX).map((entry, index) => (
    toPlanEntry(entry, corePreviewComponents.length + index + 1)
  ));

  let lowConfidence = false;
  if (corePreviewComponents.length < LIMITS.CORE_MIN) {
    lowConfidence = true;
    warnings.push('fewer-than-core-min-candidates');
  }

  const needsNarrative = detectDegradedProductSignals(planningInput?.productSignals);
  // 退化输入下优先消费 brand-analyst 产出的 productNarrative（真实业务场景），
  // 替代 token 陈列页名，使 UIKit 产出场景化页面而非组件展示架
  const narrative = brandData?.productNarrative && typeof brandData.productNarrative === 'object'
    ? brandData.productNarrative
    : null;
  let screenBlueprints;
  if (needsNarrative && Array.isArray(narrative?.screens) && narrative.screens.length >= 2) {
    screenBlueprints = narrative.screens.slice(0, 3).map((screen, i) => ({
      name: typeof screen?.name === 'string' ? screen.name : null,
      role: i === 0 ? 'primary' : 'secondary',
      ...(typeof screen?.purpose === 'string' && screen.purpose ? { purpose: screen.purpose } : {}),
      ...(typeof screen?.primaryAction === 'string' && screen.primaryAction ? { primaryAction: screen.primaryAction } : {}),
    }));
    warnings.push('screen-blueprints-from-product-narrative (design-system file has no product pages)');
  } else {
    if (needsNarrative) {
      warnings.push('degraded-product-signals: page names/copy are design-system specimens; productNarrative synthesis required before UIKit generation');
    }
    screenBlueprints = buildBlueprints(corePreviewComponents, supportEvidenceComponents, planningInput?.productSignals, needsNarrative);
  }
  const allowedComponents = unique([
    ...corePreviewComponents.map((entry) => entry.slug),
    ...supportEvidenceComponents.map((entry) => entry.slug),
    ...screenBlueprints.flatMap((entry) => entry.componentSlugs),
  ]);

  // kitType 矫正：当组件列表以桌面端模式为主时，不允许被误判为 app-screens
  let kitType = brandData?.kitType || null;
  if (kitType === 'app-screens') {
    const desktopSignals = ['sidebar', 'table', 'tables', 'pagination', 'breadcrumbs', 'navbar', 'drawer', 'modal', 'modals'];
    const mobileSignals = ['bottom-navigation', 'bottom-nav', 'tab-bar'];
    const allSlugs = allowedComponents;
    const desktopCount = allSlugs.filter(s => desktopSignals.some(d => s.includes(d))).length;
    const mobileCount = allSlugs.filter(s => mobileSignals.some(m => s.includes(m))).length;
    if (desktopCount >= 2 && desktopCount > mobileCount) {
      kitType = 'dashboard';
      warnings.push('kitType-overridden:app-screens→dashboard (desktop-dominant component set)');
    }
  }

  const plan = {
    schemaVersion: 1,
    headBoilerplate: '<link rel="stylesheet" href="../../colors_and_type.css">',
    selectionPolicy: 'fixed-slots-first',
    slotAssignments,
    missingFixedSlots,
    fallbackComponents,
    corePreviewComponents,
    supportEvidenceComponents,
    allowedComponents,
    screenBlueprints,
    productContext: {
      kitType,
      productType: brandData?.productType || null,
      dominantCopy: (planningInput?.productSignals?.dominantCopy ?? []).slice(0, 10),
      pageNames: (planningInput?.productSignals?.pageNames ?? []).slice(0, 6),
      selectedFrameNames: (planningInput?.productSignals?.selectedFrameNames ?? []).slice(0, 6),
    },
    forbiddenInventedComponents: unique(forbiddenInventedComponents),
    needsNarrative,
    lowConfidence,
    warnings: unique(warnings),
  };

  return { ok: true, failures, warnings: plan.warnings, plan };
}

function parseArgs(argv) {
  const args = { outPaths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--planning-input') {
      args.planningInputPath = argv[++index];
    } else if (arg === '--evidence-index') {
      args.evidenceIndexPath = argv[++index];
    } else if (arg === '--component-index') {
      args.componentIndexPath = argv[++index];
    } else if (arg === '--components-dir') {
      args.componentsDirPath = argv[++index];
    } else if (arg === '--brand-data') {
      args.brandDataPath = argv[++index];
    } else if (arg === '--available-vars') {
      args.availableVarsPath = argv[++index];
    } else if (arg === '--components-css') {
      args.componentsCssPath = argv[++index];
    } else if (arg === '--out') {
      args.outPaths.push(argv[++index]);
    } else if (arg === '--patch-layout') {
      args.patchLayout = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

/**
 * Extract sidebar column width from components.css.
 * Looks for `.sidebar-shell.default{width:Npx}` or `.sidebar-shell{width:Npx}`.
 * Returns the pixel value string (e.g. "288px") or null if not found.
 */
function extractSidebarWidth(componentsCssPath) {
  if (!componentsCssPath || !fs.existsSync(componentsCssPath)) return null;
  const css = fs.readFileSync(path.resolve(componentsCssPath), 'utf-8');
  // Match .sidebar-shell or .sidebar-shell.default with explicit width
  const match = css.match(/\.sidebar-shell(?:\.default)?\s*\{[^}]*?\bwidth\s*:\s*(\d+)px/);
  return match ? `${match[1]}px` : null;
}

/**
 * --patch-layout 模式：components.css 生成（§3.6）之后，将 sidebar 宽度回填进已存在的 uikit-plan.json。
 * 主工作流时序上 §2.7 生成 plan 时 components.css 尚不存在，layout 注入必须在此后置步骤完成。
 */
export function patchUiKitPlanLayout(options) {
  const outPaths = (options.outPaths ?? []).map((outPath) => path.resolve(outPath));
  if (!outPaths.length) {
    throw new Error('--out is required at least once in --patch-layout mode');
  }
  const planPath = outPaths.find((p) => fs.existsSync(p));
  if (!planPath) {
    return { ok: false, failures: ['patch-layout: no existing uikit-plan.json found at --out paths'], warnings: [], writtenFiles: [] };
  }
  const plan = readJson(planPath);
  const sidebarWidth = extractSidebarWidth(options.componentsCssPath);
  if (!sidebarWidth) {
    return { ok: true, failures: [], warnings: ['patch-layout: no sidebar width found in components.css; layout unchanged'], writtenFiles: [] };
  }
  plan.layout = { ...(plan.layout ?? {}), sidebarColumnWidth: sidebarWidth };
  const content = `${JSON.stringify(plan, null, 2)}\n`;
  for (const outPath of outPaths) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content);
  }
  return { ok: true, failures: [], warnings: [], writtenFiles: outPaths, layout: plan.layout };
}

export function generateUiKitPlanFile(options) {
  const outPaths = (options.outPaths ?? []).map((outPath) => path.resolve(outPath));
  if (!outPaths.length) {
    throw new Error('--out is required at least once');
  }

  const brandData = options.brandDataPath && fs.existsSync(options.brandDataPath)
    ? readJson(path.resolve(options.brandDataPath))
    : {};
  const availableVars = options.availableVarsPath && fs.existsSync(options.availableVarsPath)
    ? (() => {
        const content = fs.readFileSync(path.resolve(options.availableVarsPath), 'utf-8');
        if (options.availableVarsPath.endsWith('.css')) {
          return { cssVariables: [...content.matchAll(new RegExp(`--([${CSS_VAR_NAME}]+)\\s*:`, 'g'))].map(m => m[1]) };
        }
        return readJson(path.resolve(options.availableVarsPath));
      })()
    : null;

  const hasFigmaInput = Boolean(options.planningInputPath || options.evidenceIndexPath);
  const hasComponentInput = Boolean(options.componentIndexPath || options.componentsDirPath);
  if (hasFigmaInput && hasComponentInput) {
    throw new Error('choose either --planning-input/--evidence-index or --component-index/--components-dir, not both');
  }
  if (!hasFigmaInput && !hasComponentInput) {
    throw new Error('one input mode is required: --planning-input/--evidence-index or --component-index/--components-dir');
  }

  let planningInput;
  let evidenceIndex;
  let evidenceIndexPath;
  let componentIndexPath;
  let componentsDirPath;
  if (hasComponentInput) {
    if (!options.componentIndexPath) {
      throw new Error('--component-index is required in component-contract mode');
    }
    if (!options.componentsDirPath) {
      throw new Error('--components-dir is required in component-contract mode');
    }
    componentIndexPath = path.resolve(options.componentIndexPath);
    componentsDirPath = path.resolve(options.componentsDirPath);
    ({ planningInput, evidenceIndex } = loadComponentContractCandidates(componentIndexPath, componentsDirPath, brandData));
  } else {
    if (!options.planningInputPath) {
      throw new Error('--planning-input is required in evidence mode');
    }
    if (!options.evidenceIndexPath) {
      throw new Error('--evidence-index is required in evidence mode');
    }
    const planningInputPath = path.resolve(options.planningInputPath);
    evidenceIndexPath = path.resolve(options.evidenceIndexPath);
    planningInput = readJson(planningInputPath);
    const resolvedEvidencePath = resolveDataPath(evidenceIndexPath);
    if (!fs.existsSync(resolvedEvidencePath)) {
      return {
        ok: false,
        failures: [`PREREQUISITE_MISSING: ${options.evidenceIndexPath} does not exist. Run copy-bundle-assets.mjs first (§ 2.3b).`],
        warnings: [],
        writtenFiles: [],
        allowedComponents: [],
        coreCount: 0,
        supportCount: 0,
      };
    }
    evidenceIndex = readJson(evidenceIndexPath);
  }

  const coreTarget = hasFigmaInput ? LIMITS.CORE_TARGET_FIGMA : LIMITS.CORE_TARGET_NON_FIGMA;
  const generated = generateUiKitPlan(planningInput, evidenceIndex, brandData, availableVars, { coreTarget });
  if (!generated.ok) {
    return {
      ok: false,
      failures: generated.failures,
      warnings: generated.warnings,
      writtenFiles: [],
      allowedComponents: [],
      coreCount: 0,
      supportCount: 0,
    };
  }

  // Inject layout hints from components.css (sidebar width for grid column sizing)
  const sidebarWidth = extractSidebarWidth(options.componentsCssPath);
  const hasNavComponent = (generated.plan.corePreviewComponents || []).some(
    (c) => c.slot === 'navigation',
  );
  if (hasNavComponent && sidebarWidth) {
    generated.plan.layout = { sidebarColumnWidth: sidebarWidth };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uikit-plan-generator-'));
  const generatedPlanPath = path.join(tmpDir, 'uikit-plan.json');
  fs.writeFileSync(generatedPlanPath, `${JSON.stringify(generated.plan, null, 2)}\n`);

  const validation = validateUiKitPlanFile(generatedPlanPath, {
    evidenceIndexPath,
    componentIndexPath,
    componentsDirPath,
    outPaths,
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });

  return {
    ok: validation.ok,
    failures: validation.failures,
    warnings: validation.warnings,
    writtenFiles: validation.ok ? outPaths : [],
    allowedComponents: validation.plan?.allowedComponents || [],
    coreCount: validation.plan?.corePreviewComponents?.length || 0,
    supportCount: validation.plan?.supportEvidenceComponents?.length || 0,
  };
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = args.patchLayout ? patchUiKitPlanLayout(args) : generateUiKitPlanFile(args);
    if (!result.ok) {
      console.error(JSON.stringify(result, null, 2));
      process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, failures: [error.message], warnings: [] }, null, 2));
    process.exit(1);
  }
}
