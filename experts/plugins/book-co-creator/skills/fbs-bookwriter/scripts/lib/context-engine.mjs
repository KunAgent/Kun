function clampText(text, maxChars) {
  const s = String(text || "");
  if (!Number.isFinite(maxChars) || maxChars <= 0 || s.length <= maxChars) return s;
  return `${s.slice(0, maxChars - 1)}…`;
}

/** 场景包 → 首响压缩策略（单坐标：与 intake-runtime-hooks 推断 id 对齐） */
const SCENE_PACK_POLICY = {
  general: { maxInfoItems: 16, maxWarningItems: 12, maxItemChars: 220, maxPrimaryOptions: 3 },
  genealogy: { maxInfoItems: 14, maxWarningItems: 14, maxItemChars: 240, maxPrimaryOptions: 3 },
  whitepaper: { maxInfoItems: 18, maxWarningItems: 10, maxItemChars: 200, maxPrimaryOptions: 3 },
  report: { maxInfoItems: 17, maxWarningItems: 11, maxItemChars: 210, maxPrimaryOptions: 3 },
  consultant: { maxInfoItems: 16, maxWarningItems: 12, maxItemChars: 215, maxPrimaryOptions: 3 },
  ghostwriter: { maxInfoItems: 15, maxWarningItems: 13, maxItemChars: 225, maxPrimaryOptions: 3 },
  training: { maxInfoItems: 16, maxWarningItems: 12, maxItemChars: 218, maxPrimaryOptions: 3 },
  "personal-book": { maxInfoItems: 15, maxWarningItems: 13, maxItemChars: 228, maxPrimaryOptions: 3 },
};

const DEFAULT_PACK = "general";

function resolveScenePackPolicy(scenePackId) {
  const id = String(scenePackId || DEFAULT_PACK).trim() || DEFAULT_PACK;
  return SCENE_PACK_POLICY[id] || SCENE_PACK_POLICY[DEFAULT_PACK];
}

export class SummaryCompressorContextEngine {
  constructor(options = {}) {
    this.name = "summary-compressor";
    this.kind = "builtin";
    this.scenePackId = String(options.scenePackId || DEFAULT_PACK).trim() || DEFAULT_PACK;
    const p = resolveScenePackPolicy(this.scenePackId);
    this.maxInfoItems = Number(options.maxInfoItems) || p.maxInfoItems;
    this.maxWarningItems = Number(options.maxWarningItems) || p.maxWarningItems;
    this.maxItemChars = Number(options.maxItemChars) || p.maxItemChars;
    this.maxPrimaryOptions = Number(options.maxPrimaryOptions) || p.maxPrimaryOptions;
    this.bookRoot = options.bookRoot ? String(options.bookRoot) : null;
  }

  getMeta() {
    const caps = {
      maxInfoItems: this.maxInfoItems,
      maxWarningItems: this.maxWarningItems,
      maxItemChars: this.maxItemChars,
      maxPrimaryOptions: this.maxPrimaryOptions,
    };
    const used = {
      info: `≤${this.maxInfoItems}`,
      warnings: `≤${this.maxWarningItems}`,
      itemChars: `≤${this.maxItemChars}`,
    };
    return {
      kind: this.kind,
      name: this.name,
      scenePackId: this.scenePackId,
      policySchema: "fbs-context-engine-policy-v1",
      policy: caps,
      metering: {
        intakeInfoCap: used.info,
        intakeWarningsCap: used.warnings,
        intakeItemCharsCap: used.itemChars,
      },
    };
  }

  compressInfo(info = []) {
    return (Array.isArray(info) ? info : [])
      .slice(0, this.maxInfoItems)
      .map((x) => clampText(x, this.maxItemChars));
  }

  compressWarnings(warnings = []) {
    return (Array.isArray(warnings) ? warnings : [])
      .slice(0, this.maxWarningItems)
      .map((x) => clampText(x, this.maxItemChars));
  }

  compressPrimaryOptions(options = []) {
    return (Array.isArray(options) ? options : [])
      .slice(0, this.maxPrimaryOptions)
      .map((x) => clampText(x, 80));
  }
}

/**
 * @param {{ scenePackId?: string, bookRoot?: string, maxInfoItems?: number }} [options]
 */
export function createContextEngine(options = {}) {
  return new SummaryCompressorContextEngine(options);
}
