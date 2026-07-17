#!/usr/bin/env node

/**
 * 段 A gate：校验 context.md 契约。
 *
 * 通过条件：site/context 标记存在 + 摘要段五要点齐全 + context-done 含路线必填字段。
 * 用法：node scripts/check-context.mjs --session-dir <CPQ_SESSION_DIR>
 * 契约见 docs/cpq/abc-refactor/intermediate-files.md。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { checkSummary, parseDoneMarker, parseSiteMarker } from './lib/md-contract.mjs';

const REQUIRED_FIELDS = ['site', 'intent', 'run_c', 'run_d', 'order', 'exec_mode', 'session_dir'];

export function validateContext(text) {
  const errors = [];
  if (!parseSiteMarker(text).site) errors.push('缺少首行 site/context 标记');

  const summary = checkSummary(text);
  if (!summary.hasSection) errors.push('缺少 "## 摘要" 段');
  for (const m of summary.missing) errors.push(`摘要缺要点：${m}`);

  const done = parseDoneMarker(text, 'context');
  if (!done.found) {
    errors.push('缺少 context-done 标记');
  } else {
    for (const f of REQUIRED_FIELDS) {
      if (!(f in done.fields)) errors.push(`context-done 缺字段：${f}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function main() {
  const idx = process.argv.indexOf('--session-dir');
  const dir = idx >= 0 ? process.argv[idx + 1] : process.cwd();
  const text = readFileSync(join(dir, 'context.md'), 'utf8');
  const { ok, errors } = validateContext(text);
  if (!ok) {
    console.error('check-context FAILED:\n' + errors.map((e) => '  - ' + e).join('\n'));
    process.exit(1);
  }
  console.log('check-context OK');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
