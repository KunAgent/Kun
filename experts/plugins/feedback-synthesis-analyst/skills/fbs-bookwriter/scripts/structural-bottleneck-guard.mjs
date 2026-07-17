#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { createHash } from "crypto";

function parseArgs(argv) {
  const o = {
    skillRoot: process.cwd(),
    bookRoot: null,
    warnKb: 120,
    warnLines: 1200,
    failKb: 320,
    failLines: 3200,
    maxTaskQueue: 200,
    maxCheckpoints: 80,
    maxLedgerMb: 30,
    retentionDays: 30,
    enforce: false,
    jsonOut: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--skill-root") o.skillRoot = argv[++i];
    else if (a === "--book-root") o.bookRoot = argv[++i];
    else if (a === "--warn-kb") o.warnKb = Number(argv[++i] || o.warnKb);
    else if (a === "--warn-lines") o.warnLines = Number(argv[++i] || o.warnLines);
    else if (a === "--fail-kb") o.failKb = Number(argv[++i] || o.failKb);
    else if (a === "--fail-lines") o.failLines = Number(argv[++i] || o.failLines);
    else if (a === "--max-task-queue") o.maxTaskQueue = Number(argv[++i] || o.maxTaskQueue);
    else if (a === "--max-checkpoints") o.maxCheckpoints = Number(argv[++i] || o.maxCheckpoints);
    else if (a === "--max-ledger-mb") o.maxLedgerMb = Number(argv[++i] || o.maxLedgerMb);
    else if (a === "--retention-days") o.retentionDays = Number(argv[++i] || o.retentionDays);
    else if (a === "--json-out") o.jsonOut = argv[++i];
    else if (a === "--enforce") o.enforce = true;
  }
  return o;
}

function safeReadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function scanLargeFiles(skillRoot, cfg) {
  const skipDirs = new Set([
    "node_modules",
    ".git",
    "dist",
    "test-unzip",
    "final-test",
    "qc-output",
    ".codebuddy",
    ".codebuddy-plugin",
  ]);
  const fileExts = new Set([".md", ".mjs", ".js", ".json"]);
  const rows = [];

  const workflowBases = [
    skillRoot,
    path.join(skillRoot, "FBS-BookWriter"),
  ];

  const hasWorkflowSplitCoverage = (baseRoot) => {
    const splitDir = path.join(baseRoot, "references", "01-core", "workflow-volumes");
    const slimEntry = path.join(baseRoot, "references", "01-core", "section-3-workflow.md");
    const fullEntry = path.join(baseRoot, "references", "01-core", "section-3-workflow.full.md");
    if (!fs.existsSync(splitDir) || !fs.existsSync(slimEntry) || !fs.existsSync(fullEntry)) return false;
    try {
      const volumeCount = fs.readdirSync(splitDir).filter((x) => x.endsWith(".md")).length;
      const slimEntryKb = fs.statSync(slimEntry).size / 1024;
      return volumeCount >= 8 && slimEntryKb <= 16;
    } catch {
      return false;
    }
  };

  const workflowFullExempt = workflowBases.some(hasWorkflowSplitCoverage);


  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (skipDirs.has(e.name)) continue;
        walk(path.join(dir, e.name));
        continue;
      }
      if (!e.isFile()) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(skillRoot, full).replace(/\\/g, "/");
      const ext = path.extname(full).toLowerCase();
      if (!fileExts.has(ext)) continue;

      if (rel === "package-lock.json") continue;
      if (workflowFullExempt && (rel === "references/01-core/section-3-workflow.full.md" || rel === "FBS-BookWriter/references/01-core/section-3-workflow.full.md")) continue;


      const size = fs.statSync(full).size;
      const kb = size / 1024;
      let lines = 0;
      try {
        lines = fs.readFileSync(full, "utf8").split(/\r?\n/).length;
      } catch {
        lines = -1;
      }

      const isLocalUserConfig = rel === "scene-packs/user-config.json";
      const warnLines =
        rel === "scripts/wecom/scene-pack-admin.mjs"
          ? Math.max(cfg.warnLines, 1800)
          : isLocalUserConfig
            ? Math.max(cfg.warnLines, 2500)
            : cfg.warnLines;
      const failLines =
        rel === "scripts/wecom/scene-pack-admin.mjs"
          ? Math.max(cfg.failLines, 3600)
          : cfg.failLines;

      let level =
        kb >= cfg.failKb || lines >= failLines
          ? "fail"
          : kb >= cfg.warnKb || lines >= warnLines
            ? "warn"
            : "ok";
      // user-config.json 是本地自动生成资产（已 .gitignore），过大不应阻断发版。
      if (isLocalUserConfig && level === "fail") level = "warn";
      if (level !== "ok") {
        rows.push({
          file: rel,
          kb: Number(kb.toFixed(1)),
          lines,
          level,
        });
      }
    }
  };

  walk(skillRoot);
  rows.sort((a, b) => b.kb - a.kb || b.lines - a.lines);
  return rows;
}


