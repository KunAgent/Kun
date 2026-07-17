/**
 * D 预估路漏斗门控：
 *   Gate 1（行级 · 总在跑）—— phase4_1.md 询价链路列校验
 *     - 「② 前必有 ①miss」：含 ② 的行必须含 ①miss
 *     - 「①miss 必续打 ②」：含 ①miss 的行必须续打 ② (→②hit 或 →②miss)
 *     - 精确路（spu-hit / spu-miss）整行豁免
 *   Gate 2（计数级 · 仅当 inquiry-run/summary.xlsx 存在时跑）—— 强证据交叉对账
 *     - inquiry-run 中 status ∈ {failed, timeout, aborted_by_user, concluded(无价)} 的行数 = needs_fallback
 *     - phase4_1.md 中含 →② 痕迹的行数 = stage2Touched
 *     - 必须 stage2Touched ≥ needs_fallback（不少打 ②，可多打 ②）
 *
 * 询价漏斗顺序：无 spuid 行 ① inquiry-price-parallel 主力 → ② tencent-cloud-pricing 兜底。
 * 契约见 references/how-to-query-pricing.md §逐行 SPUID 分叉 / §询价链路列。
 *
 * 历史背景：
 *   2026-06-22 a：仅有正向「② 前须有 ①miss」会放过"AI 看到 ① 失败就直接以 ①miss 落盘、忘记走 ②"
 *   2026-06-22 b：增加 Gate 2 强证据对账，把 inquiry-run 真实失败行数和 phase4_1 ② 触达行数交叉
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { listFallbackRows } from './list-tcloud-fallback-rows.mjs';
import { cellOf, extractTable } from './lib/md-contract.mjs';

/**
 * Gate 1：phase4_1.md 询价链路行级校验。
 * @param {string} text phase4_1.md 文本
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateFunnel(text) {
  const errors = [];
  const { headers, rows } = extractTable(text);
  for (const row of rows) {
    const chain = cellOf(headers, row, '询价链路') || '';
    if (/spu-(hit|miss)/.test(chain)) continue; // 精确路豁免

    const hasStage2 = /②/.test(chain);
    const hasStage1Miss = /①miss/.test(chain);

    // 正向：② 必须有 ①miss 前置
    if (hasStage2 && !hasStage1Miss) {
      errors.push(`行 ${row[0]} 走了 ② 但缺 ①miss 证据：${chain}`);
      continue;
    }

    // 反向：①miss 必须续打 ②（hit 或 miss 任一），禁止以 ①miss 直接收尾
    if (hasStage1Miss && !hasStage2) {
      errors.push(`行 ${row[0]} 出现 ①miss 但未续打 ② 兜底（须 →②hit 或 →②miss(...)）：${chain}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Gate 2：phase4_1.md 与 inquiry-run/summary.xlsx 的强证据交叉对账（纯函数 · 计数级）。
 *
 * 不做"按 source_row_index 回连 row_id"——inquiry-run 没有显式回连契约。
 * 改用计数级强约束：phase4_1 中触达 ② 的行数必须 ≥ inquiry-run 给出的 needs_fallback。
 *
 * @param {string} phase4_1Text phase4_1.md 文本
 * @param {{ summary: { needs_fallback: number, total: number }, fallback_rows: any[] } | null} inquiryReport
 *        listFallbackRows() 的返回；为 null 表示 inquiry-run 不存在 / 跳过本 gate
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateInquiryEvidence(phase4_1Text, inquiryReport) {
  if (!inquiryReport) return { ok: true, errors: [] };

  const needsFallback = inquiryReport.summary?.needs_fallback || 0;
  if (needsFallback === 0) return { ok: true, errors: [] };

  const { headers, rows } = extractTable(phase4_1Text);
  let stage2Touched = 0;
  for (const row of rows) {
    const chain = cellOf(headers, row, '询价链路') || '';
    if (/spu-(hit|miss)/.test(chain)) continue; // 精确路不计入
    if (/→②|②hit|②miss/.test(chain)) stage2Touched += 1;
  }

  if (stage2Touched < needsFallback) {
    return {
      ok: false,
      errors: [
        `inquiry-run/summary.xlsx 标 ${needsFallback} 行需 ② 兜底（status ∈ ` +
          `failed/timeout/aborted_by_user 或 concluded 无价），但 phase4_1.md 仅 ` +
          `${stage2Touched} 行触达 ②。请用 ` +
          `node scripts/list-tcloud-fallback-rows.mjs --run-dir <inquiry-run> ` +
          `查清单后逐行兜底。`,
      ],
    };
  }
  return { ok: true, errors: [] };
}

// ---------- CLI ----------

function main() {
  const idx = process.argv.indexOf('--session-dir');
  const dir = idx >= 0 ? process.argv[idx + 1] : process.cwd();

  const phase4_1Path = join(dir, 'phase4_1.md');
  if (!existsSync(phase4_1Path)) {
    console.error(`check-phase4-1-funnel-gate FAILED: phase4_1.md 不存在：${phase4_1Path}`);
    process.exit(1);
  }
  const phase4_1Text = readFileSync(phase4_1Path, 'utf8');

  // Gate 1
  const g1 = validateFunnel(phase4_1Text);

  // Gate 2（仅当 inquiry-run/summary.xlsx 存在时跑）
  const inquiryRunDir = join(dir, 'inquiry-run');
  let g2 = { ok: true, errors: [] };
  let inquirySkipped = true;
  if (existsSync(join(inquiryRunDir, 'summary.xlsx'))) {
    inquirySkipped = false;
    const report = listFallbackRows(inquiryRunDir);
    if (report.error) {
      g2 = {
        ok: false,
        errors: [`Gate 2 强证据校验失败：读 inquiry-run 失败 — ${report.error}`],
      };
    } else {
      g2 = validateInquiryEvidence(phase4_1Text, report);
    }
  }

  const ok = g1.ok && g2.ok;
  if (!ok) {
    const lines = [];
    if (!g1.ok) {
      lines.push('Gate 1（行级漏斗）:');
      g1.errors.forEach((e) => lines.push('  - ' + e));
    }
    if (!g2.ok) {
      lines.push('Gate 2（inquiry-run 强证据对账）:');
      g2.errors.forEach((e) => lines.push('  - ' + e));
    }
    console.error('check-phase4-1-funnel-gate FAILED:\n' + lines.join('\n'));
    process.exit(1);
  }

  if (inquirySkipped) {
    console.log('check-phase4-1-funnel-gate OK (Gate 1 通过 · Gate 2 跳过：无 inquiry-run)');
  } else {
    console.log('check-phase4-1-funnel-gate OK (Gate 1 + Gate 2 通过)');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
