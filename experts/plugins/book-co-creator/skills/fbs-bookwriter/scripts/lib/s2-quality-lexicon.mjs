/**
 * S2 机读词表加载（单一真源：references/02-quality/s2-quality-machine-lexicon.json）
 */
import fs from 'fs';
import path from 'path';
import { resolveQualityReferenceFile } from './quality-runtime.mjs';

const FALLBACK = {
  schemaVersion: '0',
  safeAdverbs: ['非常', '显著', '大幅', '彻底', '极其', '极大地', '深刻地', '全面地', '前所未有', '充分', '尤其', '特别', '相当', '格外', '甚为', '甚'],
  imperativeClassA: ['必须', '务必', '一定', '绝不能', '无论如何'],
  protectedPhrases: ['深度学习', '深度阅读', '深度工作', '深度理解', '高度不确定', '高度专业', '高度复杂'],
  imperativeAutoFixMap: {
    无论如何: '总之',
    绝不能: '应避免',
    务必: '建议',
    必须: '需要',
    一定: '通常',
  },
  safeAdverbAutoFixMap: {},
};

export function loadS2QualityMachineLexicon(skillRoot) {
  const p = resolveQualityReferenceFile(skillRoot, 's2-quality-machine-lexicon.json');
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      ...FALLBACK,
      ...j,
      safeAdverbs: Array.isArray(j.safeAdverbs) ? j.safeAdverbs : FALLBACK.safeAdverbs,
      imperativeClassA: Array.isArray(j.imperativeClassA) ? j.imperativeClassA : FALLBACK.imperativeClassA,
      protectedPhrases: Array.isArray(j.protectedPhrases) ? j.protectedPhrases : FALLBACK.protectedPhrases,
      imperativeAutoFixMap: { ...FALLBACK.imperativeAutoFixMap, ...(j.imperativeAutoFixMap || {}) },
      safeAdverbAutoFixMap: { ...(j.safeAdverbAutoFixMap || {}) },
      _sourcePath: p,
    };
  } catch {
    return { ...FALLBACK, _sourcePath: p };
  }
}

/**
 * 在统计 A 类词前弱化「非命令」语境（WorkBuddy 2026-04-15 实测：「不一定」「一定规模」等误标）
 * — 不改变磁盘正文，仅用于扫描。
 */
export function prepareTextForImperativeScan(raw) {
  let s = String(raw);
  s = s.replace(/```[\s\S]*?```/g, (b) => ' '.repeat(Math.min(b.length, 5000)));
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/不一定/g, '  ');
  s = s.replace(/不必须/g, '   ');
  const dingCompounds = [
    '有了一定',
    '有一定',
    '给一定',
    '留一定',
    '需要一定',
    '具备一定',
    '经过一定',
    '达到一定',
    '保持一定',
    '维持一定',
    '在一定程度',
    '在一定范围',
    '占一定比例',
    '到一定程度上',
    '一定规模',
    '一定程度',
    '一定数量',
    '一定比例',
    '一定范围',
    '一定水平',
    '一定基础',
    '一定条件',
    '一定阶段',
    '一定时期',
    '一定时间',
    '一定距离',
    '一定角度',
    '一定限度',
    '一定份额',
    '一定经验',
    '一定弹性',
    '一定空间',
  ];
  for (const ph of dingCompounds) {
    if (!ph.includes('一定')) continue;
    s = s.split(ph).join(' '.repeat(ph.length));
  }
  return s;
}

/** 统计 A 类绝对化命令词命中（长词优先匹配，避免子串重复计数） */
export function imperativeHitsForText(text, lex) {
  const prepared = prepareTextForImperativeScan(text);
  const terms = [...(lex.imperativeClassA || [])].sort((a, b) => b.length - a.length);
  const out = {};
  for (const word of terms) {
    if (!word) continue;
    const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const n = (prepared.match(re) || []).length;
    if (n) out[word] = n;
  }
  return out;
}
