// audit-source-completeness.mjs — Detect missing/truncated retrieval sources before delivery.
//
// This audit closes the gap where a search tool returns only observation/snippet fragments:
// raw retrieval batches may have titles/URLs/snippets, while the citable paragraph library lacks
// full text. The audit exports a queue telling the operating AI which pages/documents must be
// fetched/read in full and captured again before the HTML report is deliverable.
//
// Usage:
//   node audit-source-completeness.mjs --task <dir> [--out verification/source-fulltext-queue.json]

import path from 'node:path';
import {
  parseArgs, printJson, readJson, writeJson, safeJoin, resolveTaskDir, loadManifest, nowIso,
} from './lib.mjs';

const DEFAULT_OUT = 'verification/source-fulltext-queue.json';
const MIN_LEGAL_SOURCE_CHARS = 300;

function textLen(s) {
  return String(s || '').replace(/\s+/g, '').length;
}

function contentFromSourceJson(data) {
  if (!data || !Array.isArray(data.paragraphs)) return '';
  return data.paragraphs.map((p) => p.text || '').filter(Boolean).join('\n\n');
}

function isLegalishSource(entry = {}) {
  const t = `${entry.title || ''} ${entry.sourceType || ''}`;
  return /(law|case|regulation)|法|条例|办法|规定|解释|通知|意见|标准|裁定|判决|案号|号/.test(t);
}

function hasTruncationMarker(text) {
  return /(\.\.\.|…|\.\.\.\s*$|待续|节选|摘录|摘要|snippet|summary|仅供参考|更多内容|展开全文|查看全部|阅读全文)/i.test(String(text || ''));
}

