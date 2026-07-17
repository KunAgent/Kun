#!/usr/bin/env node

/**
 * Validate an entire design project directory in one pass.
 *
 * Purpose: run a full validation of the design directory before presenting
 *          results to the user after the Agent task is complete.
 *
 * Usage: node scan-design-directory.mjs <design-directory-path> [--expected-pages=<N>] [--require-interactions=domId1:file1.html,domId2:file2.html,...]
 *
 * Arguments:
 *   <design-directory-path>          : root path of the design project (required)
 *   --expected-pages=<N>             : expected total page count (optional; passed to .design validation if provided)
 *   --require-interactions=<entries> : comma-separated list of domId:htmlFile pairs (optional);
 *                                      passed to .design validation to verify each domId exists
 *                                      in the HTML file and is registered in .design interactions
 *
 * Checks:
 *   1. Directory structure (assets/, pages/ present)
 *   2. Discover and validate all .design files (--expected-pages forwarded automatically;
 *      includes cross-version reachability check 18 of validate-design-file.mjs)
 *   3. Validate HTML files in pages/
 *   4. Validate HTML infrastructure (Tailwind / theme-vars / icons)
 *   5. Validate Tailwind @apply rules (no local component class cross-references)
 *   6. Validate no custom <style> blocks in <head> beyond protected infrastructure
 *   7. Validate .theme files in theme/ (optional — no error if absent)
 *   8. Check that assets/ directory exists, and that every image file under
 *      assets/ (.jpg/.jpeg/.png/.gif/.webp/.svg) is registered as a
 *      type:"image" node in at least one .design file (reverse coverage)
 *   9. Validate orchestration-summary.json presence (warning when absent)
 *  10. Validate library-bound custom CSS constraints (when operatingMode=library-bound)
 *  11. Validate HTML quality rules (no hardcoded colors, no secondary/accent vars,
 *      image path validity, free-explore colors_and_type.css hue/radius/shadow rules)
 *  12. Validate WeChat Mini Program chrome rules (when miniProgramStyle is set)
 *  13. Generate a full validation report
 *
 * Exit codes: 0 = passed, 1 = failed
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// script directory (fileURLToPath handles Windows drive letters and percent-encoded paths)
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const VALIDATE_DESIGN_SCRIPT = path.join(SCRIPT_DIR, 'validate-design-file.mjs');

const errors = [];
const warnings = [];

function addError(loc, message) {
  errors.push(`[${loc}] ${message}`);
}

function addWarning(loc, message) {
  warnings.push(`[${loc}] ${message}`);
}

function printSection(title, char = '=') {
  console.log(char.repeat(60));
  console.log(title);
  console.log(char.repeat(60));
}

function validateDirectoryStructure(designDir) {
  console.log('\nChecking directory structure...');

  const expectedDirs = ['assets', 'pages'];
  for (const dir of expectedDirs) {
    const fullPath = path.join(designDir, dir);
    if (!fs.existsSync(fullPath)) {
      addError('directory-structure', `Missing required directory: ${dir}/`);
    } else {
      console.log(`  [OK] ${dir}/ directory found`);
    }
  }
}

function findDesignFiles(designDir) {
  console.log('\nLooking for .design files...');

  const designFiles = [];
  const items = fs.readdirSync(designDir);

  for (const item of items) {
    if (item.endsWith('.design')) {
      designFiles.push(item);
    }
  }

  if (designFiles.length === 0) {
    addError('design-files', 'No .design file found in the root directory');
  } else if (designFiles.length > 1) {
    addWarning('design-files', `Multiple .design files found: ${designFiles.join(', ')} (usually only one expected)`);
  } else {
    console.log(`  [OK] Found ${designFiles.length} .design file: ${designFiles[0]}`);
  }

  return designFiles;
}

function validateDesignFiles(designDir, designFiles, expectedPages, requireInteractions) {
  console.log('\nValidating .design files...');

  for (const designFile of designFiles) {
    const designPath = path.join(designDir, designFile);

    try {
      // delegate to validate-design-file.mjs
      console.log(`  - Validating ${designFile}...`);

      // build command args
      const args = [VALIDATE_DESIGN_SCRIPT, designPath];
      if (expectedPages !== undefined) {
        args.push(`--expected-pages=${expectedPages}`);
      }
      if (requireInteractions) {
        args.push(`--require-interactions=${requireInteractions}`);
      }

      execFileSync('node', args, {
        stdio: ['inherit', 'pipe', 'pipe'],
        encoding: 'utf8'
      });
      console.log(`    [OK] ${designFile} validation passed`);
    } catch (error) {
      const stderr = error.stderr || '';
      addError('design-file', `Validation failed for ${designFile}: ${stderr}`);
    }
  }
}

function validateHtmlFiles(designDir) {
  console.log('\nChecking HTML files...');

  const pagesDir = path.join(designDir, 'pages');

  if (!fs.existsSync(pagesDir)) {
    addError('html-files', 'pages/ directory not found, cannot check HTML files');
    return;
  }

  const htmlFiles = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));

  if (htmlFiles.length === 0) {
    addWarning('html-files', 'No HTML files found in pages/ directory');
  } else {
    console.log(`  [OK] Found ${htmlFiles.length} HTML file(s)`);

    for (const htmlFile of htmlFiles) {
      const htmlPath = path.join(pagesDir, htmlFile);
      try {
        const content = fs.readFileSync(htmlPath, 'utf8');
        // basic length check
        if (content.length < 50) {
          addWarning('html-files', `HTML file seems too short: ${htmlFile}`);
        }
        // check basic structure tags
        if (!content.includes('<html') || !content.includes('<head') || !content.includes('<body')) {
          addError('html-files', `HTML file missing basic structure: ${htmlFile}`);
        } else {
          console.log(`    [OK] ${htmlFile} looks valid`);
        }
      } catch (error) {
        addError('html-files', `Cannot read HTML file ${htmlFile}: ${error.message}`);
      }
    }
  }
}

/**
 * Check that no @layer components class is referenced inside @apply.
 *
 * Tailwind browser runtime only accepts utility classes in @apply.
 * Referencing a locally-defined component class (e.g. `.section-shell { @apply panel-card ... }`)
 * causes "Cannot apply unknown utility class" at compile-time, which silently drops ALL styles on
 * that page — even if every other page is fine.
 *
 * Algorithm:
 *   1. Extract every <style type="text/tailwindcss"> block in the file.
 *   2. Collect all custom class names defined in that block (.foo { ... }).
 *   3. Scan every @apply token; strip variant prefixes (sm:, hover:, etc.).
 *   4. If the base token matches a custom class name → error.
 */
