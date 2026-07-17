#!/usr/bin/env node
import fs from "fs";
import path from "path";

function parseArgs(argv) {
  const out = {
    bookRoot: null,
    trackCount: null,
    minMaterial: 6,
    confirmAdvance: false,
    json: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") out.bookRoot = path.resolve(argv[++i] || "");
    else if (a === "--track-count") out.trackCount = Number(argv[++i]);
    else if (a === "--min-material") out.minMaterial = Number(argv[++i]) || 6;
    else if (a === "--confirm-advance") out.confirmAdvance = true;
    else if (a === "--json") out.json = true;
  }
  return out;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function inferTrackCount(bookRoot, explicitTrackCount) {
  if (Number.isFinite(explicitTrackCount) && explicitTrackCount > 0) return Math.floor(explicitTrackCount);
  const cfg = readJsonIfExists(path.join(bookRoot, ".fbs", "project-config.json"));
  const maybe = [
    cfg?.trackCount,
    cfg?.laneCount,
    cfg?.raceTrackCount,
    cfg?.targetTracks,
    cfg?.project?.trackCount,
  ].map((x) => Number(x)).find((x) => Number.isFinite(x) && x > 0);
  if (maybe) return Math.floor(maybe);
  return null;
}

function countMaterialItems(materialPath) {
  if (!fs.existsSync(materialPath)) return 0;
  const text = fs.readFileSync(materialPath, "utf8");
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*[-*]\s+/.test(line)) count += 1;
    else if (/^\s*\d+[.)、]\s+/.test(line)) count += 1;
  }
  return count;
}

function resolveEsmStageFromState(raw) {
  const v = String(raw || "").trim().replace(/^["']|["']$/g, "").toUpperCase();
  const map = {
    S0: "S0",
    S1: "S1",
    S2: "S2",
    S3: "S3",
    S4: "S4",
    S5: "S5",
    S6: "S6",
    INTAKE: "S0",
    IDLE: "S0",
    RESEARCH: "S1",
    PLAN: "S2",
    WRITE: "S3",
    REVIEW: "S4",
    DELIVER: "S5",
  };
  return map[v] || null;
}

function detectCurrentStage(bookRoot) {
  const p = path.join(bookRoot, ".fbs", "esm-state.md");
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, "utf8");
  const table = text.match(/\|\s*(?:当前状态|当前阶段)\s*\|\s*[^|\r\n]*?(S[0-6])(?![0-9])/i);
  if (table?.[1]) return table[1].toUpperCase();
  const fm = text.match(/^\s*currentState:\s*([^\r\n]+)/m);
  return fm ? resolveEsmStageFromState(fm[1]) : null;
}

export function runS0ExitGate({ bookRoot, trackCount = null, minMaterial = 6, confirmAdvance = false } = {}) {
  if (!bookRoot) return { code: 2, message: "missing --book-root" };
  if (!fs.existsSync(bookRoot)) return { code: 2, message: "book-root not exists" };

  const currentStage = detectCurrentStage(bookRoot);
  if (currentStage && currentStage !== "S0") {
    return {
      code: 0,
      message: `S0 gate skipped: current stage is ${currentStage}`,
      readyToExitS0: true,
      currentStage,
      skipped: true,
      checks: [
        {
          id: "stage_applicability",
          ok: true,
          detail: `当前阶段 ${currentStage}，S0 门禁仅在 S0 阶段强制执行`,
        },
      ],
    };
  }

  const fbs = path.join(bookRoot, ".fbs");
  const authorMeta = path.join(fbs, "author-meta.md");
  const material = path.join(fbs, "material-library.md");
  const resolvedTrackCount = inferTrackCount(bookRoot, trackCount);
  const materialCount = countMaterialItems(material);
  const requiredByTracks = resolvedTrackCount ? resolvedTrackCount * 2 : minMaterial;
  const requiredMaterialCount = Math.max(minMaterial, requiredByTracks);
  const authorOk = fs.existsSync(authorMeta) && fs.readFileSync(authorMeta, "utf8").trim().length > 0;
  const materialOk = fs.existsSync(material) && materialCount >= requiredMaterialCount;
  const confirmOk = !!confirmAdvance;
  const ready = authorOk && materialOk && confirmOk;

  const checks = [
    {
      id: "author_meta",
      ok: authorOk,
      detail: authorOk ? "author-meta.md 已就绪" : "缺少或为空 .fbs/author-meta.md",
    },
    {
      id: "material_enough",
      ok: materialOk,
      detail: materialOk
        ? `素材条数达标（${materialCount}/${requiredMaterialCount}）`
        : `素材条数不足（${materialCount}/${requiredMaterialCount}）`,
    },
    {
      id: "user_confirm_advance",
      ok: confirmOk,
      detail: confirmOk ? "已确认推进 S0→S1" : "未收到推进确认（需传 --confirm-advance）",
    },
  ];

  return {
    code: ready ? 0 : 1,
    message: ready ? "S0 exit gate passed" : "S0 exit gate blocked",
    readyToExitS0: ready,
    currentStage: currentStage || "S0",
    skipped: false,
    trackCount: resolvedTrackCount,
    materialCount,
    requiredMaterialCount,
    checks,
  };
}

function writeGateSnapshot(bookRoot, result) {
  try {
    const gatesDir = path.join(bookRoot, ".fbs", "gates");
    fs.mkdirSync(gatesDir, { recursive: true });
    const payload = {
      gateId: "s0-exit-gate",
      updatedAt: new Date().toISOString(),
      ...result,
    };
    fs.writeFileSync(path.join(gatesDir, "s0-exit-gate.last.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
  } catch {
    // ignore
  }
}

function main() {
  const args = parseArgs(process.argv);
  const out = runS0ExitGate(args);
  if (args.bookRoot) writeGateSnapshot(args.bookRoot, out);
  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    const icon = out.code === 0 ? "✅" : "❌";
    console.log(`[s0-exit-gate] ${icon} ${out.message}`);
    if (Array.isArray(out.checks)) {
      out.checks.forEach((item) => {
        console.log(`  ${item.ok ? "✓" : "✖"} ${item.id}: ${item.detail}`);
      });
    }
  }
  process.exit(out.code);
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith("s0-exit-gate.mjs")) {
  main();
}
