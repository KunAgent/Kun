// lib.mjs — Shared utilities for the legal verification workbench.
// Zero third-party dependencies (Node.js built-ins only) so the expert pack runs offline.
//
// Ported design ideas from LawBuddy (paragraph-index.ts, citation-supplement.ts) but
// fully re-implemented here. This pack must NOT import or call LawBuddy at runtime.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MEMORY_ROOT = '.legal-search-memory';
export const SCHEMA_VERSION = '1.0';

// ---------------------------------------------------------------------------
// IDs & hashing
// ---------------------------------------------------------------------------

export function sha1(input) {
  return crypto.createHash('sha1').update(String(input), 'utf8').digest('hex');
}

/** Stable 12-char source id from provider + title + url/lawId. */
export function makeSourceId({ provider = '', title = '', url = '', lawId = '' } = {}) {
  return sha1(`${provider}|${title}|${url || lawId}`).slice(0, 12);
}

/** taskId like 20260620-103000-a1b2c3 */
export function makeTaskId(date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const stamp =
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  const rand = crypto.randomBytes(3).toString('hex');
  return `${stamp}-${rand}`;
}

export function nowIso() {
  // Local ISO with timezone offset, e.g. 2026-06-20T10:30:00+08:00
  const d = new Date();
  const tz = -d.getTimezoneOffset();
  const sign = tz >= 0 ? '+' : '-';
  const p = (n, w = 2) => String(Math.floor(Math.abs(n))).padStart(w, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(tz / 60)}:${p(tz % 60)}`
  );
}

// ---------------------------------------------------------------------------
// Path safety — keep everything inside the task directory, block ../ traversal
// ---------------------------------------------------------------------------

export function resolveTaskDir(taskArg, workspaceRoot = process.cwd()) {
  let dir = taskArg;
  if (!dir) throw new Error('taskDir is required');
  if (!path.isAbsolute(dir)) dir = path.resolve(workspaceRoot, dir);
  return dir;
}

/** Resolve a path that MUST stay inside baseDir. Throws on traversal. */
export function safeJoin(baseDir, ...segments) {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, ...segments);
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path traversal blocked: ${segments.join('/')}`);
  }
  return target;
}

export function sanitizeFileName(name) {
  return String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'untitled';
}

// ---------------------------------------------------------------------------
// JSON / file helpers
// ---------------------------------------------------------------------------

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function readJsonStrict(file, label = 'JSON file') {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error(`${label} not found: ${file}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${label} 格式错误，无法解析：${file}；${e.message}`);
  }
}

export function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

export function readText(file, fallback = '') {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

export function writeText(file, text) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text, 'utf8');
}

export function appendJsonl(file, records) {
  ensureDir(path.dirname(file));
  const lines = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.appendFileSync(file, lines, 'utf8');
}

