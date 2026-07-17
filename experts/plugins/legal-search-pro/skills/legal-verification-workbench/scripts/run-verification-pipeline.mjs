// run-verification-pipeline.mjs — Orchestrate the full verification pipeline.
//
// Subcommands:
//   init    --query "..." [--task <dir>] [--title "报告标题"] [--out "output/文件名.html"]
//   capture --input retrieval-batch.json [--task <dir>] [--provider web] [--allow-snippet]
//   audit-sources --task <dir> [--out verification/source-fulltext-queue.json]
//   persist --input sources.json [--task <dir>] [--allow-degraded]
//   build   --task <dir> [--answer answer.md] [--claims claims.json]
//   html    --task <dir>
//   repair-export --task <dir> [--out verification/supplemental-search-queue.json]
//   repair-apply  --task <dir> --input supplemental-findings.json
//   assert-html   --html report.html
//   all     --query "..." --sources sources.json --answer answer.md [--claims claims.json]
//           [--title "报告标题"] [--out "output/文件名.html"] [--allow-degraded]
//
// --title / --out (optional): name the SINGLE final report after the scenario
//   (e.g. 合规分析报告) instead of the generic "法律依据溯源辅助报告". Verification is an
//   embedded, toggle-off layer inside this one report — NOT a separate deliverable.
//
// --claims (optional): AI-declared semantic associations (which source/article each sentence
//   relies on). Strongly recommended — it's how the workbench shifts from "literal match" to
//   "AI declares basis → script confirms it exists → user clicks to trace". See
//   @references/verification-point-spec.md.
//
// Always prints a machine-readable JSON result so the agent can read paths/stats.

import path from 'node:path';
import {
  parseArgs, printJson, readJson, readJsonStrict, readStdin, writeText, resolveTaskDir, safeJoin, readText,
} from './lib.mjs';
import { initMemory } from './legal-memory-init.mjs';
import { persistSources } from './persist-legal-sources.mjs';
import { extractVerificationPoints } from './extract-verification-points.mjs';
import { matchEvidence } from './match-evidence.mjs';
import { generateHtml } from './generate-verification-html.mjs';
import { exportSupplementQueue, applySupplementFindings } from './supplement-weak-evidence.mjs';
import { captureRetrievalBatch } from './capture-retrieval-batch.mjs';
import { auditSourceCompleteness } from './audit-source-completeness.mjs';

function loadSources(args, { required = false } = {}) {
  if (args.sources) return readJsonStrict(args.sources, '--sources');
  if (args.input) return readJsonStrict(args.input, '--input');
  const stdin = readStdin();
  if (stdin) {
    try {
      return JSON.parse(stdin);
    } catch (e) {
      throw new Error(`stdin JSON 格式错误，无法解析：${e.message}`);
    }
  }
  if (required) throw new Error('必须提供来源数据：请传 --sources sources.json，且每条 source 必须包含 content 原文');
  return null;
}

function copyAnswerIfNeeded(taskDir, answerArg) {
  if (!answerArg) return;
  const src = path.resolve(answerArg);
  const dest = safeJoin(taskDir, 'answer.md');
  if (path.resolve(dest) !== src) {
    const txt = readText(src, '');
    if (txt) writeText(dest, txt);
  }
}

function copyClaimsIfNeeded(taskDir, claimsArg) {
  if (!claimsArg) return;
  const src = path.resolve(claimsArg);
  const dest = safeJoin(taskDir, 'claims.json');
  if (path.resolve(dest) !== src) {
    const txt = readText(src, '');
    if (txt) writeText(dest, txt);
  }
}

/**
 * Build a health summary so the agent SEES degraded results immediately instead of shipping an
 * all-red report. Aggregates warnings from persist/extract and derives a few diagnostic flags
 * from the final stats. `ok:false` means "look at this before delivering".
 */
