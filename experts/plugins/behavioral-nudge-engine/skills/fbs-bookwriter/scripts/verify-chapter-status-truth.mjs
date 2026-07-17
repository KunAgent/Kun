#!/usr/bin/env node
/**
 * 校验 .fbs/chapter-status.md 与磁盘真值一致性（升级版）：
 * - 已完成章节必须存在、非空、非 brief-only
 * - 若存在 brief 目标字数，默认执行 80% 最低验收比
 *
 * 用法：
 *   node scripts/verify-chapter-status-truth.mjs --book-root <本书根> --strict
 */
import fs from "fs";
import path from "path";
import { listDraftMd } from "./lib/chapter-md-resolve.mjs";

function parseArgs(argv) {
  const o = {
    bookRoot: null,
    strict: false,
    minBytes: 300,
    minWordRatio: 0.8,
    maxWordRatio: 1.2,
    failOnOver: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = argv[++i];
    else if (a === "--strict") o.strict = true;
    else if (a === "--min-bytes") o.minBytes = Math.max(80, Number(argv[++i]) || 300);
    else if (a === "--min-word-ratio") o.minWordRatio = Math.max(0.1, Number(argv[++i]) || 0.8);
    else if (a === "--max-word-ratio") o.maxWordRatio = Math.max(o.minWordRatio, Number(argv[++i]) || 1.2);
    else if (a === "--fail-on-over") o.failOnOver = true;
  }
  return o;
}

function parseStatusRows(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/^\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((s) => s.trim());
    if (cells.length < 3) continue;
    if (cells[0] === "章节ID" || cells[0].startsWith("------")) continue;
    rows.push({ chapterId: cells[0] || "", fileCell: cells[1] || "", status: cells[2] || "" });
  }
  return rows;
}

function extractFileNameFromCell(cell) {
  const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(cell);
  if (m) return path.basename(m[2]);
  return path.basename(String(cell || "").replace(/`/g, "").trim());
}

function resolveChapterById(filesAbs, chapterId) {
  const m = /^ch(\d+)$/i.exec(String(chapterId || ""));
  if (!m) return null;
  const n = String(parseInt(m[1], 10)).padStart(2, "0");
  return filesAbs.find((p) => /\[S3-Ch(\d+)\]/i.test(path.basename(p)) && path.basename(p).includes(`[S3-Ch${n}]`)) || null;
}

function isCompleted(status) {
  return /已完成|^✅|完成/.test(String(status || ""));
}

function hasBodyContent(text) {
  const lines = text.split(/\r?\n/);
  const body = lines
    .map((l) => l.trim())
    .filter((l) => l && !/^#/.test(l) && !/^[-*]\s+/.test(l) && !/^\|/.test(l) && !/^>/.test(l) && !/^```/.test(l));
  const longLines = body.filter((l) => l.length >= 20);
  return longLines.length >= 5;
}

function isBriefOnly(text) {
  const hasBrief = /Chapter\s*Brief|章节任务卡|Brief/.test(text);
  return hasBrief && !hasBodyContent(text);
}

function chapterNumFromId(chapterId) {
  const m = /^ch(\d+)$/i.exec(String(chapterId || ""));
  if (!m) return null;
  return parseInt(m[1], 10);
}

function readBriefExpectedWords(bookRoot, chapterNum) {
  if (!Number.isFinite(chapterNum)) return null;
  const n2 = String(chapterNum).padStart(2, "0");
  const candidates = [
    path.join(bookRoot, ".fbs", "briefs", `brief-ch${chapterNum}.md`),
    path.join(bookRoot, ".fbs", "writing-notes", `ch${n2}.brief.md`),
    path.join(bookRoot, ".fbs", "writing-notes", `brief-ch${n2}.md`),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const t = fs.readFileSync(p, "utf8");
    const m = t.match(/预计字数\s*[:：]\s*([\d,]+)/) || t.match(/目标字数\s*[:：]\s*([\d,]+)/);
    if (m) {
      const v = Number(String(m[1]).replace(/,/g, ""));
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return null;
}

function roughCharCount(mdText) {
  return String(mdText || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/\s+/g, "")
    .length;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error("用法: node scripts/verify-chapter-status-truth.mjs --book-root <本书根> [--strict]");
    process.exit(2);
  }

  const bookRoot = path.resolve(args.bookRoot);
  const statusPath = path.join(bookRoot, ".fbs", "chapter-status.md");
  if (!fs.existsSync(statusPath)) {
    console.error(`verify-chapter-status-truth: 文件不存在 ${statusPath}`);
    process.exit(2);
  }

  const files = listDraftMd(bookRoot, { recursive: true });
  const byBase = new Map(files.map((p) => [path.basename(p), p]));
  const rows = parseStatusRows(fs.readFileSync(statusPath, "utf8"));

  const failures = [];
  const warnings = [];

  for (const r of rows) {
    if (!isCompleted(r.status)) continue;

    const candidateName = extractFileNameFromCell(r.fileCell);
    let filePath = candidateName ? byBase.get(candidateName) : null;
    if (!filePath) filePath = resolveChapterById(files, r.chapterId);

    if (!filePath || !fs.existsSync(filePath)) {
      failures.push(`${r.chapterId}: 台账=已完成，但未找到章节文件（fileCell=${r.fileCell || "-"}）`);
      continue;
    }

    const st = fs.statSync(filePath);
    const text = fs.readFileSync(filePath, "utf8");
    if (st.size < args.minBytes) {
      failures.push(`${r.chapterId}: 台账=已完成，但文件过小(${st.size}B < ${args.minBytes}B) -> ${path.basename(filePath)}`);
      continue;
    }
    if (isBriefOnly(text)) {
      failures.push(`${r.chapterId}: 台账=已完成，但文件疑似仅 Brief 模板无正文 -> ${path.basename(filePath)}`);
      continue;
    }

    const chNum = chapterNumFromId(r.chapterId);
    const expected = readBriefExpectedWords(bookRoot, chNum);
    if (expected) {
      const actual = roughCharCount(text);
      const minReq = Math.floor(expected * args.minWordRatio);
      const maxRec = Math.floor(expected * args.maxWordRatio);
      if (actual < minReq) {
        failures.push(`${r.chapterId}: 字数未达门槛（实际≈${actual}，目标=${expected}，最低=${minReq}）`);
      } else if (actual > maxRec) {
        const msg = `${r.chapterId}: 字数超过建议上限（实际≈${actual}，目标=${expected}，建议≤${maxRec}）`;
        if (args.failOnOver) failures.push(msg);
        else warnings.push(msg);
      }
    }
  }

  console.log(`verify-chapter-status-truth: ${bookRoot}`);
  warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  if (!failures.length) {
    console.log("  ✅ 台账与磁盘真值一致（含字数门槛校验）");
    process.exit(0);
  }

  console.error("  ✖ 发现不一致:");
  failures.forEach((m) => console.error(`    - ${m}`));
  process.exit(args.strict ? 1 : 0);
}

main();