export function readJsonl(file) {
  const txt = readText(file, '');
  if (!txt.trim()) return [];
  return txt
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export function manifestPath(taskDir) {
  return path.join(taskDir, 'manifest.json');
}

export function loadManifest(taskDir) {
  const m = readJson(manifestPath(taskDir), null);
  if (!m) throw new Error(`manifest.json not found in ${taskDir}. Run "init" first.`);
  return m;
}

export function saveManifest(taskDir, manifest) {
  writeJson(manifestPath(taskDir), manifest);
}

// ---------------------------------------------------------------------------
// Chinese numerals — convert 第十三条 <-> 13 for robust article matching
// ---------------------------------------------------------------------------

const CN_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNITS = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

/** Parse a Chinese (or arabic) numeral string to an integer. Returns NaN on failure. */
export function cnNumToInt(raw) {
  if (raw == null) return NaN;
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  let total = 0;
  let section = 0;
  let current = 0;
  for (const ch of s) {
    if (ch in CN_DIGITS) {
      current = CN_DIGITS[ch];
    } else if (ch in CN_UNITS) {
      const unit = CN_UNITS[ch];
      if (unit === 10000) {
        section = (section + (current || 0)) * unit;
        total += section;
        section = 0;
      } else {
        if (current === 0) current = 1; // 十 == 10
        section += current * unit;
      }
      current = 0;
    }
  }
  const result = total + section + current;
  return result || (s ? NaN : 0);
}

/**
 * Normalize an article label to a canonical key like "第13条" / "第13条之一".
 * Accepts "第十三条", "第13条", "13", "第十三条之一", etc. Returns null if not parseable.
 */
export function normalizeArticleKey(label) {
  if (!label) return null;
  const s = String(label);
  const m = s.match(/第?\s*([一二三四五六七八九十百千万零〇\d]+)\s*条(?:\s*之\s*([一二三四五六七八九十\d]+))?/);
  let numStr;
  let sub;
  if (m) {
    numStr = m[1];
    sub = m[2];
  } else if (/^[一二三四五六七八九十百千万零〇\d]+$/.test(s.trim())) {
    numStr = s.trim();
  } else {
    return null;
  }
  const n = cnNumToInt(numStr);
  if (Number.isNaN(n)) return null;
  let key = `第${n}条`;
  if (sub) {
    const subN = cnNumToInt(sub);
    if (!Number.isNaN(subN)) key += `之${subN}`;
  }
  return key;
}

// ---------------------------------------------------------------------------
// Law title normalization & alias matching
// "中华人民共和国个人信息保护法" ~ "个人信息保护法" ~ "个保法"
// ---------------------------------------------------------------------------

// Common Chinese legal abbreviation aliases (extended via subsequence heuristic below).
const LAW_ALIASES = {
  个保法: '个人信息保护法',
  数安法: '数据安全法',
  网安法: '网络安全法',
  民诉法: '民事诉讼法',
  刑诉法: '刑事诉讼法',
  行诉法: '行政诉讼法',
  劳动法: '劳动法',
  劳合法: '劳动合同法',
  合同法: '合同法',
  公司法: '公司法',
  反不正当竞争法: '反不正当竞争法',
};

// Trigger words that may wrongly cling to a captured law title.
const TITLE_PREFIX_NOISE = /^(根据|依据|依照|按照|参照|适用|结合|引用|及|与|和|、|，|,)+/;

export function normalizeLawTitle(title) {
  if (!title) return '';
  let t = String(title)
    .replace(/[《》\s]/g, '')
    .replace(TITLE_PREFIX_NOISE, '')
    .replace(/^中华人民共和国/, '')
    .trim();
  if (LAW_ALIASES[t]) t = LAW_ALIASES[t];
  return t;
}

/** True if `short` is an in-order subsequence of `long` (个保法 ⊂ 个人信息保护法). */
function isSubsequence(short, long) {
  if (!short || short.length < 2 || short.length >= long.length) return false;
  let i = 0;
  for (const ch of long) {
    if (ch === short[i]) i++;
    if (i === short.length) return true;
  }
  return false;
}

/**
 * Title similarity for alias matching. Returns 0..1.
 * Handles 全称/简称 via containment, subsequence (abbreviations), and bigram fallback.
 */
export function lawTitleSimilarity(a, b) {
  const na = normalizeLawTitle(a);
  const nb = normalizeLawTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = Math.min(na.length, nb.length);
    const longer = Math.max(na.length, nb.length);
    return Math.min(0.97, shorter / longer + 0.45);
  }
  // abbreviation as in-order subsequence (个保法 -> 个人信息保护法)
  const shortT = na.length <= nb.length ? na : nb;
  const longT = na.length <= nb.length ? nb : na;
  if (isSubsequence(shortT, longT)) return 0.9;
  return bigramJaccard(na, nb);
}

// ---------------------------------------------------------------------------
// Text similarity — character bigram Jaccard (ported from LawBuddy)
// ---------------------------------------------------------------------------

export function normalizeForSim(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\[\^?\d+\]/g, '')
    .replace(/[*_`#>~\-]+/g, '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。！？；：、,.!?;:"'""''（）()【】\[\]《》]/g, '');
}

function ngrams(str, n = 2) {
  const set = new Set();
  for (let i = 0; i + n <= str.length; i++) set.add(str.slice(i, i + n));
  return set;
}

/** Character bigram Jaccard similarity, 0..1. */
export function bigramJaccard(a, b, n = 2) {
  const na = normalizeForSim(a);
  const nb = normalizeForSim(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // containment boost for short-in-long
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length >= 8 && longer.includes(shorter)) {
    return Math.min(0.98, shorter.length / longer.length + 0.45);
  }
  if (na.length < n || nb.length < n) return na === nb ? 1 : 0;
  const ga = ngrams(na, n);
  const gb = ngrams(nb, n);
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  const union = ga.size + gb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Keyword overlap ratio based on 2+ char CJK runs and ascii words. */
export function keywordOverlap(a, b) {
  const toks = (t) => {
    const out = new Set();
    const s = String(t || '');
    for (const m of s.matchAll(/[\u4e00-\u9fa5]{2,}|[A-Za-z]{3,}|\d{2,}/g)) out.add(m[0].toLowerCase());
    return out;
  };
  const ta = toks(a);
  const tb = toks(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

/**
 * Bonus (0..~0.35) for sharing a salient legal phrase — the longest common
 * CJK substring of length >= minLen. Robust to tokenization boundary drift
 * (e.g. "安全保障义务", "本院认为", "公共场所"). Returns 0 if none.
 */
export function sharedPhraseBonus(a, b, minLen = 4) {
  const sa = normalizeForSim(a);
  const sb = normalizeForSim(b);
  if (sa.length < minLen || sb.length < minLen) return 0;
  // scan substrings of `a` (the shorter) against `b`
  const [short, long] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  let best = 0;
  for (let len = Math.min(short.length, 12); len >= minLen; len--) {
    for (let i = 0; i + len <= short.length; i++) {
      const sub = short.slice(i, i + len);
      if (long.includes(sub)) {
        best = len;
        break;
      }
    }
    if (best) break;
  }
  if (!best) return 0;
  return Math.min(0.35, (best - minLen + 1) * 0.06 + 0.12);
}

// ---------------------------------------------------------------------------
// HTML escape — mandatory for all user/source content injected into the report
// ---------------------------------------------------------------------------

export function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

export function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

export function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}
