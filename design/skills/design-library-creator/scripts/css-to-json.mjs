#!/usr/bin/env node

/**
 * css-to-json.mjs
 *
 * Deterministic projection: parse colors_and_type.css → css.json (6-key schema).
 *
 * Usage:
 *   node css-to-json.mjs <colors_and_type.css> [--output <css.json>]
 *
 * If --output is omitted, writes to the same directory as input with name css.json.
 * Outputs a summary JSON to stderr with parsing stats.
 */

import fs from 'node:fs';
import path from 'node:path';

// ─── Argument Parsing ───────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { inputPath: undefined, outputPath: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--output' && argv[i + 1]) {
      args.outputPath = argv[++i];
    } else if (!arg.startsWith('--') && !args.inputPath) {
      args.inputPath = arg;
    }
  }
  return args;
}

// ─── CSS Block Extraction ───────────────────────────────────────────────────

/**
 * Extract all CSS custom property declarations from a block.
 * Returns array of { name, value } where name excludes the '--' prefix.
 */
function extractDeclarations(blockContent) {
  const declarations = [];
  const regex = /--([\w\u4e00-\u9fff\u3400-\u4dbf][\w\u4e00-\u9fff\u3400-\u4dbf_-]*)\s*:\s*([^;]+);/gu;
  let match;
  while ((match = regex.exec(blockContent)) !== null) {
    declarations.push({ name: match[1].trim(), value: match[2].trim() });
  }
  return declarations;
}

/**
 * Extract declarations with CSS comment group awareness.
 * Comments like "/* groupName *​/" set the currentGroup for subsequent declarations.
 * Any single-word, hyphenated, or Unicode comment is accepted as a color group name,
 * preserving the designer's original naming (e.g., Chinese names, brand prefixes).
 * Returns array of { name, value, group }.
 */
function extractDeclarationsWithGroups(blockContent) {
  const declarations = [];
  let currentGroup = null;

  // 跨行声明折叠：多层 shadow / 长 font-family 常被写成跨行（--shadow-md:\n  0 2px ...,\n  0 1px ...;），
  // 逐行 regex 无法命中会静默丢 token。先把每个 "--name: ... ;" 中的换行折叠为空格。
  blockContent = blockContent.replace(
    /(--[\w\u4e00-\u9fff\u3400-\u4dbf][\w\u4e00-\u9fff\u3400-\u4dbf_-]*\s*:)([^;{}]*?);/gu,
    (full, head, value) => `${head}${value.replace(/\s*\n\s*/g, ' ')};`,
  );

  // Non-color categories: these comment names reset the group to null
  const NULL_GROUPS = new Set([
    'spacers', 'font', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
    'radius', 'heading', 'body', 'typography', 'layout', 'motion', 'spacing',
    'variables', 'utilities', 'classes', 'imports',
  ]);

  const lines = blockContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    // Skip decorative separator lines (e.g., "/* ======================= */")
    if (/^\/\*[\s=*-]+\*\/$/.test(trimmed)) continue;

    // Skip block comment lines that are just markers (e.g., multi-line header comments)
    // Lines containing ONLY uppercase text between decorators are section headers → reset group
    const sectionHeaderMatch = trimmed.match(/^\/\*\s*=*\s*([A-Z][A-Z &/]*?)\s*=*\s*\*\/$/);
    if (sectionHeaderMatch) {
      // All-uppercase = section header, reset group (e.g., "SEMANTIC ALIAS LAYER")
      currentGroup = null;
      continue;
    }

    // Check for single-line comment: /* word */ or /* two words */
    // Also matches decorated comments like /* === Surface & Background === */
    // Supports Unicode and hyphenated names (e.g., /* 碧涛青 */, /* arco-blue */)
    const commentMatch = trimmed.match(/^\/\*\s*=*\s*([\w\u4e00-\u9fff\u3400-\u4dbf-][\w\u4e00-\u9fff\u3400-\u4dbf &/-]*?)\s*=*\s*\*\/$/u);
    if (commentMatch) {
      const groupName = commentMatch[1].trim();

      if (NULL_GROUPS.has(groupName)) {
        currentGroup = null;
      } else if (!groupName.includes(' ')) {
        // Single word, hyphenated, or Unicode → accept as color group directly
        currentGroup = groupName;
      } else {
        // Multi-word: check if it contains a known non-color indicator
        const NULL_INDICATORS = ['typography', 'font', 'layout', 'motion', 'spacing', 'radius', 'shadow', 'size', 'utility', 'variable', 'alias', 'layer', 'maps'];
        if (NULL_INDICATORS.some(w => groupName.toLowerCase().includes(w))) {
          currentGroup = null;
        } else {
          // Multi-word color-related comment — normalize to hyphenated
          currentGroup = groupName.replace(/\s+/g, '-');
        }
      }
      continue;
    }

    // Fallback: comment with separator (—, →, :, |) — extract first word before separator
    // Handles cases like /* primary — description */ or /* aliases → primary */
    const separatorMatch = trimmed.match(/^\/\*\s*=*\s*([\w\u4e00-\u9fff\u3400-\u4dbf-]+)\s*[\u2014\u2192:|]\s*.+?\s*=*\s*\*\/$/u);
    if (separatorMatch) {
      const candidate = separatorMatch[1].trim();
      if (NULL_GROUPS.has(candidate)) {
        currentGroup = null;
      } else {
        currentGroup = candidate;
      }
      continue;
    }

    // Check for declaration, capturing inline comments after the semicolon as annotations.
    // Annotations like /* Card Hover */ or /* @primary */ are preserved for downstream use.
    // Supports Unicode in variable names (e.g., --碧涛青-1)
    const declMatch = trimmed.match(/^--([\w\u4e00-\u9fff\u3400-\u4dbf][\w\u4e00-\u9fff\u3400-\u4dbf_-]*)\s*:\s*([^;]+);\s*(?:\/\*\s*(.*?)\s*\*\/\s*)?$/u);
    if (declMatch) {
      declarations.push({
        name: declMatch[1].trim(),
        value: declMatch[2].trim(),
        group: currentGroup,
        annotation: declMatch[3]?.trim() || null,
      });
    } else {
      // Fallback: extract multiple declarations from a single line
      const multiRegex = /--([\w\u4e00-\u9fff\u3400-\u4dbf][\w\u4e00-\u9fff\u3400-\u4dbf_-]*)\s*:\s*([^;]+);/gu;
      let m;
      while ((m = multiRegex.exec(trimmed)) !== null) {
        declarations.push({
          name: m[1].trim(),
          value: m[2].trim(),
          group: currentGroup,
        });
      }
    }
  }
  return declarations;
}

