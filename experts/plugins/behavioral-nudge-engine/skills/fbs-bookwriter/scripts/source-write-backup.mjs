#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { globSync } from "glob";

function parseArgs(argv) {
  const out = {
    bookRoot: null,
    scope: "all",
    json: false,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") out.bookRoot = path.resolve(argv[++i] || "");
    else if (a === "--scope") out.scope = String(argv[++i] || "all").toLowerCase();
    else if (a === "--json") out.json = true;
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

function makeStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function normalizeRel(file, root) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function collectSourceFiles(bookRoot, scope) {
  const pick = new Set();
  const addMatches = (pattern) => {
    const hits = globSync(pattern, {
      cwd: bookRoot,
      nodir: true,
      absolute: true,
      ignore: ["**/node_modules/**", "**/.git/**", "**/backups/**"],
    });
    for (const hit of hits) pick.add(path.resolve(hit));
  };

  addMatches("chapters/**/*.md");
  addMatches("*.md");

  const keep = [];
  for (const file of pick) {
    const rel = normalizeRel(file, bookRoot);
    const isChapterRoot = /^\[S3.*\].*\.md$/i.test(path.basename(rel));
    const isChapterDir = /^chapters\/.+\.md$/i.test(rel);
    const isExpandedTemp = /\.expanded\.md$/i.test(rel);
    if (isExpandedTemp) continue;
    if (scope === "expansion" && !(isChapterRoot || isChapterDir)) continue;
    if (scope === "refinement" && !(isChapterRoot || isChapterDir)) continue;
    if (scope === "all" && !(isChapterRoot || isChapterDir)) continue;
    keep.push(path.resolve(file));
  }

  const fbsPinned = [
    ".fbs/chapter-status.md",
    ".fbs/esm-state.md",
    ".fbs/expansion-plan.md",
    ".fbs/workbuddy-resume.json",
  ];
  for (const rel of fbsPinned) {
    const abs = path.join(bookRoot, rel);
    if (fs.existsSync(abs)) keep.push(abs);
  }

  return [...new Set(keep)].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export function runSourceWriteBackup({ bookRoot, scope = "all", dryRun = false } = {}) {
  if (!bookRoot) return { code: 2, message: "missing --book-root", files: [] };
  if (!fs.existsSync(bookRoot)) return { code: 2, message: "book-root not exists", files: [] };

  const normalizedScope = ["all", "expansion", "refinement"].includes(scope) ? scope : "all";
  const files = collectSourceFiles(bookRoot, normalizedScope);
  if (!files.length) {
    return { code: 1, message: "no source files matched for backup", files: [] };
  }

  const stamp = makeStamp();
  const backupRoot = path.join(bookRoot, "backups", stamp);
  const copied = [];
  if (!dryRun) fs.mkdirSync(backupRoot, { recursive: true });
  for (const abs of files) {
    const rel = normalizeRel(abs, bookRoot);
    const dst = path.join(backupRoot, rel);
    if (!dryRun) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(abs, dst);
    }
    copied.push(rel);
  }

  return {
    code: 0,
    message: dryRun ? "dry-run backup plan ready" : "backup created",
    backupDir: backupRoot,
    scope: normalizedScope,
    count: copied.length,
    files: copied,
    dryRun,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const out = runSourceWriteBackup({
    bookRoot: args.bookRoot,
    scope: args.scope,
    dryRun: args.dryRun,
  });
  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
  } else if (out.code === 0) {
    console.log(
      `[source-write-backup] ${out.message}: ${out.count} files -> ${out.backupDir} (scope=${out.scope}${out.dryRun ? ", dry-run" : ""})`,
    );
  } else {
    console.error(`[source-write-backup] ${out.message}`);
  }
  process.exit(out.code);
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith("source-write-backup.mjs")) {
  main();
}
