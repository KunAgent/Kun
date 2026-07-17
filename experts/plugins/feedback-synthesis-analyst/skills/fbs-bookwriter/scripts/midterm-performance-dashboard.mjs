#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runBookStateWeeklyExport, getIsoWeekLabel } from './book-state-weekly-export.mjs';
import { ensureGovernanceDir } from './lib/governance-artifacts.mjs';
import { runBuildSearchKnowledgeCards } from './build-search-knowledge-cards.mjs';
import { runKnowledgeReuseKpi } from './knowledge-reuse-kpi.mjs';

function parseArgs(argv) {
  const o = {
    bookRoot: null,
    days: 7,
    weekLabel: null,
    json: false,
    jsonOut: null,
    mdOut: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') o.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--days') o.days = Math.max(1, Number(argv[++i] || 7));
    else if (a === '--week-label') o.weekLabel = String(argv[++i] || '').trim() || null;
    else if (a === '--json') o.json = true;
    else if (a === '--json-out') o.jsonOut = path.resolve(argv[++i] || '');
    else if (a === '--md-out') o.mdOut = path.resolve(argv[++i] || '');
  }
  return o;
}

function readJsonIfExists(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function listTraceFiles(auditDir) {
  if (!fs.existsSync(auditDir)) return [];
  return fs
    .readdirSync(auditDir)
    .filter((n) => /^trace-\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
    .map((n) => path.join(auditDir, n));
}

function parseJsonl(filePath) {
  const out = [];
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // ignore malformed lines
    }
  }
  return out;
}

function inWindow(ts, fromTsMs) {
  const t = new Date(ts || '').getTime();
  if (!Number.isFinite(t)) return false;
  return t >= fromTsMs;
}

function fileUpdatedInWindow(filePath, fromTsMs) {
  if (!fs.existsSync(filePath)) return false;
  try {
    return fs.statSync(filePath).mtimeMs >= fromTsMs;
  } catch {
    return false;
  }
}

function score(checks) {
  const total = checks.length;
  const pass = checks.filter((x) => x.ok).length;
  return {
    pass,
    total,
    rate: total > 0 ? Number(((pass / total) * 100).toFixed(1)) : 0,
  };
}

function evaluateLedgerTemporal(entry) {
  const hasTimestamp = Number.isFinite(new Date(entry?.timestamp || '').getTime());
  const hasSignal = Boolean(
    String(entry?.query || '').trim() ||
      String(entry?.searchScope || '').trim() ||
      String(entry?.whyNow || '').trim() ||
      String(entry?.url || '').trim() ||
      String(entry?.resultSummary || '').trim()
  );
  const line = `${entry?.message || ''} ${entry?.offlineFallback || ''}`.toLowerCase();
  const offlineDeclared = line.includes('离线') || line.includes('offline');
  const stateOk = entry?.ok === false ? offlineDeclared : true;
  return hasTimestamp && hasSignal && stateOk;
}

