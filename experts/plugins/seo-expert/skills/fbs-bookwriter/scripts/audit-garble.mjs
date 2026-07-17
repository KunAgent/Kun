#!/usr/bin/env node
/**
 * audit-garble.mjs — 乱码审计脚本
 *
 * 功能：
 *   扫描目标目录下的文本文件，识别以下几类乱码特征：
 *   1. UTF-8 替换字符 (U+FFFD) — 解码失败留下的占位符
 *   2. 控制字符密度过高（非 \t \r \n 的 C0/C1 控制字符）
 *   3. 中文文件中 Latin-1 / Windows-1252 乱码模式（如 Ã¤ â€" 等典型双字节乱码对）
 *   4. 连续随机符号段（可打印 ASCII 可打印率极低但又非纯二进制）
 *   5. BOM 污染（UTF-16 BOM 混入 UTF-8 文件头）
 *
 * 用法：
 *   node scripts/audit-garble.mjs [--root <dir>] [--dirs <d1,d2>]
 *                                  [--exts <.md,.mjs,.json>]
 *                                  [--out <report.json>]
 *                                  [--threshold <score>]
 *                                  [--enforce]
 *                                  [--verbose]
 *
 * 退出码：
 *   0 — 无乱码 / 未超出阈值
 *   1 — 发现乱码文件（仅在 --enforce 时触发）
 *   2 — 参数/环境错误
 */

import fs from 'fs';
import path from 'path';

// ─── 默认参数 ────────────────────────────────────────────────────────────────

const DEFAULT_SCAN_DIRS = [
  'references',
  'scripts',
  'assets',
  'FBS-BookWriter/references',
  'FBS-BookWriter/scripts',
  'FBS-BookWriter/assets',
];

const DEFAULT_EXTS = ['.md', '.mjs', '.json', '.txt', '.jsonl'];
const DEFAULT_THRESHOLD = 10;   // 综合乱码评分阈值，超过即为"疑似乱码"
const DEFAULT_OUT = '.fbs/garble-audit-report.json';

// ─── 已知乱码特征模式（UTF-8 按 Latin-1/Win-1252 读取中文常见结果）───────────

/**
 * Windows-1252 / Latin-1 解读 UTF-8 双字节中文时的典型乱码对模式。
 * 例如 "的" (UTF-8: E7 9A 84) 在 Latin-1 会变成 "çš„"
 * 用正则描述最常见的连续乱码符号区段（3+ 个连续的高位 Latin 字符）
 */
const LATIN_GARBLE_RE = /[\xC0-\xFF]{3,}/u;

/**
 * UTF-16LE BOM (FF FE) 或 UTF-16BE BOM (FE FF) 出现在文件头
 */
const UTF16_BOM_RE = /^\uFFFE|\uFEFF[\s\S]{0,4}\x00/u;

/**
 * 典型 Win-1252 → UTF-8 二次解码乱码序列（中文常见）
 * 匹配 Ã + 任意字符 连续出现，或 â€" â€™ 等
 */
