#!/usr/bin/env node
/**
 * FBS-BookWriter 工作区 Inspector（P0 健康检查 + 债务探测）
 *
 * 整合 workspace-manifest、releases-registry、plan-board、propagation-debt
 * 生成一份可机读的诊断报告，并可在 CI / 打包前门禁中作为 exit-code 守卫。
 *
 * 用法：
 *   node scripts/workspace-inspector.mjs run   <bookRoot>
 *   node scripts/workspace-inspector.mjs run   <bookRoot> --enforce      # 有 error 则 exit 1
 *   node scripts/workspace-inspector.mjs run   <bookRoot> --json         # 只输出 JSON
 *   node scripts/workspace-inspector.mjs watch <bookRoot> --interval 30  # 轮询模式（秒）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 动态导入同目录模块（避免打包时循环依赖）
async function loadDeps(bookRoot) {
  const base = path.join(__dirname);
  const [
    { buildManifest, writeManifest },
    { getRegistrySummary },
    { getBoardSummary },
  ] = await Promise.all([
    import(`file://${path.join(base, 'workspace-manifest.mjs')}`),
    import(`file://${path.join(base, 'releases-registry.mjs')}`),
    import(`file://${path.join(base, 'plan-board.mjs')}`),
  ]);

  // propagation-debt-tracker 是可选的（未落地时降级）
  let getPropagationDebtSummary = null;
  try {
    const debtMod = await import(`file://${path.join(base, 'propagation-debt-tracker.mjs')}`);
    getPropagationDebtSummary = debtMod.getDebtSummary;
  } catch { /* optional */ }

  return { buildManifest, writeManifest, getRegistrySummary, getBoardSummary, getPropagationDebtSummary };
}

// ─── 检查规则 ─────────────────────────────────────────────────────────────────

function checkContracts(manifest) {
  const issues = [];
  if (!manifest.contracts?.entryContractExists) {
    issues.push({ level: 'warn', code: 'NO_ENTRY_CONTRACT', msg: 'entry-contract.json 缺失，WP2 入口规范未初始化' });
  }
  if (!manifest.contracts?.workspaceGovExists) {
    issues.push({ level: 'warn', code: 'NO_WORKSPACE_GOV', msg: 'workspace-governance.json 缺失，工作区治理约束未激活' });
  }
  return issues;
}

function checkSession(manifest) {
  const issues = [];
  const { esmState, wordCount, timestamp } = manifest.session || {};

  if (!esmState) {
    issues.push({ level: 'info', code: 'NO_ESM_STATE', msg: 'ESM 状态未记录（新项目或未开始写作）' });
    return issues;
  }

  // 检查是否长时间停留在同一状态
  if (timestamp) {
    const ageHours = (Date.now() - new Date(timestamp).getTime()) / 3_600_000;
    if (ageHours > 48) {
      issues.push({ level: 'warn', code: 'STALE_ESM_STATE', msg: `ESM 状态 ${esmState} 超过 48 小时未更新（${ageHours.toFixed(0)}h 前）` });
    }
  }

  if (esmState === 'WRITE' && (!wordCount || wordCount < 100)) {
    issues.push({ level: 'info', code: 'LOW_WORD_COUNT', msg: `WRITE 阶段字数较少（${wordCount || 0} 字）` });
  }

  return issues;
}

function checkArtifacts(manifest) {
  const issues = [];
  const { stage, deliverables, releases } = manifest.artifacts || {};

  // 检查零字节产出物
  const zeroByte = (stage || []).filter(a => a.size === 0);
  if (zeroByte.length > 0) {
    issues.push({ level: 'error', code: 'ZERO_BYTE_ARTIFACTS', msg: `发现 ${zeroByte.length} 个零字节产出物: ${zeroByte.map(a => a.name).join(', ')}` });
  }

  // 检查过小产出物
  const tiny = (stage || []).filter(a => a.size > 0 && a.size < 80);
  if (tiny.length > 0) {
    issues.push({ level: 'warn', code: 'TINY_ARTIFACTS', msg: `${tiny.length} 个产出物小于 80 字节（可能不完整）` });
  }

  // deliverables 与 releases 一致性
  if ((deliverables || []).length > 0 && (releases || []).length === 0) {
    issues.push({ level: 'info', code: 'DELIVERABLES_WITHOUT_RELEASE', msg: '有交付文件但无发布注册记录，建议执行 releases-registry create' });
  }

  return issues;
}

function checkBoard(boardSummary) {
  const issues = [];
  if (!boardSummary) return issues;

  const { byStatus, blocked } = boardSummary;

  if ((byStatus?.blocked || 0) > 0) {
    issues.push({
      level: 'warn',
      code: 'BLOCKED_TASKS',
      msg: `${byStatus.blocked} 个任务处于阻塞状态`,
      detail: blocked,
    });
  }

  if ((byStatus?.in_progress || 0) > 3) {
    issues.push({ level: 'info', code: 'TOO_MANY_IN_PROGRESS', msg: `${byStatus.in_progress} 个任务同时进行中，建议聚焦` });
  }

  return issues;
}

function checkDebt(debtSummary) {
  const issues = [];
  if (!debtSummary) return issues;

  if (debtSummary.critical > 0) {
    issues.push({ level: 'error', code: 'CRITICAL_DEBT', msg: `${debtSummary.critical} 条严重传播债务待处理` });
  }
  if (debtSummary.high > 0) {
    issues.push({ level: 'warn', code: 'HIGH_DEBT', msg: `${debtSummary.high} 条高优先级传播债务` });
  }

  return issues;
}

// ─── 主检查器 ─────────────────────────────────────────────────────────────────

