#!/usr/bin/env node
import fs from "fs";
import path from "path";

function parseArgs(argv) {
  const repoRoot = process.cwd();
  const o = {
    fullFile: path.join(repoRoot, "references", "01-core", "section-3-workflow.full.md"),
    outDir: path.join(repoRoot, "references", "01-core", "workflow-volumes"),
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--full-file") o.fullFile = argv[++i];
    else if (a === "--out-dir") o.outDir = argv[++i];
  }
  return o;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function shiftRelativeLinks(markdown) {
  return markdown.replace(/\]\(([^)]+)\)/g, (all, target) => {
    const t = String(target || "").trim();
    if (!t || t.startsWith("http://") || t.startsWith("https://") || t.startsWith("#")) return all;
    if (t.startsWith("./")) return all.replace(t, `../${t.slice(2)}`);
    if (t.startsWith("../")) return all.replace(t, `../${t}`);
    return all;
  });
}

function main() {
  const args = parseArgs(process.argv);
  const fullFile = path.resolve(args.fullFile);
  const outDir = path.resolve(args.outDir);

  if (!fs.existsSync(fullFile)) {
    console.error(`未找到文件: ${fullFile}`);
    process.exit(2);
  }

  const lines = fs.readFileSync(fullFile, "utf8").split(/\r?\n/);

  const starts = {
    S0: 517,
    S1: 789,
    S2: 1032,
    S25: 1161,
    S3: 1215,
    S4: 1781,
    S5: 1896,
    S6: 1987,
  };

  const order = ["S0", "S1", "S2", "S25", "S3", "S4", "S5", "S6"];
  const files = {
    S0: "workflow-s0.md",
    S1: "workflow-s1.md",
    S2: "workflow-s2.md",
    S25: "workflow-s2.5.md",
    S3: "workflow-s3.md",
    S4: "workflow-s4.md",
    S5: "workflow-s5.md",
    S6: "workflow-s6.md",
  };

  ensureDir(outDir);

  for (let i = 0; i < order.length; i++) {
    const key = order[i];
    const start = starts[key] - 1;
    const end = i < order.length - 1 ? starts[order[i + 1]] - 2 : lines.length - 1;
    if (start < 0 || start >= lines.length || end < start) continue;

    const header = `# ${key} 分卷\n\n> 来源：section-3-workflow.full.md（自动切分）\n\n`;
    const bodyRaw = lines.slice(start, end + 1).join("\n");
    const body = shiftRelativeLinks(bodyRaw);
    const outPath = path.join(outDir, files[key]);
    fs.writeFileSync(outPath, header + body + "\n", "utf8");
    console.log(`已生成: ${outPath}`);
  }

  console.log("split-workflow-full: done");
}

main();
