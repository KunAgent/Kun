/**
 * 中间文件契约的共享解析器（纯函数，无副作用）。
 *
 * 被各 gate 脚本（check-*.mjs / verify-*.mjs / fill-*.mjs）复用，
 * 也被 scripts/tests/md-contract.test.ts 直接覆盖。
 *
 * 契约定义见 docs/cpq/abc-refactor/intermediate-files.md §三。
 */

/**
 * 解析首行站点标记 `<!-- site: cn|intl [version=N] -->`
 * 或 context 专用的 `<!-- context: cn|intl [version=N] -->`。
 * @param {string} text
 * @returns {{ site: 'cn'|'intl'|null, version: number|null }}
 */
export function parseSiteMarker(text) {
  const m = text.match(/<!--\s*(?:site|context):\s*(cn|intl)(?:\s+version=(\d+))?\s*-->/);
  if (!m) return { site: null, version: null };
  return { site: m[1], version: m[2] ? Number(m[2]) : null };
}

/**
 * 解析末行完成标记 `<!-- <name>-done: k=v k2=v2 ... -->`（支持单行与多行）。
 * @param {string} text
 * @param {string} name 如 'phase1' / 'context' / 'phase4_1'
 * @returns {{ found: boolean, fields: Record<string, string> }}
 */
export function parseDoneMarker(text, name) {
  const m = text.match(new RegExp(`<!--\\s*${name}-done:\\s*([\\s\\S]*?)-->`));
  if (!m) return { found: false, fields: {} };
  const fields = {};
  for (const tok of m[1].split(/\s+/)) {
    const kv = tok.match(/^([\w.]+)=(.+)$/);
    if (kv) fields[kv[1]] = kv[2];
  }
  return { found: true, fields };
}

const SUMMARY_KEYS = [
  { label: '本阶段做了什么', kw: ['本阶段做了什么'] },
  { label: '关键判断', kw: ['关键判断', '分叉结论'] },
  { label: '给主 agent 的路由建议', kw: ['给主 agent 的路由建议'] },
  { label: '给下游', kw: ['给下游'] },
  { label: '异常', kw: ['异常', '留空', '失败行'] },
];

/**
 * 校验 md 衔接文件的「## 摘要」段是否含 5 条必备要点。
 * @param {string} text
 * @returns {{ ok: boolean, hasSection: boolean, missing: string[] }}
 */
export function checkSummary(text) {
  const hasSection = /(^|\n)##\s*摘要\s*(\n|$)/.test(text);
  const missing = [];
  for (const k of SUMMARY_KEYS) {
    if (!k.kw.some((w) => text.includes(w))) missing.push(k.label);
  }
  return { ok: hasSection && missing.length === 0, hasSection, missing };
}

/**
 * 提取 md 数据表（首个由 `|` 行构成的表）。跳过表头分隔行（第 2 行）。
 * @param {string} text
 * @returns {{ headers: string[], rows: string[][] }}
 */
export function extractTable(text) {
  const lines = text.split('\n').filter((l) => l.trim().startsWith('|'));
  if (lines.length < 2) return { headers: [], rows: [] };
  const cells = (l) =>
    l
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
  return { headers: cells(lines[0]), rows: lines.slice(2).map(cells) };
}

/**
 * 按列名取某行的单元格值。
 * @param {string[]} headers
 * @param {string[]} row
 * @param {string} name
 * @returns {string|undefined}
 */
export function cellOf(headers, row, name) {
  const i = headers.indexOf(name);
  return i >= 0 ? row[i] : undefined;
}
