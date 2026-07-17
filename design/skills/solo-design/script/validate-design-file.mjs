#!/usr/bin/env node

/**
 * Validate the JSON format and type structure of a .design file.
 *
 * Usage: node validate-design-file.mjs <design-file-path> [--expected-pages=N] [--require-interactions=domId1:file1.html,domId2:file2.html,...]
 *
 * Checks:
 *   1.  JSON syntax validity (parseable by JSON.parse)
 *   2.  Top-level structure: must contain a data array
 *   3.  Required fields and types on every node
 *   4.  page node devMetadata (htmlSrc / interactions)
 *   5.  theme node devMetadata (sourceId)
 *   6.  canvasData validation (x / y / group)
 *   7.  id uniqueness
 *   8.  interactions targetPageId must reference an existing page node
 *   9.  config.deviceType allowed values (desktop / mobile / tablet / freeSize only)
 *  10.  HTML file existence for each page node's htmlSrc
 *  11.  .theme file existence for each theme node's sourceId
 *  12.  data array non-empty (at least one node required)
 *  13.  At least one usable content node (page or image); theme nodes are legacy optional
 *  14.  Page count check (when --expected-pages is provided): detects pages lost
 *       due to incorrect Main Agent .design writes
 *  15.  Reverse coverage check: every HTML file in pages/ must have a registered
 *       page node in the data array
 *  16.  domId existence check: for every interaction domId in the .design file,
 *       verify that the corresponding HTML file contains data-dom-id="{domId}"
 *  17.  Required interactions check (when --require-interactions is provided):
 *       verify that each specified domId exists in the HTML AND is registered
 *       in the .design interactions for the corresponding page node
 *  18.  Cross-version reachability check: when any page node carries
 *       devMetadata.supersedesPageId, verify (a) the field references an
 *       existing page node id without self-reference or cycles, (b) every
 *       superseded page's interactions is an empty array (retired pages must
 *       not navigate), and (c) no page's interactions targets a superseded
 *       page id (incoming edges must be redirected to the newest version)
 *
 * Exit codes: 0 = passed, 1 = failed
 */

import fs from 'node:fs';
import path from 'node:path';

const VALID_NODE_TYPES = ['page', 'theme', 'image'];
const VALID_DEVICE_TYPES = ['desktop', 'mobile', 'tablet', 'freeSize'];
const REQUIRED_DESIGN_LIBRARY_FIELDS = ['name', 'id', 'version', 'scope', 'path', 'versionSource'];

const errors = [];

function addError(loc, message) {
  errors.push(`[${loc}] ${message}`);
}

function isNonNegativeInteger(val) {
  return Number.isInteger(val) && val >= 0;
}

function isPositiveInteger(val) {
  return Number.isInteger(val) && val > 0;
}

function isFiniteNumber(val) {
  return typeof val === 'number' && Number.isFinite(val);
}

function validateInteraction(interaction, nodePath, pageIds) {
  if (typeof interaction !== 'object' || interaction === null || Array.isArray(interaction)) {
    addError(nodePath, 'interaction must be an object');
    return;
  }

  if (typeof interaction.domId !== 'string' || interaction.domId.length === 0) {
    addError(`${nodePath}.domId`, 'must be a non-empty string');
  }

  if (typeof interaction.targetPageId !== 'string' || interaction.targetPageId.length === 0) {
    addError(`${nodePath}.targetPageId`, 'must be a non-empty string');
  } else if (!pageIds.has(interaction.targetPageId)) {
    addError(`${nodePath}.targetPageId`, `must reference an existing page node id, got "${interaction.targetPageId}"`);
  }

  if (interaction.hideEdge !== undefined && typeof interaction.hideEdge !== 'boolean') {
    addError(`${nodePath}.hideEdge`, 'must be a boolean');
  }
}

function validateDesignLibraryIdentity(identity, nodePath) {
  if (identity === null) return;

  if (typeof identity !== 'object' || Array.isArray(identity)) {
    addError(nodePath, 'must be an object or null');
    return;
  }

  for (const field of REQUIRED_DESIGN_LIBRARY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(identity, field)) {
      addError(`${nodePath}.${field}`, 'must exist; use null when unavailable');
      continue;
    }

    const value = identity[field];
    if (field === 'version') {
      if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
        addError(`${nodePath}.${field}`, 'must be a string, number, or null');
      }
    } else if (value !== null && typeof value !== 'string') {
      addError(`${nodePath}.${field}`, 'must be a string or null');
    }
  }
}

