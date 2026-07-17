/**
 * 偏好档案中的列表型「事实」去重（写入前归一化键，避免跨会话无限膨胀）。
 * 对齐 DeerFlow「apply 时跳过重复 fact」的工程思路。
 */

/** @param {string} s */
export function normalizePreferenceFactKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * @param {string[]} arr
 * @returns {string[]} 保序，后者覆盖同键（保留最后一次出现）
 */
export function dedupeForbiddenRecommendations(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Map();
  const out = [];
  for (const raw of arr) {
    const v = String(raw ?? '').trim();
    if (!v) continue;
    const k = normalizePreferenceFactKey(v);
    if (seen.has(k)) continue;
    seen.set(k, true);
    out.push(v);
  }
  return out;
}

/**
 * 列表通常为「新在前」；同键保留**首次出现**即最新一条。
 *
 * @param {Array<{ suggestion?: string, reason?: string, timestamp?: string }>} entries
 */
export function dedupeRejectedSuggestions(entries) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const suggestion = String(e?.suggestion ?? '').trim();
    if (!suggestion) continue;
    const k = normalizePreferenceFactKey(suggestion);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      suggestion,
      reason: String(e?.reason ?? ''),
      timestamp: e?.timestamp || new Date().toISOString(),
    });
  }
  return out;
}

/**
 * @param {Array<{ suggestion?: string, reason?: string, timestamp?: string }>} entries
 */
export function dedupeAcceptedSuggestions(entries) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const suggestion = String(e?.suggestion ?? '').trim();
    if (!suggestion) continue;
    const k = normalizePreferenceFactKey(suggestion);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      suggestion,
      reason: String(e?.reason ?? ''),
      timestamp: e?.timestamp || new Date().toISOString(),
    });
  }
  return out;
}
