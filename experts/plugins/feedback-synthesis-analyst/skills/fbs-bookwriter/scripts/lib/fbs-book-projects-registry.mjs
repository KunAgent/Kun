/**
 * 跨会话书稿路径索引（WorkBuddy 实测 P1-01）
 * 默认写入 ~/.workbuddy/fbs-book-projects.json，在 session-exit 成功时登记。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

function isProbablyTempProjectRoot(bookRoot) {
  const n = path.normalize(bookRoot).toLowerCase();
  const tmp = path.normalize(os.tmpdir()).toLowerCase();
  return n.startsWith(tmp) || /[/\\]temp[/\\]fbs-/i.test(n);
}

const REGISTRY_VERSION = 1;
const MAX_ENTRIES = 200;

function registryPath() {
  return path.join(os.homedir(), '.workbuddy', 'fbs-book-projects.json');
}

function safeReadJson(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeRoot(p) {
  return path.resolve(String(p || '').trim());
}

/**
 * @param {{ bookRoot: string, bookTitle?: string|null, currentStage?: string|null }} meta
 */
export function registerBookProject(meta) {
  const bookRoot = normalizeRoot(meta.bookRoot);
  if (!bookRoot || !fs.existsSync(path.join(bookRoot, '.fbs'))) return;
  if (isProbablyTempProjectRoot(bookRoot)) return;

  const p = registryPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });

  const data = safeReadJson(p) || { version: REGISTRY_VERSION, entries: [] };
  if (!Array.isArray(data.entries)) data.entries = [];

  const now = new Date().toISOString();
  const title = meta.bookTitle != null && String(meta.bookTitle).trim() ? String(meta.bookTitle).trim() : null;
  const stage = meta.currentStage != null ? String(meta.currentStage).trim() : null;

  const idx = data.entries.findIndex((e) => normalizeRoot(e.bookRoot) === bookRoot);
  const row = {
    bookRoot,
    bookTitle: title,
    currentStage: stage,
    lastExitAt: now,
    registeredAt: idx >= 0 ? data.entries[idx].registeredAt || now : now,
  };

  if (idx >= 0) data.entries[idx] = row;
  else data.entries.unshift(row);

  data.entries = data.entries.slice(0, MAX_ENTRIES);
  data.updatedAt = now;
  data.version = REGISTRY_VERSION;
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * @param {string} keyword
 * @returns {Array<{ bookRoot: string, bookTitle: string|null, score: number }>}
 */
export function listRegistryEntries() {
  const data = safeReadJson(registryPath());
  return Array.isArray(data?.entries) ? data.entries : [];
}

export function searchBookProjects(keyword) {
  const q = String(keyword || '')
    .trim()
    .toLowerCase();
  if (!q) return [];

  const data = safeReadJson(registryPath());
  if (!data?.entries?.length) return [];

  const out = [];
  for (const e of data.entries) {
    const root = normalizeRoot(e.bookRoot);
    const title = e.bookTitle ? String(e.bookTitle).toLowerCase() : '';
    const base = path.basename(root).toLowerCase();
    let score = 0;
    if (title && title.includes(q)) score += 3;
    if (base.includes(q)) score += 2;
    if (root.toLowerCase().includes(q)) score += 1;
    if (score > 0) {
      out.push({
        bookRoot: root,
        bookTitle: e.bookTitle || null,
        currentStage: e.currentStage || null,
        lastExitAt: e.lastExitAt || null,
        score,
      });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 12);
}
