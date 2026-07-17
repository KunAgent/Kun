// match-evidence.mjs — Anchor each verification point to its source paragraph(s).
//
// ⚠️ DESIGN SHIFT (v2): This is a *traceability* helper, NOT a correctness judge.
//   The old version tried to decide whether the AI's wording was "correct" by doing
//   literal text matching, then stamped a value-judgement verdict ("已验证/verified").
//   That was wrong on two counts:
//     1) The verifier is itself run by an AI/script — a green "verified" badge lulls the
//        user into trusting it blindly; if the verifier errs, the user is harmed.
//     2) A good legal opinion *summarizes* statutes; it never copies article text verbatim,
//        so literal matching marks everything "unmatched" and the report becomes useless.
//
//   New model — anchor, don't judge:
//     • The AI *declares* (in claims.json) which source + article each sentence relies on
//       (semantic association decided by the AI when it writes the opinion).
//     • This script only verifies that the *declared source/article actually exists* in the
//       persisted library (anti-fabrication), then anchors it to the real paragraph so the
//       user can click through and judge for themselves.
//     • Similarity is demoted to a *candidate finder* (suggests paragraphs to look at). It
//       NEVER produces a correctness verdict.
//
// Association labels (objective, no value judgement):
//   associated  (蓝/已关联)  — AI declared a basis AND that source/article truly exists →
//                              click to read the original; user judges relevance.
//   weak        (黄/弱关联)  — semantically related source surfaced, but it's not a declared
//                              direct basis, OR the article number couldn't be confirmed →
//                              please double-check.
//   unverified  (灰/待核验)  — no traceable basis provided; verify it yourself. NOT "wrong".
//
// Usage: node match-evidence.mjs --task <dir>
// Writes verification/evidence_matches.json and verification/citations.json

import path from 'node:path';
import {
  parseArgs, printJson, readJson, writeJson, readJsonl, loadManifest, safeJoin,
  resolveTaskDir, lawTitleSimilarity, bigramJaccard, keywordOverlap, sharedPhraseBonus, normalizeLawTitle,
  normalizeArticleKey,
} from './lib.mjs';

// Similarity is only used to *suggest candidates*, never to decide correctness.
const RELATED_FLOOR = 0.18; // below this, a similarity candidate isn't worth surfacing

function loadIndexes(dir) {
  const indexDir = safeJoin(dir, 'index');
  return {
    paragraphs: readJsonl(safeJoin(indexDir, 'paragraphs.jsonl')),
    articleIndex: readJson(safeJoin(indexDir, 'article_index.json'), {}),
    sourceIndex: readJson(safeJoin(indexDir, 'source_index.json'), {}),
  };
}

function paragraphByRef(paragraphs, sourceId, pid) {
  const idx = parseInt(String(pid).replace(/^P/, ''), 10);
  return paragraphs.find((p) => p.sourceId === sourceId && p.paragraphIndex === idx) || null;
}

/** Resolve a declared/extracted source reference (by id or by title) to a sourceId. */
function resolveSource(ref, idx) {
  if (!ref) return { sourceId: null, titleSim: 0 };
  // direct id hit
  if (ref.sourceId && idx.sourceIndex[ref.sourceId]) {
    return { sourceId: ref.sourceId, titleSim: 1 };
  }
  // by title alias similarity
  let best = null;
  let bestSim = 0;
  for (const [sourceId, info] of Object.entries(idx.sourceIndex)) {
    const sim = lawTitleSimilarity(ref.title, info.title);
    if (sim > bestSim) {
      bestSim = sim;
      best = sourceId;
    }
  }
  if (best && bestSim >= 0.6) return { sourceId: best, titleSim: bestSim };
  return { sourceId: null, titleSim: bestSim };
}

/** Look up an article number inside a resolved source. Returns paragraph ids or null. */
function lookupArticle(sourceId, articleNo, idx) {
  const srcArticles = idx.articleIndex[sourceId];
  if (!srcArticles || !articleNo) return null;
  const normalized = normalizeArticleKey(articleNo) || articleNo;
  for (const articles of Object.values(srcArticles)) {
    if (articles[normalized]) return articles[normalized];
    if (articles[articleNo]) return articles[articleNo];
  }
  return null;
}