/**
 * 运行完整检查
 * @param {string} bookRoot
 * @param {object} options - { updateManifest, json, enforce }
 * @returns {object} report
 */
export async function runInspection(bookRoot, options = {}) {
  const { buildManifest, writeManifest, getRegistrySummary, getBoardSummary, getPropagationDebtSummary }
    = await loadDeps(bookRoot);

  // 1. 构建最新清单
  const manifest = buildManifest(bookRoot);
  if (options.updateManifest !== false) {
    writeManifest(bookRoot, manifest);
  }

  // 2. 加载各层摘要
  const [registrySummary, boardSummary, debtSummary] = await Promise.all([
    Promise.resolve(getRegistrySummary(bookRoot)),
    Promise.resolve(getBoardSummary(bookRoot)),
    getPropagationDebtSummary ? Promise.resolve(getPropagationDebtSummary(bookRoot)) : Promise.resolve(null),
  ]);

  // 3. 执行检查规则
  const issues = [
    ...checkContracts(manifest),
    ...checkSession(manifest),
    ...checkArtifacts(manifest),
    ...checkBoard(boardSummary),
    ...checkDebt(debtSummary),
    ...(manifest.health?.issues || []),
  ];

  // 去重（按 code）
  const seen = new Set();
  const uniqueIssues = issues.filter(i => {
    if (seen.has(i.code)) return false;
    seen.add(i.code);
    return true;
  });

  const errorCount = uniqueIssues.filter(i => i.level === 'error').length;
  const warnCount = uniqueIssues.filter(i => i.level === 'warn').length;
  const infoCount = uniqueIssues.filter(i => i.level === 'info').length;

  const score = Math.max(0, 100 - errorCount * 25 - warnCount * 8 - infoCount * 2);
  const passed = errorCount === 0;

  const report = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    bookRoot: path.resolve(bookRoot),
    passed,
    score,
    errorCount,
    warnCount,
    infoCount,
    issues: uniqueIssues,
    summary: {
      session: manifest.session,
      artifacts: {
        stageCount: manifest.artifacts?.stage?.length || 0,
        deliverableCount: manifest.artifacts?.deliverables?.length || 0,
        releaseCount: manifest.artifacts?.releases?.length || 0,
      },
      board: boardSummary ? {
        total: boardSummary.total,
        completionRate: boardSummary.completionRate,
        blocked: boardSummary.byStatus?.blocked || 0,
        inProgress: boardSummary.byStatus?.in_progress || 0,
      } : null,
      registry: registrySummary,
      debt: debtSummary,
    },
  };

  // 写入报告
  const reportPath = path.join(path.resolve(bookRoot), '.fbs', 'inspector-report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  return report;
}

/**
 * 格式化报告为人类可读文本
 */
export function formatReport(report) {
  const scoreBar = '█'.repeat(Math.floor(report.score / 10)) + '░'.repeat(10 - Math.floor(report.score / 10));
  const lines = [
    '════════════════════════════════════════',
    ' FBS Inspector 诊断报告',
    '════════════════════════════════════════',
    `时间: ${new Date(report.generatedAt).toLocaleString('zh-CN')}`,
    `目录: ${report.bookRoot}`,
    '',
    `健康分: ${report.score}/100  [${scoreBar}]`,
    `状态: ${report.passed ? '✅ 通过' : '❌ 有错误需修复'}`,
    `问题: ${report.errorCount} 错误 / ${report.warnCount} 警告 / ${report.infoCount} 提示`,
    '────────────────────────────────────────',
  ];

  if (report.issues.length > 0) {
    lines.push('');
    lines.push('问题列表:');
    const levelIcon = { error: '❌', warn: '⚠️ ', info: 'ℹ️ ' };
    report.issues.forEach(i => {
      lines.push(`  ${levelIcon[i.level] || '  '} [${i.code}] ${i.msg}`);
    });
  } else {
    lines.push('✅ 无问题');
  }

  lines.push('');
  lines.push('摘要:');
  const s = report.summary;
  lines.push(`  ESM状态: ${s.session?.esmState || 'N/A'}  字数: ${s.session?.wordCount || 0}`);
  lines.push(`  产出物: stage=${s.artifacts.stageCount} / deliverables=${s.artifacts.deliverableCount} / releases=${s.artifacts.releaseCount}`);
  if (s.board) {
    lines.push(`  计划台: 总${s.board.total} 完成率${s.board.completionRate} 进行中${s.board.inProgress} 阻塞${s.board.blocked}`);
  }
  if (s.registry) {
    lines.push(`  发布注册: 总${s.registry.total} 草稿${s.registry.byStatus?.draft || 0} 已发布${s.registry.byStatus?.published || 0}`);
  }
  lines.push('════════════════════════════════════════');
  return lines.join('\n');
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const [action = 'run', bookRoot = process.cwd()] = args;
  const jsonMode = args.includes('--json');
  const enforce = args.includes('--enforce');
  const interval = (() => {
    const idx = args.indexOf('--interval');
    return idx >= 0 ? parseInt(args[idx + 1]) || 30 : null;
  })();

  async function runOnce() {
    try {
      const report = await runInspection(bookRoot, { enforce });
      if (jsonMode) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatReport(report));
      }
      if (enforce && !report.passed) {
        process.exit(1);
      }
      return report;
    } catch (err) {
      console.error('Inspector 错误:', err.message);
      if (enforce) process.exit(1);
    }
  }

  if (action === 'watch' && interval) {
    console.log(`Inspector 监控模式，每 ${interval} 秒检查一次...`);
    runOnce();
    setInterval(runOnce, interval * 1000);
  } else {
    runOnce();
  }
}
