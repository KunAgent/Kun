#!/usr/bin/env node
/**
 * 多智能体编排模板生成器（v2.0 — 统一编排层）：
 * - 读取 chapter-status.md，按未完成章节输出分配建议
 * - 支持 --format json（默认，内部格式）和 --format team（宿主team配置）
 * - team格式：输出宿主 team_create + Task 可消费的配置JSON
 */
import fs from "fs";
import path from "path";

function parseArgs(argv) {
  const o = { bookRoot: process.cwd(), stage: "S0", writers: 3, format: "json" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = argv[++i];
    else if (a === "--stage") o.stage = argv[++i] || "S0";
    else if (a === "--writers") o.writers = Math.max(1, Number(argv[++i]) || 3);
    else if (a === "--format") o.format = argv[++i] || "json";
  }
  return o;
}

function loadPendingChapters(bookRoot) {
  const stPath = path.join(bookRoot, ".fbs", "chapter-status.md");
  if (!fs.existsSync(stPath)) return [];
  const out = [];
  for (const line of fs.readFileSync(stPath, "utf8").split(/\r?\n/)) {
    if (!/^\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((s) => s.trim());
    if (cells.length < 3) continue;
    const id = cells[0];
    const status = cells[2] || "";
    if (!/^ch\d+$/i.test(id)) continue;
    if (!/已完成|✅|完成/.test(status)) out.push(id);
  }
  return out;
}

/**
 * 输出宿主team格式：team_create + Task 可消费的配置
 * Agent调用者可直接用此JSON创建team并spawn成员
 */
function toTeamFormat(args, pending, groups) {
  const teamName = `fbs-${args.stage.toLowerCase()}-${Date.now()}`;
  const members = groups.map((chs, i) => {
    const memberName = `writer-${String.fromCharCode(65 + i)}`;
    return {
      name: memberName,
      description: `${chs.length} chapters`,
      prompt: chs.map(ch =>
        `写章节${ch}：先读取Chapter Brief和search-policy，完成后更新chapter-status`
      ).join('\n'),
      subagent_name: "code-explorer",
      mode: "acceptEdits",
      max_turns: 12,
      chapters: chs
    };
  });

  return {
    team: {
      team_name: teamName,
      description: `FBS ${args.stage} writing team, ${pending.length} chapters, ${args.writers} writers`
    },
    members: members,
    notes: [
      "写作前先呈现并注入 Chapter Brief",
      "每章检索需入账并至少含1条L2/L3",
      "完成后更新 chapter-status 与 book-context-brief",
      "宿主team_create后逐个Task spawn成员"
    ]
  };
}

function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(args.bookRoot);
  const pending = loadPendingChapters(root);

  const groups = Array.from({ length: args.writers }, () => []);
  pending.forEach((ch, idx) => groups[idx % args.writers].push(ch));

  let output;
  if (args.format === "team") {
    output = toTeamFormat(args, pending, groups);
  } else {
    output = {
      stage: args.stage,
      generatedAt: new Date().toISOString(),
      writers: groups.map((chs, i) => ({ member: `writer-${String.fromCharCode(65 + i)}`, chapters: chs })),
      notes: [
        "写作前先呈现并注入 Chapter Brief",
        "每章检索需入账并至少含1条L2/L3",
        "完成后更新 chapter-status 与 book-context-brief"
      ]
    };
  }

  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

main();
