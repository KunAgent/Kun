#!/usr/bin/env node
/**
 * ESM 状态切换落盘：响应 v1.8.0 综合审计 P0-5「ESM 状态文件化」与 P0-2 运行时追踪。
 *
 * 用法（技能包根或任意 cwd）：
 *   node scripts/fbs-record-esm-transition.mjs --book-root <本书根> \
 *     --from IDLE --to INTAKE --reason "用户触发写书" [--genre A]
 *
 * 行为：
 *   1) 重写/创建 `.fbs/esm-state.md`（机器可读当前状态，供跨会话 Read）
 *   2) 在 `.fbs/规范执行状态.md` 的「## 切换日志」下 prepend 一条记录（若文件不存在则创建最小骨架）
 *
 * 状态名须与 section-3-workflow.md ESM 一致：IDLE INTAKE RESEARCH PLAN WRITE REVIEW WRITE_MORE DELIVER
 */
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const VALID = new Set([
  "IDLE",
  "INTAKE",
  "RESEARCH",
  "PLAN",
  "WRITE",
  "REVIEW",
  "WRITE_MORE",
  "DELIVER",
]);

const MIN_NORM_SKELETON = `# 规范执行状态（.fbs/规范执行状态.md）

> 由 \`init-fbs-multiagent-artifacts.mjs\` 生成完整模板；本骨架仅供 CLI 首次写入前兜底。

## ESM 状态追踪

| 时间 | 旧状态 | 新状态 | 触发原因 | 出口条件 |
|------|--------|--------|---------|---------|
| （待补） | — | — | — | — |

## 切换日志

`;

function parseArgs(argv) {
  const options = {
    bookRoot: null,
    from: null,
    to: null,
    reason: "",
    genre: "",
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--book-root") options.bookRoot = argv[++i];
    else if (arg === "--from") options.from = argv[++i];
    else if (arg === "--to") options.to = argv[++i];
    else if (arg === "--reason") options.reason = argv[++i] || "";
    else if (arg === "--genre") options.genre = argv[++i] || "";
  }
  return options;
}

function ensureNormExecState(fbsDir, { logger = console, quiet = false } = {}) {
  const targetPath = path.join(fbsDir, "规范执行状态.md");
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(fbsDir, { recursive: true });
    fs.writeFileSync(targetPath, MIN_NORM_SKELETON, "utf8");
    if (!quiet) logger.log("create skeleton:", targetPath);
  }
  return targetPath;
}

function prependTransitionLog(normPath, line) {
  let body = fs.readFileSync(normPath, "utf8");
  const marker = "## 切换日志";
  const index = body.indexOf(marker);
  if (index === -1) {
    body += `\n\n${marker}\n\n${line}\n`;
    fs.writeFileSync(normPath, body, "utf8");
    return;
  }
  const afterHeader = body.indexOf("\n", index);
  const insertAt = afterHeader === -1 ? index + marker.length : afterHeader + 1;
  body = body.slice(0, insertAt) + line + "\n" + body.slice(insertAt);
  fs.writeFileSync(normPath, body, "utf8");
}

const ITER_DEFAULTS = {
  iterationPhase: "none",
  expansionRound: 0,
  refinementRound: 0,
  lastInterruptAt: "",
  lastInterruptReason: "",
};

function readIterationFromExisting(fbsDir) {
  const p = path.join(fbsDir, "esm-state.md");
  if (!fs.existsSync(p)) return { ...ITER_DEFAULTS };
  const t = fs.readFileSync(p, "utf8");
  const pickStr = (key) => {
    const m = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(t);
    if (!m) return null;
    let v = m[1].trim();
    if (v.startsWith('"') && v.endsWith('"')) {
      try {
        return JSON.parse(v);
      } catch {
        return v.slice(1, -1);
      }
    }
    return v;
  };
  const pickNum = (key, def) => {
    const m = new RegExp(`^${key}:\\s*(\\d+)`, "m").exec(t);
    return m ? Number(m[1]) : def;
  };
  const ip = pickStr("iterationPhase");
  return {
    iterationPhase: ip != null && ip !== "" ? String(ip) : ITER_DEFAULTS.iterationPhase,
    expansionRound: pickNum("expansionRound", ITER_DEFAULTS.expansionRound),
    refinementRound: pickNum("refinementRound", ITER_DEFAULTS.refinementRound),
    lastInterruptAt: String(pickStr("lastInterruptAt") ?? ""),
    lastInterruptReason: String(pickStr("lastInterruptReason") ?? ""),
  };
}

