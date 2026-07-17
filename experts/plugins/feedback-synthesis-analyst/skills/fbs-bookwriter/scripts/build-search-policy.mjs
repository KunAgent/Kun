#!/usr/bin/env node
/**
 * 合并 references/05-ops/search-policy.parts/*.json → references/05-ops/search-policy.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  mergeSearchPolicyParts,
  stringifySearchPolicy,
} from "./lib/search-policy-parts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const o = { skillRoot: path.resolve(__dirname, ".."), check: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--skill-root" && argv[i + 1]) o.skillRoot = path.resolve(argv[++i]);
    else if (argv[i] === "--check") o.check = true;
  }
  return o;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function main() {
  const { skillRoot, check } = parseArgs(process.argv);
  const outPath = path.join(skillRoot, "references", "05-ops", "search-policy.json");
  const merged = mergeSearchPolicyParts(skillRoot);
  const next = stringifySearchPolicy(merged);

  if (check && fs.existsSync(outPath)) {
    const prev = JSON.parse(fs.readFileSync(outPath, "utf8"));
    if (!deepEqual(prev, merged)) {
      console.error("[build-search-policy] --check 失败：合并结果与现有 search-policy.json 不一致");
      console.error("请运行: node scripts/build-search-policy.mjs（不写 --check）后复核 diff");
      process.exit(1);
    }
    console.log("[build-search-policy] --check 通过");
    process.exit(0);
  }

  fs.writeFileSync(outPath, next, "utf8");
  console.log(`[build-search-policy] 已写入 ${outPath}`);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
