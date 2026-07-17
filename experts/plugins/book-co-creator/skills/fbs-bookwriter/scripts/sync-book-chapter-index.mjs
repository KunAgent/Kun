#!/usr/bin/env node
/**
 * 扫描本书根目录下章节 MD，对照 .fbs/chapter-dependencies.json 声明，生成/更新事实台账（测试报告 01 对齐）。
 *
 * 用法：
 *   node scripts/sync-book-chapter-index.mjs --book-root <本书根>
 *   node scripts/sync-book-chapter-index.mjs --book-root <本书根> --write-status   # 合并写入 .fbs/chapter-status.md 表格体
 *   node scripts/sync-book-chapter-index.mjs --book-root <本书根> --json-out .fbs/chapter-scan-result.json
 *   [--flat-only]  仅扫描本书根一层（默认递归子目录 *.md）
 *
 * 退出码：0 全部匹配；1 有声明章节未找到文件；2 参数错误
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { listDraftMd, matchContains } from "./lib/chapter-md-resolve.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const o = { bookRoot: null, writeStatus: false, jsonOut: null, flatOnly: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = argv[++i];
    else if (a === "--write-status") o.writeStatus = true;
    else if (a === "--json-out") o.jsonOut = argv[++i];
    else if (a === "--flat-only") o.flatOnly = true;
  }
  return o;
}

function loadDeps(fbs) {
  const p = path.join(fbs, "chapter-dependencies.json");
  if (!fs.existsSync(p)) return { chapters: [], raw: null, path: p, missing: true };
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return { chapters: Array.isArray(j.chapters) ? j.chapters : [], raw: j, path: p, missing: false };
  } catch {
    return { chapters: [], raw: null, path: p, corrupt: true };
  }
}

function isPlaceholderDeps(deps) {
  const warning = String(deps?.raw?._warning || "");
  if (/示例数据|全部替换为实际章节/.test(warning)) return true;

  return Array.isArray(deps?.chapters) && deps.chapters.length > 0 && deps.chapters.every((ch) => {
    const combined = `${ch?.title || ""}${ch?.fileNameContains || ""}`;
    return /示例/.test(combined);
  });
}

function inferChapterFromFile(filePath) {
  const base = path.basename(filePath);
  if (!/\.md$/i.test(base)) return null;

  const stem = base.replace(/\.md$/i, "");
  const s3Match = stem.match(/^\[S[\d.]+-Ch(\d+)\]\s*(.*)$/i);
  if (s3Match) {
    const digits = String(Number(s3Match[1])).padStart(2, "0");
    const title = s3Match[2]?.trim() || stem;
    return {
      id: `ch${digits}`,
      title,
      fileNameContains: title || stem,
      matchedFiles: [base],
      fileFound: true,
      dependsOn: [],
      batch: null,
      inferred: true,
    };
  }

  const genericMatch = stem.match(/(^|[^a-z])ch0*(\d+)([^a-z]|$)/i);
  if (genericMatch) {
    const digits = String(Number(genericMatch[2])).padStart(2, "0");
    return {
      id: `ch${digits}`,
      title: stem,
      fileNameContains: stem,
      matchedFiles: [base],
      fileFound: true,
      dependsOn: [],
      batch: null,
      inferred: true,
    };
  }

  return null;
}

function inferChaptersFromFiles(files) {
  const seen = new Set();
  const inferred = [];

  for (const filePath of files) {
    const chapter = inferChapterFromFile(filePath);
    if (!chapter) continue;

    const key = chapter.id || chapter.matchedFiles[0];
    if (seen.has(key)) continue;
    seen.add(key);
    inferred.push(chapter);
  }

  return inferred;
}


function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error(
      "用法: node scripts/sync-book-chapter-index.mjs --book-root <本书根> [--write-status] [--json-out <path>] [--flat-only]"
    );
    process.exit(2);
  }
  const root = path.resolve(args.bookRoot);
  const fbs = path.join(root, ".fbs");
  const scanOpts = { recursive: !args.flatOnly };
  const files = listDraftMd(root, scanOpts);
  const deps = loadDeps(fbs);

  const result = {
    scannedAt: new Date().toISOString(),
    bookRoot: root,
    mdScanRecursive: scanOpts.recursive,
    mdFilesInRoot: files.map((p) => path.basename(p)),
    chapters: [],
    allResolved: true,
  };

  const declaredChapters = deps.chapters.map((ch) => {
    const hint = ch.fileNameContains || ch.title || ch.id || "";
    const matched = matchContains(files, hint);
    const ok = matched.length > 0;
    return {
      id: ch.id || null,
      title: ch.title || null,
      fileNameContains: hint,
      matchedFiles: matched.map((p) => path.basename(p)),
      fileFound: ok,
      dependsOn: ch.dependsOn || [],
      batch: ch.batch ?? null,
    };
  });

  const shouldFallbackToInferred = isPlaceholderDeps(deps) &&
    declaredChapters.length > 0 &&
    declaredChapters.every((ch) => !ch.fileFound);

  if (shouldFallbackToInferred) {
    const inferredChapters = inferChaptersFromFiles(files);
    if (inferredChapters.length > 0) {
      result.placeholderDepsFallback = true;
      result.chapters.push(...inferredChapters);
    } else {
      result.allResolved = false;
      result.chapters.push(...declaredChapters);
    }
  } else {
    for (const chapter of declaredChapters) {
      if (!chapter.fileFound) result.allResolved = false;
      result.chapters.push(chapter);
    }
  }


  if (deps.missing) {
    console.log("sync-book-chapter-index: 未找到 chapter-dependencies.json，仅列出根目录 MD：");
    console.log(result.mdFilesInRoot.join("\n") || "(无)");
    process.exit(0);
  }

  console.log("sync-book-chapter-index:", root);
  if (result.placeholderDepsFallback) {
    console.log("  ℹ 检测到示例 chapter-dependencies，已按磁盘章节实况推断索引");
  }

  for (const c of result.chapters) {
    const mark = c.fileFound ? "✅" : "❌";
    console.log(`  ${mark} ${c.id || c.title} ← 包含「${c.fileNameContains}」→`, c.matchedFiles.join(", ") || "(无)");
  }

  if (args.jsonOut) {
    const outp = path.isAbsolute(args.jsonOut) ? args.jsonOut : path.join(root, args.jsonOut);
    fs.mkdirSync(path.dirname(outp), { recursive: true });
    fs.writeFileSync(outp, JSON.stringify(result, null, 2) + "\n", "utf8");
    console.log("wrote:", outp);
  }

  if (args.writeStatus) {
    const statusPath = path.join(fbs, "chapter-status.md");

    // 读取已有台账中人工维护的"状态"列，以章节ID为键缓存
    const existingStatus = {};
    if (fs.existsSync(statusPath)) {
      const old = fs.readFileSync(statusPath, "utf8");
      for (const line of old.split(/\r?\n/)) {
        // 匹配表格行：| chId | ... | ... | ... | 状态 | ... |
        const m = /^\|\s*([^\|]+?)\s*\|(?:[^\|]*\|){3}\s*([^\|]+?)\s*\|/.exec(line);
        if (m && m[1] !== "章节ID" && m[1] !== "------") {
          existingStatus[m[1].trim()] = m[2].trim();
        }
      }
    }

    const lines = [
      "# 章节完成状态台账（由 sync-book-chapter-index 生成，可手工改状态列）",
      "",
      `最后扫描：${result.scannedAt}`,
      "",
      "| 章节ID | 匹配文件 | 磁盘存在 | 依赖 | 状态 | 质量自检(综合/10) |",
      "|--------|----------|----------|------|------|-------------------|",
    ];
    for (const c of result.chapters) {
      const fn = c.matchedFiles[0] || "—";
      const ex = c.fileFound ? "是" : "否";
      const dep = (c.dependsOn && c.dependsOn.length) ? c.dependsOn.join(",") : "—";
      // 优先保留人工维护的状态列；仅在章节不存在时才置默认值
      const key = (c.id || c.title || "").trim();
      const st = existingStatus[key] || (c.fileFound ? "待核对" : "❌ 缺稿");
      lines.push(`| ${c.id || "—"} | ${fn} | ${ex} | ${dep} | ${st} |  |`);
    }
    fs.mkdirSync(fbs, { recursive: true });
    fs.writeFileSync(statusPath, lines.join("\n") + "\n", "utf8");
    console.log("wrote:", statusPath);

    // 规范要求：同步将只读快照写出到本书根（单向：.fbs → 本书根）
    const snapshotPath = path.join(root, "chapter-status.md");
    const snapshotLines = [
      "# 章节完成状态台账（本书根快照，只读）",
      "<!-- SNAPSHOT: 本文件为只读快照，权威来源在 .fbs/chapter-status.md -->",
      "<!-- 请勿直接编辑本文件；如需更新请修改 .fbs/chapter-status.md 后执行同步脚本 -->",
      "",
      ...lines.slice(1),
    ];
    fs.writeFileSync(snapshotPath, snapshotLines.join("\n") + "\n", "utf8");
    console.log("snapshot wrote:", snapshotPath);
  }

  process.exit(result.allResolved ? 0 : 1);
}

main();
