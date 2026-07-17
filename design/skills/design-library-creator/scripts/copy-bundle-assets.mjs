#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { readDataFile, resolveDataPath } from './jsonl-utils.mjs';

function parseArgs(argv) {
  const args = {
    bundle: undefined,
    output: undefined,
    tmp: undefined,
    manifest: undefined,
    splitComponents: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--bundle') {
      args.bundle = argv[i + 1];
      i += 1;
    } else if (arg === '--output') {
      args.output = argv[i + 1];
      i += 1;
    } else if (arg === '--tmp') {
      args.tmp = argv[i + 1];
      i += 1;
    } else if (arg === '--manifest') {
      args.manifest = argv[i + 1];
      i += 1;
    } else if (arg === '--split-components') {
      args.splitComponents = argv[i + 1];
      i += 1;
    }
  }

  return args;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyFile(src, dest, errors) {
  try {
    if (!fs.existsSync(src)) {
      errors.push(`skip: source not found: ${src}`);
      return false;
    }
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    return true;
  } catch (err) {
    errors.push(`copy failed: ${src} -> ${dest}: ${err.message}`);
    return false;
  }
}

function copyOptionalFile(src, dest, warnings) {
  try {
    if (!fs.existsSync(src)) {
      warnings.push(`optional source not found: ${src}`);
      return false;
    }
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    return true;
  } catch (err) {
    warnings.push(`optional copy failed: ${src} -> ${dest}: ${err.message}`);
    return false;
  }
}

/** 检测不可升级的 v1 证据（semanticTypeCandidates 系旧格式，无 identity/renderFacts） */
function isLegacyV1Evidence(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.renderFacts || data.identity) return false;
  return Array.isArray(data.semanticTypeCandidates) || (Number(data.schemaVersion) === 1 && data.representativeVariants);
}

