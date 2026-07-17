/**
 * quality-coverage-auditor.mjs — 质检规则覆盖率审计器
 * FBS-BookWriter v2.0.3 | [E1] 质检体系完整性
 *
 * 功能：
 *   1. 从 quality-S.md / quality-PLC.md 提取所有规则 ID（S1-S10, P1-P8, C1-C6, B1-B4）
 *   2. 与 quality-auditor-lite.mjs 的实现进行比对
 *   3. 输出覆盖率报告 .fbs/qc-coverage-report.md
 *
 * CLI：
 *   node quality-coverage-auditor.mjs [--skill-root <path>] [--book-root <path>] [--json-out <path>]
 */

import fs from 'fs';
import path from 'path';

/** 从 Markdown 内容提取规则 ID（支持 ### S1 / ## P2 / **C3** 格式） */
function extractRuleIds(content, prefix) {
  const patterns = [
    new RegExp(`^#{1,4}\\s+(${prefix}\\d+)`, 'gim'),
    new RegExp(`\\*\\*(${prefix}\\d+)\\*\\*`, 'gi'),
    new RegExp(`^- \\*\\*(${prefix}\\d+)\\*\\*`, 'gim'),
    new RegExp(`\\[(${prefix}\\d+)\\]`, 'gi'),
  ];

  const ids = new Set();
  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(content)) !== null) {
      ids.add(m[1].toUpperCase());
    }
  }
  return [...ids].sort();
}

/** 检查规则 ID 是否在实现脚本中出现 */
function checkImplementation(ruleId, implementationContent) {
  return implementationContent.includes(ruleId);
}

/**
 * 运行覆盖率审计
 * @param {object} options
 * @param {string} [options.skillRoot]  Skill 根目录
 * @param {string} [options.bookRoot]   书稿根目录（.fbs 所在）
 * @param {string} [options.jsonOut]    JSON 输出路径（可选）
 * @param {boolean} [options.quiet]
 */
