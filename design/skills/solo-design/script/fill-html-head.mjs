/**
 * Generate an HTML page skeleton from a Design Library CSS file,
 * eliminating the token cost of having a sub-Agent hand-fill a template.
 *
 * The CSS content is INLINED into <style id="theme-vars"> (not linked via <link>)
 * because the canvas SDK renders pages in iframe srcdoc mode where external
 * relative paths cannot be resolved.
 *
 * Mode 1 - Generate a new HTML skeleton:
 *   node fill-html-head.mjs <css-file-or-library-dir> <output-html> [--title="Page Title"] [--lang=zh-CN] [--prefix=volcano] [--theme=dark] [--charts]
 *
 * Mode 2 - Replace the <head> in existing HTML (keep <main> content unchanged):
 *   node fill-html-head.mjs <css-file-or-library-dir> <existing-html> --replace-head [--prefix=volcano] [--charts]
 *   Multiple files: node fill-html-head.mjs <css-file-or-library-dir> page1.html page2.html --replace-head
 *   Non-infrastructure custom <style> blocks found in the old <head> are moved
 *   to the end of <body>, keeping <head> owned by this script.
 *
 * Exit codes: 0 = success, 1 = failure
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Build @font-face blocks from css.json font.assets.
 * Only generates for custom fonts (source: 'custom') using relative zipPath.
 * Skips fonts that already have a matching @font-face in the CSS content.
 */
function buildFontFaceFromAssets(cssDir, cssContent) {
  const cssJsonPath = path.join(cssDir, 'css.json');
  if (!fs.existsSync(cssJsonPath)) return '';

  let cssJson;
  try {
    cssJson = JSON.parse(fs.readFileSync(cssJsonPath, 'utf8'));
  } catch (_) {
    return '';
  }

  const assets = cssJson?.font?.assets;
  if (!assets || typeof assets !== 'object') return '';

  const blocks = [];
  for (const [name, rawAsset] of Object.entries(assets)) {
    const asset = typeof rawAsset === 'string' ? { url: rawAsset } : rawAsset;
    if (!asset) continue;

    const family = asset.family || name;

    // Skip if CSS already contains @font-face for this family
    if (cssContent.includes(`font-family: '${family}'`) || cssContent.includes(`font-family: "${family}"`)) {
      continue;
    }

    let src;
    if (asset.source === 'custom' && asset.zipPath) {
      // Custom font: inline as base64 data URI (iframe srcdoc cannot resolve relative paths)
      src = buildFontSrcForCustomAsset(cssDir, asset, name);
      if (!src) continue;
    } else if (asset.url) {
      // Builtin font: use absolute URL
      const format = asset.format || fontFormatFromUrl(asset.url);
      src = `url('${asset.url}')${format ? ` format('${format}')` : ''}`;
    } else {
      continue;
    }

    let descriptor = `  font-family: '${family}';\n  src: ${src};`;
    if (asset.weight) descriptor += `\n  font-weight: ${asset.weight};`;
    if (asset.style) descriptor += `\n  font-style: ${asset.style};`;
    descriptor += `\n  font-display: swap;`;

    blocks.push(`@font-face {\n${descriptor}\n}`);
  }

  return blocks.length > 0 ? blocks.join('\n') + '\n\n' : '';
}

function fontFormatFromUrl(url) {
  if (!url) return '';
  if (url.endsWith('.woff2')) return 'woff2';
  if (url.endsWith('.woff')) return 'woff';
  if (url.endsWith('.ttf')) return 'truetype';
  if (url.endsWith('.otf')) return 'opentype';
  return '';
}

function fontMimeFromFormat(format) {
  return {
    woff2: 'font/woff2',
    woff: 'font/woff',
    truetype: 'font/ttf',
    opentype: 'font/otf',
  }[format] || 'application/octet-stream';
}