function inspectRuntime(bookRoot, cfg) {
  const out = { warnings: [], failures: [], metrics: {} };
  if (!bookRoot) return out;

  const root = path.resolve(bookRoot);
  const fbs = path.join(root, ".fbs");
  if (!fs.existsSync(fbs)) {
    out.warnings.push("book-root 下未发现 .fbs，跳过运行态堵点检查");
    return out;
  }

  const queuePath = path.join(fbs, "task-queue.json");
  if (fs.existsSync(queuePath)) {
    const q = safeReadJson(queuePath);
    let pending = 0;
    if (Array.isArray(q)) pending = q.length;
    else if (q && Array.isArray(q.tasks)) pending = q.tasks.length;
    out.metrics.taskQueuePending = pending;
    if (pending > cfg.maxTaskQueue) out.failures.push(`task-queue 待处理 ${pending} > ${cfg.maxTaskQueue}`);
    else if (pending > Math.floor(cfg.maxTaskQueue * 0.7)) out.warnings.push(`task-queue 接近拥塞：${pending}/${cfg.maxTaskQueue}`);
  }

  const hbPath = path.join(fbs, "member-heartbeats.json");
  if (fs.existsSync(hbPath)) {
    const hb = safeReadJson(hbPath) || {};
    const members = hb && hb.members && typeof hb.members === "object" ? hb.members : {};
    const ids = Object.keys(members);
    let critical = 0;
    const now = Date.now();
    for (const id of ids) {
      const ts = Date.parse(String(members[id]?.lastHeartbeat || ""));
      if (!Number.isFinite(ts) || now - ts > 15 * 60 * 1000) critical += 1;
    }
    out.metrics.heartbeatMembers = ids.length;
    out.metrics.heartbeatCritical = critical;
    if (critical > 0) out.failures.push(`心跳超时成员 ${critical} 个（>15m）`);
  }

  const cpDir = path.join(fbs, "checkpoints");
  if (fs.existsSync(cpDir) && fs.statSync(cpDir).isDirectory()) {
    const count = fs.readdirSync(cpDir).filter((x) => x.endsWith(".checkpoint.json")).length;
    out.metrics.checkpointCount = count;
    if (count > cfg.maxCheckpoints) out.failures.push(`checkpoints 数量 ${count} > ${cfg.maxCheckpoints}`);
    else if (count > Math.floor(cfg.maxCheckpoints * 0.7)) out.warnings.push(`checkpoints 偏多：${count}/${cfg.maxCheckpoints}`);
  }

  const ledgerPath = path.join(fbs, "search-ledger.jsonl");
  if (fs.existsSync(ledgerPath)) {
    const mb = fs.statSync(ledgerPath).size / 1024 / 1024;
    out.metrics.searchLedgerMb = Number(mb.toFixed(2));
    if (mb > cfg.maxLedgerMb) out.failures.push(`search-ledger 过大 ${mb.toFixed(2)}MB > ${cfg.maxLedgerMb}MB`);
    else if (mb > cfg.maxLedgerMb * 0.7) out.warnings.push(`search-ledger 接近阈值 ${mb.toFixed(2)}MB/${cfg.maxLedgerMb}MB`);
  }

  const runsDir = path.join(fbs, "audit-runs");
  if (fs.existsSync(runsDir) && fs.statSync(runsDir).isDirectory()) {
    const cutoff = Date.now() - cfg.retentionDays * 24 * 60 * 60 * 1000;
    const dirs = fs.readdirSync(runsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    let overdue = 0;
    for (const d of dirs) {
      const m = fs.statSync(path.join(runsDir, d.name)).mtimeMs;
      if (m < cutoff) overdue += 1;
    }
    out.metrics.auditRunsTotal = dirs.length;
    out.metrics.auditRunsOverdue = overdue;
    if (overdue > 20) out.failures.push(`audit-runs 过期目录过多：${overdue}`);
    else if (overdue > 0) out.warnings.push(`audit-runs 存在过期目录：${overdue}（建议清理）`);

    const indexPath = path.join(runsDir, "index.json");
    if (!fs.existsSync(indexPath)) out.warnings.push("audit-runs 缺少 index.json（可追溯性下降）");
  }

  return out;
}

function inspectLockfilePolicy(skillRoot, bookRoot) {
  const out = { warnings: [], failures: [], metrics: {} };
  const root = path.resolve(skillRoot);
  const lockPath = path.join(root, "package-lock.json");
  if (!fs.existsSync(lockPath)) {
    out.warnings.push("未发现 package-lock.json，跳过 lockfile 策略检查");
    return out;
  }

  const sizeKb = fs.statSync(lockPath).size / 1024;
  out.metrics.lockfileSizeKb = Number(sizeKb.toFixed(1));

  const summaryPath = bookRoot
    ? path.join(path.resolve(bookRoot), ".fbs", "lockfile-summary.json")
    : path.join(root, ".fbs", "lockfile-summary.json");

  if (!fs.existsSync(summaryPath)) {
    if (sizeKb >= 80) out.warnings.push("lockfile 较大但缺少摘要，建议运行 npm run lockfile:summary");
    return out;
  }

  const summary = safeReadJson(summaryPath);
  if (!summary) {
    out.warnings.push("lockfile-summary.json 解析失败，建议重新生成");
    return out;
  }

  const currentHash16 = createHash("sha256").update(fs.readFileSync(lockPath, "utf8")).digest("hex").slice(0, 16);
  out.metrics.lockfileHash16 = currentHash16;
  out.metrics.lockfileSummaryPath = summaryPath;

  if (summary.contentHash16 !== currentHash16) {
    out.warnings.push("lockfile 摘要已过期（hash 不一致），建议更新摘要");
  }

  const genTs = Date.parse(String(summary.generatedAt || ""));
  if (Number.isFinite(genTs)) {
    const ageDays = (Date.now() - genTs) / (24 * 60 * 60 * 1000);
    out.metrics.lockfileSummaryAgeDays = Number(ageDays.toFixed(1));
    if (ageDays > 14) out.warnings.push(`lockfile 摘要超过 14 天（${ageDays.toFixed(1)}d）`);
  }

  return out;
}

function buildRefactorBacklog(report) {
  const items = [];
  for (const row of report.largeFilesTop) {
    if (row.file.endsWith("section-3-workflow.full.md")) {
      items.push({
        target: row.file,
        priority: "P1",
        goal: "将全量历史文档拆为阶段分卷，保留统一入口",
        actions: [
          "按 S0/S1/S2/S3/S4/S5/S6 生成分卷文件",
          "入口文件仅保留导航与关键命令",
          "新增索引锚点映射，保持旧引用可回溯"
        ],
        guardrail: "不删除 full 文件，先完成双轨兼容"
      });
      continue;
    }
    if (row.file.endsWith("package-lock.json")) {
      items.push({
        target: row.file,
        priority: "P2",
        goal: "抑制锁文件膨胀对评审与检索的干扰",
        actions: [
          "依赖变更按批次提交，避免高频抖动",
          "CI 中只对 lockfile 变更做差异摘要",
          "仅在依赖升级窗口更新锁文件"
        ],
        guardrail: "不手工编辑 lockfile"
      });
      continue;
    }
    if (row.file.endsWith("scripts/onboarding-system.mjs")) {
      items.push({
        target: row.file,
        priority: "P0",
        goal: "拆分学习路径/状态存储/进度计算，降低单文件复杂度",
        actions: [
          "提取 OnboardingStore（读写与持久化）",
          "提取 OnboardingProgress（进度与测评分）",
          "保留 OnboardingSystem 作为门面类，外部接口不变"
        ],
        guardrail: "对外类名与方法签名保持兼容"
      });
      continue;
    }
    if (row.file.endsWith("scripts/ux-optimization-enhanced.mjs")) {
      items.push({
        target: row.file,
        priority: "P0",
        goal: "拆分并发控制/进度反馈/内存治理模块",
        actions: [
          "提取 UxConcurrencyController",
          "提取 UxProgressReporter",
          "提取 UxMemoryManager，主控制器只做编排"
        ],
        guardrail: "现有 CLI 与调用入口保持不变"
      });
      continue;
    }
  }
  return items;
}

function main() {
  const args = parseArgs(process.argv);
  const skillRoot = path.resolve(args.skillRoot || process.cwd());
  const bookRoot = args.bookRoot ? path.resolve(args.bookRoot) : null;

  const largeFiles = scanLargeFiles(skillRoot, args);
  const runtime = inspectRuntime(bookRoot, args);
  const lockfile = inspectLockfilePolicy(skillRoot, bookRoot);

  const largeWarn = largeFiles.filter((x) => x.level === "warn").length;
  const largeFail = largeFiles.filter((x) => x.level === "fail").length;

  const report = {
    generatedAt: new Date().toISOString(),
    skillRoot,
    bookRoot,
    thresholds: {
      warnKb: args.warnKb,
      warnLines: args.warnLines,
      failKb: args.failKb,
      failLines: args.failLines,
      maxTaskQueue: args.maxTaskQueue,
      maxCheckpoints: args.maxCheckpoints,
      maxLedgerMb: args.maxLedgerMb,
      retentionDays: args.retentionDays,
    },
    summary: {
      largeFilesWarn: largeWarn,
      largeFilesFail: largeFail,
      runtimeWarnings: runtime.warnings.length,
      runtimeFailures: runtime.failures.length,
      lockfileWarnings: lockfile.warnings.length,
      lockfileFailures: lockfile.failures.length,
    },
    largeFilesTop: largeFiles.slice(0, 20),
    runtime,
    lockfile,
  };

  report.refactorBacklog = buildRefactorBacklog(report);

  console.log("structural-bottleneck-guard:");
  console.log(`- 大文件告警: ${largeWarn}, 大文件阻断: ${largeFail}`);
  console.log(`- 重构待办: ${report.refactorBacklog.length}`);
  if (runtime.warnings.length) runtime.warnings.forEach((w) => console.log(`- ⚠ ${w}`));
  if (lockfile.warnings.length) lockfile.warnings.forEach((w) => console.log(`- ⚠ ${w}`));
  if (runtime.failures.length) runtime.failures.forEach((f) => console.log(`- ✖ ${f}`));
  if (lockfile.failures.length) lockfile.failures.forEach((f) => console.log(`- ✖ ${f}`));

  const outPath = args.jsonOut
    ? path.resolve(args.jsonOut)
    : bookRoot
      ? path.join(bookRoot, ".fbs", "structural-bottleneck-report.json")
      : null;

  if (outPath) {
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
      console.log(`- 报告已输出: ${outPath}`);
    } catch (e) {
      console.log(`- ⚠ 报告输出失败: ${e.message}`);
    }
  }

  if (args.enforce && (largeFail > 0 || runtime.failures.length > 0 || lockfile.failures.length > 0)) process.exit(1);
  process.exit(0);
}

main();
