#!/usr/bin/env node
/**
 * 术语门禁：
 * - 同时读取 .fbs/GLOSSARY.md 与 .fbs/术语锁定记录.md（若存在）
 * - --strict 时命中禁用变体则阻断
 * - 全角/半角/大小写统一标准化后去重
 *
 * v2.0.2 BUG-004 修复（L3-1）：
 *   A：增加 GLOSSARY.md 读取（原只读 术语锁定记录.md，拦截率0%）
 *   B：parseForbidden 节标题匹配扩展为"禁用变体|禁用写法"
 *   C：normalizeTerm 全角/半角标准化
 *   D：违规报告增加行号、修复建议、帮助中心 URL
 *   + ESM 入口守卫（NP0-04）：防止被 import 时触发 process.exit
 */
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const HELP_TEXT = `术语门禁（terminology-gate）

用法：
  node scripts/terminology-gate.mjs --book-root <本书根> --chapter-file <章.md> [--strict]

选项：
  --book-root <path>     书稿根目录
  --chapter-file <path>  章节文件路径
  --strict               命中禁用词时返回退出码 1
  --help                 显示帮助信息
`;

function parseArgs(argv) {
  const o = { bookRoot: null, chapterFile: null, strict: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = argv[++i];
    else if (a === "--chapter-file") o.chapterFile = argv[++i];
    else if (a === "--strict") o.strict = true;
    else if (a === "--help" || a === "-h") o.help = true;
  }
  return o;
}


/**
 * 全角转半角、全角空格转半角空格、统一小写并去首尾空格
 */
function normalizeTerm(term) {
  let t = term.replace(/[\uff01-\uff5e]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  t = t.replace(/\u3000/g, " ");
  return t.toLowerCase().trim();
}

/**
 * 按规范化键去重，保留首次出现的原始词（用于输出）
 */
function deduplicateWithNormalization(terms) {
  const seen = new Map();
  for (const t of terms) {
    const key = normalizeTerm(t);
    if (!seen.has(key)) seen.set(key, t);
  }
  return Array.from(seen.values());
}

function parseForbidden(md) {
  const out = [];
  let inSection = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^##\s*(禁用变体|禁用写法)/.test(line.trim())) { inSection = true; continue; }
    if (inSection && /^##\s+/.test(line.trim())) break;
    if (!inSection || !/^\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((s) => s.trim());
    const v = cells[0];
    if (!v || /^(禁用变体|禁用写法|-)/.test(v) || /^-+$/.test(v)) continue;
    out.push(v);
  }
  return out; // 不在此处去重，由 deduplicateWithNormalization 统一处理
}

/**
 * 扫描章节文件，返回结构化违规结果（供上层写日志使用）
 * D-OPS-1：不直接写 gate-run-log.jsonl，由 s3-start-gate.mjs 统一写入
 * @param {string} bookRoot  书稿根目录
 * @param {string} chapterFile  章节文件绝对路径
 * @returns {{ passed: boolean, violations: Array<{line: number, term: string, suggested: string}>, forbiddenCount: number }}
 */
export function scanChapter(bookRoot, chapterFile) {
  const root = path.resolve(bookRoot);
  const ch = path.resolve(chapterFile);

  const sources = [
    path.join(root, ".fbs", "GLOSSARY.md"),
    path.join(root, ".fbs", "术语锁定记录.md"),
  ];
  const allTerms = [];
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    allTerms.push(...parseForbidden(fs.readFileSync(src, "utf8")));
  }

  if (!allTerms.length) return { passed: true, violations: [], forbiddenCount: 0 };

  const forbidden = deduplicateWithNormalization(allTerms);
  const lines = fs.readFileSync(ch, "utf8").split(/\r?\n/);
  const violations = [];
  for (const term of forbidden) {
    const normKey = normalizeTerm(term);
    lines.forEach((line, idx) => {
      if (normalizeTerm(line).includes(normKey)) {
        violations.push({ line: idx + 1, term, suggested: "" });
      }
    });
  }

  return {
    passed: violations.length === 0,
    violations,
    forbiddenCount: forbidden.length,
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }
  if (!args.bookRoot || !args.chapterFile) {
    console.error("用法: node scripts/terminology-gate.mjs --book-root <本书根> --chapter-file <章.md> [--strict]");
    process.exit(2);
  }

  const root = path.resolve(args.bookRoot);
  const ch = path.resolve(args.chapterFile);
  if (!fs.existsSync(ch)) {
    console.error(`✖ 章节不存在: ${ch}`);
    process.exit(1);
  }

  // ── BUG-004 修复：同时读取 GLOSSARY.md 与 术语锁定记录.md ──────────────────
  const sources = [
    path.join(root, ".fbs", "GLOSSARY.md"),
    path.join(root, ".fbs", "术语锁定记录.md"),
  ];

  const allTerms = [];
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    const terms = parseForbidden(fs.readFileSync(src, "utf8"));
    console.log(`terminology-gate: 从 ${path.basename(src)} 加载了 ${terms.length} 个禁用词`);
    allTerms.push(...terms);
  }

  if (!allTerms.length) {
    console.log("terminology-gate: 无禁用词来源，跳过");
    process.exit(0);
  }

  // BUG-004-C 修复：全角/半角标准化后去重
  const forbidden = deduplicateWithNormalization(allTerms);
  console.log(`terminology-gate: 去重后共 ${forbidden.length} 个禁用词（已标准化全角/半角/大小写）`);

  const chapterText = fs.readFileSync(ch, "utf8");

  // 按行扫描以提供行号信息
  const lines = chapterText.split(/\r?\n/);
  const violations = [];
  for (const term of forbidden) {
    const normKey = normalizeTerm(term);
    lines.forEach((line, idx) => {
      if (normalizeTerm(line).includes(normKey)) {
        violations.push({ line: idx + 1, term });
      }
    });
  }

  if (!violations.length) {
    console.log("terminology-gate: ✅ 通过");
    process.exit(0);
  }

  // BUG-004-D 修复：中文友好提示 + 行号 + 修复步骤 + 帮助中心 URL（v4 N-3）
  console.error("❌ 术语一致性检查失败：");
  for (const v of violations) {
    console.error(`   行 ${v.line}：发现禁用词「${v.term}」`);
    console.error(`   建议替换为：（请查阅 .fbs/GLOSSARY.md 或 .fbs/术语锁定记录.md § 标准写法）`);
  }
  console.error("   修复方法：将上述禁用词替换为标准写法后重新运行");
  console.error("   参考文档：.fbs/GLOSSARY.md § 禁用变体 / .fbs/术语锁定记录.md § 禁用变体");
  console.error("   帮助中心：https://fbs-bookwriter.u3w.com/help/terminology-gate");
  process.exit(args.strict ? 1 : 0);
}

function isDirectRun() {
  return !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

// NP0-04 ESM 入口守卫：防止被 import 调用时触发 main() 中的 process.exit
if (isDirectRun()) {
  main();
}

