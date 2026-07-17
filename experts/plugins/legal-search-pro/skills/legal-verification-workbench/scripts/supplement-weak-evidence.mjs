// supplement-weak-evidence.mjs — Second-pass repair for weak/unverified legal evidence.
//
// This script does NOT perform external legal search by itself. It gives the operating AI a
// deterministic loop:
//   1) export weak/unverified points that need supplementary search;
//   2) after the AI searches authoritative sources and writes findings with real content,
//      apply those findings, persist new sources, update claims/answer, rebuild matches + HTML.
//
// Usage:
//   node supplement-weak-evidence.mjs export --task <dir> [--out repair-queue.json]
//   node supplement-weak-evidence.mjs apply  --task <dir> --input supplemental-findings.json [--root <ws>]
//
// Findings format:
// {
//   "findings": [
//     {
//       "pointId": "vp-001",
//       "action": "confirm|correct|wrong_article|hallucination|ignore",
//       "source": { "title":"...", "sourceType":"law", "provider":"pkulaw", "status":"现行有效", "url":"", "content":"第X条 ..." },
//       "sourceTitle": "...", "articleNo": "第X条", "caseNo": "",
//       "correctedText": "修正后的报告原句（需要改稿时必填）",
//       "correctionNote": "为什么修正，例如：原条号写成第13条，补充检索确认应为第14条"
//     }
//   ]
// }

import path from 'node:path';
import {
  parseArgs, printJson, readJson, writeJson, readText, writeText, safeJoin, resolveTaskDir, nowIso,
  normalizeArticleKey,
} from './lib.mjs';
import { persistSources } from './persist-legal-sources.mjs';
import { extractVerificationPoints } from './extract-verification-points.mjs';
import { matchEvidence } from './match-evidence.mjs';
import { generateHtml } from './generate-verification-html.mjs';

function loadTask(taskDir, workspaceRoot) {
  const dir = resolveTaskDir(taskDir, workspaceRoot);
  return {
    dir,
    manifest: readJson(safeJoin(dir, 'manifest.json'), {}),
    points: readJson(safeJoin(dir, 'verification', 'verification_points.json'), { points: [] }).points || [],
    evidence: readJson(safeJoin(dir, 'verification', 'evidence_matches.json'), { matches: [], stats: {} }),
  };
}

function targetOf(point) {
  const t = point.normalizedTarget || {};
  return {
    title: t.title || '',
    articleNo: t.articleNo || '',
    caseNo: t.caseNo || '',
    sourceId: t.sourceId || '',
  };
}

