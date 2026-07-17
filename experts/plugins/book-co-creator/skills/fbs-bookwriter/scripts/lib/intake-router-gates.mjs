/**
 * intake-router 门禁汇总：复盘 P0、P0 审计报告、文件增长报告
 */
import fs from "fs";
import path from "path";
import { runRetroActionSync } from "../retro-action-sync.mjs";

export function buildRetroGateState(effectiveBookRoot) {
  try {
    const out = runRetroActionSync({
      bookRoot: effectiveBookRoot,
      enforceP0: false,
      allowMissingReport: true,
    });
    const unresolved = Array.isArray(out.unresolved) ? out.unresolved : [];
    const unresolvedP0 = Array.isArray(out.unresolvedP0) ? out.unresolvedP0 : [];
    return {
      synced: out.code === 0 || String(out.message || "").startsWith("skip"),
      skipped: String(out.message || "").startsWith("skip"),
      message: out.message || null,
      sourceReport: out.report || null,
      unresolvedCount: unresolved.length,
      unresolvedP0Count: unresolvedP0.length,
      hasUnresolvedP0: unresolvedP0.length > 0,
      unresolvedTop: unresolved.slice(0, 3),
    };
  } catch (error) {
    return {
      synced: false,
      skipped: false,
      message: `retro-sync-failed: ${error.message}`,
      sourceReport: null,
      unresolvedCount: 0,
      unresolvedP0Count: 0,
      hasUnresolvedP0: false,
      unresolvedTop: [],
    };
  }
}

export function readP0AuditReport(effectiveFbsDir) {
  const reportPath = path.join(effectiveFbsDir, "p0-audit-report.json");
  if (!fs.existsSync(reportPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const generatedAt = parsed.generatedAt || null;
    const generatedMs = generatedAt ? new Date(generatedAt).getTime() : NaN;
    const ageHours = Number.isFinite(generatedMs) ? (Date.now() - generatedMs) / 3600000 : null;
    const sourceReport = typeof parsed.sourceReport === "string" ? parsed.sourceReport : null;
    const sourceReportExists = sourceReport ? fs.existsSync(sourceReport) : false;
    const staleByAge = typeof ageHours === "number" && ageHours > 24;
    const staleMissingSource = staleByAge && !!sourceReport && !sourceReportExists;
    const staleNoSource = staleByAge && !sourceReport;
    const stale = staleMissingSource || staleNoSource;
    const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    const totals = parsed.totals || {};
    return {
      source: reportPath,
      generatedAt,
      status: parsed.status || null,
      exitCode: typeof parsed.exitCode === "number" ? parsed.exitCode : null,
      sourceReport,
      sourceReportExists,
      ageHours: typeof ageHours === "number" ? Number(ageHours.toFixed(2)) : null,
      stale,
      staleReason: staleMissingSource
        ? "source-report-missing"
        : staleNoSource
          ? "source-report-unknown"
          : null,
      totals: {
        all: Number(totals.all) || steps.length,
        passed: Number(totals.passed) || 0,
        failed: Number(totals.failed) || 0,
        skipped: Number(totals.skipped) || 0,
      },
      failedSteps: steps
        .filter((x) => x.status === "failed")
        .map((x) => ({ id: x.id || null, label: x.label || null, reason: x.reason || null })),
    };
  } catch (error) {
    return {
      source: reportPath,
      generatedAt: null,
      status: "invalid",
      exitCode: null,
      totals: { all: 0, passed: 0, failed: 0, skipped: 0 },
      failedSteps: [],
      parseError: error.message,
    };
  }
}

export function readFileGrowthReport(effectiveFbsDir) {
  const reportPath = path.join(effectiveFbsDir, "file-growth-report.json");
  if (!fs.existsSync(reportPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    return {
      source: reportPath,
      generatedAt: parsed.generatedAt || null,
      totals: parsed.totals || null,
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
      advisoryAlerts: Array.isArray(parsed.advisoryAlerts) ? parsed.advisoryAlerts : [],
      oversized: Array.isArray(parsed.oversized) ? parsed.oversized : [],
      softOversized: Array.isArray(parsed.softOversized) ? parsed.softOversized : [],
      blocked: !!parsed.blocked,
    };
  } catch (error) {
    return {
      source: reportPath,
      generatedAt: null,
      totals: null,
      alerts: ["invalid-file-growth-report"],
      advisoryAlerts: [],
      oversized: [],
      softOversized: [],
      blocked: false,
      parseError: error.message,
    };
  }
}

export function buildGateSummary(env) {
  const retro = env.retroGate || null;
  const p0 = env.p0AuditReport || null;
  const growth = env.fileGrowthReport || null;
  const summary = {
    schemaVersion: "1.0.0",
    status: "ready",
    reasons: [],
    p0Audit: p0,
    fileGrowth: growth,
    retroGate: retro,
  };

  if (retro?.hasUnresolvedP0) {
    summary.status = "divert";
    summary.reasons.push(`retro-unresolved-p0:${retro.unresolvedP0Count}`);
  }
  if (p0?.stale && (p0?.status === "failed" || (typeof p0?.exitCode === "number" && p0.exitCode !== 0))) {
    if (summary.status !== "blocked") summary.status = "divert";
    summary.reasons.push(`p0-audit-stale:${p0.staleReason || "stale"}`);
  } else if (p0?.status === "failed" || (typeof p0?.exitCode === "number" && p0.exitCode !== 0)) {
    summary.status = "blocked";
    summary.reasons.push(`p0-audit-failed:${p0.exitCode}`);
  } else if (p0?.status === "invalid") {
    if (summary.status !== "blocked") summary.status = "divert";
    summary.reasons.push("p0-audit-report-invalid");
  }
  if (growth?.blocked) {
    summary.status = "blocked";
    summary.reasons.push("file-growth-guard-blocked");
  } else if ((growth?.alerts || []).length > 0 && summary.status === "ready") {
    summary.status = "divert";
    summary.reasons.push("file-growth-alert");
  } else if ((growth?.advisoryAlerts || []).length > 0 && summary.status === "ready") {
    summary.status = "divert";
    summary.reasons.push("file-growth-advisory");
  }
  if (!summary.reasons.length) {
    summary.reasons.push("all-gates-clear");
  }
  return summary;
}
