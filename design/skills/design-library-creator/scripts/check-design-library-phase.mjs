#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Schema/正则 SSOT lives in css-utils.mjs (shared with css-to-json.mjs);
// REQUIRED_CSS_JSON_KEYS re-exported to preserve the existing import surface.
import { CSS_VAR_NAME, REQUIRED_CSS_JSON_KEYS } from './css-utils.mjs';
export { REQUIRED_CSS_JSON_KEYS } from './css-utils.mjs';

// Per-run file content cache: validators repeatedly read the same HTML/CSS
// files (6-8x per file in phase=all). Inputs do not change during a single
// validation run, so memoizing is behavior-identical. The cache is cleared at
// the start of every validateDesignLibraryOutput() call so repeated in-process
// invocations (e.g., tests that rewrite fixtures) always see fresh content.
const READ_TEXT_CACHE = new Map();

function readText(filePath) {
  const key = path.resolve(filePath);
  if (READ_TEXT_CACHE.has(key)) {
    return READ_TEXT_CACHE.get(key);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  READ_TEXT_CACHE.set(key, content);
  return content;
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function statSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function rel(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function walkFiles(dirPath, predicate = () => true) {
  if (!exists(dirPath)) {
    return [];
  }

  const files = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath, predicate));
    } else if (predicate(entryPath)) {
      files.push(entryPath);
    }
  }
  return files;
}

