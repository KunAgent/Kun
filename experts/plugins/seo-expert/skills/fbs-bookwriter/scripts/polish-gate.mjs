#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { globSync } from "glob";
import { runSourceWriteBackup } from "./source-write-backup.mjs";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 为 quality-auditor-lite 选择首个能命中章节正文的 glob（WorkBuddy 实测：仅传 --book-root 会 Usage 失败） */
export function resolvePolishGateQualityGlob(bookRoot) {
  const root = path.resolve(bookRoot);
  const patterns = [
    "chapters/**/*.md",
    "manuscript/**/*.md",
    "全稿/**/*.md",
    "deliverables/**/*.md",
    "**/*.md",
  ];
  for (const g of patterns) {
    try {
      const n = globSync(g, {
        cwd: root,
        nodir: true,
        windowsPathsNoEscape: true,
        ignore:
          g === "**/*.md"
            ? ["**/node_modules/**", "**/.fbs/**", "**/references/**", "**/scene-packs/**", "**/dist/**"]
            : undefined,
      });
      if (n.length > 0) return g;
    } catch {
      // continue
    }
  }
  return "chapters/**/*.md";
}

function makeStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function normalizeRel(file, root) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function backupSingleFile(targetFile, bookRoot) {
  const stamp = makeStamp();
  const baseRoot = bookRoot && fs.existsSync(bookRoot) ? path.resolve(bookRoot) : path.dirname(path.resolve(targetFile));
  const backupDir = path.join(baseRoot, "backups", stamp);
  const abs = path.resolve(targetFile);
  const rel = abs.startsWith(baseRoot) ? normalizeRel(abs, baseRoot) : path.basename(abs);
  const dst = path.join(backupDir, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(abs, dst);
  return {
    code: 0,
    message: "backup created",
    backupDir,
    scope: "single-file",
    count: 1,
    files: [rel],
    dryRun: false,
  };
}

function pickLatestByMtime(files) {
  const sorted = [...files].sort((a, b) => {
    const sa = fs.statSync(a).mtimeMs;
    const sb = fs.statSync(b).mtimeMs;
    return sb - sa;
  });
  return sorted[0] || null;
}

function resolveFinalManuscriptFile(bookRoot) {
  const root = path.resolve(bookRoot);
  const candidates = globSync("releases/**/*.md", {
    cwd: root,
    absolute: true,
    nodir: true,
    windowsPathsNoEscape: true,
    ignore: ["**/node_modules/**", "**/.git/**"],
  });
  if (!candidates.length) return null;
  const finalNamed = candidates.filter((f) => /终稿|final/i.test(path.basename(f)));
  return pickLatestByMtime(finalNamed.length ? finalNamed : candidates);
}

function safeReadJson(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function summarizeQuality(raw) {
  const summary = {
    total: Number(raw?.total) || 0,
    passed: Number(raw?.passed) || 0,
    failed: Number(raw?.failed) || 0,
    avgScore: Number(raw?.avgScore) || 0,
  };
  return {
    ...summary,
    belowThreshold: summary.failed,
    conclusion: summary.failed > 0 ? `${summary.failed}/${summary.total} below threshold` : "all passed",
  };
}

function resolveExecutionPlan({ inputPath, bookRoot, target }) {
  const normalizedTarget = String(target || "auto").toLowerCase();
  const absInput = inputPath ? path.resolve(inputPath) : null;
  const hasInput = !!(absInput && fs.existsSync(absInput));
  const inputIsFile = hasInput && fs.statSync(absInput).isFile();
  const inputIsDir = hasInput && fs.statSync(absInput).isDirectory();

  if (inputIsFile) {
    return {
      mode: "single-file",
      bookRoot: bookRoot ? path.resolve(bookRoot) : path.dirname(absInput),
      files: [absInput],
      glob: null,
      target: "single-file",
    };
  }

  const effectiveBookRoot = bookRoot
    ? path.resolve(bookRoot)
    : inputIsDir
      ? absInput
      : process.cwd();
  if (!fs.existsSync(effectiveBookRoot)) {
    return { error: `book-root not exists: ${effectiveBookRoot}` };
  }

  if (normalizedTarget === "final-manuscript") {
    const finalFile = resolveFinalManuscriptFile(effectiveBookRoot);
    if (!finalFile) {
      return { error: "missing final manuscript under releases/" };
    }
    return {
      mode: "single-file",
      bookRoot: effectiveBookRoot,
      files: [finalFile],
      glob: null,
      target: "final-manuscript",
    };
  }

  if (normalizedTarget === "deliverables") {
    return {
      mode: "book-root",
      bookRoot: effectiveBookRoot,
      files: [],
      glob: "deliverables/**/*.md",
      target: "deliverables",
    };
  }

  if (normalizedTarget === "auto") {
    return {
      mode: "book-root",
      bookRoot: effectiveBookRoot,
      files: [],
      glob: resolvePolishGateQualityGlob(effectiveBookRoot),
      target: "auto",
    };
  }

  return { error: `unsupported --target: ${target}` };
}

function parseArgs(argv) {
  const out = {
    bookRoot: null,
    inputPath: null,
    jsonOut: null,
    target: "auto",
    sourceBackup: true,
    backupScope: "refinement",
    withQualityAudit: true,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") out.bookRoot = path.resolve(argv[++i] || "");
    else if (a === "--json-out") out.jsonOut = path.resolve(argv[++i] || "");
    else if (a === "--target") out.target = String(argv[++i] || "auto").toLowerCase();
    else if (a === "--backup") out.sourceBackup = true;
    else if (a === "--no-backup") out.sourceBackup = false;
    else if (a === "--no-source-backup") out.sourceBackup = false;
    else if (a === "--backup-scope") out.backupScope = String(argv[++i] || "refinement").toLowerCase();
    else if (a === "--no-quality-audit") out.withQualityAudit = false;
    else if (!a.startsWith("--") && !out.inputPath) out.inputPath = a;
  }
  return out;
}

export function runPolishGate({
  inputPath = null,
  bookRoot,
  target = "auto",
  jsonOut = null,
  sourceBackup = true,
  backupScope = "refinement",
  withQualityAudit = true,
} = {}) {
  const emitJson = (payload) => {
    if (!jsonOut) return payload;
    try {
      fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true });
      fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(payload, null, 2) + "\n", "utf8");
    } catch {
      // ignore
    }
    return payload;
  };
  const plan = resolveExecutionPlan({ inputPath, bookRoot, target });
  if (plan.error) return emitJson({ code: 2, message: plan.error, plan: null });
  const effectiveBookRoot = plan.bookRoot;
  const qualityJsonOut = path.resolve(
    jsonOut || path.join(effectiveBookRoot, "qc-output", "polish-gate-quality-lite.json"),
  );
  let backup = null;
  if (sourceBackup) {
    backup =
      plan.mode === "single-file"
        ? backupSingleFile(plan.files[0], effectiveBookRoot)
        : runSourceWriteBackup({ bookRoot: effectiveBookRoot, scope: backupScope });
    if (backup.code !== 0) {
      return emitJson({ code: 2, message: `source backup failed: ${backup.message}`, backup, plan });
    }
  }
  if (!withQualityAudit) {
    return emitJson({
      code: 0,
      message: "quality audit skipped",
      backup,
      plan,
      quality: { total: 0, passed: 0, failed: 0, avgScore: 0, belowThreshold: 0, conclusion: "skipped" },
      qualityJsonOut,
      completed: true,
    });
  }

  const qaArgs = [path.join(__dirname, "quality-auditor-lite.mjs"), "--book-root", effectiveBookRoot];
  if (plan.mode === "single-file") {
    qaArgs.push(plan.files[0]);
  } else {
    qaArgs.push("--glob", plan.glob || resolvePolishGateQualityGlob(effectiveBookRoot));
  }
  qaArgs.push("--json-out", qualityJsonOut);

  const r = spawnSync(
    process.execPath,
    qaArgs,
    {
      stdio: "inherit",
    },
  );
  const qaExitCode = typeof r.status === "number" ? r.status : 1;
  const qaJson = safeReadJson(qualityJsonOut);
  const quality = summarizeQuality(qaJson);
  const executionError = qaExitCode === 2 || !qaJson;
  const nextActionSuggestion =
    !executionError && quality.belowThreshold > 0
      ? `检测到 ${quality.belowThreshold} 项未达标，是否自动精修？[是/否/查看详情]`
      : null;

  return emitJson({
    code: executionError ? 2 : 0,
    message: executionError ? "quality audit execution failed" : quality.conclusion,
    completed: !executionError,
    qualityAuditExitCode: qaExitCode,
    qualityJsonOut,
    quality,
    qualityComparabilityNote:
      "评分与文本范围绑定：终稿（合并稿）与单章（deliverables）结果不宜直接横向比较，应分别解读。",
    nextActionSuggestion,
    plan,
    backup,
  });
}

