#!/usr/bin/env node
/**
 * 写作契约门禁：校验 project-config 中目标字数、章数、每章初稿区间与素材笔记预算的一致性（Warning / --strict Blocker）。
 *
 * 用法：
 *   node scripts/writing-contract-gate.mjs --book-root <本书根> [--skill-root <技能根>] [--strict]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadScaleTiers, resolveSkillStrategyTier } from "./lib/scale-tiers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SKILL = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const o = { bookRoot: null, skillRoot: DEFAULT_SKILL, strict: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = argv[++i];
    else if (a === "--skill-root") o.skillRoot = path.resolve(argv[++i]);
    else if (a === "--strict") o.strict = true;
  }
  return o;
}

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object} cfg project-config
 * @param {object} tiers
 */
export function evaluateWritingContract(cfg, tiers) {
  const warnings = [];
  const blockers = [];

  const target = num(cfg.targetWordCount);
  const planned = num(cfg.plannedChapterTotal);
  const wmin = num(cfg.chapterDraftWordMin);
  const wmax = num(cfg.chapterDraftWordMax);
  const cmin = num(cfg.plannedChapterMin);
  const cmax = num(cfg.plannedChapterMax);
  const hasTargetAndPlanned = target != null && planned != null && planned > 0;
  const derivedAvg = hasTargetAndPlanned ? Math.round(target / planned) : null;
  const effectiveWmin = wmin != null ? wmin : derivedAvg != null ? Math.max(500, Math.round(derivedAvg * 0.7)) : null;
  const effectiveWmax = wmax != null ? wmax : derivedAvg != null ? Math.max(effectiveWmin || 0, Math.round(derivedAvg * 1.3)) : null;

  if (planned != null && cmin != null && planned < cmin) {
    blockers.push(`plannedChapterTotal(${planned}) < plannedChapterMin(${cmin})`);
  }
  if (planned != null && cmax != null && planned > cmax) {
    blockers.push(`plannedChapterTotal(${planned}) > plannedChapterMax(${cmax})`);
  }

  if (target != null && planned != null && planned > 0 && effectiveWmin != null && effectiveWmax != null) {
    const low = planned * effectiveWmin;
    const high = planned * effectiveWmax;
    if (target < low * 0.5) {
      warnings.push(
        `targetWordCount(${target}) 低于 plannedChapterTotal×chapterDraftWordMin 的 50%（约 ${Math.round(low * 0.5)}），请确认是否低估全书体量。`
      );
    }
    if (target > high * 2) {
      warnings.push(
        `targetWordCount(${target}) 高于 plannedChapterTotal×chapterDraftWordMax 的 200%（约 ${Math.round(high * 2)}），请确认章数或每章区间是否需调整。`
      );
    }
  }

  const strat = resolveSkillStrategyTier(target, planned, tiers);
  if (strat && strat.byWords !== strat.byChapters) {
    warnings.push(
      `字数隐含档位 ${strat.byWords} 与章数隐含档位 ${strat.byChapters} 不一致，已取较高档 ${strat.tier}（${strat.policy}）。请核对 targetWordCount 与 plannedChapterTotal。`
    );
  }

  return { warnings, blockers, strategy: strat };
}

export function runWritingContractGate(bookRoot, skillRoot, { strict = false } = {}) {
  const cfgPath = path.join(bookRoot, ".fbs", "project-config.json");
  const cfg = readJson(cfgPath);
  const tiers = loadScaleTiers(skillRoot);
  if (!cfg) {
    if (strict) return { code: 2, warnings: [], blockers: ["缺少 .fbs/project-config.json"], strategy: null };
    return { code: 0, warnings: [], blockers: [], strategy: null };
  }

  const materialPath = path.join(bookRoot, ".fbs", "material-inventory.md");
  const extra = [];
  const notesCap = num(cfg.materialGatherNotesMaxChars);
  if (notesCap != null && notesCap > 0 && fs.existsSync(materialPath)) {
    const len = fs.readFileSync(materialPath, "utf8").length;
    if (len > notesCap) {
      extra.push(`material-inventory.md 字符数 ${len} 超过 materialGatherNotesMaxChars(${notesCap})（Warning：扩预算须用户确认）。`);
    }
  }

  const { warnings, blockers, strategy } = evaluateWritingContract(cfg, tiers);
  const allWarnings = [...warnings, ...extra];
  if (blockers.length) return { code: 2, warnings: allWarnings, blockers, strategy };
  if (strict && allWarnings.length) return { code: 1, warnings: allWarnings, blockers, strategy };
  return { code: 0, warnings: allWarnings, blockers, strategy };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error("用法: node scripts/writing-contract-gate.mjs --book-root <本书根> [--skill-root <技能根>] [--strict]");
    process.exit(2);
  }
  const bookRoot = path.resolve(args.bookRoot);
  const result = runWritingContractGate(bookRoot, args.skillRoot, { strict: args.strict });
  for (const w of result.warnings) console.warn(`[writing-contract] WARN: ${w}`);
  for (const b of result.blockers) console.error(`[writing-contract] BLOCK: ${b}`);
  if (result.strategy) {
    console.log(
      `[writing-contract] 策略档位: ${result.strategy.tier}（${result.strategy.policy}） 字=${result.strategy.byWords} 章=${result.strategy.byChapters}`
    );
  }
  process.exit(result.code);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
