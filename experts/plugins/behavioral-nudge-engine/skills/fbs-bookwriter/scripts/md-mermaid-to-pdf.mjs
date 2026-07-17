#!/usr/bin/env node
/**
 * Render a Markdown file (with optional Mermaid fences) to PDF via Puppeteer.
 * Strips YAML frontmatter for cleaner output unless --keep-frontmatter.
 */
import fs from 'fs';
import path from 'path';
import MarkdownIt from 'markdown-it';
import puppeteer from 'puppeteer';

function parseArgs(argv) {
  const out = { input: null, output: null, keepFrontmatter: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keep-frontmatter') out.keepFrontmatter = true;
    else if (a === '--out' && argv[i + 1]) {
      out.output = argv[++i];
    } else if (!a.startsWith('-') && !out.input) {
      out.input = a;
    }
  }
  return out;
}

function stripFrontmatter(text) {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---\n', 3);
  if (end === -1) return text;
  return text.slice(end + 5).replace(/^\s+/, '');
}

function buildHtml(markdownHtml) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.5.1/github-markdown.min.css" />
  <style>
    body { box-sizing: border-box; min-width: 200px; max-width: 980px; margin: 0 auto; padding: 36px 28px; }
    .markdown-body { font-family: "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif; font-size: 14px; }
    .markdown-body pre { white-space: pre-wrap; word-break: break-word; }
    @media print { body { padding: 12px; } }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head>
<body class="markdown-body">
${markdownHtml}
<script>
(function () {
  window.__PDF_READY = false;
  window.__PDF_ERROR = null;
  (async function () {
    try {
      if (typeof mermaid === 'undefined') throw new Error('mermaid not loaded');
      mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
      var nodes = document.querySelectorAll('.mermaid');
      if (nodes.length) await mermaid.run({ nodes: nodes });
    } catch (e) {
      window.__PDF_ERROR = String(e && e.message ? e.message : e);
    }
    window.__PDF_READY = true;
  })();
})();
</script>
</body>
</html>`;
}

async function main() {
  const { input, output, keepFrontmatter } = parseArgs(process.argv);
  if (!input) {
    console.error('Usage: node md-mermaid-to-pdf.mjs <input.md> [--out <out.pdf>] [--keep-frontmatter]');
    process.exit(1);
  }
  const absIn = path.resolve(input);
  if (!fs.existsSync(absIn)) {
    console.error('Input not found:', absIn);
    process.exit(1);
  }

  let raw = fs.readFileSync(absIn, 'utf8');
  if (!keepFrontmatter) raw = stripFrontmatter(raw);

  const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token.info.trim().toLowerCase() === 'mermaid') {
      return `<div class="mermaid">\n${token.content.trimEnd()}\n</div>\n`;
    }
    return defaultFence(tokens, idx, options, env, self);
  };

  const bodyHtml = md.render(raw);
  const html = buildHtml(bodyHtml);

  const baseNoExt = path.basename(absIn, path.extname(absIn));
  // e.g. foo_abc123.plan -> foo; foo_abc123 -> foo when last segment is hex id + .plan
  const stem =
    baseNoExt.replace(/_[a-f0-9]+\.plan$/i, '').replace(/\.plan$/i, '') || baseNoExt;
  const outPath = output || path.join(path.dirname(absIn), `${stem}-技术方案.pdf`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--font-render-hinting=medium', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 120000 });
    await page.waitForFunction(() => window.__PDF_READY === true, { timeout: 120000 });
    const err = await page.evaluate(() => window.__PDF_ERROR);
    if (err) console.warn('Mermaid warning:', err);

    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', right: '14mm', bottom: '18mm', left: '14mm' },
    });
    console.log('Wrote', outPath);
    console.log('file://' + path.resolve(outPath).replace(/\\/g, '/'));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
