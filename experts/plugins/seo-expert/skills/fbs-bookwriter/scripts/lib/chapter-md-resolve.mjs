/**
 * 章节 MD 路径解析（sync-book-chapter-index / chapter-dependency-gate 共用，防 O(d×f) 重复 basename）
 */
import fs from "fs";
import path from "path";

const DEFAULT_MAX_DEPTH = 8;

/**
 * @param {string} root
 * @param {{ recursive?: boolean, maxDepth?: number }} [opts]
 * @returns {string[]} 绝对路径
 */
export function listDraftMd(root, opts = {}) {
  const recursive = opts.recursive !== false;
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (!fs.existsSync(root)) return [];
  if (!recursive) {
    return fs
      .readdirSync(root)
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.join(root, f));
  }
  const out = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".git") continue;
        walk(p, depth + 1);
      } else if (ent.isFile() && ent.name.endsWith(".md")) {
        out.push(p);
      }
    }
  }
  walk(root, 0);
  return out;
}

/**
 * @param {string[]} filesAbs
 * @param {string} hint
 * @returns {string[]}
 */
export function matchContains(filesAbs, hint) {
  if (!hint) return [];
  const h = String(hint);
  const out = [];
  for (const p of filesAbs) {
    if (path.basename(p).includes(h)) out.push(p);
  }
  return out;
}

/**
 * @param {string} root
 * @param {string} fbs
 * @param {{ recursive?: boolean }} [opts]
 */
export function buildChapterMatchFacts(root, fbs, opts = {}) {
  const files = listDraftMd(root, opts);
  const basenames = files.map((p) => path.basename(p));
  const depsPath = path.join(fbs, "chapter-dependencies.json");
  if (!fs.existsSync(depsPath)) {
    return { files, basenames, chapters: [], byId: new Map(), depsPath, missing: true, corrupt: false };
  }
  let j;
  try {
    j = JSON.parse(fs.readFileSync(depsPath, "utf8"));
  } catch {
    return { files, basenames, chapters: [], byId: new Map(), depsPath, missing: false, corrupt: true };
  }
  const chapters = Array.isArray(j.chapters) ? j.chapters : [];
  const byId = new Map();
  for (const ch of chapters) {
    const id = ch.id || "";
    const hint = ch.fileNameContains || ch.title || id || "";
    const matched = [];
    if (hint) {
      const h = String(hint);
      for (let i = 0; i < files.length; i++) {
        if (basenames[i].includes(h)) matched.push(files[i]);
      }
    }
    byId.set(id, {
      id,
      title: ch.title || null,
      fileFound: matched.length > 0,
      matchedFiles: matched.map((x) => path.basename(x)),
      dependsOn: Array.isArray(ch.dependsOn) ? ch.dependsOn : [],
    });
  }
  return { files, basenames, chapters, byId, depsPath, missing: false, corrupt: false };
}