/**
 * Extract :root { ... } block content.
 * 聚合全部 :root 块（工程上常见 colors 一块、spacing 一块的分段写法），避免丢失第二块之后的 token。
 */
function extractRootBlock(css) {
  const parts = [];
  const regex = /:root\s*\{/g;
  let startMatch;
  while ((startMatch = regex.exec(css)) !== null) {
    const startIdx = startMatch.index + startMatch[0].length;
    let depth = 1;
    let i = startIdx;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    parts.push(css.slice(startIdx, i - 1));
    regex.lastIndex = i;
  }
  return parts.join('\n');
}

/**
 * Extract .dark { ... } block content.
 * 与 extractRootBlock 对称：聚合全部 .dark 块，避免分段写法丢失第二块之后的暗色 token。
 */
function extractDarkBlock(css) {
  const parts = [];
  const regex = /\.dark\s*\{/g;
  let startMatch;
  while ((startMatch = regex.exec(css)) !== null) {
    const startIdx = startMatch.index + startMatch[0].length;
    let depth = 1;
    let i = startIdx;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    parts.push(css.slice(startIdx, i - 1));
    regex.lastIndex = i;
  }
  return parts.join('\n');
}

// ─── Color Space Conversion ─────────────────────────────────────────────────

/**
 * oklch(L C H) → hex
 * oklch(L C H / alpha) → hex + opacity
 */
function oklchToHex(L, C, H) {
  const hRad = H * Math.PI / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  // oklab → LMS cube roots
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  // LMS cube roots → LMS
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  // LMS → linear sRGB
  let rLin = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bLin = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  // linear → sRGB gamma
  function linearToSrgb(c) {
    if (c <= 0.0031308) return 12.92 * c;
    return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }

  let r = linearToSrgb(rLin);
  let g = linearToSrgb(gLin);
  let bVal = linearToSrgb(bLin);

  // Clamp [0,1]
  r = Math.max(0, Math.min(1, r));
  g = Math.max(0, Math.min(1, g));
  bVal = Math.max(0, Math.min(1, bVal));

  // NaN guard: if conversion produced invalid values, return null (skip token)
  if ([r, g, bVal].some(v => isNaN(v))) return null;

  const toHexByte = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return '#' + toHexByte(r) + toHexByte(g) + toHexByte(bVal);
}

/**
 * hsl(H, S%, L%) → hex
 * Supports: hsl(H S% L%), hsl(H, S%, L%), hsla(H, S%, L%, A), hsl(H S% L% / A)
 */
function hslToHex(h, s, l) {
  // s and l are 0-100, convert to 0-1
  s = s / 100;
  l = l / 100;
  // Normalize hue to [0, 360)
  h = ((h % 360) + 360) % 360;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;

  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  r = Math.max(0, Math.min(1, r + m));
  g = Math.max(0, Math.min(1, g + m));
  b = Math.max(0, Math.min(1, b + m));

  // NaN guard
  if ([r, g, b].some(v => isNaN(v))) return null;

  const toHexByte = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return '#' + toHexByte(r) + toHexByte(g) + toHexByte(b);
}

// ─── Color Parsing ──────────────────────────────────────────────────────────

/**
 * Convert a hex color (#rrggbb) to HSL components.
 * Returns { h: 0-360, s: 0-100, l: 0-100 } or null if invalid.
 */
function hexToHsl(hex) {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s: s * 100, l: l * 100 };
}

function hexToObj(hex, opacity = '1') {
  if (!hex) return null;
  return { hex: hex.toLowerCase(), opacity: String(opacity) };
}

function expandShortHex(h) {
  if (h.length === 4) {
    return '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  return h;
}

function parseColorValue(value) {
  if (!value) return null;

  // #rrggbb
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    return hexToObj(value);
  }
  // #rgb
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    return hexToObj(expandShortHex(value));
  }
  // #rrggbbaa
  if (/^#[0-9a-fA-F]{8}$/.test(value)) {
    const hex = value.slice(0, 7);
    const alphaHex = value.slice(7, 9);
    const opacity = (parseInt(alphaHex, 16) / 255).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return hexToObj(hex, opacity || '0');
  }
  // rgba(r, g, b, a) or rgba(r g b / a) or rgb(r, g, b) or rgb(r g b)
  const rgbaMatch = value.match(/rgba?\(\s*(\d+)\s*[,\s]\s*(\d+)\s*[,\s]\s*(\d+)\s*(?:[,/]\s*([0-9.]+%?)\s*)?\)/);
  if (rgbaMatch) {
    const r = parseInt(rgbaMatch[1]);
    const g = parseInt(rgbaMatch[2]);
    const b = parseInt(rgbaMatch[3]);
    let a = rgbaMatch[4] !== undefined ? rgbaMatch[4] : '1';
    if (a.endsWith('%')) {
      a = String(parseFloat(a) / 100);
    }
    const hex = '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
    return hexToObj(hex, a);
  }
  // oklch(L C H) or oklch(L C H / alpha)
  const oklchMatch = value.match(/^oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*(?:\/\s*([0-9.]+%?)\s*)?\)$/);
  if (oklchMatch) {
    const L = parseFloat(oklchMatch[1]);
    const C = parseFloat(oklchMatch[2]);
    const H = parseFloat(oklchMatch[3]);
    let alpha = '1';
    if (oklchMatch[4] !== undefined) {
      let a = oklchMatch[4];
      if (a.endsWith('%')) {
        alpha = String(parseFloat(a) / 100);
      } else {
        alpha = String(parseFloat(a));
      }
    }
    const hex = oklchToHex(L, C, H);
    return hexToObj(hex, alpha);
  }
  // hsl(H S% L%) or hsl(H, S%, L%) or hsl(H S% L% / A) or hsla(H, S%, L%, A)
  const hslMatch = value.match(/^hsla?\(\s*([0-9.]+)\s*[,\s]\s*([0-9.]+)%\s*[,\s]\s*([0-9.]+)%\s*(?:[,/]\s*([0-9.]+%?)\s*)?\)$/);
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]);
    const s = parseFloat(hslMatch[2]);
    const l = parseFloat(hslMatch[3]);
    let alpha = '1';
    if (hslMatch[4] !== undefined) {
      let a = hslMatch[4];
      if (a.endsWith('%')) {
        alpha = String(parseFloat(a) / 100);
      } else {
        alpha = String(parseFloat(a));
      }
    }
    const hex = hslToHex(h, s, l);
    return hexToObj(hex, alpha);
  }
  // Bare HSL: "H S% L%" pattern (number space percentage percentage) — shadcn/Tailwind themes
  const bareHslMatch = value.match(/^(-?[0-9.]+)\s+(-?[0-9.]+)%\s+(-?[0-9.]+)%$/);
  if (bareHslMatch) {
    const h = parseFloat(bareHslMatch[1]);
    const s = parseFloat(bareHslMatch[2]);
    const l = parseFloat(bareHslMatch[3]);
    const hex = hslToHex(h, s, l);
    return hexToObj(hex);
  }
  // transparent
  if (value === 'transparent') {
    return hexToObj('#000000', '0');
  }
  return null;
}

