#!/usr/bin/env node
/**
 * S3 一键守卫：preflight + heartbeat + chapter-status truth。
 *
 * 用法：
 *   node scripts/s3-guard.mjs --skill-root <技能根> --book-root <本书根> --mode parallel_writing --verify-stages
 *   node scripts/s3-guard.mjs --skill-root . --book-root <本书根> --no-heartbeat --no-truth
 *
 * 子调用 s3-start-gate 的审计开关（可选透传）：
 *   --audit-temporal-enforce / --no-audit-temporal
 *   --audit-term-enforce / --no-audit-term
 *   --audit-query-opt-enforce / --no-audit-query-opt
 *
 * 断链审计开关（防回归）：
 *   --audit-broken-links / --no-audit-broken-links
 *   --audit-broken-links-enforce
 *   --audit-broken-links-channel user|all
 *
 * 中期执行链（可选后置）：
 *   --with-midterm-chain
 *   --midterm-chain-enforce
 *   --midterm-days <days>
 */
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

export function parseArgs(argv) {
  const o = {
    skillRoot: process.cwd(),
    bookRoot: null,
    mode: "parallel_writing",
    verifyStages: false,
    withHeartbeat: true,
    withTruth: true,
    warnMs: null,
    criticalMs: null,
    noAuditTemporal: false,
    auditTemporalEnforce: false,
    noAuditTerm: false,
    auditTermEnforce: false,
    noAuditQueryOpt: false,
    auditQueryOptEnforce: false,
    withBrokenLinksAudit: false,
    brokenLinksEnforce: false,
    brokenLinksChannel: "user",
    withMidtermChain: false,
    midtermChainEnforce: false,
    midtermDays: 7,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--skill-root") o.skillRoot = argv[++i];
    else if (a === "--book-root") o.bookRoot = argv[++i];
    else if (a === "--mode") o.mode = argv[++i];
    else if (a === "--verify-stages") o.verifyStages = true;
    else if (a === "--no-heartbeat") o.withHeartbeat = false;
    else if (a === "--no-truth") o.withTruth = false;
    else if (a === "--warn-ms") o.warnMs = String(argv[++i]);
    else if (a === "--critical-ms") o.criticalMs = String(argv[++i]);
    else if (a === "--no-audit-temporal") o.noAuditTemporal = true;
    else if (a === "--audit-temporal-enforce") o.auditTemporalEnforce = true;
    else if (a === "--no-audit-term") o.noAuditTerm = true;
    else if (a === "--audit-term-enforce") o.auditTermEnforce = true;
    else if (a === "--no-audit-query-opt") o.noAuditQueryOpt = true;
    else if (a === "--audit-query-opt-enforce") o.auditQueryOptEnforce = true;
    else if (a === "--audit-broken-links") o.withBrokenLinksAudit = true;
    else if (a === "--no-audit-broken-links") o.withBrokenLinksAudit = false;
    else if (a === "--audit-broken-links-enforce") {
      o.withBrokenLinksAudit = true;
      o.brokenLinksEnforce = true;
    } else if (a === "--audit-broken-links-channel") o.brokenLinksChannel = argv[++i] || "user";
    else if (a === "--with-midterm-chain") o.withMidtermChain = true;
    else if (a === "--midterm-chain-enforce") {
      o.withMidtermChain = true;
      o.midtermChainEnforce = true;
    }
    else if (a === "--midterm-days") o.midtermDays = Math.max(1, Number(argv[++i] || o.midtermDays));
  }
  return o;
}

function runNode(scriptPath, args) {
  const r = spawnSync(process.execPath, [scriptPath, ...args], { stdio: "inherit" });
  return typeof r.status === "number" ? r.status : 2;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error("用法: node scripts/s3-guard.mjs --skill-root <技能根> --book-root <本书根> [--mode parallel_writing|single_writer] [--verify-stages] [--no-heartbeat] [--no-truth] [--with-midterm-chain] [--midterm-chain-enforce] [--midterm-days <days>]");
    process.exit(2);
  }

  const skillRoot = path.resolve(args.skillRoot || process.cwd());
  const bookRoot = path.resolve(args.bookRoot);
  const scriptsRoot = path.resolve(skillRoot, "scripts");

  console.log("[S3-Guard] 1/3 preflight: s3-start-gate");
  const gateArgs = ["--skill-root", skillRoot, "--book-root", bookRoot, "--mode", args.mode];
  if (args.verifyStages) gateArgs.push("--verify-stages");
  if (args.noAuditTemporal) gateArgs.push("--no-audit-temporal");
  if (args.auditTemporalEnforce) gateArgs.push("--audit-temporal-enforce");
  if (args.noAuditTerm) gateArgs.push("--no-audit-term");
  if (args.auditTermEnforce) gateArgs.push("--audit-term-enforce");
  if (args.noAuditQueryOpt) gateArgs.push("--no-audit-query-opt");
  if (args.auditQueryOptEnforce) gateArgs.push("--audit-query-opt-enforce");
  const gateCode = runNode(path.join(scriptsRoot, "s3-start-gate.mjs"), gateArgs);
  if (gateCode !== 0) process.exit(gateCode);

  if (args.withHeartbeat) {
    console.log("[S3-Guard] 2/3 health: heartbeat-monitor");
    const hbArgs = ["--book-root", bookRoot, "--fail-on-critical"];
    if (args.warnMs) hbArgs.push("--warn-ms", args.warnMs);
    if (args.criticalMs) hbArgs.push("--critical-ms", args.criticalMs);
    const hbCode = runNode(path.join(scriptsRoot, "heartbeat-monitor.mjs"), hbArgs);
    if (hbCode !== 0) process.exit(hbCode);
  } else {
    console.log("[S3-Guard] 2/3 skipped: heartbeat-monitor");
  }

  if (args.withTruth) {
    console.log("[S3-Guard] 3/3 truth: verify-chapter-status-truth");
    const truthCode = runNode(path.join(scriptsRoot, "verify-chapter-status-truth.mjs"), ["--book-root", bookRoot, "--strict"]);
    if (truthCode !== 0) process.exit(truthCode);
  } else {
    console.log("[S3-Guard] 3/3 skipped: verify-chapter-status-truth");
  }

  if (args.withBrokenLinksAudit) {
    console.log("[S3-Guard] 4/4 docs: audit-broken-links");
    const linkArgs = ["--root", skillRoot, "--channel", args.brokenLinksChannel];
    if (args.brokenLinksEnforce) linkArgs.push("--enforce");
    const linkCode = runNode(path.join(scriptsRoot, "audit-broken-links.mjs"), linkArgs);
    if (linkCode !== 0) process.exit(linkCode);
  } else {
    console.log("[S3-Guard] 4/4 skipped: audit-broken-links");
  }

  if (args.withMidtermChain) {
    console.log("[S3-Guard] 5/5 midterm: midterm-execution-chain");
    const midtermArgs = ["--book-root", bookRoot, "--skill-root", skillRoot, "--days", String(args.midtermDays), "--json"];
    if (args.midtermChainEnforce) midtermArgs.push("--enforce");
    const midtermCode = runNode(path.join(scriptsRoot, "midterm-execution-chain.mjs"), midtermArgs);
    if (midtermCode !== 0) process.exit(midtermCode);
  } else {
    console.log("[S3-Guard] 5/5 skipped: midterm-execution-chain");
  }

  console.log("[S3-Guard] ✅ all checks passed");
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
