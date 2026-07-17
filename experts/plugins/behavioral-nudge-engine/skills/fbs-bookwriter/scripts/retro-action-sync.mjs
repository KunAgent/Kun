#!/usr/bin/env node
/**
 * 复盘整改同步器：
 * - 从 .fbs/福帮手运行复盘报告*.md 提取「待整改清单」表格
 * - 产出 .fbs/retro-action-items.json 与 .fbs/retro-unresolved.md
 * - 可选 enforce：存在未修复 P0 则返回非零，作为门禁信号
 *
 * 用法：
 *   node scripts/retro-action-sync.mjs --book-root <本书根>
 *   node scripts/retro-action-sync.mjs --book-root <本书根> --report <报告.md> --enforce-p0 --json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { appendBookStateEvent } from "./lib/book-state-db.mjs";

function parseArgs(argv) {
  const o = {
    bookRoot: null,
    report: null,
    enforceP0: false,
    allowMissingReport: false,
    json: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = path.resolve(argv[++i] || "");
    else if (a === "--report") o.report = path.resolve(argv[++i] || "");
    else if (a === "--enforce-p0") o.enforceP0 = true;
    else if (a === "--allow-missing-report") o.allowMissingReport = true;
    else if (a === "--json") o.json = true;
  }
  return o;
}

function findLatestReport(bookRoot) {
  const fbs = path.join(bookRoot, ".fbs");
  if (!fs.existsSync(fbs)) return null;
  const files = fs
    .readdirSync(fbs)
    .filter((name) => /^福帮手运行复盘报告.*\.md$/i.test(name))
    .map((name) => ({ name, abs: path.join(fbs, name) }))
    .filter((x) => fs.statSync(x.abs).isFile());
  if (!files.length) return null;
  files.sort((a, b) => fs.statSync(b.abs).mtimeMs - fs.statSync(a.abs).mtimeMs);
  return files[0].abs;
}

function normalizeStatus(raw) {
  const s = String(raw || "").trim();
  if (!s) return "未知";
  if (/未修复|未完成|待处理|待修复|未关闭/.test(s)) return "未修复";
  if (/已修复|已完成|关闭|已关闭/.test(s)) return "已修复";
  return s;
}

function normalizeOwnerType(rawOwner) {
  const s = String(rawOwner || "").trim();
  if (!s) return "unknown";
  if (/开发|工程|脚本|agent|系统|平台|后端|前端/i.test(s)) return "engineering";
  if (/运营|产品|编辑|内容|策划/i.test(s)) return "operations";
  if (/用户|客户|甲方|需求方/i.test(s)) return "user";
  return "unknown";
}

function stableIssueId(priority, issue, owner) {
  const base = `${String(priority || "").trim()}|${String(issue || "").trim()}|${String(owner || "").trim()}`;
  const digest = crypto.createHash("sha1").update(base, "utf8").digest("hex").slice(0, 12);
  return `retro-${digest}`;
}

/** 用户可读的一句话影响说明（WorkBuddy 2026-04-15 审计：降低 retro-unresolved 晦涩感） */
function friendlyHintForIssue(issue) {
  const s = String(issue || "");
  if (/原地修改|覆盖|备份|回滚|事务/i.test(s)) return "涉及改文件时的安全与可回滚，建议先备份再改。";
  if (/质检|误标|A类|命令词|评分/i.test(s)) return "影响成稿语气是否显得「命令读者」，可择机统一润色。";
  if (/MAT|溯源|待核实/i.test(s)) return "影响事实与素材是否已核实，建议交付前处理。";
  if (/字数|统计|合并|口径/i.test(s)) return "影响字数与进度展示是否一致，建议对齐统计范围。";
  if (/版本|终稿|漂移|命名/i.test(s)) return "影响版本与交付物是否一致。";
  return "建议按复盘约定处理后再推进关键里程碑。";
}

function loadPreviousItems(outDir) {
  const prevPath = path.join(outDir, "retro-action-items.json");
  if (!fs.existsSync(prevPath)) return [];
  try {
    const prev = JSON.parse(fs.readFileSync(prevPath, "utf8"));
    return Array.isArray(prev.items) ? prev.items : [];
  } catch {
    return [];
  }
}

function parseActionItems(markdown) {
  const lines = markdown.split(/\r?\n/);
  const rows = [];
  let inTable = false;
  let headerSeen = false;
  for (const line of lines) {
    if (!line.trim().startsWith("|")) {
      if (inTable && headerSeen) break;
      continue;
    }
    const cells = line
      .split("|")
      .map((s) => s.trim())
      .filter((_, i, arr) => i > 0 && i < arr.length - 1);
    if (cells.length < 4) continue;

    const joined = cells.join("|");
    if (/优先级/.test(joined) && /问题/.test(joined) && /状态/.test(joined)) {
      inTable = true;
      headerSeen = true;
      continue;
    }
    if (!inTable) continue;
    if (/^-+$/.test(cells[0].replace(/:/g, ""))) continue;

    const [priority, issue, owner, status] = cells;
    if (!priority || !issue) continue;
    rows.push({
      priority: priority.trim(),
      issue: issue.trim(),
      owner: (owner || "").trim(),
      ownerType: normalizeOwnerType(owner),
      status: normalizeStatus(status),
    });
  }
  return rows;
}

