// extract-verification-points.mjs — Build the list of verification points.
//
// ⚠️ DESIGN SHIFT (v2): Two sources of verification points, in priority order:
//
//   1) AI SEMANTIC DECLARATIONS (preferred) — claims.json
//      When the expert writes its opinion, it ALSO emits a claims.json declaring, for each
//      sentence/conclusion that leans on a legal basis, *which source + article* it relies on
//      (semantic association decided by the AI, who actually understands the meaning).
//      Each declaration becomes a verification point with `declared: true`. The match step
//      then only confirms the declared source/article truly EXISTS (anti-fabrication) and
//      anchors it to the real paragraph — it never re-judges correctness.
//
//   2) RULE-BASED EXTRACTION (fallback) — scan answer.md
//      For answers without claims.json (or to catch citations the AI forgot to declare), we
//      still detect 《法律名》第X条 / 案号 / 《...规定》 / trigger-word claims. These points are
//      `declared: false`; if they name a real source they anchor as 已关联, otherwise the
//      match step surfaces a similarity *suggestion* (弱关联) or marks 待核验 — never "wrong".
//
// claims.json shape (emitted by the agent, optional):
//   { "claims": [
//       { "claimText": "处理个人信息须取得单独同意",   // the sentence as written in answer.md
//         "sourceTitle": "个人信息保护法",            // preferred; or "sourceId": "<12-hex>"
//         "articleNo": "第29条",                      // optional; omit for whole-doc basis
//         "caseNo": "（2023）京0105民初12345号" }      // optional, for case refs
//     ] }
//
// Usage:
//   node extract-verification-points.mjs --task <dir> [--answer answer.md] [--claims claims.json]
// Prints JSON summary; writes verification/verification_points.json

import path from 'node:path';
import {
  parseArgs, printJson, readText, readJson, writeJson, loadManifest, safeJoin,
  resolveTaskDir, normalizeArticleKey,
} from './lib.mjs';

// ----- regexes ------------------------------------------------------------
// 《法律名》 第X条 [第X款] [第X项]
const STATUTE_RE =
  /《([^》]{2,80})》\s*第\s*([一二三四五六七八九十百千万零〇\d]+)\s*条(?:\s*之\s*([一二三四五六七八九十\d]+))?(?:\s*第\s*([一二三四五六七八九十百千万零〇\d]+)\s*款)?(?:\s*第\s*([一二三四五六七八九十百千万零〇\d]+)\s*项)?/g;
// bare 第X条 without preceding 《》 in the same clause (lower priority; needs nearby law name)
const BARE_ARTICLE_RE = /第\s*([一二三四五六七八九十百千万零〇\d]+)\s*条/g;
// case number
const CASE_NO_RE = /[（(]\s*\d{4}\s*[）)][^\s，。；：]{2,40}号/g;
// regulatory/normative doc title (no 条 number, ends with a doc-type word)
const REG_DOC_RE = /《([^》]{2,80}(?:规定|办法|条例|通知|意见|标准|规范|细则|批复|决定|解释))》/g;

// trigger words → broad claim/viewpoint/conclusion detection
const TRIGGER_RE =
  /根据|依据|依照|按照|参照|规定|明确|要求|载明|约定|指出|提出|表明|显示|属于|应当|不得|可以|必须|须|认定|构成|承担|赔偿|法院认为|本院认为|裁判要旨|裁判要点/;
const CONCLUSION_RE = /综上|因此|故|应当承担|应予支持|不予支持|构成|成立|应当认定|可以认定|应予赔偿/;
const VIEWPOINT_RE = /法院认为|本院认为|裁判要旨|裁判要点|通常认为|一般认为|普遍认为|观点认为|学界认为/;
// numbers / dates / amounts
const NUMERIC_RE = /\d{4}年|\d+(?:\.\d+)?\s*(?:%|％|万元|亿元|万|亿|元|人|个|项|份|次|日|月|年|倍|名)/;

