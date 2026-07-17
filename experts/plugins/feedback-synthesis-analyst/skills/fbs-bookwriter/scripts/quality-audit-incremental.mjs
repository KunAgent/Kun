#!/usr/bin/env node
/**
 * 增量质检执行器（面向 WorkBuddy/CodeBuddy）
 *
 * 目标：避免“全量扫描 + 长时间黑箱等待”，默认只审计最近变更文件。
 *
 * 用法：
 *   node scripts/quality-audit-incremental.mjs --skill-root . --book-root <本书根>
 *   node scripts/quality-audit-incremental.mjs --skill-root . --book-root <本书根> --mode git --base-ref HEAD~1
 *   node scripts/quality-audit-incremental.mjs --skill-root . --book-root <本书根> --mode mtime --since-hours 48 --max-files 20
 *   node scripts/quality-audit-incremental.mjs --book-root <本书根> --chapter-file <章节文件>
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';

const HELP_TEXT = `增量质检执行器（quality-audit-incremental）

用法：
  node scripts/quality-audit-incremental.mjs --skill-root . --book-root <本书根>
  node scripts/quality-audit-incremental.mjs --skill-root . --book-root <本书根> --mode git --base-ref HEAD~1
  node scripts/quality-audit-incremental.mjs --skill-root . --book-root <本书根> --mode mtime --since-hours 48 --max-files 20
  node scripts/quality-audit-incremental.mjs --book-root <本书根> --chapter-file <章节文件>

选项：
  --skill-root <path>     技能根目录（默认当前目录）
  --book-root <path>      书稿根目录（默认当前目录）
  --mode <auto|git|mtime> 增量收集模式（默认 auto）
  --base-ref <ref>        git 模式的基线引用（默认 HEAD~1）
  --since-hours <hours>   mtime 模式的最近小时数（默认 72）
  --max-files <n>         最多审计文件数（默认 30）
  --min-score <score>     综合分最低通过线（默认 7.5）
  --chapter-file <path>   直接指定一个章节文件进行质检，可重复传入
  --json                  输出 JSON 汇总
  --help                  显示帮助信息
`;

export function parseArgs(argv) {
  const o = {
    skillRoot: process.cwd(),
    bookRoot: process.cwd(),
    mode: 'auto', // auto | git | mtime
    baseRef: 'HEAD~1',
    sinceHours: 72,
    maxFiles: 30,
    minScore: 7.5,
    chapterFiles: [],
    json: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skill-root') o.skillRoot = argv[++i] || o.skillRoot;
    else if (a === '--book-root') o.bookRoot = argv[++i] || o.bookRoot;
    else if (a === '--mode') o.mode = (argv[++i] || o.mode).toLowerCase();
    else if (a === '--base-ref') o.baseRef = argv[++i] || o.baseRef;
    else if (a === '--since-hours') o.sinceHours = Math.max(1, Number(argv[++i] || o.sinceHours));
    else if (a === '--max-files') o.maxFiles = Math.max(1, Number(argv[++i] || o.maxFiles));
    else if (a === '--min-score') o.minScore = Number(argv[++i] || o.minScore);
    else if (a === '--chapter-file') o.chapterFiles.push(path.resolve(argv[++i] || ''));
    else if (a === '--json') o.json = true;
    else if (a === '--help' || a === '-h') o.help = true;
  }

  o.skillRoot = path.resolve(o.skillRoot);
  o.bookRoot = path.resolve(o.bookRoot);
  o.chapterFiles = [...new Set(o.chapterFiles.filter(Boolean))];
  return o;
}

function printHelp() {
  console.log(HELP_TEXT);
}

function isIgnoredDir(name) {
  return name === 'node_modules' || name === '.git' || name === 'dist' || name === 'test-unzip';
}

function walkMarkdownFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;

  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (isIgnoredDir(e.name)) continue;
        stack.push(full);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        out.push(full);
      }
    }
  }

  return out;
}

function underRoot(filePath, root) {
  const rp = path.resolve(filePath);
  const rr = path.resolve(root);
  return rp === rr || rp.startsWith(rr + path.sep);
}

function collectExplicitFiles(opts) {
  return opts.chapterFiles
    .map((filePath) => path.resolve(filePath))
    .filter((filePath) => filePath.endsWith('.md'))
    .slice(0, opts.maxFiles);
}

function collectByGit(opts) {
  const r = spawnSync('git', ['-C', opts.skillRoot, 'diff', '--name-only', opts.baseRef, '--'], { encoding: 'utf8' });
  if (typeof r.status !== 'number' || r.status !== 0) return [];

  const relFiles = String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const abs = relFiles
    .map((rel) => path.resolve(opts.skillRoot, rel))
    .filter((f) => f.endsWith('.md') && fs.existsSync(f))
    .filter((f) => underRoot(f, opts.bookRoot));

  return [...new Set(abs)].slice(0, opts.maxFiles);
}

function collectByMtime(opts) {
  const files = walkMarkdownFiles(opts.bookRoot);
  const cutoff = Date.now() - opts.sinceHours * 3600 * 1000;

  const recent = files
    .map((f) => {
      let st = null;
      try { st = fs.statSync(f); } catch { return null; }
      return { file: f, mtimeMs: st.mtimeMs };
    })
    .filter(Boolean)
    .filter((x) => x.mtimeMs >= cutoff)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, opts.maxFiles)
    .map((x) => x.file);

  return recent;
}

function createEmptySummary(opts, files) {
  return {
    timestamp: new Date().toISOString(),
    minScore: opts.minScore,
    total: files.length,
    passed: 0,
    failed: 0,
    avgScore: 0,
    results: [],
  };
}

function runQualityAuditor(opts, files) {
  const auditor = path.join(opts.skillRoot, 'scripts', 'quality-auditor-lite.mjs');
  if (!fs.existsSync(auditor)) {
    return {
      code: 2,
      summary: null,
      stderr: `[incremental-audit] 缺少脚本: ${auditor}`,
    };
  }

  const args = [
    auditor,
    '--inputs', files.join(','),
    '--min-score', String(opts.minScore),
    '--json',
    '--quiet',
  ];

  const r = spawnSync(process.execPath, args, {
    cwd: opts.skillRoot,
    encoding: 'utf8',
  });

  const stdout = String(r.stdout || '').trim();
  const stderr = String(r.stderr || '').trim();
  let summary = null;
  if (stdout) {
    try {
      summary = JSON.parse(stdout);
    } catch {
      summary = null;
    }
  }

  return {
    code: typeof r.status === 'number' ? r.status : 2,
    summary,
    stdout,
    stderr,
  };
}

function printQualitySummary(summary) {
  for (const result of summary.results || []) {
    if (result.error) {
      console.log(`\n[quality] ${result.filePath}`);
      console.log(`  错误: ${result.error} ❌`);
      continue;
    }
    console.log(`\n[quality] ${result.filePath}`);
    const overallScore = result.scores?.overall ?? result.scores?.total ?? result.scores?.converted ?? 0;
    console.log(`  综合: ${overallScore}/10 ${result.threshold.passed ? '✅' : '❌'}`);
  }

  console.log(`\n[quality] 汇总: total=${summary.total}, passed=${summary.passed}, failed=${summary.failed}, avg=${summary.avgScore}/10`);
}

function extractChapterId(filePath, bookRoot) {
  const relativePath = path.relative(bookRoot, filePath).replace(/\\/g, '/');
  const base = path.basename(filePath, path.extname(filePath));
  const s3Match = base.match(/^\[S3-Ch(\d+)\]/i);
  if (s3Match) return `ch${String(Number(s3Match[1])).padStart(2, '0')}`;

  const chapterMatch = base.match(/(?:^|[^a-z0-9])ch(\d{1,3})(?:[^a-z0-9]|$)/i);
  if (chapterMatch) return `ch${String(Number(chapterMatch[1])).padStart(2, '0')}`;

  return relativePath || base;
}

function appendGateRunLogIfReady(opts, summary) {
  const fbsDir = path.join(opts.bookRoot, '.fbs');
  const logPath = path.join(fbsDir, 'gate-run-log.jsonl');
  if (!fs.existsSync(logPath)) return 0;

  let written = 0;
  for (const result of summary.results || []) {
    const passed = result.threshold?.passed === true;
    const entry = {
      ts: new Date().toISOString(),
      event: 's_layer_audit',
      exitCode: passed ? 0 : 1,
      mode: 'cli',
      chapterId: extractChapterId(result.filePath || '', opts.bookRoot),
      auditResult: result.error ? 'skipped' : (passed ? 'pass' : 'fail'),
      score: result.scores?.converted,
    };

    if (result.error) entry.skipReason = result.error;
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
    written += 1;
  }

  return written;
}

export function runIncrementalQualityAudit(rawArgv = process.argv) {
  const opts = parseArgs(rawArgv);
  if (opts.help) {
    printHelp();
    return { code: 0, summary: null, usedMode: 'help', files: [] };
  }

  let files = collectExplicitFiles(opts);
  let usedMode = files.length > 0 ? 'explicit' : opts.mode;

  if (files.length === 0 && (opts.mode === 'git' || opts.mode === 'auto')) {
    files = collectByGit(opts);
    if (files.length > 0) usedMode = 'git';
  }

  if (files.length === 0 && (opts.mode === 'mtime' || opts.mode === 'auto')) {
    files = collectByMtime(opts);
    if (files.length > 0) usedMode = 'mtime';
  }

  if (files.length === 0) {
    const summary = createEmptySummary(opts, files);
    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log('[incremental-audit] 没有命中增量文件，跳过本轮质检。');
    }
    return { code: 0, summary, usedMode, files };
  }

  const result = runQualityAuditor(opts, files);
  if (result.stderr) console.error(result.stderr);

  if (!result.summary) {
    if (result.stdout) console.log(result.stdout);
    return { code: result.code, summary: null, usedMode, files };
  }

  if (opts.json) {
    console.log(JSON.stringify(result.summary, null, 2));
  } else {
    console.log(`[incremental-audit] 模式=${usedMode} 文件数=${files.length}`);
    files.forEach((f, i) => console.log(`  [${i + 1}] ${path.relative(opts.skillRoot, f)}`));
    printQualitySummary(result.summary);
  }

  appendGateRunLogIfReady(opts, result.summary);
  return { code: result.code, summary: result.summary, usedMode, files };
}

function isDirectRun() {
  return !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isDirectRun()) {
  const result = runIncrementalQualityAudit(process.argv);
  process.exit(result.code);
}