function validateTailwindApplyRules(designDir) {
  console.log('\nChecking Tailwind @apply rules (no local component class cross-references)...');

  const pagesDir = path.join(designDir, 'pages');
  if (!fs.existsSync(pagesDir)) return;

  const htmlFiles = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));
  if (htmlFiles.length === 0) return;

  for (const htmlFile of htmlFiles) {
    const htmlPath = path.join(pagesDir, htmlFile);
    let content;
    try {
      content = fs.readFileSync(htmlPath, 'utf8');
    } catch (e) {
      continue;
    }

    // Extract all <style type="text/tailwindcss"> blocks
    const tailwindStyleRegex = /<style[^>]*type=["']text\/tailwindcss["'][^>]*>([\s\S]*?)<\/style>/gi;
    let styleMatch;

    while ((styleMatch = tailwindStyleRegex.exec(content)) !== null) {
      const styleBlock = styleMatch[1];

      // Step 1: collect custom class names defined in this block (.foo { ... })
      const customClasses = new Set();
      const classDefRegex = /\.([a-zA-Z_][a-zA-Z0-9_-]*)\s*\{/g;
      let classMatch;
      while ((classMatch = classDefRegex.exec(styleBlock)) !== null) {
        customClasses.add(classMatch[1]);
      }
      if (customClasses.size === 0) continue;

      // Step 2: scan all @apply statements and check tokens
      const applyRegex = /@apply\s+([^;}{]+)/g;
      let applyMatch;
      while ((applyMatch = applyRegex.exec(styleBlock)) !== null) {
        const applyValue = applyMatch[1].trim();
        const tokens = applyValue.split(/\s+/).filter(t => t.length > 0);
        for (const token of tokens) {
          // Strip variant prefix (e.g. sm:p-5 → p-5, hover:bg-card → bg-card)
          const baseToken = token.includes(':') ? token.split(':').pop() : token;
          if (customClasses.has(baseToken)) {
            addError(
              'tailwind-apply',
              `${htmlFile}: @apply references local component class ".${baseToken}" — ` +
              `Tailwind will throw "Cannot apply unknown utility class \`${baseToken}\`", ` +
              `causing ALL styles on this page to be dropped. ` +
              `Fix: inline the constituent utilities directly instead of referencing the custom class name.`
            );
          }
        }
      }
    }
  }
}

// Required infrastructure markers in every HTML page.
// Missing any one of these causes styles / icons / theme to break.
const HTML_INFRA_CHECKS = [
  {
    id: 'tailwind-cdn',
    pattern: '@tailwindcss/browser@4',
    desc: 'Tailwind CSS CDN (<script src="...@tailwindcss/browser@4">)',
    consequence: 'all utility classes stop working; page degrades to unstyled HTML',
    owner: 'MAIN-AGENT',
  },
  {
    id: 'theme-vars',
    pattern: 'id="theme-vars"',
    desc: '<style id="theme-vars"> theme CSS variable block',
    consequence: 'all semantic token colors degrade to transparent/default values',
    owner: 'MAIN-AGENT',
  },
  {
    id: 'theme-inline',
    pattern: '@theme inline',
    desc: '@theme inline Tailwind <-> CSS variable bridge block',
    consequence: 'bg-primary, text-foreground and similar classes cannot map to theme colors',
    owner: 'MAIN-AGENT',
  },
  {
    id: 'layer-base',
    pattern: '@layer base',
    desc: '@layer base global base styles',
    consequence: 'body background color, font, table word-break and other base styles are lost',
    owner: 'MAIN-AGENT',
  },
  {
    id: 'lucide-init',
    pattern: 'lucide.createIcons()',
    condition: (html) => html.includes('data-lucide'),
    desc: 'lucide.createIcons() icon init script (required only when data-lucide is used)',
    consequence: 'all <i data-lucide> icons will not render',
    owner: 'SUB-AGENT',
  },
  {
    id: 'theme-class',
    pattern: /\bclass=["'][^"']*\b(?:light|dark)\b[^"']*["']/,
    desc: '<html class="light"> or <html class="dark"> theme mode selector',
    consequence: 'CSS variable selectors do not match; all theme colors stop working',
    owner: 'MAIN-AGENT',
  },
];

function validateHtmlInfrastructure(designDir) {
  console.log('\nChecking HTML infrastructure (Tailwind / theme / icons)...');

  const pagesDir = path.join(designDir, 'pages');
  if (!fs.existsSync(pagesDir)) {
    // pages/ dir absence is already reported by validateHtmlFiles; skip here
    return;
  }

  const htmlFiles = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));
  if (htmlFiles.length === 0) return;

  const summary = loadOrchestrationSummary(designDir);
  // Only library-bound projects may downgrade a missing @theme inline bridge to a warning;
  // free-explore projects rely on the bridge equally, so absence stays an error.
  const hasDesignLibrary = summary?.designSource?.operatingMode === 'library-bound';

  for (const htmlFile of htmlFiles) {
    const htmlPath = path.join(pagesDir, htmlFile);
    let content;
    try {
      content = fs.readFileSync(htmlPath, 'utf8');
    } catch (error) {
      // read failure already reported by validateHtmlFiles; skip
      continue;
    }

    const missing = HTML_INFRA_CHECKS.filter(({ pattern, condition }) => {
      if (condition && !condition(content)) return false;
      return typeof pattern === 'string' ? !content.includes(pattern) : !pattern.test(content);
    });

    if (missing.length === 0) {
      console.log(`    [OK] ${htmlFile} infrastructure complete`);
    } else {
      for (const { id, desc, consequence, owner } of missing) {
        const ownerTag = `[${owner}]`;
        const fixHint = owner === 'MAIN-AGENT'
          ? ` Fix: run fill-html-head.mjs <css-path> ${htmlFile} --replace-head`
          : ` Fix: Sub-Agent must add the missing element using Edit tool`;
        if (id === 'theme-inline' && hasDesignLibrary) {
          addWarning(
            'html-infrastructure',
            `${ownerTag} ${htmlFile} missing ${desc}. Impact: ${consequence} (downgraded to warning — Design Library present)`
          );
        } else {
          addError(
            'html-infrastructure',
            `${ownerTag} ${htmlFile} missing ${desc}. Impact: ${consequence}.${fixHint}`
          );
        }
      }
    }
  }
}