function searchQueriesFor(item = {}, manifest = {}) {
  const title = item.title || item.name || item.lawName || item.caseName || '';
  const url = item.url || item.link || item.sourceUrl || '';
  const snippet = item.snippet || item.summary || item.abstract || item.description || '';
  const queries = [];
  if (title) queries.push(title);
  if (title && manifest.query) queries.push(`${manifest.query} ${title}`);
  if (snippet) queries.push(`${title} ${String(snippet).slice(0, 120)}`.trim());
  if (url) queries.push(url);
  return [...new Set(queries.map((q) => q.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 5);
}

function issueKey(issue) {
  return [issue.kind, issue.title || '', issue.url || '', issue.sourceId || '', issue.rawFile || '', issue.rawIndex || ''].join('|');
}

export function auditSourceCompleteness({ taskDir, workspaceRoot = process.cwd(), out = DEFAULT_OUT } = {}) {
  const dir = resolveTaskDir(taskDir, workspaceRoot);
  const manifest = loadManifest(dir);
  const issues = [];

  // 1) Raw retrieval batches: missing full body text must be fetched/read before it can become citable.
  for (const batch of Array.isArray(manifest.retrievalBatches) ? manifest.retrievalBatches : []) {
    const rawRel = batch.rawFile || '';
    if (!rawRel) continue;
    const raw = readJson(safeJoin(dir, rawRel), null);
    const items = raw && Array.isArray(raw.items) ? raw.items : [];
    for (const item of items) {
      const hasContent = textLen(item.content) > 0;
      const url = item.url || (item.raw && (item.raw.url || item.raw.link || item.raw.sourceUrl)) || '';
      const title = item.title || (item.raw && (item.raw.title || item.raw.name || item.raw.lawName || item.raw.caseName)) || '未命名检索结果';
      if (!hasContent) {
        issues.push({
          kind: 'fetch_full_text',
          severity: 'blocker',
          reason: '检索批次中只有标题/摘要/URL，未取得可段落化正文；该结果不能支撑核验引用',
          batchId: batch.batchId || raw.batchId || '',
          rawFile: rawRel,
          rawIndex: item.rawIndex || '',
          title,
          url,
          snippet: item.snippet || '',
          provider: item.provider || batch.tool || '',
          sourceType: item.sourceType || 'web',
          searchQueries: searchQueriesFor(item, manifest),
          expectedAction: '使用 WebFetch/官方库/MCP detail 工具读取全文后，再运行 legal-verify capture --task <taskDir> --input <fulltext-batch.json>',
        });
      } else if (item.usedSnippetAsContent) {
        issues.push({
          kind: 'snippet_used_as_content',
          severity: 'blocker',
          reason: '本条曾以摘要降级入库，必须补取全文，否则容易造成应有关联依据缺失',
          batchId: batch.batchId || raw.batchId || '',
          rawFile: rawRel,
          rawIndex: item.rawIndex || '',
          title,
          url,
          snippet: item.snippet || '',
          provider: item.provider || batch.tool || '',
          sourceType: item.sourceType || 'web',
          searchQueries: searchQueriesFor(item, manifest),
          expectedAction: '补取全文并重新 capture；除非人工确认摘要就是唯一来源，否则不得最终交付',
        });
      }
    }
  }

  // 2) Citable sources: no paragraphs, incomplete status, or obvious truncation markers.
  for (const entry of Array.isArray(manifest.sources) ? manifest.sources : []) {
    const data = readJson(safeJoin(dir, 'sources', `${entry.sourceId}.json`), null);
    const content = contentFromSourceJson(data);
    const clen = textLen(content);
    const legalish = isLegalishSource(entry);
    if (!data || !Array.isArray(data.paragraphs) || data.paragraphs.length === 0) {
      issues.push({
        kind: 'source_has_no_paragraphs',
        severity: 'blocker',
        reason: '来源已登记但没有可点击段落，无法作为核验依据',
        sourceId: entry.sourceId,
        title: entry.title,
        url: entry.url || '',
        provider: entry.provider || '',
        sourceType: entry.sourceType || '',
        searchQueries: searchQueriesFor(entry, manifest),
        expectedAction: '重新读取该来源全文并 persist/capture',
      });
      continue;
    }
    if (data.metadata && data.metadata.possiblePartialContent) {
      issues.push({
        kind: 'possible_partial_content_flag',
        severity: 'blocker',
        reason: '捕获时检测到疑似截断/摘要/展开全文标记，必须补取完整正文',
        sourceId: entry.sourceId,
        title: entry.title,
        url: entry.url || '',
        provider: entry.provider || '',
        sourceType: entry.sourceType || '',
        paragraphCount: data.paragraphs.length,
        charLength: clen,
        searchQueries: searchQueriesFor(entry, manifest),
        expectedAction: '重新读取官方全文或数据库详情页并再次入库',
      });
    }
    if (entry.status === '不完整') {
      issues.push({
        kind: 'source_marked_incomplete',
        severity: 'blocker',
        reason: '来源状态为不完整，命中后仍无法安全交付',
        sourceId: entry.sourceId,
        title: entry.title,
        url: entry.url || '',
        provider: entry.provider || '',
        sourceType: entry.sourceType || '',
        paragraphCount: data.paragraphs.length,
        charLength: clen,
        searchQueries: searchQueriesFor(entry, manifest),
        expectedAction: '补取完整正文后重新入库，或在 findings 中明确 ignore/修正相关观点',
      });
    } else if (legalish && clen > 0 && clen < MIN_LEGAL_SOURCE_CHARS) {
      issues.push({
        kind: 'possible_truncated_legal_source',
        severity: 'review',
        reason: `法律/案例/规范来源正文较短（${clen} 字），可能只是工具 observation 片段；请复核是否已获取全文或完整条文`,
        sourceId: entry.sourceId,
        title: entry.title,
        url: entry.url || '',
        provider: entry.provider || '',
        sourceType: entry.sourceType || '',
        paragraphCount: data.paragraphs.length,
        charLength: clen,
        searchQueries: searchQueriesFor(entry, manifest),
        expectedAction: '如该来源应为整部法规/完整案例，请补取全文；若本来只需要单条条文，可在补检 findings 中确认',
      });
    }
    if (hasTruncationMarker(content)) {
      issues.push({
        kind: 'truncation_marker_detected',
        severity: 'blocker',
        reason: '来源正文含省略/展开全文/摘要等截断标记，不能视为完整资料库内容',
        sourceId: entry.sourceId,
        title: entry.title,
        url: entry.url || '',
        provider: entry.provider || '',
        sourceType: entry.sourceType || '',
        paragraphCount: data.paragraphs.length,
        charLength: clen,
        searchQueries: searchQueriesFor(entry, manifest),
        expectedAction: '重新读取官方全文或数据库详情页并再次入库',
      });
    }
  }

  const unique = [];
  const seen = new Set();
  for (const issue of issues) {
    const key = issueKey(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }
  const blockers = unique.filter((i) => i.severity === 'blocker');
  const reviews = unique.filter((i) => i.severity !== 'blocker');
  const payload = {
    taskId: manifest.taskId || path.basename(dir),
    query: manifest.query || '',
    generatedAt: nowIso(),
    purpose: '补齐检索资料全文，避免搜索工具 observation 片段被误当资料库全文，从源头减少弱关联/无关联。',
    counts: { total: unique.length, blockers: blockers.length, reviews: reviews.length },
    items: unique,
  };
  const outPath = safeJoin(dir, out || DEFAULT_OUT);
  writeJson(outPath, payload);
  return {
    success: true,
    taskId: payload.taskId,
    taskDir: dir,
    outPath,
    count: unique.length,
    blockers: blockers.length,
    reviews: reviews.length,
    ok: blockers.length === 0,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (!args.task) throw new Error('--task <dir> is required');
    const res = auditSourceCompleteness({
      taskDir: args.task,
      workspaceRoot: typeof args.root === 'string' ? args.root : process.cwd(),
      out: typeof args.out === 'string' ? args.out : DEFAULT_OUT,
    });
    printJson(res);
  } catch (e) {
    printJson({ success: false, error: String(e.message || e) });
    process.exit(1);
  }
}
