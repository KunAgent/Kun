#!/usr/bin/env node

/**
 * extract-components-css.mjs
 *
 * Extracts component CSS from preview/component-*.html files and aggregates
 * into a single {output_dir}/components.css file.
 *
 * Usage:
 *   node extract-components-css.mjs <output_dir>
 *
 * Output:
 *   - Writes {output_dir}/components.css
 *   - stdout: JSON { ok, extractedCount, totalRules, warnings[] }
 *
 * Extraction strategy:
 *   1. Reads all preview/component-*.html files
 *   2. Extracts CSS between /* @component-css-start * / and /* @component-css-end * / markers
 *   3. Extracts representative DOM anatomy from <body> (first .rail or .row content)
 *   4. Validates var(--name) references against colors_and_type.css
 *   5. Outputs aggregated components.css with per-component sections and @anatomy comments
 */

import fs from 'node:fs';
import path from 'node:path';

// ─── Helpers ────────────────────────────────────────────────────────────────

function slugFromFilename(filename) {
  // component-button.html → Button
  const match = filename.match(/^component-(.+)\.html$/i);
  if (!match) return null;
  const slug = match[1];
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-([a-z])/g, (_, c) => ' ' + c.toUpperCase());
}

function rawSlugFromFilename(filename) {
  const match = filename.match(/^component-(.+)\.html$/i);
  return match ? match[1] : null;
}

function extractStyleContent(html) {
  const styleBlocks = [];
  const regex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    styleBlocks.push(match[1]);
  }
  return styleBlocks.join('\n');
}

function extractComponentCSS(styleContent) {
  const startMarker = '/* @component-css-start */';
  const endMarker = '/* @component-css-end */';

  const startIdx = styleContent.indexOf(startMarker);
  const endIdx = styleContent.indexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return styleContent.slice(startIdx + startMarker.length, endIdx).trim();
  }

  // Fallback: no markers — try heuristic extraction
  return null;
}

function extractFallbackCSS(styleContent) {
  // Remove known scaffold classes and return the rest
  const scaffoldSelectors = new Set([
    'body', 'html', '*',
    '.specimen', '.header', '.stage', '.story', '.story-label', '.rail',
    '.row', '.label', '.divider', '.sub', '.pill', '.sample',
    '@media', '@keyframes',
  ]);

  const lines = styleContent.split('\n');
  const componentLines = [];
  let inScaffold = false;
  let braceDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check if this line starts a scaffold rule
    if (braceDepth === 0 && trimmed) {
      const isScaffold = [...scaffoldSelectors].some(sel => {
        if (sel.startsWith('@')) return trimmed.startsWith(sel);
        if (sel === '*') return trimmed.startsWith('*{') || trimmed.startsWith('* {') || trimmed.startsWith('*,');
        return trimmed.startsWith(sel + ' ') || trimmed.startsWith(sel + '{') ||
               trimmed.startsWith(sel + ',') || trimmed === sel + ' {' ||
               trimmed === sel + '{' || trimmed.startsWith(sel + ':');
      });
      if (isScaffold) {
        inScaffold = true;
      }
    }

    // Track brace depth
    for (const ch of trimmed) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
    }

    if (!inScaffold) {
      componentLines.push(line);
    }

    if (inScaffold && braceDepth === 0) {
      inScaffold = false;
    }
  }

  return componentLines.join('\n').trim();
}

function extractAnatomy(html) {
  // Extract first representative component instance from <body>
  // Look for .rail or .row content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return null;

  const body = bodyMatch[1];

  // Try to find first .rail div content
  let anatomyMatch = body.match(/<div\s+class="rail"[^>]*>([\s\S]*?)<\/div>/i);
  if (!anatomyMatch) {
    // Try .row
    anatomyMatch = body.match(/<div\s+class="row"[^>]*>([\s\S]*?)<\/div>/i);
  }
  if (!anatomyMatch) {
    // Try first section/story content
    anatomyMatch = body.match(/<section[^>]*>([\s\S]*?)<\/section>/i);
  }
  if (!anatomyMatch) {
    // Last resort: take first meaningful elements from body (skip wrappers)
    const firstElements = body.match(/<(?:button|input|div|table|nav|ul|select)[^>]*>[\s\S]*?(?:<\/(?:button|input|div|table|nav|ul|select)>)/i);
    if (firstElements) {
      anatomyMatch = [null, firstElements[0]];
    }
  }

  if (!anatomyMatch) return null;

  let anatomy = anatomyMatch[1].trim();

  // Compress: collapse whitespace, limit depth
  anatomy = anatomy
    .replace(/\n\s*/g, '\n   ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Limit to ~5 lines worth of content
  const lines = anatomy.split('\n').slice(0, 8);
  anatomy = lines.join('\n   ');

  // Truncate if too long (max ~400 chars)
  if (anatomy.length > 400) {
    anatomy = anatomy.slice(0, 397) + '...';
  }

  return anatomy;
}

function extractDeclaredVars(cssFilePath) {
  if (!fs.existsSync(cssFilePath)) return new Set();
  const content = fs.readFileSync(cssFilePath, 'utf-8');
  const vars = new Set();
  const regex = /--([\w\u4e00-\u9fff\u3400-\u4dbf-]+)\s*:/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    vars.add('--' + match[1]);
  }
  return vars;
}