function stripThemeVars(content) {
  return content.replace(/<style[^>]*id=["']theme-vars["'][^>]*>[\s\S]*?<\/style>/gi, '');
}

function detectNonInfrastructureStyleBlocks(html) {
  const styleRegex = /<style[^>]*>[\s\S]*?<\/style>/gi;
  const matches = html.match(styleRegex) || [];

  return matches.filter((block) => {
    if (/id=["']theme-vars["']/i.test(block)) return false;
    if (/id=["']component-vars["']/i.test(block)) return false;
    if (/type=["']text\/tailwindcss["']/i.test(block)) return false;
    if (/\.no-scrollbar/.test(block) || /\[data-icon\]/.test(block)) {
      const inner = block.replace(/<style[^>]*>/i, '').replace(/<\/style>/i, '').trim();
      const stripped = inner
        .replace(/\.no-scrollbar[^}]*\{[^}]*\}/g, '')
        .replace(/\[data-icon\][^}]*\{[^}]*\}/g, '')
        .trim();
      if (stripped.length === 0) return false;
    }
    const inner = block.replace(/<style[^>]*>/i, '').replace(/<\/style>/i, '').trim();
    return inner.length > 0;
  });
}

/**
 * Detect non-infrastructure <style> blocks in <head>.
 * The page contract keeps <head> exclusively managed by fill-html-head.mjs;
 * custom styles must live in <body> so theme replacement stays deterministic.
 */
function detectCustomStylesInHead(headHtml) {
  return detectNonInfrastructureStyleBlocks(headHtml);
}

function validateNoCustomStylesInHead(designDir, operatingMode = 'free-explore') {
  const isFreeExplore = operatingMode !== 'library-bound';
  // In free-explore mode, custom styles in <head> are self-correcting:
  // fill-html-head.mjs --replace-head will destroy them automatically.
  const addStyleIssue = isFreeExplore ? addWarning : addError;
  console.log('\nChecking custom <style> placement in <head>...');

  const pagesDir = path.join(designDir, 'pages');
  if (!fs.existsSync(pagesDir)) return;

  const htmlFiles = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));
  if (htmlFiles.length === 0) return;

  for (const htmlFile of htmlFiles) {
    const htmlPath = path.join(pagesDir, htmlFile);
    let content;
    try {
      content = fs.readFileSync(htmlPath, 'utf8');
    } catch (error) {
      continue;
    }

    const headMatch = content.match(/<head[\s\S]*?<\/head>/i);
    if (!headMatch) continue;

    const customStyles = detectCustomStylesInHead(headMatch[0]);
    if (customStyles.length > 0) {
      addStyleIssue(
        'html-head-style',
        `${htmlFile}: found ${customStyles.length} custom <style> block(s) in <head>. ` +
        `The <head> is owned by fill-html-head.mjs; move custom styles before </body> or re-run ` +
        `fill-html-head.mjs <css-path> <html-file> --replace-head to relocate them.`
      );
    }
  }
}

function validateOrchestrationSummaryPresence(designDir, expectedPages, designFiles) {
  console.log('\nChecking orchestration summary presence...');

  const summaryPath = path.join(designDir, 'orchestration-summary.json');
  if (fs.existsSync(summaryPath)) {
    console.log('  [OK] orchestration-summary.json found');
    return;
  }

  const pagesDir = path.join(designDir, 'pages');
  const htmlFiles = fs.existsSync(pagesDir)
    ? fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'))
    : [];

  if (expectedPages !== undefined && designFiles.length > 0 && htmlFiles.length > 0) {
    addWarning(
      'orchestration-summary',
      'orchestration-summary.json is missing. Canvas validation can still pass, but quality-context checks ' +
      '(operatingMode, visualNorthStar, compositionPattern, continuityAnchors, miniProgramStyle) are degraded.'
    );
  } else {
    console.log('  [OK] orchestration summary not required for this scan context');
  }
}

function validateLibraryBoundCustomCss(designDir) {
  console.log('\nChecking Library-bound custom CSS restrictions...');

  const summary = loadOrchestrationSummary(designDir);
  const operatingMode = summary?.designSource?.operatingMode;
  if (operatingMode !== 'library-bound') {
    console.log('  [OK] Not Library-bound; custom CSS class restriction skipped');
    return;
  }

  const pagesDir = path.join(designDir, 'pages');
  if (!fs.existsSync(pagesDir)) return;

  const htmlFiles = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));
  if (htmlFiles.length === 0) return;

  const classDefinitionPattern = /\.([a-zA-Z_][a-zA-Z0-9_-]*)\s*\{/g;

  for (const htmlFile of htmlFiles) {
    const htmlPath = path.join(pagesDir, htmlFile);
    let content;
    try {
      content = fs.readFileSync(htmlPath, 'utf8');
    } catch (error) {
      continue;
    }

    const customStyleBlocks = detectNonInfrastructureStyleBlocks(content);
    for (const block of customStyleBlocks) {
      const classes = [...block.matchAll(classDefinitionPattern)].map(match => match[1]);
      if (classes.length === 0) continue;

      addWarning(
        'library-bound-css',
        `${htmlFile}: Library-bound mode discourages custom CSS class definitions in <style> blocks ` +
        `(${[...new Set(classes)].slice(0, 8).map(name => `.${name}`).join(', ')}). ` +
        `Prefer Tailwind utilities plus Library brand CSS variables/component JSON instead.`
      );
    }
  }
}

function loadOrchestrationSummary(designDir) {
  const summaryPath = path.join(designDir, 'orchestration-summary.json');
  if (!fs.existsSync(summaryPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  } catch (error) {
    addWarning('orchestration-summary', `Cannot parse orchestration-summary.json: ${error.message}`);
    return null;
  }
}

function readDesignJson(designDir, designFile) {
  const designPath = path.join(designDir, designFile);
  try {
    return JSON.parse(fs.readFileSync(designPath, 'utf8'));
  } catch (error) {
    addWarning('design-library-identity', `Cannot parse ${designFile} for Library identity check: ${error.message}`);
    return null;
  }
}

function validateDesignLibraryIdentityObject(identity, nodePath) {
  const requiredFields = ['name', 'id', 'version', 'scope', 'path', 'versionSource'];
  if (typeof identity !== 'object' || identity === null || Array.isArray(identity)) {
    addError('design-library-identity', `${nodePath} must be an object in Library-bound mode`);
    return false;
  }

  let valid = true;
  for (const field of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(identity, field)) {
      addError('design-library-identity', `${nodePath}.${field} is required; use null when unavailable`);
      valid = false;
      continue;
    }

    const value = identity[field];
    if (field === 'version') {
      if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
        addError('design-library-identity', `${nodePath}.${field} must be a string, number, or null`);
        valid = false;
      }
    } else if (value !== null && typeof value !== 'string') {
      addError('design-library-identity', `${nodePath}.${field} must be a string or null`);
      valid = false;
    }
  }

  return valid;
}

