#!/usr/bin/env node
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const TEXT_EXTS = new Set([".md", ".txt", ".json", ".jsonl", ".log", ".csv", ".yaml", ".yml"]);
const DEFAULT_INCLUDE_DIRS = new Set(["audit", "checkpoints", "reports"]);

function parseArgs(argv) {
  const o = {
    bookRoot: null,
    olderThanDays: 14,
    maxTotalMb: 128,
    dryRun: false,
    json: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = path.resolve(argv[++i] || "");
    else if (a === "--older-than-days") o.olderThanDays = Number(argv[++i] || 14);
    else if (a === "--max-total-mb") o.maxTotalMb = Number(argv[++i] || 128);
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--json") o.json = true;
  }
  return o;
}

function listFilesRecursive(rootDir) {
  const out = [];
  const walk = (dir) => {
    const ents = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of ents) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "archive") continue;
        walk(full);
        continue;
      }
      if (ent.isFile()) out.push(full);
    }
  };
  if (fs.existsSync(rootDir)) walk(rootDir);
  return out;
}

function shouldConsiderFile(fbsDir, fullPath) {
  const rel = path.relative(fbsDir, fullPath).replace(/\\/g, "/");
  if (rel.includes("/")) {
    const top = rel.split("/")[0];
    if (DEFAULT_INCLUDE_DIRS.has(top)) return true;
  }
  return rel.endsWith(".jsonl") || rel.endsWith(".log");
}

function ensureParent(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function archiveTargetPath(fbsDir, srcFullPath) {
  const rel = path.relative(fbsDir, srcFullPath).replace(/\\/g, "/");
  const ym = new Date().toISOString().slice(0, 7);
  return path.join(fbsDir, "archive", ym, rel);
}

function gzipFileTo(src, dst) {
  const raw = fs.readFileSync(src);
  const gz = zlib.gzipSync(raw, { level: 9 });
  ensureParent(path.dirname(dst));
  fs.writeFileSync(dst, gz);
}

export function runFbsAutoArchive({
  bookRoot,
  olderThanDays = 14,
  maxTotalMb = 128,
  dryRun = false,
}) {
  const root = path.resolve(bookRoot || process.cwd());
  const fbsDir = path.join(root, ".fbs");
  fs.mkdirSync(fbsDir, { recursive: true });
  const files = listFilesRecursive(fbsDir)
    .filter((p) => shouldConsiderFile(fbsDir, p))
    .map((p) => {
      const st = fs.statSync(p);
      return {
        file: p,
        rel: path.relative(fbsDir, p).replace(/\\/g, "/"),
        size: st.size,
        mtimeMs: st.mtimeMs,
      };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  const now = Date.now();
  const cutoff = now - Math.max(0, Number(olderThanDays) || 0) * 24 * 60 * 60 * 1000;
  const totalMb = Number((files.reduce((a, b) => a + b.size, 0) / 1024 / 1024).toFixed(2));

  const candidates = files.filter((x) => x.mtimeMs < cutoff);
  let projectedBytes = files.reduce((a, b) => a + b.size, 0);
  const targetBytes = Math.max(0, Number(maxTotalMb) || 128) * 1024 * 1024;
  for (const f of files) {
    if (projectedBytes <= targetBytes) break;
    if (candidates.find((c) => c.file === f.file)) continue;
    candidates.push(f);
    projectedBytes -= f.size;
  }

  const actions = [];
  for (const item of candidates) {
    const ext = path.extname(item.file).toLowerCase();
    const dstBase = archiveTargetPath(fbsDir, item.file);
    const useGzip = TEXT_EXTS.has(ext);
    const dst = useGzip ? `${dstBase}.gz` : dstBase;
    actions.push({
      src: item.file,
      rel: item.rel,
      size: item.size,
      sizeMb: Number((item.size / 1024 / 1024).toFixed(2)),
      mode: useGzip ? "gzip+remove" : "move",
      dst,
    });
  }

  const executed = [];
  if (!dryRun) {
    for (const a of actions) {
      if (a.mode === "gzip+remove") {
        gzipFileTo(a.src, a.dst);
        fs.unlinkSync(a.src);
      } else {
        ensureParent(path.dirname(a.dst));
        fs.renameSync(a.src, a.dst);
      }
      executed.push({ rel: a.rel, mode: a.mode, dst: path.relative(fbsDir, a.dst).replace(/\\/g, "/") });
    }
  }

  const report = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    root,
    policy: { olderThanDays, maxTotalMb, dryRun: !!dryRun },
    before: { trackedFiles: files.length, totalMb },
    candidates: actions.map((a) => ({ rel: a.rel, sizeMb: a.sizeMb, mode: a.mode })),
    archivedCount: dryRun ? 0 : executed.length,
    archived: executed,
  };
  const reportPath = path.join(fbsDir, "archive", "archive-report.json");
  ensureParent(path.dirname(reportPath));
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  return { code: 0, message: "ok", reportPath, ...report };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error("用法: node scripts/fbs-auto-archive.mjs --book-root <本书根> [--older-than-days 14] [--max-total-mb 128] [--dry-run] [--json]");
    process.exit(2);
  }
  const out = runFbsAutoArchive(args);
  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`[fbs-auto-archive] ${out.message}`);
    console.log(`[fbs-auto-archive] before: files=${out.before.trackedFiles} total=${out.before.totalMb}MB`);
    console.log(`[fbs-auto-archive] candidates=${out.candidates.length} archived=${out.archivedCount}`);
    console.log(`[fbs-auto-archive] report=${out.reportPath}`);
  }
  process.exit(out.code);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
