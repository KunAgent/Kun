// persist-legal-sources.mjs — Persist retrieved legal sources into the virtual memory library.
//
// Input (file via --input, or stdin):
// {
//   "taskId": "optional",            // if omitted and --task omitted, a new task is created
//   "query": "用户问题",
//   "sources": [
//     { "title": "...", "sourceType": "law|case|regulation|web|user",
//       "provider": "pkulaw|official|web|user|model_suggested",
//       "status": "现行有效|已修订|已废止|不完整|未核验",
//       "url": "", "content": "全文或片段（必填；没有正文默认直接失败，不生成核验报告）",
//       "metadata": { "lawId":"", "publishDate":"", "effectiveDate":"", "caseNo":"", "court":"" } }
//   ]
// }
//
// Usage:
//   node persist-legal-sources.mjs --input sources.json [--task <dir>] [--root <ws>]
//   cat sources.json | node persist-legal-sources.mjs --task <dir>
//
// Effects: writes sources/{id}.md + {id}.json, rebuilds index/*, updates manifest.
// Prints JSON: { success, taskId, taskDir, saved:[{sourceId,title,paragraphCount}], totalSources }

import path from 'node:path';
import {
  makeSourceId, nowIso, normalizeLawTitle, parseArgs, printJson, readStdin,
  readJson, writeJson, writeText, safeJoin, sanitizeFileName, loadManifest, saveManifest,
  resolveTaskDir, manifestPath,
} from './lib.mjs';
import { initMemory } from './legal-memory-init.mjs';
import { paragraphizeContent, formatParagraphsMarkdown } from './paragraphize-source.mjs';

function buildSourceMarkdown(meta, paragraphs) {
  const fm = [
    '---',
    `sourceId: ${meta.sourceId}`,
    `title: ${meta.title}`,
    `sourceType: ${meta.sourceType}`,
    `provider: ${meta.provider}`,
    `status: ${meta.status}`,
    `url: ${meta.url || ''}`,
    `retrievedAt: ${meta.retrievedAt}`,
    '---',
    '',
    `# ${meta.title}`,
    '',
    formatParagraphsMarkdown(paragraphs),
    '',
  ];
  return fm.join('\n');
}

function sourceContent(src) {
  return String(src.content || src.summary || '').trim();
}

