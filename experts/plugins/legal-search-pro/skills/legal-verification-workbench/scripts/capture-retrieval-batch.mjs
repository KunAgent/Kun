// capture-retrieval-batch.mjs — Persist every retrieval batch before the AI drafts the report.
//
// Purpose:
//   Search/Web/MCP tool results should not live only in the agent's context. This script writes
//   the raw batch to the task memory (raw-search/*.json + *.md) and immediately paragraphizes any
//   item that contains retrievable body text into the normal sources/index library.
//
// Accepted input shapes (file via --input or stdin):
//   { "query":"...", "tool":"WebSearch", "provider":"web", "results":[ ... ] }
//   { "sources":[ ... ] }
//   [ ... ]
//
// A result may use title/name, url/link/sourceUrl, content/markdown/text/body/fullText/rawContent.
// Snippets are stored in raw-search but are NOT citable unless --allow-snippet is passed.

import path from 'node:path';
import {
  sha1, nowIso, parseArgs, printJson, readJsonStrict, readStdin, writeJson, writeText,
  safeJoin, sanitizeFileName, loadManifest, saveManifest, resolveTaskDir,
} from './lib.mjs';
import { initMemory } from './legal-memory-init.mjs';
import { persistSources } from './persist-legal-sources.mjs';

function coalesce(...values) {
  for (const value of values) {
    if (value == null) continue;
    const s = String(value).trim();
    if (s) return s;
  }
  return '';
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['sources', 'results', 'documents', 'items', 'data', 'records']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function stableBatchId(payload, items) {
  const raw = payload && typeof payload === 'object' ? payload.batchId || payload.id || '' : '';
  if (raw) return sanitizeFileName(raw);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const digest = sha1(JSON.stringify(items.map((it) => ({
    title: it && (it.title || it.name || it.lawName || it.caseName),
    url: it && (it.url || it.link || it.sourceUrl),
  })).slice(0, 200))).slice(0, 8);
  return `batch-${stamp}-${digest}`;
}

function inferSourceType(item = {}) {
  const explicit = coalesce(item.sourceType, item.type, item.category);
  if (/^(law|case|regulation|web|user)$/.test(explicit)) return explicit;
  const text = `${coalesce(item.title, item.name, item.lawName, item.caseName)} ${coalesce(item.content, item.markdown, item.text, item.body, item.fullText, item.rawContent, item.snippet, item.summary)}`;
  if (/[（(]\s*\d{4}\s*[）)][^\s，。；]{2,40}号/.test(text)) return 'case';
  if (/法|条例|办法|规定|规章|解释|通知|意见|公告|标准/.test(coalesce(item.title, item.name, item.lawName))) return 'regulation';
  return 'web';
}

function getFullContent(item = {}) {
  return coalesce(item.content, item.markdown, item.text, item.body, item.fullText, item.rawContent, item.htmlText, item.pageText);
}

function getSnippet(item = {}) {
  return coalesce(item.snippet, item.summary, item.abstract, item.description, item.excerpt);
}

function compactLen(text) {
  return String(text || '').replace(/\s+/g, '').length;
}

function hasPartialSignal(item = {}, content = '') {
  const explicit = item.isTruncated || item.truncated || item.contentTruncated || item.partial || item.isPartial;
  if (explicit) return true;
  return /(\.\.\.|…|展开全文|阅读全文|查看全部|更多内容|节选|摘录|摘要|snippet|summary)/i.test(String(content || ''));
}

function normalizeItem(item = {}, index, payload = {}, { allowSnippet = false, providerOverride = '' } = {}) {
  const fullContent = getFullContent(item);
  const snippet = getSnippet(item);
  const usedSnippetAsContent = !fullContent && allowSnippet && !!snippet;
  const content = fullContent || (usedSnippetAsContent ? snippet : '');
  const provider = coalesce(item.provider, item.sourceProvider, payload.provider, providerOverride, payload.tool, 'web');
  const url = coalesce(item.url, item.link, item.sourceUrl, item.href, item.metadata && item.metadata.url);
  const title = coalesce(item.title, item.name, item.lawName, item.caseName, item.documentTitle, url, `未命名检索结果-${index + 1}`);
  const sourceType = inferSourceType(item);
  const status = coalesce(item.status, item.effectiveness, item.validity, usedSnippetAsContent ? '不完整' : '', fullContent ? '未核验' : '');
  const metadata = {
    ...(item.metadata && typeof item.metadata === 'object' ? item.metadata : {}),
    retrievalBatchId: payload._batchId || '',
    retrievalRawIndex: index + 1,
    retrievalTool: coalesce(payload.tool, payload.toolName, payload.provider, providerOverride),
    originalProvider: provider,
    contentCharLength: compactLen(content),
    snippetCharLength: compactLen(snippet),
    hasFullContent: !!fullContent,
    usedSnippetAsContent,
    possiblePartialContent: hasPartialSignal(item, content),
    publishDate: coalesce(item.publishDate, item.publishedAt, item.date, item.metadata && item.metadata.publishDate),
    caseNo: coalesce(item.caseNo, item.caseNumber, item.metadata && item.metadata.caseNo),
    lawId: coalesce(item.lawId, item.id, item.metadata && item.metadata.lawId),
  };
  return {
    rawIndex: index + 1,
    title,
    url,
    provider,
    sourceType,
    status: status || (content ? '未核验' : '不完整'),
    content,
    snippet,
    contentCharLength: compactLen(content),
    snippetCharLength: compactLen(snippet),
    hasFullContent: !!fullContent,
    usedSnippetAsContent,
    possiblePartialContent: hasPartialSignal(item, content),
    metadata,
    raw: item,
  };
}

function renderRawMarkdown({ batchId, query, tool, createdAt, normalized }) {
  const lines = [
    '---',
    `batchId: ${batchId}`,
    `query: ${String(query || '').replace(/\n/g, ' ')}`,
    `tool: ${tool}`,
    `createdAt: ${createdAt}`,
    `totalItems: ${normalized.length}`,
    '---',
    '',
    `# Retrieval batch ${batchId}`,
    '',
  ];
  for (const item of normalized) {
    lines.push(`## [${item.rawIndex}] ${item.title}`);
    lines.push('');
    lines.push(`- provider: ${item.provider}`);
    lines.push(`- sourceType: ${item.sourceType}`);
    lines.push(`- status: ${item.status}`);
    lines.push(`- url: ${item.url || ''}`);
    lines.push(`- persistedToSources: ${item.content ? 'yes' : 'no (missing full content)'}`);
    lines.push(`- hasFullContent: ${item.hasFullContent ? 'yes' : 'no'}`);
    lines.push('');
    if (item.content) {
      lines.push('### Captured content');
      lines.push('');
      lines.push(item.content);
    } else if (item.snippet) {
      lines.push('### Search snippet only');
      lines.push('');
      lines.push(item.snippet);
    } else {
      lines.push('（本条检索结果没有可保存正文或摘要。）');
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function captureRetrievalBatch(payload, {
  taskDir = null,
  workspaceRoot = process.cwd(),
  allowSnippet = false,
  provider = '',
} = {}) {
  const items = asArray(payload);
  const batchId = stableBatchId(payload, items);
  const query = coalesce(payload && payload.query, payload && payload.originalQuery);
  const tool = coalesce(payload && payload.tool, payload && payload.toolName, payload && payload.provider, provider, 'retrieval');
  const createdAt = nowIso();

  let dir = taskDir || (payload && payload.taskId) || null;
  if (dir) {
    dir = resolveTaskDir(dir, workspaceRoot);
    try {
      loadManifest(dir);
    } catch {
      initMemory({ query, taskDir: dir, workspaceRoot });
    }
  } else {
    dir = initMemory({ query, workspaceRoot }).taskDir;
  }

  const payloadWithBatch = payload && typeof payload === 'object' ? { ...payload, _batchId: batchId } : { _batchId: batchId };
  const normalized = items.map((item, index) => normalizeItem(item, index, payloadWithBatch, { allowSnippet, providerOverride: provider }));

  const rawDir = safeJoin(dir, 'raw-search');
  const rawJson = safeJoin(rawDir, `${sanitizeFileName(batchId)}.json`);
  const rawMd = safeJoin(rawDir, `${sanitizeFileName(batchId)}.md`);
  writeJson(rawJson, { batchId, query, tool, createdAt, totalItems: normalized.length, items: normalized });
  writeText(rawMd, renderRawMarkdown({ batchId, query, tool, createdAt, normalized }));

  const citableSources = normalized
    .filter((item) => item.content)
    .map((item) => ({
      title: item.title,
      sourceType: item.sourceType,
      provider: item.provider,
      status: item.status,
      url: item.url,
      content: item.content,
      metadata: {
        ...item.metadata,
        contentCharLength: item.contentCharLength,
        snippetCharLength: item.snippetCharLength,
        possiblePartialContent: item.possiblePartialContent,
      },
    }));

  let persistRes = null;
  if (citableSources.length) {
    persistRes = persistSources({ query, sources: citableSources }, { taskDir: dir, workspaceRoot, strictContent: true });
  }

  const manifest = loadManifest(dir);
  if (!Array.isArray(manifest.retrievalBatches)) manifest.retrievalBatches = [];
  manifest.rawSearchDir = manifest.rawSearchDir || 'raw-search';
  manifest.retrievalBatches.push({
    batchId,
    query,
    tool,
    createdAt,
    rawFile: `raw-search/${sanitizeFileName(batchId)}.json`,
    rawMarkdownFile: `raw-search/${sanitizeFileName(batchId)}.md`,
    totalItems: normalized.length,
    persistedSources: citableSources.length,
    skippedNoContent: normalized.length - citableSources.length,
    allowSnippet,
  });
  saveManifest(dir, manifest);

  const warnings = [];
  if (!normalized.length) warnings.push('本批次没有识别到 results/sources/items 数组，已仅创建空批次记录');
  const skipped = normalized.filter((item) => !item.content);
  if (skipped.length) {
    warnings.push(`${skipped.length} 条检索结果只保存到 raw-search，未进入可引用 sources/index：需要先读取网页/文档全文并再次 capture，或显式使用 --allow-snippet 降级。`);
  }

  return {
    success: true,
    taskId: manifest.taskId,
    taskDir: dir,
    batchId,
    rawJson,
    rawMarkdown: rawMd,
    totalItems: normalized.length,
    persistedSources: citableSources.length,
    skippedNoContent: skipped.length,
    persist: persistRes,
    warnings,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  try {
    let payload;
    if (args.input) payload = readJsonStrict(args.input, '--input');
    else {
      const stdin = readStdin();
      if (!stdin.trim()) throw new Error('No input payload (use --input <file> or pipe JSON via stdin)');
      payload = JSON.parse(stdin);
    }
    const res = captureRetrievalBatch(payload, {
      taskDir: typeof args.task === 'string' ? args.task : null,
      workspaceRoot: typeof args.root === 'string' ? args.root : process.cwd(),
      allowSnippet: !!args['allow-snippet'],
      provider: typeof args.provider === 'string' ? args.provider : '',
    });
    printJson(res);
  } catch (e) {
    printJson({ success: false, error: String(e.message || e) });
    process.exit(1);
  }
}
