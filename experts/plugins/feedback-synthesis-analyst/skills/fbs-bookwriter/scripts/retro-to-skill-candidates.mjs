#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

function parseArgs(argv) {
  const o = { bookRoot: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = path.resolve(argv[++i] || "");
    else if (a === "--json") o.json = true;
  }
  return o;
}

function classifyPattern(issue = "") {
  const s = String(issue);
  if (/原地修改|覆盖|回滚|备份|事务/i.test(s)) return "atomic-write-protocol";
  if (/终稿|版本|命名|发版|漂移/i.test(s)) return "final-draft-governance";
  if (/质量|质检|误报|误判|可读性/i.test(s)) return "quality-scope-control";
  if (/复盘|整改|闭环|跟踪/i.test(s)) return "retro-closure";
  return "general-process-hardening";
}

function buildSuggestedAction(pattern) {
  if (pattern === "atomic-write-protocol") return "补齐读写分离 + 临时文件原子替换 + 回滚点";
  if (pattern === "final-draft-governance") return "补齐终稿状态机与哈希校验，明确 release 切换门禁";
  if (pattern === "quality-scope-control") return "补齐质量脚本作用域声明与抽样/全量策略";
  if (pattern === "retro-closure") return "把整改项接入 intake / p0-audits 强提醒与阻断";
  return "沉淀为可复用 SOP，并补最小自动化门禁";
}

export function runRetroToSkillCandidates({ bookRoot }) {
  const root = path.resolve(bookRoot || process.cwd());
  const fbs = path.join(root, ".fbs");
  const inPath = path.join(fbs, "retro-action-items.json");
  if (!fs.existsSync(inPath)) {
    return {
      code: 0,
      message: "skip: 未找到 retro-action-items.json",
      candidates: [],
      outputPath: path.join(fbs, "retro-skill-candidates.json"),
    };
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(inPath, "utf8"));
  } catch (error) {
    return { code: 2, message: `retro-action-items.json 解析失败: ${error.message}`, candidates: [] };
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  const unresolved = items.filter((x) => String(x.status || "") !== "已修复");
  const candidates = unresolved.map((item, idx) => {
    const pattern = classifyPattern(item.issue);
    return {
      candidateId: `cand-${item.issueId || idx + 1}`,
      sourceIssueId: item.issueId || null,
      priority: item.priority || "P2",
      issue: item.issue || "",
      ownerType: item.ownerType || "unknown",
      pattern,
      suggestedAction: buildSuggestedAction(pattern),
      suggestedSkillSlug: `retro-${pattern}`,
      confidence: /^P0/i.test(item.priority || "") ? "high" : "medium",
    };
  });

  const out = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    source: inPath,
    totals: {
      all: candidates.length,
      highConfidence: candidates.filter((x) => x.confidence === "high").length,
    },
    candidates,
  };
  fs.mkdirSync(fbs, { recursive: true });
  const outPath = path.join(fbs, "retro-skill-candidates.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  return { code: 0, message: "ok", outputPath: outPath, candidates };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error("用法: node scripts/retro-to-skill-candidates.mjs --book-root <本书根> [--json]");
    process.exit(2);
  }
  const out = runRetroToSkillCandidates({ bookRoot: args.bookRoot });
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`[retro-to-skill-candidates] ${out.message}`);
    if (out.outputPath) console.log(`[retro-to-skill-candidates] output=${out.outputPath}`);
    console.log(`[retro-to-skill-candidates] candidates=${out.candidates.length}`);
  }
  process.exit(out.code);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