function splitSentences(text) {
  // keep paragraph index by splitting first on lines, then on sentence enders
  return String(text)
    .split('\n')
    .flatMap((line, li) => {
      let trimmed = line.trim();
      if (!trimmed) return [];
      // Detect & strip Markdown heading markers. Headings are structural labels,
      // not verifiable claims — flag them so the soft trigger branch can skip them,
      // while still allowing genuine statute/case refs inside a heading to match.
      const headMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
      const isHeading = Boolean(headMatch);
      if (isHeading) trimmed = headMatch[2].trim();
      if (!trimmed) return [];
      const parts = trimmed.match(/[^。！？；;]+[。！？；;]?/g) || [trimmed];
      let offset = 0;
      return parts.map((s) => {
        const startOffset = line.indexOf(s, offset);
        offset = startOffset + s.length;
        return { paragraphIndex: li, text: s.trim(), startOffset: startOffset < 0 ? 0 : startOffset, isHeading };
      });
    })
    .filter((s) => s.text.length >= 4);
}

function riskFor(type) {
  if (type === 'statute_article' || type === 'case_ref') return 'high';
  if (type === 'legal_claim' || type === 'conclusion' || type === 'regulatory_doc') return 'medium';
  return 'low';
}

const SOFT_FALLBACK_TYPES = new Set(['legal_claim', 'conclusion', 'viewpoint', 'factual_claim']);

function hasExplicitLegalAnchor(text) {
  const t = String(text || '');
  return /《[^》]{2,80}》\s*第\s*[一二三四五六七八九十百千万零〇\d]+\s*条/.test(t)
    || /[\u4e00-\u9fa5]{2,20}法\s*第\s*[一二三四五六七八九十百千万零〇\d]+\s*条/.test(t)
    || /[（(]\s*\d{4}\s*[）)][^\s，。；：]{2,40}号/.test(t)
    || /《[^》]{2,80}(?:规定|办法|条例|通知|意见|标准|规范|细则|批复|决定|解释)》/.test(t);
}

function hasConcreteTarget(point) {
  const t = point && point.normalizedTarget ? point.normalizedTarget : {};
  return Boolean(t.title || t.sourceId || t.articleNo || t.caseNo);
}

function isDerivativeConclusion(text, prevSent) {
  const t = String(text || '').trim();
  if (!prevSent || prevSent.paragraphIndex == null) return false;
  if (hasExplicitLegalAnchor(t)) return false;
  const prev = String(prevSent.text || '');
  const startsAsConclusion = /^(因此|故|所以|据此|由此|可见|这意味着|说明|表明|基于此|在此基础上|从而|相应地)/.test(t);
  const refersBack = /^(该|上述|前述|此|这|其|因此|故|所以|据此|由此)/.test(t);
  return (startsAsConclusion || refersBack) && hasExplicitLegalAnchor(prev) && t.length <= 180;
}

/**
 * Locate the answer line index whose text best contains/overlaps a declared claim sentence,
 * so the HTML can highlight the right line. Falls back to 0.
 */
function locateClaimLine(claimText, sentences) {
  const norm = (s) => String(s || '').replace(/[\s\u3000，。；、,.;]/g, '');
  const want = norm(claimText);
  if (!want) return { paragraphIndex: 0, snippet: claimText, startOffset: 0 };
  // exact-ish containment first
  for (const s of sentences) {
    if (norm(s.text).includes(want) || want.includes(norm(s.text))) {
      return { paragraphIndex: s.paragraphIndex, snippet: s.text, startOffset: s.startOffset };
    }
  }
  // otherwise longest shared-substring line
  let best = sentences[0] || { paragraphIndex: 0, text: claimText, startOffset: 0 };
  let bestOverlap = 0;
  for (const s of sentences) {
    const a = norm(s.text);
    let ov = 0;
    for (let len = Math.min(a.length, want.length, 14); len >= 4 && !ov; len--) {
      for (let i = 0; i + len <= want.length; i++) {
        if (a.includes(want.slice(i, i + len))) { ov = len; break; }
      }
    }
    if (ov > bestOverlap) { bestOverlap = ov; best = s; }
  }
  return { paragraphIndex: best.paragraphIndex, snippet: best.text, startOffset: best.startOffset || 0 };
}

