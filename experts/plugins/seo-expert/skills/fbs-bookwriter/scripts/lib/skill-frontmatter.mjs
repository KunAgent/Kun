/**
 * SKILL.md YAML frontmatter 键白名单校验（对标 DeerFlow skills/validation 思路）。
 * 仅校验顶层键名，不解析完整 YAML（避免引入 yaml 依赖）。
 */

import fs from 'fs';
import path from 'path';

/** 与 FBS-BookWriter 当前 SKILL.md 对齐；新增键须同步更新本集合与文档 */
export const ALLOWED_SKILL_FRONTMATTER_KEYS = new Set([
  'name',
  'version',
  'plugin-id',
  'description',
  'description_zh',
  'description_en',
  'allowed-tools',
  'user-invocable',
  'scene-packs',
  'ui-actions',
]);

/**
 * @param {string} text SKILL.md 全文
 * @returns {string[]} 顶层 frontmatter 键（按出现顺序）
 */
export function extractTopLevelFrontmatterKeys(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return [];
  const block = m[1];
  const keys = [];
  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const km = trimmed.match(/^([a-zA-Z0-9_.-]+):/);
    if (km) keys.push(km[1]);
  }
  return keys;
}

/**
 * @param {string} skillRoot
 * @param {{ skillMdRelative?: string }} [opts]
 * @returns {{ ok: boolean, errors: string[], keys: string[] }}
 */
export function validateSkillFrontmatter(skillRoot, opts = {}) {
  const rel = opts.skillMdRelative ?? 'SKILL.md';
  const skillPath = path.join(path.resolve(skillRoot), rel);
  const errors = [];

  if (!fs.existsSync(skillPath)) {
    return { ok: false, errors: [`缺少 ${rel}`], keys: [] };
  }

  let text;
  try {
    text = fs.readFileSync(skillPath, 'utf8');
  } catch (e) {
    return { ok: false, errors: [`无法读取 ${rel}: ${e.message}`], keys: [] };
  }

  if (!text.startsWith('---')) {
    errors.push(`${rel} 须以 YAML frontmatter（---）开头`);
    return { ok: false, errors, keys: [] };
  }

  const keys = extractTopLevelFrontmatterKeys(text);
  const unexpected = keys.filter((k) => !ALLOWED_SKILL_FRONTMATTER_KEYS.has(k));
  if (unexpected.length > 0) {
    errors.push(
      `不允许的 frontmatter 键: ${unexpected.join(', ')}（白名单见 scripts/lib/skill-frontmatter.mjs）`,
    );
  }

  return { ok: errors.length === 0, errors, keys };
}