function buildFontSrcForCustomAsset(cssDir, asset, name = '') {
  const fontPath = path.resolve(cssDir, asset.zipPath);
  const format = asset.format || fontFormatFromUrl(asset.zipPath);

  if (!fs.existsSync(fontPath)) {
    console.error(`Warning: custom font file not found for "${name || asset.family || 'unknown'}": ${asset.zipPath}`);
    return null;
  }

  const stat = fs.statSync(fontPath);
  if (stat.size > 20 * 1024 * 1024) {
    console.warn(`Warning: font file too large (${(stat.size / 1024 / 1024).toFixed(1)}MB), skipping: ${asset.zipPath}`);
    return null;
  }

  try {
    const data = fs.readFileSync(fontPath).toString('base64');
    return `url('data:${fontMimeFromFormat(format)};base64,${data}')${format ? ` format('${format}')` : ''}`;
  } catch (error) {
    console.error(`Warning: failed to read custom font for "${name || asset.family || 'unknown'}": ${asset.zipPath}`, error.message);
    return null;
  }
}

function parseArgs(argv) {
  const positional = [];
  let title = 'Untitled';
  let lang = 'en';
  let prefix = '';
  let theme = 'light';
  let replaceHead = false;
  let charts = false;

  for (const arg of argv) {
    if (arg.startsWith('--title=')) {
      title = arg.slice('--title='.length);
    } else if (arg.startsWith('--lang=')) {
      lang = arg.slice('--lang='.length);
    } else if (arg.startsWith('--prefix=')) {
      prefix = arg.slice('--prefix='.length);
    } else if (arg.startsWith('--theme=')) {
      theme = arg.slice('--theme='.length);
    } else if (arg === '--replace-head') {
      replaceHead = true;
    } else if (arg === '--charts') {
      charts = true;
    } else {
      positional.push(arg);
    }
  }

  return { positional, title, lang, prefix, theme, replaceHead, charts };
}

function resolveCSSPath(input) {
  const resolved = path.resolve(input);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    const cssPath = path.join(resolved, 'colors_and_type.css');
    if (!fs.existsSync(cssPath)) {
      console.error('Error: colors_and_type.css not found in directory');
      console.error('  Directory:', resolved);
      process.exit(1);
    }
    return cssPath;
  }
  if (!fs.existsSync(resolved)) {
    console.error('Error: CSS file not found');
    console.error('  Path:', resolved);
    process.exit(1);
  }
  return resolved;
}

function detectPrefix(cssContent) {
  const rootMatch = cssContent.match(/:root\s*\{([^}]*)\}/s);
  if (!rootMatch) return null;

  const rootBody = rootMatch[1];
  const allFirstSegments = [...rootBody.matchAll(/--([a-zA-Z][a-zA-Z0-9]*)-/g)].map(m => m[1]);
  if (allFirstSegments.length === 0) return null;

  const semanticPattern = /--([a-zA-Z][a-zA-Z0-9]*)-(?:primary|background|foreground|surface|radius|shadow)/g;
  const semanticHits = [...rootBody.matchAll(semanticPattern)].map(m => m[1]);

  if (semanticHits.length > 0) {
    return semanticHits[0];
  }

  const frequency = {};
  for (const seg of allFirstSegments) frequency[seg] = (frequency[seg] || 0) + 1;
  const sorted = Object.entries(frequency).sort((a, b) => b[1] - a[1]);
  return sorted[0][0];
}

/**
 * Build @theme inline block that bridges brand-prefixed CSS variables
 * to Tailwind v4 semantic color/radius tokens.
 */