function parseCsv(value) {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveInputFiles(rootDir, files) {
  return files.map((file) => (path.isAbsolute(file) ? file : path.join(rootDir, file)));
}

// 变量名字符类 CSS_VAR_NAME 由 css-utils.mjs 提供（文件头 import，含完整 CJK 区段，支持 --碧涛青-1 等中文变量名）

/** 收集 CSS 中声明的自定义属性（先剥离注释，避免把 /* --x: ... *\/ 误收进白名单） */
export function collectCssVariables(cssContent) {
  const withoutComments = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');
  return new Set(
    [...withoutComments.matchAll(new RegExp(`--([${CSS_VAR_NAME}]+)\\s*:`, 'g'))].map((match) => match[1]),
  );
}

export function collectVarUsages(content) {
  return [...content.matchAll(new RegExp(`var\\(\\s*--([${CSS_VAR_NAME}]+)`, 'g'))].map((match) => match[1]);
}

export function collectCssVariableDeclarations(content) {
  // 仅扫描 <style> 块与内联 style="" 属性，避免把正文/<code> 中演示 token 用法的文本误判为声明
  const scanTargets = [];
  for (const match of content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    scanTargets.push(match[1]);
  }
  for (const match of content.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    scanTargets.push(match[1] ?? match[2] ?? '');
  }
  const declarations = [];
  const declRegex = new RegExp(`(^|[;{\\s"'])--([${CSS_VAR_NAME}]+)\\s*:`, 'g');
  for (const target of scanTargets) {
    for (const match of target.matchAll(declRegex)) {
      declarations.push(match[2]);
    }
  }
  return declarations;
}

function validateLocalCssVarDeclarations(rootDir, htmlFiles) {
  const localCssVarDeclarations = [];
  for (const filePath of htmlFiles) {
    if (!exists(filePath)) {
      continue;
    }
    const relativePath = rel(rootDir, filePath);
    if (!relativePath.startsWith('preview/')) {
      continue;
    }
    const content = readText(filePath);
    const declarations = [...new Set(collectCssVariableDeclarations(content))];
    if (declarations.length > 0) {
      localCssVarDeclarations.push({
        file: relativePath,
        variables: declarations,
        gate: 'local-css-vars',
        phaseHint: 'preview',
        reason: 'preview HTML must consume colors_and_type.css variables directly and must not declare component/page-level CSS custom properties',
      });
    }
  }
  return localCssVarDeclarations;
}

function parseJson(filePath, failures, rootDir) {
  try {
    return JSON.parse(readText(filePath));
  } catch (error) {
    failures.push({
      file: rel(rootDir, filePath),
      reason: error.message,
    });
    return undefined;
  }
}

function readOptionalJson(filePath) {
  if (!filePath || !exists(filePath)) return undefined;
  try {
    return JSON.parse(readText(filePath));
  } catch {
    return undefined;
  }
}

function collectPhaseFiles(rootDir, phase, explicitFiles) {
  if (explicitFiles.length > 0) {
    return resolveInputFiles(rootDir, explicitFiles);
  }

  if (phase === 'preview') {
    return walkFiles(path.join(rootDir, 'preview'), (filePath) => filePath.endsWith('.html'));
  }

  if (phase === 'uikit') {
    return walkFiles(path.join(rootDir, 'ui_kits'), (filePath) => filePath.endsWith('.html'));
  }

  if (phase === 'docs') {
    return ['SKILL.md', 'README.md'].map((file) => path.join(rootDir, file));
  }

  return [
    ...walkFiles(path.join(rootDir, 'preview'), (filePath) => filePath.endsWith('.html')),
    ...walkFiles(path.join(rootDir, 'ui_kits'), (filePath) => filePath.endsWith('.html')),
    path.join(rootDir, 'SKILL.md'),
    path.join(rootDir, 'README.md'),
  ];
}

function validateCssVars(rootDir, htmlFiles, cssVariables) {
  const undefinedCssVars = [];
  for (const filePath of htmlFiles) {
    if (!exists(filePath)) {
      continue;
    }
    const content = readText(filePath);
    const usedVariables = [...new Set(collectVarUsages(content))];
    const relativePath = rel(rootDir, filePath);
    // ui_kits 文件允许在 HTML 内（内联 style / <style> 块）声明页面级自定义属性
    // （如模板骨架要求的 --uikit-sidebar-w），这些本地声明并入该文件的允许集
    const localDeclarations = relativePath.startsWith('ui_kits/')
      ? new Set(collectCssVariableDeclarations(content))
      : new Set();
    const missingVariables = usedVariables.filter(
      (name) => !cssVariables.has(name) && !localDeclarations.has(name),
    );
    if (missingVariables.length > 0) {
      undefinedCssVars.push({
        file: relativePath,
        variables: missingVariables,
        gate: 'css-vars',
        phaseHint: relativePath.startsWith('ui_kits/') ? 'uikit' : 'preview',
      });
    }
  }
  return undefinedCssVars;
}

function validatePreviewFiles(rootDir, files) {
  const previewLinkFailures = [];
  for (const filePath of files) {
    if (!exists(filePath)) {
      previewLinkFailures.push({ file: rel(rootDir, filePath), reason: 'missing file' });
      continue;
    }
    const relativePath = rel(rootDir, filePath);
    const content = readText(filePath);
    if (relativePath.startsWith('preview/') && !hasStylesheetLink(content, '../colors_and_type.css')) {
      previewLinkFailures.push({
        file: relativePath,
        reason: 'missing ../colors_and_type.css link',
      });
    }
  }
  return previewLinkFailures;
}

function validateLocalImageRefs(rootDir, htmlFiles) {
  const failures = [];
  for (const filePath of htmlFiles) {
    if (!exists(filePath)) continue;
    const content = readText(filePath);
    const fileDir = path.dirname(filePath);
    const refs = [...content.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
      .map((match) => match[1])
      .filter((src) => src && !/^(?:https?:)?\/\//i.test(src) && !/^data:/i.test(src));
    for (const src of refs) {
      const cleanSrc = src.split(/[?#]/)[0];
      const target = path.resolve(fileDir, cleanSrc);
      if (!exists(target)) {
        failures.push({
          gate: 'local-image-ref',
          file: rel(rootDir, filePath),
          src,
          reason: `missing local image asset: ${rel(rootDir, target)}`,
        });
      }
    }
  }
  return failures;
}

function hasStylesheetLink(content, href) {
  const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const linkPattern = new RegExp(`<link\\b(?=[^>]*\\brel=["']stylesheet["'])(?=[^>]*\\bhref=["']${escapedHref}["'])[^>]*\\/?>`, 'i');
  return linkPattern.test(content);
}

function getFirstStyleBlock(content) {
  return content.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1] || '';
}

function getStyleContent(content) {
  return [...content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join('\n');
}

function cssRuleBody(styleContent, className) {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...styleContent.matchAll(new RegExp(`\\.${escaped}\\b[^{}]*\\{([^}]*)\\}`, 'gs'))];
  return matches.map((match) => match[1]).join('\n');
}

function hasDeclarations(ruleBody, patterns) {
  return patterns.every((pattern) => pattern.test(ruleBody));
}

function validateUiKitLayoutGuard(rootDir, filePath, content) {
  const failures = [];
  const warnings = [];
  const relativePath = rel(rootDir, filePath);
  const styleContent = getStyleContent(content) || getFirstStyleBlock(content);
  const fail = (reason) => failures.push({ file: relativePath, reason, gate: 'uikit-layout' });
  const warn = (reason) => warnings.push({ file: relativePath, reason, gate: 'uikit-layout' });
  // app/mobile kits render a centered phone frame, not a desktop grid shell.
  // Desktop-oriented guards (responsive grid, table wrap, action cells, 900px collapse)
  // are advisory for them; the 1184px shell + truncate + no-scaling guards still apply.
  const isPhoneKit = /^ui_kits[\\/](app|mobile)[\\/]/i.test(relativePath);
  const failDesktop = isPhoneKit ? warn : fail;

  if (!content.includes('data-layout-guard="uikit-v1"')) {
    fail('missing data-layout-guard="uikit-v1" root marker');
  }

  if (!/<meta\b(?=[^>]*\bname=["']viewport["'])(?=[^>]*\bcontent=["'][^"']*width=device-width[^"']*initial-scale=1\.0[^"']*["'])[^>]*>/i.test(content)) {
    fail('missing viewport meta for responsive UIKit rendering');
  }

  const shellRule = cssRuleBody(styleContent, 'uikit-shell');
  if (!hasDeclarations(shellRule, [
    /width\s*:\s*100%/i,
    /max-width\s*:/i,
    /margin\s*:\s*0\s+auto/i,
    /overflow\s*:\s*hidden/i,
  ])) {
    fail('missing complete .uikit-shell overflow guard');
  }
  const shellMaxWidths = [...shellRule.matchAll(/max-width\s*:\s*([0-9.]+)px/gi)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  const excessiveShellMaxWidth = shellMaxWidths.find((value) => value > 1184);
  if (excessiveShellMaxWidth) {
    fail(`.uikit-shell max-width ${excessiveShellMaxWidth}px exceeds frontend Component tab iframe target 1184px`);
  }

  const truncateRule = cssRuleBody(styleContent, 'uikit-truncate');
  if (!hasDeclarations(truncateRule, [
    /min-width\s*:\s*0/i,
    /overflow\s*:\s*hidden/i,
    /text-overflow\s*:\s*ellipsis/i,
    /white-space\s*:\s*nowrap/i,
  ])) {
    fail('missing complete .uikit-truncate text overflow guard');
  }

  const nowrapRule = cssRuleBody(styleContent, 'uikit-nowrap');
  if (!hasDeclarations(nowrapRule, [
    /white-space\s*:\s*nowrap/i,
    /flex-shrink\s*:\s*0/i,
  ])) {
    failDesktop('missing complete .uikit-nowrap anti-wrap guard');
  }

  const tableWrapRule = cssRuleBody(styleContent, 'uikit-table-wrap');
  if (!hasDeclarations(tableWrapRule, [
    /max-width\s*:\s*100%/i,
    /overflow-x\s*:\s*auto/i,
    /overscroll-behavior-x\s*:\s*contain/i,
  ])) {
    failDesktop('missing complete .uikit-table-wrap horizontal overflow guard');
  }

  if (/<table\b/i.test(content) && !/\bclass(?:Name)?=["'][^"']*\buikit-table-wrap\b/i.test(content)) {
    fail('table markup must be wrapped by .uikit-table-wrap');
  }

  const responsiveGridRule = cssRuleBody(styleContent, 'uikit-responsive-grid');
  if (!responsiveGridRule || !/minmax\(\s*0\s*,\s*1fr\s*\)/i.test(responsiveGridRule)) {
    failDesktop('missing .uikit-responsive-grid with minmax(0, 1fr) columns');
  }

  if (!/@media\s*\([^)]*max-width\s*:\s*900px[^)]*\)/i.test(styleContent)) {
    failDesktop('missing @media (max-width: 900px) responsive collapse guard');
  }

  if (!/@media\s*\([^)]*max-width\s*:\s*640px[^)]*\)/i.test(styleContent)) {
    fail('missing @media (max-width: 640px) responsive stack guard');
  }

  if (!/uikit-main[\s\S]{0,180}min-width\s*:\s*0/i.test(styleContent)) {
    failDesktop('missing min-width:0 guard for .uikit-main');
  }
  if (!/uikit-toolbar[\s\S]{0,180}min-width\s*:\s*0/i.test(styleContent)) {
    failDesktop('missing min-width:0 guard for .uikit-toolbar');
  }
  if (!/minmax\(\s*0\s*,\s*1fr\s*\)/i.test(styleContent)) {
    failDesktop('missing minmax(0, 1fr) flexible grid column guard');
  }
  if (/writing-mode\s*:\s*vertical/i.test(styleContent)) {
    fail('vertical writing-mode is forbidden for UIKit layout text');
  }
  // Page-scaling check targets layout-level scaling only. Strip @keyframes blocks and
  // pseudo-class (:hover/:active/:focus) rules first so interaction micro-animations
  // (e.g. .capture-ring:hover{transform:scale(1.05)}) are not misreported as page scaling.
  const staticStyleContent = styleContent
    .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gi, '')
    .replace(/[^{}]*:(?:hover|active|focus(?:-visible|-within)?)[^{]*\{[^}]*\}/gi, '');
  if (/(transform\s*:\s*scale\s*\(|\bzoom\s*:)/i.test(staticStyleContent)) {
    fail('page scaling is forbidden; UIKit must fit natively in iframe target 1184px');
  }
  if (/position\s*:\s*fixed[\s\S]{0,160}(?:left|top)\s*:/i.test(styleContent)) {
    fail('fixed left/top positioning is forbidden for normal UIKit layout');
  }
  if (!/uikit-action-cell[\s\S]{0,220}max-width\s*:\s*160px/i.test(styleContent)) {
    failDesktop('missing .uikit-action-cell max-width guard for table/list action cells');
  }
  if (!/uikit-action[\s\S]{0,220}text-overflow\s*:\s*ellipsis/i.test(styleContent)) {
    failDesktop('missing .uikit-action text ellipsis guard for constrained action buttons');
  }
  if (/(?:→|←|↔|›|‹|⌄|⌃|▼|▲)/.test(content)) {
    warn('unicode/text arrows are forbidden as icon substitutes in UIKit');
  }

  return { failures, warnings };
}

function validateUiKitFiles(rootDir, files) {
  const uiKitFailures = [];
  const uiKitWarnings = [];

  for (const filePath of files) {
    if (!exists(filePath)) {
      uiKitFailures.push({ file: rel(rootDir, filePath), reason: 'missing file' });
      continue;
    }
    const content = readText(filePath);
    const relativePath = rel(rootDir, filePath);
    if (!relativePath.startsWith('ui_kits/')) {
      continue;
    }
    if (!hasStylesheetLink(content, '../../colors_and_type.css')) {
      uiKitFailures.push({ file: relativePath, reason: 'missing ../../colors_and_type.css link' });
    }
    const layoutGuard = validateUiKitLayoutGuard(rootDir, filePath, content);
    uiKitFailures.push(...layoutGuard.failures);
    uiKitWarnings.push(...layoutGuard.warnings);
    uiKitWarnings.push(...validateUiKitIntentDrift(rootDir, filePath, content));
  }

  return { uiKitFailures, warnings: uiKitWarnings };
}

function validateUiKitIntentDrift(rootDir, filePath, content) {
  const warnings = [];
  const relativePath = rel(rootDir, filePath);
  warnings.push(...validateTableUsageAgainstIntent(rootDir, relativePath, content));
  warnings.push(...validateSegmentedGroupUsageAgainstIntent(rootDir, relativePath, content));
  return warnings;
}

function validateTableUsageAgainstIntent(rootDir, relativePath, content) {
  if (!/data-component=["']tables["']/.test(content)) return [];
  const intent = readOptionalJson(path.join(rootDir, 'components', 'tables.json'));
  const tableModel = intent?.patterns?.tableModel;
  if (!tableModel) return [];

  const warnings = [];
  const rows = Array.isArray(tableModel.rows) ? tableModel.rows : [];
  const allowedTexts = new Set([
    ...(intent.uiCopySamples || []),
    ...(tableModel.columns || []).flatMap((column) => [column.headerText, ...(column.sampleValues || [])]),
    ...rows.flatMap((row) => row.cells || []).flatMap((cell) => cell.texts || []),
  ].filter(Boolean).map(normalizeText));
  const evidencedControls = new Set(rows.flatMap((row) => row.cells || []).flatMap((cell) => cell.controls || []));

  if (/className=["'][^"']*\btable-toggle\b|class=["'][^"']*\btable-toggle\b/.test(content) && !evidencedControls.has('toggle')) {
    warnings.push({
      gate: 'uikit-intent-drift',
      file: relativePath,
      reason: 'table-toggle-not-evidenced: UIKit uses .table-toggle but components/tables.json tableModel rows do not evidence toggle controls',
    });
  }

  const firstHeaderCount = extractFirstTableHeaderCount(content);
  if (firstHeaderCount !== undefined && Array.isArray(tableModel.columns) && tableModel.columns.length > 0 && firstHeaderCount !== tableModel.columns.length) {
    warnings.push({
      gate: 'uikit-intent-drift',
      file: relativePath,
      reason: `table-model-column-drift: rendered ${firstHeaderCount} table headers but evidence has ${tableModel.columns.length} columns`,
    });
  }

  if (intent?.contentPolicy?.forbiddenModes?.includes('invented-product-data')) {
    const unknownCellTexts = extractTableCellTexts(content)
      .filter((text) => text && !allowedTexts.has(normalizeText(text)))
      .slice(0, 5);
    if (unknownCellTexts.length > 0) {
      warnings.push({
        gate: 'uikit-intent-drift',
        file: relativePath,
        reason: `invented-table-content: ${unknownCellTexts.join(', ')}`,
      });
    }
  }

  return warnings;
}

function validateSegmentedGroupUsageAgainstIntent(rootDir, relativePath, content) {
  if (!/\bbutton-group\b/.test(content)) return [];
  const intent = readOptionalJson(path.join(rootDir, 'components', 'button-group.json'));
  const groups = intent?.patterns?.segmentedGroups;
  if (!Array.isArray(groups) || groups.length === 0) return [];

  const warnings = [];
  const expectedTexts = new Set(groups.flatMap((group) => group.segments || []).map((segment) => normalizeText(segment.text)).filter(Boolean));
  const hasContentHug = (intent.controlMatrix?.sizes || []).some((size) => size.widthPolicy === 'content-hug')
    || groups.some((group) => (group.segments || []).some((segment) => segment.widthPolicy === 'content-hug'));

  if (hasContentHug && /\bbutton-group\b[\s\S]{0,2000}style=["'][^"']*width\s*:/.test(content)) {
    warnings.push({
      gate: 'uikit-intent-drift',
      file: relativePath,
      reason: 'segmented-fixed-width-text-risk: content-hug segmented group should not use fixed inline widths',
    });
  }

  const renderedTexts = extractSegmentTexts(content);
  const drift = renderedTexts.filter((text) => !expectedTexts.has(normalizeText(text))).slice(0, 5);
  if (drift.length > 0) {
    warnings.push({
      gate: 'uikit-intent-drift',
      file: relativePath,
      reason: `segmented-text-drift: ${drift.join(', ')}`,
    });
  }

  const renderedSegments = extractSegmentHtmls(content);
  const expectedSegments = groups.flatMap((group) => group.segments || []);
  const overRenderedIconSegments = renderedSegments
    .map((html, index) => ({ html, expected: expectedSegments[index], index }))
    .filter(({ html, expected }) => expected && expected.hasIcon === false && segmentHtmlHasIcon(html))
    .slice(0, 5);
  if (overRenderedIconSegments.length > 0) {
    warnings.push({
      gate: 'uikit-intent-drift',
      file: relativePath,
      reason: `segmented-icon-overrender: ${overRenderedIconSegments.map(({ index }) => `segment-${index}`).join(', ')}`,
    });
  }

  return warnings;
}

function extractSegmentHtmls(content) {
  return [...content.matchAll(/<button\b[^>]*(?:className|class)=["'][^"']*\bsegment\b[^"']*["'][^>]*>([\s\S]*?)<\/button>/gi)]
    .map((match) => match[1]);
}

function segmentHtmlHasIcon(html) {
  return /<img\b|<svg\b|data-lucide=|\bicon(?:-|__|\b)|lucide-static\/icons/i.test(html);
}

function extractFirstTableHeaderCount(content) {
  const match = content.match(/<thead[\s\S]*?<tr[^>]*>([\s\S]*?)<\/tr>[\s\S]*?<\/thead>/i);
  if (!match) return undefined;
  return [...match[1].matchAll(/<th\b/gi)].length;
}

function extractTableCellTexts(content) {
  return [...content.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
    .map((match) => stripTags(match[1]))
    .filter(Boolean);
}

function extractSegmentTexts(content) {
  return [...content.matchAll(/<button\b[^>]*(?:className|class)=["'][^"']*\bsegment\b[^"']*["'][^>]*>([\s\S]*?)<\/button>/gi)]
    .map((match) => stripTags(match[1]))
    .filter(Boolean);
}

function stripTags(value) {
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function collectCssClassNames(content) {
  const styleMatch = content.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  if (!styleMatch) return new Set();
  const styleContent = styleMatch[1];
  const classes = new Set();
  for (const match of styleContent.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)) {
    const cls = match[1];
    // Skip layout-only classes
    if (/^(row|label|divider|page|screen|view|container|wrapper|grid|sidebar|header|footer|main|nav|content|phone-frame|status-bar|home-bar|app)$/i.test(cls)) continue;
    classes.add(cls);
  }
  return classes;
}

const COMPONENT_CLASS_KEYWORDS = /^(btn|button|input|field|card|table|tag|badge|chip|tab|menu|select|checkbox|radio|toggle|switch|modal|dialog|tooltip|popover|dropdown|avatar|alert|toast|progress|slider|nav-item|list-item)/i;

// Collect class names actually used in markup: class="..." / className="..." attributes,
// plus string literals inside JSX className expressions (e.g. className={"chip "+(x?"chip-selected":"chip-default")}).
// React-CDN UIKits keep component classes in JSX, not in <style>, so style-block scanning alone misses them.
function collectMarkupClassNames(content) {
  const classes = new Set();
  const addTokens = (value) => {
    for (const token of String(value).split(/\s+/)) {
      if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(token)) classes.add(token);
    }
  };
  for (const match of content.matchAll(/\bclass(?:Name)?\s*=\s*["']([^"']+)["']/g)) {
    addTokens(match[1]);
  }
  for (const exprMatch of content.matchAll(/\bclassName\s*=\s*\{([\s\S]*?)\}/g)) {
    for (const literal of exprMatch[1].matchAll(/["'`]([^"'`]+)["'`]/g)) {
      addTokens(literal[1]);
    }
  }
  return classes;
}

function collectPreviewClasses(rootDir) {
  const previewDir = path.join(rootDir, 'preview');
  const previewClasses = new Set();
  if (!exists(previewDir)) return previewClasses;

  const previewFiles = walkFiles(previewDir, (filePath) => {
    return /^component-.*\.html$/i.test(path.basename(filePath));
  });
  for (const filePath of previewFiles) {
    const content = readText(filePath);
    for (const cls of collectCssClassNames(content)) {
      previewClasses.add(cls);
    }
  }
  return previewClasses;
}

function loadEvidenceComponentSlugs(rootDir) {
  const evidenceIndexPath = path.join(rootDir, 'components', '_evidence', 'index.json');
  if (!exists(evidenceIndexPath)) return new Set();

  try {
    const evidenceIndex = JSON.parse(readText(evidenceIndexPath));
    return new Set(
      (Array.isArray(evidenceIndex.components) ? evidenceIndex.components : [])
        .map((component) => component?.slug)
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

function evidenceSlugPrefixes(slug) {
  const normalized = String(slug || '').toLowerCase();
  const parts = normalized.split('-').filter(Boolean);
  const prefixes = new Set([normalized]);
  if (normalized.endsWith('s') && normalized.length > 1) {
    prefixes.add(normalized.slice(0, -1));
  }
  if (parts.length > 1) {
    prefixes.add(parts[0]);
  }
  return prefixes;
}

function isClassBackedByEvidenceSlug(className, slug) {
  const normalizedClass = String(className || '').toLowerCase().replace(/\d+$/, '');
  for (const prefix of evidenceSlugPrefixes(slug)) {
    if (
      normalizedClass === prefix ||
      normalizedClass.startsWith(`${prefix}-`) ||
      normalizedClass.startsWith(`${prefix}_`)
    ) {
      return true;
    }
  }
  return false;
}

function collectEvidenceBackedClasses(classNames, evidenceSlugs) {
  const backed = new Set();
  if (!evidenceSlugs || evidenceSlugs.size === 0) return backed;

  for (const cls of classNames) {
    if (!COMPONENT_CLASS_KEYWORDS.test(cls)) continue;
    for (const slug of evidenceSlugs) {
      if (isClassBackedByEvidenceSlug(cls, slug)) {
        backed.add(cls);
        break;
      }
    }
  }
  return backed;
}

function validatePreviewCssReuse(rootDir, uiKitFiles) {
  const warnings = [];
  const failures = [];
  const previewClasses = collectPreviewClasses(rootDir);
  if (previewClasses.size === 0) return { failures, warnings };
  const evidenceSlugs = loadEvidenceComponentSlugs(rootDir);

  // Check each UIKit file
  for (const filePath of uiKitFiles) {
    if (!exists(filePath)) continue;
    const content = readText(filePath);
    // Union of <style>-defined classes and classes referenced in markup/JSX.
    // React-CDN UIKits consume component classes via className without redefining them in <style>.
    const uiKitClasses = collectCssClassNames(content);
    for (const cls of collectMarkupClassNames(content)) {
      uiKitClasses.add(cls);
    }
    if (uiKitClasses.size === 0) continue;

    // Compute overlap
    const reused = [...uiKitClasses].filter((cls) => previewClasses.has(cls));
    const componentPreviewClasses = [...previewClasses].filter((cls) => COMPONENT_CLASS_KEYWORDS.test(cls));
    const reuseBase = componentPreviewClasses.length > 0 ? componentPreviewClasses.length : previewClasses.size;
    const reusedComponentClasses = reused.filter((cls) => COMPONENT_CLASS_KEYWORDS.test(cls));
    const overlapRate = reuseBase > 0 ? reusedComponentClasses.length / reuseBase : 1;

    // Detect invented component-level classes
    const evidenceBackedClasses = collectEvidenceBackedClasses(uiKitClasses, evidenceSlugs);
    const inventedClasses = [...uiKitClasses].filter(
      (cls) => COMPONENT_CLASS_KEYWORDS.test(cls) && !previewClasses.has(cls) && !evidenceBackedClasses.has(cls)
    );

    if (overlapRate < 0.5 || inventedClasses.length > 0) {
      const previewList = componentPreviewClasses.length > 0
        ? componentPreviewClasses.slice(0, 8).map((c) => `.${c}`).join(', ')
        : [...previewClasses].slice(0, 8).map((c) => `.${c}`).join(', ');
      const reusedList = reusedComponentClasses.slice(0, 5).map((c) => `.${c}`).join(', ') || '(none)';
      const inventedList = inventedClasses.slice(0, 5).map((c) => `.${c}`).join(', ');
      const parts = [];
      if (overlapRate < 0.5) {
        parts.push(`preview defines [${previewList}] but UIKit only reuses [${reusedList}] (${Math.round(overlapRate * 100)}% overlap)`);
      }
      if (inventedClasses.length > 0) {
        parts.push(`invented component classes: [${inventedList}]`);
      }
      // Advisory only: reuse measurement is heuristic (static scan of <style> + markup/JSX
      // class references) and must not block delivery.
      const item = {
        gate: 'preview-css-reuse',
        file: rel(rootDir, filePath),
        reason: parts.join('. '),
      };
      warnings.push(item);
    }
  }

  return { failures, warnings };
}

function hasEvidenceContracts(rootDir) {
  return exists(path.join(rootDir, 'components', '_evidence', 'index.json'));
}

function validateUiKitPlanUsage(rootDir, files, uikitPlanPath, options = {}) {
  const failures = [];
  const warnings = [];
  const strict = Boolean(options.requireUiKitPlan || uikitPlanPath) && hasEvidenceContracts(rootDir);
  if (!uikitPlanPath) {
    return { failures, warnings };
  }

  const absolutePlanPath = path.resolve(uikitPlanPath);
  if (!exists(absolutePlanPath)) {
    const item = {
      gate: 'uikit-plan',
      file: rel(rootDir, absolutePlanPath),
      reason: 'uikit plan file missing; component usage cannot be checked',
    };
    if (strict) failures.push(item);
    else warnings.push({ ...item, reason: `${item.reason}; skipped component usage check` });
    return { failures, warnings };
  }

  let plan;
  try {
    plan = JSON.parse(readText(absolutePlanPath));
  } catch (error) {
    failures.push({ gate: 'uikit-plan', file: rel(rootDir, absolutePlanPath), reason: `failed to parse uikit plan: ${error.message}` });
    return { failures, warnings };
  }

  const allowed = new Set(Array.isArray(plan.allowedComponents) ? plan.allowedComponents : []);
  if (allowed.size === 0) {
    const item = {
      gate: 'uikit-plan',
      file: rel(rootDir, absolutePlanPath),
      reason: 'allowedComponents is empty; component whitelist is invalid',
    };
    if (strict) failures.push(item);
    else warnings.push({ ...item, reason: `${item.reason}; skipped component usage check` });
    return { failures, warnings };
  }

  let evidenceSlugs = new Set();
  if (strict) {
    const evidenceIndexPath = path.join(rootDir, 'components', '_evidence', 'index.json');
    let evidenceIndex;
    try {
      evidenceIndex = JSON.parse(readText(evidenceIndexPath));
    } catch (error) {
      failures.push({
        gate: 'uikit-plan',
        file: rel(rootDir, evidenceIndexPath),
        reason: `failed to parse evidence index for uikit plan validation: ${error.message}`,
      });
      return { failures, warnings };
    }

    evidenceSlugs = new Set(
      (Array.isArray(evidenceIndex.components) ? evidenceIndex.components : [])
        .map((component) => component?.slug)
        .filter(Boolean),
    );
    const unknownAllowed = [...allowed].filter((slug) => !evidenceSlugs.has(slug));
    if (unknownAllowed.length > 0) {
      failures.push({
        gate: 'uikit-plan',
        file: rel(rootDir, absolutePlanPath),
        reason: `allowedComponents not found in evidence index: ${unknownAllowed.join(', ')}`,
      });
    }
  }
  const componentUsageAllowed = new Set([...allowed, ...evidenceSlugs]);

  for (const filePath of files) {
    if (!exists(filePath)) continue;
    const content = readText(filePath);
    const used = [...new Set([...content.matchAll(/data-component=["']([^"']+)["']/g)].map((match) => match[1]))];
    if (used.length === 0) {
      const item = {
        gate: 'uikit-plan',
        file: rel(rootDir, filePath),
        reason: 'no data-component markers found; component whitelist check could not verify usage',
      };
      if (strict) failures.push(item);
      else warnings.push(item);
      continue;
    }
    const disallowed = used.filter((slug) => !componentUsageAllowed.has(slug));
    if (disallowed.length > 0) {
      failures.push({
        gate: 'uikit-plan',
        file: rel(rootDir, filePath),
        reason: `data-component values not found in uikit plan or evidence index: ${disallowed.join(', ')}`,
      });
    }
  }

  return { failures, warnings };
}

function validateDocsFiles(rootDir, files) {
  const failures = [];

  for (const filePath of files) {
    const basename = path.basename(filePath);
    if (basename !== 'SKILL.md' && basename !== 'README.md') {
      continue;
    }
    if (!exists(filePath)) {
      failures.push({ gate: 'structure', file: rel(rootDir, filePath), reason: 'missing file' });
    }
  }

  return failures;
}

function validateJsonStructure(rootDir) {
  const failures = [];
  const jsonFailures = [];
  const componentSlugMismatches = [];
  const warnings = [];
  const cssJsonPath = path.join(rootDir, 'css.json');
  const componentIndexPath = path.join(rootDir, 'components', 'index.json');
  const componentDir = path.join(rootDir, 'components');

  if (!exists(cssJsonPath)) {
    failures.push({ gate: 'structure', file: 'css.json', reason: 'missing file' });
  } else {
    const cssJson = parseJson(cssJsonPath, jsonFailures, rootDir);
    if (cssJson) {
      for (const key of REQUIRED_CSS_JSON_KEYS) {
        if (!(key in cssJson)) {
          jsonFailures.push({ file: 'css.json', reason: `missing top-level key: ${key}` });
        } else if (typeof cssJson[key] !== 'object' || cssJson[key] === null || Array.isArray(cssJson[key])) {
          jsonFailures.push({ file: 'css.json', reason: `top-level key "${key}" must be a JSON object` });
        }
      }

      // Color non-empty validation: at least one color group must have entries
      if (cssJson.color && typeof cssJson.color === 'object') {
        const totalColorEntries = Object.values(cssJson.color).reduce((sum, group) => {
          return sum + (typeof group === 'object' && group !== null ? Object.keys(group).length : 0);
        }, 0);
        if (totalColorEntries === 0) {
          jsonFailures.push({ file: 'css.json', reason: 'color section is empty — all color groups have 0 entries. LLM likely output non-hex color formats (oklch/hsl) that css-to-json.mjs cannot parse' });
        }

        // Color grouping quality: if >10 color tokens exist, must have ≥2 groups (excluding 'dark')
        const lightGroups = Object.keys(cssJson.color).filter(k => k !== 'dark');
        if (totalColorEntries > 10 && lightGroups.length < 2) {
          jsonFailures.push({
            file: 'css.json',
            reason: `color section has ${totalColorEntries} tokens but only ${lightGroups.length} group(s): [${lightGroups.join(', ')}]. Expected ≥2 semantic groups (bg/text/accent/chart/sidebar/etc). Likely css-to-json.mjs was not run or CSS lacks grouping comments.`,
          });
        }

        // Color grouping quality: no single-token groups (each group must have ≥2 tokens)
        for (const [groupName, group] of Object.entries(cssJson.color)) {
          if (groupName === 'dark') continue;
          if (typeof group !== 'object' || group === null) continue;
          const groupTokenCount = Object.keys(group).length;
          if (groupTokenCount === 1) {
            warnings.push({
              gate: 'color-grouping',
              file: 'css.json',
              reason: `color group "${groupName}" has only 1 token — single-color groups indicate poor classification. Merge into a related group.`,
            });
          }
        }

        // Color grouping balance: no single group should hold >60% of all tokens
        if (totalColorEntries > 6) {
          for (const [groupName, group] of Object.entries(cssJson.color)) {
            if (groupName === 'dark') continue;
            if (typeof group !== 'object' || group === null) continue;
            const groupTokenCount = Object.keys(group).length;
            if (groupTokenCount / totalColorEntries > 0.6) {
              warnings.push({
                gate: 'color-grouping',
                file: 'css.json',
                reason: `color group "${groupName}" holds ${groupTokenCount}/${totalColorEntries} tokens (${Math.round(groupTokenCount / totalColorEntries * 100)}%) — likely indicates grouping failure. Colors should be distributed across semantic groups.`,
              });
            }
          }
        }

        // Multi-hue group detection: a group should contain only one color scale
        // and not mix scales with semantic tokens
        for (const [groupName, group] of Object.entries(cssJson.color)) {
          if (groupName === 'dark') continue;
          if (typeof group !== 'object' || group === null) continue;
          const scalePrefixes = new Map();
          let nonScaleCount = 0;
          for (const tokenName of Object.keys(group)) {
            const match = tokenName.match(/^(.+)-(\d+)$/);
            if (match) {
              const prefix = match[1];
              if (!scalePrefixes.has(prefix)) scalePrefixes.set(prefix, 0);
              scalePrefixes.set(prefix, scalePrefixes.get(prefix) + 1);
            } else {
              nonScaleCount++;
            }
          }
          const significantScales = [...scalePrefixes.entries()].filter(([, count]) => count >= 3);
          if (significantScales.length >= 2) {
            const scaleNames = significantScales.map(([p]) => p).join(', ');
            warnings.push({
              gate: 'color-grouping',
              file: 'css.json',
              reason: `color group "${groupName}" contains ${significantScales.length} distinct color scales (${scaleNames}) — each hue family should be its own group.`,
            });
          } else if (significantScales.length === 1 && nonScaleCount > 0) {
            warnings.push({
              gate: 'color-grouping',
              file: 'css.json',
              reason: `color group "${groupName}" mixes a color scale (${significantScales[0][0]}) with ${nonScaleCount} non-scale tokens — scales should be separated from semantic aliases.`,
            });
          }
          // Check scale size: each group should have ≤10 scale tokens
          for (const [prefix, count] of scalePrefixes.entries()) {
            if (count > 10) {
              warnings.push({
                gate: 'color-grouping',
                file: 'css.json',
                reason: `color group "${groupName}" has ${count} scale tokens for prefix "${prefix}" — maximum 10 per scale. Consider reducing to standard stops (50,100,200,...,900).`,
              });
            }
          }
        }

        // Brand prefix detection: token names should not carry brand prefix
        if (cssJson.color && typeof cssJson.color === 'object') {
          const allColorTokens = [];
          for (const [gn, group] of Object.entries(cssJson.color)) {
            if (gn === 'dark' || typeof group !== 'object' || group === null) continue;
            allColorTokens.push(...Object.keys(group));
          }
          // Detect repeated prefix pattern: if >40% of tokens share a non-semantic prefix
          if (allColorTokens.length > 10) {
            const prefixMap = new Map();
            const semanticRoots = new Set(['primary','secondary','neutral','gray','grey','success','warning','error','danger','info','blue','red','green','yellow','orange','purple','cyan','pink','teal','text','bg','surface','border']);
            for (const name of allColorTokens) {
              const parts = name.split('-');
              if (parts.length >= 2 && !semanticRoots.has(parts[0]) && semanticRoots.has(parts[1])) {
                prefixMap.set(parts[0], (prefixMap.get(parts[0]) || 0) + 1);
              }
            }
            for (const [prefix, count] of prefixMap.entries()) {
              if (count / allColorTokens.length > 0.4) {
                warnings.push({
                  gate: 'color-naming',
                  file: 'css.json',
                  reason: `${count}/${allColorTokens.length} color tokens carry brand prefix "${prefix}-" — brand prefixes should be stripped from token names.`,
                });
              }
            }
          }
        }
      }

      // Color value schema: every leaf must be { hex: string, opacity: string }
      if (cssJson.color && typeof cssJson.color === 'object') {
        for (const [groupName, group] of Object.entries(cssJson.color)) {
          if (typeof group !== 'object' || group === null) continue;
          for (const [tokenName, tokenValue] of Object.entries(group)) {
            if (typeof tokenValue !== 'object' || tokenValue === null) {
              jsonFailures.push({
                file: 'css.json',
                reason: `color.${groupName}.${tokenName} is "${typeof tokenValue}" — expected { hex, opacity } object. css-to-json.mjs was likely not run.`,
              });
              break;
            }
            if (typeof tokenValue.hex !== 'string' || typeof tokenValue.opacity !== 'string') {
              jsonFailures.push({
                file: 'css.json',
                reason: `color.${groupName}.${tokenName} missing hex/opacity fields — expected { hex: "#rrggbb", opacity: "0-1" }. css-to-json.mjs was likely not run.`,
              });
              break;
            }
          }
        }
      }

      // Shadow value schema: every entry must be either:
      //   Single layer: { xOffset, yOffset, blur, spread, color: { hex, opacity } }
      //   Multi-layer:  { layers: [ { xOffset, yOffset, blur, spread, color: { hex, opacity } }, ... ] }
      if (cssJson.shadow && typeof cssJson.shadow === 'object') {
        function validateShadowLayer(layer, path) {
          if (typeof layer.xOffset !== 'string' || typeof layer.yOffset !== 'string' ||
              typeof layer.blur !== 'string' || typeof layer.spread !== 'string') {
            jsonFailures.push({
              file: 'css.json',
              reason: `${path} missing xOffset/yOffset/blur/spread fields. css-to-json.mjs was likely not run.`,
            });
            return false;
          }
          if (!layer.color || typeof layer.color.hex !== 'string' || typeof layer.color.opacity !== 'string') {
            jsonFailures.push({
              file: 'css.json',
              reason: `${path}.color missing hex/opacity fields. css-to-json.mjs was likely not run.`,
            });
            return false;
          }
          return true;
        }

        for (const [tokenName, tokenValue] of Object.entries(cssJson.shadow)) {
          if (typeof tokenValue !== 'object' || tokenValue === null) {
            jsonFailures.push({
              file: 'css.json',
              reason: `shadow.${tokenName} is "${typeof tokenValue}" — expected structured shadow object. css-to-json.mjs was likely not run.`,
            });
            break;
          }
          // Multi-layer shadow: { layers: [...] }
          if (Array.isArray(tokenValue.layers)) {
            for (let i = 0; i < tokenValue.layers.length; i++) {
              if (!validateShadowLayer(tokenValue.layers[i], `shadow.${tokenName}.layers[${i}]`)) break;
            }
          } else {
            // Single-layer shadow: direct fields
            validateShadowLayer(tokenValue, `shadow.${tokenName}`);
          }
        }
      }

      // Unit validation: spacing, size, radius, font.size must use px
      function checkPxUnit(obj, section) {
        if (!obj || typeof obj !== 'object') return;
        for (const [key, value] of Object.entries(obj)) {
          if (typeof value !== 'string') continue;
          if (value.startsWith('var(')) continue;
          if (value.includes('rem')) {
            jsonFailures.push({ file: 'css.json', reason: `${section} token "${key}" uses rem instead of px` });
          } else if (/^[0-9]*\.?[0-9]+$/.test(value)) {
            jsonFailures.push({ file: 'css.json', reason: `${section} token "${key}" value "${value}" missing px suffix` });
          }
        }
      }

      checkPxUnit(cssJson.spacing, 'spacing');
      checkPxUnit(cssJson.size, 'size');
      checkPxUnit(cssJson.radius, 'radius');
      checkPxUnit(cssJson.font?.size, 'font.size');

      // Cross-key validation: spacing must not contain size-* tokens
      if (cssJson.spacing) {
        for (const key of Object.keys(cssJson.spacing)) {
          if (key.startsWith('size-')) {
            jsonFailures.push({ file: 'css.json', reason: `spacing contains non-spacing token "${key}" (should be in size)` });
          }
        }
      }

      // Cross-key validation: size must not contain space-* tokens
      if (cssJson.size) {
        for (const key of Object.keys(cssJson.size)) {
          if (key.startsWith('space-')) {
            jsonFailures.push({ file: 'css.json', reason: `size contains spacing token "${key}" (should be in spacing)` });
          }
        }
      }

      // Numeric token dedup & ascending order validation
      function checkNumericOrder(obj, sectionName) {
        if (!obj || typeof obj !== 'object') return;
        const numericValues = [];
        for (const [key, value] of Object.entries(obj)) {
          if (typeof value !== 'string') continue;
          if (value.startsWith('var(')) continue;
          const num = parseFloat(value);
          if (!isNaN(num)) numericValues.push(num);
        }
        // Check for duplicates
        const unique = [...new Set(numericValues)];
        if (unique.length < numericValues.length) {
          warnings.push({ gate: 'token-quality', file: 'css.json', reason: `${sectionName} has duplicate numeric values` });
        }
        // Check ascending order
        for (let i = 1; i < numericValues.length; i++) {
          if (numericValues[i] < numericValues[i - 1]) {
            warnings.push({ gate: 'token-quality', file: 'css.json', reason: `${sectionName} values are not in ascending order` });
            break;
          }
        }
      }

      checkNumericOrder(cssJson.spacing, 'spacing');
      checkNumericOrder(cssJson.radius, 'radius');
      checkNumericOrder(cssJson.size, 'size');

      // Non-empty checks: spacing/radius/shadow should have tokens if source data exists
      if (cssJson.spacing && Object.keys(cssJson.spacing).length === 0) {
        warnings.push({ gate: 'token-completeness', file: 'css.json', reason: 'spacing section is empty — source may have been ignored' });
      }
      if (cssJson.radius && Object.keys(cssJson.radius).length === 0) {
        warnings.push({ gate: 'token-completeness', file: 'css.json', reason: 'radius section is empty — source may have been ignored' });
      }
      if (cssJson.shadow && Object.keys(cssJson.shadow).length === 0) {
        warnings.push({ gate: 'token-completeness', file: 'css.json', reason: 'shadow section is empty — source may have been ignored' });
      }

      // Font assets integrity: check that custom font files referenced by font.assets actually exist
      if (cssJson.font && cssJson.font.assets && typeof cssJson.font.assets === 'object') {
        for (const [name, rawAsset] of Object.entries(cssJson.font.assets)) {
          const asset = typeof rawAsset === 'string' ? {} : rawAsset;
          if (!asset || typeof asset !== 'object') {
            continue;
          }
          if (asset.source === 'custom' && asset.zipPath) {
            const fontFilePath = path.join(rootDir, asset.zipPath);
            if (!exists(fontFilePath)) {
              warnings.push({ gate: 'font-integrity', file: asset.zipPath, reason: `font.assets["${name}"] references missing file` });
            }
          }
        }
      }
    }
  }

  if (!exists(componentIndexPath)) {
    if (!exists(componentDir)) {
      // No components directory at all — token-only library, downgrade to warning
      warnings.push({ gate: 'structure', file: 'components/index.json', reason: 'missing file (no components directory — token-only library)' });
    } else {
      failures.push({ gate: 'structure', file: 'components/index.json', reason: 'missing file' });
    }
  } else {
    const indexJson = parseJson(componentIndexPath, jsonFailures, rootDir);
    if (indexJson) {
      const components = Array.isArray(indexJson.components) ? indexJson.components : [];
      if (!Array.isArray(indexJson.components)) {
        jsonFailures.push({ file: 'components/index.json', reason: 'components must be an array' });
      }
      for (const component of components) {
        if (!component?.slug) {
          componentSlugMismatches.push({ file: 'components/index.json', reason: 'component entry missing slug' });
          continue;
        }
        const componentPath = path.join(componentDir, `${component.slug}.json`);
        if (!exists(componentPath)) {
          componentSlugMismatches.push({
            file: `components/${component.slug}.json`,
            reason: 'missing component file listed in index',
          });
          continue;
        }
        const componentJson = parseJson(componentPath, jsonFailures, rootDir);
        if (componentJson?.slug !== component.slug) {
          componentSlugMismatches.push({
            file: `components/${component.slug}.json`,
            reason: `slug field mismatch: ${componentJson?.slug ?? '<missing>'}`,
          });
        }
      }

      const actualComponentFiles = walkFiles(componentDir, (filePath) => {
        return filePath.endsWith('.json') &&
          path.basename(filePath) !== 'index.json' &&
          !rel(componentDir, filePath).startsWith('_evidence/');
      });
      const expectedSlugs = new Set(components.map((component) => component?.slug).filter(Boolean));
      for (const componentPath of actualComponentFiles) {
        const slug = path.basename(componentPath, '.json');
        if (!expectedSlugs.has(slug)) {
          componentSlugMismatches.push({
            file: rel(rootDir, componentPath),
            reason: 'component file not listed in components/index.json',
          });
        }
      }
    }
  }

  const evidenceIndexPath = path.join(componentDir, '_evidence', 'index.json');
  if (exists(componentDir) && !exists(evidenceIndexPath)) {
    const uikitPlanPath = path.join(rootDir, 'uikit-plan.json');
    const consumptionPath = path.join(rootDir, 'library-consumption.json');
    const expectsEvidence = exists(uikitPlanPath) || (
      exists(consumptionPath) && readText(consumptionPath).includes('components/_evidence/index.json')
    );
    warnings.push({
      gate: 'component-evidence',
      file: 'components/_evidence/index.json',
      reason: expectsEvidence
        ? 'compact component evidence missing though library metadata references evidence; evidence-backed consumers must downgrade to legacy-json contract with lower confidence'
        : 'compact component evidence missing; legacy/non-Figma consumers may use components/{slug}.json as the component contract',
    });
  } else if (exists(evidenceIndexPath)) {
    const evidenceIndex = parseJson(evidenceIndexPath, jsonFailures, rootDir);
    const evidenceComponents = Array.isArray(evidenceIndex?.components) ? evidenceIndex.components : [];
    for (const component of evidenceComponents) {
      if (!component?.slug) {
        jsonFailures.push({ file: 'components/_evidence/index.json', reason: 'evidence component entry missing slug' });
        continue;
      }
      const evidencePath = path.join(componentDir, '_evidence', `${component.slug}.json`);
      if (!exists(evidencePath)) {
        jsonFailures.push({ file: `components/_evidence/${component.slug}.json`, reason: 'missing evidence file listed in evidence index' });
        continue;
      }

    }
  }

  return { failures, jsonFailures, componentSlugMismatches, warnings };
}

function collectCssDefinitions(cssContent) {
  const definitions = new Map();
  for (const match of cssContent.matchAll(new RegExp(`--([${CSS_VAR_NAME}]+)\\s*:\\s*([^;]+);`, 'g'))) {
    definitions.set(match[1], match[2].replace(/\/\*.*?\*\//g, '').trim());
  }
  return definitions;
}

function normalizeColor(value) {
  if (!value || typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, '');
  const shortHex = trimmed.match(/^#([0-9a-f]{3})$/);
  if (shortHex) {
    return `#${shortHex[1].split('').map((char) => `${char}${char}`).join('')}`;
  }
  const hexAlpha = trimmed.match(/^#([0-9a-f]{8})$/);
  if (hexAlpha) {
    const hex = hexAlpha[1];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const alpha = Number((parseInt(hex.slice(6, 8), 16) / 255).toFixed(3));
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return trimmed;
}

function resolveCssValue(name, definitions, seen = new Set()) {
  if (seen.has(name)) return undefined;
  seen.add(name);
  const value = definitions.get(name);
  if (!value) return undefined;
  const varMatch = value.match(new RegExp(`^var\\(\\s*--([${CSS_VAR_NAME}]+)`));
  if (varMatch) return resolveCssValue(varMatch[1], definitions, seen) || value;
  return value;
}

function tokenValue(token) {
  return token?.value || token?.light || token?.dark;
}

function validateTokenProvenance(rootDir, cssContent, tokenInputPath) {
  const failures = [];
  const warnings = [];
  if (!tokenInputPath) return { failures, warnings, stats: { checked: false } };

  const absoluteTokenInputPath = path.resolve(tokenInputPath);
  if (!exists(absoluteTokenInputPath)) {
    warnings.push({ gate: 'token-provenance', file: rel(rootDir, absoluteTokenInputPath), reason: 'token input file missing; skipped provenance validation' });
    return { failures, warnings, stats: { checked: false } };
  }

  let tokens;
  try {
    tokens = JSON.parse(readText(absoluteTokenInputPath));
  } catch (error) {
    failures.push({ gate: 'token-provenance', file: rel(rootDir, absoluteTokenInputPath), reason: `token input parse failed: ${error.message}` });
    return { failures, warnings, stats: { checked: true } };
  }

  const qualityStatus = tokens.themeSignals?.quality?.status;
  if (qualityStatus === 'fail') {
    warnings.push({ gate: 'token-provenance', file: 'colors_and_type.css', reason: 'token input quality.status is fail; validating generated CSS in degraded token mode' });
  }

  const resolved = Array.isArray(tokens.colors?.resolvedSemanticColors)
    ? tokens.colors.resolvedSemanticColors
    : [];
  const byRole = new Map(resolved.map((entry) => [entry.role, entry]));
  const definitions = collectCssDefinitions(cssContent);
  const roleAliases = {
    'brand.primary': ['primary', 'color-primary'],
    'bg.default': ['background', 'color-surface'],
    'text.default': ['foreground'],
    'border.default': ['border', 'color-border'],
  };
  let criticalResolved = 0;
  let criticalMatched = 0;

  for (const [role, aliases] of Object.entries(roleAliases)) {
    const expected = normalizeColor(tokenValue(byRole.get(role)));
    if (!expected) continue;
    criticalResolved += 1;
    const matched = aliases.some((alias) => normalizeColor(resolveCssValue(alias, definitions)) === expected);
    if (matched) {
      criticalMatched += 1;
    } else {
      failures.push({
        gate: 'token-provenance',
        file: 'colors_and_type.css',
        reason: `core aliases [${aliases.join(', ')}] do not match resolvedSemanticColors role ${role} (${expected})`,
      });
    }
  }

  const brand = normalizeColor(tokenValue(byRole.get('brand.primary')));
  const statusPrimary = normalizeColor(tokenValue(byRole.get('status.primary')));
  const cssPrimary = normalizeColor(resolveCssValue('primary', definitions));
  if (brand && statusPrimary && cssPrimary === statusPrimary && cssPrimary !== brand) {
    failures.push({
      gate: 'token-provenance',
      file: 'colors_and_type.css',
      reason: '--primary matches status.primary instead of brand.primary',
    });
  }

  const sourceComments = (cssContent.match(/\/\*\s*Source:/g) || []).length;
  if (resolved.length > 0 && sourceComments === 0) {
    warnings.push({ gate: 'token-provenance', file: 'colors_and_type.css', reason: 'resolvedSemanticColors exists but CSS has no /* Source: ... */ provenance comments' });
  }

  if (criticalResolved > 0 && criticalMatched === 0) {
    failures.push({ gate: 'token-provenance', file: 'colors_and_type.css', reason: 'all critical resolved semantic colors were lost in CSS core aliases' });
  }

  return {
    failures,
    warnings,
    stats: {
      checked: true,
      resolvedSemanticColors: resolved.length,
      criticalResolved,
      criticalMatched,
      sourceComments,
    },
  };
}

function loadCssJson(rootDir) {
  const cssJsonPath = path.join(rootDir, 'css.json');
  if (!exists(cssJsonPath)) return undefined;
  try {
    return JSON.parse(readText(cssJsonPath));
  } catch {
    return undefined;
  }
}

function collectTokenValues(cssJson, cssContent) {
  const values = new Map();
  const definitions = collectCssDefinitions(cssContent);
  for (const name of definitions.keys()) {
    values.set(name, normalizeColor(resolveCssValue(name, definitions)) || resolveCssValue(name, definitions));
  }

  function visit(node, key) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.hex === 'string') values.set(key, normalizeColor(node.hex));
    if (typeof node.value === 'string') values.set(key, normalizeColor(node.value) || node.value.trim().toLowerCase());
    if (typeof node.light === 'string') values.set(key, normalizeColor(node.light) || node.light.trim().toLowerCase());
    if (typeof node.dark === 'string') values.set(key, normalizeColor(node.dark) || node.dark.trim().toLowerCase());
    for (const [childKey, childValue] of Object.entries(node)) {
      if (childValue && typeof childValue === 'object') visit(childValue, childKey);
      else if (typeof childValue === 'string') values.set(childKey, normalizeColor(childValue) || childValue.trim().toLowerCase());
    }
  }

  visit(cssJson, '');
  return values;
}

function slugFromPreviewPath(rootDir, filePath) {
  const relativePath = rel(rootDir, filePath);
  const match = relativePath.match(/^preview\/component-(.+)\.html$/);
  return match?.[1];
}

function normalizeMetric(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}px`;
  const text = String(value).trim();
  if (/^[0-9]+(?:\.[0-9]+)?$/.test(text)) return `${text}px`;
  return text.toLowerCase();
}

function extractHex(value) {
  if (typeof value !== 'string') return undefined;
  return value.match(/#[0-9a-fA-F]{3,8}/)?.[0];
}

// Per-content derived-data cache: evidence fidelity checks call
// valueAppearsInHtmlOrToken once per expected value against the same file
// content. Precomputing compactContent + usedVariables per content avoids
// O(expected values × file size) repeated full-text scans. Behavior-identical.
const CONTENT_SCAN_CACHE = new Map();

function contentScanData(content) {
  let data = CONTENT_SCAN_CACHE.get(content);
  if (!data) {
    data = {
      compactContent: content.toLowerCase().replace(/\s+/g, ''),
      usedVariables: [...new Set(collectVarUsages(content))],
    };
    CONTENT_SCAN_CACHE.set(content, data);
  }
  return data;
}

function contentUsesTokenWithValue(content, expected, tokenValues) {
  const normalizedExpected = normalizeColor(expected) || normalizeMetric(expected);
  if (!normalizedExpected) return false;
  const { usedVariables } = contentScanData(content);
  return usedVariables.some((name) => tokenValues.get(name) === normalizedExpected);
}

function valueAppearsInHtmlOrToken(content, expectedValue, tokenValues) {
  const rawValue = typeof expectedValue === 'string' ? extractHex(expectedValue) || expectedValue : expectedValue;
  const normalized = normalizeColor(rawValue) || normalizeMetric(rawValue);
  if (!normalized) return true;
  const { compactContent } = contentScanData(content);
  if (compactContent.includes(String(normalized).toLowerCase().replace(/\s+/g, ''))) return true;
  return contentUsesTokenWithValue(content, rawValue, tokenValues);
}

function selectedSizeNames(evidence) {
  if (evidence?.contractKind === 'llm-render-facts') {
    const sizes = evidence.renderFacts?.controlMatrix?.sizes;
    if (Array.isArray(sizes) && sizes.length > 0) {
      return new Set(sizes.flatMap((size) => [size?.name, size?.sampleName]).filter(Boolean).map((value) => String(value).toLowerCase()));
    }
  }
  const samples = Array.isArray(evidence?.renderFacts?.samples)
    ? evidence.renderFacts.samples
    : (Array.isArray(evidence?.renderPlan?.samples) ? evidence.renderPlan.samples : []);
  const names = samples
    .filter((sample) => sample?.role === 'size')
    .flatMap((sample) => [sample.name, sample.label, sample.value, sample.axisValue, sample.sampleName])
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return new Set(names);
}

function isSelectedSize(sizeName, selectedNames) {
  if (selectedNames.size === 0) return false;
  const normalized = String(sizeName).toLowerCase();
  for (const selected of selectedNames) {
    if (selected === normalized || selected.includes(normalized) || normalized.includes(selected)) return true;
  }
  return false;
}

function collectVisualSpecRadii(visualSpecs) {
  const radii = new Set();
  for (const spec of [visualSpecs?.primary, ...Object.values(visualSpecs?.sizes || {}), ...Object.values(visualSpecs?.variants || {})]) {
    const radius = spec?.container?.radius ?? spec?.radius;
    if (radius !== undefined && radius !== null) radii.add(normalizeMetric(radius));
  }
  return radii;
}

function isSupportedEvidenceContract(evidence) {
  return (evidence?.schemaVersion === 2 && evidence?.contractKind === 'render-contract') ||
    (evidence?.contractKind === 'llm-render-facts' && Number(evidence?.schemaVersion) >= 4);
}

function isV6RenderFacts(evidence) {
  return evidence?.contractKind === 'llm-render-facts' && Number(evidence?.schemaVersion) >= 6 && evidence?.renderFacts;
}

function controlMatrixSizeEntries(evidence) {
  const matrix = evidence?.renderFacts?.controlMatrix;
  if (!matrix || typeof matrix !== 'object') return [];
  if (Array.isArray(matrix.sizes)) return matrix.sizes;
  return Object.values(matrix.Size || matrix.size || {}).map((entry) => ({ ...entry }));
}

function controlMatrixStateEntries(evidence) {
  const matrix = evidence?.renderFacts?.controlMatrix;
  if (!matrix || typeof matrix !== 'object') return [];
  if (Array.isArray(matrix.states)) return matrix.states;
  return Object.entries(matrix.State || matrix.state || {}).map(([name, entry]) => ({ name, ...entry }));
}

function collectEvidenceRadii(evidence, visualSpecs) {
  if (isV6RenderFacts(evidence)) {
    const radii = new Set();
    const geometry = evidence.renderFacts.geometry || {};
    for (const radius of [geometry.radius, ...(geometry.borderRadii || [])].flat()) {
      if (radius !== undefined && radius !== null) radii.add(normalizeMetric(radius));
    }
    for (const size of controlMatrixSizeEntries(evidence)) {
      if (size?.radius !== undefined && size?.radius !== null) radii.add(normalizeMetric(size.radius));
    }
    return radii;
  }
  if (evidence?.contractKind === 'llm-render-facts') {
    return new Set((evidence.renderFacts?.fidelity?.requiredGeometry?.radii || []).map((radius) => normalizeMetric(radius)));
  }
  return collectVisualSpecRadii(visualSpecs);
}

function evidenceHasShadow(evidence, visualSpecs) {
  if (isV6RenderFacts(evidence)) {
    return evidence.renderFacts?.geometry?.hasEffects === true;
  }
  if (evidence?.contractKind === 'llm-render-facts') {
    return evidence.renderFacts?.fidelity?.requiredGeometry?.hasEffects === true;
  }
  return /shadow|effect/i.test(JSON.stringify(visualSpecs || {}));
}

function borderRadiusMatchesEvidence(content, radii, tokenValues) {
  const declarations = [...content.matchAll(/border-radius\s*:\s*([^;{}]+)/gi)].map((match) => match[1]);
  if (radii.size === 0) return true;
  if (declarations.length === 0) return false;
  return declarations.some((declaration) => {
    for (const radius of radii) {
      if (declaration.toLowerCase().replace(/\s+/g, '').includes(radius.replace(/\s+/g, ''))) return true;
    }
    const token = declaration.match(new RegExp(`var\\(\\s*--([${CSS_VAR_NAME}]+)`))?.[1];
    return token ? radii.has(tokenValues.get(token)) : false;
  });
}

function validatePreviewEvidenceFidelity(rootDir, previewFiles, cssContent) {
  const failures = [];
  if (previewFiles.length === 0) return failures;
  const cssJson = loadCssJson(rootDir);
  const tokenValues = collectTokenValues(cssJson, cssContent);

  for (const filePath of previewFiles) {
    if (!exists(filePath)) continue;
    const slug = slugFromPreviewPath(rootDir, filePath);
    if (!slug) continue;
    const evidencePath = path.join(rootDir, 'components', '_evidence', `${slug}.json`);
    if (!exists(evidencePath)) continue;

    const evidence = readOptionalJson(evidencePath);
      if (!isSupportedEvidenceContract(evidence)) continue;
    const visualSpecs = evidence.visualSpecs || {};
    const fidelity = evidence.renderFacts?.fidelity || {};
    const content = readText(filePath);
    const relativePath = rel(rootDir, filePath);

    const selectedNames = selectedSizeNames(evidence);
    for (const [sizeName, spec] of Object.entries(visualSpecs.sizes || {})) {
      if (!isSelectedSize(sizeName, selectedNames)) continue;
      const height = spec?.box?.height;
      if (height !== undefined && !valueAppearsInHtmlOrToken(content, height, tokenValues)) {
          failures.push({ gate: 'preview-evidence-fidelity', file: relativePath, reason: `missing evidence size height for ${sizeName}: ${height}px` });
      }
      const padding = spec?.container?.padding;
      const paddingParts = typeof padding === 'string' ? [...new Set(padding.split('/').filter(Boolean))] : [];
      const missingPadding = paddingParts.filter((part) => !valueAppearsInHtmlOrToken(content, part, tokenValues));
      if (paddingParts.length > 0 && missingPadding.length === paddingParts.length) {
          failures.push({ gate: 'preview-evidence-fidelity', file: relativePath, reason: `missing evidence padding for ${sizeName}: ${padding}` });
      }
    }
      for (const size of controlMatrixSizeEntries(evidence)) {
        const sizeName = size?.name || size?.sampleName || 'size';
        const height = size?.height ?? size?.rowHeight ?? size?.trackHeight;
        if (height !== undefined && !valueAppearsInHtmlOrToken(content, height, tokenValues)) {
          failures.push({ gate: 'preview-evidence-fidelity', file: relativePath, reason: `missing evidence size height for ${sizeName}: ${height}px` });
        }
        const padding = size?.padding ?? size?.cellPadding;
        const paddingParts = typeof padding === 'string' ? [...new Set(padding.split('/').filter(Boolean))] : [];
        const missingPadding = paddingParts.filter((part) => !valueAppearsInHtmlOrToken(content, part, tokenValues));
        if (paddingParts.length > 0 && missingPadding.length === paddingParts.length) {
          failures.push({ gate: 'preview-evidence-fidelity', file: relativePath, reason: `missing evidence padding for ${sizeName}: ${padding}` });
        }
      }
    for (const height of fidelity.requiredGeometry?.heights || []) {
      if (!valueAppearsInHtmlOrToken(content, height, tokenValues)) {
          failures.push({ gate: 'preview-evidence-fidelity', file: relativePath, reason: `missing evidence required height: ${height}px` });
      }
    }
    for (const padding of fidelity.requiredGeometry?.paddings || []) {
      const paddingParts = typeof padding === 'string' ? [...new Set(padding.split('/').filter(Boolean))] : [];
      const missingPadding = paddingParts.filter((part) => !valueAppearsInHtmlOrToken(content, part, tokenValues));
      if (paddingParts.length > 0 && missingPadding.length === paddingParts.length) {
          failures.push({ gate: 'preview-evidence-fidelity', file: relativePath, reason: `missing evidence required padding: ${padding}` });
      }
    }

    for (const [stateName, stateSpec] of Object.entries(visualSpecs.states || {})) {
      const delta = stateSpec?.delta || {};
      for (const prop of ['background', 'border', 'color']) {
        const expectedColor = extractHex(delta[prop]);
        if (!expectedColor) continue;
        if (!valueAppearsInHtmlOrToken(content, expectedColor, tokenValues)) {
          const hasBrightnessFallback = /filter\s*:\s*brightness|opacity\s*:\s*\.[0-9]/i.test(content);
            failures.push({
            gate: 'preview-evidence-fidelity',
            file: relativePath,
            reason: `missing evidence ${stateName}.${prop} color ${expectedColor}${hasBrightnessFallback ? '; generic filter/opacity fallback is not enough' : ''}`,
          });
        }
      }
    }
    for (const delta of fidelity.requiredStateDeltas || []) {
      const expectedColor = extractHex(delta.value);
      if (!expectedColor) continue;
      if (!valueAppearsInHtmlOrToken(content, expectedColor, tokenValues)) {
        const hasBrightnessFallback = /filter\s*:\s*brightness|opacity\s*:\s*\.[0-9]/i.test(content);
          failures.push({
          gate: 'preview-evidence-fidelity',
          file: relativePath,
          reason: `missing evidence ${delta.state}.${delta.property} color ${expectedColor}${hasBrightnessFallback ? '; generic filter/opacity fallback is not enough' : ''}`,
        });
      }
    }
      for (const state of controlMatrixStateEntries(evidence)) {
        const stateName = state?.name || 'state';
        for (const [prop, expected] of Object.entries({
          background: state?.background ?? state?.trackBackground ?? state?.rowBackground,
          border: state?.border,
          color: state?.color,
        })) {
          const expectedColor = extractHex(expected);
          if (!expectedColor) continue;
          if (!valueAppearsInHtmlOrToken(content, expectedColor, tokenValues)) {
            const hasBrightnessFallback = /filter\s*:\s*brightness|opacity\s*:\s*\.[0-9]/i.test(content);
            failures.push({
              gate: 'preview-evidence-fidelity',
              file: relativePath,
              reason: `missing evidence ${stateName}.${prop} color ${expectedColor}${hasBrightnessFallback ? '; generic filter/opacity fallback is not enough' : ''}`,
            });
          }
        }
      }

    if (!evidenceHasShadow(evidence, visualSpecs) && /box-shadow\s*:/i.test(content)) {
        failures.push({ gate: 'preview-evidence-fidelity', file: relativePath, reason: 'box-shadow is present but evidence has no shadow/effects' });
    }

    const radii = collectEvidenceRadii(evidence, visualSpecs);
    if (!borderRadiusMatchesEvidence(content, radii, tokenValues)) {
        failures.push({ gate: 'preview-evidence-fidelity', file: relativePath, reason: `border-radius does not match evidence values: ${[...radii].join(', ')}` });
    }
  }

  return failures;
}

/**
 * 校验 UIKit quality-report.json（phase-4-ui-kit.md Rule 24 的 validator contract 兜底）：
 * 存在性 + schema + 硬要求 + 与 index.html 实测 data-component 的交叉校验。
 */
function validateUiKitQualityReport(rootDir, uiKitFiles, uikitPlan) {
  const failures = [];
  const warnings = [];
  for (const htmlPath of uiKitFiles) {
    if (!exists(htmlPath)) continue;
    const reportPath = path.join(path.dirname(htmlPath), 'quality-report.json');
    const relReport = rel(rootDir, reportPath);
    if (!exists(reportPath)) {
      failures.push({ gate: 'uikit-quality-report', file: relReport, reason: 'missing quality-report.json next to index.html' });
      continue;
    }
    let report;
    try {
      report = JSON.parse(readText(reportPath));
    } catch (error) {
      failures.push({ gate: 'uikit-quality-report', file: relReport, reason: `invalid JSON: ${error.message}` });
      continue;
    }
    if (!Number.isFinite(report.screensGenerated) || report.screensGenerated < 2) {
      failures.push({ gate: 'uikit-quality-report', file: relReport, reason: 'screensGenerated must be a number >= 2' });
    }
    if (!Array.isArray(report.inventedComponents) || report.inventedComponents.length > 0) {
      failures.push({ gate: 'uikit-quality-report', file: relReport, reason: 'inventedComponents must be an empty array' });
    }
    if (Number.isFinite(report.previewClassReuseRate) && report.previewClassReuseRate < 0.5) {
      warnings.push({ gate: 'uikit-quality-report', file: relReport, reason: `previewClassReuseRate ${report.previewClassReuseRate} < 0.5 (self-reported)` });
    }
    // 交叉校验：core slug 必须真实出现在 index.html 的 data-component 中
    const htmlContent = readText(htmlPath);
    const usedSlugs = new Set([...htmlContent.matchAll(/data-component=["']([^"']+)["']/g)].map((m) => m[1]));
    const coreSlugs = (uikitPlan?.corePreviewComponents ?? []).map((c) => c?.slug).filter(Boolean);
    const missingCore = coreSlugs.filter((slug) => !usedSlugs.has(slug));
    if (coreSlugs.length > 0 && missingCore.length > 0) {
      warnings.push({ gate: 'uikit-quality-report', file: relReport, reason: `core components missing from index.html data-component: ${missingCore.join(', ')}` });
    }
    const reportedCore = Array.isArray(report.coreComponentsUsed) ? report.coreComponentsUsed : [];
    const phantomReported = reportedCore.filter((slug) => !usedSlugs.has(slug));
    if (phantomReported.length > 0) {
      failures.push({ gate: 'uikit-quality-report', file: relReport, reason: `coreComponentsUsed reports slugs not present in index.html: ${phantomReported.join(', ')}` });
    }
    // 新增交互态/主行动/mock 密度契约（advisory：字段缺失为 warning，便于旧版渐进）
    if (!Array.isArray(report.interactiveStatesRendered)) {
      warnings.push({ gate: 'uikit-quality-report', file: relReport, reason: 'missing interactiveStatesRendered (expected per HARD RULE 8c)' });
    } else {
      const states = report.interactiveStatesRendered.map((s) => String(s).toLowerCase());
      if (!states.includes('hover') || !states.includes('disabled') || !(states.includes('selected') || states.includes('active'))) {
        failures.push({ gate: 'uikit-quality-report', file: relReport, reason: 'interactiveStatesRendered must include hover, disabled, and selected/active' });
      }
    }
    if (report.primaryActionPerScreen === false) {
      failures.push({ gate: 'uikit-quality-report', file: relReport, reason: 'primaryActionPerScreen must be true (single primary action per view)' });
    } else if (report.primaryActionPerScreen === undefined) {
      warnings.push({ gate: 'uikit-quality-report', file: relReport, reason: 'missing primaryActionPerScreen (expected per HARD RULE 8b)' });
    }
    if (report.mockDataDensity && typeof report.mockDataDensity === 'object') {
      const { tableRows, chartPoints } = report.mockDataDensity;
      if (Number.isFinite(tableRows) && tableRows > 0 && tableRows < 6) {
        warnings.push({ gate: 'uikit-quality-report', file: relReport, reason: `mockDataDensity.tableRows ${tableRows} < 6` });
      }
      if (Number.isFinite(chartPoints) && chartPoints > 0 && chartPoints < 12) {
        warnings.push({ gate: 'uikit-quality-report', file: relReport, reason: `mockDataDensity.chartPoints ${chartPoints} < 12` });
      }
    }
  }
  return { failures, warnings };
}

export function validateDesignLibraryOutput(rootDir, options = {}) {
  READ_TEXT_CACHE.clear();
  CONTENT_SCAN_CACHE.clear();
  const start = Date.now();
  const phase = options.phase || 'all';
  const explicitFiles = options.files || [];
  const warnings = [];
  const failures = [];
  const jsonFailures = [];
  const componentSlugMismatches = [];
  const root = path.resolve(rootDir);
  const cssPath = path.join(root, 'colors_and_type.css');
  const cssContent = exists(cssPath) ? readText(cssPath) : '';
  const cssVariables = collectCssVariables(cssContent);

  if (!exists(cssPath)) {
    failures.push({ gate: 'structure', file: 'colors_and_type.css', reason: 'missing file' });
  } else if (phase === 'all') {
    if (!/:root\s*\{/.test(cssContent)) {
      failures.push({ gate: 'css', file: 'colors_and_type.css', reason: 'missing :root block' });
    }
    if (!/\.dark\s*\{/.test(cssContent)) {
      // Check if this is a dark-only or light-only library via CSS comment marker (no .dark block needed)
      const isDarkOnly = /\/\*\s*@dark-only\s*\*\//.test(cssContent);
      const isLightOnly = /\/\*\s*@light-only\s*\*\//.test(cssContent);
      if (!isDarkOnly && !isLightOnly) {
        failures.push({ gate: 'css', file: 'colors_and_type.css', reason: 'missing .dark block' });
      }
    }
  }

  const phaseFiles = collectPhaseFiles(root, phase, explicitFiles);
  const htmlFiles = phaseFiles.filter((filePath) => filePath.endsWith('.html'));
  const previewFiles = phaseFiles.filter((filePath) => rel(root, filePath).startsWith('preview/') && filePath.endsWith('.html'));
  const uiKitFiles = phaseFiles.filter((filePath) => rel(root, filePath).startsWith('ui_kits/') && filePath.endsWith('.html'));

  const undefinedCssVars = validateCssVars(root, htmlFiles, cssVariables);
  const localCssVarDeclarations = validateLocalCssVarDeclarations(root, htmlFiles);
  const placeholderHits = [];
  // Scan UI Kit + Preview HTML for Figma master-component placeholder text leakage
  const KNOWN_PLACEHOLDERS = [
    'Button text', 'Badge text', 'Label text', 'Placeholder text',
    'Input text', 'Helper text', 'Link text',
  ];
  const placeholderScanTargets = [...uiKitFiles, ...previewFiles];
  for (const file of placeholderScanTargets) {
    if (!exists(file)) continue; // --files 指定但尚未写出的文件由 validatePreviewFiles 报 missing file
    const content = fs.readFileSync(file, 'utf-8');
    for (const ph of KNOWN_PLACEHOLDERS) {
      const escaped = ph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`>\\s*${escaped}\\s*<`, 'gi');
      const matches = content.match(regex);
      if (matches) {
        placeholderHits.push({
          gate: 'placeholder-leakage',
          file: rel(root, file),
          reason: `"${ph}" appears ${matches.length}x — should be substituted with contextual text`,
        });
      }
    }
  }
  // Placeholder leakage is advisory (warning), not a hard failure
  warnings.push(...placeholderHits);
  const previewLinkFailures = validatePreviewFiles(root, previewFiles);
  const localImageRefFailures = validateLocalImageRefs(root, htmlFiles);
  if (phase === 'all' || phase === 'preview') {
    failures.push(...validatePreviewEvidenceFidelity(root, previewFiles, cssContent));
  }
  const { uiKitFailures, warnings: uiKitWarnings } = validateUiKitFiles(root, uiKitFiles);
  warnings.push(...uiKitWarnings);
  const previewCssReuse = validatePreviewCssReuse(root, uiKitFiles);
  failures.push(...previewCssReuse.failures);
  warnings.push(...previewCssReuse.warnings);
  const defaultUiKitPlan = path.join(root, 'uikit-plan.json');
  const resolvedUiKitPlan = options.uikitPlan || (options.requireUiKitPlan ? defaultUiKitPlan : undefined);
  const uikitPlanUsage = validateUiKitPlanUsage(root, uiKitFiles, resolvedUiKitPlan, {
    requireUiKitPlan: options.requireUiKitPlan,
  });
  failures.push(...uikitPlanUsage.failures);
  warnings.push(...uikitPlanUsage.warnings);
  if ((phase === 'all' || phase === 'uikit') && uiKitFiles.length > 0) {
    const uikitPlanData = readOptionalJson(resolvedUiKitPlan || defaultUiKitPlan);
    const qualityReport = validateUiKitQualityReport(root, uiKitFiles, uikitPlanData);
    failures.push(...qualityReport.failures);
    warnings.push(...qualityReport.warnings);
  }
  const docsFailures = [];

  if (phase === 'docs') {
    docsFailures.push(...validateDocsFiles(root, phaseFiles));
    failures.push(...docsFailures);
  }

  if (phase === 'all') {
    const jsonResult = validateJsonStructure(root);
    failures.push(...jsonResult.failures);
    jsonFailures.push(...jsonResult.jsonFailures);
    componentSlugMismatches.push(...jsonResult.componentSlugMismatches);
    if (jsonResult.warnings) {
      warnings.push(...jsonResult.warnings);
    }
  }

  const tokenProvenance = phase === 'all'
    ? validateTokenProvenance(root, cssContent, options.tokenInput)
    : { failures: [], warnings: [], stats: { checked: false } };
  failures.push(...tokenProvenance.failures);
  warnings.push(...tokenProvenance.warnings);

  if (phase === 'all') {
    for (const file of ['SKILL.md', 'README.md']) {
      if (!exists(path.join(root, file))) {
        failures.push({ gate: 'structure', file, reason: 'missing file' });
      }
    }
  }

  // components.css existence check: warn when components exist but components.css is missing
  if (phase === 'all') {
    const componentIndexPath = path.join(root, 'components', 'index.json');
    const componentsCssPath = path.join(root, 'components.css');
    if (exists(componentIndexPath) && !exists(componentsCssPath)) {
      warnings.push({ gate: 'structure', file: 'components.css', reason: 'components/index.json exists but components.css is missing — run extract-components-css.mjs' });
    }
    if (exists(componentsCssPath)) {
      const componentsCssContent = readText(componentsCssPath);
      // Validate no hardcoded hex colors (same rule as preview CSS)
      const hardcodedColors = [...componentsCssContent.matchAll(/(?:^|[;{,\s])(?:color|background(?:-color)?|border(?:-color)?|outline-color|box-shadow)\s*:\s*#[0-9a-fA-F]{3,8}/gm)];
      if (hardcodedColors.length > 5) {
        warnings.push({ gate: 'css', file: 'components.css', reason: `${hardcodedColors.length} hardcoded color values found — prefer CSS variables` });
      }
      // Validate var() references against colors_and_type.css
      const componentVarUsages = collectVarUsages(componentsCssContent);
      const undefinedComponentVars = componentVarUsages.filter((v) => !cssVariables.has(v));
      if (undefinedComponentVars.length > 0) {
        warnings.push({ gate: 'css', file: 'components.css', reason: `${undefinedComponentVars.length} undefined CSS variable(s): ${undefinedComponentVars.slice(0, 5).map(v => '--' + v).join(', ')}` });
      }
      // Check for @component-css-start markers in preview files
      for (const pf of previewFiles) {
        const pfContent = readText(pf);
        if (!pfContent.includes('@component-css-start')) {
          warnings.push({ gate: 'preview-markers', file: rel(root, pf), reason: 'missing /* @component-css-start */ marker — extract-components-css.mjs used heuristic fallback' });
        }
      }
    }
  }

  // Icon SVG integrity check: warn if assets/icons/ exists but contains no SVGs,
  // or if evidence/index.json mentions icon usage but the directory is missing.
  if (phase === 'all') {
    const iconsDir = path.join(root, 'assets', 'icons');

    if (exists(iconsDir)) {
      const svgs = fs.readdirSync(iconsDir).filter((f) => f.endsWith('.svg'));
      if (svgs.length === 0) {
        warnings.push({ gate: 'icons', file: 'assets/icons/', reason: 'icons directory exists but contains no SVG files' });
      }
    } else {
      // Check if evidence/index.json mentions icon usage
      const evidenceIndexPath = path.join(root, 'components', '_evidence', 'index.json');
      const evidenceIndex = readOptionalJson(evidenceIndexPath);
      const hasIconUsage = Array.isArray(evidenceIndex?.components) &&
        evidenceIndex.components.some((c) => /icon/i.test(c?.slug || ''));
      if (hasIconUsage) {
        warnings.push({ gate: 'icons', file: 'assets/icons/', reason: 'evidence index references icon components but assets/icons/ directory is missing' });
      }
    }
  }

  const filesScanned = new Set([cssPath, ...phaseFiles.filter(exists)]);
  const bytesScanned = [...filesScanned].reduce((total, filePath) => total + statSize(filePath), 0);
  const elapsedMs = Date.now() - start;
  const ok =
    failures.length === 0 &&
    jsonFailures.length === 0 &&
    undefinedCssVars.length === 0 &&
    localCssVarDeclarations.length === 0 &&
    previewLinkFailures.length === 0 &&
    localImageRefFailures.length === 0 &&
    uiKitFailures.length === 0 &&
    componentSlugMismatches.length === 0;

  return {
    ok,
    phase,
    checkedFiles: [...filesScanned].map((filePath) => rel(root, filePath)),
    stats: {
      cssVariables: cssVariables.size,
      htmlFiles: htmlFiles.length,
      undefinedCssVarFiles: undefinedCssVars.length,
      localCssVarDeclarationFiles: localCssVarDeclarations.length,
      placeholderHits: placeholderHits.length,
      jsonFailures: jsonFailures.length,
      previewLinkFailures: previewLinkFailures.length,
      localImageRefFailures: localImageRefFailures.length,
      uiKitFailures: uiKitFailures.length,
      componentSlugMismatches: componentSlugMismatches.length,
      docsFailures: docsFailures.length,
      tokenProvenanceFailures: tokenProvenance.failures.length,
      tokenProvenance: tokenProvenance.stats,
      filesScanned: filesScanned.size,
      bytesScanned,
      elapsedMs,
    },
    failures,
    undefinedCssVars,
    localCssVarDeclarations,
    placeholderHits,
    previewLinkFailures,
    localImageRefFailures,
    jsonFailures,
    uiKitFailures,
    docsFailures,
    componentSlugMismatches,
    warnings,
    tokenProvenanceFailures: tokenProvenance.failures,
    elapsedMs,
  };
}

function parseArgs(argv) {
  const args = {
    outputDir: undefined,
    phase: 'all',
    files: [],
    tmpDir: undefined,
    tokenInput: undefined,
    uikitPlan: undefined,
    requireUiKitPlan: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--phase') {
      args.phase = argv[index + 1] || 'all';
      index += 1;
    } else if (arg === '--files') {
      args.files = parseCsv(argv[index + 1]);
      index += 1;
    } else if (arg === '--tmp-dir') {
      args.tmpDir = argv[index + 1];
      index += 1;
    } else if (arg === '--token-input') {
      args.tokenInput = argv[index + 1];
      index += 1;
    } else if (arg === '--uikit-plan') {
      args.uikitPlan = argv[index + 1];
      index += 1;
    } else if (arg === '--require-uikit-plan') {
      args.requireUiKitPlan = true;
    } else if (!arg.startsWith('--') && !args.outputDir) {
      args.outputDir = arg;
    }
  }

  return args;
}

function runCli() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.outputDir) {
    console.error('Usage: check-design-library-phase.mjs <output_dir> --phase <preview|uikit|docs|all> [--files file1,file2] [--tmp-dir path] [--uikit-plan path] [--require-uikit-plan]');
    process.exit(2);
  }

  const rootDir = path.resolve(args.outputDir);
  if (!exists(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    console.error(`Output directory does not exist: ${rootDir}`);
    process.exit(2);
  }

  const summary = validateDesignLibraryOutput(rootDir, {
    phase: args.phase,
    files: args.files,
    tmpDir: args.tmpDir,
    tokenInput: args.tokenInput,
    uikitPlan: args.uikitPlan,
    requireUiKitPlan: args.requireUiKitPlan,
  });
  console.log(JSON.stringify(summary, undefined, 2));
  process.exit(summary.ok ? 0 : 1);
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  runCli();
}
