// legal-memory-init.mjs — Create a task-scoped virtual memory library.
//
// Usage:
//   node legal-memory-init.mjs --query "用户问题" [--task <dir>] [--root <workspaceRoot>]
//     [--title "报告标题"] [--out "output/文件名.html"]
// Prints JSON: { success, taskId, taskDir, manifestPath }
//
// --title / --out (both optional): let the SINGLE final report be named after the
//   scenario (e.g. 《合规分析报告》) instead of the generic "法律依据溯源辅助报告".
//   Verification is an embedded layer of this one report, not a separate deliverable.

import path from 'node:path';
import {
  MEMORY_ROOT, SCHEMA_VERSION, makeTaskId, nowIso, ensureDir, saveManifest,
  parseArgs, printJson, resolveTaskDir, manifestPath, readJson,
} from './lib.mjs';

function normalizeOutputHtml(outputHtml, title) {
  const fallback = `output/${sanitizeFileBase(title)}.html`;
  const raw = String(outputHtml || '').trim();
  if (!raw) return fallback;
  // Final report paths must stay inside the task directory/workspace memory. Absolute temp paths
  // make html generation fail (safeJoin blocks them) and tempt agents to hand-write a separate
  // report. Normalize them early to the canonical rendered-report location.
  if (path.isAbsolute(raw) || raw.includes('..')) return fallback;
  return raw.endsWith('.html') || raw.endsWith('.htm') ? raw : `${raw}.html`;
}

export function initMemory({ query = '', taskDir = null, workspaceRoot = process.cwd(), reportTitle = '', outputHtml = '' } = {}) {
  let dir = taskDir;
  let taskId;
  if (dir) {
    dir = resolveTaskDir(dir, workspaceRoot);
    taskId = path.basename(dir);
  } else {
    taskId = makeTaskId();
    dir = path.resolve(workspaceRoot, MEMORY_ROOT, taskId);
  }

  ensureDir(dir);
  ensureDir(path.join(dir, 'sources'));
  ensureDir(path.join(dir, 'raw-search'));
  ensureDir(path.join(dir, 'index'));
  ensureDir(path.join(dir, 'verification'));
  ensureDir(path.join(dir, 'output'));

  // Don't clobber an existing manifest (idempotent)
  const existing = readJson(manifestPath(dir), null);
  if (existing) {
    let dirty = false;
    if (query && !existing.query) { existing.query = query; dirty = true; }
    if (reportTitle && !existing.reportTitle) { existing.reportTitle = reportTitle; dirty = true; }
    if (outputHtml && !existing.outputHtml) { existing.outputHtml = normalizeOutputHtml(outputHtml, existing.reportTitle || reportTitle || '法律依据溯源辅助报告'); dirty = true; }
    if (!existing.rawSearchDir) { existing.rawSearchDir = 'raw-search'; dirty = true; }
    if (!Array.isArray(existing.retrievalBatches)) { existing.retrievalBatches = []; dirty = true; }
    if (dirty) saveManifest(dir, existing);
    return { success: true, taskId, taskDir: dir, manifestPath: manifestPath(dir), reused: true };
  }

  // Resolve the SINGLE final report's title and filename.
  // Default title stays the generic 溯源辅助 one; when a scenario title is given
  // (e.g. 合规分析报告), the same one rendered file is named after it — there is no
  // separate "辅助报告". outputHtml is derived from the title unless explicitly set.
  const title = reportTitle || '法律依据溯源辅助报告';
  const outFile = normalizeOutputHtml(outputHtml, title);

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    taskId,
    createdAt: nowIso(),
    query,
    workspaceRoot,
    reportTitle: title,
    answerFile: 'answer.md',
    sourcesDir: 'sources',
    rawSearchDir: 'raw-search',
    indexDir: 'index',
    verificationDir: 'verification',
    outputHtml: outFile,
    sources: [],
    retrievalBatches: [],
  };
  saveManifest(dir, manifest);

  return { success: true, taskId, taskDir: dir, manifestPath: manifestPath(dir), reused: false };
}

// Turn a report title into a filesystem-safe base name (keep CJK, strip path/illegal chars).
function sanitizeFileBase(s) {
  return String(s)
    .replace(/[\\/:*?"<>|]/g, '')   // illegal filename chars
    .replace(/[\s\u3000]+/g, '')    // whitespace (incl. full-width)
    .replace(/\.+$/, '')            // trailing dots
    .slice(0, 80) || '法律检索报告';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const res = initMemory({
      query: typeof args.query === 'string' ? args.query : '',
      taskDir: typeof args.task === 'string' ? args.task : null,
      workspaceRoot: typeof args.root === 'string' ? args.root : process.cwd(),
      reportTitle: typeof args.title === 'string' ? args.title : '',
      outputHtml: typeof args.out === 'string' ? args.out : '',
    });
    printJson(res);
  } catch (e) {
    printJson({ success: false, error: String(e.message || e) });
    process.exit(1);
  }
}