function isColorValue(value) {
  if (!value) return false;
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return true;
  if (/^rgba?\(/.test(value)) return true;
  if (/^(oklch|hsl|hsla)\(/.test(value)) return true;
  if (value === 'transparent') return true;
  // Bare HSL: "H S% L%" pattern
  if (/^-?\d+(\.\d+)?\s+-?\d+(\.\d+)?%\s+-?\d+(\.\d+)?%$/.test(value)) return true;
  return false;
}

// ─── Shadow Parsing ─────────────────────────────────────────────────────────

/**
 * Parse a single shadow layer: "Xpx Ypx Bpx Spx color"
 */
function parseSingleShadow(layer) {
  const trimmed = layer.trim();
  let remaining = trimmed;
  let inset = false;

  // Handle inset prefix
  if (remaining.startsWith('inset')) {
    inset = true;
    remaining = remaining.slice(5).trim();
  }

  const parts = [];

  // Extract length values from the beginning
  const lengthRegex = /^(-?\d+(?:\.\d+)?(?:px)?)\s*/;
  while (parts.length < 4) {
    const m = remaining.match(lengthRegex);
    if (!m) break;
    parts.push(m[1].replace('px', '') + 'px');
    remaining = remaining.slice(m[0].length);
  }

  if (parts.length < 2) return null; // need at least x, y (blur/spread optional per CSS spec)

  const xOffset = parts[0];
  const yOffset = parts[1];
  const blur = parts.length >= 3 ? parts[2] : '0px';
  const spread = parts.length >= 4 ? parts[3] : '0px';

  // Remaining should be color — try parseColorValue which handles hsl/oklch
  remaining = remaining.trim();
  const color = parseColorValue(remaining);
  if (!color) {
    return null;
  }

  const result = { xOffset, yOffset, blur, spread, color };
  if (inset) result.inset = true;
  return result;
}

/**
 * Split multi-layer shadow by commas, handling parentheses.
 */
function splitShadowLayers(value) {
  const layers = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      layers.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) layers.push(current.trim());
  return layers;
}

// ─── Var Resolution ─────────────────────────────────────────────────────────

/**
 * Build a lookup table from declarations and resolve var() references.
 */
function resolveVars(declarations) {
  const directValues = new Map();
  const varRefs = new Map();

  for (const { name, value } of declarations) {
    const varMatch = value.match(/^var\(--([^,)]+)(?:,\s*(.+))?\)$/);
    if (varMatch) {
      varRefs.set(name, { target: varMatch[1].trim(), fallback: varMatch[2]?.trim() || null });
    } else {
      directValues.set(name, value);
    }
  }

  // Resolve var references recursively (max 3 levels)
  const resolved = new Map(directValues);
  const warnings = [];

  function resolve(name, depth = 0) {
    if (resolved.has(name)) return resolved.get(name);
    if (depth > 3) return null;
    const ref = varRefs.get(name);
    if (!ref) return null;
    const targetValue = resolve(ref.target, depth + 1);
    if (targetValue !== null) {
      resolved.set(name, targetValue);
      return targetValue;
    }
    // Fallback: use fallback value if target resolution fails
    if (ref.fallback) {
      resolved.set(name, ref.fallback);
      return ref.fallback;
    }
    return null;
  }

  for (const [name] of varRefs) {
    const val = resolve(name);
    if (val === null) {
      warnings.push(`unresolved var: --${name} → --${varRefs.get(name).target}`);
      resolved.set(name, null);
    }
  }

  return { resolved, warnings };
}

// ─── Classification ─────────────────────────────────────────────────────────

const SKIP_PATTERNS = [
  /^duration-/,
  /^ease-/,
  /^transition-/,
  /^motion-/,
  /^z-/,
  /^opacity-/,
  /^tracking-/,
  /^shadow-(x|y|blur|spread|opacity|color)$/,
];

function shouldSkip(name) {
  return SKIP_PATTERNS.some(p => p.test(name));
}

const TAILWIND_SEMANTIC_NAMES = new Set([
  'background', 'foreground', 'card', 'card-foreground',
  'popover', 'popover-foreground', 'primary', 'primary-foreground',
  'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
  'accent', 'accent-foreground', 'destructive', 'destructive-foreground',
  'border', 'input', 'ring',
  'sidebar', 'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground',
  'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
]);

function inferTailwindGroup(name) {
  if (name.startsWith('chart-')) return 'chart';
  if (name === 'sidebar' || name.startsWith('sidebar-')) return 'sidebar';
  // Better semantic grouping for Tailwind names
  if (/^(background|card|popover|muted)$/.test(name)) return 'bg';
  if (/foreground$/.test(name)) return 'text';
  if (/^(primary|secondary|accent|ring|input)$/.test(name)) return 'accent';
  if (/^(border)$/.test(name)) return 'border';
  if (/^destructive/.test(name)) return 'status';
  return 'semantic';
}

function inferColorGroup(name) {
  // 1. Trailing number → scale prefix: brand-green-500 → "brand-green"
  const withoutTrailingNum = name.replace(/-\d+$/, '');
  if (withoutTrailingNum !== name && withoutTrailingNum.length > 0) return withoutTrailingNum;

  // 2. chart-*
  if (name.startsWith('chart-')) return 'chart';
  // 3. sidebar-*
  if (name.startsWith('sidebar-')) return 'sidebar';

  // 4. Fallback: use the token name itself as the group (no forced English semantic buckets)
  return name;
}