function normalizeIdentityValue(value) {
  return value === undefined || value === null ? null : String(value);
}

function validateLibraryIdentity(designDir, designFiles) {
  console.log('\nChecking Design Library identity...');

  const summary = loadOrchestrationSummary(designDir);
  const operatingMode = summary?.designSource?.operatingMode;
  if (operatingMode !== 'library-bound') {
    console.log('  [OK] Not Library-bound; Library identity check skipped');
    return;
  }

  const summaryIdentity = summary?.designSource?.libraryIdentity;
  const summaryValid = validateDesignLibraryIdentityObject(
    summaryIdentity,
    'orchestration-summary.json.designSource.libraryIdentity'
  );

  if (designFiles.length === 0) {
    addError('design-library-identity', 'Cannot verify .design config.designLibrary because no .design file was found');
    return;
  }

  let checked = 0;
  for (const designFile of designFiles) {
    const designJson = readDesignJson(designDir, designFile);
    const designIdentity = designJson?.config?.designLibrary;
    const designValid = validateDesignLibraryIdentityObject(
      designIdentity,
      `${designFile}.config.designLibrary`
    );
    if (!summaryValid || !designValid) continue;

    for (const field of ['name', 'id', 'version', 'scope', 'path']) {
      const summaryValue = normalizeIdentityValue(summaryIdentity[field]);
      const designValue = normalizeIdentityValue(designIdentity[field]);
      if (summaryValue !== designValue) {
        addError(
          'design-library-identity',
          `${designFile}.config.designLibrary.${field} (${designValue}) must match orchestration-summary.json.designSource.libraryIdentity.${field} (${summaryValue})`
        );
      }
    }
    checked += 1;
  }

  if (checked > 0) {
    console.log(`  [OK] Library identity recorded in ${checked} .design file(s)`);
  }
}

