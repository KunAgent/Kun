#!/usr/bin/env node
/**
 * 全景质检总控脚本
 * - 支持裸仓库存量质检模式（自动创建最小工作面）
 * - 支持两阶段：panorama（概览扫描）/ deep（逐文件深检）
 * - 运行时强约束：大范围确认门禁、串行锁、进度快照、历史结果复用
 */
import fs from 'fs';
import path from 'path';
import { spawnSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import {

  buildInventory,
  collectMarkdownFiles,
  ensureBareQualityWorkspace,
  groupInventoryByGroup,
  normalizeRel,
  resolveScriptSkillRoot,
} from './lib/quality-runtime.mjs';
import { loadEntryContractPolicy } from './lib/entry-contract-runtime.mjs';
import { emitBridgeEvent, EVENT_TYPES } from './host-bridge.mjs';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_SKILL_ROOT = resolveScriptSkillRoot(import.meta.url);
const STAGES = ['S', 'P', 'C', 'B'];

const HISTORY_META_PREFIX = '<!-- FBS_QC_META ';
const HISTORY_META_SUFFIX = ' -->';

function normalizePositive(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function normalizeNonNegative(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeEmitBridgeEvent(bookRoot, eventType, payload) {
  try {
    emitBridgeEvent(bookRoot, eventType, payload);
  } catch {
    // 宿主桥接属于增强能力，失败时静默降级
  }
}

function emitOrchestratorEvent(opts, summary, detail = {}) {
  safeEmitBridgeEvent(opts.bookRoot, EVENT_TYPES.ORCHESTRATOR, {
    summary,
    ...detail,
  });
}

function emitQualityGateEvent(opts, summary, detail = {}) {
  safeEmitBridgeEvent(opts.bookRoot, EVENT_TYPES.QUALITY_GATE, {
    summary,
    ...detail,
  });
}

function emitStageChange(opts, stage, detail = {}) {
  safeEmitBridgeEvent(opts.bookRoot, EVENT_TYPES.STAGE_CHANGE, {
    summary: `quality:${stage}`,
    stage,
    ...detail,
  });
}

function resolveBookRelativePath(bookRoot, filePath) {
  if (!filePath) return null;
  const raw = String(filePath);
  const absolute = path.isAbsolute(raw) ? raw : path.join(bookRoot, raw);
  return normalizeRel(absolute, bookRoot);
}

function resolvePathInBookRoot(bookRoot, maybeRelative) {
  if (!maybeRelative) return path.resolve(bookRoot);
  return path.isAbsolute(maybeRelative)
    ? path.resolve(maybeRelative)
    : path.resolve(bookRoot, maybeRelative);
}

function loadPolicySafely(skillRoot) {
  try {
    return loadEntryContractPolicy(skillRoot);
  } catch {
    return {};
  }
}

export function parseArgs(argv) {
  const o = {
    skillRoot: SCRIPT_SKILL_ROOT,
    bookRoot: process.cwd(),
    mode: 'auto', // auto | panorama | deep | git | mtime | full
    selectionMode: 'auto',
    baseRef: 'HEAD~1',
    sinceHours: 72,
    maxFiles: 30,
    minScore: 7.5,
    timeoutMinutes: 15,
    maxTurns: 12,
    maxRetries: 1,
    strictStageGate: true,
    heartbeatSeconds: 15,
    bare: false,
    confirmLargeScan: false,
    largeScopeConfirmationThreshold: 50,
    confirmFlag: '--confirm-large-scan',
    progressFile: '.fbs/scan-progress.json',
    lockFile: '.fbs/scan-lock.json',
    historyDir: '.workbuddy/memory',
    xlBatchThreshold: 120,
    partialFile: '.fbs/quality-panorama-partial.json',
    stageReportDir: '.fbs/quality-panorama-stages',
    progressReportOnStart: true,
    progressReportTemplate: '我先扫{stageLabel}（{scope}），大概需要 {etaMinutes} 分钟；超过 {timeoutMinutes} 分钟会把已完成部分告诉你。',
    fallbackWhenInterrupted: '已完成部分：{completedScope}。剩余范围：{remainingScope}。建议下一步：{nextStep}。',
    reuseHistory: true,
    // v2.0.3 [D2]：XL 分卷断点续检起始卷号（1-based，null 表示从头开始）
    resumeFromVolume: null,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skill-root') o.skillRoot = argv[++i] || o.skillRoot;
    else if (a === '--book-root') o.bookRoot = argv[++i] || o.bookRoot;
    else if (a === '--mode') o.mode = (argv[++i] || o.mode).toLowerCase();
    else if (a === '--selection-mode') o.selectionMode = (argv[++i] || o.selectionMode).toLowerCase();
    else if (a === '--base-ref') o.baseRef = argv[++i] || o.baseRef;
    else if (a === '--since-hours') o.sinceHours = Math.max(1, Number(argv[++i] || o.sinceHours));
    else if (a === '--max-files') o.maxFiles = Math.max(1, Number(argv[++i] || o.maxFiles));
    else if (a === '--min-score') o.minScore = Number(argv[++i] || o.minScore);
    else if (a === '--timeout-minutes') o.timeoutMinutes = Math.max(1, Number(argv[++i] || o.timeoutMinutes));
    else if (a === '--max-turns') o.maxTurns = Math.max(1, Number(argv[++i] || o.maxTurns));
    else if (a === '--max-retries') o.maxRetries = Math.max(0, Number(argv[++i] || o.maxRetries));
    else if (a === '--heartbeat-seconds') o.heartbeatSeconds = Math.max(3, Number(argv[++i] || o.heartbeatSeconds));
    else if (a === '--large-scope-threshold') o.largeScopeConfirmationThreshold = Math.max(1, Number(argv[++i] || o.largeScopeConfirmationThreshold));
    else if (a === '--progress-file') o.progressFile = argv[++i] || o.progressFile;
    else if (a === '--lock-file') o.lockFile = argv[++i] || o.lockFile;
    else if (a === '--history-dir') o.historyDir = argv[++i] || o.historyDir;
    else if (a === '--xl-batch-threshold') o.xlBatchThreshold = Math.max(1, Number(argv[++i] || o.xlBatchThreshold));
    else if (a === '--confirm-large-scan') o.confirmLargeScan = true;
    else if (a === '--no-history-reuse') o.reuseHistory = false;
    else if (a === '--no-strict-stage-gate') o.strictStageGate = false;
    else if (a === '--partial-file') o.partialFile = argv[++i] || o.partialFile;
    else if (a === '--stage-report-dir') o.stageReportDir = argv[++i] || o.stageReportDir;
    else if (a === '--bare') o.bare = true;
    // v2.0.3 [D2]：XL 分卷断点续检，指定从第 N 卷开始（1-based）
    else if (a === '--resume-from-volume') o.resumeFromVolume = Math.max(1, Number(argv[++i]) || 1);
  }

  o.skillRoot = path.resolve(o.skillRoot || SCRIPT_SKILL_ROOT);
  o.bookRoot = path.resolve(o.bookRoot || process.cwd());
  if (['git', 'mtime', 'full'].includes(o.mode)) {
    o.selectionMode = o.mode;
    o.mode = 'auto';
  }
  return o;
}

export function applyExecutionPolicy(opts, policy = {}) {
  const q = policy?.qualityPanoramaExecution || {};
  const next = {
    ...opts,
    timeoutMinutes: normalizePositive(q.subTaskTimeoutMinutes, opts.timeoutMinutes),
    maxTurns: normalizePositive(q.subTaskMaxTurns, opts.maxTurns),
    maxRetries: normalizeNonNegative(q.subTaskMaxRetries, opts.maxRetries),
    heartbeatSeconds: normalizePositive(q.heartbeatSeconds, opts.heartbeatSeconds),
    largeScopeConfirmationThreshold: normalizePositive(q.largeScopeConfirmationThreshold, opts.largeScopeConfirmationThreshold),
    confirmFlag: q.confirmFlag || opts.confirmFlag,
    progressFile: q.progressSnapshotFile || opts.progressFile,
    lockFile: q.scanLockFile || opts.lockFile,
    historyDir: q.historyResultDir || opts.historyDir,
    xlBatchThreshold: normalizePositive(q.xlBatchThreshold, opts.xlBatchThreshold),
    progressReportOnStart: q.progressReportOnStart !== false,
    progressReportTemplate: q.progressReportTemplate || opts.progressReportTemplate,
    fallbackWhenInterrupted: q.fallbackWhenInterrupted || opts.fallbackWhenInterrupted,
    runStageSerially: q.runStageSerially !== false,
    allowParallelInSameStage: q.allowParallelInSameStage === true,
  };

  next.partialFile = resolvePathInBookRoot(next.bookRoot, next.partialFile);
  next.stageReportDir = resolvePathInBookRoot(next.bookRoot, next.stageReportDir);
  next.progressFile = resolvePathInBookRoot(next.bookRoot, next.progressFile);
  next.lockFile = resolvePathInBookRoot(next.bookRoot, next.lockFile);
  next.historyDir = resolvePathInBookRoot(next.bookRoot, next.historyDir);
  return next;
}

function collectByGit(opts, inventory) {
  const result = spawnSync('git', ['-C', opts.bookRoot, 'diff', '--name-only', opts.baseRef, '--'], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  const changed = new Set(
    String(result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((rel) => path.resolve(opts.bookRoot, rel))
  );
  return inventory.filter((item) => changed.has(item.filePath)).slice(0, opts.maxFiles);
}

function collectByMtime(opts, inventory) {
  const cutoff = Date.now() - opts.sinceHours * 3600 * 1000;
  return [...inventory]
    .filter((item) => item.mtimeMs >= cutoff)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, opts.maxFiles);
}

export function resolveAnalysisMode(opts, inventory) {
  if (opts.mode === 'panorama' || opts.mode === 'deep') return opts.mode;
  return inventory.length > 10 ? 'panorama' : 'deep';
}

function resolveTargetInventory(opts, inventory, analysisMode) {
  if (analysisMode === 'panorama') return inventory;
  if (opts.selectionMode === 'full') return inventory.slice(0, opts.maxFiles);
  if (opts.selectionMode === 'git') {
    const byGit = collectByGit(opts, inventory);
    if (byGit.length > 0) return byGit;
  }
  if (opts.selectionMode === 'mtime' || opts.selectionMode === 'auto') {
    const byMtime = collectByMtime(opts, inventory);
    if (byMtime.length > 0) return byMtime;
  }
  return inventory.slice(0, opts.maxFiles);
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function formatTemplate(template, fields) {
  return String(template || '')
    .replaceAll('{stage}', String(fields.stage || ''))
    .replaceAll('{scope}', String(fields.scope || ''))
    .replaceAll('{etaMinutes}', String(fields.etaMinutes || ''))
    .replaceAll('{timeoutMinutes}', String(fields.timeoutMinutes || ''));
}

function estimateEtaMinutes(fileCount, modeUsed, batchCount = 1) {
  const divisor = modeUsed === 'panorama' ? 25 : 15;
  return Math.max(1, Math.ceil(fileCount / divisor) + Math.max(0, batchCount - 1));
}

function buildScopeLabel(inventory) {
  if (!Array.isArray(inventory) || inventory.length === 0) return '0 files';
  const groups = [...new Set(inventory.map((item) => item.group || 'root'))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  if (groups.length === 1) return `${groups[0]} · ${inventory.length} files`;
  return `${groups.length} groups / ${inventory.length} files`;
}

function writeProgress(opts, payload) {
  const progress = {
    timestamp: new Date().toISOString(),
    timeoutMinutes: opts.timeoutMinutes,
    maxTurns: opts.maxTurns,
    maxRetries: opts.maxRetries,
    heartbeatSeconds: opts.heartbeatSeconds,
    ...payload,
  };
  writeJson(opts.progressFile, progress);
  return progress;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function isLockStale(lock, opts) {
  const createdAt = Date.parse(lock?.createdAt || '');
  if (!Number.isFinite(createdAt)) return true;
  const staleMs = Math.max(opts.timeoutMinutes * 4 * 60 * 1000, 30 * 60 * 1000);
  return (Date.now() - createdAt) > staleMs;
}

function acquireScanLock(opts, inventory) {
  ensureDir(path.dirname(opts.lockFile));
  const existing = readJsonIfExists(opts.lockFile);
  if (existing && !isLockStale(existing, opts)) {
    const err = new Error(`scan_lock_active:${existing.createdAt || 'unknown'}`);
    err.code = 'SCAN_LOCK_ACTIVE';
    err.lock = existing;
    throw err;
  }

  const lock = {
    pid: process.pid,
    createdAt: new Date().toISOString(),
    bookRoot: opts.bookRoot,
    mode: opts.mode,
    selectionMode: opts.selectionMode,
    fileCount: inventory.length,
  };
  writeJson(opts.lockFile, lock);
  return lock;
}

function releaseScanLock(opts) {
  try {
    const existing = readJsonIfExists(opts.lockFile);
    if (!existing) return;
    if (existing.pid && existing.pid !== process.pid) return;
    fs.rmSync(opts.lockFile, { force: true });
  } catch {
    // 忽略清理失败
  }
}

function createInputListFile(opts, files, suffix, batchLabel = 'all') {
  const safeBatch = String(batchLabel).replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'all';
  const listPath = path.join(opts.bookRoot, 'qc-output', `panorama-${suffix}-${safeBatch}-inputs.txt`);
  ensureDir(path.dirname(listPath));
  fs.writeFileSync(listPath, files.join('\n') + '\n', 'utf8');
  return listPath;
}

function runNodeWithJsonOut(scriptPath, args, opts, jsonOutPath) {
  const timeoutMs = opts.timeoutMinutes * 60 * 1000;
  const heartbeatMs = Math.max(5000, (opts.heartbeatSeconds || 15) * 1000);
  const label = path.basename(scriptPath, '.mjs');

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let elapsed = 0;

    const child = spawn(process.execPath, [scriptPath, ...args, '--json-out', jsonOutPath], {
      cwd: opts.skillRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    const heartbeatTimer = setInterval(() => {
      elapsed += heartbeatMs;
      const mins = (elapsed / 60000).toFixed(1);
      process.stderr.write(`[quality] ${label} 执行中…已用时 ${mins} 分钟（超过 ${opts.timeoutMinutes} 分钟会输出已完成部分）\n`);
    }, heartbeatMs);
    if (heartbeatTimer.unref) heartbeatTimer.unref();

    const timeoutHandle = setTimeout(() => {
      clearInterval(heartbeatTimer);
      child.kill('SIGTERM');
      process.stderr.write(`[quality] ${label} 超时（${opts.timeoutMinutes}m），已终止，返回已完成部分\n`);
      resolve({ ok: false, error: `timeout:${opts.timeoutMinutes}m`, timeout: true });
    }, timeoutMs);
    if (timeoutHandle.unref) timeoutHandle.unref();

    child.on('close', (code) => {
      clearInterval(heartbeatTimer);
      clearTimeout(timeoutHandle);

      const fallbackJsonPath = label.includes('lite')
        ? path.join(opts.bookRoot, 'qc-output', 'quality-audit-lite.json')
        : path.join(opts.bookRoot, 'qc-output', 'quality-audit-machine.json');
      const resolvedJsonPath = fs.existsSync(jsonOutPath)
        ? jsonOutPath
        : (fs.existsSync(fallbackJsonPath) ? fallbackJsonPath : null);

      if (!resolvedJsonPath) {
        resolve({
          ok: false,
          error: 'json_out_missing',
          stdoutHead: String(stdout).slice(0, 500),
          stderrHead: String(stderr).slice(0, 500),
        });
        return;
      }

      try {
        const output = JSON.parse(fs.readFileSync(resolvedJsonPath, 'utf8'));
        output.reportPath = output.reportPath || resolvedJsonPath;
        resolve({ ok: true, output, status: code ?? 0 });
      } catch {
        resolve({ ok: false, error: 'invalid_json_file', stderrHead: String(stderr).slice(0, 500) });
      }
    });

    child.on('error', (err) => {
      clearInterval(heartbeatTimer);
      clearTimeout(timeoutHandle);
      resolve({ ok: false, error: err.message });
    });
  });
}

async function runMachineScan(opts, files, batchLabel = 'all') {
  const inputListPath = createInputListFile(opts, files, 'machine', batchLabel);
  const jsonOutPath = path.join(opts.bookRoot, 'qc-output', `panorama-machine-scan-${batchLabel}.json`);
  return runNodeWithJsonOut(path.join(opts.skillRoot, 'scripts', 'quality-auditor.mjs'), [
    '--book-root', opts.bookRoot,
    '--skill-root', opts.skillRoot,
    '--inputs-file', inputListPath,
    '--standalone',
  ], opts, jsonOutPath);
}

async function runLiteAudit(opts, files, batchLabel = 'all') {
  const inputListPath = createInputListFile(opts, files, 'lite', batchLabel);
  const jsonOutPath = path.join(opts.bookRoot, 'qc-output', `panorama-lite-audit-${batchLabel}.json`);
  return runNodeWithJsonOut(path.join(opts.skillRoot, 'scripts', 'quality-auditor-lite.mjs'), [
    '--book-root', opts.bookRoot,
    '--skill-root', opts.skillRoot,
    '--inputs-file', inputListPath,
    '--quiet',
    '--standalone',
    '--min-score', String(opts.minScore),
  ], opts, jsonOutPath);
}

function pickSampleFiles(grouped) {
  const samples = [];
  for (const [, items] of grouped.entries()) {
    const sorted = [...items].sort((a, b) => b.chars - a.chars);
    samples.push(...sorted.slice(0, Math.min(2, sorted.length)));
  }
  return samples;
}

function riskLevel(row) {
  const alerts = [row.s2Density > 1.5, row.s4Density >= 2, row.s5Hits > 0, row.s6Density > 1, row.sampleOverall < 7.5].filter(Boolean).length;
  if (alerts >= 3) return '🔴';
  if (alerts >= 1) return '🟡';
  return '🟢';
}

function buildPanoramaRows(grouped, machineSummary, liteSummary, bookRoot) {
  const machineByFile = new Map((machineSummary.results || []).map((result) => [path.resolve(result.filePath), result]));
  const liteByFile = new Map((liteSummary.results || []).map((result) => [path.resolve(result.filePath), result]));
  const rows = [];
  for (const [group, items] of grouped.entries()) {
    const machineRows = items.map((item) => machineByFile.get(path.resolve(item.filePath))).filter(Boolean);
    const sampleRows = items.map((item) => liteByFile.get(path.resolve(item.filePath))).filter(Boolean);
    const totalChars = items.reduce((sum, item) => sum + item.chars, 0);
    const s2Hits = machineRows.reduce((sum, row) => sum + Object.values(row.metrics?.adverbs || {}).reduce((a, b) => a + b, 0), 0);
    const s4Hits = machineRows.reduce((sum, row) => sum + Object.values(row.metrics?.connectors || {}).reduce((a, b) => a + b, 0), 0);
    const s5Hits = machineRows.reduce((sum, row) => sum + (row.metrics?.buzz?.length || 0), 0);
    const dashCount = machineRows.reduce((sum, row) => sum + Math.round((row.metrics?.dashDensity || 0) * ((row.metrics?.chars || 0) / 1000)), 0);
    const sampleOverall = sampleRows.length
      ? Number((sampleRows.reduce((sum, row) => sum + (row.scores?.overall || 0), 0) / sampleRows.length).toFixed(1))
      : 0;
    const row = {
      group,
      fileCount: items.length,
      totalChars,
      s2Density: Number(((s2Hits * 1000) / Math.max(totalChars, 1)).toFixed(2)),
      s4Density: Number(((s4Hits * 1000) / Math.max(totalChars, 1)).toFixed(2)),
      s5Hits,
      s6Density: Number(((dashCount * 1000) / Math.max(totalChars, 1)).toFixed(2)),
      sampleOverall,
      sampledFiles: sampleRows.map((row) => normalizeRel(row.filePath, bookRoot)),
    };
    row.risk = riskLevel(row);
    rows.push(row);
  }
  return rows.sort((a, b) => a.group.localeCompare(b.group, 'zh-Hans-CN'));
}

function renderPanoramaMarkdown(report) {
  const tableRows = report.heatmap.map((row) => `| ${row.group} | ${row.fileCount} | ${row.s2Density} | ${row.s4Density} | ${row.s5Hits} | ${row.s6Density} | ${row.sampleOverall || '—'} | ${row.risk} |`).join('\n');
  return `# 全景质检报告（Panorama Scan）\n\n- **书稿根目录**：\`${report.bookRoot.replace(/\\/g, '/')}\`\n- **文件数**：${report.totalFiles}\n- **总字符数**：${report.totalChars}\n- **模式**：${report.modeUsed}\n- **生成时间**：${report.generatedAt}\n\n## 全局热力图\n\n| 分组 | 文件数 | S2密度 | S4密度 | S5命中 | S6密度 | 抽样综合分 | 风险等级 |\n|---|---:|---:|---:|---:|---:|---:|---|\n${tableRows || '| root | 0 | 0 | 0 | 0 | 0 | — | 🟢 |'}\n\n## 下一步建议\n\n1. 默认优先对风险等级为 **🟡 / 🔴** 的分组进入逐文件精检。\n2. 抽样综合分 < 7.5 的分组，建议进入 deep 模式。\n3. 机器可检项高频分组，可先运行 quality-auditor.mjs --auto-fix 生成候选修复 diff。\n`;
}

function stageStats(stage, auditSummary) {
  const rows = (auditSummary?.results || []).filter((result) => result?.details?.[stage]);
  const failedFiles = [];
  for (const row of rows) {
    const details = row.details[stage] || {};
    const failedRules = Object.entries(details)
      .filter(([, value]) => !value?.passed)
      .map(([key]) => key);
    if (failedRules.length > 0) {
      failedFiles.push({ filePath: row.filePath, failedRules });
    }
  }
  return {
    totalFiles: rows.length,
    failedFileCount: failedFiles.length,
    passed: failedFiles.length === 0,
    failedFiles,
  };
}

function writeStageReport(opts, stage, payload) {
  ensureDir(opts.stageReportDir);
  const file = path.join(opts.stageReportDir, `stage-${stage}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return file;
}

function writePartial(opts, payload) {
  ensureDir(path.dirname(opts.partialFile));
  fs.writeFileSync(opts.partialFile, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function parseHistoryMeta(raw) {
  const match = String(raw || '').match(/<!-- FBS_QC_META ([\s\S]*?) -->/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export function loadHistoryIndex(historyDir) {
  if (!fs.existsSync(historyDir)) {
    return {
      reports: [],
      completedReports: [],
      coveredFiles: new Set(),
    };
  }

  const files = fs.readdirSync(historyDir)
    .filter((name) => /^qc-.*\.md$/i.test(name))
    .sort((a, b) => b.localeCompare(a, 'zh-Hans-CN'));

  const reports = [];
  const coveredFiles = new Set();
  for (const name of files) {
    const filePath = path.join(historyDir, name);
    let raw = '';
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const meta = parseHistoryMeta(raw);
    if (!meta) continue;
    const report = {
      filePath,
      ...meta,
    };
    reports.push(report);
    if (meta.status === 'completed' && Array.isArray(meta.coveredFiles)) {
      meta.coveredFiles.forEach((item) => coveredFiles.add(String(item)));
    }
  }

  return {
    reports,
    completedReports: reports.filter((item) => item.status === 'completed'),
    coveredFiles,
  };
}

export function filterInventoryByHistory(inventory, historyIndex, bookRoot) {
  const coveredFiles = historyIndex?.coveredFiles instanceof Set ? historyIndex.coveredFiles : new Set();
  const skippedFiles = [];
  const remaining = [];

  for (const item of inventory || []) {
    const relPath = normalizeRel(item.filePath, bookRoot);
    if (coveredFiles.has(relPath)) skippedFiles.push(relPath);
    else remaining.push(item);
  }

  return { inventory: remaining, skippedFiles };
}

function buildHistoryMeta(opts, report) {
  const coveredFiles = Array.isArray(report.files)
    ? report.files.map((filePath) => resolveBookRelativePath(opts.bookRoot, filePath)).filter(Boolean)
    : [];

  return {
    status: report.status || 'completed',
    modeUsed: report.modeUsed || 'panorama',
    generatedAt: report.generatedAt || report.endedAt || new Date().toISOString(),
    coveredFiles,
    totalFiles: coveredFiles.length,
    reason: report.reason || null,
  };
}

function renderHistoryMarkdown(report, meta) {
  const lines = [
    `${HISTORY_META_PREFIX}${JSON.stringify(meta)}${HISTORY_META_SUFFIX}`,
    `# 质检结果归档（${meta.modeUsed}）`,
    '',
    `- **状态**：${meta.status}`,
    `- **生成时间**：${meta.generatedAt}`,
    `- **覆盖文件数**：${meta.totalFiles}`,
  ];

  if (report.reusedHistoryCount) lines.push(`- **检测到历史结果**：${report.reusedHistoryCount} 份`);
  if (report.skippedFiles?.length) lines.push(`- **因历史复用跳过**：${report.skippedFiles.length} 个文件`);
  if (report.reason) lines.push(`- **中断原因**：${report.reason}`);
  if (report.historySourceSummary) lines.push(`- **历史复用说明**：${report.historySourceSummary}`);

  if (report.qualitySummary) {
    lines.push('', '## 质量汇总', '');
    lines.push(`- **total**：${report.qualitySummary.total ?? 0}`);
    lines.push(`- **passed**：${report.qualitySummary.passed ?? 0}`);
    lines.push(`- **failed**：${report.qualitySummary.failed ?? 0}`);
    lines.push(`- **avgScore**：${report.qualitySummary.avgScore ?? 0}`);
    lines.push(`- **minScore**：${report.qualitySummary.minScore ?? 0}`);
  }

  if (Array.isArray(report.stageReports) && report.stageReports.length > 0) {
    lines.push('', '## 阶段结果', '', '| 阶段 | 状态 | 失败文件数 |', '|---|---|---:|');
    for (const item of report.stageReports) {
      lines.push(`| ${item.stage} | ${item.passed ? 'passed' : 'failed'} | ${item.failedFileCount ?? 0} |`);
    }
  }

  if (Array.isArray(report.heatmap) && report.heatmap.length > 0) {
    lines.push('', '## Panorama 热力图', '', '| 分组 | 文件数 | 风险 |', '|---|---:|---|');
    for (const row of report.heatmap) {
      lines.push(`| ${row.group} | ${row.fileCount} | ${row.risk} |`);
    }
  }

  if (meta.coveredFiles.length > 0) {
    const preview = meta.coveredFiles.slice(0, 100);
    lines.push('', '## 覆盖文件', '');
    preview.forEach((file) => lines.push(`- ${file}`));
    if (meta.coveredFiles.length > preview.length) {
      lines.push(`- ... 还有 ${meta.coveredFiles.length - preview.length} 个文件`);
    }
  }

  return lines.join('\n') + '\n';
}

export function writeHistoryReport(opts, report) {
  ensureDir(opts.historyDir);
  const meta = buildHistoryMeta(opts, report);
  const stamp = meta.generatedAt.replace(/[:.]/g, '-');
  const fileName = `qc-${meta.modeUsed}-${stamp}.md`;
  const filePath = path.join(opts.historyDir, fileName);
  fs.writeFileSync(filePath, renderHistoryMarkdown(report, meta), 'utf8');
  return filePath;
}

function persistOutcome(opts, payload) {
  const historyReportPath = writeHistoryReport(opts, payload);
  const snapshot = {
    ...payload,
    historyReportPath,
  };
  writePartial(opts, snapshot);
  return snapshot;
}

export function buildExecutionBatches(inventory, threshold = 120) {
  const safeThreshold = Math.max(1, Number(threshold) || 120);
  if (!Array.isArray(inventory) || inventory.length === 0) return [];
  if (inventory.length <= safeThreshold) {
    return [{ label: 'all', items: [...inventory] }];
  }

  const grouped = [...groupInventoryByGroup(inventory).entries()]
    .map(([group, items]) => [group, [...items].sort((a, b) => a.relPath.localeCompare(b.relPath, 'zh-Hans-CN'))])
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN'));

  const batches = [];
  let currentItems = [];
  let currentGroups = [];

  const flush = () => {
    if (currentItems.length === 0) return;
    batches.push({
      label: currentGroups.join(', ') || `batch-${batches.length + 1}`,
      items: currentItems,
    });
    currentItems = [];
    currentGroups = [];
  };

  for (const [group, items] of grouped) {
    if (items.length > safeThreshold) {
      flush();
      const totalParts = Math.ceil(items.length / safeThreshold);
      for (let i = 0; i < items.length; i += safeThreshold) {
        batches.push({
          label: `${group} (${Math.floor(i / safeThreshold) + 1}/${totalParts})`,
          items: items.slice(i, i + safeThreshold),
        });
      }
      continue;
    }

    if (currentItems.length > 0 && currentItems.length + items.length > safeThreshold) {
      flush();
    }

    currentItems = currentItems.concat(items);
    currentGroups.push(group);
  }

  flush();
  return batches;
}

function mergeMachineOutputs(outputs) {
  const merged = {
    total: 0,
    issueCount: 0,
    warningCount: 0,
    results: [],
    reportPaths: [],
  };

  for (const output of outputs) {
    const total = Number(output.total || output.results?.length || 0);
    merged.total += total;
    merged.issueCount += Number(output.issueCount || 0);
    merged.warningCount += Number(output.warningCount || 0);
    if (Array.isArray(output.results)) merged.results.push(...output.results);
    if (output.reportPath) merged.reportPaths.push(output.reportPath);
  }

  return merged;
}

function mergeLiteOutputs(outputs) {
  const merged = {
    total: 0,
    passed: 0,
    failed: 0,
    avgScore: 0,
    results: [],
    reportPaths: [],
  };

  let weightedScoreSum = 0;
  for (const output of outputs) {
    const total = Number(output.total || output.results?.length || 0);
    merged.total += total;
    merged.passed += Number(output.passed || 0);
    merged.failed += Number(output.failed || 0);
    weightedScoreSum += Number(output.avgScore || 0) * total;
    if (Array.isArray(output.results)) merged.results.push(...output.results);
    if (output.reportPath) merged.reportPaths.push(output.reportPath);
  }

  merged.avgScore = merged.total > 0 ? Number((weightedScoreSum / merged.total).toFixed(2)) : 0;
  return merged;
}

async function runMachineScanInBatches(opts, inventory) {
  const batches = buildExecutionBatches(inventory, opts.xlBatchThreshold);
  const outputs = [];

  for (let index = 0; index < batches.length; index++) {
    if (opts.maxTurns > 0 && index >= opts.maxTurns) {
      console.warn(`[panorama] machine-scan 已达 maxTurns=${opts.maxTurns} 批次上限，停止后续批次`);
      break;
    }
    const batch = batches[index];
    const summary = `machine-scan ${index + 1}/${batches.length}`;
    console.log(`[panorama] ${summary} · ${batch.label} · files=${batch.items.length}`);
    writeProgress(opts, {
      status: 'running',
      modeUsed: 'panorama',
      stage: 'PANORAMA_MACHINE',
      batchIndex: index + 1,
      batchCount: batches.length,
      batchLabel: batch.label,
      processedFiles: outputs.reduce((sum, output) => sum + Number(output.total || output.results?.length || 0), 0),
      totalFiles: inventory.length,
      scope: buildScopeLabel(batch.items),
    });
    emitStageChange(opts, 'PANORAMA_MACHINE', {
      batchIndex: index + 1,
      batchCount: batches.length,
      scope: batch.label,
    });

    const run = await runMachineScan(opts, batch.items.map((item) => item.filePath), `batch-${index + 1}`);
    if (!run.ok) {
      return { ok: false, error: run.error || 'machine_scan_failed', batchIndex: index + 1, batchCount: batches.length };
    }
    outputs.push(run.output);
  }

  return {
    ok: true,
    output: mergeMachineOutputs(outputs),
    batches,
  };
}

async function runLiteAuditInBatches(opts, inventory, stageLabel = 'DEEP_SCAN') {
  const batches = buildExecutionBatches(inventory, opts.xlBatchThreshold);
  const outputs = [];

  for (let index = 0; index < batches.length; index++) {
    if (opts.maxTurns > 0 && index >= opts.maxTurns) {
      console.warn(`[panorama] ${stageLabel} 已达 maxTurns=${opts.maxTurns} 批次上限，停止后续批次`);
      break;
    }
    const batch = batches[index];
    const summary = `${stageLabel.toLowerCase()} ${index + 1}/${batches.length}`;
    console.log(`[panorama] ${summary} · ${batch.label} · files=${batch.items.length}`);
    writeProgress(opts, {
      status: 'running',
      modeUsed: stageLabel === 'PANORAMA_SAMPLE' ? 'panorama' : 'deep',
      stage: stageLabel,
      batchIndex: index + 1,
      batchCount: batches.length,
      batchLabel: batch.label,
      processedFiles: outputs.reduce((sum, output) => sum + Number(output.total || output.results?.length || 0), 0),
      totalFiles: inventory.length,
      scope: buildScopeLabel(batch.items),
    });
    emitStageChange(opts, stageLabel, {
      batchIndex: index + 1,
      batchCount: batches.length,
      scope: batch.label,
    });

    const run = await runLiteAudit(opts, batch.items.map((item) => item.filePath), `batch-${index + 1}`);
    if (!run.ok) {
      return { ok: false, error: run.error || 'lite_audit_failed', batchIndex: index + 1, batchCount: batches.length };
    }
    outputs.push(run.output);
  }

  return {
    ok: true,
    output: mergeLiteOutputs(outputs),
    batches,
  };
}

function blockLargeScopeIfNeeded(opts, analysisMode, inventory, historyIndex, skippedFiles) {
  if (inventory.length <= opts.largeScopeConfirmationThreshold || opts.confirmLargeScan) return null;

  const recommendations = [
    `范围较大，建议先做增量扫描（只扫近 ${opts.sinceHours} 小时内有变化的文件）`,
    `如果确实需要全量扫，加上 ${opts.confirmFlag} 参数继续`,
  ];
  if (inventory.length >= opts.xlBatchThreshold) {
    recommendations.push(`文件数已超过 ${opts.xlBatchThreshold} 个，建议按分组分批执行，避免单次超时`);
  }
  if ((historyIndex?.completedReports?.length || 0) > 0) {
    recommendations.push(`发现 ${historyIndex.completedReports.length} 份历史质检结果，可以先复用已完成部分，节省时间`);
  }
  if ((skippedFiles?.length || 0) > 0) {
    recommendations.push(`本轮已有 ${skippedFiles.length} 个文件命中历史结果，将自动跳过`);
  }

  const message = `发现 ${inventory.length} 个目标文件，超过了 ${opts.largeScopeConfirmationThreshold} 个的确认门槛。这次要全量扫吗？${recommendations.join('；')}`;
  console.error(`[panorama] ${message}`);
  emitQualityGateEvent(opts, 'quality-large-scope-confirmation-required', {
    analysisMode,
    fileCount: inventory.length,
    threshold: opts.largeScopeConfirmationThreshold,
    recommendations,
  });
  writeProgress(opts, {
    status: 'awaiting_confirmation',
    modeUsed: analysisMode,
    stage: 'PRE_SCAN_GATE',
    totalFiles: inventory.length,
    scope: buildScopeLabel(inventory),
    recommendations,
    message,
  });

  return persistOutcome(opts, {
    status: 'blocked',
    reason: 'awaiting_large_scope_confirmation',
    modeUsed: analysisMode,
    generatedAt: new Date().toISOString(),
    files: inventory.map((item) => item.filePath),
    recommendations,
    skippedFiles,
    reusedHistoryCount: historyIndex?.completedReports?.length || 0,
  });
}

function persistSkippedResult(opts, analysisMode, historyIndex, skippedFiles) {
  const message = skippedFiles.length > 0
    ? `[panorama] 历史结果已覆盖当前范围，本轮跳过。skipped=${skippedFiles.length}`
    : '[panorama] 没有命中目标文件，本轮跳过。';
  console.log(message);
  writeProgress(opts, {
    status: 'skipped',
    modeUsed: analysisMode,
    stage: 'SKIPPED',
    totalFiles: 0,
    scope: 'empty',
    skippedFiles,
    reusedHistoryCount: historyIndex?.completedReports?.length || 0,
    message,
  });
  emitOrchestratorEvent(opts, 'quality-scan-skipped', {
    analysisMode,
    skippedFiles: skippedFiles.length,
  });
  return { code: 0, report: null, skipped: true };
}

export async function runDeepAudit(opts, inventory, historyIndex, skippedFiles = []) {
  const files = inventory.map((item) => item.filePath);
  const startedAt = new Date().toISOString();
  const batchPlan = buildExecutionBatches(inventory, opts.xlBatchThreshold);

  const deepStartMessage = opts.progressReportOnStart
    ? formatTemplate(opts.progressReportTemplate, {
        stage: 'DEEP',
        scope: buildScopeLabel(inventory),
        etaMinutes: estimateEtaMinutes(inventory.length, 'deep', batchPlan.length),
        timeoutMinutes: opts.timeoutMinutes,
      })
    : null;
  if (deepStartMessage) console.log(`[panorama] ${deepStartMessage}`);
  writeProgress(opts, {
    status: 'running',
    modeUsed: 'deep',
    stage: 'DEEP_SCAN',
    totalFiles: inventory.length,
    scope: buildScopeLabel(inventory),
    etaMinutes: estimateEtaMinutes(inventory.length, 'deep', batchPlan.length),
    message: deepStartMessage,
  });
  emitOrchestratorEvent(opts, 'quality-deep-started', {
    fileCount: inventory.length,
    batchCount: batchPlan.length,
  });

  const run = await runLiteAuditInBatches(opts, inventory, 'DEEP_SCAN');
  if (!run.ok) {
    const partial = persistOutcome(opts, {
      status: 'partial',
      reason: run.error || 'deep_scan_failed',
      modeUsed: 'deep',
      startedAt,
      endedAt: new Date().toISOString(),
      files,
      skippedFiles,
      reusedHistoryCount: historyIndex?.completedReports?.length || 0,
      fallback: opts.fallbackWhenInterrupted,
    });
    writeProgress(opts, {
      status: 'partial',
      modeUsed: 'deep',
      stage: 'DEEP_SCAN',
      totalFiles: inventory.length,
      scope: buildScopeLabel(inventory),
      reason: partial.reason,
      historyReportPath: partial.historyReportPath,
    });
    return { code: 1, report: partial };
  }

  const auditCache = run.output;
  const stageReports = [];
  for (const stage of STAGES) {
    const stat = stageStats(stage, auditCache);
    const stagePayload = {
      stage,
      status: stat.passed ? 'passed' : 'failed',
      startedAt,
      endedAt: new Date().toISOString(),
      fileCount: files.length,
      batchCount: run.batches.length,
      summary: stat,
    };
    const stageReportFile = writeStageReport(opts, stage, stagePayload);
    stageReports.push({ stage, stageReportFile, ...stat });
    emitStageChange(opts, stage, {
      passed: stat.passed,
      failedFileCount: stat.failedFileCount,
    });
    writeProgress(opts, {
      status: 'running',
      modeUsed: 'deep',
      stage,
      totalFiles: inventory.length,
      scope: buildScopeLabel(inventory),
      failedFileCount: stat.failedFileCount,
    });

    if (!stat.passed && opts.strictStageGate) {
      const partial = persistOutcome(opts, {
        status: 'partial',
        reason: `stage_${stage}_failed`,
        stage,
        modeUsed: 'deep',
        startedAt,
        endedAt: new Date().toISOString(),
        files,
        stageReports,
        skippedFiles,
        reusedHistoryCount: historyIndex?.completedReports?.length || 0,
        fallback: opts.fallbackWhenInterrupted,
      });
      writeProgress(opts, {
        status: 'partial',
        modeUsed: 'deep',
        stage,
        totalFiles: inventory.length,
        scope: buildScopeLabel(inventory),
        reason: partial.reason,
        historyReportPath: partial.historyReportPath,
      });
      return { code: 1, report: partial };
    }
  }

  const report = persistOutcome(opts, {
    status: 'completed',
    modeUsed: 'deep',
    startedAt,
    endedAt: new Date().toISOString(),
    files,
    stageReports,
    batchPlan: run.batches.map((batch) => ({ label: batch.label, size: batch.items.length })),
    skippedFiles,
    reusedHistoryCount: historyIndex?.completedReports?.length || 0,
    qualitySummary: {
      total: auditCache?.total ?? 0,
      passed: auditCache?.passed ?? 0,
      failed: auditCache?.failed ?? 0,
      avgScore: auditCache?.avgScore ?? 0,
      minScore: opts.minScore,
    },
  });

  writeProgress(opts, {
    status: 'completed',
    modeUsed: 'deep',
    stage: 'DONE',
    totalFiles: inventory.length,
    scope: buildScopeLabel(inventory),
    historyReportPath: report.historyReportPath,
  });
  emitOrchestratorEvent(opts, 'quality-deep-completed', {
    fileCount: inventory.length,
    historyReportPath: report.historyReportPath,
  });
  console.log(`[panorama] ✅ 深度质检完成。报告：${opts.partialFile}`);
  return { code: 0, report };
}

export async function runPanoramaAudit(opts, runtime, inventory, historyIndex, skippedFiles = []) {
  const grouped = groupInventoryByGroup(inventory);
  const sampleInventory = pickSampleFiles(grouped);
  const startedAt = new Date().toISOString();
  const machineBatches = buildExecutionBatches(inventory, opts.xlBatchThreshold);

  const panoramaStartMessage = opts.progressReportOnStart
    ? formatTemplate(opts.progressReportTemplate, {
        stage: 'PANORAMA',
        scope: buildScopeLabel(inventory),
        etaMinutes: estimateEtaMinutes(inventory.length, 'panorama', machineBatches.length),
        timeoutMinutes: opts.timeoutMinutes,
      })
    : null;
  if (panoramaStartMessage) console.log(`[panorama] ${panoramaStartMessage}`);
  writeProgress(opts, {
    status: 'running',
    modeUsed: 'panorama',
    stage: 'PANORAMA_START',
    totalFiles: inventory.length,
    scope: buildScopeLabel(inventory),
    etaMinutes: estimateEtaMinutes(inventory.length, 'panorama', machineBatches.length),
    message: panoramaStartMessage,
  });
  emitOrchestratorEvent(opts, 'quality-panorama-started', {
    fileCount: inventory.length,
    batchCount: machineBatches.length,
  });

  const machineRun = await runMachineScanInBatches(opts, inventory);
  if (!machineRun.ok) {
    const partial = persistOutcome(opts, {
      status: 'partial',
      reason: machineRun.error,
      modeUsed: 'panorama',
      startedAt,
      endedAt: new Date().toISOString(),
      files: inventory.map((item) => item.filePath),
      skippedFiles,
      reusedHistoryCount: historyIndex?.completedReports?.length || 0,
      fallback: opts.fallbackWhenInterrupted,
    });
    writeProgress(opts, {
      status: 'partial',
      modeUsed: 'panorama',
      stage: 'PANORAMA_MACHINE',
      totalFiles: inventory.length,
      scope: buildScopeLabel(inventory),
      reason: partial.reason,
      historyReportPath: partial.historyReportPath,
    });
    return { code: 1, report: partial };
  }

  const liteRun = await runLiteAuditInBatches(opts, sampleInventory, 'PANORAMA_SAMPLE');
  if (!liteRun.ok) {
    const partial = persistOutcome(opts, {
      status: 'partial',
      reason: liteRun.error,
      modeUsed: 'panorama',
      startedAt,
      endedAt: new Date().toISOString(),
      files: inventory.map((item) => item.filePath),
      skippedFiles,
      reusedHistoryCount: historyIndex?.completedReports?.length || 0,
      fallback: opts.fallbackWhenInterrupted,
    });
    writeProgress(opts, {
      status: 'partial',
      modeUsed: 'panorama',
      stage: 'PANORAMA_SAMPLE',
      totalFiles: inventory.length,
      scope: buildScopeLabel(inventory),
      reason: partial.reason,
      historyReportPath: partial.historyReportPath,
    });
    return { code: 1, report: partial };
  }

  const heatmap = buildPanoramaRows(grouped, machineRun.output, liteRun.output, opts.bookRoot);
  const report = {
    status: 'completed',
    modeUsed: 'panorama',
    generatedAt: new Date().toISOString(),
    startedAt,
    endedAt: new Date().toISOString(),
    bookRoot: opts.bookRoot,
    totalFiles: inventory.length,
    totalChars: inventory.reduce((sum, item) => sum + item.chars, 0),
    heatmap,
    machineScan: {
      total: machineRun.output.total,
      issueCount: machineRun.output.issueCount,
      warningCount: machineRun.output.warningCount,
      reportPath: machineRun.output.reportPaths?.[0] || machineRun.output.reportPath || null,
    },
    sampleAudit: {
      total: liteRun.output.total,
      avgScore: liteRun.output.avgScore,
      reportPath: liteRun.output.reportPaths?.[0] || liteRun.output.reportPath || null,
    },
    sampleFiles: sampleInventory.map((item) => normalizeRel(item.filePath, opts.bookRoot)),
    batchPlan: machineRun.batches.map((batch) => ({ label: batch.label, size: batch.items.length })),
    skippedFiles,
    reusedHistoryCount: historyIndex?.completedReports?.length || 0,
    bareMode: runtime?.contextPath ? true : false,
    files: inventory.map((item) => item.filePath),
  };

  const jsonPath = path.join(opts.bookRoot, 'qc-output', 'panorama-report.json');
  const mdPath = path.join(opts.bookRoot, 'qc-output', 'panorama-report.md');
  writeJson(jsonPath, report);
  fs.writeFileSync(mdPath, renderPanoramaMarkdown(report), 'utf8');
  report.reportPath = jsonPath;
  report.markdownReportPath = mdPath;

  const finalReport = persistOutcome(opts, report);
  writeProgress(opts, {
    status: 'completed',
    modeUsed: 'panorama',
    stage: 'DONE',
    totalFiles: inventory.length,
    scope: buildScopeLabel(inventory),
    historyReportPath: finalReport.historyReportPath,
    markdownReportPath: mdPath,
  });
  emitOrchestratorEvent(opts, 'quality-panorama-completed', {
    fileCount: inventory.length,
    historyReportPath: finalReport.historyReportPath,
    markdownReportPath: mdPath,
  });
  console.log(`[panorama] ✅ 概览扫描完成。JSON：${jsonPath} | MD：${mdPath}`);
  return { code: 0, report: finalReport };
}

export async function runQualityPanorama(rawArgv = process.argv) {
  let opts = parseArgs(rawArgv);
  const policy = loadPolicySafely(opts.skillRoot);
  opts = applyExecutionPolicy(opts, policy);

  const allFiles = collectMarkdownFiles(opts.bookRoot);
  if (!allFiles.length) {
    console.log('[panorama] 未发现 Markdown 文件，跳过。');
    writeProgress(opts, {
      status: 'skipped',
      modeUsed: 'none',
      stage: 'EMPTY',
      totalFiles: 0,
      scope: 'empty',
      message: '未发现 Markdown 文件',
    });
    return { code: 0, report: null, skipped: true };
  }

  const runtime = (opts.bare || !fs.existsSync(path.join(opts.bookRoot, '.fbs')))
    ? ensureBareQualityWorkspace(opts.bookRoot, { files: allFiles })
    : null;

  const inventory = runtime?.inventory || buildInventory(allFiles, opts.bookRoot);
  const analysisMode = resolveAnalysisMode(opts, inventory);
  const candidateInventory = resolveTargetInventory(opts, inventory, analysisMode);
  const historyIndex = loadHistoryIndex(opts.historyDir);
  const filtered = opts.reuseHistory
    ? filterInventoryByHistory(candidateInventory, historyIndex, opts.bookRoot)
    : { inventory: candidateInventory, skippedFiles: [] };
  const targetInventory = filtered.inventory;

  if (!targetInventory.length) {
    return persistSkippedResult(opts, analysisMode, historyIndex, filtered.skippedFiles);
  }

  const blocked = blockLargeScopeIfNeeded(opts, analysisMode, targetInventory, historyIndex, filtered.skippedFiles);
  if (blocked) {
    return { code: 2, report: blocked, blocked: true };
  }

  let lock = null;
  try {
    lock = acquireScanLock(opts, targetInventory);
    emitQualityGateEvent(opts, 'quality-scan-lock-acquired', {
      lockCreatedAt: lock.createdAt,
      fileCount: targetInventory.length,
    });
    console.log(`[panorama] 启动质检：analysis=${analysisMode} selection=${opts.selectionMode} files=${targetInventory.length}`);
    return analysisMode === 'panorama'
      ? await runPanoramaAudit(opts, runtime, targetInventory, historyIndex, filtered.skippedFiles)
      : await runDeepAudit(opts, targetInventory, historyIndex, filtered.skippedFiles);
  } catch (error) {
    if (error?.code === 'SCAN_LOCK_ACTIVE') {
      const message = `当前已有质检在运行中，请等待结束或清理过期锁：${opts.lockFile}`;
      console.error(`[panorama] ${message}`);
      emitQualityGateEvent(opts, 'quality-scan-lock-active', {
        lockFile: opts.lockFile,
        activeSince: error.lock?.createdAt || null,
      });
      writeProgress(opts, {
        status: 'blocked',
        modeUsed: analysisMode,
        stage: 'SCAN_LOCK',
        totalFiles: targetInventory.length,
        scope: buildScopeLabel(targetInventory),
        message,
      });
      return { code: 2, report: null, blocked: true };
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(`[panorama] 未处理异常：${message}`);
    const partial = persistOutcome(opts, {
      status: 'partial',
      reason: message,
      modeUsed: analysisMode,
      generatedAt: new Date().toISOString(),
      files: targetInventory.map((item) => item.filePath),
      skippedFiles: filtered.skippedFiles,
      reusedHistoryCount: historyIndex?.completedReports?.length || 0,
      fallback: opts.fallbackWhenInterrupted,
    });
    writeProgress(opts, {
      status: 'partial',
      modeUsed: analysisMode,
      stage: 'UNHANDLED_ERROR',
      totalFiles: targetInventory.length,
      scope: buildScopeLabel(targetInventory),
      reason: message,
      historyReportPath: partial.historyReportPath,
    });
    return { code: 1, report: partial };
  } finally {
    if (lock) releaseScanLock(opts);
  }
}

function isDirectRun() {
  return !!process.argv[1] && path.resolve(process.argv[1]) === __filename;
}


if (isDirectRun()) {
  runQualityPanorama(process.argv).then((result) => {
    process.exit(result.code);
  }).catch((err) => {
    console.error('[panorama] 未处理异常:', err);
    process.exit(1);
  });
}
