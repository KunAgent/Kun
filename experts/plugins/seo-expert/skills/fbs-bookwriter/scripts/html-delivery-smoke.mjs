#!/usr/bin/env node
/**
 * HTML 交付烟测（D1 / D2 / D3 对照）：
 * - 基础合法性：文件存在、非空、doctype/html/body 完整
 * - D1 基础结构：样式存在、脚注未残留 Markdown、Mermaid 未残留源码
 * - strict：链接有效性、h1/h2/h3 结构、破折号密度/字形纪律、D3 反模式
 */
import fs from "fs";
import path from "path";

function parseArgs(argv) {
  const o = { html: null, strict: false, failOnWarn: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--html") o.html = argv[++i];
    else if (a === "--strict") o.strict = true;
    else if (a === "--fail-on-warn") o.failOnWarn = true;
  }
  return o;
}

function extractVisibleText(html) {
  return String(html || "")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<div\b[^>]*class=["'][^"']*mermaid[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, " ")
    .replace(/<pre\b[^>]*class=["'][^"']*mermaid-code[^"']*["'][^>]*>[\s\S]*?<\/pre>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&(amp|lt|gt|quot|#39);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function countMatches(text, regex) {
  return (String(text || "").match(regex) || []).length;
}

function collectHeadingLevels(html) {
  return [...String(html || "").matchAll(/<h([1-6])\b[^>]*>/gi)].map((match) => Number(match[1]));
}

function collectIds(html) {
  return new Set(
    [...String(html || "").matchAll(/\sid=["']([^"']+)["']/gi)]
      .map((match) => match[1].trim())
      .filter(Boolean)
  );
}

function collectHrefs(html) {
  return [...String(html || "").matchAll(/<a\b[^>]*\shref=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function validateHeadingStructure(html, warns) {
  const levels = collectHeadingLevels(html);
  const h1Count = levels.filter((level) => level === 1).length;
  const hasH2 = levels.includes(2);
  const hasH3 = levels.includes(3);

  if (h1Count === 0) warns.push("页面结构缺少 <h1>");
  if (h1Count > 1) warns.push(`页面结构存在 ${h1Count} 个 <h1>，建议只保留一个`);
  if (hasH3 && !hasH2) warns.push("页面结构出现 <h3> 但缺少 <h2>");

  let previous = 0;
  for (const level of levels) {
    if (previous && level - previous > 1) {
      warns.push(`标题层级从 h${previous} 跳到了 h${level}`);
      break;
    }
    previous = level;
  }
}

function validateLinks(htmlPath, html, warns, failures) {
  const ids = collectIds(html);
  const hrefs = collectHrefs(html);

  for (const href of hrefs) {
    if (!href || href === "#") {
      warns.push("检测到空链接或仅有 # 的占位链接");
      continue;
    }
    if (/^javascript:/i.test(href)) {
      failures.push(`检测到不安全链接：${href}`);
      continue;
    }
    if (/^mailto:|^tel:|^data:|^https?:\/\//i.test(href)) {
      continue;
    }
    if (/\.md(?:[?#].*)?$/i.test(href)) {
      warns.push(`检测到指向 Markdown 源文件的链接：${href}`);
    }
    if (href.startsWith("#")) {
      const anchor = href.slice(1);
      if (anchor && !ids.has(anchor)) warns.push(`锚点不存在：${href}`);
      continue;
    }

    const [relativeFile] = href.split(/[?#]/, 1);
    if (!relativeFile) continue;

    const localTarget = path.resolve(path.dirname(htmlPath), relativeFile);
    if (!fs.existsSync(localTarget)) warns.push(`本地链接目标不存在：${href}`);
  }
}

function validateFootnotes(html, warns, failures) {
  const source = String(html || "");
  const hasRawRef = /\[\^[^\]]+\]/.test(source) || /^\s*\[\^[^\]]+\]:/m.test(source);
  const hasFootnoteRef = /class=["'][^"']*footnote-ref/.test(source);
  const hasFootnotesSection = /class=["'][^"']*footnotes/.test(source);
  const hasFootnoteBackref = /class=["'][^"']*footnote-backref/.test(source);

  if (hasRawRef) failures.push("检测到未渲染的 Markdown 脚注语法（[^n]）");
  if (hasFootnoteRef && !hasFootnotesSection) failures.push("脚注引用已渲染，但缺少脚注列表区块");
  if (hasFootnoteRef && !hasFootnoteBackref) warns.push("脚注已渲染，但缺少返回引用的 backref");
}

function validateMermaid(html, warns, failures) {
  const source = String(html || "");
  const hasRawFence = /```\s*mermaid/i.test(source) || /<pre><code class=["']language-mermaid["']/.test(source);
  const hasMermaidGraph = /class=["'][^"']*mermaid(?:\s|["'])/.test(source) || /class=["'][^"']*mermaid-container/.test(source);
  const hasCodeOnlyFallback = /class=["'][^"']*mermaid-code/.test(source);
  const hasRuntime = /mermaid(?:\.min)?\.js/i.test(source) || /mermaid\.initialize\s*\(/i.test(source) || /data-processed=["']true["']/.test(source);

  if (hasRawFence) failures.push("检测到未渲染的 Mermaid 源码块");
  if (hasCodeOnlyFallback) warns.push("Mermaid 仍处于代码展示态，未进入图表渲染态");
  if (hasMermaidGraph && !hasRuntime) warns.push("检测到 Mermaid 容器，但未发现 Mermaid 脚本或渲染完成标记");
}

function validateDashDiscipline(html, warns, failures) {
  const text = extractVisibleText(html);
  const chars = text.replace(/\s+/g, "").length;
  const goodDashCount = countMatches(text, /——/g);
  const singleEmCount = countMatches(text.replace(/——/g, ""), /—/g);
  const asciiDoubleCount = countMatches(text, /--/g);
  const density = Number((goodDashCount / Math.max(chars / 1000, 1)).toFixed(2));

  if (density > 3) {
    failures.push(`破折号密度 ${density}/千字 > 3（阻断阈值）`);
  } else if (density > 1) {
    warns.push(`破折号密度 ${density}/千字 > 1（警告阈值）`);
  }
  if (singleEmCount > 0) warns.push(`检测到 ${singleEmCount} 处单个 em dash（应统一使用 “——”）`);
  if (asciiDoubleCount > 0) warns.push(`检测到 ${asciiDoubleCount} 处双连字符 --（应统一使用 “——”）`);

  return { chars, goodDashCount, density, singleEmCount, asciiDoubleCount };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.html) {
    console.error("用法: node scripts/html-delivery-smoke.mjs --html <文件> [--strict] [--fail-on-warn]");
    process.exit(2);
  }

  const p = path.resolve(args.html);
  if (!fs.existsSync(p)) {
    console.error(`✖ 文件不存在: ${p}`);
    process.exit(1);
  }

  const t = fs.readFileSync(p, "utf8");
  const failures = [];
  const warns = [];

  if (!t.trim()) failures.push("HTML 为空");
  if (!/<!doctype\s+html>/i.test(t)) failures.push("缺少 <!doctype html>");
  if (!/<html[\s>]/i.test(t)) failures.push("缺少 <html>");
  if (!/<body[\s>]/i.test(t)) failures.push("缺少 <body>");
  if (!/<\/body>/i.test(t)) failures.push("缺少 </body>");
  if (!/<\/html>/i.test(t)) failures.push("缺少 </html>");
  if (!/<style\b[^>]*>[\s\S]*?<\/style>/i.test(t) && !/<link\b[^>]*rel=["'][^"']*stylesheet/i.test(t)) {
    failures.push("缺少有效 CSS（未发现 <style> 或 stylesheet <link>）");
  }

  validateFootnotes(t, warns, failures);
  validateMermaid(t, warns, failures);

  if (/fetch\s*\(\s*['"][^'"]+\.md['"]\s*\)/i.test(t)) warns.push("检测到 fetch('*.md') 反模式（疑似 D3）");
  if (/TODO|占位|待补充/i.test(t)) warns.push("检测到占位词（TODO/待补充）");

  let dashSummary = null;
  if (args.strict) {
    validateLinks(p, t, warns, failures);
    validateHeadingStructure(t, warns);
    dashSummary = validateDashDiscipline(t, warns, failures);
  }

  console.log(`html-delivery-smoke: ${path.basename(p)}`);
  if (dashSummary) {
    console.log(`  ℹ 正文字数≈${dashSummary.chars}，合规破折号=${dashSummary.goodDashCount}，密度=${dashSummary.density}/千字`);
  }
  warns.forEach((w) => console.log(`  ⚠ ${w}`));
  if (failures.length) {
    failures.forEach((f) => console.error(`  ✖ ${f}`));
    process.exit(1);
  }
  if (warns.length && args.failOnWarn) process.exit(1);
  if (warns.length && args.strict && !args.failOnWarn) {
    console.log("  ⚠ strict 模式：存在告警（默认不阻断，配合 --fail-on-warn 阻断）");
  }
  console.log("  ✅ 通过");
  process.exit(0);
}

main();
