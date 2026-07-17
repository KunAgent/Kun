#!/usr/bin/env node
/**
 * 运行时建议：esm 阶段须与 session-exit / workbuddy-resume 一致，优先解析 `.fbs/esm-state.md`
 * 正文表格中的 S0–S6（与 `workbuddy-session-snapshot.parseEsmState` 同源），避免仅读 frontmatter
 * 导致与「当前状态」表格不一致（WorkBuddy 第四轮实测：runtime-nudge=S1 vs 表格=S5）。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseEsmState as parseEsmMarkdown, parseFrontmatterCurrentState } from "./workbuddy-session-snapshot.mjs";

function parseArgs(argv) {
  const o = { bookRoot: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = path.resolve(argv[++i] || "");
    else if (a === "--json") o.json = true;
  }
  return o;
}

function readIterationPhaseFromEsmMarkdown(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return "none";
  const line = m[1].match(/^\s*iterationPhase:\s*["']?([^"'\r\n]+)/m);
  if (!line) return "none";
  return String(line[1]).trim().replace(/^["']|["']$/g, "") || "none";
}

function parseEsmStateForNudge(fbsDir) {
  const p = path.join(fbsDir, "esm-state.md");
  if (!fs.existsSync(p)) {
    return {
      currentState: null,
      currentStage: null,
      iterationPhase: "none",
      frontmatterStage: null,
      esmStateDrift: false,
    };
  }
  const t = fs.readFileSync(p, "utf8");
  const tableFirst = parseEsmMarkdown(t);
  const stage = tableFirst.currentStage;
  const frontmatterStage = parseFrontmatterCurrentState(t);
  const iterationPhase = readIterationPhaseFromEsmMarkdown(t);
  const drift =
    Boolean(stage && frontmatterStage && stage !== frontmatterStage);
  return {
    currentState: stage,
    currentStage: stage,
    iterationPhase: iterationPhase || "none",
    frontmatterStage,
    esmStateDrift: drift,
  };
}

function isDeliverLike(esm) {
  const s = String(esm?.currentStage || esm?.currentState || "").toUpperCase();
  return s === "DELIVER" || s === "S5";
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function buildNudges({ esm, retroItems, skillCandidates }) {
  const nudges = [];
  const unresolvedP0 = Number(retroItems?.totals?.unresolvedP0 || 0);
  if (unresolvedP0 > 0) {
    nudges.push({
      id: "retro-p0-first",
      severity: "critical",
      required: true,
      text: `检测到未修复 P0（${unresolvedP0}项），建议先处理再推进主流程。`,
      actionCmd: "node scripts/retro-action-sync.mjs --book-root <根> --enforce-p0",
    });
  }

  if (esm.iterationPhase === "expansion") {
    nudges.push({
      id: "expansion-verify",
      severity: "high",
      required: true,
      text: "当前处于 S3.5 扩写，完成后请先跑字数实测并同步 chapter-status。",
      actionCmd: "node scripts/expansion-word-verify.mjs --book-root <根> --from-plan .fbs/expansion-plan.md",
    });
  }

  if (esm.iterationPhase === "refinement") {
    nudges.push({
      id: "refinement-quality",
      severity: "high",
      required: true,
      text: "当前处于 S3.7 精修，先执行精修门禁（含源文件备份）再做质检。",
      actionCmd: "node scripts/polish-gate.mjs --book-root <根>",
    });
  }

  if (isDeliverLike(esm)) {
    nudges.push({
      id: "deliver-final-state",
      severity: "high",
      required: true,
      text: "即将交付，必须同步终稿状态机并登记 release 条目。",
      actionCmd: "node scripts/final-draft-state-machine.mjs --book-root <根> --action transition --to release --artifact <交付文件>",
    });
  }

  if (esm.esmStateDrift) {
    nudges.push({
      id: "esm-frontmatter-table-drift",
      severity: "medium",
      required: false,
      text:
        `检测到 esm-state.md 中 frontmatter 阶段（${esm.frontmatterStage}）与正文表格优先阶段（${esm.currentStage}）不一致，建议运行 node scripts/repair-esm-state-from-table.mjs --book-root <根> 同步。`,
      actionCmd: "node scripts/repair-esm-state-from-table.mjs --book-root <根>",
    });
  }

  const cands = Array.isArray(skillCandidates?.candidates) ? skillCandidates.candidates : [];
  if (cands.length > 0) {
    nudges.push({
      id: "retro-skill-candidates",
      severity: "medium",
      required: false,
      text: `检测到 ${cands.length} 条可沉淀候选，建议本轮结束前确认前 1-3 条是否沉淀。`,
      actionCmd: "node scripts/retro-to-skill-candidates.mjs --book-root <根> --json",
    });
  }

  return nudges;
}

export function runRuntimeNudge({ bookRoot }) {
  const root = path.resolve(bookRoot || process.cwd());
  const fbs = path.join(root, ".fbs");
  fs.mkdirSync(fbs, { recursive: true });

  const esm = parseEsmStateForNudge(fbs);
  const retroItems = readJsonIfExists(path.join(fbs, "retro-action-items.json"), { totals: {} });
  const skillCandidates = readJsonIfExists(path.join(fbs, "retro-skill-candidates.json"), { candidates: [] });
  const nudges = buildNudges({ esm, retroItems, skillCandidates });

  const out = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    esm,
    totals: {
      all: nudges.length,
      required: nudges.filter((x) => x.required).length,
      critical: nudges.filter((x) => x.severity === "critical").length,
    },
    nudges,
  };
  const outPath = path.join(fbs, "runtime-nudges.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  return { code: 0, message: "ok", outputPath: outPath, ...out };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error("用法: node scripts/runtime-nudge.mjs --book-root <本书根> [--json]");
    process.exit(2);
  }
  const out = runRuntimeNudge({ bookRoot: args.bookRoot });
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`[runtime-nudge] ${out.message}`);
    console.log(`[runtime-nudge] output=${out.outputPath}`);
    console.log(`[runtime-nudge] nudges=${out.totals.all} required=${out.totals.required}`);
  }
  process.exit(out.code);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
