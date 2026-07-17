#!/usr/bin/env node
/**
 * 扩写计划结构门禁：在字数实测之前，校验 .fbs/expansion-plan.md 是否具备可执行契约。
 * 对标「计划可机器粗验」——减少无表格、无确认区即开工的情况。
 *
 * 用法：
 *   node scripts/verify-expansion-plan-structure.mjs --book-root <本书根> [--strict] [--json]
 *
 * 退出码：0 通过；1 有警告（非 strict 下仅警告）；2 硬失败或 strict 下未确认
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parsePlanTable } from "./expansion-word-verify.mjs";

const __filename = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const o = { bookRoot: null, strict: false, json: false, relaxed: undefined };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = path.resolve(argv[++i]);
    else if (a === "--strict") o.strict = true;
    else if (a === "--json") o.json = true;
    else if (a === "--relaxed") o.relaxed = true;
  }
  return o;
}

function hasHeading(raw, re) {
  return re.test(raw);
}

function userConfirmChecked(raw) {
  const block = raw.match(/##\s*用户确认[\s\S]*?(?=\n## |\n---\n|$)/i);
  if (!block) return null;
  const s = block[0];
  if (/\[x\]/i.test(s) && /用户已确认|确认本计划/.test(s)) return true;
  if (/\[\s*\]\s*/i.test(s) && /用户已确认|确认本计划/.test(s)) return false;
  return null;
}

export function verifyExpansionPlanStructure(bookRoot, opts = {}) {
  const strict = !!opts.strict;
  // 默认非 strict 即 relaxed：存量项目优先给出可执行告警，而不是直接阻断。
  const relaxed = opts.relaxed != null ? !!opts.relaxed : !strict;
  const planPath = path.join(bookRoot, ".fbs", "expansion-plan.md");
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(planPath)) {
    errors.push("missing .fbs/expansion-plan.md");
    return { ok: false, code: 2, errors, warnings, planPath };
  }

  const raw = fs.readFileSync(planPath, "utf8");

  if (!hasHeading(raw, /##\s+全书目标/)) {
    warnings.push('建议包含「## 全书目标」章节（见 init 模板与 s3-expansion-phase）');
  }
  if (!hasHeading(raw, /##\s*章节扩写目标表|机读/i)) {
    warnings.push('建议包含「章节扩写目标表」机读表（供 expansion-word-verify 解析）');
  }
  if (!hasHeading(raw, /##\s*执行策略|并行/i)) {
    warnings.push('建议包含「执行策略」并写明并行度（≤3，推荐≤2）');
  }
  if (!hasHeading(raw, /##\s*用户确认/)) {
    const msg = '缺少「## 用户确认」区块（P0：扩写前须可登记用户确认）';
    if (relaxed) warnings.push(`${msg}（relaxed：仅警告）`);
    else errors.push(msg);
  }

  const rows = parsePlanTable(planPath, bookRoot, { filterMeta: false });
  if (!rows.length) {
    const msg =
      "机读表无有效行（需表头含「目标字符」等且含章节、文件、目标字符数）";
    if (relaxed) warnings.push(`${msg}（relaxed：仅警告）`);
    else errors.push(msg);
  }

  const confirm = userConfirmChecked(raw);
  if (confirm === false && strict) {
    errors.push("strict: 用户确认未勾选（请将「用户已确认」改为 [x]）");
  } else if (confirm === null && strict) {
    errors.push("strict: 用户确认区无法解析（需含「用户已确认」与 [x]）");
  } else if (confirm === false) {
    warnings.push("用户确认未勾选 — 扩写前须在对话中确认并勾选");
  }

  const ok = errors.length === 0;
  let code = 2;
  if (ok) {
    code = warnings.length > 0 ? 1 : 0;
  }
  return { ok, code, errors, warnings, planPath, rowCount: rows.length };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error(
      "用法: node scripts/verify-expansion-plan-structure.mjs --book-root <本书根> [--strict] [--relaxed] [--json]"
    );
    process.exit(2);
  }

  const result = verifyExpansionPlanStructure(args.bookRoot, {
    strict: args.strict,
    relaxed: args.relaxed,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const e of result.errors) console.error(`[verify-expansion-plan-structure] ERROR: ${e}`);
    for (const w of result.warnings) console.warn(`[verify-expansion-plan-structure] WARN: ${w}`);
    if (result.ok && !result.errors.length) {
      console.log(
        `[verify-expansion-plan-structure] OK rows=${result.rowCount} ${result.planPath}`
      );
    }
  }

  process.exit(result.code);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
