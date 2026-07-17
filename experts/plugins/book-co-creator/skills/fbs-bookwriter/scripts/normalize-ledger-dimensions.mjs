#!/usr/bin/env node
/**
 * 将 .fbs/search-ledger.jsonl 中 s0Dimension 短码归一为规范长键（search-policy → s0DimensionCanonical）
 *
 * 用法：
 *   node scripts/normalize-ledger-dimensions.mjs --skill-root <技能根> --book-root <本书根>
 *
 * 默认：仅 stdout 摘要（dry-run）
 *   --write   写回 ledger（会先备份 .bak）
 */
import fs from "fs";
import path from "path";

function parseArgs(argv) {
  const o = { skillRoot: null, bookRoot: null, write: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--skill-root") o.skillRoot = path.resolve(argv[++i]);
    else if (a === "--book-root") o.bookRoot = path.resolve(argv[++i]);
    else if (a === "--write") o.write = true;
  }
  return o;
}

function loadCanonical(skillRoot) {
  const p = path.join(skillRoot, "references/05-ops/search-policy.json");
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const block = j.s0DimensionCanonical || {};
  const shortToLong = block.shortToLong && typeof block.shortToLong === "object" ? block.shortToLong : {};
  const allowed = new Set(
    Array.isArray(block.allowedLongKeys) ? block.allowedLongKeys : []
  );
  return { shortToLong, allowed, path: p };
}

function main() {
  const args = parseArgs(process.argv);
  const skillRoot = args.skillRoot || path.resolve(process.cwd());
  const bookRoot = args.bookRoot;
  if (!bookRoot) {
    console.error(
      "用法: node scripts/normalize-ledger-dimensions.mjs --skill-root <技能根> --book-root <本书根> [--write]"
    );
    process.exit(2);
  }
  const { shortToLong, allowed } = loadCanonical(skillRoot);
  const ledgerPath = path.join(bookRoot, ".fbs", "search-ledger.jsonl");
  if (!fs.existsSync(ledgerPath)) {
    console.log("normalize-ledger-dimensions: 无 ledger 文件，跳过。", ledgerPath);
    process.exit(0);
  }
  const raw = fs.readFileSync(ledgerPath, "utf8");
  const lines = raw.split(/\n/);
  let replaced = 0;
  let unknown = 0;
  const outLines = [];

  for (const line of lines) {
    if (!line.trim()) {
      outLines.push(line);
      continue;
    }
    try {
      const obj = JSON.parse(line);
      const dim = obj.s0Dimension;
      if (typeof dim === "string" && shortToLong[dim]) {
        obj.s0Dimension = shortToLong[dim];
        replaced++;
      } else if (typeof dim === "string" && dim.length && allowed.size && !allowed.has(dim)) {
        unknown++;
      }
      outLines.push(JSON.stringify(obj));
    } catch {
      outLines.push(line);
      unknown++;
    }
  }

  console.log(
    `normalize-ledger-dimensions: s0Dimension 短码替换 ${replaced} 行；非 allowedLongKeys 或未识别 ${unknown} 行（仅统计，不阻断）`
  );

  if (args.write && replaced > 0) {
    const bak = ledgerPath + ".bak";
    fs.copyFileSync(ledgerPath, bak);
    fs.writeFileSync(ledgerPath, outLines.join("\n").replace(/\n*$/, "") + "\n", "utf8");
    console.log("normalize-ledger-dimensions: 已写回", ledgerPath, "备份", bak);
  } else if (args.write && replaced === 0) {
    console.log("normalize-ledger-dimensions: --write 但无替换，跳过写回");
  }
}

main();
