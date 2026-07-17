#!/usr/bin/env node
/**
 * P2：将当前书稿进度落盘为 `.fbs/progress-snapshot.md`，便于对照
 * `references/01-core/ux-optimization-rules.md` §E 做文本抽查（非强制门禁）。
 */
import fs from 'fs';
import path from 'path';

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function pickStage(esmText, resume) {
  if (resume && typeof resume.currentStage === 'string') return resume.currentStage;
  const m = esmText.match(/当前阶段[：:]\s*([^\s\n]+)/);
  if (m) return m[1];
  const m2 = esmText.match(/\b(S_READY|S_END|S[0-6](?:\.[05])?)\b/);
  return m2 ? m2[1] : '（未识别）';
}

function parseArgs(argv) {
  const o = { bookRoot: process.cwd(), json: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--book-root' && argv[i + 1]) o.bookRoot = path.resolve(argv[++i]);
    else if (argv[i] === '--json') o.json = true;
    else if (argv[i] === '--help' || argv[i] === '-h') o.help = true;
  }
  return o;
}

export function buildProgressSnapshotContent(bookRoot) {
  const fbs = path.join(bookRoot, '.fbs');
  const esm = readText(path.join(fbs, 'esm-state.md'));
  const chapter = readText(path.join(fbs, 'chapter-status.md'));
  const resume = readJson(path.join(fbs, 'workbuddy-resume.json'));

  const title =
    (resume && (resume.bookTitle || resume.title)) || '（书名未登记）';
  const stage = pickStage(esm, resume);
  const wordHint =
    resume && typeof resume.wordCount === 'number'
      ? `总字数约：${resume.wordCount}`
      : '总字数：（见章节与正文）';
  const generatedAt = new Date().toISOString();

  const dashboard = [
    '━━━━━━ 书稿进度 ━━━━━━',
    `📖 ${title}  阶段：${stage}`,
    wordHint,
    '章节与质检：见下方节选 / 完整台账见 .fbs/chapter-status.md',
    '━━━━━━━━━━━━━━━━━━━━',
  ].join('\n');

  const body = [
    '# 书稿进度快照（抽查用）',
    '',
    `> 由 \`scripts/write-progress-snapshot.mjs\` 生成于 ${generatedAt}。`,
    '> 用途：对照技能包 `references/01-core/ux-optimization-rules.md` §E 仪表盘示例做**人工抽查**；非打包门禁。',
    '',
    '```',
    dashboard,
    '```',
    '',
    '## chapter-status 节选',
    '',
    chapter.trim() ? chapter.slice(0, 3500) : '（无 `.fbs/chapter-status.md`）',
    '',
    '## esm-state 节选',
    '',
    esm.trim() ? esm.slice(0, 2000) : '（无 `.fbs/esm-state.md`）',
    '',
  ].join('\n');

  return { content: body, outPath: path.join(fbs, 'progress-snapshot.md'), dashboard };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`用法: node scripts/write-progress-snapshot.mjs --book-root <书稿根> [--json]`);
    process.exit(0);
  }

  const { content, outPath, dashboard } = buildProgressSnapshotContent(path.resolve(args.bookRoot));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content, 'utf8');

  if (args.json) {
    console.log(JSON.stringify({ ok: true, path: outPath, dashboard }, null, 2));
  } else {
    console.log(`已写入 ${outPath}`);
  }
}

if (process.argv[1] && process.argv[1].includes('write-progress-snapshot')) {
  main();
}