function splitContentBlocks(content) {
  return String(content || '')
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function mergeUniqueContent(...contents) {
  const seen = new Set();
  const blocks = [];
  for (const content of contents) {
    for (const block of splitContentBlocks(content)) {
      const key = block.replace(/\s+/g, '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      blocks.push(block);
    }
  }
  return blocks.join('\n\n');
}

function existingSourceContent(sourcesDir, sourceId) {
  const data = readJson(safeJoin(sourcesDir, sourceId + '.json'), null);
  if (!data || !Array.isArray(data.paragraphs)) return '';
  return data.paragraphs.map((p) => p.text || '').filter(Boolean).join('\n\n');
}

function preferStatus(...statuses) {
  const order = ['现行有效', '尚未施行', '已修订', '已废止', '未核验', '不完整'];
  for (const status of order) {
    if (statuses.includes(status)) return status;
  }
  return statuses.find(Boolean) || '未核验';
}

function mergeSourceRecords(base, next) {
  if (!base) return { ...next };
  return {
    ...base,
    ...next,
    title: base.title || next.title,
    provider: base.provider || next.provider,
    url: base.url || next.url,
    sourceType: base.sourceType || next.sourceType,
    status: preferStatus(base.status, next.status),
    content: mergeUniqueContent(base.content, next.content),
    metadata: { ...(base.metadata || {}), ...(next.metadata || {}) },
  };
}

function assertSourcesHaveContent(sources, { strictContent = true } = {}) {
  if (!strictContent) return;
  const missing = sources
    .map((src, index) => ({ index, title: src.title || '未命名来源', hasContent: sourceContent(src).length > 0 }))
    .filter((x) => !x.hasContent);
  if (!missing.length) return;
  const preview = missing.slice(0, 8).map((x) => `#${x.index + 1} ${x.title}`).join('；');
  const more = missing.length > 8 ? ` 等 ${missing.length} 条` : '';
  throw new Error(
    `来源缺少 content 正文，已阻断核验报告生成：${preview}${more}。` +
    '请先重新检索/读取法条或案例全文，并把原文写入 sources.json 每条 source.content；' +
    '否则段落库和条文索引为空，报告必然大量弱关联/待核验。'
  );
}

export function persistSources(payload, { taskDir = null, workspaceRoot = process.cwd(), strictContent = true } = {}) {
  // Accept BOTH shapes: a bare array of sources, or { sources:[...], query, taskId }.
  // (A bare top-level array was silently ignored before, producing an empty index and an
  //  all-"unverified" report — the dominant cause of the all-red regression.)
  if (Array.isArray(payload)) payload = { sources: payload };
  const rawSources = Array.isArray(payload.sources) ? payload.sources : [];
  assertSourcesHaveContent(rawSources, { strictContent });
  // resolve / create task dir
  let dir = taskDir || payload.taskId || null;
  if (dir) {
    dir = resolveTaskDir(dir, workspaceRoot);
    // ensure a manifest exists
    if (!readJson(manifestPath(dir), null)) {
      initMemory({ query: payload.query || '', taskDir: dir, workspaceRoot });
    }
  } else {
    const init = initMemory({ query: payload.query || '', workspaceRoot });
    dir = init.taskDir;
  }

  const manifest = loadManifest(dir);
  if (payload.query && !manifest.query) manifest.query = payload.query;

  const sourcesDir = safeJoin(dir, 'sources');
  const indexDir = safeJoin(dir, 'index');

  // Merge duplicate law/document entries before paragraphizing. Legal search tools often return
  // one article per result with the same title + URL. The sourceId deliberately stays document-level
  // so all articles from the same law are stored as one source; otherwise later snippets overwrite
  // earlier snippets and the article index loses most provisions, causing false weak associations.
  const incomingById = new Map();
  for (const src of rawSources) {
    const title = src.title || '未命名来源';
    const provider = src.provider || 'model_suggested';
    const url = src.url || (src.metadata && src.metadata.url) || '';
    const lawId = (src.metadata && src.metadata.lawId) || '';
    const sourceId = makeSourceId({ provider, title, url, lawId });
    const normalizedSrc = {
      ...src,
      title,
      provider,
      url,
      sourceId,
      content: sourceContent(src),
      status: src.status || (sourceContent(src) ? '未核验' : '不完整'),
    };
    incomingById.set(sourceId, mergeSourceRecords(incomingById.get(sourceId), normalizedSrc));
  }
  const sources = Array.from(incomingById.values()).map((src) => ({
    ...src,
    content: mergeUniqueContent(existingSourceContent(sourcesDir, src.sourceId), src.content),
  }));

  const saved = [];
  const bySourceId = new Map(manifest.sources.map((s) => [s.sourceId, s]));

  // accumulators for full index rebuild
  const allParagraphs = [];
  const articleIndex = {}; // { sourceId: { lawTitle: { 第13条: [P13] } } }
  const sourceIndex = {}; // { sourceId: {title, normalizedTitle, sourceType, status, paragraphCount, caseNo} }
  const invertedIndex = {}; // { token: [ "sourceId:P3", ... ] }

  // start from existing persisted paragraphs (so re-runs accumulate other sources)
  // We rebuild from manifest sources that are NOT being re-persisted this round.
  const incomingIds = new Set();

  for (const src of sources) {
    const title = src.title || '未命名来源';
    const provider = src.provider || 'model_suggested';
    const url = src.url || (src.metadata && src.metadata.url) || '';
    const lawId = (src.metadata && src.metadata.lawId) || '';
    const sourceId = makeSourceId({ provider, title, url, lawId });
    incomingIds.add(sourceId);

    const content = sourceContent(src);
    const { paragraphs } = paragraphizeContent(content, sourceId);

    const meta = {
      sourceId,
      title,
      sourceType: src.sourceType || 'web',
      provider,
      status: src.status || (content ? '未核验' : '不完整'),
      url,
      retrievedAt: nowIso(),
      metadata: src.metadata || {},
      paragraphCount: paragraphs.length,
    };

    // write md + json
    const mdFile = safeJoin(sourcesDir, sanitizeFileName(sourceId) + '.md');
    const jsonFile = safeJoin(sourcesDir, sanitizeFileName(sourceId) + '.json');
    writeText(mdFile, buildSourceMarkdown(meta, paragraphs));
    writeJson(jsonFile, { ...meta, paragraphs });

    // manifest entry (dedupe/update)
    const entry = {
      sourceId,
      title,
      sourceType: meta.sourceType,
      provider,
      status: meta.status,
      url,
      file: `sources/${sourceId}.md`,
      metaFile: `sources/${sourceId}.json`,
      paragraphCount: paragraphs.length,
      caseNo: (src.metadata && src.metadata.caseNo) || extractCaseNo(content),
      createdAt: bySourceId.get(sourceId)?.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    bySourceId.set(sourceId, entry);
    saved.push({ sourceId, title, paragraphCount: paragraphs.length, status: meta.status });
  }

  manifest.sources = Array.from(bySourceId.values());
  saveManifest(dir, manifest);

  // Full index rebuild over ALL persisted sources (reads each {id}.json)
  for (const entry of manifest.sources) {
    const data = readJson(safeJoin(sourcesDir, entry.sourceId + '.json'), null);
    if (!data) continue;
    const normTitle = normalizeLawTitle(entry.title);
    sourceIndex[entry.sourceId] = {
      title: entry.title,
      normalizedTitle: normTitle,
      sourceType: entry.sourceType,
      status: entry.status,
      provider: entry.provider,
      paragraphCount: entry.paragraphCount,
      caseNo: entry.caseNo || '',
      url: entry.url || '',
    };
    const arts = {};
    for (const p of data.paragraphs) {
      const pid = `P${p.paragraphIndex}`;
      allParagraphs.push({
        sourceId: entry.sourceId,
        paragraphIndex: p.paragraphIndex,
        paragraphId: p.paragraphId,
        title: entry.title,
        sourceType: entry.sourceType,
        articleNo: p.articleNo,
        caseSection: p.caseSection,
        headingPath: p.headingPath,
        text: p.text,
        startOffset: p.startOffset,
        endOffset: p.endOffset,
        hash: p.hash,
      });
      if (p.articleNo) {
        if (!arts[p.articleNo]) arts[p.articleNo] = [];
        if (!arts[p.articleNo].includes(pid)) arts[p.articleNo].push(pid);
      }
      // inverted index over keyword tokens
      for (const m of String(p.text).matchAll(/[\u4e00-\u9fa5]{2,4}|[A-Za-z]{3,}|\d{2,}/g)) {
        const tok = m[0].toLowerCase();
        const ref = `${entry.sourceId}:${pid}`;
        if (!invertedIndex[tok]) invertedIndex[tok] = [];
        if (invertedIndex[tok].length < 200 && !invertedIndex[tok].includes(ref)) {
          invertedIndex[tok].push(ref);
        }
      }
    }
    if (Object.keys(arts).length) {
      articleIndex[entry.sourceId] = { [normTitle || entry.title]: arts };
    }
  }

  // write index files (full rebuild = deterministic)
  writeText(
    safeJoin(indexDir, 'paragraphs.jsonl'),
    allParagraphs.map((r) => JSON.stringify(r)).join('\n') + (allParagraphs.length ? '\n' : '')
  );
  writeJson(safeJoin(indexDir, 'article_index.json'), articleIndex);
  writeJson(safeJoin(indexDir, 'source_index.json'), sourceIndex);
  writeJson(safeJoin(indexDir, 'inverted_index.json'), invertedIndex);

  // Build warnings so the caller can SEE when the library came out empty/degraded instead of
  // discovering it later as an all-red report.
  const warnings = [];
  const sourcesMissingContent = saved.filter((s) => s.paragraphCount === 0).map((s) => s.title);
  if (allParagraphs.length === 0 && manifest.sources.length > 0) {
    warnings.push(`已入库 ${manifest.sources.length} 条来源，但总段落数为 0——几乎可以确定每条来源都缺少 content 正文（sources.json 每条必须带 content 法条/案例全文）。索引为空时所有引用都无法溯源，报告会全部变成弱关联/待核验`);
  } else if (sourcesMissingContent.length > 0) {
    warnings.push(`${sourcesMissingContent.length} 条来源没有正文段落（缺 content）：${sourcesMissingContent.slice(0, 5).join('、')}${sourcesMissingContent.length > 5 ? ' 等' : ''}。这些来源无法被条文/案号锚定`);
  }

  return {
    success: true,
    taskId: manifest.taskId,
    taskDir: dir,
    saved,
    totalSources: manifest.sources.length,
    totalParagraphs: allParagraphs.length,
    warnings,
  };
}

function extractCaseNo(text) {
  const m = String(text || '').match(/[（(]\s*\d{4}\s*[）)][^\s，。；]{2,40}号/);
  return m ? m[0] : '';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const raw = args.input ? readJson(args.input, null) : JSON.parse(readStdin() || '{}');
    if (!raw) throw new Error('No input payload (use --input <file> or pipe JSON via stdin)');
    const res = persistSources(raw, {
      taskDir: typeof args.task === 'string' ? args.task : null,
      workspaceRoot: typeof args.root === 'string' ? args.root : process.cwd(),
      strictContent: args['allow-degraded'] ? false : true,
    });
    printJson(res);
  } catch (e) {
    printJson({ success: false, error: String(e.message || e) });
    process.exit(1);
  }
}
