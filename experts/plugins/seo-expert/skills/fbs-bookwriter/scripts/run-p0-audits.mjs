#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { appendBookStateEvent, appendGateResult } from "./lib/book-state-db.mjs";
import { runFbsAutoArchive } from "./fbs-auto-archive.mjs";
import { runBookStateWeeklyExport } from "./book-state-weekly-export.mjs";
import { runMidtermGovernanceReport } from "./midterm-governance-report.mjs";
import { runMidtermMilestoneReport } from "./midterm-milestone-report.mjs";

/** 未传 --skill-root 时：以本脚本所在目录推断技能根（避免从书稿目录执行时 cwd 误指向 book-root） */
const DEFAULT_SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const o = {
    skillRoot: null,
    bookRoot: null,
    strict: false,
    parallel: false,
    noQueryOpt: false,
    noPendingVerification: false,
    noBrokenLinks: false,
    noStructureGuard: false,
    noScenePackCheck: false,
    noEntryGate: false,
    noVisibleTechKpi: false,
    noToolOutputBudget: false,
    noContentSafetyPrecheck: false,
    noPluginCapabilitySnapshot: false,
    noPluginRoutingKpi: false,
    noNorthstarKpi: false,
    noWritingContract: false,
    noExpansionGate: false,
    noRetroSync: false,
    noFileGrowthGuard: false,
    noReleaseGovernor: false,
    noFinalManuscriptCleanGate: false,
    noFbsAutoArchive: false,
    noBookStateWeeklyExport: false,
    noMidtermGovernance: false,
    noMidtermMilestone: false,
    brokenLinksChannel: "user",
  };
  const positionals = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--skill-root") o.skillRoot = argv[++i];
    else if (a === "--book-root") o.bookRoot = argv[++i];
    else if (a === "--strict") o.strict = true;
    else if (a === "--parallel") o.parallel = true;
    else if (a === "--no-writing-contract") o.noWritingContract = true;
    else if (a === "--no-expansion-gate") o.noExpansionGate = true;
    else if (a === "--no-retro-sync") o.noRetroSync = true;
    else if (a === "--no-file-growth-guard") o.noFileGrowthGuard = true;
    else if (a === "--no-release-governor") o.noReleaseGovernor = true;
    else if (a === "--no-final-manuscript-clean-gate") o.noFinalManuscriptCleanGate = true;
    else if (a === "--no-fbs-auto-archive") o.noFbsAutoArchive = true;
    else if (a === "--no-book-state-weekly-export") o.noBookStateWeeklyExport = true;
    else if (a === "--no-midterm-governance") o.noMidtermGovernance = true;
    else if (a === "--no-midterm-milestone") o.noMidtermMilestone = true;
    else if (a === "--no-query-opt") o.noQueryOpt = true;
    else if (a === "--no-pending-verification") o.noPendingVerification = true;
    else if (a === "--no-broken-links") o.noBrokenLinks = true;
    else if (a === "--no-structure-guard") o.noStructureGuard = true;
    else if (a === "--no-scene-pack-check") o.noScenePackCheck = true;
    else if (a === "--no-entry-gate") o.noEntryGate = true;
    else if (a === "--no-visible-tech-kpi") o.noVisibleTechKpi = true;
    else if (a === "--no-tool-output-budget") o.noToolOutputBudget = true;
    else if (a === "--no-content-safety-precheck") o.noContentSafetyPrecheck = true;
    else if (a === "--no-plugin-capability-snapshot") o.noPluginCapabilitySnapshot = true;
    else if (a === "--no-plugin-routing-kpi") o.noPluginRoutingKpi = true;
    else if (a === "--no-northstar-kpi") o.noNorthstarKpi = true;
    else if (a === "--broken-links-channel") o.brokenLinksChannel = argv[++i] || "user";
    else if (!a.startsWith("-")) positionals.push(a);
  }
  if (!o.bookRoot && positionals.length > 0) o.bookRoot = positionals[0];
  return o;
}

function runNode(scriptPath, args) {
  const r = spawnSync(process.execPath, [scriptPath, ...args], { stdio: "inherit" });
  return typeof r.status === "number" ? r.status : 2;
}

function runNodeAsync(scriptPath, args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [scriptPath, ...args], { stdio: "inherit" });
    p.on("close", (code) => resolve(typeof code === "number" ? code : 1));
  });
}

function writeAuditReport(bookRoot, report) {
  try {
    const fbsDir = path.join(bookRoot, ".fbs");
    fs.mkdirSync(fbsDir, { recursive: true });
    const out = path.join(fbsDir, "p0-audit-report.json");
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n", "utf8");
    return out;
  } catch (error) {
    console.error(`[P0-Audit] 写入结构化报告失败: ${error.message}`);
    return null;
  }
}