function assertWorkbenchHtml(htmlPath) {
  if (!htmlPath || typeof htmlPath !== 'string') throw new Error('assert-html requires --html report.html');
  const abs = path.resolve(htmlPath);
  const html = readText(abs, '');
  if (!html.trim()) throw new Error(`HTML 文件为空或不存在：${abs}`);
  const required = [
    ['verification-data', '缺少嵌入核验数据 verification-data'],
    ['class="report-head"', '缺少核验工作台模板标题栏 report-head'],
    ['id="stats"', '缺少统计条 stats'],
    ['data-tab="evidence"', '缺少关联依据 tab'],
    ['data-tab="sources"', '缺少来源资料库 tab'],
    ['id="toggle-hl"', '缺少关闭高亮按钮'],
  ];
  const missing = required.filter(([needle]) => !html.includes(needle)).map(([, msg]) => msg);
  if (missing.length) {
    throw new Error(`这不是 legal-verification-workbench 生成的合格核验报告：${missing.join('；')}。请运行 legal-verify all/html 重新生成，不得手写 HTML 冒充核验报告。`);
  }
  const dataMatch = html.match(/<script[^>]+id=["']verification-data["'][^>]*>([\s\S]*?)<\/script>/);
  if (dataMatch) {
    try {
      const data = JSON.parse(dataMatch[1]);
      const stats = data.stats || {};
      const points = stats.points || 0;
      const weak = stats.weak || 0;
      const unverified = stats.unverified || 0;
      const unresolved = weak + unverified;
      const unresolvedRate = points > 0 ? unresolved / points : 0;
      if (unverified > 0 || weak >= 5 || (points >= 6 && unresolvedRate >= 0.25)) {
        throw new Error(`核验报告仍有 ${weak} 个弱关联、${unverified} 个待核验（未闭环率 ${(unresolvedRate * 100).toFixed(0)}%），未通过交付验收。请回到 supplemental-search-queue/source-fulltext-queue 补检补关联并重建 HTML。`);
      }
    } catch (e) {
      if (String(e.message || e).includes('未通过交付验收')) throw e;
      throw new Error(`核验数据 verification-data 无法解析：${e.message || e}`);
    }
  }
  return { success: true, htmlPath: abs, verifiedWorkbenchHtml: true, deliveryGatePassed: true };
}

function buildHealth({ persistRes, extractRes, stats, repairSignal = null, sourceAudit = null }) {
  const warnings = [
    ...((persistRes && persistRes.warnings) || []),
    ...((extractRes && extractRes.warnings) || []),
  ];
  const totalParagraphs = persistRes ? persistRes.totalParagraphs : undefined;
  const declared = extractRes ? extractRes.declared : undefined;
  const points = stats ? stats.points : 0;
  const associated = stats ? stats.associated : 0;
  const weak = stats ? stats.weak || 0 : 0;
  const unverified = stats ? stats.unverified || 0 : 0;
  const unresolved = weak + unverified;
  const associatedRate = points > 0 ? associated / points : 0;
  const weakRate = points > 0 ? weak / points : 0;
  const unresolvedRate = points > 0 ? unresolved / points : 0;

  let deliveryBlocked = false;
  const gates = [];

  if (totalParagraphs === 0) {
    deliveryBlocked = true;
    gates.push('empty_paragraph_library');
    warnings.push('虚拟记忆库段落数为 0：来源未带 content 正文，无法溯源');
  }
  if (sourceAudit && sourceAudit.blockers > 0) {
    deliveryBlocked = true;
    gates.push('source_fulltext_required');
    warnings.push(`来源完整性检查发现 ${sourceAudit.blockers} 个阻断项：可能存在只保存搜索摘要/observation片段、正文截断或来源无段落。请按 ${sourceAudit.outPath} 补取全文并重新 capture/persist`);
  } else if (sourceAudit && sourceAudit.reviews > 0) {
    warnings.push(`来源完整性检查发现 ${sourceAudit.reviews} 个需复核项：请查看 ${sourceAudit.outPath}，确认是否为完整条文/完整案例`);
  }
  if (typeof declared === 'number' && declared === 0 && points > 0) {
    deliveryBlocked = true;
    gates.push('claims_missing');
    warnings.push('AI 声明(claims)为 0 条：所有句子退化为规则兜底，请确认 claims.json 是否传入且格式为 {"claims":[...]}、字段名为 claimText/sourceTitle/articleNo');
  }
  if (points >= 10 && associatedRate < 0.2) {
    deliveryBlocked = true;
    gates.push('association_rate_too_low');
    warnings.push(`已关联率仅 ${(associatedRate * 100).toFixed(0)}%（${associated}/${points}）偏低：正常情况下基于检索结果应有较高已关联率，请检查 sources 是否完整、claims 是否正确声明`);
  }
  if (unverified > 0) {
    deliveryBlocked = true;
    gates.push('unverified_points_exist');
    warnings.push(`仍有 ${unverified} 个待核验点：重量级报告交付前必须导出补检队列，逐条补充检索、修正文稿或语义忽略`);
  }
  if (weak >= 5 || weakRate >= 0.2 || (points >= 6 && unresolvedRate >= 0.25)) {
    deliveryBlocked = true;
    gates.push('weak_or_unverified_ratio_too_high');
    warnings.push(`弱关联/待核验共 ${unresolved} 个（${(unresolvedRate * 100).toFixed(0)}%，其中弱关联 ${weak} 个）：已触发动态检索策略回路，必须围绕这些法规/条款关键词补检并补关联，不能把首轮报告直接交付`);
  }
  if (repairSignal && repairSignal.required) {
    deliveryBlocked = true;
    gates.push(repairSignal.trigger || 'supplemental_queue_required');
    warnings.push(`已生成二次复核队列 ${repairSignal.count} 项：${repairSignal.queuePath}。请完成 AI 语义门控、补充检索/补充关联并 repair-apply 后再交付`);
  }
  return {
    ok: warnings.length === 0 && !deliveryBlocked,
    deliveryBlocked,
    gates: [...new Set(gates)],
    nextRoute: deliveryBlocked ? 'dynamic_retrieval_strategy_then_repair_apply' : 'deliverable_after_assert_html',
    metrics: { points, associated, weak, unverified, unresolved, associatedRate, weakRate, unresolvedRate },
    sourceCompleteness: sourceAudit ? { ok: sourceAudit.ok, blockers: sourceAudit.blockers, reviews: sourceAudit.reviews, queuePath: sourceAudit.outPath } : null,
    warnings,
  };
}

function buildRepairSignal({ taskDir, stats, workspaceRoot }) {
  // Always export once after the first match pass. Even when weak/unverified are zero, the
  // supplemental exporter can still detect answer sentences that look like independent legal
  // propositions but were not declared in claims.json. The returned count is the real gate.
  const queue = exportSupplementQueue({ taskDir, workspaceRoot, out: 'verification/supplemental-search-queue.json' });
  const points = stats ? stats.points || 0 : 0;
  const weak = stats ? stats.weak || 0 : 0;
  const unverified = stats ? stats.unverified || 0 : 0;
  const unresolved = weak + unverified;
  const unresolvedRate = points > 0 ? unresolved / points : 0;
  const highRatio = weak >= 5 || (points >= 6 && unresolvedRate >= 0.25);
  const trigger = highRatio ? 'weak_or_unverified_ratio_too_high' : (queue.count > 0 ? 'supplemental_queue_required' : 'none');
  return { required: queue.count > 0 || highRatio, count: queue.count, queuePath: queue.outPath, trigger, unresolvedRate, weak, unverified };
}

export async function runPipeline(cmd, args) {
  const root = typeof args.root === 'string' ? args.root : process.cwd();

  if (cmd === 'init') {
    return initMemory({
      query: args.query || '',
      taskDir: args.task || null,
      workspaceRoot: root,
      reportTitle: typeof args.title === 'string' ? args.title : '',
      outputHtml: typeof args.out === 'string' ? args.out : '',
    });
  }

  if (cmd === 'capture') {
    const payload = loadSources(args, { required: true });
    return captureRetrievalBatch(payload, {
      taskDir: args.task || null,
      workspaceRoot: root,
      allowSnippet: !!args['allow-snippet'],
      provider: typeof args.provider === 'string' ? args.provider : '',
    });
  }

  if (cmd === 'audit-sources') {
    if (!args.task) throw new Error('audit-sources requires --task');
    return auditSourceCompleteness({
      taskDir: resolveTaskDir(args.task, root),
      workspaceRoot: root,
      out: typeof args.out === 'string' ? args.out : 'verification/source-fulltext-queue.json',
    });
  }

  if (cmd === 'persist') {
    const payload = loadSources(args, { required: true });
    return persistSources(payload, { taskDir: args.task || null, workspaceRoot: root, strictContent: args['allow-degraded'] ? false : true });
  }

  if (cmd === 'build') {
    if (!args.task) throw new Error('build requires --task');
    const taskDir = resolveTaskDir(args.task, root);
    copyAnswerIfNeeded(taskDir, typeof args.answer === 'string' ? args.answer : null);
    copyClaimsIfNeeded(taskDir, typeof args.claims === 'string' ? args.claims : null);
    const ex = extractVerificationPoints({ taskDir, workspaceRoot: root });
    if (args.claims && ex.declared === 0) {
      throw new Error('已传入 --claims 但没有解析出任何有效声明，已阻断 build：请检查 claims.json 字段');
    }
    const mt = matchEvidence({ taskDir, workspaceRoot: root });
    const sourceAudit = auditSourceCompleteness({ taskDir, workspaceRoot: root, out: 'verification/source-fulltext-queue.json' });
    const repairSignal = buildRepairSignal({ taskDir, stats: mt.stats, workspaceRoot: root });
    const health = buildHealth({ persistRes: null, extractRes: ex, stats: mt.stats, repairSignal, sourceAudit });
    return { success: true, taskId: ex.taskId, taskDir, extracted: ex.totalPoints, declared: ex.declared, byType: ex.byType, stats: mt.stats, repairRequired: repairSignal.required, supplementalQueuePath: repairSignal.queuePath, supplementalQueueCount: repairSignal.count, sourceFulltextQueuePath: sourceAudit.outPath, sourceFulltextIssueCount: sourceAudit.count, sourceFulltextBlockerCount: sourceAudit.blockers, sourceFulltextReviewCount: sourceAudit.reviews, health };
  }

  if (cmd === 'html') {
    if (!args.task) throw new Error('html requires --task');
    return generateHtml({ taskDir: resolveTaskDir(args.task, root), workspaceRoot: root });
  }

  if (cmd === 'repair-export') {
    if (!args.task) throw new Error('repair-export requires --task');
    return exportSupplementQueue({
      taskDir: resolveTaskDir(args.task, root),
      workspaceRoot: root,
      out: typeof args.out === 'string' ? args.out : '',
    });
  }

  if (cmd === 'repair-apply') {
    if (!args.task) throw new Error('repair-apply requires --task');
    if (!args.input) throw new Error('repair-apply requires --input supplemental-findings.json');
    return applySupplementFindings({
      taskDir: resolveTaskDir(args.task, root),
      input: args.input,
      workspaceRoot: root,
    });
  }

  if (cmd === 'assert-html') {
    return assertWorkbenchHtml(args.html || args.input || args._?.[0]);
  }

  if (cmd === 'all') {
    // 1. init
    const init = initMemory({
      query: args.query || '',
      taskDir: args.task || null,
      workspaceRoot: root,
      reportTitle: typeof args.title === 'string' ? args.title : '',
      outputHtml: typeof args.out === 'string' ? args.out : '',
    });
    const taskDir = init.taskDir;
    // 2. persist
    const payload = loadSources(args, { required: true });
    const persistRes = persistSources(payload, { taskDir, workspaceRoot: root, strictContent: args['allow-degraded'] ? false : true });
    if (persistRes.totalSources === 0 || persistRes.totalParagraphs === 0) {
      throw new Error('来源资料库为空，已阻断报告生成：请检查 --sources 是否为有效 JSON，且每条 source.content 是否包含法条/案例原文');
    }
    // 3. answer + optional AI claims declarations
    copyAnswerIfNeeded(taskDir, typeof args.answer === 'string' ? args.answer : null);
    copyClaimsIfNeeded(taskDir, typeof args.claims === 'string' ? args.claims : null);
    // 4. extract + match
    const ex = extractVerificationPoints({ taskDir, workspaceRoot: root });
    if (args.claims && ex.declared === 0) {
      throw new Error('已传入 --claims 但没有解析出任何有效声明，已阻断报告生成：请使用 {"claims":[{"claimText":"...","sourceTitle":"...","articleNo":"第X条"}]}');
    }
    const mt = matchEvidence({ taskDir, workspaceRoot: root });
    const sourceAudit = auditSourceCompleteness({ taskDir, workspaceRoot: root, out: 'verification/source-fulltext-queue.json' });
    // 5. html
    const html = generateHtml({ taskDir, workspaceRoot: root });
    // 6. mandatory second-pass trigger — weak/unverified points must create a queue the agent reviews
    const repairSignal = buildRepairSignal({ taskDir, stats: mt.stats, workspaceRoot: root });
    // 7. health summary — surfaces empty-library / off-spec-claims / low-association-rate / repair gate loudly
    const health = buildHealth({ persistRes, extractRes: ex, stats: mt.stats, repairSignal, sourceAudit });
    return { success: true, taskId: init.taskId, taskDir, htmlPath: html.htmlPath, declared: ex.declared, stats: mt.stats, repairRequired: repairSignal.required, supplementalQueuePath: repairSignal.queuePath, supplementalQueueCount: repairSignal.count, sourceFulltextQueuePath: sourceAudit.outPath, sourceFulltextIssueCount: sourceAudit.count, sourceFulltextBlockerCount: sourceAudit.blockers, sourceFulltextReviewCount: sourceAudit.reviews, health };
  }

  throw new Error(`Unknown command: ${cmd}. Use init|capture|audit-sources|persist|build|html|repair-export|repair-apply|assert-html|all`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));
  runPipeline(cmd, args)
    .then((res) => printJson(res))
    .catch((e) => {
      printJson({ success: false, error: String(e.message || e) });
      process.exit(1);
    });
}
