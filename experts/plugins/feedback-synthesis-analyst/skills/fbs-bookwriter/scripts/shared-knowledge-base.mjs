#!/usr/bin/env node
/**
 * 共享知识库校验（测试报告 07）：核对 .fbs 下并行写作核心工件是否存在、可读。
 * 非云端知识库；「共享」指本书工作区内 team-lead 维护的单一真相文件。
 *
 * 用法：
 *   node scripts/shared-knowledge-base.mjs --book-root <本书根>
 *   node scripts/shared-knowledge-base.mjs --book-root <本书根> --json
 *
 * 退出码：0 关键文件齐全；1 有缺失；2 参数错误
 */
import fs from "fs";
import path from "path";

function parseArgs(argv) {
  const o = { bookRoot: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = argv[++i];
    else if (a === "--json") o.json = true;
  }
  return o;
}

function statSafe(p) {
  try {
    const s = fs.statSync(p);
    return { exists: true, bytes: s.size };
  } catch {
    return { exists: false, bytes: 0 };
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error("用法: node scripts/shared-knowledge-base.mjs --book-root <本书根> [--json]");
    process.exit(2);
  }
  const root = path.resolve(args.bookRoot);
  const fbs = path.join(root, ".fbs");
  const keys = [
    { key: "glossary", rel: "GLOSSARY.md", required: true },
    { key: "bookContextBrief", rel: "book-context-brief.md", required: true },
    { key: "chapterStatus", rel: "chapter-status.md", required: true },
    { key: "chapterDependencies", rel: "chapter-dependencies.json", required: true },
    // 以下6项与 init-fbs-multiagent-artifacts.mjs 创建的完整13工件对齐
    { key: "projectConfig", rel: "project-config.json", required: true },
    { key: "rateBudget", rel: "rate-budget.json", required: true },
    { key: "highQualityDomains", rel: "high-quality-domains.json", required: false },
    { key: "materialLibrary", rel: "material-library.md", required: false },
    { key: "authorMeta", rel: "author-meta.md", required: false },
    { key: "insightCards", rel: "insight-cards.md", required: false },
    { key: "searchLedger", rel: "search-ledger.jsonl", required: false },
    { key: "taskQueue", rel: "task-queue.json", required: false },
    { key: "memberHeartbeats", rel: "member-heartbeats.json", required: false },
  ];
  const rootStatus = statSafe(path.join(root, "chapter-status.md"));

  const files = {};
  let missingRequired = false;
  for (const k of keys) {
    const p = path.join(fbs, k.rel);
    const st = statSafe(p);
    files[k.key] = { path: p, ...st, required: k.required };
    if (k.required && !st.exists) missingRequired = true;
  }

  const out = {
    ok: !missingRequired,
    bookRoot: root,
    fbsDir: fbs,
    rootChapterStatusMirror: {
      path: path.join(root, "chapter-status.md"),
      ...rootStatus,
      note: "测试报告 01 常扫项目根；init 可写入与 .fbs/chapter-status.md 相同模板",
    },
    files,
    hint: missingRequired
      ? "请运行: node scripts/init-fbs-multiagent-artifacts.mjs --book-root <本书根>"
      : "可选: node scripts/sync-book-chapter-index.mjs --book-root <本书根> --json-out .fbs/chapter-scan-result.json",
  };

  if (args.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log("shared-knowledge-base:", root);
    console.log(missingRequired ? "  状态: 有 P0 文件缺失" : "  状态: 核心共享文件齐全");
    for (const k of keys) {
      const f = files[k.key];
      const mark = f.exists ? "✅" : f.required ? "❌" : "—";
      console.log(`  ${mark} ${k.rel}${f.required ? " (必选)" : ""}`);
    }
    if (rootStatus.exists) console.log("  ✅ chapter-status.md（项目根镜像）");
    else console.log("  — chapter-status.md（项目根）未创建（可选，见 init）");
  }
  process.exit(missingRequired ? 1 : 0);
}

main();