function classifyToken(name, value, currentGroup) {
  // Spacing: space-*, spacer-*, spacing-*, or exactly "spacing"
  if (/^(space|spacer|spacing)-/.test(name) || name === 'spacing') return { category: 'spacing' };

  // Radius: radius-* or exactly "radius" or *-radius-* (prefixed patterns)
  if (/^radius(-|$)/.test(name) || /-radius(-|$)/.test(name)) return { category: 'radius' };

  // Font size: font-size-* or *-font-size or exactly "font-size"
  if (/^font-size-/.test(name) || /-font-size$/.test(name) || name === 'font-size')
    return { category: 'font.size' };

  // Font weight: font-weight-* or *-font-weight or exactly "font-weight"
  if (/^font-weight-/.test(name) || /-font-weight$/.test(name) || name === 'font-weight')
    return { category: 'font.weight' };

  // Line height: line-height-* or *-line-height or exactly "line-height"
  if (/^line-height-/.test(name) || /-line-height$/.test(name) || name === 'line-height')
    return { category: 'font.lineHeight' };

  // Font family: font-sans/serif/mono, or font-family-*, or *-font-family, or font-* with comma in value,
  // or brand-prefixed font tokens (e.g., --yibao-font-display) with comma-separated values
  if (/^font-(sans|serif|mono)$/.test(name) ||
      /^font-family-/.test(name) ||
      /-font-family$/.test(name) ||
      (/^font-/.test(name) && value && /,/.test(value) && !isColorValue(value)) ||
      (/-font-/.test(name) && value && /,/.test(value) && !isColorValue(value)))
    return { category: 'font.family' };

  // Type scale tokens: type-display-*, type-heading-*, type-body-*
  if (/^type-/.test(name) && value && /rem|px|em/.test(value)) return { category: 'font.size' };

  // Shadow: shadow-* but NOT decomposed shadow params (shadow-x/y/blur/spread/opacity/color)
  if (/^shadow(-[a-z0-9])/.test(name) && !/^shadow-(x|y|blur|spread|opacity|color)$/.test(name))
    return { category: 'shadow' };
  if (name === 'shadow') return { category: 'shadow' };

  // Size tokens
  if (/^(size-|max-|gutter-|nav-|sidebar-width)/.test(name)) return { category: 'size' };

  // CSS comment group always takes priority: if currentGroup is set and value is a color, use it
  if (currentGroup && value && isColorValue(value)) {
    return { category: 'color', group: currentGroup };
  }

  // Semantic color aliases (color-*): use token name inference as fallback
  if (/^color-/.test(name) && value && isColorValue(value)) {
    const afterPrefix = name.replace(/^color-/, '');
    const group = inferColorGroup(afterPrefix);
    return { category: 'color', group };
  }

  // Tailwind semantic names whitelist
  if (TAILWIND_SEMANTIC_NAMES.has(name) && value && isColorValue(value)) {
    return { category: 'color', group: inferTailwindGroup(name) };
  }

  // Existing prefix-based classification (color-* already handled above)
  if (/^chart-/.test(name) && value && isColorValue(value)) return { category: 'color', group: 'chart' };

  // Default: if value is a color → classify with name-based grouping
  if (value && isColorValue(value)) {
    const group = inferColorGroup(name);
    return { category: 'color', group };
  }

  return { category: 'unknown' };
}

// ─── Main Processing ────────────────────────────────────────────────────────

// ─── Parse @group-priority meta ─────────────────────────────────────────────

/**
 * Extract ordered priority group list from a CSS meta comment.
 * Format: /* @group-priority: primary, surface, text, background *​/
 * Returns [] if no declaration found (backward compatible — falls back to token count sort).
 */
