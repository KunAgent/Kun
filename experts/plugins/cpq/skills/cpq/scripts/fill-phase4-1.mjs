/**
 * D 询价结果回补写盘：把询价行组装成 phase4_1.md（唯一允许写该文件的入口）。
 *
 * 产物结构（见 docs/cpq/abc-refactor/subagent-d.md「产物 phase4_1.md」+ intermediate-files.md §三）：
 *   - 首行 site 标记
 *   - ## 摘要（五要点）
 *   - ## 数据（表头必含 四层编码 / 询价规格摘要）
 *   - 末行 phase4_1-done 计数，且 quoted+blank=total、via_spu+via_parallel+via_tcloud=quoted
 *
 * 「四层编码」列忠实写盘：真实编码 / `未找到`（D 试过失败的强证据）/ `-`（精确路或未试），
 * 本脚本不改写、不推断（价格铁律同样适用：值只来自工具实际返回）。
 *
 * 「①conversation_id」「①结论」列（可选 · ① 会话追溯）：走预估路 ① inquiry-price-parallel 的行，
 * 建议在 input.json 的 headers/rows 里带上这两列，原样搬运 inquiry-price-parallel 返回的
 * task_states[task_id].conversation_id / conclusion，便于人工点回刊例价助手会话页追溯本次询价对话。
 * 本脚本对额外列一律透传（不校验、不改写）；精确路 / 未走 ① 的行该两列填 `-`。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { validateFunnel, validateInquiryEvidence } from './check-phase4-1-funnel-gate.mjs';
import { ensurePhaseA } from './gate-phase-a.mjs';
import { cellOf } from './lib/md-contract.mjs';
import { listFallbackRows } from './list-tcloud-fallback-rows.mjs';

const REQUIRED_COLS = ['四层编码', '询价规格摘要'];

const SUMMARY_FIELDS = [
  ['本阶段做了什么', 'didWhat'],
  ['关键判断 / 分叉结论', 'keyJudgment'],
  ['给主 agent 的路由建议', 'routeAdvice'],
  ['给下游 subagent 的用法', 'downstream'],
  ['异常 / 留空 / 失败行', 'anomalies'],
];

/**
 * 按「询价链路」列统计计数。quoted = via_spu + via_parallel + via_tcloud；blank = total - quoted。
 */
export function deriveCounts(headers, rows) {
  let via_spu = 0;
  let via_parallel = 0;
  let via_tcloud = 0;
  for (const row of rows) {
    const chain = cellOf(headers, row, '询价链路') || '';
    if (/spu-hit/.test(chain)) via_spu += 1;
    else if (/②hit/.test(chain)) via_tcloud += 1;
    else if (/①hit/.test(chain)) via_parallel += 1;
  }
  const quoted = via_spu + via_parallel + via_tcloud;
  return {
    total: rows.length,
    quoted,
    blank: rows.length - quoted,
    via_spu,
    via_parallel,
    via_tcloud,
  };
}

export function assemblePhase4_1({ site, summary, headers, rows }) {
  const errors = [];
  if (site !== 'cn' && site !== 'intl') errors.push('site 必须是 cn 或 intl');
  for (const col of REQUIRED_COLS) {
    if (!headers.includes(col)) errors.push(`表头缺必需列：${col}`);
  }
  for (const [, key] of SUMMARY_FIELDS) {
    if (!summary || !String(summary[key] || '').trim()) errors.push(`摘要缺要点：${key}`);
  }
  if (errors.length) return { ok: false, errors, markdown: '' };

  const c = deriveCounts(headers, rows);
  const summaryLines = SUMMARY_FIELDS.map(([label, key]) => `- **${label}**：${summary[key]}`).join(
    '\n',
  );
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const table = [
    `| ${headers.join(' | ')} |`,
    sep,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
  const done =
    `<!-- phase4_1-done: total=${c.total} quoted=${c.quoted} blank=${c.blank} ` +
    `via_spu=${c.via_spu} via_parallel=${c.via_parallel} via_tcloud=${c.via_tcloud} -->`;
  const markdown = [
    `<!-- site: ${site} -->`,
    '',
    '## 摘要',
    '',
    summaryLines,
    '',
    '## 数据',
    '',
    table,
    '',
    done,
    '',
  ].join('\n');
  return { ok: true, errors: [], markdown };
}

function main() {
  const idx = process.argv.indexOf('--session-dir');
  const dir = idx >= 0 ? process.argv[idx + 1] : process.cwd();

  // P3 硬 gate：A 阶段最小集（context.md + phase1.md）必须就位；
  //            含友商行时强制 phase2.md（B Winback）。
  // 不通过会直接 process.exit(2)，下游不会被执行。
  // 旁路开关 CPQ_SKIP_PHASE_A_GATE=1（仅供测试 / 紧急排障使用，不要在生产路径开）
  if (!process.env.CPQ_SKIP_PHASE_A_GATE) {
    ensurePhaseA(dir, { silent: true });
  }

  const input = JSON.parse(readFileSync(join(dir, 'phase4_1-input.json'), 'utf8'));
  const { ok, errors, markdown } = assemblePhase4_1(input);
  if (!ok) {
    console.error('fill-phase4-1 FAILED:\n' + errors.map((e) => '  - ' + e).join('\n'));
    process.exit(1);
  }

  // 写盘前漏斗 gate（行级 + 强证据对账），把 fallback 检查前置到 fill 阶段，
  // 防止 AI 跳过 check-phase4-1-funnel-gate.mjs 直接落盘。
  // 旁路开关 CPQ_SKIP_FUNNEL_GATE=1（仅供测试 / 紧急排障使用，不要在生产路径开）
  if (!process.env.CPQ_SKIP_FUNNEL_GATE) {
    const g1 = validateFunnel(markdown);
    let g2 = { ok: true, errors: [] };
    const inquiryRunDir = join(dir, 'inquiry-run');
    if (existsSync(join(inquiryRunDir, 'summary.xlsx'))) {
      const report = listFallbackRows(inquiryRunDir);
      if (report.error) {
        g2 = {
          ok: false,
          errors: [`读 inquiry-run/summary.xlsx 失败：${report.error}`],
        };
      } else {
        g2 = validateInquiryEvidence(markdown, report);
      }
    }
    if (!g1.ok || !g2.ok) {
      const lines = ['fill-phase4-1 FAILED · 漏斗 gate 不通过（写盘已阻断）：'];
      if (!g1.ok) {
        lines.push('  Gate 1（行级漏斗）:');
        g1.errors.forEach((e) => lines.push('    - ' + e));
      }
      if (!g2.ok) {
        lines.push('  Gate 2（inquiry-run 强证据对账）:');
        g2.errors.forEach((e) => lines.push('    - ' + e));
      }
      lines.push('');
      lines.push(
        '排障：node scripts/list-tcloud-fallback-rows.mjs --run-dir <session>/inquiry-run',
      );
      lines.push('契约：references/how-to-query-pricing.md §逐行 SPUID 分叉');
      console.error(lines.join('\n'));
      process.exit(1);
    }
  }

  writeFileSync(join(dir, 'phase4_1.md'), markdown);
  console.log('fill-phase4-1 OK → phase4_1.md');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