function writeEsmState(
  fbsDir,
  { from, to, reason, genre, iso, iteration },
  { logger = console, quiet = false } = {},
) {
  const it = iteration || { ...ITER_DEFAULTS };
  const body = `---
currentState: "${to}"
previousState: "${from}"
lastTransitionAt: "${iso}"
transitionReason: ${JSON.stringify(reason || "")}
genre: ${JSON.stringify(genre || "")}
iterationPhase: ${JSON.stringify(String(it.iterationPhase || "none"))}
expansionRound: ${Number(it.expansionRound) || 0}
refinementRound: ${Number(it.refinementRound) || 0}
lastInterruptAt: ${JSON.stringify(it.lastInterruptAt || "")}
lastInterruptReason: ${JSON.stringify(it.lastInterruptReason || "")}
maintainedBy: "scripts/fbs-record-esm-transition.mjs"
---

# ESM 当前状态（.fbs/esm-state.md）

> **权威流程**：见 \`references/01-core/section-3-workflow.md\`「执行状态机」。  
> **更新**：每次对话内输出状态切换宣告后，**应**运行本脚本或等价更新本文件，使磁盘与对话一致（v1.8.0 审计：外部可验证）。  
> **迭代子阶段**（扩写/精修）：见 \`references/01-core/s3-expansion-phase.md\`、\`references/01-core/s3-refinement-phase.md\`；\`iterationPhase\` 为 \`none\` / \`expansion\` / \`refinement\`。

| 字段 | 值 |
|------|-----|
| 当前状态 | **${to}** |
| 上一状态 | ${from} |
| 切换时间 | ${iso} |
| 原因 | ${reason || "—"} |
| 体裁等级 | ${genre || "—"} |
| **iterationPhase** | ${it.iterationPhase || "none"} |
| **expansionRound** | ${it.expansionRound ?? 0} |
| **refinementRound** | ${it.refinementRound ?? 0} |
| **lastInterruptAt** | ${it.lastInterruptAt || "—"} |
`;
  const targetPath = path.join(fbsDir, "esm-state.md");
  fs.writeFileSync(targetPath, body, "utf8");
  if (!quiet) logger.log("write:", targetPath);
  return targetPath;
}

const STAGE_ALIAS_TO_LEGACY = {
  S0: "INTAKE",
  S1: "RESEARCH",
  S2: "PLAN",
  S3: "WRITE",
  S4: "REVIEW",
  S5: "DELIVER",
  S6: "DELIVER",
};

export function normalizeStateName(value) {
  return String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

export function resolveStateAlias(value) {
  const raw = normalizeStateName(value);
  if (VALID.has(raw)) return raw;
  if (STAGE_ALIAS_TO_LEGACY[raw]) return STAGE_ALIAS_TO_LEGACY[raw];
  return null;
}

function validateTransitionInput({ from, to }) {
  const fromState = resolveStateAlias(from);
  const toState = resolveStateAlias(to);
  if (!fromState || !toState) {
    throw new Error(`状态名须为: ${[...VALID].join(", ")}（或 S0-S6）`);
  }
  return { fromState, toState };
}

export async function recordESMTransition({
  bookRoot = process.cwd(),
  from,
  to,
  reason = "",
  genre = "",
  timestamp,
  logger = console,
  quiet = false,
} = {}) {
  if (!from || !to) {
    throw new Error("缺少 from/to，无法记录 ESM 状态切换");
  }

  const { fromState, toState } = validateTransitionInput({ from, to });
  const root = path.resolve(bookRoot || process.cwd());
  const fbsDir = path.join(root, ".fbs");
  fs.mkdirSync(fbsDir, { recursive: true });

  const iso = timestamp || new Date().toISOString();
  const normalizedGenre = String(genre || "").trim().toUpperCase();
  const iteration = readIterationFromExisting(fbsDir);
  const esmStatePath = writeEsmState(
    fbsDir,
    { from: fromState, to: toState, reason, genre: normalizedGenre, iso, iteration },
    { logger, quiet },
  );

  const normPath = ensureNormExecState(fbsDir, { logger, quiet });
  const logLine = `- **${iso}** · \`${fromState}\` → \`${toState}\` · ${reason || "—"}${normalizedGenre ? ` · 体裁 ${normalizedGenre}` : ""}`;
  prependTransitionLog(normPath, logLine);
  if (!quiet) {
    logger.log("append log:", normPath);
    logger.log("done.");
  }

  return {
    root,
    fbsDir,
    esmStatePath,
    normPath,
    from: fromState,
    to: toState,
    timestamp: iso,
    genre: normalizedGenre,
    logLine,
  };
}

export async function main(rawArgs = parseArgs(process.argv)) {
  const { bookRoot, from, to, reason, genre } = rawArgs;
  if (!bookRoot || !from || !to) {
    console.error(
      "用法: node scripts/fbs-record-esm-transition.mjs --book-root <本书根> --from <旧状态> --to <新状态> [--reason \"...\"] [--genre A|B|C]（状态支持 IDLE/INTAKE/... 或 S0-S6）"
    );
    process.exit(2);
  }

  try {
    await recordESMTransition({ bookRoot, from, to, reason, genre });
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  await main();
}