function normalizeToV6(data) {
  if (!data || typeof data !== 'object') return data;
  // Already v6
  if (data.contractKind === 'llm-render-facts' && data.renderFacts && data.schemaVersion >= 6) return data;
  // Old flat format: has identity at top level but no renderFacts wrapper
  if (data.identity && data.consumptionOrder && !data.renderFacts) {
    const { slug, name, componentClass, intentKind, identity, consumptionOrder, controlMatrix, geometry, patterns, contentPolicy, renderObligations, iconSlots, icons, sourceRefs, unknowns, riskNotes, ...rest } = data;
    return {
      schemaVersion: 6,
      contractKind: 'llm-render-facts',
      slug,
      name,
      componentClass,
      renderFacts: {
        intentKind: intentKind ?? identity?.normalizedKind ?? 'component',
        identity: identity ?? { sourceName: name, normalizedKind: 'component', rule: 'source-identity-is-authoritative' },
        consumptionOrder: consumptionOrder ?? ['identity', 'controlMatrix', 'patterns', 'geometry', 'contentPolicy', 'renderObligations', 'iconSlots', 'unknowns'],
        controlMatrix: controlMatrix ?? {},
        geometry: geometry ?? { hasEffects: false, forbiddenCss: ['invented-local-css-vars'] },
        patterns: patterns ?? {},
        contentPolicy: contentPolicy ?? { copySource: 'unknown', allowedModes: ['empty-structure'], forbiddenModes: ['skeleton-bars', 'invented-product-data'] },
        renderObligations: renderObligations ?? [],
        iconSlots: iconSlots ?? [],
        icons: icons ?? { bundle: [], lucide: [], unknownFallback: 'circle-help' },
        sourceRefs: sourceRefs ?? [],
        unknowns: unknowns ?? [],
        riskNotes: riskNotes ?? [],
      },
    };
  }
  return data;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.bundle || !args.output || !args.tmp || !args.manifest) {
    console.error('Usage: copy-bundle-assets.mjs --bundle <path> --output <path> --tmp <path> --manifest <path> [--split-components <path>]');
    process.exit(1);
  }

  const bundleDir = path.resolve(args.bundle);
  const outputDir = path.resolve(args.output);
  const tmpDir = path.resolve(args.tmp);
  const manifestPath = path.resolve(args.manifest);

  // Read manifest (supports .jsonl and .json)
  const resolvedManifest = resolveDataPath(manifestPath);
  if (!fs.existsSync(resolvedManifest)) {
    console.error(`Critical: manifest not found: ${resolvedManifest}`);
    process.exit(1);
  }

  let manifest;
  try {
    manifest = readDataFile(resolvedManifest);
  } catch (err) {
    console.error(`Critical: failed to parse manifest: ${err.message}`);
    process.exit(1);
  }

  const errors = [];
  const warnings = [];
  let copiedFiles = 0;
  let iconsCopied = 0;
  let evidenceCopied = 0;
  let evidenceConverted = 0;
  let previewAssetsCopied = 0;
  const iconNames = [];

  // Ensure output and tmp directories exist
  ensureDir(outputDir);
  ensureDir(tmpDir);

  // Copy structural files only.
  // NOTE: Does NOT copy token files (colors_and_type.css, css.json).
  // Those are LLM-generated at runtime. See workflows/create-library.md § 2.3b.
  const splitComponentsDir = args.splitComponents ? path.resolve(args.splitComponents) : undefined;
  const componentsDir = splitComponentsDir && (fs.existsSync(path.join(splitComponentsDir, 'index.jsonl')) || fs.existsSync(path.join(splitComponentsDir, 'index.json')))
    ? splitComponentsDir
    : path.join(bundleDir, 'generated', 'components');
  const usingSplitComponents = componentsDir === splitComponentsDir;

  // Copy component evidence files to output/components/_evidence/.
  // Bundle now outputs compact evidence directly at generated/components/{slug}.jsonl
  // (no longer in a _evidence/ subfolder). DL Creator maps them to _evidence/ for
  // Phase 3 merged component synthesis to refine into output/components/{slug}.json.
  const copiedEvidenceDestNames = new Set();
  const componentIndexPath = resolveDataPath(path.join(componentsDir, 'index.json'));
  // 组件 index 复制：改写 index 内的 evidenceFile/fullJsonFile 为 _evidence/ 实际路径
  // （bundle 内是 generated/components/{slug}.jsonl 相对路径，原样透传会使 uikit-plan 指向不存在文件）。
  // Token-Only bundle 没有组件目录属正常情况，缺失走 warnings 而非 errors。
  if (!fs.existsSync(componentIndexPath)) {
    warnings.push(`optional source not found: ${componentIndexPath} (Token-Only bundle or no components)`);
  } else {
    try {
      const indexData = readDataFile(componentIndexPath);
      if (indexData && Array.isArray(indexData.components)) {
        for (const component of indexData.components) {
          if (component && typeof component.slug === 'string') {
            const evidenceRel = `components/_evidence/${component.slug}.json`;
            if (typeof component.evidenceFile === 'string') component.evidenceFile = evidenceRel;
            if (typeof component.fullJsonFile === 'string') component.fullJsonFile = evidenceRel;
          }
        }
      }
      const indexDest = path.join(outputDir, 'components', '_evidence', 'index.json');
      ensureDir(path.dirname(indexDest));
      fs.writeFileSync(indexDest, `${JSON.stringify(indexData, null, 2)}\n`, 'utf8');
      copiedFiles += 1;
      evidenceCopied += 1;
      evidenceConverted += 1;
      copiedEvidenceDestNames.add('index.json');
    } catch (err) {
      errors.push(`data copy failed: ${componentIndexPath}: ${err.message}`);
    }
  }

  if (fs.existsSync(componentsDir)) {
    try {
      const entries = fs.readdirSync(componentsDir);
      for (const entry of entries) {
        if ((entry.endsWith('.jsonl') || entry.endsWith('.json')) && entry !== 'index.jsonl' && entry !== 'index.json') {
          const srcPath = path.join(componentsDir, entry);
          if (!fs.statSync(srcPath).isFile()) continue;
          const destName = entry.replace(/\.jsonl?$/, '.json');
          if (copiedEvidenceDestNames.has(destName)) continue;
          const destPath = path.join(outputDir, 'components', '_evidence', destName);
          try {
            if (!fs.existsSync(srcPath)) {
              errors.push(`skip: source not found: ${srcPath}`);
              continue;
            }
            // Before writing evidence file, normalize to v6
            const rawData = readDataFile(srcPath);
            // 不可升级的 v1 旧格式证据：不放入 _evidence/（避免 Phase 3 子 Agent 集体 FATAL:invalid-evidence-contract），
            // 报 error 提示工作流降级到 manifest.shortlist fallback
            if (destName !== 'index.json' && isLegacyV1Evidence(rawData)) {
              errors.push(`legacy-v1-evidence: ${srcPath} uses unsupported schemaVersion=1 format; excluded from _evidence/. Re-export the bundle with a newer parser, or fall back to manifest.shortlist component synthesis.`);
              continue;
            }
            const normalizedData = destName !== 'index.json' ? normalizeToV6(rawData) : rawData;
            ensureDir(path.dirname(destPath));
            fs.writeFileSync(destPath, `${JSON.stringify(normalizedData, null, 2)}\n`, 'utf8');
            copiedFiles += 1;
            evidenceCopied += 1;
            evidenceConverted += 1;
            copiedEvidenceDestNames.add(destName);
          } catch (err) {
            errors.push(`data copy failed: ${srcPath} -> ${destPath}: ${err.message}`);
          }
        }
      }
    } catch (err) {
      errors.push(`failed to read components dir: ${err.message}`);
    }
  }

  const planningInputPath = resolveDataPath(path.join(bundleDir, 'generated', 'uikit-planning-input.json'));
  const planningDestName = path.basename(planningInputPath);
  if (copyOptionalFile(planningInputPath, path.join(tmpDir, planningDestName), warnings)) {
    copiedFiles += 1;
  }

  const visualPreviewPath = path.join(bundleDir, 'context', 'visual-preview.md');
  if (copyOptionalFile(visualPreviewPath, path.join(outputDir, 'context', 'visual-preview.md'), warnings)) {
    copiedFiles += 1;
  }

  const bundlePreviewDir = path.join(bundleDir, 'assets', 'previews');
  if (fs.existsSync(bundlePreviewDir)) {
    try {
      const entries = fs.readdirSync(bundlePreviewDir);
      for (const entry of entries) {
        const srcPath = path.join(bundlePreviewDir, entry);
        if (!fs.statSync(srcPath).isFile()) continue;
        const destPath = path.join(outputDir, 'assets', 'previews', entry);
        if (copyFile(srcPath, destPath, errors)) {
          copiedFiles += 1;
          previewAssetsCopied += 1;
        }
      }
    } catch (err) {
      errors.push(`failed to read preview assets dir: ${err.message}`);
    }
  }

  // Copy icon SVGs conditionally
  const iconsDir = path.join(bundleDir, 'assets', 'icons');
  if (fs.existsSync(iconsDir)) {
    let allSvgs;
    try {
      allSvgs = fs.readdirSync(iconsDir).filter((f) => f.endsWith('.svg'));
    } catch (err) {
      allSvgs = [];
      errors.push(`failed to read icons dir: ${err.message}`);
    }

    if (allSvgs.length > 0) {
      // Determine which icons to copy
      const availableIcons = manifest.assetAvailability?.availableIcons;
      let iconsToCopy;

      if (Array.isArray(availableIcons) && availableIcons.length > 0) {
        // Only copy icons listed in manifest
        iconsToCopy = availableIcons
          .map((name) => (name.endsWith('.svg') ? name : `${name}.svg`))
          .filter((fileName) => allSvgs.includes(fileName));
      } else {
        // Copy all SVGs
        iconsToCopy = allSvgs;
      }

      if (iconsToCopy.length > 0) {
        const outputIconsDir = path.join(outputDir, 'assets', 'icons');
        ensureDir(outputIconsDir);

        for (const fileName of iconsToCopy) {
          const srcPath = path.join(iconsDir, fileName);
          const destPath = path.join(outputIconsDir, fileName);
          if (copyFile(srcPath, destPath, errors)) {
            copiedFiles += 1;
            iconsCopied += 1;
            iconNames.push(path.basename(fileName, '.svg'));
          }
        }
      }
    }
  }

  // Output result as JSON
  const result = {
    copiedFiles,
    iconsCopied,
    evidenceCopied,
    evidenceConverted,
    evidenceContract: 'json',
    evidenceSourceDir: path.relative(bundleDir, componentsDir) || 'generated/components',
    previewAssetsCopied,
    iconNames,
    usingSplitComponents,
    warnings,
    errors,
  };

  console.log(JSON.stringify(result, undefined, 2));
  process.exit(errors.length > 0 ? 1 : 0);
}

main();
