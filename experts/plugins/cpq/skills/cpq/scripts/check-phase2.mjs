#!/usr/bin/env node

/**
 * 段 B gate：校验 phase2.md（Winback 对标）契约。
 *
 * 通过条件：site 标记 + 摘要段五要点 + phase2-done(total/matched/no_counterpart)
 *   + 强版计数自洽——从数据表「我方对标产品」列实算 matched/no_counterpart/total，
 *     再比对 done 标记，拦截 B 静默丢行 / 编数（fail loud）。
 * 用法：node scripts/check-phase2.mjs --session-dir <CPQ_SESSION_DIR>
 * 契约见 docs/cpq/abc-refactor/intermediate-files.md。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  cellOf,
  checkSummary,
  extractTable,
  parseDoneMarker,
  parseSiteMarker,
} from './lib/md-contract.mjs';

export function validatePhase2(text) {
  const errors = [];
  if (!parseSiteMarker(text).site) errors.push('缺少首行 site 标记');

  const summary = checkSummary(text);
  if (!summary.hasSection) errors.push('缺少 "## 摘要" 段');
  for (const m of summary.missing) errors.push(`摘要缺要点：${m}`);

  const done = parseDoneMarker(text, 'phase2');
  if (!done.found) {
    errors.push('缺少 phase2-done 标记');
    return { ok: errors.length === 0, errors };
  }
  for (const f of ['total', 'matched', 'no_counterpart']) {
    if (!(f in done.fields)) errors.push(`phase2-done 缺字段：${f}`);
  }

  // 强版计数自洽：从数据表实算，再比对 done 标记
  const { headers, rows } = extractTable(text);
  if (headers.indexOf('我方对标产品') < 0) {
    errors.push('数据表缺「我方对标产品」列，无法核对计数');
  } else {
    const actualTotal = rows.length;
    const actualMatched = rows.filter((r) => {
      const v = (cellOf(headers, r, '我方对标产品') || '').trim();
      return v !== '' && v !== '-';
    }).length;
    const actualNo = actualTotal - actualMatched;

    if ('total' in done.fields && Number(done.fields.total) !== actualTotal) {
      errors.push(`计数不符：phase2-done total=${done.fields.total}，表格实际 ${actualTotal} 行`);
    }
    if ('matched' in done.fields && Number(done.fields.matched) !== actualMatched) {
      errors.push(`计数不符：matched=${done.fields.matched}，表格实算 ${actualMatched}`);
    }
    if ('no_counterpart' in done.fields && Number(done.fields.no_counterpart) !== actualNo) {
      errors.push(`计数不符：no_counterpart=${done.fields.no_counterpart}，表格实算 ${actualNo}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function main() {
  const idx = process.argv.indexOf('--session-dir');
  const dir = idx >= 0 ? process.argv[idx + 1] : process.cwd();
  const text = readFileSync(join(dir, 'phase2.md'), 'utf8');
  const { ok, errors } = validatePhase2(text);
  if (!ok) {
    console.error('check-phase2 FAILED:\n' + errors.map((e) => '  - ' + e).join('\n'));
    process.exit(1);
  }
  console.log('check-phase2 OK');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