function buildThemeInline(cssContent, prefix) {
  const rootMatch = cssContent.match(/:root\s*\{([^}]*)\}/s);
  if (!rootMatch) return '';
  const rootBody = rootMatch[1];

  const colorTokens = [
    'background', 'foreground', 'card', 'card-foreground',
    'popover', 'popover-foreground', 'primary', 'primary-foreground',
    'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
    'accent', 'accent-foreground', 'destructive', 'destructive-foreground',
    'border', 'input', 'ring',
    'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
    'sidebar', 'sidebar-foreground', 'sidebar-primary',
    'sidebar-primary-foreground', 'sidebar-accent', 'sidebar-accent-foreground',
  ];

  const lines = [];

  if (prefix) {
    const varPattern = new RegExp(`--${prefix}-([a-zA-Z0-9-]+)`, 'g');
    const semanticNames = new Set();
    let match;
    while ((match = varPattern.exec(rootBody)) !== null) {
      semanticNames.add(match[1]);
    }
    for (const token of colorTokens) {
      if (semanticNames.has(token)) {
        lines.push(`    --color-${token}: var(--${prefix}-${token});`);
      }
    }
    const radiusMap = { 'small': 'sm', 'medium': 'md', 'large': 'lg', 'xlarge': 'xl' };
    for (const [cssName, twName] of Object.entries(radiusMap)) {
      if (semanticNames.has(`radius-${cssName}`)) {
        lines.push(`    --radius-${twName}: var(--${prefix}-radius-${cssName});`);
      }
    }
  } else {
    const allVarNames = new Set([...rootBody.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)].map(m => m[1]));

    const ALIAS_TO_SEMANTIC = {
      'bg': 'background',
      'fg': 'foreground',
      'rule': 'border',
      'link': 'ring',
    };
    const mapped = new Set();

    for (const token of colorTokens) {
      if (allVarNames.has(token)) {
        lines.push(`    --color-${token}: var(--${token});`);
        mapped.add(token);
        continue;
      }
      if (allVarNames.has(`color-${token}`)) {
        lines.push(`    --color-${token}: var(--color-${token});`);
        mapped.add(token);
      }
    }

    for (const [shortName, twToken] of Object.entries(ALIAS_TO_SEMANTIC)) {
      if (allVarNames.has(shortName) && !mapped.has(twToken)) {
        lines.push(`    --color-${twToken}: var(--${shortName});`);
      }
    }

    const radiusDirect = { 'radius-sm': 'sm', 'radius-md': 'md', 'radius-lg': 'lg', 'radius-xl': 'xl' };
    const radiusFallback = { 'radius-small': 'sm', 'radius-medium': 'md', 'radius-large': 'lg', 'radius-xlarge': 'xl' };
    for (const [cssName, twName] of Object.entries(radiusDirect)) {
      if (allVarNames.has(cssName)) {
        lines.push(`    --radius-${twName}: var(--${cssName});`);
      }
    }
    for (const [cssName, twName] of Object.entries(radiusFallback)) {
      if (allVarNames.has(cssName) && !lines.some(l => l.includes(`--radius-${twName}:`))) {
        lines.push(`    --radius-${twName}: var(--${cssName});`);
      }
    }
  }

  if (lines.length === 0) return '';
  return `@theme inline {\n${lines.join('\n')}\n  }`;
}

/**
 * Find the best background and foreground CSS variables from the actual CSS content.
 * Searches for common naming patterns in priority order.
 */
function findBodyVars(cssContent, prefix) {
  const rootMatch = cssContent.match(/:root\s*\{([^}]*)\}/s);
  if (!rootMatch) {
    return prefix
      ? { bg: `var(--${prefix}-background)`, fg: `var(--${prefix}-foreground)` }
      : { bg: '#ffffff', fg: '#0f172a' };
  }

  const content = rootMatch[1];

  if (prefix) {
    const bgPatterns = ['background', 'bg-primary', 'bg-base', 'surface'];
    const fgPatterns = ['foreground', 'text-primary', 'text-default'];
    let bg = null, fg = null;
    for (const p of bgPatterns) {
      if (content.includes(`--${prefix}-${p}`)) { bg = `var(--${prefix}-${p})`; break; }
    }
    for (const p of fgPatterns) {
      if (content.includes(`--${prefix}-${p}`)) { fg = `var(--${prefix}-${p})`; break; }
    }
    return {
      bg: bg || `var(--${prefix}-background)`,
      fg: fg || `var(--${prefix}-foreground)`
    };
  }

  const bgCandidates = ['background', 'bg', 'color-background', 'bg-base-default', 'bg-base', 'surface'];
  const fgCandidates = ['foreground', 'fg', 'color-foreground', 'text-primary', 'text-default'];
  let bg = null, fg = null;
  for (const name of bgCandidates) {
    if (content.includes(`--${name}:`)) { bg = `var(--${name})`; break; }
  }
  for (const name of fgCandidates) {
    if (content.includes(`--${name}:`)) { fg = `var(--${name})`; break; }
  }
  return { bg: bg || '#ffffff', fg: fg || '#0f172a' };
}

/**
 * Load components.css from the Library directory if present.
 * Returns the CSS content string, or empty string if not found.
 */