export async function runCoverageAudit({ skillRoot, bookRoot, jsonOut, quiet = false } = {}) {
  const skill = skillRoot || process.cwd();
  const book = bookRoot || process.cwd();
  const fbs = path.join(book, '.fbs');

  // 读取规则定义文件
  const qualitySPath = path.join(skill, 'references', '02-quality', 'quality-S.md');
  const qualityPLCPath = path.join(skill, 'references', '02-quality', 'quality-PLC.md');
  const auditorPath = path.join(skill, 'scripts', 'quality-auditor-lite.mjs');

  const missing = [];
  if (!fs.existsSync(qualitySPath)) missing.push(qualitySPath);
  if (!fs.existsSync(qualityPLCPath)) missing.push(qualityPLCPath);
  if (!fs.existsSync(auditorPath)) missing.push(auditorPath);

  if (missing.length > 0) {
    const msg = `[coverage-audit] 缺少必要文件：\n${missing.map(f => '  - ' + f).join('\n')}`;
    if (!quiet) console.warn(msg);
  }

  const qualityS = fs.existsSync(qualitySPath) ? fs.readFileSync(qualitySPath, 'utf8') : '';
  const qualityPLC = fs.existsSync(qualityPLCPath) ? fs.readFileSync(qualityPLCPath, 'utf8') : '';
  const auditorImpl = fs.existsSync(auditorPath) ? fs.readFileSync(auditorPath, 'utf8') : '';

  // 提取规则 ID
  const allContent = qualityS + '\n' + qualityPLC;
  const sRules = extractRuleIds(allContent, 'S');
  const pRules = extractRuleIds(allContent, 'P');
  const cRules = extractRuleIds(allContent, 'C');
  const bRules = extractRuleIds(allContent, 'B');
  const allRules = [...sRules, ...pRules, ...cRules, ...bRules];

  // 检查实现覆盖
  const covered = [];
  const uncovered = [];

  for (const ruleId of allRules) {
    if (checkImplementation(ruleId, auditorImpl)) {
      covered.push(ruleId);
    } else {
      uncovered.push(ruleId);
    }
  }

  const coverageRate = allRules.length > 0
    ? Math.round((covered.length / allRules.length) * 100)
    : 0;

  const report = {
    $schema: 'fbs-qc-coverage-report-v1',
    generatedAt: new Date().toISOString(),
    skillRoot: skill,
    summary: {
      totalRules: allRules.length,
      coveredCount: covered.length,
      uncoveredCount: uncovered.length,
      coverageRate: `${coverageRate}%`,
    },
    byLayer: {
      S: { defined: sRules, covered: sRules.filter(r => covered.includes(r)), uncovered: sRules.filter(r => uncovered.includes(r)) },
      P: { defined: pRules, covered: pRules.filter(r => covered.includes(r)), uncovered: pRules.filter(r => uncovered.includes(r)) },
      C: { defined: cRules, covered: cRules.filter(r => covered.includes(r)), uncovered: cRules.filter(r => uncovered.includes(r)) },
      B: { defined: bRules, covered: bRules.filter(r => covered.includes(r)), uncovered: bRules.filter(r => uncovered.includes(r)) },
    },
    covered,
    uncovered,
  };

  // 生成 Markdown 报告
  const mdLines = [
    `# 质检规则覆盖率报告`,
    ``,
    `> 生成时间：${report.generatedAt}  `,
    `> 覆盖率：**${coverageRate}%**（${covered.length}/${allRules.length} 条规则在 quality-auditor-lite.mjs 中有实现）`,
    ``,
    `---`,
    ``,
    `## 汇总`,
    ``,
    `| 层级 | 已定义 | 已实现 | 未实现 | 覆盖率 |`,
    `|------|--------|--------|--------|--------|`,
  ];

  for (const [layer, data] of Object.entries(report.byLayer)) {
    const rate = data.defined.length > 0
      ? Math.round((data.covered.length / data.defined.length) * 100)
      : 0;
    mdLines.push(`| ${layer} 层 | ${data.defined.length} | ${data.covered.length} | ${data.uncovered.length} | ${rate}% |`);
  }

  mdLines.push(``, `## 未实现规则（需补充实现）`, ``);
  if (uncovered.length === 0) {
    mdLines.push(`> 全部规则均已实现 ✅`);
  } else {
    for (const ruleId of uncovered) {
      mdLines.push(`- [ ] \`${ruleId}\` — 已在规则文档中定义，但 quality-auditor-lite.mjs 中未找到对应实现`);
    }
  }

  mdLines.push(``, `## 已实现规则`, ``);
  mdLines.push(covered.map(r => `\`${r}\``).join(' / ') || '（无）');

  const mdContent = mdLines.join('\n');

  // 写入报告
  try {
    fs.mkdirSync(fbs, { recursive: true });
    const mdPath = path.join(fbs, 'qc-coverage-report.md');
    fs.writeFileSync(mdPath, mdContent, 'utf8');
    if (!quiet) console.log(`[coverage-audit] 报告已写入 ${mdPath}`);
  } catch (e) {
    if (!quiet) console.error('[coverage-audit] 写入 MD 报告失败:', e.message);
  }

  if (jsonOut) {
    try {
      fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
      fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2), 'utf8');
    } catch (e) {
      if (!quiet) console.error('[coverage-audit] 写入 JSON 报告失败:', e.message);
    }
  }

  return report;
}

// ── CLI 入口 ──
if (process.argv[1] && process.argv[1].endsWith('quality-coverage-auditor.mjs')) {
  const argv = process.argv;
  const skillRoot = argv.includes('--skill-root') ? argv[argv.indexOf('--skill-root') + 1] : process.cwd();
  const bookRoot = argv.includes('--book-root') ? argv[argv.indexOf('--book-root') + 1] : process.cwd();
  const jsonOut = argv.includes('--json-out') ? argv[argv.indexOf('--json-out') + 1] : null;
  const quiet = argv.includes('--quiet');

  runCoverageAudit({ skillRoot, bookRoot, jsonOut, quiet }).then(report => {
    console.log(`\n覆盖率：${report.summary.coverageRate}（${report.summary.coveredCount}/${report.summary.totalRules}）`);
    if (report.uncovered.length > 0) {
      console.log(`未实现规则：${report.uncovered.join(', ')}`);
    }
  }).catch(err => {
    console.error('quality-coverage-auditor 失败:', err.message);
    process.exit(1);
  });
}