function validateCanvasData(canvasData, nodePath, nodeType) {
  if (typeof canvasData !== 'object' || canvasData === null || Array.isArray(canvasData)) {
    addError(`${nodePath}.canvasData`, 'must be an object');
    return;
  }

  if (!isFiniteNumber(canvasData.x)) {
    addError(`${nodePath}.canvasData.x`, 'must be a finite number');
  }
  if (!isFiniteNumber(canvasData.y)) {
    addError(`${nodePath}.canvasData.y`, 'must be a finite number');
  }
  if (nodeType !== 'image' && !isNonNegativeInteger(canvasData.group)) {
    addError(`${nodePath}.canvasData.group`, 'must be a non-negative integer');
  }
  if (nodeType === 'image' && Object.prototype.hasOwnProperty.call(canvasData, 'group')) {
    addError(`${nodePath}.canvasData.group`, 'must not exist on image nodes');
  }
}

function slugFromHtmlSrc(htmlSrc) {
  return htmlSrc.replace(/^pages\//, '').replace(/\.html$/, '');
}

function validatePageDevMetadata(devMetadata, nodePath, pageIds, nodeId) {
  if (typeof devMetadata.htmlSrc !== 'string' || devMetadata.htmlSrc.length === 0) {
    addError(`${nodePath}.devMetadata.htmlSrc`, 'must be a non-empty string');
  } else if (!devMetadata.htmlSrc.startsWith('pages/') || !devMetadata.htmlSrc.endsWith('.html')) {
    addError(`${nodePath}.devMetadata.htmlSrc`, `invalid format, expected "pages/<name>.html", got "${devMetadata.htmlSrc}"`);
  } else if (typeof nodeId === 'string') {
    const expectedId = `page-${slugFromHtmlSrc(devMetadata.htmlSrc)}`;
    const numericSuffixPattern = new RegExp(`^${expectedId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`);
    if (nodeId !== expectedId && !numericSuffixPattern.test(nodeId)) {
      addError(`${nodePath}.id`, `must match htmlSrc slug, expected "${expectedId}" or "${expectedId}-<n>", got "${nodeId}"`);
    }
  }

  if (devMetadata.interactions !== undefined) {
    if (!Array.isArray(devMetadata.interactions)) {
      addError(`${nodePath}.devMetadata.interactions`, 'must be an array');
    } else {
      devMetadata.interactions.forEach((interaction, i) => {
        validateInteraction(interaction, `${nodePath}.devMetadata.interactions[${i}]`, pageIds);
      });
    }
  }

  if (devMetadata.supersedesPageId !== undefined) {
    if (typeof devMetadata.supersedesPageId !== 'string' || devMetadata.supersedesPageId.length === 0) {
      addError(`${nodePath}.devMetadata.supersedesPageId`, 'must be a non-empty string when present');
    } else if (!pageIds.has(devMetadata.supersedesPageId)) {
      addError(`${nodePath}.devMetadata.supersedesPageId`, `must reference an existing page node id, got "${devMetadata.supersedesPageId}"`);
    }
  }
}

function validateThemeDevMetadata(devMetadata, nodePath) {
  if (typeof devMetadata.sourceId !== 'string' || devMetadata.sourceId.length === 0) {
    addError(`${nodePath}.devMetadata.sourceId`, 'must be a non-empty string');
  }
}

function validateImageDevMetadata(devMetadata, nodePath) {
  if (typeof devMetadata.imageSrc !== 'string' || devMetadata.imageSrc.length === 0) {
    addError(`${nodePath}.devMetadata.imageSrc`, 'must be a non-empty string');
  } else if (!devMetadata.imageSrc.startsWith('assets/')) {
    addError(`${nodePath}.devMetadata.imageSrc`, `invalid format, expected to start with "assets/", got "${devMetadata.imageSrc}"`);
  }
}

function validateNode(node, index, pageIds) {
  const nodePath = `data[${index}]`;

  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    addError(nodePath, 'node must be an object');
    return;
  }

  if (typeof node.id !== 'string' || node.id.length === 0) {
    addError(`${nodePath}.id`, 'must be a non-empty string');
  } else if (node.type === 'page' && !/^page-[a-z0-9]+(?:-[a-z0-9]+)*(?:-\d+)?$/.test(node.id)) {
    addError(`${nodePath}.id`, `invalid page id "${node.id}", expected page-{slug}`);
  } else if (node.type === 'image' && !/^image-\d{3,}$/.test(node.id)) {
    addError(`${nodePath}.id`, `invalid image id "${node.id}", expected image-001 style`);
  } else if (node.type === 'theme' && !/^theme-[a-z0-9]+(?:-[a-z0-9]+)*(?:-\d+)?$/.test(node.id)) {
    addError(`${nodePath}.id`, `invalid legacy theme id "${node.id}", expected theme-{slug}`);
  }

  if (typeof node.title !== 'string') {
    addError(`${nodePath}.title`, 'must be a string');
  }

  if (!VALID_NODE_TYPES.includes(node.type)) {
    addError(`${nodePath}.type`, `invalid value "${node.type}", allowed: ${VALID_NODE_TYPES.join(' | ')}`);
  }

  if (!isPositiveInteger(node.version)) {
    addError(`${nodePath}.version`, 'must be a positive integer');
  }

  if (!isPositiveInteger(node.createdAt)) {
    addError(`${nodePath}.createdAt`, 'must be a positive integer (timestamp)');
  }

  if (typeof node.devMetadata !== 'object' || node.devMetadata === null || Array.isArray(node.devMetadata)) {
    addError(`${nodePath}.devMetadata`, 'must be an object');
  } else {
    if (node.type === 'page') {
      validatePageDevMetadata(node.devMetadata, nodePath, pageIds, node.id);
    } else if (node.type === 'theme') {
      validateThemeDevMetadata(node.devMetadata, nodePath);
    } else if (node.type === 'image') {
      validateImageDevMetadata(node.devMetadata, nodePath);
    }
  }

  validateCanvasData(node.canvasData, nodePath, node.type);
}