function resolveRetroSourceReport(bookRoot) {
  const fbsDir = path.join(bookRoot, ".fbs");
  const retroItems = path.join(fbsDir, "retro-action-items.json");
  if (fs.existsSync(retroItems)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(retroItems, "utf8"));
      if (typeof parsed.sourceReport === "string" && parsed.sourceReport.trim()) {
        return path.resolve(parsed.sourceReport.trim());
      }
    } catch {
      // ignore and fallback
    }
  }
  if (!fs.existsSync(fbsDir)) return null;
  const candidates = fs
    .readdirSync(fbsDir)
    .filter((name) => /^福帮手运行复盘报告.*\.md$/i.test(name))
    .map((name) => path.join(fbsDir, name))
    .filter((abs) => fs.statSync(abs).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0] || null;
}

function resolveLatestFinalManuscript(bookRoot) {
  const releasesDir = path.join(bookRoot, "releases");
  if (!fs.existsSync(releasesDir)) return null;
  const candidates = fs
    .readdirSync(releasesDir)
    .filter((name) => /\.md$/i.test(name) && /(终稿|全稿|final)/i.test(name))
    .map((name) => path.join(releasesDir, name))
    .filter((abs) => fs.statSync(abs).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0] || null;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error(
      "用法: node scripts/run-p0-audits.mjs (--book-root <本书根> | <本书根>) [--skill-root <技能根>] " +
        "[--strict] [--parallel] [--experimental：并行仅跑 1–4 步，输出可能交错] [--no-retro-sync] [--no-fbs-auto-archive] [--no-book-state-weekly-export] [--no-midterm-governance] [--no-midterm-milestone] [--no-release-governor] [--no-final-manuscript-clean-gate] [--no-file-growth-guard] [--no-query-opt] [--no-pending-verification] [--no-broken-links] [--no-structure-guard] [--no-scene-pack-check] [--no-entry-gate] [--no-visible-tech-kpi] [--no-tool-output-budget] [--no-content-safety-precheck] [--no-plugin-capability-snapshot] [--no-plugin-routing-kpi] [--no-northstar-kpi] [--no-writing-contract] [--no-expansion-gate] [--broken-links-channel user|all]\n" +
        "说明: 本书根可作为首个位置参数传入（与 --book-root 等价）。省略 --skill-root 时默认使用本脚本所在技能包根目录（勿依赖当前工作目录）。"
    );
    process.exit(2);
  }

  const skillRoot = path.resolve(args.skillRoot ?? DEFAULT_SKILL_ROOT);
  const bookRoot = path.resolve(args.bookRoot);
  const scriptsRoot = path.resolve(skillRoot, "scripts");
  const startedAt = new Date().toISOString();
  const steps = [];
  const sourceReport = resolveRetroSourceReport(bookRoot);

  const report = {
    schemaVersion: "1.0.0",
    generatedAt: startedAt,
    skillRoot,
    bookRoot,
    strict: !!args.strict,
    parallel: !!args.parallel,
    sourceReport,
    steps,
    totals: {
      all: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
    },
    status: "running",
    exitCode: null,
  };

  const addStep = ({ id, label, status, reason = null, code = null, evidence = {} }) => {
    const item = {
      id,
      label,
      status,
      reason,
      code,
      evidence,
      finishedAt: new Date().toISOString(),
    };
    steps.push(item);
    try {
      appendGateResult({
        bookRoot,
        gateId: id,
        status,
        code,
        reason,
        evidence,
      });
    } catch {
      // 轻索引写入失败不影响主流程
    }
    return item;
  };

  const finalizeAndExit = (exitCode) => {
    report.totals.all = steps.length;
    report.totals.passed = steps.filter((x) => x.status === "passed").length;
    report.totals.failed = steps.filter((x) => x.status === "failed").length;
    report.totals.skipped = steps.filter((x) => x.status === "skipped").length;
    report.status = exitCode === 0 ? "passed" : "failed";
    report.exitCode = exitCode;
    report.completedAt = new Date().toISOString();
    const reportPath = writeAuditReport(bookRoot, report);
    try {
      appendBookStateEvent({
        bookRoot,
        source: "run-p0-audits",
        eventType: "p0_audit_finished",
        level: exitCode === 0 ? "info" : "warn",
        payload: {
          exitCode,
          status: report.status,
          totals: report.totals,
          reportPath: reportPath || null,
        },
      });
    } catch {
      // ignore
    }
    if (reportPath) {
      console.log(`[P0-Audit] 结构化报告: ${reportPath}`);
    }
    process.exit(exitCode);
  };

  if (!args.noRetroSync) {
    console.log("[P0-Audit] 0/10 retro-action-sync (enforce unresolved P0)");
    const rArgs = ["--book-root", bookRoot, "--enforce-p0", "--allow-missing-report"];
    const rCode = runNode(path.join(scriptsRoot, "retro-action-sync.mjs"), rArgs);
    addStep({
      id: "retro-sync",
      label: "retro-action-sync",
      status: rCode === 0 ? "passed" : "failed",
      reason: rCode === 0 ? "复盘整改同步完成或允许跳过" : "检测到未修复 P0 或同步失败",
      code: rCode,
      evidence: {
        cmd: `node scripts/retro-action-sync.mjs ${rArgs.join(" ")}`,
      },
    });
    if (rCode !== 0) finalizeAndExit(rCode);
  } else {
    console.log("[P0-Audit] 0/10 skipped: retro-action-sync");
    addStep({
      id: "retro-sync",
      label: "retro-action-sync",
      status: "skipped",
      reason: "--no-retro-sync",
      code: null,
      evidence: {},
    });
  }

  if (!args.noFbsAutoArchive) {
    console.log("[P0-Audit] fbs-auto-archive（.fbs 历史快照类治理）");
    let arch;
    try {
      arch = runFbsAutoArchive({ bookRoot, olderThanDays: 14, maxTotalMb: 128, dryRun: false });
    } catch (e) {
      addStep({
        id: "fbs-auto-archive",
        label: "fbs-auto-archive",
        status: "failed",
        reason: e?.message || String(e),
        code: 1,
        evidence: { error: String(e) },
      });
      finalizeAndExit(1);
    }
    const ok = arch.code === 0;
    addStep({
      id: "fbs-auto-archive",
      label: "fbs-auto-archive",
      status: ok ? "passed" : "failed",
      reason: ok ? "自动归档完成" : "自动归档失败",
      code: arch.code,
      evidence: {
        reportPath: arch.reportPath || null,
        archivedCount: arch.archivedCount ?? 0,
        candidates: Array.isArray(arch.candidates) ? arch.candidates.length : 0,
      },
    });
    if (!ok) finalizeAndExit(arch.code ?? 1);
  } else {
    console.log("[P0-Audit] skipped: fbs-auto-archive");
    addStep({
      id: "fbs-auto-archive",
      label: "fbs-auto-archive",
      status: "skipped",
      reason: "--no-fbs-auto-archive",
      code: null,
      evidence: {},
    });
  }

  if (!args.noBookStateWeeklyExport) {
    console.log("[P0-Audit] book-state-weekly-export（book-state.db 周摘要）");
    let wk;
    try {
      wk = runBookStateWeeklyExport({ bookRoot, days: 7 });
    } catch (e) {
      addStep({
        id: "book-state-weekly-export",
        label: "book-state-weekly-export",
        status: "failed",
        reason: e?.message || String(e),
        code: 1,
        evidence: { error: String(e) },
      });
      finalizeAndExit(1);
    }
    const ok = wk.code === 0;
    addStep({
      id: "book-state-weekly-export",
      label: "book-state-weekly-export",
      status: ok ? "passed" : "failed",
      reason: ok ? "周摘要已写入 .fbs/reports/" : "周摘要导出失败",
      code: wk.code,
      evidence: {
        jsonPath: wk.jsonPath || null,
        mdPath: wk.mdPath || null,
        eventTotal: wk.eventTotal,
        gateTotal: wk.gateTotal,
      },
    });
    if (!ok) finalizeAndExit(wk.code ?? 1);
  } else {
    console.log("[P0-Audit] skipped: book-state-weekly-export");
    addStep({
      id: "book-state-weekly-export",
      label: "book-state-weekly-export",
      status: "skipped",
      reason: "--no-book-state-weekly-export",
      code: null,
      evidence: {},
    });
  }

  if (!args.noMidtermGovernance) {
    console.log("[P0-Audit] midterm-governance-report（门禁+KPI+整改建议统一周报）");
    let mg;
    try {
      mg = runMidtermGovernanceReport({ bookRoot });
    } catch (e) {
      addStep({
        id: "midterm-governance-report",
        label: "midterm-governance-report",
        status: "failed",
        reason: e?.message || String(e),
        code: 1,
        evidence: { error: String(e) },
      });
      finalizeAndExit(1);
    }
    const ok = mg.code === 0;
    addStep({
      id: "midterm-governance-report",
      label: "midterm-governance-report",
      status: ok ? "passed" : "failed",
      reason: ok ? "中期治理周报已生成" : "中期治理周报生成失败",
      code: mg.code,
      evidence: {
        jsonPath: mg.jsonPath || null,
        mdPath: mg.mdPath || null,
        status: mg.status || null,
      },
    });
    if (!ok) finalizeAndExit(mg.code ?? 1);
  } else {
    console.log("[P0-Audit] skipped: midterm-governance-report");
    addStep({
      id: "midterm-governance-report",
      label: "midterm-governance-report",
      status: "skipped",
      reason: "--no-midterm-governance",
      code: null,
      evidence: {},
    });
  }

  if (!args.noMidtermMilestone) {
    console.log("[P0-Audit] midterm-milestone-report（中期里程碑汇总）");
    let mm;
    try {
      mm = runMidtermMilestoneReport({ bookRoot });
    } catch (e) {
      addStep({
        id: "midterm-milestone-report",
        label: "midterm-milestone-report",
        status: "failed",
        reason: e?.message || String(e),
        code: 1,
        evidence: { error: String(e) },
      });
      finalizeAndExit(1);
    }
    const ok = mm.code === 0;
    addStep({
      id: "midterm-milestone-report",
      label: "midterm-milestone-report",
      status: ok ? "passed" : "failed",
      reason: ok ? "中期里程碑报告已生成" : "中期里程碑报告生成失败",
      code: mm.code,
      evidence: {
        jsonPath: mm.jsonPath || null,
        mdPath: mm.mdPath || null,
        status: mm.status || null,
      },
    });
    if (!ok) finalizeAndExit(mm.code ?? 1);
  } else {
    console.log("[P0-Audit] skipped: midterm-milestone-report");
    addStep({
      id: "midterm-milestone-report",
      label: "midterm-milestone-report",
      status: "skipped",
      reason: "--no-midterm-milestone",
      code: null,
      evidence: {},
    });
  }

  if (!args.noReleaseGovernor) {
    console.log("[P0-Audit] release-governor（终稿唯一化 + 状态机激活）");
    const rgArgs = ["--book-root", bookRoot];
    if (args.strict) rgArgs.push("--strict");
    const rgCode = runNode(path.join(scriptsRoot, "release-governor.mjs"), rgArgs);
    addStep({
      id: "release-governor",
      label: "release-governor",
      status: rgCode === 0 ? "passed" : "failed",
      reason: rgCode === 0 ? "终稿治理通过" : "终稿治理失败",
      code: rgCode,
      evidence: {
        cmd: `node scripts/release-governor.mjs ${rgArgs.join(" ")}`,
      },
    });
    if (rgCode !== 0) finalizeAndExit(rgCode);
  } else {
    console.log("[P0-Audit] skipped: release-governor");
    addStep({
      id: "release-governor",
      label: "release-governor",
      status: "skipped",
      reason: "--no-release-governor",
      code: null,
      evidence: {},
    });
  }

  if (!args.noFinalManuscriptCleanGate) {
    console.log("[P0-Audit] final-manuscript-clean-gate（终稿洁净门禁）");
    const fcArgs = ["--book-root", bookRoot];
    const fcCode = runNode(path.join(scriptsRoot, "final-manuscript-clean-gate.mjs"), fcArgs);
    addStep({
      id: "final-manuscript-clean-gate",
      label: "final-manuscript-clean-gate",
      status: fcCode === 0 ? "passed" : "failed",
      reason: fcCode === 0 ? "终稿洁净门禁通过" : "终稿/全稿包含写作过程标注",
      code: fcCode,
      evidence: {
        cmd: `node scripts/final-manuscript-clean-gate.mjs ${fcArgs.join(" ")}`,
      },
    });
    if (fcCode !== 0) finalizeAndExit(fcCode);
  } else {
    console.log("[P0-Audit] skipped: final-manuscript-clean-gate");
    addStep({
      id: "final-manuscript-clean-gate",
      label: "final-manuscript-clean-gate",
      status: "skipped",
      reason: "--no-final-manuscript-clean-gate",
      code: null,
      evidence: {},
    });
  }

  const canParallelFirstFour =
    args.parallel &&
    !args.noQueryOpt &&
    !args.noPendingVerification &&
    !args.noBrokenLinks &&
    !args.noStructureGuard;

  if (!args.noFileGrowthGuard) {
    console.log("[P0-Audit] 0.5/10 file-growth-guard");
    const fgArgs = ["--book-root", bookRoot, "--enforce"];
    const fgCode = runNode(path.join(scriptsRoot, "file-growth-guard.mjs"), fgArgs);
    addStep({
      id: "file-growth-guard",
      label: "file-growth-guard",
      status: fgCode === 0 ? "passed" : "failed",
      reason: fgCode === 0 ? "文件增长风险可接受" : "检测到大文件风险超阈值",
      code: fgCode,
      evidence: {
        cmd: `node scripts/file-growth-guard.mjs ${fgArgs.join(" ")}`,
      },
    });
    if (fgCode !== 0) finalizeAndExit(fgCode);
  } else {
    console.log("[P0-Audit] 0.5/10 skipped: file-growth-guard");
    addStep({
      id: "file-growth-guard",
      label: "file-growth-guard",
      status: "skipped",
      reason: "--no-file-growth-guard",
      code: null,
      evidence: {},
    });
  }

  if (canParallelFirstFour) {
    console.log("[P0-Audit] 1–4/8 parallel batch（实验性，stdio 可能交错）");
    const taskSpecs = [];
    if (!args.noQueryOpt) {
      const qArgs = ["--skill-root", skillRoot, "--book-root", bookRoot];
      if (args.strict) qArgs.push("--enforce", "--require-ledger");
      taskSpecs.push({
        id: "query-optimization",
        label: "audit-query-optimization",
        script: path.join(scriptsRoot, "audit-query-optimization.mjs"),
        args: qArgs,
      });
    }
    if (!args.noPendingVerification) {
      const pArgs = ["--book-root", bookRoot];
      if (args.strict) pArgs.push("--enforce", "--require-ledger");
      taskSpecs.push({
        id: "pending-verification",
        label: "audit-pending-verification",
        script: path.join(scriptsRoot, "audit-pending-verification.mjs"),
        args: pArgs,
      });
    }
    if (!args.noBrokenLinks) {
      const bArgs = ["--root", skillRoot, "--channel", args.brokenLinksChannel];
      if (args.strict) bArgs.push("--enforce");
      taskSpecs.push({
        id: "broken-links",
        label: "audit-broken-links",
        script: path.join(scriptsRoot, "audit-broken-links.mjs"),
        args: bArgs,
      });
    }
    if (!args.noStructureGuard) {
      const sArgs = ["--skill-root", skillRoot, "--book-root", bookRoot];
      if (args.strict) sArgs.push("--enforce");
      taskSpecs.push({
        id: "structure-guard",
        label: "structural-bottleneck-guard",
        script: path.join(scriptsRoot, "structural-bottleneck-guard.mjs"),
        args: sArgs,
      });
    }
    const codes = await Promise.all(
      taskSpecs.map(async (spec) => ({
        spec,
        code: await runNodeAsync(spec.script, spec.args),
      })),
    );
    for (const { spec, code } of codes) {
      addStep({
        id: spec.id,
        label: spec.label,
        status: code === 0 ? "passed" : "failed",
        reason: code === 0 ? "并行审计通过" : "并行审计失败",
        code,
        evidence: {
          cmd: `node ${path.relative(skillRoot, spec.script)} ${spec.args.join(" ")}`,
        },
      });
    }
    const bad = codes.find((x) => x.code !== 0);
    if (bad) finalizeAndExit(bad.code);
  } else {
    if (args.parallel) {
      console.log("[P0-Audit] 提示：--parallel 需 1–4 步均未 --no-*，否则回退串行");
    }

    if (!args.noQueryOpt) {
      console.log("[P0-Audit] 1/8 audit-query-optimization");
      const qArgs = ["--skill-root", skillRoot, "--book-root", bookRoot];
      if (args.strict) qArgs.push("--enforce", "--require-ledger");
      const qCode = runNode(path.join(scriptsRoot, "audit-query-optimization.mjs"), qArgs);
      addStep({
        id: "query-optimization",
        label: "audit-query-optimization",
        status: qCode === 0 ? "passed" : "failed",
        reason: qCode === 0 ? "查询优化审计通过" : "查询优化审计失败",
        code: qCode,
        evidence: {
          cmd: `node scripts/audit-query-optimization.mjs ${qArgs.join(" ")}`,
        },
      });
      if (qCode !== 0) finalizeAndExit(qCode);
    } else {
      console.log("[P0-Audit] 1/8 skipped: audit-query-optimization");
      addStep({
        id: "query-optimization",
        label: "audit-query-optimization",
        status: "skipped",
        reason: "--no-query-opt",
        code: null,
        evidence: {},
      });
    }

    if (!args.noPendingVerification) {
      console.log("[P0-Audit] 2/8 audit-pending-verification");
      const pArgs = ["--book-root", bookRoot];
      if (args.strict) pArgs.push("--enforce", "--require-ledger");
      const pCode = runNode(path.join(scriptsRoot, "audit-pending-verification.mjs"), pArgs);
      addStep({
        id: "pending-verification",
        label: "audit-pending-verification",
        status: pCode === 0 ? "passed" : "failed",
        reason: pCode === 0 ? "待验收审计通过" : "待验收审计失败",
        code: pCode,
        evidence: {
          cmd: `node scripts/audit-pending-verification.mjs ${pArgs.join(" ")}`,
        },
      });
      if (pCode !== 0) finalizeAndExit(pCode);
    } else {
      console.log("[P0-Audit] 2/8 skipped: audit-pending-verification");
      addStep({
        id: "pending-verification",
        label: "audit-pending-verification",
        status: "skipped",
        reason: "--no-pending-verification",
        code: null,
        evidence: {},
      });
    }

    if (!args.noBrokenLinks) {
      console.log("[P0-Audit] 3/8 audit-broken-links");
      const bArgs = ["--root", skillRoot, "--channel", args.brokenLinksChannel];
      if (args.strict) bArgs.push("--enforce");
      const bCode = runNode(path.join(scriptsRoot, "audit-broken-links.mjs"), bArgs);
      addStep({
        id: "broken-links",
        label: "audit-broken-links",
        status: bCode === 0 ? "passed" : "failed",
        reason: bCode === 0 ? "断链审计通过" : "断链审计失败",
        code: bCode,
        evidence: {
          cmd: `node scripts/audit-broken-links.mjs ${bArgs.join(" ")}`,
        },
      });
      if (bCode !== 0) finalizeAndExit(bCode);
    } else {
      console.log("[P0-Audit] 3/8 skipped: audit-broken-links");
      addStep({
        id: "broken-links",
        label: "audit-broken-links",
        status: "skipped",
        reason: "--no-broken-links",
        code: null,
        evidence: {},
      });
    }

    if (!args.noStructureGuard) {
      console.log("[P0-Audit] 4/8 structural-bottleneck-guard");
      const sArgs = ["--skill-root", skillRoot, "--book-root", bookRoot];
      if (args.strict) sArgs.push("--enforce");
      const sCode = runNode(path.join(scriptsRoot, "structural-bottleneck-guard.mjs"), sArgs);
      addStep({
        id: "structure-guard",
        label: "structural-bottleneck-guard",
        status: sCode === 0 ? "passed" : "failed",
        reason: sCode === 0 ? "结构瓶颈审计通过" : "结构瓶颈审计失败",
        code: sCode,
        evidence: {
          cmd: `node scripts/structural-bottleneck-guard.mjs ${sArgs.join(" ")}`,
        },
      });
      if (sCode !== 0) finalizeAndExit(sCode);
    } else {
      console.log("[P0-Audit] 4/8 skipped: structural-bottleneck-guard");
      addStep({
        id: "structure-guard",
        label: "structural-bottleneck-guard",
        status: "skipped",
        reason: "--no-structure-guard",
        code: null,
        evidence: {},
      });
    }
  }

  if (!args.noScenePackCheck) {
    console.log("[P0-Audit] 6/9 scene-pack-check");
    const spCode = runNode(path.join(scriptsRoot, "wecom", "scene-pack-admin.mjs"), ["check"]);
    addStep({
      id: "scene-pack-check",
      label: "scene-pack-check",
      status: spCode === 0 ? "passed" : "failed",
      reason: spCode === 0 ? "场景包检查通过" : "场景包检查失败",
      code: spCode,
      evidence: {
        cmd: "node scripts/wecom/scene-pack-admin.mjs check",
      },
    });
    if (spCode !== 0) finalizeAndExit(spCode);
  } else {
    console.log("[P0-Audit] 6/9 skipped: scene-pack-check");
    addStep({
      id: "scene-pack-check",
      label: "scene-pack-check",
      status: "skipped",
      reason: "--no-scene-pack-check",
      code: null,
      evidence: {},
    });
  }

  if (!args.noEntryGate) {
    console.log("[P0-Audit] 7/9 entry-performance-gate");
    const eArgs = ["--skill-root", skillRoot, "--book-root", bookRoot, "--channel", args.brokenLinksChannel];
    if (args.strict) eArgs.push("--enforce");
    const eCode = runNode(path.join(scriptsRoot, "audit-entry-performance.mjs"), eArgs);
    addStep({
      id: "entry-performance-gate",
      label: "entry-performance-gate",
      status: eCode === 0 ? "passed" : "failed",
      reason: eCode === 0 ? "入口性能门禁通过" : "入口性能门禁失败",
      code: eCode,
      evidence: {
        cmd: `node scripts/audit-entry-performance.mjs ${eArgs.join(" ")}`,
      },
    });
    if (eCode !== 0) finalizeAndExit(eCode);
  } else {
    console.log("[P0-Audit] 7/9 skipped: entry-performance-gate");
    addStep({
      id: "entry-performance-gate",
      label: "entry-performance-gate",
      status: "skipped",
      reason: "--no-entry-gate",
      code: null,
      evidence: {},
    });
  }

  if (!args.noVisibleTechKpi) {
    console.log("[P0-Audit] 7.5/9 visible-tech-action-kpi");
    const minReasonCoverage = args.strict ? "95" : "90";
    const vkArgs = ["--skill-root", skillRoot, "--book-root", bookRoot, "--mode", "runtime", "--min-reason-coverage", minReasonCoverage];
    if (args.strict) vkArgs.push("--enforce");
    const vkCode = runNode(path.join(scriptsRoot, "visible-tech-action-kpi.mjs"), vkArgs);
    addStep({
      id: "visible-tech-action-kpi",
      label: "visible-tech-action-kpi",
      status: vkCode === 0 ? "passed" : "failed",
      reason: vkCode === 0 ? "可见技术处理解释 KPI 通过" : "可见技术处理解释 KPI 未达标",
      code: vkCode,
      evidence: {
        cmd: `node scripts/visible-tech-action-kpi.mjs ${vkArgs.join(" ")}`,
      },
    });
    if (vkCode !== 0) finalizeAndExit(vkCode);
  } else {
    console.log("[P0-Audit] 7.5/9 skipped: visible-tech-action-kpi");
    addStep({
      id: "visible-tech-action-kpi",
      label: "visible-tech-action-kpi",
      status: "skipped",
      reason: "--no-visible-tech-kpi",
      code: null,
      evidence: {},
    });
  }

  if (!args.noToolOutputBudget) {
    console.log("[P0-Audit] 7.6/9 tool-output-budget-gate");
    const tbArgs = ["--book-root", bookRoot, "--max-per-file-kb", "512", "--max-total-mb", args.strict ? "6" : "8"];
    if (args.strict) tbArgs.push("--enforce");
    const tbCode = runNode(path.join(scriptsRoot, "tool-output-budget-gate.mjs"), tbArgs);
    addStep({
      id: "tool-output-budget-gate",
      label: "tool-output-budget-gate",
      status: tbCode === 0 ? "passed" : "failed",
      reason: tbCode === 0 ? "工具输出预算门禁通过" : "工具输出预算超限",
      code: tbCode,
      evidence: {
        cmd: `node scripts/tool-output-budget-gate.mjs ${tbArgs.join(" ")}`,
      },
    });
    if (tbCode !== 0) finalizeAndExit(tbCode);
  } else {
    console.log("[P0-Audit] 7.6/9 skipped: tool-output-budget-gate");
    addStep({
      id: "tool-output-budget-gate",
      label: "tool-output-budget-gate",
      status: "skipped",
      reason: "--no-tool-output-budget",
      code: null,
      evidence: {},
    });
  }

  if (!args.noContentSafetyPrecheck) {
    const targetFile = resolveLatestFinalManuscript(bookRoot);
    if (targetFile) {
      console.log("[P0-Audit] 7.7/9 content-safety-precheck");
      const csArgs = ["--input-file", targetFile];
      if (args.strict) csArgs.push("--enforce");
      const csCode = runNode(path.join(scriptsRoot, "content-safety-precheck.mjs"), csArgs);
      addStep({
        id: "content-safety-precheck",
        label: "content-safety-precheck",
        status: csCode === 0 ? "passed" : "failed",
        reason: csCode === 0 ? "内容安全预检通过" : "内容安全预检发现高风险项",
        code: csCode,
        evidence: {
          cmd: `node scripts/content-safety-precheck.mjs ${csArgs.join(" ")}`,
        },
      });
      if (csCode !== 0) finalizeAndExit(csCode);
    } else {
      console.log("[P0-Audit] 7.7/9 skipped: content-safety-precheck (no final manuscript)");
      addStep({
        id: "content-safety-precheck",
        label: "content-safety-precheck",
        status: "skipped",
        reason: "no final manuscript",
        code: null,
        evidence: {},
      });
    }
  } else {
    console.log("[P0-Audit] 7.7/9 skipped: content-safety-precheck");
    addStep({
      id: "content-safety-precheck",
      label: "content-safety-precheck",
      status: "skipped",
      reason: "--no-content-safety-precheck",
      code: null,
      evidence: {},
    });
  }

  if (!args.noPluginCapabilitySnapshot) {
    console.log("[P0-Audit] 7.8/9 plugin-capability-snapshot");
    const pcsArgs = ["--book-root", bookRoot, "--skill-root", skillRoot, "--intent", "auto"];
    if (args.strict) pcsArgs.push("--enforce");
    const pcsCode = runNode(path.join(scriptsRoot, "plugin-capability-snapshot.mjs"), pcsArgs);
    addStep({
      id: "plugin-capability-snapshot",
      label: "plugin-capability-snapshot",
      status: pcsCode === 0 ? "passed" : "failed",
      reason: pcsCode === 0 ? "插件能力快照通过" : "插件能力快照校验失败",
      code: pcsCode,
      evidence: {
        cmd: `node scripts/plugin-capability-snapshot.mjs ${pcsArgs.join(" ")}`,
      },
    });
    if (pcsCode !== 0) finalizeAndExit(pcsCode);
  } else {
    console.log("[P0-Audit] 7.8/9 skipped: plugin-capability-snapshot");
    addStep({
      id: "plugin-capability-snapshot",
      label: "plugin-capability-snapshot",
      status: "skipped",
      reason: "--no-plugin-capability-snapshot",
      code: null,
      evidence: {},
    });
  }

  if (!args.noPluginRoutingKpi) {
    console.log("[P0-Audit] 7.9/9 plugin-routing-kpi");
    const prArgs = ["--book-root", bookRoot, "--window", "50"];
    if (args.strict) prArgs.push("--enforce");
    const prCode = runNode(path.join(scriptsRoot, "plugin-routing-kpi.mjs"), prArgs);
    addStep({
      id: "plugin-routing-kpi",
      label: "plugin-routing-kpi",
      status: prCode === 0 ? "passed" : "failed",
      reason: prCode === 0 ? "插件路由 KPI 通过" : "插件路由 KPI 未达标",
      code: prCode,
      evidence: {
        cmd: `node scripts/plugin-routing-kpi.mjs ${prArgs.join(" ")}`,
      },
    });
    if (prCode !== 0) finalizeAndExit(prCode);
  } else {
    console.log("[P0-Audit] 7.9/9 skipped: plugin-routing-kpi");
    addStep({
      id: "plugin-routing-kpi",
      label: "plugin-routing-kpi",
      status: "skipped",
      reason: "--no-plugin-routing-kpi",
      code: null,
      evidence: {},
    });
  }

  if (!args.noNorthstarKpi) {
    console.log("[P0-Audit] 8.0/9 northstar-kpi");
    const nkArgs = ["--book-root", bookRoot];
    if (args.strict) nkArgs.push("--enforce");
    const nkCode = runNode(path.join(scriptsRoot, "northstar-kpi.mjs"), nkArgs);
    addStep({
      id: "northstar-kpi",
      label: "northstar-kpi",
      status: nkCode === 0 ? "passed" : "failed",
      reason: nkCode === 0 ? "北极星 KPI 通过" : "北极星 KPI 未达标",
      code: nkCode,
      evidence: {
        cmd: `node scripts/northstar-kpi.mjs ${nkArgs.join(" ")}`,
      },
    });
    if (nkCode !== 0) finalizeAndExit(nkCode);
  } else {
    console.log("[P0-Audit] 8.0/9 skipped: northstar-kpi");
    addStep({
      id: "northstar-kpi",
      label: "northstar-kpi",
      status: "skipped",
      reason: "--no-northstar-kpi",
      code: null,
      evidence: {},
    });
  }

  if (!args.noWritingContract) {
    console.log("[P0-Audit] 8.1/9 writing-contract-gate");
    const wArgs = ["--book-root", bookRoot, "--skill-root", skillRoot];
    const wCode = runNode(path.join(scriptsRoot, "writing-contract-gate.mjs"), wArgs);
    addStep({
      id: "writing-contract-gate",
      label: "writing-contract-gate",
      status: wCode === 0 ? "passed" : "failed",
      reason: wCode === 0 ? "写作合同门禁通过" : "写作合同门禁失败",
      code: wCode,
      evidence: {
        cmd: `node scripts/writing-contract-gate.mjs ${wArgs.join(" ")}`,
      },
    });
    if (wCode !== 0) finalizeAndExit(wCode);
  } else {
    console.log("[P0-Audit] 8.1/9 skipped: writing-contract-gate");
    addStep({
      id: "writing-contract-gate",
      label: "writing-contract-gate",
      status: "skipped",
      reason: "--no-writing-contract",
      code: null,
      evidence: {},
    });
  }

  if (!args.noExpansionGate) {
    const planPath = path.join(bookRoot, ".fbs", "expansion-plan.md");
    if (fs.existsSync(planPath)) {
      console.log("[P0-Audit] 9.0/9 expansion-gate");
      const gArgs = ["--book-root", bookRoot, "--skill-root", skillRoot];
      const gCode = runNode(path.join(scriptsRoot, "expansion-gate.mjs"), gArgs);
      addStep({
        id: "expansion-gate",
        label: "expansion-gate",
        status: gCode === 0 ? "passed" : "failed",
        reason: gCode === 0 ? "扩写门禁通过" : "扩写门禁失败",
        code: gCode,
        evidence: {
          cmd: `node scripts/expansion-gate.mjs ${gArgs.join(" ")}`,
        },
      });
      if (gCode !== 0) finalizeAndExit(gCode);
    } else {
      console.log("[P0-Audit] 9.0/9 skipped: expansion-gate (no .fbs/expansion-plan.md)");
      addStep({
        id: "expansion-gate",
        label: "expansion-gate",
        status: "skipped",
        reason: "no .fbs/expansion-plan.md",
        code: null,
        evidence: {},
      });
    }
  } else {
    console.log("[P0-Audit] 9.0/9 skipped: expansion-gate");
    addStep({
      id: "expansion-gate",
      label: "expansion-gate",
      status: "skipped",
      reason: "--no-expansion-gate",
      code: null,
      evidence: {},
    });
  }

  console.log("[P0-Audit] ✅ all checks passed");
  finalizeAndExit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
