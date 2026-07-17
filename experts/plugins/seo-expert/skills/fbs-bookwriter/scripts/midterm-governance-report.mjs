#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getIsoWeekLabel } from './book-state-weekly-export.mjs';
import {
  ensureGovernanceDir,
  governanceArtifactPath,
  firstExistingPath,
} from './lib/governance-artifacts.mjs';

function parseArgs(argv) {
  const o = {
    bookRoot: null,
    weekLabel: null,
    allowLegacyReports: false,
    json: false,
    jsonOut: null,
    mdOut: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') o.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--week-label') o.weekLabel = String(argv[++i] || '').trim() || null;
    else if (a === '--allow-legacy-reports') o.allowLegacyReports = true;
    else if (a === '--json') o.json = true;
    else if (a === '--json-out') o.jsonOut = path.resolve(argv[++i] || '');
    else if (a === '--md-out') o.mdOut = path.resolve(argv[++i] || '');
  }
  return o;
}

function readJsonIfExists(p, fallback = null) {
  if (!p) return fallback;
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function severityRank(level) {
  if (level === 'block') return 3;
  if (level === 'warn') return 2;
  return 1;
}

function maxSeverity(items) {
  let top = 'pass';
  for (const i of items) {
    if (severityRank(i) > severityRank(top)) top = i;
  }
  return top;
}

function listLegacyGovernanceArtifacts(reportsDir) {
  if (!fs.existsSync(reportsDir)) return [];
  const re = /^midterm-(performance-dashboard|governance-report|execution-chain)-.+\.(json|md)$/i;
  return fs
    .readdirSync(reportsDir)
    .filter((n) => re.test(n))
    .map((n) => path.join(reportsDir, n));
}

function buildMd(payload) {
  const lines = [];
  lines.push(`# Midterm Governance Report (${payload.weekLabel})`);
  lines.push('');
  lines.push(`- 生成时间：${payload.generatedAt}`);
  lines.push(`- 书稿根：${payload.bookRoot}`);
  lines.push(`- 综合状态：${payload.status.toUpperCase()}`);
  lines.push('');
  lines.push('## KPI 与门禁');
  lines.push(`- 中期执行链状态：${payload.summary.executionChainStatus}`);
  lines.push(`- P0 审计状态：${payload.summary.p0AuditStatus}`);
  lines.push(`- 触发自动化率：${payload.summary.triggerRate}%`);
  lines.push(`- 时态可信率：${payload.summary.temporalRate}%`);
  lines.push(`- 会话恢复就绪率：${payload.summary.resumeRate}%`);
  lines.push(`- 证据完备率：${payload.summary.evidenceRate}%`);
  lines.push(`- 知识复用率：${payload.summary.knowledgeReuseRate}%`);
  lines.push(`- 主体漂移项：${payload.summary.driftCount}（legacy=${payload.summary.legacyReportsUsed ? 'yes' : 'no'}）`);
  lines.push('');
  lines.push('## 风险');
  if (!payload.risks.length) lines.push('- 无高优先风险。');
  else for (const r of payload.risks) lines.push(`- ${r}`);
  lines.push('');
  lines.push('## 主体边界审视');
  lines.push(`- 治理目录：${payload.artifacts.governanceDir}`);
  lines.push(`- 运行报告目录：${payload.artifacts.runtimeReportsDir}`);
  if ((payload.boundary?.driftArtifacts || []).length) {
    for (const p of payload.boundary.driftArtifacts) lines.push(`- ⚠ 漂移工件：${p}`);
  } else {
    lines.push('- 未发现治理工件落入运行报告目录。');
  }
  lines.push('');
  lines.push('## 整改建议（优先）');
  if (!payload.actions.length) lines.push('- 保持当前节奏，进入下一窗口持续复核。');
  else for (const x of payload.actions) lines.push(`- ${x}`);
  lines.push('');
  lines.push('## 证据工件');
  lines.push(`- dashboard: ${payload.artifacts.dashboardJson || '-'}`);
  lines.push(`- weekly summary: ${payload.artifacts.weeklyJson || '-'}`);
  lines.push(`- execution chain: ${payload.artifacts.executionChainJson || '-'}`);
  lines.push(`- p0 audit: ${payload.artifacts.p0AuditJson || '-'}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function runMidtermGovernanceReport({
  bookRoot,
  weekLabel = null,
  jsonOut = null,
  mdOut = null,
  executionChainPayload = null,
  allowLegacyReports = false,
} = {}) {
  const root = path.resolve(bookRoot || process.cwd());
  const reportsDir = path.join(root, '.fbs', 'reports');
  const governanceDir = ensureGovernanceDir(root);
  fs.mkdirSync(reportsDir, { recursive: true });
  const week = weekLabel || getIsoWeekLabel(new Date());

  const dashboardCandidates = [governanceArtifactPath(root, `midterm-performance-dashboard-${week}.json`)];
  if (allowLegacyReports) dashboardCandidates.push(path.join(reportsDir, `midterm-performance-dashboard-${week}.json`));
  const dashboardJson = firstExistingPath(dashboardCandidates);
  const weeklyJson = path.join(reportsDir, `book-state-weekly-summary-${week}.json`);
  const p0AuditJson = path.join(root, '.fbs', 'p0-audit-report.json');
  const chainCandidates = [governanceArtifactPath(root, `midterm-execution-chain-${new Date().toISOString().slice(0, 10)}.json`)];
  if (allowLegacyReports) chainCandidates.push(path.join(reportsDir, `midterm-execution-chain-${new Date().toISOString().slice(0, 10)}.json`));
  const executionChainJson = firstExistingPath(chainCandidates);

  const dashboard = readJsonIfExists(dashboardJson, {});
  const weekly = readJsonIfExists(weeklyJson, {});
  const p0 = readJsonIfExists(p0AuditJson, null);
  const chain = executionChainPayload || readJsonIfExists(executionChainJson, null) || {};
  const driftArtifacts = listLegacyGovernanceArtifacts(reportsDir);
  const legacyReportsUsed = Boolean(
    allowLegacyReports &&
      ((dashboardJson && dashboardJson.includes(`${path.sep}.fbs${path.sep}reports${path.sep}`)) ||
        (executionChainJson && executionChainJson.includes(`${path.sep}.fbs${path.sep}reports${path.sep}`)))
  );

  const triggerRate = Number(dashboard?.kpi?.triggerAutomationRate?.rate || 0);
  const temporalRate = Number(dashboard?.kpi?.temporalTrustRate?.rate || 0);
  const resumeRate = Number(dashboard?.kpi?.resumeReadinessRate?.rate || 0);
  const evidenceRate = Number(dashboard?.kpi?.evidenceCompletenessRate?.rate || 0);
  const knowledgeReuseRate = Number(dashboard?.kpi?.knowledgeReuseRate || 0);
  const p0AuditStatus = p0?.status || 'unknown';
  const executionChainStatus = chain?.status || 'unknown';

  const status = maxSeverity([
    executionChainStatus === 'block' ? 'block' : executionChainStatus === 'warn' ? 'warn' : 'pass',
    p0AuditStatus === 'failed' ? 'block' : p0AuditStatus === 'running' ? 'warn' : 'pass',
    driftArtifacts.length > 0 ? 'warn' : 'pass',
    legacyReportsUsed ? 'warn' : 'pass',
  ]);

  const risks = [];
  if (executionChainStatus === 'block') risks.push('中期执行链判定为 block，关键 KPI 未达阈值。');
  if (p0AuditStatus === 'failed') risks.push('P0 审计失败，建议先完成阻断项修复。');
  if ((weekly?.topFailingGates || []).length > 0) {
    const top = weekly.topFailingGates.slice(0, 3).map((x) => `${x.gateId}(${x.failCount})`).join('、');
    risks.push(`近一周失败门禁集中在：${top}`);
  }
  if (driftArtifacts.length > 0) {
    risks.push(`检测到 ${driftArtifacts.length} 个治理工件落在 .fbs/reports（主体漂移风险）。`);
  }
  if (legacyReportsUsed) {
    risks.push('本次治理报告使用了 legacy reports 数据源，建议完成治理工件迁移。');
  }

  const actions = [];
  for (const a of dashboard?.nextActions || []) actions.push(a);
  if (p0AuditStatus === 'failed') actions.unshift('优先执行 run-p0-audits 并修复未通过项，再推进阶段。');
  if (triggerRate < 95) actions.push('将 intake/session-exit/midterm-chain 固化到日常收口与阶段切换流程。');
  if (temporalRate < 90) actions.push('高风险事实统一走反向验证，补齐时间锚与来源锚。');
  if (knowledgeReuseRate < 20) actions.push('推进知识卡回引规范，在章节中显式复用已沉淀结论。');
  if (driftArtifacts.length > 0) actions.unshift('将 .fbs/reports 下 midterm-* 工件迁移到 .fbs/governance，避免治理与运行态混写。');
  if (legacyReportsUsed) actions.unshift('关闭 --allow-legacy-reports，按治理目录作为唯一读取源。');
  if (actions.length > 8) actions.splice(8);

  const payload = {
    schemaVersion: '1.0.0',
    domain: 'governance',
    generatedAt: new Date().toISOString(),
    weekLabel: week,
    bookRoot: root,
    status,
    summary: {
      executionChainStatus,
      p0AuditStatus,
      triggerRate,
      temporalRate,
      resumeRate,
      evidenceRate,
      knowledgeReuseRate,
      driftCount: driftArtifacts.length,
      legacyReportsUsed,
      weeklyEventTotal: Number(weekly?.eventTotal || 0),
      weeklyGateTotal: Number(weekly?.gateTotal || 0),
    },
    risks,
    actions,
    artifacts: {
      artifactRoot: governanceDir,
      dashboardJson: dashboardJson && fs.existsSync(dashboardJson) ? dashboardJson : null,
      weeklyJson: fs.existsSync(weeklyJson) ? weeklyJson : null,
      executionChainJson: chain?.outputPath || (executionChainJson && fs.existsSync(executionChainJson) ? executionChainJson : null),
      p0AuditJson: fs.existsSync(p0AuditJson) ? p0AuditJson : null,
      governanceDir,
      runtimeReportsDir: reportsDir,
      legacyReportsUsed,
    },
    boundary: {
      governanceDir,
      runtimeReportsDir: reportsDir,
      driftArtifacts,
    },
  };

  const outJson = jsonOut || governanceArtifactPath(root, `midterm-governance-report-${week}.json`);
  const outMd = mdOut || governanceArtifactPath(root, `midterm-governance-report-${week}.md`);
  fs.writeFileSync(outJson, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(outMd, buildMd(payload), 'utf8');
  return { code: 0, message: 'ok', jsonPath: outJson, mdPath: outMd, ...payload };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('用法: node scripts/midterm-governance-report.mjs --book-root <本书根> [--week-label 2026-W16] [--allow-legacy-reports] [--json]');
    process.exit(2);
  }
  const out = runMidtermGovernanceReport(args);
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`[midterm-governance] ${out.message}`);
    console.log(`[midterm-governance] status=${out.status} json=${out.jsonPath}`);
  }
  process.exit(out.code);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