function getAttr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'));
  return match ? match[1] : '';
}

function hasMoreAffordance(html) {
  return /data-lucide=["'](?:more-horizontal|ellipsis)["']/.test(html) || /[···⋯]/.test(html) || /aria-label=["'](?:更多|More)["']/.test(html);
}

function hasCloseAffordance(html) {
  return /data-lucide=["'](?:x|circle-x)["']/.test(html) || /aria-label=["'](?:关闭|Close)["']/.test(html) || /[×✕]/.test(html);
}

function hasCapsuleDivider(html) {
  return /\bw-px\b|\bborder-l\b|\bdivide-x\b/.test(html);
}

function parseCssAlpha(rawAlpha) {
  if (!rawAlpha) return null;
  const trimmed = rawAlpha.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith('%')) return Number(trimmed.slice(0, -1)) / 100;
  return Number(trimmed);
}

function extractShadowAlphas(value) {
  const alphas = [];
  const colorPattern = /\b(rgba?|hsla?)\(([^)]*)\)/gi;
  for (const m of value.matchAll(colorPattern)) {
    const fn = m[1].toLowerCase();
    const body = m[2].trim();
    let alpha = null;

    if (body.includes('/')) {
      alpha = parseCssAlpha(body.split('/').pop());
    } else {
      const parts = body.split(',').map(part => part.trim());
      if ((fn === 'rgba' || fn === 'hsla') && parts.length >= 4) {
        alpha = parseCssAlpha(parts[3]);
      } else {
        alpha = 1;
      }
    }

    if (Number.isFinite(alpha)) alphas.push(alpha);
  }
  return alphas;
}

function isFloatingShadowToken(tokenName) {
  return /(?:float|floating|popover|modal|overlay|drawer|dropdown|tooltip|toast|menu|dialog)/i.test(tokenName)
    || /^--shadow-(?:2|3)$/i.test(tokenName);
}