function validateDesignFile(filePath, expectedPages, requireInteractions) {
  if (!fs.existsSync(filePath)) {
    addError('file', `file not found: ${filePath}`);
    return;
  }

  const raw = fs.readFileSync(filePath, 'utf-8');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    addError('JSON', `JSON parse error: ${e.message}`);
    return;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    addError('root', 'root must be a JSON object { "data": [...] }');
    return;
  }

  if (!Array.isArray(parsed.data)) {
    addError('root.data', 'missing data field or data is not an array');
    return;
  }

  if (parsed.config !== undefined) {
    if (typeof parsed.config !== 'object' || parsed.config === null || Array.isArray(parsed.config)) {
      addError('root.config', 'config must be an object');
    } else {
      if (parsed.config.autoLayout !== undefined && typeof parsed.config.autoLayout !== 'boolean') {
        addError('root.config.autoLayout', 'must be a boolean');
      }
      if (parsed.config.deviceType !== undefined && !VALID_DEVICE_TYPES.includes(parsed.config.deviceType)) {
        addError(
          'root.config.deviceType',
          `invalid value "${parsed.config.deviceType}", allowed: ${VALID_DEVICE_TYPES.join(' | ')}`
        );
      }
      if (parsed.config.designLibrary !== undefined) {
        validateDesignLibraryIdentity(parsed.config.designLibrary, 'root.config.designLibrary');
      }
    }
  }

  const allIds = new Set();
  const pageIds = new Set();
  const duplicateIds = [];

  parsed.data.forEach((node, i) => {
    if (node && typeof node.id === 'string') {
      if (allIds.has(node.id)) {
        duplicateIds.push({ id: node.id, index: i });
      }
      allIds.add(node.id);
      if (node.type === 'page') {
        pageIds.add(node.id);
      }
    }
  });

  if (duplicateIds.length > 0) {
    duplicateIds.forEach(({ id, index }) => {
      addError(`data[${index}].id`, `duplicate id "${id}"`);
    });
  }

  parsed.data.forEach((node, index) => {
    validateNode(node, index, pageIds);
  });

  const designDir = path.dirname(path.resolve(filePath));

  parsed.data.forEach((node, index) => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      return;
    }
    if (typeof node.devMetadata !== 'object' || node.devMetadata === null || Array.isArray(node.devMetadata)) {
      return;
    }

    if (node.type === 'page') {
      if (typeof node.devMetadata.htmlSrc === 'string' && node.devMetadata.htmlSrc.length > 0) {
        const htmlPath = path.resolve(designDir, node.devMetadata.htmlSrc);
        if (!fs.existsSync(htmlPath)) {
          addError(`data[${index}].devMetadata.htmlSrc`, `HTML file not found: ${htmlPath}`);
        }
      }
    } else if (node.type === 'theme') {
      if (typeof node.devMetadata.sourceId === 'string' && node.devMetadata.sourceId.length > 0) {
        const themePath = path.resolve(designDir, `theme/${node.devMetadata.sourceId}.theme`);
        if (!fs.existsSync(themePath)) {
          addError(`data[${index}].devMetadata.sourceId`, `theme file not found: ${themePath}`);
        }
      }
    } else if (node.type === 'image') {
      if (typeof node.devMetadata.imageSrc === 'string' && node.devMetadata.imageSrc.length > 0) {
        const imagePath = path.resolve(designDir, node.devMetadata.imageSrc);
        if (!fs.existsSync(imagePath)) {
          addError(`data[${index}].devMetadata.imageSrc`, `image file not found: ${imagePath}`);
        }
      }
    }
  });

  if (parsed.data.length === 0) {
    addError('root.data', 'data array must not be empty, at least one node required');
  }

  // 13. At least one usable content node required. Theme nodes are legacy optional.
  const hasContentNode = parsed.data.some(
    (node) =>
      typeof node === 'object' &&
      node !== null &&
      !Array.isArray(node) &&
      (node.type === 'page' || node.type === 'image')
  );
  if (parsed.data.length > 0 && !hasContentNode) {
    addError('root.data', 'data array must contain at least one page or image node; theme nodes are legacy optional');
  }

  if (expectedPages !== undefined) {
    const actualPages = parsed.data.filter(
      (node) => typeof node === 'object' && node !== null && !Array.isArray(node) && node.type === 'page'
    ).length;
    if (actualPages !== expectedPages) {
      addError(
        'root.data',
        `page count mismatch: expected ${expectedPages} page node(s), got ${actualPages}. ` +
        `Possible cause: Main Agent .design update missed or removed page nodes. ` +
        `Fix: check HTML files under pages/ and re-append missing page nodes to the data array`
      );
    }
  }

  // 15. reverse coverage check: every HTML file in pages/ must have a registered page node in data
  const pagesDir = path.resolve(designDir, 'pages');
  if (fs.existsSync(pagesDir)) {
    const registeredHtmlSrcs = new Set();
    parsed.data.forEach((node) => {
      if (
        typeof node === 'object' && node !== null && !Array.isArray(node) &&
        node.type === 'page' &&
        typeof node.devMetadata === 'object' && node.devMetadata !== null &&
        typeof node.devMetadata.htmlSrc === 'string'
      ) {
        // strip query params before comparing
        const src = node.devMetadata.htmlSrc.split('?')[0];
        registeredHtmlSrcs.add(src);
      }
    });

    const htmlFiles = fs.readdirSync(pagesDir).filter((f) => f.endsWith('.html'));
    htmlFiles.forEach((file) => {
      const relativePath = `pages/${file}`;
      if (!registeredHtmlSrcs.has(relativePath)) {
        addError(
          'pages/' + file,
          `HTML file exists but is not registered in canvas: ${relativePath} exists in pages/ ` +
          `but has no corresponding page node in the .design file's data array. ` +
          `Fix: add a page node for this file to the data array`
        );
      }
    });
  }

  // 16. domId existence check: for every interaction domId registered in .design,
  //     verify the domId actually exists in the corresponding HTML file.
  parsed.data.forEach((node, index) => {
    if (
      typeof node !== 'object' || node === null || Array.isArray(node) ||
      node.type !== 'page' ||
      typeof node.devMetadata !== 'object' || node.devMetadata === null ||
      !Array.isArray(node.devMetadata.interactions) ||
      node.devMetadata.interactions.length === 0
    ) {
      return;
    }

    if (typeof node.devMetadata.htmlSrc !== 'string' || node.devMetadata.htmlSrc.length === 0) {
      return;
    }

    const htmlPath = path.resolve(designDir, node.devMetadata.htmlSrc);
    if (!fs.existsSync(htmlPath)) {
      return; // already reported in check 10
    }

    let htmlContent;
    try {
      htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    } catch (e) {
      return;
    }

    node.devMetadata.interactions.forEach((interaction, i) => {
      if (typeof interaction.domId !== 'string' || interaction.domId.length === 0) {
        return; // already reported in validateInteraction
      }
      const domIdAttr = `data-dom-id="${interaction.domId}"`;
      if (!htmlContent.includes(domIdAttr)) {
        addError(
          `data[${index}].devMetadata.interactions[${i}].domId`,
          `domId "${interaction.domId}" is registered in .design but not found in HTML file ` +
          `"${node.devMetadata.htmlSrc}". ` +
          `Fix: add data-dom-id="${interaction.domId}" to the corresponding element in the HTML file, ` +
          `or remove this interaction entry if the link no longer exists.`
        );
      }
    });
  });

  // 17. Required interactions check: verify that each domId in --require-interactions
  //     (a) exists in the corresponding HTML file, and
  //     (b) is registered in the .design interactions for the matching page node.
  if (requireInteractions && requireInteractions.length > 0) {
    // Build lookup: htmlFileName (basename) -> page node
    const htmlFileToNode = new Map();
    parsed.data.forEach((node) => {
      if (
        typeof node === 'object' && node !== null && !Array.isArray(node) &&
        node.type === 'page' &&
        typeof node.devMetadata === 'object' && node.devMetadata !== null &&
        typeof node.devMetadata.htmlSrc === 'string'
      ) {
        const basename = path.basename(node.devMetadata.htmlSrc);
        htmlFileToNode.set(basename, node);
        // also allow match without .html extension
        htmlFileToNode.set(node.devMetadata.htmlSrc, node);
      }
    });

    for (const { domId, htmlFile } of requireInteractions) {
      // (a) check domId exists in HTML
      const node = htmlFileToNode.get(htmlFile) || htmlFileToNode.get(path.basename(htmlFile));
      const htmlSrc = node ? node.devMetadata.htmlSrc : `pages/${htmlFile}`;
      const htmlPath = path.resolve(designDir, htmlSrc);

      let htmlContent = null;
      if (fs.existsSync(htmlPath)) {
        try {
          htmlContent = fs.readFileSync(htmlPath, 'utf-8');
        } catch (e) {
          // ignore read errors, already reported elsewhere
        }
      }

      const domIdAttr = `data-dom-id="${domId}"`;
      if (htmlContent !== null && !htmlContent.includes(domIdAttr)) {
        addError(
          'require-interactions',
          `domId "${domId}" expected in "${htmlSrc}" but data-dom-id="${domId}" not found in the HTML file. ` +
          `Fix: add data-dom-id="${domId}" to the intended interactive element.`
        );
      }

      // (b) check domId is registered in .design interactions
      if (!node) {
        addError(
          'require-interactions',
          `Cannot verify interaction for domId "${domId}": no page node found for HTML file "${htmlFile}".`
        );
      } else {
        const interactions = Array.isArray(node.devMetadata.interactions) ? node.devMetadata.interactions : [];
        const registered = interactions.some((ia) => ia.domId === domId);
        if (!registered) {
          addError(
            'require-interactions',
            `domId "${domId}" (page: "${node.title}", file: "${node.devMetadata.htmlSrc}") ` +
            `is not registered in .design interactions. ` +
            `Fix: add an interaction entry { "domId": "${domId}", "targetPageId": "<target>" } ` +
            `to this page node's devMetadata.interactions array.`
          );
        }
      }
    }
  }

  // 18. Cross-version reachability check: superseded pages must be retired from
  //     preview navigation — no incoming interaction may target them and their
  //     own interactions must be empty.
  validateCrossVersionReachability(parsed);
}

