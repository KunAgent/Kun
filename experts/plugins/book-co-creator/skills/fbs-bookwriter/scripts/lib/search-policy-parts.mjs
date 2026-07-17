/**
 * search-policy.json 分片定义：每键仅属于一个分片；合并顺序与下列文件顺序一致。
 */
import fs from "fs";
import path from "path";

export const SEARCH_POLICY_PARTS_DIR = "references/05-ops/search-policy.parts";

/** @type {{ file: string; keys: string[] }[]} */
export const SEARCH_POLICY_KEY_GROUPS = [
  { file: "01-core.json", keys: ["$schema", "name", "description", "version"] },
  {
    file: "02-stages.json",
    keys: ["mandatoryWebSearchStages", "conditionalWebSearchStages"],
  },
  {
    file: "03-topic-memory-env.json",
    keys: ["topicLock", "userMemoryIntegration", "environmentSnapshot"],
  },
  {
    file: "04-entry-workplanes.json",
    keys: ["entryWorkplanes", "searchPreflightContract", "workspaceGovernance"],
  },
  {
    file: "05-s5-smart.json",
    keys: ["s5FinalReviewNotes", "smartMemory", "selfEnhancementEvolution"],
  },
  {
    file: "06-chapter-s0.json",
    keys: [
      "chapterWriting",
      "searchPurposeLayers",
      "s0WorkIntelPolicy",
      "sessionProtocols",
      "s0ParallelQueries",
      "s0ParallelQueriesExecution",
      "s0ParallelQueriesSemantics",
      "s0DimensionCompleteness",
    ],
  },
  {
    file: "07-quality.json",
    keys: ["qualityGate", "qualityPanoramaExecution", "qualityAuditProfiles"],
  },
  {
    file: "08-access-budgets.json",
    keys: [
      "searchAccessPolicy",
      "rateBudget",
      "batchSearchBudget",
      "materialGatherBudget",
      "postFreezeSearchLimits",
      "expansionS35",
    ],
  },
  {
    file: "09-writing-gates.json",
    keys: ["writingNotes", "briefLifecycleGate", "heartbeatEscalation", "chapterAcceptanceGate"],
  },
  {
    file: "10-material.json",
    keys: ["materialLibrary", "materialSufficiency", "autoMaterialArchive", "materialTracking"],
  },
  {
    file: "11-temporal-esm.json",
    keys: [
      "temporalAccuracy",
      "searchEnhancement",
      "esmExecutionTracking",
      "esmAnnouncementAtomicity",
      "termConsistencyTracking",
      "yearSourceLedger",
    ],
  },
  {
    file: "12-index-routing.json",
    keys: [
      "p0AutomationIndex",
      "s0DimensionCanonical",
      "queryOptimizationAudit",
      "timeAnchorPreflight",
      "queryVariantPolicy",
      "cnSourceRoutingPolicy",
      "reflectiveRepairPolicy",
      "memoryWritebackPolicy",
      "executionChainIndex",
    ],
  },
];

export function allKeysInGroups() {
  const out = [];
  for (const g of SEARCH_POLICY_KEY_GROUPS) {
    out.push(...g.keys);
  }
  return out;
}

/**
 * 从已解析的策略对象按组分片写入 search-policy.parts/
 */
export function writeSearchPolicyParts(skillRoot, monolithic) {
  const keys = Object.keys(monolithic);
  const covered = new Set();
  const partsAbs = path.join(skillRoot, SEARCH_POLICY_PARTS_DIR);
  fs.mkdirSync(partsAbs, { recursive: true });

  for (const group of SEARCH_POLICY_KEY_GROUPS) {
    const slice = {};
    for (const k of keys) {
      if (group.keys.includes(k)) {
        slice[k] = monolithic[k];
        covered.add(k);
      }
    }
    const missing = group.keys.filter((k) => !(k in monolithic));
    if (missing.length) {
      throw new Error(`分片 ${group.file} 缺少键: ${missing.join(", ")}`);
    }
    const outPath = path.join(partsAbs, group.file);
    fs.writeFileSync(outPath, JSON.stringify(slice, null, 2) + "\n", "utf8");
  }

  const extra = keys.filter((k) => !covered.has(k));
  if (extra.length) {
    throw new Error(`search-policy 存在未映射到分片的键: ${extra.join(", ")}`);
  }
}

/**
 * 合并分片为单一对象（保持分片文件内键顺序 + 按组分片顺序叠加）
 */
export function mergeSearchPolicyParts(skillRoot) {
  const partsAbs = path.join(skillRoot, SEARCH_POLICY_PARTS_DIR);
  if (!fs.existsSync(partsAbs)) {
    throw new Error(`缺少分片目录: ${partsAbs}`);
  }
  const merged = {};
  for (const group of SEARCH_POLICY_KEY_GROUPS) {
    const p = path.join(partsAbs, group.file);
    if (!fs.existsSync(p)) {
      throw new Error(`缺少分片文件: ${p}`);
    }
    const part = JSON.parse(fs.readFileSync(p, "utf8"));
    for (const k of Object.keys(part)) {
      if (k in merged) {
        throw new Error(`合并冲突：键 ${k} 重复`);
      }
      merged[k] = part[k];
    }
  }
  return merged;
}

export function stringifySearchPolicy(obj) {
  return JSON.stringify(obj, null, 2) + "\n";
}