const WIN1252_SEQUENCE_RE = /(?:Ã[\x80-\xBF]|â€[™"""''–—]|Â[\xa0-\xff]){2,}/u;

/**
 * 替换字符（解码失败占位符）
 */
const REPLACEMENT_CHAR_RE = /\uFFFD/g;

/**
 * C0/C1 控制字符（排除合法的 TAB CR LF）
 */
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F]/g;

/**
 * 检测"可打印字符密度"：可打印率低于阈值但文件又非二进制
 */
const PRINTABLE_RE = /[\x09\x0A\x0D\x20-\x7E\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/gu;

// ─── 核心评分函数 ─────────────────────────────────────────────────────────────

/**
 * 对给定文本字符串进行乱码特征评分。
 * 返回详细特征计数与综合评分（分值越高越可能是乱码）。
 *
 * @param {string} text - 已解码的文本内容
 * @param {string} filePath - 仅用于调试信息
 * @returns {{
 *   replacementChars: number,
 *   controlChars: number,
 *   latinGarbleMatches: number,
 *   win1252Sequences: number,
 *   utf16BomDetected: boolean,
 *   printableRatio: number,
 *   score: number,
 *   details: string[]
 * }}
 */
function scoreGarble(text, filePath) {
  const details = [];

  // 1. UTF-8 替换字符
  const replacementChars = (text.match(REPLACEMENT_CHAR_RE) || []).length;

  // 2. 控制字符密度
  const controlChars = (text.match(CONTROL_CHAR_RE) || []).length;

  // 3. Latin-1 乱码连续段（3+ 个高位 Latin 字符连续）
  const latinGarbleMatches = (text.match(new RegExp(LATIN_GARBLE_RE.source, 'gu')) || []).length;

  // 4. Win-1252 二次解码序列
  const win1252Sequences = (text.match(new RegExp(WIN1252_SEQUENCE_RE.source, 'gu')) || []).length;

  // 5. UTF-16 BOM 污染
  const utf16BomDetected = UTF16_BOM_RE.test(text.slice(0, 4));

  // 6. 可打印字符密度（对非纯英文文件敏感）
  const printableMatches = (text.match(PRINTABLE_RE) || []).length;
  const printableRatio = printableMatches / Math.max(text.length, 1);

  // 综合评分权重
  let score = 0;
  score += replacementChars * 8;
  score += controlChars * 12;
  score += latinGarbleMatches * 15;
  score += win1252Sequences * 20;
  score += utf16BomDetected ? 50 : 0;

  // 可打印率极低（<50%）但文件又包含中文意味着解码混乱
  if (printableRatio < 0.5 && text.length > 200) {
    score += Math.round((0.5 - printableRatio) * 100);
    details.push(`可打印率偏低 (${(printableRatio * 100).toFixed(1)}%)`);
  }

  if (replacementChars > 0) details.push(`替换字符 ×${replacementChars}`);
  if (controlChars > 0) details.push(`控制字符 ×${controlChars}`);
  if (latinGarbleMatches > 0) details.push(`Latin乱码段 ×${latinGarbleMatches}`);
  if (win1252Sequences > 0) details.push(`Win-1252序列 ×${win1252Sequences}`);
  if (utf16BomDetected) details.push('检测到 UTF-16 BOM');

  return {
    replacementChars,
    controlChars,
    latinGarbleMatches,
    win1252Sequences,
    utf16BomDetected,
    printableRatio: Number(printableRatio.toFixed(4)),
    score: Number(score.toFixed(2)),
    details,
  };
}

// ─── 文件遍历 ─────────────────────────────────────────────────────────────────

function walkFiles(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'test-unzip', '.codebuddy', '.codebuddy-plugin'].includes(entry.name)) continue;
      walkFiles(fullPath, exts, out);
    } else if (exts.includes(path.extname(entry.name).toLowerCase())) {
      out.push(fullPath);
    }
  }
  return out;
}

// ─── 参数解析 ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    root: '.',
    dirs: [],
    exts: DEFAULT_EXTS,
    out: DEFAULT_OUT,
    threshold: DEFAULT_THRESHOLD,
    enforce: false,
    verbose: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') opts.root = argv[++i];
    else if (a === '--dirs') opts.dirs = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--exts') opts.exts = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--threshold') opts.threshold = Number(argv[++i] || DEFAULT_THRESHOLD);
    else if (a === '--enforce') opts.enforce = true;
    else if (a === '--verbose') opts.verbose = true;
  }

  return opts;
}

// ─── 主逻辑 ───────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv);
  const root = path.resolve(opts.root);

  // 解析扫描目录
  const candidates = opts.dirs.length > 0 ? opts.dirs : DEFAULT_SCAN_DIRS;
  const scanDirs = [];
  const missingDirs = [];
  for (const dir of candidates) {
    const abs = path.resolve(root, dir);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      scanDirs.push({ rel: dir, abs });
    } else {
      missingDirs.push(dir);
    }
  }

  // 收集文件
  const files = [];
  for (const dir of scanDirs) {
    walkFiles(dir.abs, opts.exts, files);
  }

  const report = {
    tool: 'audit-garble',
    version: '1.0.0',
    root,
    generatedAt: new Date().toISOString(),
    threshold: opts.threshold,
    scanDirs: scanDirs.map((d) => d.rel),
    missingDirs,
    scannedFiles: files.length,
    garbledFiles: 0,
    items: [],
  };

  const outPath = path.resolve(root, opts.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  if (scanDirs.length === 0) {
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.error('❌ audit-garble: 未找到可扫描目录，请检查 --root 或 --dirs 参数。');
    process.exit(2);
  }

  for (const abs of files) {
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }

    const result = scoreGarble(text, rel);

    if (result.score < opts.threshold) continue;

    report.garbledFiles++;
    report.items.push({
      file: rel,
      score: result.score,
      replacementChars: result.replacementChars,
      controlChars: result.controlChars,
      latinGarbleMatches: result.latinGarbleMatches,
      win1252Sequences: result.win1252Sequences,
      utf16BomDetected: result.utf16BomDetected,
      printableRatio: result.printableRatio,
      details: result.details,
    });

    if (opts.verbose) {
      console.warn(`  ⚠️  [score=${result.score}] ${rel}: ${result.details.join('; ')}`);
    }
  }

  // 按评分降序排列
  report.items.sort((a, b) => b.score - a.score);

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  const passEmoji = report.garbledFiles === 0 ? '✅' : '⚠️';
  console.log(`${passEmoji} audit-garble: 扫描 ${report.scannedFiles} 个文件，发现乱码文件 ${report.garbledFiles} 个（阈值=${opts.threshold}）`);
  console.log(`   报告：${outPath}`);

  if (report.garbledFiles > 0 && opts.verbose) {
    console.log('\n  乱码文件列表（Top 10）:');
    for (const item of report.items.slice(0, 10)) {
      console.log(`    [${item.score}] ${item.file}: ${item.details.join('; ')}`);
    }
  }

  if (opts.enforce && report.garbledFiles > 0) {
    console.error(`❌ audit-garble 阻断：发现 ${report.garbledFiles} 个疑似乱码文件，打包终止。`);
    process.exit(1);
  }
}

main();