function writeGateSnapshot(bookRoot, result) {
  try {
    const gatesDir = path.join(bookRoot, ".fbs", "gates");
    fs.mkdirSync(gatesDir, { recursive: true });
    fs.writeFileSync(
      path.join(gatesDir, "polish-gate.last.json"),
      JSON.stringify({ gateId: "polish-gate", updatedAt: new Date().toISOString(), ...result }, null, 2) + "\n",
      "utf8",
    );
  } catch {
    // ignore
  }
}

function writeResultJson(jsonOutPath, payload) {
  if (!jsonOutPath) return;
  try {
    fs.mkdirSync(path.dirname(jsonOutPath), { recursive: true });
    fs.writeFileSync(jsonOutPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  } catch {
    // ignore
  }
}

function main() {
  const args = parseArgs(process.argv);
  const out = runPolishGate(args);
  const snapshotRoot = out?.plan?.bookRoot || args.bookRoot;
  if (snapshotRoot) writeGateSnapshot(snapshotRoot, out);
  writeResultJson(args.jsonOut, out);
  if (out.backup?.backupDir) {
    console.log(`[polish-gate] source backup -> ${out.backup.backupDir} (${out.backup.count} files)`);
  }
  if (out.completed && out.quality) {
    const q = out.quality;
    if (q.belowThreshold > 0) {
      console.log(
        `[polish-gate] completed: ${q.belowThreshold}/${q.total} chapters below threshold (avg ${q.avgScore}/10), 可继续按未达标章节精修`,
      );
    } else {
      console.log(`[polish-gate] completed: ${q.total}/${q.total} passed (avg ${q.avgScore}/10)`);
    }
  } else {
    console.log(`[polish-gate] ${out.message}`);
  }
  process.exit(out.code);
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith("polish-gate.mjs")) {
  main();
}