function validateHtmlQualityRules(designDir, operatingMode = 'free-explore') {
  const isFreeExplore = operatingMode !== 'library-bound';
  // Aesthetic/token-discipline issues: warning in free-explore, error in library-bound.
  // This prevents expensive repair loops for non-functional visual quality issues.
  const addAestheticIssue = isFreeExplore ? addWarning : addError;
  console.log('\nChecking HTML quality rules (tokens / images / CSS delivery)...');

  const pagesDir = path.join(designDir, 'pages');
  const assetsDir = path.join(designDir, 'assets');
  if (!fs.existsSync(pagesDir)) return;

  const htmlFiles = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));
  if (htmlFiles.length === 0) return;

  const brandCssPath = path.join(designDir, 'colors_and_type.css');
  // secondary/accent checks are free-explore only — Library-bound DLs may legitimately define these tokens.
  const shouldCheckFreeExploreBrandCss = isFreeExplore;
  if (fs.existsSync(brandCssPath) && shouldCheckFreeExploreBrandCss) {
    try {
      const brandCss = fs.readFileSync(brandCssPath, 'utf8');
      const forbiddenBrandHuePattern = /--(?:[a-z0-9]+-)?(?:color-)?(?:secondary|accent)(?:-[a-z0-9]+)?\s*:/gi;
      const forbiddenBrandHues = [...brandCss.matchAll(forbiddenBrandHuePattern)].map(m => m[0].replace(/\s*:$/, ''));
      if (forbiddenBrandHues.length > 0) {
        addAestheticIssue(
          'html-quality',
          `colors_and_type.css: free-explore brand CSS must use one primary hue only; forbidden secondary/accent brand variables found (${[...new Set(forbiddenBrandHues)].slice(0, 12).join(', ')}). Use --state-success/warning/error/info only for semantic states.`
        );
      }

      const forbiddenRadiusTokenPattern = /--(?:[a-z0-9]+-)?radius-(?:xl|2xl|3xl|4xl|huge|large)\s*:\s*([^;]+);/gi;
      const forbiddenRadiusTokens = [];
      for (const m of brandCss.matchAll(forbiddenRadiusTokenPattern)) {
        const token = m[0].replace(/\s*:\s*[^;]+;$/, '');
        const value = m[1].trim();
        if (!/^1(?:2|6)px$/.test(value)) {
          forbiddenRadiusTokens.push(`${token}: ${value}`);
        }
      }

      const oversizedRadiusPattern = /--(?:[a-z0-9]+-)?radius-[a-z0-9-]+\s*:\s*(\d+(?:\.\d+)?)px\s*;/gi;
      const oversizedRadiusTokens = [];
      for (const m of brandCss.matchAll(oversizedRadiusPattern)) {
        if (/--(?:[a-z0-9]+-)?radius-(?:full|pill)\s*:/i.test(m[0])) continue;
        const value = Number(m[1]);
        if (value > 16) {
          const token = m[0].replace(/\s*:\s*[^;]+;$/, '');
          oversizedRadiusTokens.push(`${token}: ${value}px`);
        }
      }

      const radiusViolations = [...new Set([...forbiddenRadiusTokens, ...oversizedRadiusTokens])];
      if (radiusViolations.length > 0) {
        addAestheticIssue(
          'html-quality',
          `colors_and_type.css: free-explore radius tokens must stay within the restrained 2/4/8/12/16px scale; oversized or forbidden radius tokens found (${radiusViolations.slice(0, 12).join(', ')}). Do not use 20px+ radii unless the user explicitly requested large rounded shapes.`
        );
      }

      const rootCss = [...brandCss.matchAll(/:root\s*\{([\s\S]*?)\}/g)].map(m => m[1]).join('\n');
      const shadowTokenPattern = /(--[a-z0-9-]*shadow[a-z0-9-]*)\s*:\s*([^;]+);/gi;
      const staticShadowViolations = [];
      for (const m of rootCss.matchAll(shadowTokenPattern)) {
        const tokenName = m[1];
        if (isFloatingShadowToken(tokenName)) continue;
        const value = m[2].trim();
        const overLimit = extractShadowAlphas(value).filter(alpha => alpha > 0.05);
        if (overLimit.length > 0) {
          staticShadowViolations.push(`${tokenName}: ${value}`);
        }
      }

      if (staticShadowViolations.length > 0) {
        addAestheticIssue(
          'html-quality',
          `colors_and_type.css: ordinary/static shadow tokens must keep every shadow alpha <= 0.05; deeper shadows are allowed only for floating-layer tokens such as modal/popover/dropdown/drawer/overlay (${staticShadowViolations.slice(0, 12).join(', ')}).`
        );
      }
    } catch (e) {
      // Other directory/file existence checks report unreadable files elsewhere.
    }
  }

  const namedColorPattern = /\b(?:bg|text|border|from|to|via|ring|divide|outline|decoration|accent|caret|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
  const arbitraryColorPattern = /\b(?:bg|text|border|from|to|via|ring|shadow|fill|stroke)-\[#/;
  const inlineHardcodedColorPattern = /(?:color|background|background-color|border-color|box-shadow)\s*:\s*#[0-9a-fA-F]{3,8}\b/;
  const brandCssLinkPattern = /<link\b[^>]*rel=["']stylesheet["'][^>]*(?:colors_and_type\.css|brand css|theme-vars)[^>]*>/i;
  const imgSrcPattern = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  const forbiddenSecondaryAccentUsagePattern = /var\(\s*--(?:[a-z0-9]+-)?(?:color-)?(?:secondary|accent)(?:-[a-z0-9]+)?\s*\)/i;

  for (const htmlFile of htmlFiles) {
    const htmlPath = path.join(pagesDir, htmlFile);
    let content;
    try {
      content = fs.readFileSync(htmlPath, 'utf8');
    } catch (e) {
      continue;
    }

    const visibleContent = stripThemeVars(content);

    if (brandCssLinkPattern.test(visibleContent)) {
      addError(
        'html-quality',
        `${htmlFile}: brand CSS must be inlined by fill-html-head.mjs; do not use <link rel="stylesheet"> for colors_and_type.css`
      );
    }

    const namedColors = [...visibleContent.matchAll(namedColorPattern)].map(m => m[0]);
    if (namedColors.length > 0) {
      addAestheticIssue(
        'html-quality',
        `${htmlFile}: Tailwind named color utilities are forbidden (${[...new Set(namedColors)].slice(0, 8).join(', ')}). Use brand CSS variables instead.`
      );
    }

    if (arbitraryColorPattern.test(visibleContent) || inlineHardcodedColorPattern.test(visibleContent)) {
      addAestheticIssue(
        'html-quality',
        `${htmlFile}: hardcoded colors are forbidden outside <style id="theme-vars">. Use brand CSS variables from the token reference.`
      );
    }

    if (isFreeExplore && forbiddenSecondaryAccentUsagePattern.test(visibleContent)) {
      addAestheticIssue(
        'html-quality',
        `${htmlFile}: free-explore pages must not use secondary/accent brand variables. Use the single primary hue, neutral tints, or --state-success/warning/error/info for real semantic states.`
      );
    }

    let imgMatch;
    while ((imgMatch = imgSrcPattern.exec(content)) !== null) {
      const src = imgMatch[1].trim();
      if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) {
        addError('html-quality', `${htmlFile}: external/base64 image source is forbidden: ${src}`);
        continue;
      }
      if (!src.startsWith('../assets/')) {
        addError('html-quality', `${htmlFile}: image source must use ../assets/ relative path: ${src}`);
        continue;
      }
      const assetRel = src.slice('../assets/'.length);
      const assetPath = path.join(assetsDir, assetRel);
      if (!fs.existsSync(assetPath)) {
        addError('html-quality', `${htmlFile}: image references missing asset file: ${src}`);
      }
    }
  }
}

function validateMiniProgramChromeRules(designDir, operatingMode = 'free-explore') {
  const isFreeExplore = operatingMode !== 'library-bound';
  console.log('\nChecking mini program chrome rules...');
  const summary = loadOrchestrationSummary(designDir);
  if (!summary || !Array.isArray(summary.pages)) {
    console.log('  [OK] No orchestration summary; mini program chrome check skipped');
    return;
  }

  const pagesDir = path.join(designDir, 'pages');
  if (!fs.existsSync(pagesDir)) return;

  const miniPages = summary.pages.filter((page) => page && page.miniProgramStyle === true && typeof page.htmlSrc === 'string');
  if (miniPages.length === 0) {
    console.log('  [OK] No miniProgramStyle pages');
    return;
  }

  for (const page of miniPages) {
    const htmlFile = path.basename(page.htmlSrc);
    const htmlPath = path.join(pagesDir, htmlFile);
    if (!fs.existsSync(htmlPath)) continue;

    const content = fs.readFileSync(htmlPath, 'utf8');
    const divRegex = /(<div\b[^>]*>)([\s\S]*?)<\/div>/gi;
    let match;
    let foundRightCapsule = false;

    while ((match = divRegex.exec(content)) !== null) {
      const tag = match[1];
      const inner = match[2].trim();
      const cls = getAttr(tag, 'class');
      const hasCapsuleSize = /\bw-\[(?:87|88)px\]/.test(cls) && /\bh-8\b/.test(cls);
      if (!hasCapsuleSize) continue;

      if (/\bopacity-0\b|\bpointer-events-none\b/.test(cls)) {
        addError('mini-program-chrome', `${htmlFile}: mini program right capsule must be visible and functional, not an invisible spacer.`);
        continue;
      }

      foundRightCapsule = true;

      if (inner.length === 0) {
        addError('mini-program-chrome', `${htmlFile}: mini program right capsule is empty. It must contain more and close actions.`);
        continue;
      }
      if (!hasMoreAffordance(inner)) {
        addError('mini-program-chrome', `${htmlFile}: mini program right capsule missing more action.`);
      }
      if (!hasCloseAffordance(inner)) {
        addError('mini-program-chrome', `${htmlFile}: mini program right capsule missing close action.`);
      }
      if (!hasCapsuleDivider(inner)) {
        addError('mini-program-chrome', `${htmlFile}: mini program right capsule missing divider between more and close actions.`);
      }
    }

    if (!foundRightCapsule) {
      addError('mini-program-chrome', `${htmlFile}: miniProgramStyle page must include a visible right system capsule.`);
    }

    if (/w-\[(?:87|88)px\][^"']*(?:var\(--(?:primary|secondary|accent|card)\)|shadow-\[var\(--shadow|shadow-)/.test(content)) {
      addError('mini-program-chrome', `${htmlFile}: mini program system chrome must not use brand surface/color tokens or brand shadows.`);
    }
  }
}

function validateThemeFiles(designDir) {
  console.log('\nChecking theme files...');

  const themeDir = path.join(designDir, 'theme');

  if (!fs.existsSync(themeDir)) {
    console.log('  [OK] No theme files (optional)');
    return;
  }

  const themeFiles = fs.readdirSync(themeDir).filter(f => f.endsWith('.theme'));

  if (themeFiles.length === 0) {
    console.log('  [OK] No theme files (optional)');
  } else {
    console.log(`  [OK] Found ${themeFiles.length} theme file(s)`);

    for (const themeFile of themeFiles) {
      const themePath = path.join(themeDir, themeFile);
      try {
        const content = fs.readFileSync(themePath, 'utf8');
        // parse JSON
        const parsed = JSON.parse(content);

        // basic structure check
        if (!parsed.styles || !parsed.styles.light || !parsed.styles.dark) {
          addWarning('theme-files', `Theme file missing styles.light or styles.dark: ${themeFile}`);
        } else {
          console.log(`    [OK] ${themeFile} looks valid`);
        }
      } catch (error) {
        addWarning('theme-files', `Invalid theme file ${themeFile}: ${error.message}`);
      }
    }
  }
}

function checkAssetsDirectory(designDir, designFiles, operatingMode = 'free-explore') {
  // Assets coverage is a canvas contract (not just visual) — always blocking.
  const addCoverageIssue = addError;
  console.log('\nChecking assets directory...');

  const assetsDir = path.join(designDir, 'assets');

  if (!fs.existsSync(assetsDir)) {
    addWarning('assets', 'assets/ directory not found');
    return;
  }

  const assets = fs.readdirSync(assetsDir);
  console.log(`  [OK] Assets directory found with ${assets.length} item(s)`);

  // Reverse coverage: every image file under assets/ must be registered as an image node in .design
  // Subdirectories (e.g., assets/icons/) are skipped — they contain HTML support assets, not canvas images
  const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg']);
  const imageFiles = assets.filter((name) => {
    const fullPath = path.join(assetsDir, name);
    if (fs.statSync(fullPath).isDirectory()) return false;
    const ext = path.extname(name).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
  });

  if (imageFiles.length === 0) {
    return;
  }

  if (!designFiles || designFiles.length === 0) {
    return;
  }

  // Aggregate registered imageSrc across all .design files
  const registeredImageSrcs = new Set();
  for (const designFile of designFiles) {
    const designPath = path.join(designDir, designFile);
    try {
      const raw = fs.readFileSync(designPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.data)) continue;
      for (const node of parsed.data) {
        if (node && typeof node === 'object' && node.type === 'image' && node.devMetadata && typeof node.devMetadata.imageSrc === 'string') {
          registeredImageSrcs.add(node.devMetadata.imageSrc.replace(/^\.\//, ''));
        }
      }
    } catch {
      // .design parsing errors are already reported by validate-design-file.mjs; skip here
    }
  }

  const unregistered = imageFiles.filter((name) => !registeredImageSrcs.has(`assets/${name}`));
  if (unregistered.length > 0) {
    for (const name of unregistered) {
      addCoverageIssue(
        'assets-coverage',
        `Image file "assets/${name}" exists on disk but is not registered as a type:"image" node in any .design file. ` +
        `Every image asset must have a corresponding image node so it surfaces on the canvas. ` +
        `Fix: append an image node to .design (see workflows/create-project.md Step 2.5d or workflows/edit-project.md Step 2b').`
      );
    }
  } else {
    console.log(`  [OK] All ${imageFiles.length} image asset(s) are registered as image nodes`);
  }
}

function checkIconPathValidity(designDir) {
  const summary = loadOrchestrationSummary(designDir);
  if (summary?.designSource?.operatingMode !== 'library-bound') return;
  if (!summary?.designSource?.iconAssets) return;

  console.log('\nChecking Design Library icon path validity...');

  const pagesDir = path.join(designDir, 'pages');
  if (!fs.existsSync(pagesDir)) return;

  const htmlFiles = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));
  const maskPathRegex = /mask-image:\s*url\(['"]?([^'")\s]+)['"]?\)/g;
  let checkedCount = 0;
  let missingCount = 0;

  for (const htmlFile of htmlFiles) {
    const htmlPath = path.join(pagesDir, htmlFile);
    let content;
    try { content = fs.readFileSync(htmlPath, 'utf8'); } catch { continue; }

    let match;
    while ((match = maskPathRegex.exec(content)) !== null) {
      const iconPath = match[1];
      if (!iconPath.includes('assets/icons/')) continue;
      const resolved = path.resolve(pagesDir, iconPath);
      checkedCount++;
      if (!fs.existsSync(resolved)) {
        missingCount++;
        addWarning(
          'icon-path',
          `${htmlFile}: mask-image references "${iconPath}" but file does not exist. ` +
          `Fix: replace with Lucide fallback or verify icon was copied from Design Library.`
        );
      }
    }
  }

  if (checkedCount > 0 && missingCount === 0) {
    console.log(`  [OK] All ${checkedCount} icon path(s) verified`);
  }
}

function printReport() {
  console.log('\n');

  if (warnings.length > 0) {
    printSection('Warnings', '!');
    warnings.forEach(w => console.log(`  [WARN] ${w}`));
    console.log('\n');
  }

  if (errors.length > 0) {
    printSection('Errors', 'X');
    errors.forEach(e => console.log(`  [FAIL] ${e}`));
    console.log('\n');

    printSection('Validation Failed', '=');
    console.log(`Found ${errors.length} error(s) and ${warnings.length} warning(s).`);
    console.log('\nPlease fix all errors before presenting results to the user.');
    return false;
  } else {
    printSection('Validation Passed', '=');
    console.log('All checks passed!');
    if (warnings.length > 0) {
      console.log(`\nNote: ${warnings.length} warning(s) found, but these are non-blocking.`);
    }
    return true;
  }
}

function main() {
  const args = process.argv.slice(2);

  // parse args
  let designDir = undefined;
  let expectedPages = undefined;
  let requireInteractions = undefined; // raw string, forwarded as-is to validate-design-file.mjs

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--expected-pages=')) {
      const match = arg.match(/^--expected-pages=(\d+)$/);
      if (match) {
        expectedPages = parseInt(match[1], 10);
      }
    } else if (arg.startsWith('--require-interactions=')) {
      const match = arg.match(/^--require-interactions=(.+)$/);
      if (match) {
        requireInteractions = match[1];
      }
    } else {
      designDir = arg;
    }
  }

  if (!designDir) {
    console.error('Usage: node scan-design-directory.mjs <design-directory-path> [--expected-pages=<N>] [--require-interactions=domId1:file1.html,...]');
    process.exit(1);
  }

  designDir = path.resolve(designDir);

  printSection('Design Directory Scan', '=');
  console.log(`Design directory: ${designDir}`);
  if (expectedPages !== undefined) {
    console.log(`Expected pages: ${expectedPages}`);
  }

  if (!fs.existsSync(designDir)) {
    addError('directory', `Design directory not found: ${designDir}`);
    printReport();
    process.exit(1);
  }

  if (!fs.statSync(designDir).isDirectory()) {
    addError('directory', `Path is not a directory: ${designDir}`);
    printReport();
    process.exit(1);
  }

  // run all checks
  validateDirectoryStructure(designDir);
  const designFiles = findDesignFiles(designDir);
  validateDesignFiles(designDir, designFiles, expectedPages, requireInteractions);
  validateHtmlFiles(designDir);
  validateHtmlInfrastructure(designDir);

  // Extract operatingMode for mode-aware checks.
  // free-explore (no Design Library) downgrades aesthetic/token checks to warnings.
  const summary = loadOrchestrationSummary(designDir);
  const operatingMode = summary?.designSource?.operatingMode || 'free-explore';

  validateNoCustomStylesInHead(designDir, operatingMode);
  validateOrchestrationSummaryPresence(designDir, expectedPages, designFiles);
  validateLibraryIdentity(designDir, designFiles);
  validateLibraryBoundCustomCss(designDir);
  validateHtmlQualityRules(designDir, operatingMode);
  validateMiniProgramChromeRules(designDir, operatingMode);
  validateTailwindApplyRules(designDir);
  validateThemeFiles(designDir);
  checkAssetsDirectory(designDir, designFiles, operatingMode);
  checkIconPathValidity(designDir);

  // print report
  const success = printReport();

  process.exit(success ? 0 : 1);
}

main();
