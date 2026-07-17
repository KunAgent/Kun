// generate-verification-html.mjs — Render the offline single-file verification report.
//
// Reads manifest + answer.md + verification/* + source JSONs, embeds everything as JSON
// into templates/verification-report.html, writes the SINGLE final report to
// manifest.outputHtml (default output/<title>.html). Verification is an embedded,
// toggle-off highlight layer inside this one report — NOT a separate deliverable.
// All dynamic text is escaped client-side; the embedded JSON is serialized safely
// (</script> sequences neutralized) to prevent script injection from source content.
//
// Usage: node generate-verification-html.mjs --task <dir>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseArgs, printJson, readJson, readText, writeText, loadManifest, safeJoin, resolveTaskDir, nowIso,
} from './lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(__dirname, '..', 'templates', 'verification-report.html');

function safeJsonForScript(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function generateHtml({ taskDir, workspaceRoot = process.cwd() } = {}) {
  const dir = resolveTaskDir(taskDir, workspaceRoot);
  const manifest = loadManifest(dir);
  const answerText = readText(safeJoin(dir, manifest.answerFile || 'answer.md'), '');
  const vp = readJson(safeJoin(dir, 'verification', 'verification_points.json'), { points: [] });
  const ev = readJson(safeJoin(dir, 'verification', 'evidence_matches.json'), { matches: [], stats: {} });

  // assemble source paragraphs from each {id}.json
  const sources = manifest.sources.map((entry) => {
    const data = readJson(safeJoin(dir, 'sources', entry.sourceId + '.json'), null);
    return {
      sourceId: entry.sourceId,
      title: entry.title,
      sourceType: entry.sourceType,
      status: entry.status,
      url: entry.url || '',
      paragraphs: data
        ? data.paragraphs.map((p) => ({ paragraphIndex: p.paragraphIndex, text: p.text }))
        : [],
    };
  });

  const stats = {
    points: ev.stats.points || vp.points.length,
    associated: ev.stats.associated || 0,
    weak: ev.stats.weak || 0,
    unverified: ev.stats.unverified || 0,
    statuteHits: ev.stats.statuteHits || 0,
    caseHits: ev.stats.caseHits || 0,
  };

  const payload = {
    taskId: manifest.taskId,
    query: manifest.query || '',
    generatedAt: nowIso(),
    answerText,
    points: vp.points,
    matches: ev.matches,
    sources,
    stats,
  };

  let tpl = fs.readFileSync(TEMPLATE, 'utf8');
  const title = manifest.reportTitle || '法律依据溯源辅助报告';
  const subtitle = `生成于 ${payload.generatedAt}${manifest.query ? ' · 问题：' + manifest.query.slice(0, 60) : ''}`;
  const footer = '本报告为法律检索与合规信息整理，不构成正式法律意见，重大决策请咨询执业律师。核验标签的含义与用法见报告顶部说明。';

  tpl = tpl
    .replaceAll('__TITLE__', escapeAttr(title))
    .replace('__SUBTITLE__', escapeAttr(subtitle))
    .replace('__FOOTER__', escapeAttr(footer))
    .replace('__DATA__', safeJsonForScript(payload));

  const outPath = safeJoin(dir, manifest.outputHtml || 'output/核验报告.html');
  writeText(outPath, tpl);

  return { success: true, taskId: manifest.taskId, htmlPath: outPath, stats };
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (!args.task) throw new Error('--task <dir> is required');
    const res = generateHtml({ taskDir: args.task, workspaceRoot: typeof args.root === 'string' ? args.root : process.cwd() });
    printJson(res);
  } catch (e) {
    printJson({ success: false, error: String(e.message || e) });
    process.exit(1);
  }
}