function parseGroupPriority(css) {
  // Match @group-priority anywhere (standalone single-line comment OR inside multi-line block)
  const match = css.match(/@group-priority\s*:\s*(.+)/);
  if (!match) return [];
  // Strip trailing comment-close (*/) and decorative characters (===, ---, ***)
  const raw = match[1]
    .replace(/\*\/.*$/, '')
    .replace(/[\s=\-*]+$/, '');
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Extract per-file color group size cap from a CSS meta comment.
 * Format: /* @max-group-size: 12 *​/
 * Default 10. Declared ONLY when the user explicitly requested longer scales.
 * Clamped to [10, 50] — values below the default are ignored, absurd values rejected.
 */
const DEFAULT_MAX_GROUP_SIZE = 10;
function parseMaxGroupSize(css) {
  const match = css.match(/@max-group-size\s*:\s*(\d+)/);
  if (!match) return DEFAULT_MAX_GROUP_SIZE;
  const n = parseInt(match[1], 10);
  if (!Number.isFinite(n) || n < DEFAULT_MAX_GROUP_SIZE) return DEFAULT_MAX_GROUP_SIZE;
  return Math.min(n, 50);
}

function processCSS(cssContent) {
  const rootBlock = extractRootBlock(cssContent);
  const darkBlock = extractDarkBlock(cssContent);

  const rootDeclsWithGroups = extractDeclarationsWithGroups(rootBlock);
  const darkDecls = extractDeclarations(darkBlock);

  // Build plain declarations for var resolution
  const rootDecls = rootDeclsWithGroups.map(({ name, value }) => ({ name, value }));

  // Resolve var() in :root
  const { resolved: rootResolved, warnings: varWarnings } = resolveVars(rootDecls);

  // Build a group map from rootDeclsWithGroups
  const groupMap = new Map();
  const annotationMap = new Map();
  for (const { name, group, annotation } of rootDeclsWithGroups) {
    if (group) groupMap.set(name, group);
    if (annotation) annotationMap.set(name, annotation);
  }

  // Build output structure
  const result = {
    color: {},
    font: { family: {}, size: {}, weight: {}, lineHeight: {} },
    shadow: {},
    radius: {},
    spacing: {},
    size: {},
  };

  const skipped = [];
  const warnings = [...varWarnings];
  let totalParsed = 0;

  // Process :root declarations
  for (const [name, rawResolvedValue] of rootResolved) {
    if (shouldSkip(name)) {
      skipped.push(name);
      continue;
    }

    // B2: Strip !important (spec violation, but don't silently lose data)
    let resolvedValue = rawResolvedValue;
    if (resolvedValue && /\s*!important\s*$/.test(resolvedValue)) {
      resolvedValue = resolvedValue.replace(/\s*!important\s*$/, '');
      warnings.push(`!important stripped: --${name} (spec violation)`);
    }

    // B3: Detect calc() violation — skip and warn instead of outputting garbage
    if (resolvedValue && /\bcalc\s*\(/.test(resolvedValue)) {
      warnings.push(`calc() not supported: --${name}: ${resolvedValue} — use concrete px values`);
      skipped.push(name);
      continue;
    }

    const currentGroup = groupMap.get(name) || null;
    const classification = classifyToken(name, resolvedValue, currentGroup);

    if (classification.category === 'unknown') {
      if (resolvedValue && isColorValue(resolvedValue)) {
        // Looks like a color but classifyToken said unknown — try to parse
        const colorObj = parseColorValue(resolvedValue);
        if (!colorObj) {
          process.stderr.write(`⚠️  Color parse failed for "--${name}: ${resolvedValue}" — skipping\n`);
          warnings.push(`color parse failed: --${name}: ${resolvedValue}`);
        }
      } else if (resolvedValue === null) {
        // unresolved var — skip token, do not create placeholder
        warnings.push(`unresolved var skipped: --${name}`);
      } else {
        skipped.push(name);
      }
      continue;
    }

    totalParsed++;

    switch (classification.category) {
      case 'spacing': {
        const px = ensurePx(resolvedValue);
        if (px) result.spacing[name] = px;
        break;
      }

      case 'radius': {
        const px = ensurePx(resolvedValue);
        if (px) result.radius[name] = px;
        break;
      }

      case 'size': {
        const px = ensurePx(resolvedValue);
        if (px) result.size[name] = px;
        break;
      }

      case 'font.size': {
        const px = ensurePx(resolvedValue);
        if (px) result.font.size[name] = px;
        break;
      }

      case 'font.weight':
        result.font.weight[name] = resolvedValue;
        break;

      case 'font.family':
        result.font.family[name] = resolvedValue;
        break;

      case 'font.lineHeight':
        result.font.lineHeight[name] = resolvedValue;
        break;

      case 'shadow': {
        if (!resolvedValue) break;
        const layers = splitShadowLayers(resolvedValue);
        const parsedLayers = [];
        for (const layer of layers) {
          const parsed = parseSingleShadow(layer);
          if (parsed) parsedLayers.push(parsed);
        }
        if (parsedLayers.length > 0) {
          if (parsedLayers.length < layers.length) {
            warnings.push(`shadow layer(s) dropped: --${name} (${parsedLayers.length}/${layers.length} layers parsed)`);
          }
          // Build display key: if annotation exists (e.g. "Card Hover"), format as "shadow-N·Card Hover"
          const shadowAnnotation = annotationMap.get(name);
          // Strip @primary or other @-directives from shadow annotations (unlikely but safe)
          const cleanAnnotation = shadowAnnotation?.replace(/@\w+/g, '').trim() || null;
          const displayKey = cleanAnnotation ? `${name}·${cleanAnnotation}` : name;
          // Single layer: flat object for backward compatibility; multi-layer: array
          result.shadow[displayKey] = parsedLayers.length === 1 ? parsedLayers[0] : { layers: parsedLayers };
        } else {
          warnings.push(`shadow parse failed: --${name}`);
          totalParsed--;
        }
        break;
      }

      case 'color': {
        const group = classification.group;
        if (!result.color[group]) result.color[group] = {};
        if (resolvedValue === null) {
          // unresolved var — skip, don't create placeholder
          warnings.push(`unresolved var skipped (color): --${name}`);
          totalParsed--;
        } else {
          const colorObj = parseColorValue(resolvedValue);
          if (colorObj) {
            // Mark as primary if annotation contains @primary
            const colorAnnotation = annotationMap.get(name);
            if (colorAnnotation && /@primary\b/.test(colorAnnotation)) {
              colorObj.isPrimary = true;
            }
            result.color[group][name] = colorObj;
          } else {
            // parseColorValue returned null — skip silently
            process.stderr.write(`⚠️  Color parse failed for "--${name}: ${resolvedValue}" — skipping\n`);
            warnings.push(`color parse failed: --${name}: ${resolvedValue}`);
            totalParsed--;
          }
        }
        break;
      }
    }
  }

  // Process .dark block — primarily color overrides
  if (darkDecls.length > 0) {
    const allDecls = [...rootDecls, ...darkDecls];
    const { resolved: darkResolved, warnings: darkVarWarnings } = resolveVars(allDecls);
    warnings.push(...darkVarWarnings.filter(w => !varWarnings.includes(w)));

    if (!result.color.dark) result.color.dark = {};

    for (const { name } of darkDecls) {
      if (shouldSkip(name)) continue;

      const resolvedValue = darkResolved.get(name);
      if (resolvedValue === undefined) continue;

      const classification = classifyToken(name, resolvedValue, null);

      if (classification.category === 'color' || classification.category === 'unknown') {
        if (resolvedValue === null) {
          // unresolved var — skip, don't create placeholder
          warnings.push(`unresolved var skipped (dark): --${name}`);
        } else {
          const colorObj = parseColorValue(resolvedValue);
          if (colorObj) {
            result.color.dark[name] = colorObj;
            totalParsed++;
          } else if (resolvedValue && isColorValue(resolvedValue)) {
            warnings.push(`dark color parse failed: --${name}: ${resolvedValue}`);
          }
        }
      } else {
        warnings.push(`non-color dark override skipped: --${name} (category: ${classification.category})`);
      }
    }
  }

  // Clean up empty font sub-objects and ensure structure
  if (Object.keys(result.font.family).length === 0) delete result.font.family;
  if (Object.keys(result.font.size).length === 0) delete result.font.size;
  if (Object.keys(result.font.weight).length === 0) delete result.font.weight;
  if (Object.keys(result.font.lineHeight).length === 0) delete result.font.lineHeight;

  if (!result.font.family) result.font.family = {};
  if (!result.font.size) result.font.size = {};
  if (!result.font.weight) result.font.weight = {};
  if (!result.font.lineHeight) result.font.lineHeight = {};

  // ─── Remove catch-all dump groups ─────────────────────────────────────────
  // These groups are not meaningful design intent — they accumulate unclassified
  // tokens and should be discarded rather than shown in the theme panel.
  // Must run BEFORE autoSplitMixedGroups to prevent sub-group extraction.
  const CATCH_ALL_GROUPS = ['semantic', 'Alpha'];
  for (const g of CATCH_ALL_GROUPS) {
    delete result.color[g];
  }

  // ─── Auto-split mixed-hue groups (enforce flat 2D color structure) ─────────
  // A color group should contain only ONE color scale (one hue family).
  // If a group has multiple distinct scale prefixes (e.g., citrus-lime-* AND citrus-leaf-*),
  // split them into separate top-level groups.
  result.color = autoSplitMixedGroups(result.color);

  // ─── Enforce group name coherence ──────────────────────────────────────────
  // If a group has a specific hue-family name (not a generic utility name),
  // only keep tokens whose name contains the group name. Unrelated tokens are dropped.
  result.color = enforceGroupCoherence(result.color, warnings);

  // ─── Enforce hue coherence (remove outlier hues) ────────────────────────────
  // Within each color group, remove chromatic tokens whose hue deviates > 40°
  // from the group's dominant hue. Achromatic tokens and semantic groups are exempt.
  result.color = enforceHueCoherence(result.color);

  // ─── Deduplicate cross-group tokens ────────────────────────────────────────
  // If a token name appears in multiple groups, keep it only in the most specific
  // (smallest non-"dark") group.
  result.color = deduplicateCrossGroup(result.color);

  // ─── Remove empty groups ───────────────────────────────────────────────────
  for (const [group, tokens] of Object.entries(result.color)) {
    if (tokens && typeof tokens === 'object' && Object.keys(tokens).length === 0) {
      delete result.color[group];
    }
  }

  // ─── Sort tokens within each group by luminance (dark → light) ──────────────
  result.color = sortGroupsByLuminance(result.color);

  // ─── Cap each color group (default 10, overridable via @max-group-size) ─────
  // Evenly sample across the sorted scale to keep good luminance distribution.
  // Record original sizes before capping for stable sort.
  const MAX_GROUP_SIZE = parseMaxGroupSize(cssContent);
  const originalGroupSizes = {};
  for (const [group, tokens] of Object.entries(result.color)) {
    const keys = Object.keys(tokens);
    originalGroupSizes[group] = keys.length;
    if (keys.length > MAX_GROUP_SIZE) {
      const sampled = {};
      for (let i = 0; i < MAX_GROUP_SIZE; i++) {
        const idx = Math.round(i * (keys.length - 1) / (MAX_GROUP_SIZE - 1));
        sampled[keys[idx]] = tokens[keys[idx]];
      }
      result.color[group] = sampled;
      warnings.push(`group "${group}" capped: ${keys.length} → ${MAX_GROUP_SIZE} tokens (evenly sampled; declare /* @max-group-size: N */ if longer scales are intended)`);
    }
  }

  // ─── Ensure every color group has exactly one isPrimary ─────────────────────
  // If Agent didn't mark @primary, or capping removed the marked token,
  // auto-assign based on saturation + mid-lightness scoring.
  ensurePrimaryMarked(result.color);

  // ─── Sort groups: @group-priority first, then by token count ────────────────
  const priorityOrder = parseGroupPriority(cssContent);
  const sortedColor = {};

  // Sparse-scale guard: a declared priority group with an incomplete scale
  // (< MIN_PRIORITY_GROUP_SIZE tokens) is demoted out of the priority block —
  // sparse groups render as thin, unappealing cards on the cover/first screen.
  // Demoted groups fall back to the token-count sort with the remaining groups.
  const MIN_PRIORITY_GROUP_SIZE = 4;

  // 1. Priority groups in declared order (skip non-existent, demote sparse)
  for (const group of priorityOrder) {
    if (!result.color[group]) continue;
    if ((originalGroupSizes[group] || 0) < MIN_PRIORITY_GROUP_SIZE) {
      warnings.push(`@group-priority demoted: "${group}" has only ${originalGroupSizes[group] || 0} tokens (< ${MIN_PRIORITY_GROUP_SIZE}) — incomplete scale`);
      continue;
    }
    sortedColor[group] = result.color[group];
  }

  // 2. Remaining groups (incl. demoted sparse priority groups) sorted by original token count (most first)
  const remaining = Object.entries(result.color)
    .filter(([group]) => !sortedColor[group])
    .sort((a, b) => (originalGroupSizes[b[0]] || 0) - (originalGroupSizes[a[0]] || 0));

  for (const [group, tokens] of remaining) {
    sortedColor[group] = tokens;
  }

  result.color = sortedColor;

  const summary = {
    totalParsed,
    skipped,
    warnings,
    unresolvedVars: varWarnings.filter(w => w.startsWith('unresolved')).map(w => w.replace('unresolved var: ', '')),
  };

  return { result, summary };
}

// ─── Enforce group name coherence ────────────────────────────────────────────

/**
 * For groups with specific hue-family names, remove tokens that don't belong.
 * A token "belongs" to a group if its name contains the group name (case-insensitive).
 * Generic utility groups (chart, sidebar, dark) are exempt from this check.
 * Tokens removed are discarded (they were misclassified by the upstream AI).
 */
function enforceGroupCoherence(colorObj, warnings = []) {
  // Groups where membership is NOT based on name containment
  const EXEMPT_GROUPS = new Set(['chart', 'sidebar', 'dark']);

  const output = {};
  for (const [groupName, tokens] of Object.entries(colorObj)) {
    if (!tokens || typeof tokens !== 'object') {
      output[groupName] = tokens;
      continue;
    }

    // Exempt groups keep all tokens
    if (EXEMPT_GROUPS.has(groupName.toLowerCase())) {
      output[groupName] = tokens;
      continue;
    }

    // For each token, check if its name contains the group name
    const groupLower = groupName.toLowerCase();
    const coherent = {};
    for (const [tokenName, value] of Object.entries(tokens)) {
      if (tokenName.toLowerCase().includes(groupLower)) {
        coherent[tokenName] = value;
      } else {
        // token name doesn't match group name → discard, but never silently
        warnings.push(`group-coherence dropped: --${tokenName} from group "${groupName}" (token name does not contain group name)`);
      }
    }

    if (Object.keys(coherent).length > 0) {
      output[groupName] = coherent;
    }
  }

  return output;
}

// ─── Hue coherence: remove outlier hues from color groups ───────────────────

/**
 * Angular distance between two hues on the color wheel (0-180°).
 */
function hueDistance(h1, h2) {
  const d = Math.abs(h1 - h2);
  return Math.min(d, 360 - d);
}

/**
 * Find the hue that minimizes total angular distance to all hues (circular median).
 */
function circularMedian(hues) {
  let bestAngle = hues[0];
  let bestTotal = Infinity;
  for (const candidate of hues) {
    const total = hues.reduce((sum, h) => sum + hueDistance(h, candidate), 0);
    if (total < bestTotal) { bestTotal = total; bestAngle = candidate; }
  }
  return bestAngle;
}

/**
 * Enforce hue coherence within each color group.
 * Removes chromatic tokens whose hue deviates > HUE_TOLERANCE degrees from the
 * group's dominant hue. Achromatic tokens (saturation < 10%) are always kept.
 * Groups whose names match semantic/utility patterns are exempt.
 */
function enforceHueCoherence(colorObj) {
  const EXEMPT_PATTERNS = /\b(text|surface|neutral|gray|grey|foreground|background|border|shadow|chart|dark|state|error|warning|success|info|danger|status|sidebar|semantic|interactive)\b/i;
  const HUE_TOLERANCE = 40; // degrees

  const output = {};
  for (const [groupName, tokens] of Object.entries(colorObj)) {
    if (!tokens || typeof tokens !== 'object') { output[groupName] = tokens; continue; }
    if (EXEMPT_PATTERNS.test(groupName)) { output[groupName] = tokens; continue; }

    // Naming coherence exemption: if most tokens share the group name in their key,
    // AND the group is truly multi-hue (semantic group), exempt from hue filtering.
    // If the group is actually single-hue (a hue-family palette with naming matches),
    // still enforce hue filtering to catch misclassified color values.
    const tokenNames = Object.keys(tokens);
    const groupLower = groupName.toLowerCase();
    const namingMatches = tokenNames.filter(n => n.toLowerCase().includes(groupLower));
    if (namingMatches.length >= Math.ceil(tokenNames.length * 0.6)) {
      // Check if this is truly a multi-hue semantic group or a single-hue palette
      const chromaticCheck = [];
      for (const [, value] of Object.entries(tokens)) {
        const hsl = hexToHsl(value.hex);
        if (hsl && hsl.s >= 10) chromaticCheck.push(hsl.h);
      }
      if (chromaticCheck.length >= 3) {
        const median = circularMedian(chromaticCheck);
        const withinTolerance = chromaticCheck.filter(h => hueDistance(h, median) <= HUE_TOLERANCE);
        // If majority share a hue → it's a hue-family group, fall through to filtering
        // If minority share a hue → truly multi-hue semantic group, exempt
        if (withinTolerance.length / chromaticCheck.length <= 0.6) {
          output[groupName] = tokens;
          continue;
        }
        // else: fall through to standard hue filtering below
      } else {
        // Too few chromatic tokens to determine → exempt (naming takes priority)
        output[groupName] = tokens;
        continue;
      }
    }

    const entries = Object.entries(tokens);
    // Separate chromatic vs achromatic
    const chromatic = [];
    const achromatic = [];
    for (const [name, value] of entries) {
      const hsl = hexToHsl(value.hex);
      if (!hsl || hsl.s < 10) { achromatic.push([name, value]); }
      else { chromatic.push({ name, value, hue: hsl.h }); }
    }

    // Need ≥3 chromatic tokens to enforce coherence
    if (chromatic.length < 3) { output[groupName] = tokens; continue; }

    // Compute dominant hue via circular median
    const hues = chromatic.map(c => c.hue);
    const dominantHue = circularMedian(hues);

    // Filter outliers
    const coherent = chromatic.filter(c => hueDistance(c.hue, dominantHue) <= HUE_TOLERANCE);

    // If too many removed (< 2 chromatic left), keep all
    if (coherent.length < 2) { output[groupName] = tokens; continue; }

    // Rebuild group: achromatic + coherent chromatic (preserve original order)
    const coherentNames = new Set(coherent.map(c => c.name));
    const result = {};
    for (const [name, value] of entries) {
      const hsl = hexToHsl(value.hex);
      const isAchromatic = !hsl || hsl.s < 10;
      if (isAchromatic || coherentNames.has(name)) {
        result[name] = value;
      }
    }
    if (Object.keys(result).length > 0) output[groupName] = result;
  }
  return output;
}

// ─── Ensure every color group has exactly one isPrimary ──────────────────────

/**
 * For each color group, ensure exactly one token has `isPrimary: true`.
 * - If already marked: deduplicate (keep first).
 * - If none marked: auto-assign using saturation + mid-lightness scoring.
 */
function ensurePrimaryMarked(colorObj) {
  for (const [, tokens] of Object.entries(colorObj)) {
    if (!tokens || typeof tokens !== 'object') continue;
    const entries = Object.entries(tokens);
    if (entries.length === 0) continue;

    // Deduplicate: if multiple isPrimary, keep only the first
    let foundPrimary = false;
    for (const [, value] of entries) {
      if (value && value.isPrimary) {
        if (foundPrimary) { delete value.isPrimary; }
        else { foundPrimary = true; }
      }
    }
    if (foundPrimary) continue;

    // No primary marked — auto-assign by scoring
    let bestName = null;
    let bestScore = -Infinity;
    for (const [name, value] of entries) {
      if (!value || !value.hex) continue;
      const hsl = hexToHsl(value.hex);
      if (!hsl) continue;
      // Score: prioritize saturation, penalize distance from mid-lightness
      const score = hsl.s - Math.abs(hsl.l - 50) * 0.5;
      if (score > bestScore) { bestScore = score; bestName = name; }
    }

    if (bestName && tokens[bestName]) {
      tokens[bestName].isPrimary = true;
    }
  }
  return colorObj;
}

// ─── Auto-split mixed-hue color groups ──────────────────────────────────────

/**
 * Enforces flat 2D color structure: each group should contain only ONE color
 * scale (one hue family). Scales are identified by tokens sharing a common
 * prefix followed by a numeric suffix (e.g., citrus-lime-50 ... citrus-lime-900).
 *
 * Split rules:
 * - If a group has ≥1 significant scale (prefix with ≥3 tokens) AND also contains
 *   non-scale tokens or multiple scales → extract each scale to its own group.
 * - A group that is PURELY one scale (no non-scale tokens) is left as-is.
 */
function autoSplitMixedGroups(colorObj) {
  const output = {};

  for (const [groupName, tokens] of Object.entries(colorObj)) {
    if (!tokens || typeof tokens !== 'object') {
      output[groupName] = tokens;
      continue;
    }

    // Identify scale prefixes: tokens ending in -N (numeric suffix)
    const scalePrefixes = new Map(); // prefix → [tokenName, ...]
    const nonScaleTokens = [];

    for (const tokenName of Object.keys(tokens)) {
      const match = tokenName.match(/^(.+)-(\d+)$/);
      if (match) {
        const prefix = match[1];
        if (!scalePrefixes.has(prefix)) scalePrefixes.set(prefix, []);
        scalePrefixes.get(prefix).push(tokenName);
      } else {
        nonScaleTokens.push(tokenName);
      }
    }

    // Significant scales: ≥3 tokens with the same prefix (a real color scale)
    const significantScales = [...scalePrefixes.entries()].filter(([, names]) => names.length >= 3);

    // Split if: (a) multiple scales exist, OR (b) one scale + non-scale tokens coexist
    const hasNonScaleTokens = nonScaleTokens.length > 0;
    const shouldSplit = significantScales.length >= 2 ||
      (significantScales.length === 1 && hasNonScaleTokens);

    if (shouldSplit) {
      // Each significant scale becomes its own top-level group (merge with existing if present)
      for (const [prefix, names] of significantScales) {
        if (!output[prefix]) output[prefix] = {};
        for (const name of names) {
          output[prefix][name] = tokens[name];
        }
      }
      // Keep non-scale tokens + insignificant scales (< 3 tokens) in the original group
      const remainingTokens = {};
      for (const name of nonScaleTokens) {
        remainingTokens[name] = tokens[name];
      }
      for (const [prefix, names] of scalePrefixes.entries()) {
        if (names.length < 3) {
          for (const name of names) {
            remainingTokens[name] = tokens[name];
          }
        }
      }
      if (Object.keys(remainingTokens).length > 0) {
        if (!output[groupName]) output[groupName] = {};
        Object.assign(output[groupName], remainingTokens);
      }
    } else {
      if (!output[groupName]) {
        output[groupName] = tokens;
      } else {
        Object.assign(output[groupName], tokens);
      }
    }
  }

  return output;
}

// ─── Deduplicate cross-group tokens ──────────────────────────────────────────

/**
 * If the same token name appears in multiple groups, remove it from the larger/
 * more generic group. Preference: keep in the smaller, more specific group.
 * "dark" is considered generic (lower priority).
 */
function deduplicateCrossGroup(colorObj) {
  const GENERIC_GROUPS = new Set(['dark']);
  const tokenLocations = new Map(); // tokenName → [{ group, size }]

  for (const [group, tokens] of Object.entries(colorObj)) {
    if (!tokens || typeof tokens !== 'object') continue;
    for (const name of Object.keys(tokens)) {
      if (!tokenLocations.has(name)) tokenLocations.set(name, []);
      tokenLocations.get(name).push({ group, size: Object.keys(tokens).length });
    }
  }

  // For each duplicate, remove from the less-preferred group
  for (const [tokenName, locations] of tokenLocations.entries()) {
    if (locations.length <= 1) continue;

    // Sort: prefer non-generic groups, then smaller groups
    locations.sort((a, b) => {
      const aGeneric = GENERIC_GROUPS.has(a.group) ? 1 : 0;
      const bGeneric = GENERIC_GROUPS.has(b.group) ? 1 : 0;
      if (aGeneric !== bGeneric) return aGeneric - bGeneric;
      return a.size - b.size;
    });

    // Keep in first (best) location, remove from rest
    for (let i = 1; i < locations.length; i++) {
      delete colorObj[locations[i].group][tokenName];
    }
  }

  // Remove any groups that became empty
  for (const [group, tokens] of Object.entries(colorObj)) {
    if (tokens && typeof tokens === 'object' && Object.keys(tokens).length === 0) {
      delete colorObj[group];
    }
  }

  return colorObj;
}


/**
 * Sort tokens within each color group by luminance (dark → light).
 * Scale tokens (with numeric suffix) are sorted by their number first.
 * Non-scale tokens are sorted by computed luminance.
 */
function sortGroupsByLuminance(colorObj) {
  for (const [group, tokens] of Object.entries(colorObj)) {
    if (!tokens || typeof tokens !== 'object') continue;
    const entries = Object.entries(tokens);
    if (entries.length <= 1) continue;

    entries.sort((a, b) => {
      const lumA = hexToLuminance(a[1].hex);
      const lumB = hexToLuminance(b[1].hex);
      // Dark first (lower luminance) → light last (higher luminance)
      return lumA - lumB;
    });

    colorObj[group] = Object.fromEntries(entries);
  }
  return colorObj;
}

/**
 * Convert hex color to relative luminance (0 = black, 1 = white).
 */
function hexToLuminance(hex) {
  if (!hex || !hex.startsWith('#')) return 0.5;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  // sRGB → linear
  const lin = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function ensurePx(value) {
  if (!value) return null;
  if (value.endsWith('px')) return value;
  if (/^-?\d+(\.\d+)?$/.test(value)) return value + 'px';
  if (value.includes('rem')) {
    return value.replace(/([0-9]*\.?[0-9]+)rem/g, (_, num) => {
      const px = Math.round(parseFloat(num) * 16 * 100) / 100;
      return `${px}px`;
    });
  }
  return value;
}

// ─── Entry Point ────────────────────────────────────────────────────────────

function main() {
  const { inputPath, outputPath } = parseArgs(process.argv.slice(2));

  if (!inputPath) {
    console.error('Usage: node css-to-json.mjs <colors_and_type.css> [--output <css.json>]');
    process.exit(2);
  }

  const resolvedInput = path.resolve(inputPath);
  if (!fs.existsSync(resolvedInput)) {
    console.error(`File not found: ${resolvedInput}`);
    process.exit(2);
  }

  const cssContent = fs.readFileSync(resolvedInput, 'utf8');
  const { result, summary } = processCSS(cssContent);

  const resolvedOutput = outputPath
    ? path.resolve(outputPath)
    : path.join(path.dirname(resolvedInput), 'css.json');

  const outputDir = path.dirname(resolvedOutput);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Merge-preserve: retain existing font.assets (managed by frontend GUI, not derivable from CSS)
  if (fs.existsSync(resolvedOutput)) {
    try {
      const existing = JSON.parse(fs.readFileSync(resolvedOutput, 'utf8'));
      if (existing.font && existing.font.assets && Object.keys(existing.font.assets).length > 0) {
        result.font = result.font || {};
        result.font.assets = existing.font.assets;
      }
    } catch (_) {
      // If existing file is invalid JSON, proceed with full overwrite
    }
  }

  fs.writeFileSync(resolvedOutput, JSON.stringify(result, null, 2) + '\n', 'utf8');

  console.error(JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ok: true, output: resolvedOutput, ...summary }, null, 2));
}

main();
