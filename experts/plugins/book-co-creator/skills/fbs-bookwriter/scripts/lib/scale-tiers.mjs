/**
 * 加载 references/05-ops/scale-tiers.json 并提供档位解析。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @param {string} skillRoot */
export function loadScaleTiers(skillRoot) {
  const p = path.join(skillRoot, "references", "05-ops", "scale-tiers.json");
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

const ORDER = { S: 0, M: 1, L: 2, XL: 3 };

function tierFromWords(w, by) {
  if (w <= by.S_max) return "S";
  if (w <= by.M_max) return "M";
  if (w <= by.L_max) return "L";
  return "XL";
}

function tierFromChapters(c, by) {
  if (c <= by.S_max) return "S";
  if (c <= by.M_max) return "M";
  if (c <= by.L_max) return "L";
  return "XL";
}

/**
 * @param {number|null|undefined} targetWords
 * @param {number|null|undefined} plannedChapters
 * @param {object} [tiers] loadScaleTiers 结果
 * @returns {{ tier: string, byWords: string, byChapters: string, policy: string } | null}
 */
export function resolveSkillStrategyTier(targetWords, plannedChapters, tiers) {
  const w = Number(targetWords);
  const c = Number(plannedChapters);
  const hasW = Number.isFinite(w) && w > 0;
  const hasC = Number.isFinite(c) && c > 0;
  if (!hasW && !hasC) return null;
  const sw = tiers.skillWritingStrategy;
  const byW = hasW ? tierFromWords(w, sw.byTargetWords) : "S";
  const byC = hasC ? tierFromChapters(c, sw.byPlannedChapters) : "S";
  const tier = ORDER[byW] >= ORDER[byC] ? byW : byC;
  return {
    tier,
    byWords: byW,
    byChapters: byC,
    policy: sw.policyByTier[tier] || "",
  };
}

/**
 * @param {number} totalChars
 * @param {object} [tiers] loadScaleTiers 结果
 */
export function resolveVolumeScaleFromChars(totalChars, tiers) {
  const t = tiers.volumeCharacterThresholds;
  const n = Number(totalChars) || 0;
  if (n >= t.XL_min) return "XL";
  if (n >= t.L_min) return "L";
  if (n >= t.M_min) return "M";
  return "S";
}

/**
 * @param {string} scale S|M|L|XL
 * @param {object} [tiers]
 * @returns {number} 每卷目标字符数
 */
export function volumeSplitTargetForScale(scale, tiers) {
  const m = tiers.volumeSplitTargetCharsPerVolume;
  if (scale === "XL") return m.XL;
  if (scale === "L") return m.L;
  if (scale === "M") return m.M;
  return m.M;
}
