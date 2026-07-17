#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const DEFAULT_SCAN_DIR_CANDIDATES = [
  'references',
  'scripts',
  'assets',
  'FBS-BookWriter/references',
  'FBS-BookWriter/scripts',
  'FBS-BookWriter/assets',
];

function parseArgs(argv) {
  const opts = {
    root: '.',
    dirs: [],
    exts: ['.md', '.mjs', '.json'],
    top: 50,
    applySafe: false,
    applyBest: false,
    scrubReplacement: false,
    enforce: false,
    out: '.fbs/encoding-governance-report.json',
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') opts.root = argv[++i];
    else if (a === '--dirs') opts.dirs = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--exts') opts.exts = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--top') opts.top = Number(argv[++i] || opts.top);
    else if (a === '--apply-safe') opts.applySafe = true;
    else if (a === '--apply-best') opts.applyBest = true;
    else if (a === '--scrub-replacement') opts.scrubReplacement = true;
    else if (a === '--enforce') opts.enforce = true;
    else if (a === '--out') opts.out = argv[++i];
  }

  return opts;
}

function walkFiles(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'test-unzip') continue;
      walkFiles(fullPath, exts, out);
    } else if (exts.includes(path.extname(entry.name).toLowerCase())) {
      out.push(fullPath);
    }
  }
  return out;
}

function decodeGb18030(buffer) {
  try {
    return new TextDecoder('gb18030').decode(buffer);
  } catch {
    return null;
  }
}

function scoreText(text) {
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  const controlCount = (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const printableCount = (text.match(/[\u0020-\u007E\u4e00-\u9fff\u3000-\u303F\uFF00-\uFFEF\r\n\t]/g) || []).length;
  const printableRatio = printableCount / Math.max(text.length, 1);
  const score = replacementCount * 8 + controlCount * 12 + Math.max(0, 0.5 - printableRatio) * 50;
  return {
    replacementCount,
    controlCount,
    cjkCount,
    printableRatio: Number(printableRatio.toFixed(4)),
    score: Number(score.toFixed(2)),
  };
}

function chooseBestDecoding(buffer) {
  const utf8Text = buffer.toString('utf8');
  const utf8 = scoreText(utf8Text);
  const gbText = decodeGb18030(buffer);

  if (!gbText) {
    return { bestEncoding: 'utf8', bestText: utf8Text, utf8, gb18030: null };
  }

  const gb18030 = scoreText(gbText);
  const gbBetter = gb18030.score + 5 < utf8.score;

  return gbBetter
    ? { bestEncoding: 'gb18030', bestText: gbText, utf8, gb18030 }
    : { bestEncoding: 'utf8', bestText: utf8Text, utf8, gb18030 };
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function isSafeConversion(current, next) {
  if (!next) return false;
  if (current.replacementCount < 20) return false;
  const replacementImprovementRatio = (current.replacementCount - next.replacementCount) / Math.max(current.replacementCount, 1);
  const replacementImproved = replacementImprovementRatio >= 0.7;
  const scoreImproved = next.score + 1 < current.score;
  const cjkNotWorse = next.cjkCount >= current.cjkCount;
  return replacementImproved && scoreImproved && cjkNotWorse;
}

function resolveScanDirs(root, requestedDirs) {
  const candidates = requestedDirs.length > 0 ? requestedDirs : DEFAULT_SCAN_DIR_CANDIDATES;
  const existing = [];
  const missing = [];
  const seen = new Set();

  for (const dir of candidates) {
    const normalized = String(dir || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const abs = path.resolve(root, normalized);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      existing.push({ rel: normalized, abs });
    } else {
      missing.push(normalized);
    }
  }

  return { existing, missing };
}

function buildSummary(report, outPath, top) {
  return {
    scannedFiles: report.scannedFiles,
    corruptedFiles: report.corruptedFiles,
    safeConvertedFiles: report.safeConvertedFiles,
    scanDirs: report.scanDirs,
    missingDirs: report.missingDirs,
    top: report.items.slice(0, Math.max(1, top)).map((item) => ({
      file: item.file,
      utf8Replacement: item.utf8.replacementCount,
      utf8Control: item.utf8.controlCount,
      bestEncoding: item.bestEncoding,
      converted: item.converted,
    })),
    reportPath: outPath,
  };
}

function main() {
  const opts = parseArgs(process.argv);
  const root = path.resolve(opts.root);
  const { existing, missing } = resolveScanDirs(root, opts.dirs);
  const files = [];

  for (const dir of existing) {
    walkFiles(dir.abs, opts.exts, files);
  }

  const report = {
    root,
    generatedAt: new Date().toISOString(),
    scanDirs: existing.map((item) => item.rel),
    missingDirs: missing,
    scannedFiles: files.length,
    corruptedFiles: 0,
    safeConvertedFiles: 0,
    items: [],
  };

  const outPath = path.resolve(root, opts.out);
  ensureParent(outPath);

  if (existing.length === 0) {
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify(buildSummary(report, outPath, opts.top), null, 2));
    console.error('❌ 未找到可扫描目录，请检查 --root 或 --dirs 参数。');
    process.exit(1);
  }

  for (const abs of files) {
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    let buffer;
    try {
      buffer = fs.readFileSync(abs);
    } catch {
      continue;
    }

    const pick = chooseBestDecoding(buffer);
    const utf8 = pick.utf8;
    const gb = pick.gb18030;
    const hasIssue = utf8.replacementCount > 0 || utf8.controlCount > 0;

    if (!hasIssue) continue;

    report.corruptedFiles++;

    let converted = false;
    const canApplyBest = opts.applyBest && pick.bestEncoding === 'gb18030' && gb && gb.score + 1 < utf8.score;
    const canApplySafe = opts.applySafe && pick.bestEncoding === 'gb18030' && isSafeConversion(utf8, gb);
    const canScrubReplacement = opts.scrubReplacement && pick.bestEncoding === 'utf8' && utf8.replacementCount > 0;

    if (canApplyBest || canApplySafe) {
      fs.writeFileSync(abs, pick.bestText, 'utf8');
      converted = true;
      report.safeConvertedFiles++;
    } else if (canScrubReplacement) {
      const scrubbed = pick.bestText.replace(/\uFFFD/g, '');
      fs.writeFileSync(abs, scrubbed, 'utf8');
      converted = true;
      report.safeConvertedFiles++;
    }

    report.items.push({
      file: rel,
      utf8,
      gb18030: gb,
      bestEncoding: pick.bestEncoding,
      converted,
    });
  }

  report.items.sort((a, b) => (b.utf8.replacementCount + b.utf8.controlCount) - (a.utf8.replacementCount + a.utf8.controlCount));
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  const summary = buildSummary(report, outPath, opts.top);
  console.log(JSON.stringify(summary, null, 2));

  if (opts.enforce && report.corruptedFiles > 0) {
    console.error(`❌ 编码治理阻断：发现 ${report.corruptedFiles} 个疑似损坏文件。`);
    process.exit(1);
  }
}

main();
