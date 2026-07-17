#!/usr/bin/env node
/**
 * S4 章节合并（跨平台 Node，替代 bash/bat，避免 Windows 下 $ 与 shell 嵌套问题）
 *
 * 用法：
 *   node scripts/merge-chapters.mjs --book-root <本书根> --output <输出.md> [--glob "<glob>"] [--dry-run] [--no-backup]
 *
 * 若输出文件已存在：默认先复制为 *.merge-backup-<UTC时间戳>.md 再覆盖（可用 --no-backup 关闭）。
 * --dry-run 仅打印预计合并范围与字符数，不写盘。
 * --record-artifacts 合并成功后写入 `.fbs/merge-chapters.last.json`（便于与 release-governor / 台账对齐；不自动改 chapter-status）。
 *
 * 默认 glob：相对于 book-root 的 chapters 下全部 md；若不存在则回退为按文件名匹配的 S3 章节模式（见 pickDefaultGlob）
 */
import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';
import { upsertBookSnippetIndex } from './lib/fbs-book-snippet-index.mjs';

function parseArgs(argv) {
  const o = {
    bookRoot: process.cwd(),
    output: null,
    glob: null,
    title: null,
    dryRun: false,
    noBackup: false,
    recordArtifacts: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') o.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--output' || a === '-o') o.output = argv[++i];
    else if (a === '--glob' || a === '-g') o.glob = argv[++i];
    else if (a === '--title') o.title = argv[++i];
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--no-backup') o.noBackup = true;
    else if (a === '--record-artifacts') o.recordArtifacts = true;
  }
  return o;
}

function countNonWhitespaceChars(s) {
  return String(s).replace(/\s+/g, '').length;
}

function backupIfExists(outAbs, noBackup) {
  if (noBackup || !fs.existsSync(outAbs)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${outAbs}.merge-backup-${stamp}.md`;
  try {
    fs.copyFileSync(outAbs, bak);
    return bak;
  } catch {
    return null;
  }
}

function pickDefaultGlob(root) {
  const chapters = path.join(root, 'chapters');
  if (fs.existsSync(chapters)) return 'chapters/**/*.md';
  return '**/[S3-Ch*.md';
}

function recordMergeArtifacts(bookRoot, payload) {
  const fbs = path.join(bookRoot, '.fbs');
  try {
    fs.mkdirSync(fbs, { recursive: true });
    fs.writeFileSync(path.join(fbs, 'merge-chapters.last.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  } catch {
    /* ignore */
  }
}

function naturalSortPaths(paths) {
  return [...paths].sort((a, b) =>
    path.basename(a).localeCompare(path.basename(b), 'zh-Hans-CN', { numeric: true }),
  );
}

function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(args.bookRoot);
  if (!fs.existsSync(root)) {
    console.error('merge-chapters: book-root 不存在');
    process.exit(2);
  }
  if (!args.output) {
    console.error('merge-chapters: 请指定 --output <文件.md>');
    process.exit(2);
  }
  const outAbs = path.isAbsolute(args.output) ? args.output : path.join(root, args.output);
  const pattern = args.glob || pickDefaultGlob(root);
  let files = globSync(pattern, {
    cwd: root,
    absolute: true,
    nodir: true,
    ignore: ['**/node_modules/**', '**/.git/**', '**/.fbs/**', '**/qc-output/**'],
  }).filter((f) => f.toLowerCase().endsWith('.md'));

  files = naturalSortPaths(files);
  if (!files.length) {
    console.error(`merge-chapters: glob「${pattern}」下未找到 .md`);
    process.exit(1);
  }

  const iso = new Date().toISOString();
  const title = args.title || path.basename(outAbs, '.md');
  const chunks = [`# ${title} - 全稿`, '', `> 生成时间（UTC）：${iso}`, '', '---', ''];

  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    chunks.push(`<!-- source: ${rel} -->`, '');
    chunks.push(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trimEnd());
    chunks.push('', '');
  }

  const body = chunks.join('\n');
  const mergedNonWs = countNonWhitespaceChars(body);

  if (args.dryRun) {
    console.log(
      `[dry-run] merge-chapters: 将合并 ${files.length} 个源文件 → ${outAbs}；` +
        `预计本输出文件非空白字符约 ${mergedNonWs}（口径：合并稿全文；与单章台账/扩写门禁字数可能不同）`,
    );
    return;
  }

  const bakPath = backupIfExists(outAbs, args.noBackup);
  if (bakPath) {
    console.log(`merge-chapters: 已备份既有输出 → ${bakPath}`);
  }

  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, body, 'utf8');
  console.log(
    `merge-chapters: 已合并 ${files.length} 个源文件 → ${outAbs}；` +
      `本输出文件非空白字符约 ${mergedNonWs}（口径：本次合并稿全文；与 chapter-status 单列字数可能因范围不同而不一致）`,
  );
  if (args.recordArtifacts) {
    recordMergeArtifacts(root, {
      schemaVersion: '1.0.0',
      mergedAt: iso,
      bookRoot: root,
      outputPath: outAbs,
      outputRelative: path.relative(root, outAbs).replace(/\\/g, '/'),
      sourceFileCount: files.length,
      mergedNonWhitespaceChars: mergedNonWs,
      globPattern: pattern,
      sourcesSample: files.slice(0, 8).map((f) => path.relative(root, f).replace(/\\/g, '/')),
      hint:
        '合并记录已写入 .fbs/merge-chapters.last.json。终稿登记请仍走 release-governor / final-draft-state-machine；台账字数可运行 sync-chapter-status-chars。',
    });
    console.log('merge-chapters: 已记录合并元数据 → .fbs/merge-chapters.last.json');
  }
  try {
    upsertBookSnippetIndex(root);
  } catch {
    /* 索引更新失败不阻塞合并 */
  }
}

main();