function buildMdReport(payload) {
  const lines = [];
  lines.push(`# Midterm Performance Dashboard (${payload.weekLabel})`);
  lines.push('');
  lines.push(`- 统计窗口：最近 ${payload.windowDays} 天`);
  lines.push(`- 窗口起点：${payload.fromTs}`);
  lines.push(`- 书稿根：${payload.bookRoot}`);
  lines.push('');
  lines.push('## KPI');
  lines.push(`- 触发自动化率：${payload.kpi.triggerAutomationRate.rate}% (${payload.kpi.triggerAutomationRate.pass}/${payload.kpi.triggerAutomationRate.total})`);
  lines.push(`- 时态可信率：${payload.kpi.temporalTrustRate.rate}% (${payload.kpi.temporalTrustRate.pass}/${payload.kpi.temporalTrustRate.total})`);
  lines.push(`- 会话恢复就绪率：${payload.kpi.resumeReadinessRate.rate}% (${payload.kpi.resumeReadinessRate.pass}/${payload.kpi.resumeReadinessRate.total})`);
  lines.push(`- 证据完备率：${payload.kpi.evidenceCompletenessRate.rate}% (${payload.kpi.evidenceCompletenessRate.pass}/${payload.kpi.evidenceCompletenessRate.total})`);
  lines.push(`- 知识复用率：${payload.kpi.knowledgeReuseRate}%`);
  lines.push('');
  lines.push('## 检查明细');
  for (const check of payload.checks) {
    lines.push(`- [${check.ok ? 'x' : ' '}] ${check.id}：${check.detail}`);
  }
  lines.push('');
  lines.push('## 风险提示');
  if (payload.risks.length === 0) {
    lines.push('- 无明显阻断风险。');
  } else {
    for (const r of payload.risks) lines.push(`- ${r}`);
  }
  lines.push('');
  lines.push('## 下一步（自动建议）');
  for (const x of payload.nextActions) lines.push(`- ${x}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function runMidtermPerformanceDashboard({ bookRoot, days = 7, weekLabel = null, jsonOut = null, mdOut = null } = {}) {
  const root = path.resolve(bookRoot || process.cwd());
  const fbs = path.join(root, '.fbs');
  const governanceDir = ensureGovernanceDir(root);

  const weekly = runBookStateWeeklyExport({ bookRoot: root, days, weekLabel: weekLabel || null });
  runBuildSearchKnowledgeCards({ bookRoot: root });
  const reuse = runKnowledgeReuseKpi({ bookRoot: root });
  const week = weekLabel || getIsoWeekLabel(new Date());
  const fromTs = weekly.fromTs;
  const fromTsMs = new Date(fromTs).getTime();

  const traceEvents = listTraceFiles(path.join(fbs, 'audit'))
    .flatMap(parseJsonl)
    .filter((e) => inWindow(e?.ts, fromTsMs));
  const eventCount = (eventName) => traceEvents.filter((e) => e?.event === eventName).length;

  const ledgerPath = path.join(fbs, 'search-ledger.jsonl');
  const allLedger = fs.existsSync(ledgerPath) ? parseJsonl(ledgerPath) : [];
  const ledgerInWindow = allLedger.filter((e) => {
    const t = new Date(e?.timestamp || '').getTime();
    return Number.isFinite(t) ? t >= fromTsMs : true;
  });

  const resume = readJsonIfExists(path.join(fbs, 'workbuddy-resume.json'), {});
  const runtimeNudges = readJsonIfExists(path.join(fbs, 'runtime-nudges.json'), null);
  const health = readJsonIfExists(path.join(fbs, 'book-health-snapshot.json'), null);
  const reportsDir = governanceDir;

  const checks = [
    { id: 'intake-router-trace', ok: eventCount('intake_router') > 0, detail: `intake_router 事件 ${eventCount('intake_router')} 次` },
    {
      id: 'search-preflight-or-ledger',
      ok: eventCount('search_preflight') > 0 || ledgerInWindow.length > 0,
      detail: `search_preflight 事件 ${eventCount('search_preflight')} 次，ledger 条目 ${ledgerInWindow.length} 条`,
    },
    { id: 'session-exit-trace', ok: eventCount('session_exit') > 0, detail: `session_exit 事件 ${eventCount('session_exit')} 次` },
    {
      id: 'runtime-nudge-recent',
      ok: fileUpdatedInWindow(path.join(fbs, 'runtime-nudges.json'), fromTsMs),
      detail: 'runtime-nudges.json 在窗口内更新',
    },
    {
      id: 'book-health-snapshot-recent',
      ok: fileUpdatedInWindow(path.join(fbs, 'book-health-snapshot.json'), fromTsMs),
      detail: 'book-health-snapshot.json 在窗口内更新',
    },
    {
      id: 'resume-modified-files',
      ok: Array.isArray(resume?.modifiedFiles),
      detail: `workbuddy-resume.modifiedFiles=${Array.isArray(resume?.modifiedFiles) ? resume.modifiedFiles.length : 'missing'}`,
    },
  ];

  const triggerAutomationRate = score(checks.slice(0, 5));
  const temporalChecks = ledgerInWindow.length
    ? ledgerInWindow.map((entry, idx) => ({ id: `ledger-${idx + 1}`, ok: evaluateLedgerTemporal(entry) }))
    : [{ id: 'ledger-empty', ok: false }];
  const temporalTrustRate = score(temporalChecks);

  const resumeReadinessRate = score([
    { id: 'resume-exists', ok: fs.existsSync(path.join(fbs, 'workbuddy-resume.json')) },
    { id: 'resume-nextRecommendations', ok: Boolean(String(resume?.nextRecommendations || '').trim()) },
    { id: 'resume-modifiedFiles-array', ok: Array.isArray(resume?.modifiedFiles) },
    { id: 'resume-updated-in-window', ok: fileUpdatedInWindow(path.join(fbs, 'workbuddy-resume.json'), fromTsMs) },
  ]);

  const evidenceCompletenessRate = score([
    { id: 'weekly-report-json', ok: fs.existsSync(weekly.jsonPath) },
    { id: 'weekly-report-md', ok: fs.existsSync(weekly.mdPath) },
    { id: 'runtime-nudge-json', ok: runtimeNudges && typeof runtimeNudges === 'object' },
    { id: 'health-snapshot-json', ok: health && typeof health === 'object' },
    { id: 'search-ledger-exists', ok: fs.existsSync(ledgerPath) },
    { id: 'trace-events-window', ok: traceEvents.length > 0 },
  ]);

  const risks = [];
  if (triggerAutomationRate.rate < 95) risks.push(`触发自动化率 ${triggerAutomationRate.rate}% 未达到目标 95%`);
  if (temporalTrustRate.rate < 90) risks.push(`时态可信率 ${temporalTrustRate.rate}% 未达到目标 90%`);
  if (resumeReadinessRate.rate < 90) risks.push(`会话恢复就绪率 ${resumeReadinessRate.rate}% 未达到目标 90%`);
  if (evidenceCompletenessRate.rate < 95) risks.push(`证据完备率 ${evidenceCompletenessRate.rate}% 未达到目标 95%`);
  if (Number(reuse?.totals?.reuseRate || 0) < 20) risks.push(`知识复用率 ${Number(reuse?.totals?.reuseRate || 0)}% 偏低，需提升知识卡回用`);
  if (!ledgerInWindow.length) risks.push('窗口内无 search-ledger 条目，无法证明联网检索合同执行');

  const nextActions = [];
  if (eventCount('intake_router') === 0) nextActions.push('首轮进入或 bookRoot 变更时强制跑 intake-router 并写 trace 事件。');
  if (eventCount('session_exit') === 0) nextActions.push('本周会话结束统一走 session-exit，确保恢复卡可续写。');
  if (temporalTrustRate.rate < 90) nextActions.push('高风险事实采用反向验证查询链，补齐时间锚与来源锚。');
  if (!fileUpdatedInWindow(path.join(fbs, 'runtime-nudges.json'), fromTsMs)) nextActions.push('每次阶段切换后运行 runtime-nudge 生成必做提醒。');
  if (!fileUpdatedInWindow(path.join(fbs, 'book-health-snapshot.json'), fromTsMs)) nextActions.push('每日收口前运行 book-health-snapshot 更新控制面状态。');
  if (Number(reuse?.totals?.reuseRate || 0) < 20) nextActions.push('在章节中加入 [KC:<cardId>] 或来源 URL 的回引，提升知识复用率。');
  if (nextActions.length === 0) nextActions.push('保持当前节奏，进入下一窗口继续压降风险复发率。');

  const payload = {
    schemaVersion: '1.0.0',
    domain: 'governance',
    generatedAt: new Date().toISOString(),
    weekLabel: week,
    windowDays: days,
    fromTs,
    bookRoot: root,
    artifacts: {
      artifactRoot: governanceDir,
      ledgerPath,
      weeklyJson: weekly.jsonPath,
      weeklyMd: weekly.mdPath,
      governanceDir,
    },
    sourceStats: {
      traceEventsInWindow: traceEvents.length,
      ledgerEntriesInWindow: ledgerInWindow.length,
      weeklyEventTotal: weekly.eventTotal,
      weeklyGateTotal: weekly.gateTotal,
    },
    kpi: {
      triggerAutomationRate,
      temporalTrustRate,
      resumeReadinessRate,
      evidenceCompletenessRate,
      knowledgeReuseRate: Number(reuse?.totals?.reuseRate || 0),
    },
    checks,
    risks,
    nextActions,
  };

  const finalJson = jsonOut || path.join(governanceDir, `midterm-performance-dashboard-${week}.json`);
  const finalMd = mdOut || path.join(governanceDir, `midterm-performance-dashboard-${week}.md`);
  fs.writeFileSync(finalJson, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(finalMd, buildMdReport(payload), 'utf8');

  return { code: 0, message: 'ok', jsonPath: finalJson, mdPath: finalMd, ...payload };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('用法: node scripts/midterm-performance-dashboard.mjs --book-root <本书根> [--days 7] [--json]');
    process.exit(2);
  }
  const out = runMidtermPerformanceDashboard(args);
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`[midterm-dashboard] ${out.message}`);
    console.log(`[midterm-dashboard] trigger=${out.kpi.triggerAutomationRate.rate}% temporal=${out.kpi.temporalTrustRate.rate}%`);
    console.log(`[midterm-dashboard] json=${out.jsonPath}`);
    console.log(`[midterm-dashboard] md=${out.mdPath}`);
  }
  process.exit(out.code);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