function makeSearchQueries(point, match) {
  const t = targetOf(point);
  const base = [t.title, t.articleNo, t.caseNo, point.text || point.snippet || ''].filter(Boolean).join(' ');
  const qs = [];
  if (base) qs.push(base);
  if (point.text) qs.push(point.text);
  if (t.title && t.articleNo) qs.push(`${t.title} ${t.articleNo}`);
  if (match && match.method === 'article_not_found' && t.title) qs.push(`${t.title} 正确条款 ${point.text || ''}`);
  return [...new Set(qs.map((q) => q.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 4);
}

function normalizeText(t) {
  return String(t || '').replace(/[\s\u3000`*_#|<>\-—，。！？；：、,.!?;:()（）【】\[\]《》]/g, '');
}

function splitAnswerUnits(answerText) {
  const units = [];
  const lines = String(answerText || '').replace(/\r\n?/g, '\n').split('\n');
  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    if (/^#{1,6}\s+/.test(line)) continue;
    if (/^\|?\s*[-:|]+\s*\|?$/.test(line)) continue;
    if (/^\s*```/.test(line)) continue;
    if (line.includes('|')) {
      const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()).filter(Boolean);
      for (const c of cells) units.push(c);
    } else {
      line.split(/(?<=[。！？；])\s*/).map((s) => s.trim()).filter(Boolean).forEach((s) => units.push(s));
    }
  }
  return units;
}

// Do NOT encode one task's examples here. This is only a generic candidate finder.
// The operating AI must make the final semantic judgment: whether this unlinked sentence is
// a legal proposition that should be supplemented with authoritative sources.
const LEGAL_SIGNAL_WORDS = [
  '法', '条例', '办法', '规定', '规则', '标准', '指引', '条',
  '应当', '不得', '必须', '禁止', '可以', '有权', '义务', '责任',
  '同意', '授权', '告知', '通知', '评估', '备案', '审批', '报告', '审计',
  '保存', '删除', '留存', '公开', '提供', '收集', '处理', '使用',
  '安全', '保护', '泄露', '篡改', '丢失', '处罚', '罚款', '赔偿',
  '责令', '整改', '诉讼', '投诉', '举报', '违法', '违规', '合规', '监管',
  '风险', '后果',
];

function legalSignalScore(text) {
  const t = String(text || '');
  let score = 0;
  if (/《[^》]{2,60}》/.test(t)) score += 4;
  if (/第\s*[一二三四五六七八九十百千万零〇\d]+\s*条/.test(t)) score += 4;
  const hits = LEGAL_SIGNAL_WORDS.filter((w) => t.includes(w));
  score += Math.min(6, hits.length);
  if (/(应当|不得|必须|禁止|有权|义务|责任)/.test(t) && /(处理|收集|使用|提供|保存|删除|保护|通知|评估|备案|处罚|赔偿|整改)/.test(t)) score += 3;
  if (/[：:]/.test(t) && /(风险|后果|依据|要求|义务|责任|处罚|措施)/.test(t)) score += 2;
  return score;
}

function hasExplicitLegalReference(text) {
  const t = String(text || '');
  return /《[^》]{2,80}》/.test(t)
    || /第\s*[一二三四五六七八九十百千万零〇\d]+\s*条/.test(t)
    || /[（(]\s*\d{4}\s*[）)][^\s，。；：]{2,40}号/.test(t);
}

function isFollowOnConclusion(text, prevText) {
  const t = String(text || '').trim();
  const prev = String(prevText || '').trim();
  if (!t || !prev || hasExplicitLegalReference(t)) return false;
  const startsAsConclusion = /^(因此|故|所以|据此|由此|可见|这意味着|说明|表明|基于此|在此基础上|从而|相应地|该|上述|前述|此|这|其)/.test(t);
  return startsAsConclusion && hasExplicitLegalReference(prev) && t.length <= 180;
}

function classifyUnlinkedReason(text) {
  const score = legalSignalScore(text);
  if (/《[^》]{2,60}》|第\s*[一二三四五六七八九十百千万零〇\d]+\s*条/.test(text)) {
    return '正文出现法规/条款形式但未关联；请由AI判断是否需要补充检索并建立 claims';
  }
  if (score >= 8) return '正文具有较强法律命题特征但未关联；请由AI补充检索确认依据或修正表述';
  return '正文具有一定法律命题特征但未关联；请由AI复核是否需要补充检索';
}

function isLikelyLegalUnlinked(text) {
  const t = String(text || '').trim();
  if (t.length < 12 || t.length > 220) return false;
  if (/^(序号|条款|核心要求|对本功能的适用|法规名称|效力层级|现行状态)$/.test(t)) return false;
  if (hasExplicitLegalReference(t)) return true;
  // A non-explicit sentence is only a candidate when it has a strong normative/legal-proposition
  // shape. This remains a triage signal only; the operating AI must make the final semantic call.
  return legalSignalScore(t) >= 9
    && /(应当|不得|必须|禁止|有权|义务|责任|违法|违规|处罚|赔偿|责令|整改)/.test(t);
}

function coveredByExistingPoint(text, points) {
  const nt = normalizeText(text);
  if (!nt || nt.length < 8) return true;
  return points.some((p) => {
    const a = normalizeText(p.text || '');
    const b = normalizeText(p.snippet || '');
    return (a && (a.includes(nt) || nt.includes(a))) || (b && (b.includes(nt) || nt.includes(b)));
  });
}

function extractSearchTerms(text) {
  const terms = [];
  const s = String(text || '');
  for (const m of s.matchAll(/《([^》]{2,60})》/g)) terms.push(m[1]);
  for (const m of s.matchAll(/第\s*[一二三四五六七八九十百千万零〇\d]+\s*条/g)) terms.push(m[0].replace(/\s+/g, ''));
  for (const m of s.matchAll(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}/g)) {
    const w = m[0];
    if (/^(本|该|此|相关|进行|可以|需要|应当|不得|必须|以及|或者|如果|因此|对于)$/.test(w)) continue;
    if (LEGAL_SIGNAL_WORDS.some((sig) => w.includes(sig) || sig.includes(w)) || w.length >= 4) terms.push(w);
  }
  return [...new Set(terms)].slice(0, 10);
}