function loadComponentsCSS(cssDir) {
  if (!cssDir) return '';
  const compPath = path.join(cssDir, 'components.css');
  if (!fs.existsSync(compPath)) return '';
  const content = fs.readFileSync(compPath, 'utf-8').trim();
  if (!content) return '';
  console.log('[INFO] Found components.css, inlining as <style id="component-vars">');
  return content;
}

function buildHead(cssContent, prefix, title, lang, cssDir, charts) {
  const themeInline = buildThemeInline(cssContent, prefix);
  const { bg, fg } = findBodyVars(cssContent, prefix);
  const fontFaceBlocks = cssDir ? buildFontFaceFromAssets(cssDir, cssContent) : '';
  const componentCSS = loadComponentsCSS(cssDir);
  const componentBlock = componentCSS
    ? `\n    <style id="component-vars">\n${componentCSS}\n    </style>`
    : '';

  return `<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style id="theme-vars">
${fontFaceBlocks}${cssContent}
    </style>${componentBlock}
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.1/dist/index.global.js"></script>
    <script src="https://unpkg.com/lucide@1.8.0/dist/umd/lucide.min.js"></script>
${charts ? '    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js"></script>\n' : ''}    <style type="text/tailwindcss">
  ${themeInline}
  @layer base {
    body { background: ${bg}; color: ${fg}; }
    td, th { @apply break-words; word-break: break-all; word-break: auto-phrase; }
    th { @apply whitespace-nowrap; }
  }
    </style>
    <style>
      .no-scrollbar::-webkit-scrollbar { display: none; }
      .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      [data-icon] {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        -webkit-mask-size: contain;
        mask-size: contain;
        -webkit-mask-repeat: no-repeat;
        mask-repeat: no-repeat;
        -webkit-mask-position: center;
        mask-position: center;
        background-color: currentColor;
      }
    </style>
</head>`;
}

function buildHTML(cssContent, prefix, title, lang, theme, cssDir, charts) {
  const head = buildHead(cssContent, prefix, title, lang, cssDir, charts);
  return `<!DOCTYPE html>
<html lang="${lang}" class="${theme}">
${head}
<body class="min-h-screen font-sans antialiased">
    <main>
    </main>
    <script>lucide.createIcons();</script>
</body>
</html>
`;
}

function replaceHeadInFile(htmlPath, cssContent, prefix, cssDir, charts) {
  const content = fs.readFileSync(htmlPath, 'utf-8');
  const headMatch = content.match(/<head[\s\S]*?<\/head>/i);
  if (!headMatch) {
    console.error('Error: <head> tag not found');
    console.error('  File:', htmlPath);
    return false;
  }

  // Detect custom style blocks in head that would be lost
  const customStylesInHead = detectCustomStylesInHead(headMatch[0]);

  const titleMatch = content.match(/<title>(.*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1] : 'Untitled';
  const langMatch = content.match(/<html[^>]*\slang="([^"]+)"/i);
  const lang = langMatch ? langMatch[1] : 'en';

  const newHead = buildHead(cssContent, prefix, title, lang, cssDir, charts);

  let result = content.replace(/<head[\s\S]*?<\/head>/i, newHead);
  if (customStylesInHead.length > 0) {
    const moved = moveCustomStylesToBodyEnd(result, customStylesInHead);
    if (!moved) {
      console.error('Error: custom <style> blocks were found in <head>, but </body> was not found for relocation.');
      console.error('  File:', htmlPath);
      console.error('  Fix: move custom <style> blocks before </body>, then re-run --replace-head.');
      return false;
    }
    result = moved;
    console.log('[WARN] Moved', customStylesInHead.length, 'custom style block(s) from <head> to <body>:', htmlPath);
  }

  fs.writeFileSync(htmlPath, result, 'utf-8');

  return true;
}

function moveCustomStylesToBodyEnd(content, customStyles) {
  if (!/<\/body>/i.test(content)) {
    return null;
  }

  const missingStyles = customStyles.filter((styleBlock) => !content.includes(styleBlock));
  if (missingStyles.length === 0) {
    return content;
  }

  const injection = '\n' + missingStyles.map((styleBlock) => '    ' + styleBlock).join('\n') + '\n';
  return content.replace(/<\/body>/i, `${injection}</body>`);
}

