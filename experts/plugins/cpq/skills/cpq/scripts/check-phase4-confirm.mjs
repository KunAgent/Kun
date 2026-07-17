/**
 * 段 C 选品确认门控：校验 phase4.md（选品映射确认表）+ phase4_confirm.json（机器确认证据）。
 *
 * 校验三类：
 *   1. phase4.md 结构：site 标记 + 摘要五要点 + phase4-done，且 total == 实际数据行数（防静默丢行）
 *   2. phase4_confirm.json 字段：confirmed_by / confirmed_at / confirmed_rows(≥0 数值)
 *   3. 跨证据自洽：confirmed_rows(json) == phase4-done.confirmed(md) ≤ total
 *
 * 设计原则：把"人是否真的确认落库"固化成可机读数值证据，再由脚本验证（人确认、脚本验数据），
 * 不让 AI 临场自检。契约见 docs/cpq/abc-refactor/{subagent-c,intermediate-files}.md。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  checkSummary,
  extractTable,
  parseDoneMarker,
  parseSiteMarker,
} from './lib/md-contract.mjs';

export function validatePhase4Md(text) {
  const errors = [];
  if (!parseSiteMarker(text).site) errors.push('缺少首行 site 标记');
  const summary = checkSummary(text);
  if (!summary.hasSection) errors.push('缺少 "## 摘要" 段');
  for (const m of summary.missing) errors.push(`摘要缺要点：${m}`);
  const done = parseDoneMarker(text, 'phase4');
  if (!done.found) {
    errors.push('缺少 phase4-done 标记');
  } else {
    const rows = extractTable(text).rows.length;
    if (Number(done.fields.total) !== rows) {
      errors.push(`phase4-done.total=${done.fields.total} 与实际数据行数 ${rows} 不一致`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateConfirmJson(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['确认证据不是对象'] };
  if (!obj.confirmed_by) errors.push('缺字段 confirmed_by');
  if (!obj.confirmed_at) errors.push('缺字段 confirmed_at');
  if (typeof obj.confirmed_rows !== 'number' || obj.confirmed_rows < 0) {
    errors.push('confirmed_rows 必须是 ≥0 的数值');
  }
  return { ok: errors.length === 0, errors };
}

export function crossCheck(text, obj) {
  const errors = [];
  const done = parseDoneMarker(text, 'phase4');
  if (!done.found) return { ok: false, errors: ['缺少 phase4-done 标记，无法交叉校验'] };
  const confirmed = Number(done.fields.confirmed);
  const total = Number(done.fields.total);
  if (Number(obj?.confirmed_rows) !== confirmed) {
    errors.push(
      `confirmed_rows(json)=${obj?.confirmed_rows} 与 phase4-done.confirmed=${confirmed} 不一致`,
    );
  }
  if (confirmed > total) errors.push(`confirmed=${confirmed} 超过 total=${total}`);
  return { ok: errors.length === 0, errors };
}

function main() {
  const idx = process.argv.indexOf('--session-dir');
  const dir = idx >= 0 ? process.argv[idx + 1] : process.cwd();
  const mdText = readFileSync(join(dir, 'phase4.md'), 'utf8');
  const confirmObj = JSON.parse(readFileSync(join(dir, 'phase4_confirm.json'), 'utf8'));
  const errors = [
    ...validatePhase4Md(mdText).errors,
    ...validateConfirmJson(confirmObj).errors,
    ...crossCheck(mdText, confirmObj).errors,
  ];
  if (errors.length) {
    console.error('check-phase4-confirm FAILED:\n' + errors.map((e) => '  - ' + e).join('\n'));
    process.exit(1);
  }
  console.log('check-phase4-confirm OK');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
