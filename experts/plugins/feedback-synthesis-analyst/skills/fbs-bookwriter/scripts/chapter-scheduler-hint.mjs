#!/usr/bin/env node
/**
 * 依赖图调度提示（只读）：根据 chapter-dependencies.json + chapter-scan-result.json
 * 提示「可派发批次」（测试报告 01·06·10 对齐；不自动调用宿主 API）。
 *
 * 前置：先运行 sync-book-chapter-index.mjs --json-out .fbs/chapter-scan-result.json
 *
 * 用法：
 *   node scripts/chapter-scheduler-hint.mjs --book-root <本书根>
 */
import fs from "fs";
import path from "path";

function parseArgs(argv) {
  const o = { bookRoot: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--book-root") o.bookRoot = argv[++i];
  }
  return o;
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`
chapter-scheduler-hint.mjs — 章节调度提示工具（只读）

用法:
  node scripts/chapter-scheduler-hint.mjs --book-root <本书根>

选项:
  --book-root <路径>   书稿工程根目录（必填）
  -h, --help           显示此帮助

前置依赖（BUG-006）:
  ⚠️  本工具依赖两个数据文件，缺少任一均无法运行：
      1. .fbs/chapter-dependencies.json  — 章节依赖图（手动维护，见 S2 阶段）
      2. .fbs/chapter-scan-result.json   — 章节扫描结果（由下方命令生成）

  在运行本工具之前，必须先执行：
    node scripts/sync-book-chapter-index.mjs --book-root <本书根> --json-out .fbs/chapter-scan-result.json

  如果缺少 chapter-dependencies.json，请先编辑 .fbs/chapter-dependencies.json，
  按实际章节填写 id / fileNameContains / dependsOn / batch 字段
  （初始模板由 init-fbs-multiagent-artifacts.mjs 生成，内含示例数据）。

输出说明:
  ✓  已有稿件（无需派发）
  ✅ 依赖已齐、本稿未写 — team-lead 可派发 Writer
  ⏳ 等待依赖章节成稿
  ?  scan 结果未找到对应章节（检查 fileNameContains 是否匹配）

注意: 本工具只读，不派发任何任务；派发须由 team-lead 在宿主内完成。
`);
    process.exit(0);
  }

  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error("用法: node scripts/chapter-scheduler-hint.mjs --book-root <本书根>\n       --help 查看前置依赖说明");
    process.exit(2);
  }
  const root = path.resolve(args.bookRoot);
  const fbs = path.join(root, ".fbs");
  const depsPath = path.join(fbs, "chapter-dependencies.json");
  const scanPath = path.join(fbs, "chapter-scan-result.json");

  if (!fs.existsSync(depsPath)) {
    console.error("缺少", depsPath);
    process.exit(2);
  }
  let scan = { chapters: [] };
  if (fs.existsSync(scanPath)) {
    scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  } else {
    console.error("请先运行: node scripts/sync-book-chapter-index.mjs --book-root", root, "--json-out .fbs/chapter-scan-result.json");
    process.exit(2);
  }

  const deps = JSON.parse(fs.readFileSync(depsPath, "utf8"));
  const list = Array.isArray(deps.chapters) ? deps.chapters : [];
  const byId = Object.fromEntries((scan.chapters || []).map((c) => [c.id, c]));

  /** 本稿缺失且全部依赖章已有文件 → team-lead 可派发 */
  function canDispatch(ch) {
    const id = ch.id;
    if (!id) return false;
    const row = byId[id];
    if (row && row.fileFound) return false;
    for (const d of ch.dependsOn || []) {
      const dr = byId[d];
      if (!dr || !dr.fileFound) return false;
    }
    return true;
  }

  console.log("chapter-scheduler-hint（仅提示，需 team-lead 在宿主内派发）:\n");
  const batches = new Map();
  for (const ch of list) {
    const b = ch.batch ?? 0;
    if (!batches.has(b)) batches.set(b, []);
    batches.get(b).push(ch);
  }
  const sortedB = [...batches.keys()].sort((a, b) => a - b);
  for (const b of sortedB) {
    const rows = batches.get(b);
    const names = rows.map((c) => c.id).filter(Boolean);
    console.log(`批次 ${b}:`, names.join(", ") || "(无 id)");
    for (const ch of rows) {
      const unmet = (ch.dependsOn || []).filter((d) => {
        const r = byId[d];
        return !r || !r.fileFound;
      });
      if (byId[ch.id]?.fileFound) {
        console.log(`  ✓ ${ch.id} 已有稿件`);
      } else if (unmet.length) {
        console.log(`  ⏳ ${ch.id} 等待依赖成稿: ${unmet.join(", ")}`);
      } else if (canDispatch(ch)) {
        console.log(`  ✅ ${ch.id} 依赖已齐、本稿未写 — 可派发 Writer`);
      } else {
        console.log(`  ? ${ch.id} 待核对 scan 结果`);
      }
    }
    console.log("");
  }
}

main();
