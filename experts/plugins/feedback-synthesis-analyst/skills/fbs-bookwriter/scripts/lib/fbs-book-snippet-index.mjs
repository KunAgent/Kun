/**
 * 书稿侧轻量检索索引（P0 A1）：与全局登记合并，供 intake --search
 * 落盘：bookRoot/.fbs/index/book-snippet.json
 */
import fs from 'fs';
import path from 'path';
import { listRegistryEntries, searchBookProjects } from './fbs-book-projects-registry.mjs';

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .split(/[\s/\\_\-，。、；：]+/)
    .filter(Boolean);
}

/**
 * 从恢复卡 / 简报抽取可检索片段并写入本书索引
 * @param {string} bookRoot
 */
export function upsertBookSnippetIndex(bookRoot) {
  const root = path.resolve(String(bookRoot || '').trim());
  const fbs = path.join(root, '.fbs');
  if (!fs.existsSync(fbs)) return;

  let bookTitle = null;
  let currentStage = null;
  const resumePath = path.join(fbs, 'workbuddy-resume.json');
  if (fs.existsSync(resumePath)) {
    const j = readJson(resumePath);
    if (j) {
      bookTitle = j.bookTitle || null;
      currentStage = j.currentStage || null;
    }
  }

  const briefPath = path.join(fbs, 'book-context-brief.md');
  if (!bookTitle && fs.existsSync(briefPath)) {
    try {
      const t = fs.readFileSync(briefPath, 'utf8');
      const m = t.match(/书名[：:]\s*([^\n]+)/);
      if (m) bookTitle = m[1].trim();
    } catch {
      /* ignore */
    }
  }

  const keywords = new Set(tokenize(bookTitle));
  keywords.add(path.basename(root).toLowerCase());
  tokenize(currentStage).forEach((k) => keywords.add(k));

  const idxDir = path.join(fbs, 'index');
  fs.mkdirSync(idxDir, { recursive: true });
  const payload = {
    version: 1,
    bookRoot: root,
    bookTitle,
    currentStage,
    keywords: [...keywords].filter(Boolean),
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(path.join(idxDir, 'book-snippet.json'), JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    /* ignore */
  }
}

function normKey(p) {
  return path.normalize(path.resolve(p)).toLowerCase();
}

/**
 * 合并全局登记 + 本书 snippet 关键词的检索
 * @param {string} keyword
 */
export function searchUnifiedBookRoots(keyword) {
  const q = String(keyword || '').trim().toLowerCase();
  if (!q) return [];

  const base = searchBookProjects(q);
  const seen = new Set(base.map((m) => normKey(m.bookRoot)));
  const extra = [];

  for (const e of listRegistryEntries()) {
    const br = e.bookRoot && path.resolve(e.bookRoot);
    if (!br || !fs.existsSync(br)) continue;
    const k = normKey(br);
    if (seen.has(k)) continue;

    const snippetPath = path.join(br, '.fbs', 'index', 'book-snippet.json');
    const sn = readJson(snippetPath);
    const title = (sn?.bookTitle || e.bookTitle || '').toLowerCase();
    const kws = (sn?.keywords || []).map((x) => String(x).toLowerCase());
    let score = 0;
    if (title.includes(q)) score += 3;
    if (kws.some((kw) => kw.includes(q))) score += 2;
    if (br.toLowerCase().includes(q)) score += 1;
    if (path.basename(br).toLowerCase().includes(q)) score += 2;
    if (score > 0) {
      extra.push({
        bookRoot: br,
        bookTitle: sn?.bookTitle || e.bookTitle || null,
        currentStage: sn?.currentStage || e.currentStage || null,
        lastExitAt: e.lastExitAt || null,
        score,
        matchSource: 'snippet-index',
      });
      seen.add(k);
    }
  }

  const merged = [...base.map((m) => ({ ...m, matchSource: 'registry' })), ...extra];
  merged.sort((a, b) => (b.score || 0) - (a.score || 0));
  return merged.slice(0, 16);
}