function normalizeSuppressionText(text) {
  return String(text || '').replace(/[\s\u3000`*_#|<>\-—，。！？；：、,.!?;:()（）【】\[\]《》]/g, '');
}

function loadSuppressedPoints(dir) {
  const raw = readJson(safeJoin(dir, 'verification', 'suppressed-points.json'), { ignored: [] });
  const ignored = Array.isArray(raw.ignored) ? raw.ignored : [];
  const ids = new Set(ignored.map((x) => x.pointId).filter(Boolean));
  const texts = new Set(ignored.map((x) => normalizeSuppressionText(x.text || x.oldText || '')).filter((x) => x.length >= 8));
  return { ids, texts };
}

function isSuppressed(point, suppressed) {
  if (!point || !suppressed) return false;
  if (suppressed.ids.has(point.pointId)) return true;
  const textKey = normalizeSuppressionText(point.text || point.snippet || '');
  return textKey.length >= 8 && suppressed.texts.has(textKey);
}

/**
 * Anchor a point that carries a target (declared by AI, or extracted by rule) which names
 * a source — and optionally an article number. We confirm EXISTENCE, never correctness.
 *
 * Returns { citation, label, note } where label ∈ associated|weak|unverified.
 */
function anchorByDeclaredTarget(target, idx) {
  const { sourceId, titleSim } = resolveSource(target, idx);
  if (!sourceId) {
    return {
      citation: null,
      label: 'unverified',
      note: target.title
        ? `回答声明的依据「${target.title}」未在本次已检索资料中找到，请自行核验来源`
        : '',
    };
  }
  const info = idx.sourceIndex[sourceId];

  // If an article number is declared, confirm the article truly exists in that source.
  if (target.articleNo) {
    const pids = lookupArticle(sourceId, target.articleNo, idx);
    if (!pids || !pids.length) {
      // Source exists, but this article does NOT — never bind to a neighbour.
      return {
        citation: {
          sourceId,
          sourceTitle: info.title,
          paragraphIds: [],
          paragraphRange: '',
          quotedText: '',
          method: 'article_not_found',
          reason: `已定位到《${info.title}》，但本次资料中查无「${target.articleNo}」，未做近似绑定`,
        },
        label: 'weak',
        note: '来源已找到，但声明的条文号在本次资料中不存在，请核对条号后自行查证',
      };
    }
    const paras = pids.map((pid) => paragraphByRef(idx.paragraphs, sourceId, pid)).filter(Boolean);
    return {
      citation: {
        sourceId,
        sourceTitle: info.title,
        paragraphIds: pids.map((p) => `${sourceId}:${p}`),
        paragraphRange: pids.join(','),
        quotedText: paras.map((p) => `[P${p.paragraphIndex}] ${p.text}`).join('\n\n'),
        method: 'declared_article_exists',
        reason: `回答声明依据《${info.title}》${target.articleNo}，该条文在本次资料中存在，点击查看原文自行核验`,
      },
      label: info.status === '不完整' ? 'weak' : 'associated',
      note: info.status === '不完整' ? '来源内容不完整，命中后仍需人工复核' : '',
    };
  }

  // No article number — bind to the most topically-overlapping paragraph of that source.
  const paras = idx.paragraphs.filter((p) => p.sourceId === sourceId);
  if (!paras.length) {
    // Source title matched, but it has NO retrievable paragraph (content was never persisted).
    // A blue "associated" badge promises "click to read the original" — but there is nothing to
    // read. Never emit a hollow blue: downgrade to weak so the user is told to verify the source
    // themselves. (This is the dominant cause of misleadingly-blue rows when sources lack content.)
    return {
      citation: {
        sourceId, sourceTitle: info.title, paragraphIds: [], paragraphRange: '',
        quotedText: '', method: 'declared_source_no_content',
        reason: `回答声明依据《${info.title}》，该来源已登记但本次资料中没有可溯源的正文段落（未带 content），无法展示原文`,
      },
      label: 'weak',
      note: '来源已登记但缺正文，无法点击溯源，请自行核验该来源原文',
    };
  }
  let best = paras[0];
  let bestPs = -1;
  for (const p of paras) {
    const ps = sharedPhraseBonus(target.claimText || target.title, p.text) + bigramJaccard(target.claimText || '', p.text);
    if (ps > bestPs) { bestPs = ps; best = p; }
  }
  return {
    citation: {
      sourceId,
      sourceTitle: info.title,
      paragraphIds: [`${sourceId}:P${best.paragraphIndex}`],
      paragraphRange: `P${best.paragraphIndex}`,
      quotedText: `[P${best.paragraphIndex}] ${best.text}`,
      method: 'declared_source_exists',
      reason: `回答声明依据《${info.title}》，定位到相关段落，点击查看原文自行核验`,
    },
    label: info.status === '不完整' ? 'weak' : 'associated',
    note: info.status === '不完整' ? '来源内容不完整，命中后仍需人工复核' : '',
  };
}

/** Case number existence check. Returns same shape as anchorByDeclaredTarget. */
function anchorByCaseNo(caseNo, idx) {
  const norm = (s) => String(s || '').replace(/[（(]/g, '(').replace(/[）)]/g, ')').replace(/\s/g, '');
  const want = norm(caseNo);
  for (const [sourceId, info] of Object.entries(idx.sourceIndex)) {
    if (info.caseNo && norm(info.caseNo) === want) {
      const paras = idx.paragraphs.filter((p) => p.sourceId === sourceId);
      const hit = paras.find((p) => norm(p.text).includes(want)) || paras[0];
      return {
        citation: {
          sourceId, sourceTitle: info.title,
          paragraphIds: hit ? [`${sourceId}:P${hit.paragraphIndex}`] : [],
          paragraphRange: hit ? `P${hit.paragraphIndex}` : '',
          quotedText: hit ? `[P${hit.paragraphIndex}] ${hit.text}` : '',
          method: 'case_no_exists',
          reason: `案号「${caseNo}」与已入库案例来源一致，点击查看`,
        },
        label: info.status === '不完整' ? 'weak' : 'associated',
        note: '',
      };
    }
  }
  for (const p of idx.paragraphs) {
    if (norm(p.text).includes(want)) {
      const info = idx.sourceIndex[p.sourceId] || {};
      return {
        citation: {
          sourceId: p.sourceId, sourceTitle: info.title || p.title,
          paragraphIds: [`${p.sourceId}:P${p.paragraphIndex}`],
          paragraphRange: `P${p.paragraphIndex}`,
          quotedText: `[P${p.paragraphIndex}] ${p.text}`,
          method: 'case_no_in_text',
          reason: `案号「${caseNo}」在来源段落中出现，点击查看`,
        },
        label: 'associated',
        note: '',
      };
    }
  }
  return { citation: null, label: 'unverified', note: `案号「${caseNo}」未在本次资料中找到，请自行核验` };
}

/** Similarity candidates — only to SUGGEST paragraphs to look at, never to judge. */
function similarityCandidates(point, idx, topN = 6) {
  const claim = point.text || '';
  const targetTitle = point.normalizedTarget?.title;
  const scored = idx.paragraphs.map((p) => {
    const info = idx.sourceIndex[p.sourceId] || {};
    let s =
      bigramJaccard(claim, p.text) * 0.55 +
      keywordOverlap(claim, p.text) * 0.25 +
      sharedPhraseBonus(claim, p.text);
    if (targetTitle && lawTitleSimilarity(targetTitle, info.title) > 0.7) s += 0.15;
    if (point.type === 'case_ref' && p.sourceType === 'case') s += 0.08;
    if (point.type === 'statute_article' && p.sourceType === 'law') s += 0.05;
    if (info.status === '现行有效') s += 0.03;
    if (info.status === '已废止') s -= 0.1;
    if (info.status === '不完整') s -= 0.05;
    return { p, info, score: Math.min(1, s) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).filter((c) => c.score > RELATED_FLOOR);
}

export function matchEvidence({ taskDir, workspaceRoot = process.cwd() } = {}) {
  const dir = resolveTaskDir(taskDir, workspaceRoot);
  const manifest = loadManifest(dir);
  const idx = loadIndexes(dir);
  const vp = readJson(safeJoin(dir, 'verification', 'verification_points.json'), { points: [] });
  const suppressed = loadSuppressedPoints(dir);

  const matches = [];
  const citations = [];
  let citeSeq = 0;
  // stats keys reflect the new objective labels; keep statute/caseHits for the header.
  const stats = { points: 0, associated: 0, weak: 0, unverified: 0, statuteHits: 0, caseHits: 0 };

  for (const point of vp.points) {
    if (isSuppressed(point, suppressed)) continue;
    stats.points++;
    let citation = null;
    let label = 'unverified';
    let note = '';
    const target = point.normalizedTarget || {};
    target.claimText = point.text;

    // ---- Step 1: anchor by what the answer DECLARES (or what rules extracted) ----
    if (point.type === 'case_ref' && target.caseNo) {
      const r = anchorByCaseNo(target.caseNo, idx);
      citation = r.citation; label = r.label; note = r.note;
    } else if (target.title || target.sourceId) {
      // statute_article / regulatory_doc / any declared-source claim
      const r = anchorByDeclaredTarget(target, idx);
      citation = r.citation; label = r.label; note = r.note;
    }

    // ---- Step 2: if nothing declared/anchored, surface a similarity candidate as 弱关联 ----
    // This is a *reading suggestion*, explicitly labelled weak — never an "association" claim.
    let candidates = [];
    if (!citation || (label === 'unverified' && !target.title && !target.caseNo)) {
      candidates = similarityCandidates(point, idx);
      if (candidates.length) {
        const top = candidates[0];
        citation = {
          sourceId: top.p.sourceId,
          sourceTitle: top.info.title || top.p.title,
          paragraphIds: [`${top.p.sourceId}:P${top.p.paragraphIndex}`],
          paragraphRange: `P${top.p.paragraphIndex}`,
          quotedText: `[P${top.p.paragraphIndex}] ${top.p.text}`,
          method: 'similarity_suggestion',
          reason: `系统按语义相关度推荐的可能相关来源（非回答声明的直接依据），请点击核验是否相关`,
        };
        label = 'weak';
        note = note || '此为系统推荐的语义相关段落，并非回答明确声明的依据，请自行判断关联性';
      }
    }

    // attach extra candidates (for the user / optional AI re-check) when present
    const candList = candidates.length
      ? candidates.slice(0, 5).map((c) => ({
          paragraphId: `${c.p.sourceId}:P${c.p.paragraphIndex}`,
          sourceTitle: c.info.title || c.p.title,
          score: Number(c.score.toFixed(3)),
          preview: c.p.text.slice(0, 80),
        }))
      : [];

    // ---- tally ----
    if (label === 'associated') stats.associated++;
    else if (label === 'weak') stats.weak++;
    else stats.unverified++;
    if (label !== 'unverified' && point.type === 'statute_article') stats.statuteHits++;
    if (label !== 'unverified' && point.type === 'case_ref') stats.caseHits++;

    const citeList = [];
    if (citation && citation.paragraphIds && citation.paragraphIds.length) {
      citeSeq++;
      const cite = {
        citationId: `cite-${String(citeSeq).padStart(3, '0')}`,
        pointId: point.pointId,
        sourceId: citation.sourceId,
        sourceTitle: citation.sourceTitle,
        paragraphIds: citation.paragraphIds,
        paragraphRange: citation.paragraphRange,
        quotedText: citation.quotedText,
        reason: citation.reason,
        method: citation.method,
      };
      citations.push(cite);
      citeList.push({ ...cite });
    } else if (citation) {
      // source/case found but no concrete paragraph (e.g. article_not_found) — still show context
      citeList.push({
        citationId: null,
        pointId: point.pointId,
        sourceId: citation.sourceId,
        sourceTitle: citation.sourceTitle,
        paragraphIds: [],
        paragraphRange: '',
        quotedText: '',
        reason: citation.reason,
        method: citation.method,
      });
    }

    matches.push({
      pointId: point.pointId,
      type: point.type,
      text: point.text,
      snippet: point.snippet,
      answerParagraphIndex: point.answerParagraphIndex,
      label,                       // associated | weak | unverified
      method: citation ? citation.method : 'none',
      riskLevel: point.riskLevel,
      note,
      citations: citeList,
      candidates: candList,        // reading suggestions, never a verdict
    });
  }

  writeJson(safeJoin(dir, 'verification', 'evidence_matches.json'), { taskId: manifest.taskId, stats, matches });
  writeJson(safeJoin(dir, 'verification', 'citations.json'), { taskId: manifest.taskId, citations });

  return { success: true, taskId: manifest.taskId, taskDir: dir, stats };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (!args.task) throw new Error('--task <dir> is required');
    const res = matchEvidence({ taskDir: args.task, workspaceRoot: typeof args.root === 'string' ? args.root : process.cwd() });
    printJson(res);
  } catch (e) {
    printJson({ success: false, error: String(e.message || e) });
    process.exit(1);
  }
}