function findUsedVars(css) {
  const used = new Set();
  // 与 extractDeclaredVars 对齐：变量名支持 CJK 字符（--碧涛青-1）
  const regex = /var\(\s*(--[\w\u4e00-\u9fff\u3400-\u4dbf-]+)/g;
  let match;
  while ((match = regex.exec(css)) !== null) {
    used.add(match[1]);
  }
  return used;
}

function countCSSRules(css) {
  const matches = css.match(/\{[^}]*\}/g);
  return matches ? matches.length : 0;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  const outputDir = process.argv[2];
  if (!outputDir) {
    console.error('Usage: extract-components-css.mjs <output_dir>');
    process.exit(2);
  }

  const rootDir = path.resolve(outputDir);
  const previewDir = path.join(rootDir, 'preview');
  const cssFilePath = path.join(rootDir, 'colors_and_type.css');
  const outputPath = path.join(rootDir, 'components.css');

  const warnings = [];

  // Check preview directory exists
  if (!fs.existsSync(previewDir) || !fs.statSync(previewDir).isDirectory()) {
    const result = { ok: false, extractedCount: 0, totalRules: 0, warnings: ['preview/ directory not found'] };
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  // Get declared CSS vars for validation
  const declaredVars = extractDeclaredVars(cssFilePath);

  // Find all component-*.html files
  const htmlFiles = fs.readdirSync(previewDir)
    .filter(f => /^component-.+\.html$/i.test(f))
    .sort();

  if (htmlFiles.length === 0) {
    const result = { ok: false, extractedCount: 0, totalRules: 0, warnings: ['No component-*.html files found in preview/'] };
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const sections = [];
  let totalRules = 0;
  let extractedCount = 0;
  const allSelectors = new Map(); // selector → first slug that defined it

  for (const file of htmlFiles) {
    const displayName = slugFromFilename(file);
    const slug = rawSlugFromFilename(file);
    if (!displayName || !slug) continue;

    const filePath = path.join(previewDir, file);
    const html = fs.readFileSync(filePath, 'utf-8');

    // Extract style content
    const styleContent = extractStyleContent(html);
    if (!styleContent) {
      warnings.push({ file, reason: 'No <style> tag found' });
      continue;
    }

    // Extract component CSS (marker-based or fallback)
    let componentCSS = extractComponentCSS(styleContent);
    let usedFallback = false;

    if (componentCSS === null) {
      componentCSS = extractFallbackCSS(styleContent);
      usedFallback = true;
      if (componentCSS) {
        warnings.push({ file, reason: 'Missing @component-css-start/end markers — used heuristic fallback' });
      }
    }

    if (!componentCSS || componentCSS.trim().length === 0) {
      warnings.push({ file, reason: 'No component CSS extracted' });
      continue;
    }

    // Extract DOM anatomy
    const anatomy = extractAnatomy(html);

    // Validate var() references
    const usedVars = findUsedVars(componentCSS);
    for (const v of usedVars) {
      if (declaredVars.size > 0 && !declaredVars.has(v)) {
        warnings.push({ file, reason: `Undefined CSS variable: ${v}` });
      }
    }

    // Check for duplicate selectors
    const selectorRegex = /^([^{@/\n][^{]*)\{/gm;
    let selMatch;
    while ((selMatch = selectorRegex.exec(componentCSS)) !== null) {
      const selector = selMatch[1].trim();
      if (allSelectors.has(selector) && allSelectors.get(selector) !== slug) {
        warnings.push({
          file,
          reason: `Duplicate selector "${selector}" (first defined in component-${allSelectors.get(selector)}.html)`,
        });
      } else {
        allSelectors.set(selector, slug);
      }
    }

    // Count rules
    const ruleCount = countCSSRules(componentCSS);
    totalRules += ruleCount;
    extractedCount++;

    // Build section
    const divider = `/* ${'─'.repeat(2)} ${displayName} ${'─'.repeat(Math.max(2, 56 - displayName.length))} */`;
    let section = divider + '\n';

    if (anatomy) {
      section += '/* @anatomy\n   ' + anatomy + '\n*/\n';
    }

    section += componentCSS;
    sections.push(section);
  }

  // Assemble final output
  const header = `/* ${'═'.repeat(63)}
   components.css — Design System Component Definitions
   Auto-extracted from preview/component-*.html
   DO NOT EDIT MANUALLY — regenerate via extract-components-css.mjs
   ${'═'.repeat(63)} */`;

  const output = header + '\n\n' + sections.join('\n\n') + '\n';

  // Write output
  fs.writeFileSync(outputPath, output, 'utf-8');

  const result = {
    ok: extractedCount > 0,
    extractedCount,
    totalRules,
    outputFile: 'components.css',
    warnings: warnings.map(w => typeof w === 'string' ? w : `${w.file}: ${w.reason}`),
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main();
