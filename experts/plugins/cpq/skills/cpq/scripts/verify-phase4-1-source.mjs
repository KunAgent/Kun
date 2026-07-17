/**
 * D 询价行来源校验：phase4_1.md 的每一行必须来自 A/B 的产品行集合，防止"凭空冒出来的行"。
 *
 * 规则（纯脚本判定）：phase4_1 表里每个 row_id（首列）必须出现在 knownRowIds
 * （来自 phase1.md / phase2.md 的行 id 集合）。
 *
 * 契约见 docs/cpq/abc-refactor/subagent-d.md（输入 = phase1 原生腾讯云行 + phase2 我方对标产品）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { extractTable } from './lib/md-contract.mjs';

export function validateSource({ phase4_1Text, knownRowIds }) {
  const errors = [];
  const known = new Set(knownRowIds);
  const { rows } = extractTable(phase4_1Text);
  for (const row of rows) {
    const id = row[0];
    if (id && !known.has(id)) errors.push(`询价行 ${id} 不在 A/B 的产品行集合内`);
  }
  return { ok: errors.length === 0, errors };
}

function rowIdsOf(text) {
  return extractTable(text)
    .rows.map((r) => r[0])
    .filter(Boolean);
}

function read(dir, name) {
  const p = join(dir, name);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function main() {
  const idx = process.argv.indexOf('--session-dir');
  const dir = idx >= 0 ? process.argv[idx + 1] : process.cwd();
  const known = [];
  for (const name of ['phase1.md', 'phase2.md']) {
    const text = read(dir, name);
    if (text) known.push(...rowIdsOf(text));
  }
  const { ok, errors } = validateSource({
    phase4_1Text: readFileSync(join(dir, 'phase4_1.md'), 'utf8'),
    knownRowIds: known,
  });
  if (!ok) {
    console.error('verify-phase4-1-source FAILED:\n' + errors.map((e) => '  - ' + e).join('\n'));
    process.exit(1);
  }
  console.log('verify-phase4-1-source OK');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