function validateCrossVersionReachability(parsed) {
  const pageNodes = parsed.data.filter(
    (node) =>
      typeof node === 'object' && node !== null && !Array.isArray(node) &&
      node.type === 'page' &&
      typeof node.devMetadata === 'object' && node.devMetadata !== null
  );
  const nodeById = new Map(pageNodes.filter((n) => typeof n.id === 'string').map((n) => [n.id, n]));

  // supersededId -> superseding page id (chains resolved below: v1 <- v2 <- v3)
  const supersededBy = new Map();
  pageNodes.forEach((node) => {
    const sup = node.devMetadata.supersedesPageId;
    if (typeof sup === 'string' && sup.length > 0 && nodeById.has(sup)) {
      if (sup === node.id) {
        addError(`supersedes(${node.id})`, 'supersedesPageId must not reference the node itself');
        return;
      }
      supersededBy.set(sup, node.id);
    }
  });

  if (supersededBy.size === 0) {
    return;
  }

  // Resolve each superseded id to the newest version at the end of the chain,
  // with cycle detection.
  const resolveNewest = (startId) => {
    let current = startId;
    const seen = new Set([current]);
    while (supersededBy.has(current)) {
      current = supersededBy.get(current);
      if (seen.has(current)) {
        addError(`supersedes(${startId})`, `supersedesPageId chain contains a cycle involving "${current}"`);
        return null;
      }
      seen.add(current);
    }
    return current;
  };

  const newestFor = new Map();
  for (const supersededId of supersededBy.keys()) {
    const newest = resolveNewest(supersededId);
    if (newest !== null) {
      newestFor.set(supersededId, newest);
    }
  }

  // (b) superseded pages must have empty interactions (no outgoing navigation)
  for (const supersededId of newestFor.keys()) {
    const node = nodeById.get(supersededId);
    const interactions = Array.isArray(node.devMetadata.interactions) ? node.devMetadata.interactions : [];
    if (interactions.length > 0) {
      addError(
        `cross-version(${supersededId})`,
        `superseded page "${supersededId}" (title: "${node.title}") must have empty interactions ` +
        `(retired pages must not navigate in preview). ` +
        `Fix: set this page node's devMetadata.interactions to [].`
      );
    }
  }

  // (c) no interaction may target a superseded page (incoming edges must be redirected)
  pageNodes.forEach((node) => {
    const interactions = Array.isArray(node.devMetadata.interactions) ? node.devMetadata.interactions : [];
    interactions.forEach((interaction, i) => {
      if (typeof interaction.targetPageId === 'string' && newestFor.has(interaction.targetPageId)) {
        addError(
          `cross-version(${node.id}.interactions[${i}])`,
          `interaction domId "${interaction.domId}" targets superseded page "${interaction.targetPageId}" — ` +
          `preview must not mix old and new versions. ` +
          `Fix: redirect targetPageId to "${newestFor.get(interaction.targetPageId)}".`
        );
      }
    });
  });
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: node validate-design-file.mjs <design-file-path> [--expected-pages=N] [--require-interactions=domId1:file1.html,...]');
    process.exit(1);
  }

  const positionalArgs = [];
  let expectedPages;
  let requireInteractions; // array of { domId, htmlFile }

  for (const arg of args) {
    const pagesMatch = arg.match(/^--expected-pages=(\d+)$/);
    const interactionsMatch = arg.match(/^--require-interactions=(.+)$/);
    if (pagesMatch) {
      expectedPages = parseInt(pagesMatch[1], 10);
    } else if (interactionsMatch) {
      requireInteractions = interactionsMatch[1].split(',').map((entry) => {
        const colonIdx = entry.indexOf(':');
        if (colonIdx === -1) {
          return { domId: entry.trim(), htmlFile: '' };
        }
        return {
          domId: entry.slice(0, colonIdx).trim(),
          htmlFile: entry.slice(colonIdx + 1).trim(),
        };
      }).filter((e) => e.domId.length > 0);
    } else {
      positionalArgs.push(arg);
    }
  }

  if (positionalArgs.length === 0) {
    console.error('Usage: node validate-design-file.mjs <design-file-path> [--expected-pages=N] [--require-interactions=domId1:file1.html,...]');
    process.exit(1);
  }

  const filePath = path.resolve(positionalArgs[0]);

  console.log('========================================');
  console.log('Validating .design file');
  console.log('========================================');
  console.log('File path:', filePath);
  if (expectedPages !== undefined) {
    console.log('Expected pages:', expectedPages);
  }
  if (requireInteractions && requireInteractions.length > 0) {
    console.log('Required interactions:', requireInteractions.map((e) => `${e.domId}:${e.htmlFile}`).join(', '));
  }
  console.log('');

  validateDesignFile(filePath, expectedPages, requireInteractions);

  if (errors.length === 0) {
    console.log('========================================');
    console.log('[OK] Validation passed');
    console.log('----------------------------------------');
    console.log('.design file format and type structure are correct');
    if (expectedPages !== undefined) {
      console.log(`Page count matches expectation: ${expectedPages} pages`);
    }
    console.log('========================================');
    process.exit(0);
  } else {
    console.error('========================================');
    console.error('[FAIL] Validation failed');
    console.error('----------------------------------------');
    console.error(`Found ${errors.length} issues:`);
    console.error('');
    errors.forEach((err, i) => {
      console.error(`  ${i + 1}. ${err}`);
    });
    console.error('');
    console.error('========================================');
    process.exit(1);
  }
}

main();