export function runRetroActionSync({ bookRoot, reportPath, enforceP0 = false, allowMissingReport = false }) {
  const resolvedReport = reportPath || findLatestReport(bookRoot);
  if (!resolvedReport || !fs.existsSync(resolvedReport)) {
    if (allowMissingReport) {
      return {
        code: 0,
        message: "skip: 未找到复盘报告",
        report: resolvedReport,
        items: [],
        unresolved: [],
        unresolvedP0: [],
      };
    }
    return {
      code: 2,
      message: "未找到复盘报告（.fbs/福帮手运行复盘报告*.md）",
      report: resolvedReport,
      items: [],
      unresolved: [],
      unresolvedP0: [],
    };
  }

  const raw = fs.readFileSync(resolvedReport, "utf8");
  const items = parseActionItems(raw);
  if (!items.length) {
    return {
      code: 2,
      message: "复盘报告中未解析到待整改清单表格",
      report: resolvedReport,
      items: [],
      unresolved: [],
      unresolvedP0: [],
    };
  }

  const unresolved = items.filter((x) => x.status !== "已修复");
  const unresolvedP0 = unresolved.filter((x) => /^P0\b/i.test(x.priority));

  const outDir = path.join(bookRoot, ".fbs");
  fs.mkdirSync(outDir, { recursive: true });
  const nowIso = new Date().toISOString();
  const previousItems = loadPreviousItems(outDir);
  const previousIndex = new Map(
    previousItems
      .map((item) => [item.issueId, item])
      .filter(([k]) => !!k),
  );

  const withTracking = items.map((item) => {
    const issueId = stableIssueId(item.priority, item.issue, item.owner);
    const prev = previousIndex.get(issueId);
    return {
      ...item,
      issueId,
      ownerType: item.ownerType || normalizeOwnerType(item.owner),
      firstSeen: prev?.firstSeen || nowIso,
      lastSeen: nowIso,
    };
  });

  const unresolvedTracked = withTracking.filter((x) => x.status !== "已修复");
  const unresolvedP0Tracked = unresolvedTracked.filter((x) => /^P0\b/i.test(x.priority));

  const payload = {
    schemaVersion: "1.0.0",
    generatedAt: nowIso,
    sourceReport: resolvedReport,
    totals: {
      all: withTracking.length,
      unresolved: unresolvedTracked.length,
      unresolvedP0: unresolvedP0Tracked.length,
    },
    items: withTracking,
  };
  fs.writeFileSync(path.join(outDir, "retro-action-items.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");

  const mdLines = [
    "# 复盘未完成整改清单（自动同步）",
    "",
    `> 来源：\`${resolvedReport.replace(/\\/g, "/")}\``,
    `> 生成时间：${payload.generatedAt}`,
    "",
    "| ID | 优先级 | 问题 | 整改方 | 状态 | 首次发现 | 最近发现 |",
    "|----|--------|------|--------|------|----------|----------|",
    ...unresolvedTracked.map(
      (x) =>
        `| ${x.issueId} | ${x.priority} | ${x.issue} | ${x.owner || "—"} | ${x.status} | ${x.firstSeen || "—"} | ${x.lastSeen || "—"} |`,
    ),
    "",
  ];
  if (unresolvedTracked.length > 0) {
    mdLines.push(
      "## 简要说明（给作者）",
      "",
      "下表为技术跟踪项；**P0** 表示建议优先处理（可能与自动化门禁相关）。每项含义摘要：",
      "",
      ...unresolvedTracked.map((x) => {
        const one = String(x.issue || "").replace(/\|/g, "｜").replace(/\s+/g, " ").trim().slice(0, 160);
        return `- **${x.priority}** ${one} — ${friendlyHintForIssue(x.issue)}`;
      }),
      "",
    );
  }
  const md = mdLines.join("\n");
  fs.writeFileSync(path.join(outDir, "retro-unresolved.md"), md, "utf8");

  const shouldFail = enforceP0 && unresolvedP0Tracked.length > 0;
  try {
    appendBookStateEvent({
      bookRoot,
      source: "retro-action-sync",
      eventType: "retro_sync",
      level: shouldFail ? "warn" : "info",
      payload: {
        report: resolvedReport,
        totals: payload.totals,
        enforceP0: !!enforceP0,
        blocked: !!shouldFail,
      },
    });
  } catch {
    // 轻索引失败不影响主流程
  }
  return {
    code: shouldFail ? 1 : 0,
    message: shouldFail ? "存在未修复 P0 项" : "同步完成",
    report: resolvedReport,
    items: withTracking,
    unresolved: unresolvedTracked,
    unresolvedP0: unresolvedP0Tracked,
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error(
      "用法: node scripts/retro-action-sync.mjs --book-root <本书根> [--report <报告.md>] [--enforce-p0] [--allow-missing-report] [--json]"
    );
    process.exit(2);
  }
  const result = runRetroActionSync({
    bookRoot: args.bookRoot,
    reportPath: args.report,
    enforceP0: args.enforceP0,
    allowMissingReport: args.allowMissingReport,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`[retro-action-sync] ${result.message}`);
    if (result.report) console.log(`[retro-action-sync] report=${result.report}`);
    console.log(
      `[retro-action-sync] all=${result.items.length} unresolved=${result.unresolved.length} unresolvedP0=${result.unresolvedP0.length}`
    );
  }
  process.exit(result.code);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