/**
 * Detect non-infrastructure <style> blocks in <head>.
 * Infrastructure blocks (generated by this script) are excluded.
 */
function detectCustomStylesInHead(headHtml) {
  const styleRegex = /<style[^>]*>[\s\S]*?<\/style>/gi;
  const matches = headHtml.match(styleRegex) || [];

  return matches.filter(block => {
    // Exclude theme-vars (will be regenerated by this script)
    if (/id=["']theme-vars["']/i.test(block)) return false;
    // Exclude component-vars (will be regenerated by this script)
    if (/id=["']component-vars["']/i.test(block)) return false;
    // Exclude tailwindcss type (will be regenerated by this script)
    if (/type=["']text\/tailwindcss["']/i.test(block)) return false;
    // Exclude blocks that only contain no-scrollbar and/or [data-icon] rules
    if (/\.no-scrollbar/.test(block) || /\[data-icon\]/.test(block)) {
      const inner = block.replace(/<style[^>]*>/i, '').replace(/<\/style>/i, '').trim();
      const stripped = inner
        .replace(/\.no-scrollbar[^}]*\{[^}]*\}/g, '')
        .replace(/\[data-icon\][^}]*\{[^}]*\}/g, '')
        .trim();
      if (stripped.length === 0) return false;
    }
    // Exclude empty style blocks
    const inner = block.replace(/<style[^>]*>/i, '').replace(/<\/style>/i, '').trim();
    if (inner.length === 0) return false;
    return true;
  });
}

function main() {
  const { positional, title, lang, prefix: userPrefix, theme, replaceHead, charts } = parseArgs(process.argv.slice(2));

  if (positional.length < 2) {
    console.error('========================================');
    console.error('Usage');
    console.error('========================================');
    console.error('');
    console.error(replaceHead
      ? 'Mode: Replace <head> in existing HTML'
      : 'Mode: Generate new HTML skeleton');
    console.error('');
    console.error(replaceHead
      ? 'Command: node fill-html-head.mjs <css-file-or-library-dir> <html-file> [html-file2 ...] --replace-head [--prefix=volcano] [--charts]'
      : 'Command: node fill-html-head.mjs <css-file-or-library-dir> <output-html> [--title="Page Title"] [--lang=zh-CN] [--prefix=volcano] [--charts]');
    console.error('');
    process.exit(1);
  }

  const cssPath = resolveCSSPath(positional[0]);
  const cssContent = fs.readFileSync(cssPath, 'utf-8');
  const cssDir = path.dirname(cssPath);
  const prefix = userPrefix || detectPrefix(cssContent);

  console.log('========================================');
  console.log(replaceHead ? 'Replacing HTML <head>' : 'Generating HTML skeleton');
  console.log('========================================');
  console.log('CSS file:', cssPath);
  console.log('Brand prefix:', prefix || '(none — prefixless mode)');

  if (replaceHead) {
    const htmlFiles = positional.slice(1).map((f) => path.resolve(f));
    console.log('Files to process:', htmlFiles.length);
    console.log('');

    let failCount = 0;
    let successCount = 0;

    for (const htmlFile of htmlFiles) {
      if (!fs.existsSync(htmlFile)) {
        console.error('[SKIP] File not found:', htmlFile);
        failCount++;
        continue;
      }
      const ok = replaceHeadInFile(htmlFile, cssContent, prefix, cssDir, charts);
      if (ok) {
        console.log('[OK] Success:', htmlFile);
        successCount++;
      } else {
        failCount++;
      }
    }

    console.log('');
    console.log('========================================');
    console.log('Processing complete');
    console.log('----------------------------------------');
    console.log('Success:', successCount, 'file(s)');
    console.log('Failed:', failCount, 'file(s)');
    console.log('========================================');
    if (failCount > 0) process.exit(1);
  } else {
    const outputFile = path.resolve(positional[1]);
    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log('Output file:', outputFile);
    console.log('Page title:', title);
    console.log('Language:', lang);
    console.log('');

    const html = buildHTML(cssContent, prefix, title, lang, theme, cssDir, charts);
    fs.writeFileSync(outputFile, html, 'utf-8');

    console.log('[OK] HTML skeleton generated');
    console.log('========================================');
  }
}

main();