function makeUnlinkedSearchQueries(text, manifest) {
  const terms = extractSearchTerms(text);
  const qs = [text];
  const law = text.match(/《([^》]{2,60})》/);
  const art = text.match(/第\s*[一二三四五六七八九十百千万零〇\d]+\s*条/);
  if (law && art) qs.push(`${law[1]} ${art[0].replace(/\s+/g, '')}`);
  if (manifest.query && terms.length) qs.push(`${manifest.query} ${terms.slice(0, 6).join(' ')}`);
  if (terms.length) qs.push(terms.join(' '));
  return [...new Set(qs.map((q) => q.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 5);
}

function findUnlinkedLegalItems({ dir, manifest, points }) {
  const answer = readText(safeJoin(dir, 'answer.md'), '');
  const units = splitAnswerUnits(answer);
  const seen = new Set();
  const items = [];
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const prevUnit = i > 0 ? units[i - 1] : '';
    const text = unit.replace(/^[-*+\d.\s]+/, '').trim();
    const prevText = String(prevUnit || '').replace(/^[-*+\d.\s]+/, '').trim();
    const key = normalizeText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (isFollowOnConclusion(text, prevText)) continue;
    if (!isLikelyLegalUnlinked(text)) continue;
    if (coveredByExistingPoint(text, points)) continue;
    const idx = items.length + 1;
    items.push({
      pointId: `unlinked-${String(idx).padStart(3, '0')}`,
      label: 'unlinked',
      method: 'unlinked_legal_content_detected',
      type: 'supplemental_legal_claim',
      text,
      snippet: text,
      declaredTarget: { title: '', articleNo: '', caseNo: '', sourceId: '' },
      currentNote: classifyUnlinkedReason(text),
      requiresAiReview: true,
      aiReviewInstruction: '脚本只做候选分流，不决定补充关联。请AI按语义复核：只有该句独立提出新的法规条款、监管义务、权利义务边界或法律后果，且当前没有可点击来源时，才补充检索；若只是前一句已关联法规后的解释、推论、总结或重复内容，应 action=ignore，不得补成弱关联。',
      currentCitations: [],
      candidates: [],
      searchQueries: makeUnlinkedSearchQueries(text, manifest),
      expectedFinding: {
        action: 'confirm|correct|wrong_article|hallucination|ignore',
        oldText: text,
        source: { title: '', sourceType: 'law|case|regulation|web|user', provider: 'pkulaw|official|web|user', status: '现行有效|已修订|已废止|不完整|未核验', url: '', content: '补充检索取得的真实法条/案例/规范原文' },
        sourceTitle: '',
        articleNo: '',
        correctedText: '',
        correctionNote: '',
      },
    });
  }
  return items;
}

export function exportSupplementQueue({ taskDir, workspaceRoot = process.cwd(), out = '' } = {}) {
  const { dir, manifest, points, evidence } = loadTask(taskDir, workspaceRoot);
  const byPoint = Object.fromEntries(points.map((p) => [p.pointId, p]));
  const linkedItems = (evidence.matches || [])
    .filter((m) => m.label === 'weak' || m.label === 'unverified')
    .map((m) => {
      const p = byPoint[m.pointId] || {};
      const t = targetOf(p);
      return {
        pointId: m.pointId,
        label: m.label,
        method: m.method,
        type: m.type,
        text: p.text || m.text || '',
        snippet: p.snippet || m.snippet || '',
        declaredTarget: t,
        currentNote: m.note || '',
        requiresAiReview: true,
        aiReviewInstruction: m.method === 'similarity_suggestion'
          ? '这是系统相似度推荐形成的弱关联，不是回答明确声明的依据。请AI判断它是否确实需要独立补检；若只是前文法规后的结论/解释或低价值重复，应 action=ignore。'
          : '请AI补检声明来源/条号是否真实存在。能确认则 confirm；条号或表述错则 correct/wrong_article；查无依据则 hallucination 并修正文稿。',
        currentCitations: m.citations || [],
        candidates: m.candidates || [],
        searchQueries: makeSearchQueries(p, m),
        expectedFinding: {
          action: 'confirm|correct|wrong_article|hallucination|ignore',
          oldText: p.text || m.text || '',
          source: { title: t.title || '', sourceType: 'law|case|regulation|web|user', provider: 'pkulaw|official|web|user', status: '现行有效|已修订|已废止|不完整|未核验', url: '', content: '补充检索取得的真实法条/案例/规范原文' },
          sourceTitle: t.title || '',
          articleNo: t.articleNo || '',
          correctedText: '',
          correctionNote: '',
        },
      };
    });
  const unlinkedItems = findUnlinkedLegalItems({ dir, manifest, points });
  const items = [...linkedItems, ...unlinkedItems];
  const payload = {
    taskId: manifest.taskId || path.basename(dir),
    query: manifest.query || '',
    generatedAt: nowIso(),
    purpose: '对首轮 weak/unverified 核验点，以及正文中可能遗漏关联的法律命题进行二次语义复核。补检不是把候选变成弱关联：原句正确且补到真实依据则 action=confirm 并升级已关联；原句/条号错误则 action=correct/wrong_article/hallucination 改正文并标“已修正”；只是前文依据后的解释/结论/重复内容则 action=ignore。',
    reviewPrinciples: [
      '只对“独立提出新的法规条款、监管义务、权利义务边界、法律后果”的句子补检。',
      '前一句已关联法规，后一句只是分析结论、适用判断或风险提示的，不应作为新的补检项。',
      '补检结果应闭环为 confirm/correct/wrong_article/hallucination/ignore；最终报告不应因补检新增一批弱关联。',
    ],
    counts: { weakOrUnverified: linkedItems.length, unlinkedLegalContent: unlinkedItems.length, total: items.length },
    items,
  };
  const outPath = out ? safeJoin(dir, out) : safeJoin(dir, 'verification', 'supplemental-search-queue.json');
  writeJson(outPath, payload);
  return { success: true, taskId: payload.taskId, taskDir: dir, outPath, count: items.length };
}

function loadClaims(file) {
  const raw = readJson(file, { claims: [] });
  if (Array.isArray(raw)) return { claims: raw };
  if (raw && Array.isArray(raw.claims)) return raw;
  return { claims: [] };
}

function sameClaim(a, b) {
  return String(a || '').replace(/\s+/g, '') === String(b || '').replace(/\s+/g, '');
}

function normalizeFinding(f = {}) {
  const claim = f.claim && typeof f.claim === 'object' ? f.claim : {};
  return {
    ...f,
    sourceTitle: f.sourceTitle || claim.sourceTitle || (f.source && f.source.title) || '',
    sourceId: f.sourceId || claim.sourceId || '',
    articleNo: normalizeArticleKey(f.articleNo || claim.articleNo || '') || f.articleNo || claim.articleNo || '',
    caseNo: f.caseNo || claim.caseNo || '',
    claimText: f.oldText || claim.claimText || f.claimText || '',
  };
}

function addOrUpdateClaim(claimsObj, claimText, finding) {
  if (!claimText) return;
  const nf = normalizeFinding(finding);
  const title = nf.sourceTitle || '';
  const articleNo = nf.articleNo || '';
  const caseNo = nf.caseNo || '';
  if (!title && !nf.sourceId && !articleNo && !caseNo) return;
  const idx = claimsObj.claims.findIndex((c) => sameClaim(c.claimText || c.text || c.claim, claimText));
  const next = {
    claimText,
    ...(nf.sourceId ? { sourceId: nf.sourceId } : {}),
    ...(title ? { sourceTitle: title } : {}),
    ...(articleNo ? { articleNo } : {}),
    ...(caseNo ? { caseNo } : {}),
  };
  if (idx >= 0) claimsObj.claims[idx] = { ...claimsObj.claims[idx], ...next };
  else claimsObj.claims.push(next);
}

function replaceOnce(text, needles, replacement) {
  for (const n of needles) {
    const needle = String(n || '').trim();
    if (!needle) continue;
    const pos = text.indexOf(needle);
    if (pos >= 0) return { text: text.slice(0, pos) + replacement + text.slice(pos + needle.length), matched: needle };
  }
  return { text, matched: '' };
}

export function applySupplementFindings({ taskDir, input, workspaceRoot = process.cwd() } = {}) {
  if (!input) throw new Error('apply requires --input supplemental-findings.json');
  const { dir, points } = loadTask(taskDir, workspaceRoot);
  const payload = readJson(input, null);
  const findings = payload && Array.isArray(payload.findings) ? payload.findings : [];
  if (!findings.length) throw new Error('supplemental findings is empty: expected {"findings":[...]}');

  const pointById = Object.fromEntries(points.map((p) => [p.pointId, p]));
  const newSources = findings.map((f) => f.source).filter(Boolean);
  let persistRes = null;
  if (newSources.length) {
    persistRes = persistSources({ sources: newSources }, { taskDir: dir, workspaceRoot, strictContent: true });
  }

  const answerFile = safeJoin(dir, 'answer.md');
  const claimsFile = safeJoin(dir, 'claims.json');
  let answer = readText(answerFile, '');
  const claimsObj = loadClaims(claimsFile);
  const suppressedFile = safeJoin(dir, 'verification', 'suppressed-points.json');
  const suppressedObj = readJson(suppressedFile, { ignored: [] });
  if (!Array.isArray(suppressedObj.ignored)) suppressedObj.ignored = [];
  const corrections = [];
  const warnings = [];

  for (const rawFinding of findings) {
    const f = normalizeFinding(rawFinding);
    const action = String(f.action || '').trim();
    const p = pointById[f.pointId] || {};
    const original = f.claimText || f.oldText || p.text || p.snippet || '';
    const note = f.correctionNote || '';
    if (!action) continue;
    if (action === 'ignore') {
      if (f.pointId || original) {
        suppressedObj.ignored.push({ pointId: f.pointId || '', text: original, reason: note || 'AI语义复核认为无需独立补充关联', ignoredAt: nowIso() });
      }
      continue;
    }

    if (action === 'confirm') {
      addOrUpdateClaim(claimsObj, original, f);
      continue;
    }

    if (['correct', 'wrong_article', 'hallucination'].includes(action)) {
      if (!f.correctedText) {
        warnings.push(`${f.pointId || original}: action=${action} 但缺 correctedText，未改写正文`);
        continue;
      }
      const marker = note ? `（已修正：${note}）` : '（已修正）';
      const replacement = f.correctedText.includes('已修正') ? f.correctedText : `${f.correctedText}${marker}`;
      const r = replaceOnce(answer, [original, p.snippet, p.text], replacement);
      answer = r.text;
      if (!r.matched) warnings.push(`${f.pointId || original}: 未在 answer.md 中找到原文，未能自动替换`);
      else corrections.push({ pointId: f.pointId, oldText: r.matched, correctedText: replacement, action, sourceTitle: f.sourceTitle || (f.source && f.source.title) || '', articleNo: f.articleNo || '', correctionNote: note, correctedAt: nowIso() });
      addOrUpdateClaim(claimsObj, f.correctedText, f);
    }
  }

  writeText(answerFile, answer);
  writeJson(claimsFile, claimsObj);
  writeJson(suppressedFile, { ignored: suppressedObj.ignored });
  writeJson(safeJoin(dir, 'verification', 'supplemental-findings.applied.json'), { appliedAt: nowIso(), findings, warnings });
  writeJson(safeJoin(dir, 'verification', 'corrections.json'), { corrections });

  const ex = extractVerificationPoints({ taskDir: dir, workspaceRoot });
  const mt = matchEvidence({ taskDir: dir, workspaceRoot });
  const html = generateHtml({ taskDir: dir, workspaceRoot });
  return { success: true, taskDir: dir, persistedSources: persistRes ? persistRes.saved.length : 0, corrections: corrections.length, warnings, declared: ex.declared, stats: mt.stats, htmlPath: html.htmlPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));
  try {
    if (!args.task) throw new Error('--task <dir> is required');
    const workspaceRoot = typeof args.root === 'string' ? args.root : process.cwd();
    if (cmd === 'export') {
      printJson(exportSupplementQueue({ taskDir: args.task, workspaceRoot, out: typeof args.out === 'string' ? args.out : '' }));
    } else if (cmd === 'apply') {
      printJson(applySupplementFindings({ taskDir: args.task, input: args.input, workspaceRoot }));
    } else {
      throw new Error('Unknown command. Use export|apply');
    }
  } catch (e) {
    printJson({ success: false, error: String(e.message || e) });
    process.exit(1);
  }
}
