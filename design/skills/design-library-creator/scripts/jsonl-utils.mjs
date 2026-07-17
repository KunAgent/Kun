/**
 * JSONL utilities for reading/writing bundle JSONL files.
 *
 * The Figma parser outputs all generated/*.jsonl files with:
 * - Line 0: meta line ({_type:'meta', format:'<name>/v1', lines:[...]})
 * - Line 1+: data lines (each with _type field identifying its role)
 *
 * This utility reconstructs the original JSON object shapes from JSONL lines,
 * allowing scripts that previously consumed JSON to work with minimal changes.
 */

import fs from 'node:fs';

// ─── Public API ──────────────────────────────────────────────────────────────

/** Read a JSONL file, return array of parsed line objects */
export function readJsonlLines(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map((l, i) => {
    try {
      return JSON.parse(l);
    } catch (e) {
      throw new Error(`Invalid JSON at line ${i + 1} in ${filePath}: ${e.message}`);
    }
  });
}

/** Find first line with given _type */
export function findLine(lines, type) {
  return lines.find(l => l._type === type);
}

/** Find all lines with given _type */
export function filterLines(lines, type) {
  return lines.filter(l => l._type === type);
}

/** Write array of objects as JSONL */
export function writeJsonlLines(filePath, lines) {
  fs.writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf8');
}

/**
 * Read a data file, auto-detecting format by extension.
 * - .jsonl → parse lines, reconstruct into original object shape
 * - .json → standard JSON.parse
 */
export function readDataFile(filePath) {
  if (filePath.endsWith('.jsonl')) {
    const lines = readJsonlLines(filePath);
    if (lines.length === 0) return {};
    const meta = lines[0];
    const data = lines.slice(1);
    return reconstructObject(meta, data);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Resolve a file path, checking .jsonl first then .json fallback.
 * Returns the path that exists, or the .jsonl variant if neither exists.
 */
export function resolveDataPath(basePath) {
  if (basePath.endsWith('.json')) {
    const jsonlPath = basePath.replace(/\.json$/, '.jsonl');
    if (fs.existsSync(jsonlPath)) return jsonlPath;
    if (fs.existsSync(basePath)) return basePath;
    return jsonlPath;
  }
  if (basePath.endsWith('.jsonl')) {
    if (fs.existsSync(basePath)) return basePath;
    const jsonPath = basePath.replace(/\.jsonl$/, '.json');
    if (fs.existsSync(jsonPath)) return jsonPath;
    return basePath;
  }
  return basePath;
}

// ─── Format-specific reconstruction ─────────────────────────────────────────

function reconstructObject(meta, data) {
  if (!meta || meta._type !== 'meta') {
    // Not a valid JSONL meta line, merge all lines as fallback
    const result = {};
    for (const line of [meta, ...data]) Object.assign(result, stripType(line));
    return result;
  }

  switch (meta.format) {
    case 'bundle-manifest/v1': {
      const stats = stripType(findLine(data, 'stats')) || {};
      const shortlistLine = findLine(data, 'shortlist');
      const nav = stripType(findLine(data, 'navigation')) || {};
      const generatedFiles = filterLines(data, 'generatedFile').map(l => l.path);
      // splitHint may be on stats line
      const { splitHint, ...statsRest } = stats;
      return { stats: splitHint ? { ...statsRest, splitHint } : statsRest, shortlist: shortlistLine?.items || [], ...nav, generatedFiles };
    }

    case 'component-evidence/v1': {
      const signals = stripType(findLine(data, 'signals')) || {};
      const variants = filterLines(data, 'variant').map(stripType);
      const hints = stripType(findLine(data, 'hints')) || {};
      return { ...signals, representativeVariants: variants, ...hints };
    }

    case 'render-contract/v1': {
      const signals = stripType(findLine(data, 'signals')) || {};
      const renderPlan = stripType(findLine(data, 'renderPlan')) || {};
      const visualSpecs = stripType(findLine(data, 'visualSpecs')) || {};
      const hints = stripType(findLine(data, 'hints')) || {};
      return { ...signals, renderPlan, visualSpecs, ...hints };
    }

    case 'evidence-index/v1':
    case 'components-index/v1': {
      const header = stripType(findLine(data, 'header')) || {};
      const components = filterLines(data, 'component').map(stripType);
      return { ...header, components };
    }

    case 'component-detail/v1': {
      const header = stripType(findLine(data, 'header')) || {};
      const structures = filterLines(data, 'structure').map(stripType);
      return { ...header, structures };
    }

    case 'uikit-planning-input/v1': {
      const header = stripType(findLine(data, 'header')) || {};
      const candidates = filterLines(data, 'candidate').map(stripType);
      return { ...header, candidateComponents: candidates };
    }

    case 'brand-input/v1': {
      const identity = stripType(findLine(data, 'identity')) || {};
      const visual = stripType(findLine(data, 'visual')) || {};
      const categories = filterLines(data, 'category').map(stripType);
      const copySignals = stripType(findLine(data, 'copySignals')) || {};
      return { ...identity, ...visual, categories, ...copySignals };
    }

    case 'design-tokens/v1': {
      const overviewLine = findLine(data, 'overview');
      const themeSignals = stripType(findLine(data, 'themeSignals')) || {};
      const variableSets = filterLines(data, 'variableSet').map(stripType);
      const semanticLine = findLine(data, 'semanticColors');
      const typographyLine = stripType(findLine(data, 'typography')) || {};
      const spacingLine = stripType(findLine(data, 'spacing')) || {};
      const radiusLine = stripType(findLine(data, 'radius')) || {};
      const shadowsLine = findLine(data, 'shadows');
      const componentUsageLine = stripType(findLine(data, 'componentUsage')) || {};
      const specAnnotationsLine = findLine(data, 'specAnnotations');
      return {
        meta: overviewLine?.meta,
        themeSignals,
        colors: { variableSets, resolvedSemanticColors: semanticLine?.items || [], fromVisualAnnotations: semanticLine?.fromVisualAnnotations || [] },
        typography: typographyLine,
        spacing: spacingLine,
        radius: radiusLine,
        shadows: shadowsLine?.items || [],
        componentUsage: componentUsageLine,
        specAnnotations: specAnnotationsLine?.items || [],
        designerNotes: specAnnotationsLine?.designerNotes || [],
      };
    }

    case 'annotations-summary/v1': {
      const stats = stripType(findLine(data, 'stats')) || {};
      const { warnings, ...statsRest } = stats;
      const tokenLikeNotes = filterLines(data, 'tokenNote').map(stripType);
      const brandLikeCopies = filterLines(data, 'brandCopy').map(stripType);
      const topUiCopies = filterLines(data, 'uiCopy').map(stripType);
      return { stats: statsRest, tokenLikeNotes, brandLikeCopies, topUiCopies, warnings: warnings || [] };
    }

    default: {
      // Fallback: merge all non-array lines, collect repeated types as arrays
      const result = {};
      for (const line of data) Object.assign(result, stripType(line));
      return result;
    }
  }
}

function stripType(obj) {
  if (!obj) return null;
  const { _type, ...rest } = obj;
  return rest;
}