/**
 * Normalize ONE raw claim object into the canonical shape the rest of the pipeline expects.
 *
 * Defensive aliasing: the spec field names are claimText / sourceTitle / sourceId / articleNo /
 * caseNo, but callers (incl. the agent that authored this opinion) frequently emit close-but-wrong
 * variants. Rather than silently drop them — the root cause of an all-red report — we accept the
 * common aliases and coerce them. Anything we cannot map is left undefined and the claim degrades
 * gracefully (becomes a declared legal_claim with no target), never silently vanishes.
 *
 *   claimText : claimText | claim | text | sentence | quote
 *   sourceTitle: sourceTitle | title | source | lawTitle | docTitle | sourceName
 *   sourceId  : sourceId | sid | id            (12-hex real sid; S1/s1 display ids mapped via manifest when possible)
 *   articleNo : articleNo | article | articleRef | clause | provision   (第X条 extracted if mixed-in)
 *   caseNo    : caseNo | case | caseNumber
 */
export function normalizeClaim(raw, sourceAliasMap = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const pick = (...keys) => {
    for (const k of keys) {
      const v = raw[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  };
  const claimText = pick('claimText', 'claim', 'text', 'sentence', 'quote');
  if (!claimText) return null;

  let sourceTitle = pick('sourceTitle', 'title', 'source', 'lawTitle', 'docTitle', 'sourceName');
  // strip 《》 if the title was written with book-title marks
  sourceTitle = sourceTitle.replace(/^《|》$/g, '').trim();

  // sourceId: prefer a real 12-hex id. If the caller used display ids like "S1"/"s1",
  // map them through manifest.sources as a defensive fallback and emit a warning upstream.
  let sourceId = '';
  let displaySourceId = '';
  for (const k of ['sourceId', 'sid']) {
    const v = raw[k];
    if (typeof v === 'string' && /^[0-9a-f]{12}$/i.test(v.trim())) { sourceId = v.trim(); break; }
    if (typeof v === 'string' && /^[scl]\d+$/i.test(v.trim())) displaySourceId = v.trim().toLowerCase();
  }
  if (!sourceId && displaySourceId && sourceAliasMap[displaySourceId]) {
    sourceId = sourceAliasMap[displaySourceId].sourceId || '';
    if (!sourceTitle) sourceTitle = sourceAliasMap[displaySourceId].title || '';
  }

  // articleNo: accept several aliases; if the value is a free-form ref like "个保法第29条" or
  // "《X》第29条第2款" we still pull out the 第X条 token so the index lookup can hit.
  let articleNo = pick('articleNo', 'article', 'articleRef', 'clause', 'provision');
  if (articleNo) {
    const m = articleNo.match(/第\s*[一二三四五六七八九十百千万零〇\d]+\s*条(?:\s*之\s*[一二三四五六七八九十\d]+)?/);
    if (m) articleNo = m[0];
    // if articleRef carried the law name but sourceTitle is still empty, try to recover it
    if (!sourceTitle) {
      const lm = (raw.articleRef || raw.article || '').match(/《([^》]{2,80})》/);
      if (lm) sourceTitle = lm[1];
    }
  }

  const caseNo = pick('caseNo', 'case', 'caseNumber');

  return {
    claimText,
    sourceTitle: sourceTitle || undefined,
    sourceId: sourceId || undefined,
    articleNo: articleNo || undefined,
    caseNo: caseNo || undefined,
    snippet: typeof raw.snippet === 'string' ? raw.snippet : undefined,
    answerParagraphIndex: typeof raw.answerParagraphIndex === 'number' ? raw.answerParagraphIndex : undefined,
    riskLevel: typeof raw.riskLevel === 'string' ? raw.riskLevel : undefined,
    displaySourceId: displaySourceId || undefined,
  };
}

function buildSourceAliasMap(manifest) {
  const map = {};
  const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
  sources.forEach((s, i) => {
    const entry = { sourceId: s.sourceId || '', title: s.title || '' };
    const n = String(i + 1);
    const n2 = n.padStart(2, '0');
    map[`s${n}`] = entry;
    map[`l${n}`] = entry;
    map[`c${n}`] = entry;
    map[`s${n2}`] = entry;
    map[`l${n2}`] = entry;
    map[`c${n2}`] = entry;
  });
  return map;
}

/**
 * Convert AI-declared claims (claims.json) into verification points.
 * These are the PREFERRED points — the AI semantically decided the association; the match
 * step only confirms the declared source/article exists.
 */
export function pointsFromClaims(rawClaims, answerText, sourceAliasMap = {}) {
  const sentences = splitSentences(answerText);
  const points = [];
  let seq = 0;
  for (const rc of rawClaims || []) {
    const c = normalizeClaim(rc, sourceAliasMap);
    if (!c || !c.claimText) continue;
    const loc = locateClaimLine(c.claimText, sentences);
    let type = 'legal_claim';
    const normalizedTarget = { declared: true };
    if (c.caseNo) {
      type = 'case_ref';
      normalizedTarget.caseNo = c.caseNo;
    } else if (c.articleNo) {
      type = 'statute_article';
      normalizedTarget.title = c.sourceTitle || '';
      normalizedTarget.articleNo = normalizeArticleKey(c.articleNo) || c.articleNo;
    } else if (c.sourceTitle || c.sourceId) {
      type = 'regulatory_doc';
    }
    if (c.sourceId) normalizedTarget.sourceId = c.sourceId;
    if (c.sourceTitle && !normalizedTarget.title) normalizedTarget.title = c.sourceTitle;
    seq += 1;
    points.push({
      pointId: `vp-${String(seq).padStart(3, '0')}`,
      type,
      text: c.claimText,
      snippet: c.snippet || loc.snippet || c.claimText,
      declared: true,
      normalizedTarget,
      answerParagraphIndex: typeof c.answerParagraphIndex === 'number' ? c.answerParagraphIndex : loc.paragraphIndex,
      startOffset: loc.startOffset,
      riskLevel: c.riskLevel || riskFor(type),
    });
  }
  return points;
}

export function extractPoints(answerText) {
  const sentences = splitSentences(answerText);
  const points = [];
  let seq = 0;
  const pushed = new Set(); // dedupe by type+text span

  const add = (p) => {
    const key = `${p.type}|${p.answerParagraphIndex}|${p.text}`;
    if (pushed.has(key)) return;
    pushed.add(key);
    seq += 1;
    points.push({ pointId: `vp-${String(seq).padStart(3, '0')}`, ...p });
  };

  for (let i = 0; i < sentences.length; i++) {
    const sent = sentences[i];
    const { text, paragraphIndex } = sent;
    const prevSent = sentences[i - 1] && sentences[i - 1].paragraphIndex === paragraphIndex ? sentences[i - 1] : null;
    let matchedStrong = false;

    // 1) statute article (strongest)
    for (const m of text.matchAll(STATUTE_RE)) {
      matchedStrong = true;
      const title = m[1];
      const articleKey = normalizeArticleKey(`第${m[2]}条${m[3] ? '之' + m[3] : ''}`);
      add({
        type: 'statute_article',
        text,
        snippet: m[0],
        normalizedTarget: {
          title,
          articleNo: articleKey,
          clause: m[4] ? normalizeArticleKey(`第${m[4]}条`)?.replace('条', '款') : null,
          item: m[5] || null,
        },
        answerParagraphIndex: paragraphIndex,
        startOffset: sent.startOffset,
        riskLevel: 'high',
      });
    }

    // 2) case number
    for (const m of text.matchAll(CASE_NO_RE)) {
      matchedStrong = true;
      add({
        type: 'case_ref',
        text,
        snippet: m[0],
        normalizedTarget: { caseNo: m[0] },
        answerParagraphIndex: paragraphIndex,
        startOffset: sent.startOffset,
        riskLevel: 'high',
      });
    }

    // 3) bare 第X条 with a nearby law name in same sentence (《》省略 但有"法"字简称)
    if (!matchedStrong) {
      const lawAlias = text.match(/([\u4e00-\u9fa5]{2,20}法)\s*第\s*[一二三四五六七八九十百千万零〇\d]+\s*条/);
      if (lawAlias) {
        // strip any trigger-word prefix that the greedy CJK class may have captured
        const cleanTitle = lawAlias[1].replace(/^(根据|依据|依照|按照|参照|适用|结合|引用)+/, '');
        for (const m of text.matchAll(BARE_ARTICLE_RE)) {
          matchedStrong = true;
          add({
            type: 'statute_article',
            text,
            snippet: lawAlias[0],
            normalizedTarget: { title: cleanTitle, articleNo: normalizeArticleKey(`第${m[1]}条`) },
            answerParagraphIndex: paragraphIndex,
            startOffset: sent.startOffset,
            riskLevel: 'high',
          });
          break;
        }
      }
    }

    // 4) regulatory doc title (no article number)
    if (!matchedStrong) {
      for (const m of text.matchAll(REG_DOC_RE)) {
        matchedStrong = true;
        add({
          type: 'regulatory_doc',
          text,
          snippet: m[0],
          normalizedTarget: { title: m[1] },
          answerParagraphIndex: paragraphIndex,
          startOffset: sent.startOffset,
          riskLevel: 'medium',
        });
      }
    }

    // 5) viewpoint / conclusion / legal_claim / factual_claim via triggers
    //    Skip Markdown headings here — they are structural labels (e.g. "## 二、特别要求"),
    //    not verifiable claims. Strong refs (statute/case/regdoc) above already handle
    //    any genuine citation that happens to sit inside a heading.
    if (!matchedStrong && !sent.isHeading && text.length >= 10 && !isDerivativeConclusion(text, prevSent)) {
      let type = null;
      if (VIEWPOINT_RE.test(text)) type = 'viewpoint';
      else if (CONCLUSION_RE.test(text)) type = 'conclusion';
      else if (/承担|责任|义务|赔偿|侵权|违反|应当|不得|构成/.test(text) && TRIGGER_RE.test(text)) type = 'legal_claim';
      else if (NUMERIC_RE.test(text) && TRIGGER_RE.test(text)) type = 'factual_claim';
      else if (TRIGGER_RE.test(text) && text.length >= 16) type = 'legal_claim';
      if (type) {
        add({
          type,
          text,
          snippet: text,
          normalizedTarget: {},
          answerParagraphIndex: paragraphIndex,
          startOffset: sent.startOffset,
          riskLevel: riskFor(type),
        });
      }
    }
  }

  return points;
}

export function extractVerificationPoints({ taskDir, workspaceRoot = process.cwd(), answerFile = null, claimsFile = null } = {}) {
  const dir = resolveTaskDir(taskDir, workspaceRoot);
  const manifest = loadManifest(dir);
  const answerPath = safeJoin(dir, answerFile || manifest.answerFile || 'answer.md');
  const answerText = readText(answerPath, '');
  if (!answerText.trim()) throw new Error(`answer file is empty or missing: ${answerPath}`);

  // 1) AI semantic declarations (preferred). Look for claims.json in the task dir.
  //    Accept BOTH shapes defensively — the canonical { "claims": [...] } object, AND a bare
  //    top-level array [ ... ]. A bare array used to be silently ignored (claimsData.claims ===
  //    undefined), which dropped every AI declaration and was a primary cause of the all-red
  //    regression. We now coerce it and emit a warning so the caller knows the file was off-spec.
  const warnings = [];
  let claims = [];
  let claimsFileExisted = false;
  const claimsPath = safeJoin(dir, claimsFile || manifest.claimsFile || 'claims.json');
  const claimsText = readText(claimsPath, '');
  let claimsData = null;
  if (claimsText.trim()) {
    claimsFileExisted = true;
    try {
      claimsData = JSON.parse(claimsText);
    } catch (e) {
      throw new Error(`claims.json 格式错误，已阻断核验点抽取：${claimsPath}；${e.message}`);
    }
    if (Array.isArray(claimsData)) {
      claims = claimsData;
      warnings.push('claims.json 顶层是数组，已自动兼容；规范格式应为 {"claims": [...]} 对象');
    } else if (Array.isArray(claimsData.claims)) {
      claims = claimsData.claims;
    } else {
      warnings.push('claims.json 既不是数组也没有 claims 字段，已忽略；请检查格式');
    }
  }
  const sourceAliasMap = buildSourceAliasMap(manifest);
  const displaySourceIdCount = claims.filter((c) => c && typeof c.sourceId === 'string' && /^[scl]\d+$/i.test(c.sourceId.trim())).length;
  if (displaySourceIdCount > 0) {
    warnings.push(`claims.json 使用了 ${displaySourceIdCount} 个展示编号 sourceId（如 S1/s1），已按 manifest.sources 顺序自动映射为真实来源；规范写法仍应使用 sourceTitle 或 12位真实 sourceId`);
  }
  const declaredPoints = pointsFromClaims(claims, answerText, sourceAliasMap);

  // If a claims file was provided but produced ZERO usable declarations, that's almost always a
  // schema/field-name mistake (e.g. sourceIds instead of sourceTitle). Surface it loudly instead
  // of silently degrading to rule-based-only (which makes the whole report 弱关联/待核验).
  if (claimsFileExisted && claims.length > 0 && declaredPoints.length === 0) {
    warnings.push(`claims.json 提供了 ${claims.length} 条，但解析出 0 条有效声明——通常是字段名写错（应为 claimText/sourceTitle/articleNo/caseNo）。所有句子将退化为规则兜底，关联率会异常偏低`);
  }
  if (claimsFileExisted && claims.length === 0 && claimsData != null && !Array.isArray(claimsData) && !Array.isArray(claimsData.claims)) {
    // already warned above
  }

  // 2) Rule-based extraction (fallback / catch-all). Tag declared:false.
  // When AI semantic declarations exist, keep only concrete rule hits (explicit statute/case/doc
  // targets). Do NOT turn broad conclusion/trigger-word sentences into visible weak associations:
  // those are often the user's screenshot case — the previous sentence already cites the law, while
  // the next sentence is merely the analysis/conclusion supported by that citation. Potentially
  // missing legal bases are handled later by repair-export as AI-reviewed candidates, not by adding
  // noisy weak labels to the final report.
  const rawRulePoints = extractPoints(answerText).map((p) => ({ ...p, declared: false }));
  const suppressedSoftRulePoints = declaredPoints.length > 0
    ? rawRulePoints.filter((p) => SOFT_FALLBACK_TYPES.has(p.type) && !hasConcreteTarget(p)).length
    : 0;
  const rulePoints = declaredPoints.length > 0
    ? rawRulePoints.filter((p) => !(SOFT_FALLBACK_TYPES.has(p.type) && !hasConcreteTarget(p)))
    : rawRulePoints;

  // Merge: declared points first; drop rule points that duplicate a declared one on the
  // same answer line + same target title/article (the AI's declaration wins).
  const declaredKeys = new Set(
    declaredPoints.map((p) => `${p.answerParagraphIndex}|${p.normalizedTarget?.title || ''}|${p.normalizedTarget?.articleNo || ''}|${p.normalizedTarget?.caseNo || ''}`),
  );
  const merged = [...declaredPoints];
  for (const rp of rulePoints) {
    const k = `${rp.answerParagraphIndex}|${rp.normalizedTarget?.title || ''}|${rp.normalizedTarget?.articleNo || ''}|${rp.normalizedTarget?.caseNo || ''}`;
    if (declaredKeys.has(k)) continue;
    merged.push(rp);
  }
  // re-sequence pointIds so they're stable and unique
  merged.forEach((p, i) => { p.pointId = `vp-${String(i + 1).padStart(3, '0')}`; });

  const outFile = safeJoin(dir, 'verification', 'verification_points.json');
  const byType = {};
  for (const p of merged) byType[p.type] = (byType[p.type] || 0) + 1;
  writeJson(outFile, { taskId: manifest.taskId, generatedAt: new Date().toISOString(), points: merged });

  return {
    success: true, taskId: manifest.taskId, taskDir: dir,
    totalPoints: merged.length, declared: declaredPoints.length, ruleExtracted: rulePoints.length,
    suppressedSoftRulePoints, byType,
    warnings,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (!args.task) throw new Error('--task <dir> is required');
    const res = extractVerificationPoints({
      taskDir: args.task,
      workspaceRoot: typeof args.root === 'string' ? args.root : process.cwd(),
      answerFile: typeof args.answer === 'string' ? args.answer : null,
      claimsFile: typeof args.claims === 'string' ? args.claims : null,
    });
    printJson(res);
  } catch (e) {
    printJson({ success: false, error: String(e.message || e) });
    process.exit(1);
  }
}
