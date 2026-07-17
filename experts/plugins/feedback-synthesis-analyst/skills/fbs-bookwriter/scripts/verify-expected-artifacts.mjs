#!/usr/bin/env node
/**
 * 本书根目录 S0–S6 编号产出物 + 虚拟书房三层目录磁盘核验。
 * 用途：WorkBuddy 等宿主可能仅提示「生成失败 unknown」，错误信息不进 Skill；以落盘文件为真值。
 *
 * 用法（在任意目录执行，须指明本书根）：
 *   node scripts/verify-expected-artifacts.mjs --book-root <本书根>
 *   node scripts/verify-expected-artifacts.mjs --book-root . --expect-s0 --since-minutes 45 --strict
 *   node scripts/verify-expected-artifacts.mjs --book-root . --expect-chapter 3 --min-bytes 200 --strict
 *   node scripts/verify-expected-artifacts.mjs --book-root . --expect-deliverables --expect-releases --strict
 *   node scripts/verify-expected-artifacts.mjs --book-root . --expect-feedback --strict
 *
 * 选项：

 *   --book-root <dir>       必填，成书工作区根（含 [S*] *.md 的目录）
 *   --min-bytes <n>         视为「非空」的最小字节数（默认 80）
 *   --since-minutes <n>     与 --expect-* 联用：要求匹配文件在 n 分钟内有修改
 *   --expect-s0             要求至少存在一个非空的 [S0]*.md
 *   --expect-chapter <n>    要求存在 [S3-ChNN] 第 n 章对应文件（NN 为一位或两位数字）
 *   --expect-deliverables   要求 `deliverables/` 至少存在一个交付文件
 *   --expect-releases       要求 `releases/` 至少存在一个 `*-release.json`
 *   --expect-feedback       要求 `.fbs/org-feedback/` 至少存在一条回流记录
 *   --strict                若 --expect-* 未满足则 exit 1

 *   --fail-on-zero-byte     任意 [S0]–[S6] 前缀的 .md 若为 0 字节则 exit 1（可与上面联用）
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {
    bookRoot: null,
    minBytes: 80,
    sinceMinutes: null,
    expectS0: false,
    expectChapter: null,
    expectDeliverables: false,
    expectReleases: false,
    strict: false,
    failOnZeroByte: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root" && argv[i + 1]) {
      out.bookRoot = path.resolve(argv[++i]);
    } else if (a === "--min-bytes" && argv[i + 1]) {
      out.minBytes = Math.max(0, Number(argv[++i]) || 0);
    } else if (a === "--since-minutes" && argv[i + 1]) {
      out.sinceMinutes = Math.max(0, Number(argv[++i]) || 0);
    } else if (a === "--expect-s0") {
      out.expectS0 = true;
    } else if (a === "--expect-chapter" && argv[i + 1]) {
      out.expectChapter = Math.max(1, parseInt(argv[++i], 10) || 0);
    } else if (a === "--expect-deliverables") {
      out.expectDeliverables = true;
    } else if (a === "--expect-releases") {
      out.expectReleases = true;
    } else if (a === "--strict") {
      out.strict = true;
    } else if (a === "--fail-on-zero-byte") {
      out.failOnZeroByte = true;
    }

  }
  return out;
}

const STAGE_PREFIX_RE = /^\[(S0|S1|S2\.5|S2|S3-Ch\d+|S4|S5|S6)\]/i;

function listStageMarkdown(bookRoot) {
  if (!fs.existsSync(bookRoot) || !fs.statSync(bookRoot).isDirectory()) {
    return { error: `book-root 不是目录: ${bookRoot}` };
  }
  const names = fs.readdirSync(bookRoot);
  const rows = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const full = path.join(bookRoot, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (!STAGE_PREFIX_RE.test(name)) continue;
    rows.push({
      name,
      full,
      size: st.size,
      mtimeMs: st.mtimeMs,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "en"));
  return { rows };
}

function listRuntimeArtifacts(bookRoot) {
  const fbsDir = path.join(bookRoot, ".fbs");
  const deliverablesDir = path.join(bookRoot, "deliverables");
  const releasesDir = path.join(bookRoot, "releases");

  const safeList = (dir, predicate) => {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
    return fs.readdirSync(dir)
      .filter((name) => predicate(name, path.join(dir, name)))
      .map((name) => path.join(dir, name));
  };

  return {
    fbsDir,
    deliverablesDir,
    releasesDir,
    deliverables: safeList(deliverablesDir, (name, fullPath) => {
      if (!fs.statSync(fullPath).isFile()) return false;
      return name.endsWith(".md") || name.endsWith(".html") || name.endsWith("-package.json");
    }),
    releaseManifests: safeList(releasesDir, (name, fullPath) => {
      if (!fs.statSync(fullPath).isFile()) return false;
      return name.endsWith("-release.json");
    }),
  };
}


function extractChapterNum(filename) {
  const m = /\[S3-Ch(\d+)\]/i.exec(filename);
  return m ? parseInt(m[1], 10) : null;
}

function matchesExpectChapter(filename, n) {
  const num = extractChapterNum(filename);
  return num === n;
}

function withinSince(mtimeMs, sinceMinutes) {
  if (sinceMinutes == null) return true;
  const cutoff = Date.now() - sinceMinutes * 60 * 1000;
  return mtimeMs >= cutoff;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.bookRoot) {
    console.error("须指定 --book-root <本书根目录>");
    process.exit(2);
  }

  const res = listStageMarkdown(opts.bookRoot);
  if (res.error) {
    console.error(res.error);
    process.exit(2);
  }

  const { rows } = res;
  const runtimeArtifacts = listRuntimeArtifacts(opts.bookRoot);
  console.log(`verify-expected-artifacts: 本书根 ${opts.bookRoot}`);
  console.log(`编号产出物（[S0]–[S6] 前缀 .md，仅扫描本书根一层）共 ${rows.length} 个：`);
  for (const r of rows) {
    const ageMin = ((Date.now() - r.mtimeMs) / 60000).toFixed(1);
    const flag = r.size < opts.minBytes ? " ⚠ 小于 min-bytes" : r.size === 0 ? " ⚠ 空文件" : "";
    console.log(`  ${r.size}\tbytes\t~${ageMin} min ago\t${r.name}${flag}`);
  }

  console.log("三层目录摘要：");
  console.log(`  .fbs/        \t${fs.existsSync(runtimeArtifacts.fbsDir) ? "存在" : "缺失"}`);
  console.log(`  deliverables/\t${fs.existsSync(runtimeArtifacts.deliverablesDir) ? `存在（${runtimeArtifacts.deliverables.length} 个交付文件）` : "缺失"}`);
  console.log(`  releases/    \t${fs.existsSync(runtimeArtifacts.releasesDir) ? `存在（${runtimeArtifacts.releaseManifests.length} 个发布清单）` : "缺失"}`);
  console.log("首个可用工作面：");
  console.log("  WP2 书稿工作面\t.fbs/ + deliverables/ + releases/");
  console.log("  真值状态文件\t.fbs/esm-state.md / .fbs/规范执行状态.md / .fbs/chapter-status.md");
  console.log("运行时契约快照：");
  console.log(`  entry-contract\t${fs.existsSync(path.join(runtimeArtifacts.fbsDir, 'entry-contract.json')) ? '存在' : '缺失'}`);
  console.log(`  workspace-gov\t${fs.existsSync(path.join(runtimeArtifacts.fbsDir, 'workspace-governance.json')) ? '存在' : '缺失'}`);

  let exitCode = 0;


  const failures = [];


  if (opts.failOnZeroByte) {
    for (const r of rows) {
      if (r.size === 0) failures.push(`零字节: ${r.name}`);
    }
  }

  if (opts.expectS0) {
    const s0 = rows.filter((r) => /^\[S0\]/i.test(r.name) && r.size >= opts.minBytes);
    const recent = s0.filter((r) => withinSince(r.mtimeMs, opts.sinceMinutes));
    const ok = opts.sinceMinutes != null ? recent.length > 0 : s0.length > 0;
    if (!ok) {
      failures.push(
        opts.sinceMinutes != null
          ? `--expect-s0：最近 ${opts.sinceMinutes} 分钟内无满足 min-bytes 的 [S0]*.md`
          : `--expect-s0：无满足 min-bytes 的 [S0]*.md`
      );
    }
  }

  if (opts.expectChapter != null) {
    const n = opts.expectChapter;
    const ch = rows.filter(
      (r) => matchesExpectChapter(r.name, n) && r.size >= opts.minBytes && withinSince(r.mtimeMs, opts.sinceMinutes)
    );
    if (ch.length === 0) {
      const tail =
        opts.sinceMinutes != null ? `，且须在 ${opts.sinceMinutes} 分钟内更新` : "";
      failures.push(`--expect-chapter ${n}：无匹配的 [S3-Ch…] 且满足 min-bytes${tail}`);
    }
  }

  if (opts.expectDeliverables && runtimeArtifacts.deliverables.length === 0) {
    failures.push("--expect-deliverables：deliverables/ 中未发现 md/html/package 交付物");
  }

  if (opts.expectReleases && runtimeArtifacts.releaseManifests.length === 0) {
    failures.push("--expect-releases：releases/ 中未发现 *-release.json 发布清单");
  }

  if (opts.expectFeedback && runtimeArtifacts.feedbackRecords.length === 0) {
    failures.push("--expect-feedback：.fbs/org-feedback/ 中未发现组织反馈回流记录");
  }

  if (failures.length) {


    console.error("—— 未通过 ——");
    failures.forEach((f) => console.error("  ✖ " + f));
    if (opts.strict) {
      exitCode = 1;
    } else if (opts.failOnZeroByte && failures.some((f) => f.startsWith("零字节"))) {
      exitCode = 1;
    }
  } else {
    console.log("核验：未发现上述硬性失败项（仍请人工打开文件确认内容质量）。");
  }

  process.exit(exitCode);
}

main();
