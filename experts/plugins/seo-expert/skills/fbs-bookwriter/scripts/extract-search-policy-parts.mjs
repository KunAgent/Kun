#!/usr/bin/env node
/**
 * 一次性/维护用：从 references/05-ops/search-policy.json 生成分片到 search-policy.parts/
 * 修改策略时请编辑分片后运行 build-search-policy.mjs。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SEARCH_POLICY_PARTS_DIR, writeSearchPolicyParts } from "./lib/search-policy-parts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const o = { skillRoot: path.resolve(__dirname, "..") };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--skill-root" && argv[i + 1]) o.skillRoot = path.resolve(argv[++i]);
  }
  return o;
}

function main() {
  const { skillRoot } = parseArgs(process.argv);
  const policyPath = path.join(skillRoot, "references", "05-ops", "search-policy.json");
  if (!fs.existsSync(policyPath)) {
    console.error(`缺少 ${policyPath}`);
    process.exit(2);
  }
  const monolithic = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  writeSearchPolicyParts(skillRoot, monolithic);
  console.log(`[extract-search-policy-parts] 已写入 ${path.join(skillRoot, SEARCH_POLICY_PARTS_DIR)}`);
}

main();
