#!/usr/bin/env node
/**
 * FBS-BookWriter 构建脚本 v2
 *
 * 功能：Markdown → HTML 预览 + PDF + DOCX
 * 依赖：技能根 npm install（package.json：markdown-it + markdown-it-footnote 必选；puppeteer/html-to-docx 可选）
 * 环境：Node.js **18+**（见技能根 `package.json` `engines`）。
 * 运行（须在技能根，或调整路径）：**`node assets/build.mjs`** — 构建全部
 *       **`node assets/build.mjs B1`** — 只构建 id=B1 的书
 *       **`node assets/build.mjs --check`** — 仅检测依赖（markdown-it + markdown-it-footnote 为 D1 最低集）
 *       **`node assets/build.mjs --strict-sources`** — `books.config.mjs` 所列 MD **任一路径缺失**即失败退出（CI 可用 `FBS_BUILD_STRICT_SOURCES=1`）
 * 源稿：**无任何可读入的 MD** 时始终 **exit 1**（防「空 HTML / 半成品」静默成功）
 * 脚注：默认 **必须** 可加载 markdown-it-footnote；无脚注需求时传 --allow-no-footnote 或 FBS_ALLOW_NO_FOOTNOTE=1
 *
 * 规范对照：
 *   排版铁律 → references/typography.md
 *   后处理   → typography.md §语义标记约定 H1-H9
 *   视觉资产 → references/visual.md
 *   品牌克制露出 → references/05-ops/brand-outputs.md
 *   构建流程 → references/build.md
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { injectPreviewWatermark } from '../scripts/watermark-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, '..');

const rawArgs = process.argv.slice(2);
const flagCheck = rawArgs.includes('--check');
const allowNoFootnote =
  rawArgs.includes('--allow-no-footnote') || process.env.FBS_ALLOW_NO_FOOTNOTE === '1';
const strictSources =
  rawArgs.includes('--strict-sources') || process.env.FBS_BUILD_STRICT_SOURCES === '1';
const targetId = rawArgs.find((a) => !a.startsWith('-')) || null;

/** 与版权页 / HTML meta 同步，便于交付审计 */
const BUILD_SCRIPT_VERSION = '2.4.1';

/** 默认克制品牌（版权页 / PDF 页脚 / SVG 封面底栏）；books.config.mjs 中 brandMode: 'none' 可关闭 */
const BRAND = {
  product: '福帮手数据智能化系统',
  team: '福帮手AI团队',
  company: '悟空共创（杭州）智能科技有限公司',
  trademark: '福帮手',
  email: 'unique@u3w.com',
};

/** S4 构建进度：便于终端/CI 判断未卡死（与 section-3-workflow「S4 防卡顿」一致） */
function buildProgress(bookId, message) {
  const id = bookId || '?';
  console.log(`[S4/build][${id}] ${message}`);
}

function brandOn(book) {
  return book.brandMode !== 'none';
}

function coverFooterLine(book) {
  return brandOn(book)
    ? `${BRAND.trademark}® · ${BRAND.team}`
    : '人机协同写作（可自定义署名）';
}

// ──────────────────────────────────────────────
// §0  依赖加载（优雅降级）
// ──────────────────────────────────────────────
let MarkdownIt, puppeteer, HTMLtoDOCX;

try {
  MarkdownIt = (await import('markdown-it')).default;
} catch {
  if (flagCheck) {
    MarkdownIt = null;
  } else {
    console.error('[ERROR] 缺少 markdown-it。请在技能根或本书工程执行 npm install（见 package.json）');
    process.exit(1);
  }
}

let mdFootnotePlugin = null;
try {
  const footMod = await import('markdown-it-footnote');
  mdFootnotePlugin = footMod.default || footMod;
} catch {
  /* 导入失败：非「可选脚注」— 正式构建路径下缺插件将退出（见下方脚注校验）；请 npm install markdown-it-footnote */
}

if (flagCheck) {
  let pCheck = null;
  let dCheck = null;
  try {
    pCheck = await import('puppeteer');
  } catch {
    /* --check 静默探测 */
  }
  try {
    dCheck = (await import('html-to-docx')).default;
  } catch {
    /* --check 静默探测 */
  }
  console.log('═══════════════════════════════════════');
  console.log(` FBS-BookWriter build.mjs v${BUILD_SCRIPT_VERSION} — 依赖自检 (--check)`);
  console.log('═══════════════════════════════════════');
  const ok = (x) => (x ? 'OK' : '缺失');
  console.log(`  markdown-it             ${ok(MarkdownIt)}`);
  console.log(`  markdown-it-footnote    ${ok(mdFootnotePlugin)}${allowNoFootnote ? '  (已允许跳过)' : ''}`);
  console.log(`  puppeteer (PDF)         ${ok(pCheck)}`);
  console.log(`  html-to-docx            ${ok(dCheck)}`);
  const d1Min = MarkdownIt && (mdFootnotePlugin || allowNoFootnote);
  if (!d1Min) {
    console.error('\n[ERROR] D1 最低要求：markdown-it + markdown-it-footnote');
    console.error('  安装：npm install（技能根或本书工程，见随包 package.json）');
    console.error('  特例：传 --allow-no-footnote 或 FBS_ALLOW_NO_FOOTNOTE=1（不推荐含 [^n] 的对外终稿）');
    process.exit(1);
  }
  console.log('\n[S4/build] --check 通过，可执行常规构建。');
  process.exit(0);
}

try {
  puppeteer = await import('puppeteer');
} catch {
  console.warn('[WARN] 未安装 puppeteer，将跳过 PDF 生成');
  puppeteer = null;
}

try {
  HTMLtoDOCX = (await import('html-to-docx')).default;
} catch {
  console.warn('[WARN] 未安装 html-to-docx，将跳过 DOCX 生成');
  HTMLtoDOCX = null;
}

if (!MarkdownIt) {
  console.error('[ERROR] 缺少 markdown-it');
  process.exit(1);
}

if (!mdFootnotePlugin && !allowNoFootnote) {
  console.error('[ERROR] D1 构建要求 markdown-it-footnote，否则 [^n] 脚注无法渲染。请: npm install markdown-it-footnote');
  console.error('  若正文无脚注且仅供内测：可传 --allow-no-footnote 或 FBS_ALLOW_NO_FOOTNOTE=1');
  process.exit(1);
}

// ──────────────────────────────────────────────
// §1  加载配置（须 pathToFileURL：Windows 下裸路径非合法 ESM specifier）
// ──────────────────────────────────────────────
const { BOOKS } = await import(pathToFileURL(join(ROOT, 'assets', 'books.config.mjs')));
const CSS_RAW   = readFileSync(join(ROOT, 'assets', 'style.css'), 'utf-8');

const booksToProcess = targetId
  ? BOOKS.filter(b => b.id === targetId)
  : BOOKS;

if (booksToProcess.length === 0) {
  console.error(`[ERROR] 未找到 id="${targetId}" 的配置`);
  process.exit(1);
}

// ──────────────────────────────────────────────
// §2  Markdown 解析器
// ──────────────────────────────────────────────
const md = new MarkdownIt({
  html: true,
  typographer: true,
  linkify: true,
});
if (mdFootnotePlugin) {
  md.use(mdFootnotePlugin);
}

/** 纯文本安全嵌入 HTML（流程块 / Mermaid 源码等，防止 `</div>`、`</script>` 破坏 DOM） */
function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────────
// §3  七条后处理规则 H1-H7
//     见 references/03-product/06-typography.md §语义标记约定
// ──────────────────────────────────────────────

/**
 * H1 金句：独立段落中的 <p><strong>纯文字</strong></p>（无冒号）
 */
function H1_jinqu(html) {
  return html.replace(
    /<p><strong>([^<:：]+)<\/strong><\/p>/g,
    '<p class="jinqu"><strong>$1</strong></p>'
  );
}

/**
 * H2 题引：h1 紧接的第一个 <p>
 */
function H2_epigraph(html) {
  return html.replace(
    /(<h1[^>]*>.*?<\/h1>\s*)<p>/g,
    '$1<p class="epigraph">'
  );
}

/**
 * H3 过渡语：<em> 以「下一章」「翻到」开头
 */
function H3_chapterNext(html) {
  return html.replace(
    /<p><em>(下一章|翻到)(.*?)<\/em><\/p>/g,
    '<p class="chapter-next"><em>$1$2</em></p>'
  );
}

/**
 * H4 流程块：<pre><code> 含 ↓├└→
 */
function H4_flowBlock(html) {
  return html.replace(
    /<pre><code>([\s\S]*?)<\/code><\/pre>/g,
    (match, code) => {
      if (/[↓├└→]/.test(code)) {
        return `<div class="flow-block">${escHtml(code)}</div>`;
      }
      return match;
    }
  );
}

/**
 * H5 CTA：<blockquote> 含「公众号」「后台回复」
 */
function H5_cta(html) {
  return html.replace(
    /<blockquote>([\s\S]*?)<\/blockquote>/g,
    (match, inner) => {
      if (/公众号|后台回复/.test(inner)) {
        return `<div class="cta-box">${inner}</div>`;
      }
      return match;
    }
  );
}

/**
 * H6 图表：<!-- P02-1：标题 --> + <svg> → .figure + 图注
 */
function H6_figure(html) {
  return html.replace(
    /<!--\s*(P\d+-\d+)[：:]\s*(.+?)\s*-->\s*(<svg[\s\S]*?<\/svg>)/g,
    '<div class="figure">$3<p class="figure-caption">图 $1：$2</p></div>'
  );
}

/**
 * H7 清单：<li>[ ] → .checklist
 */
function H7_checklist(html) {
  // 转换 checkbox li
  let result = html.replace(
    /<li>\[\s*\]\s*/g,
    '<li class="check-item">'
  );
  // 包含 check-item 的 ul → .checklist
  result = result.replace(
    /<ul>([\s\S]*?class="check-item"[\s\S]*?)<\/ul>/g,
    '<ul class="checklist">$1</ul>'
  );
  return result;
}

/**
 * H8 插图标记：<!-- ILLUST: type | prompt: ... | caption: ... --> → .illustration 容器
 */
function H8_illustration(html) {
  // 完整标记（含caption）→ 插图占位 + 图注
  let result = html.replace(
    /<!--\s*ILLUST:\s*(\w+)\s*\|\s*prompt:\s*([\s\S]*?)\s*\|\s*caption:\s*([\s\S]*?)\s*-->/g,
    (match, type, prompt, caption) => {
      const cls = type === 'header' ? 'chapter-header-illust' : 'illustration';
      return `<div class="${cls}">
  <div class="illustration-placeholder">
    <div>📷 ${escHtml(caption || '插图')}</div>
    <div class="prompt-hint">Prompt: ${escHtml(prompt.trim())}</div>
  </div>
  ${caption && type !== 'header' ? `<p class="illustration-caption">${escHtml(caption)}</p>` : ''}
</div>`;
    }
  );
  // 简化标记（无caption）→ 仅占位
  result = result.replace(
    /<!--\s*ILLUST:\s*(\w+)\s*\|\s*prompt:\s*([\s\S]*?)\s*-->/g,
    (match, type, prompt) => {
      const cls = type === 'header' ? 'chapter-header-illust' : 'illustration';
      return `<div class="${cls}">
  <div class="illustration-placeholder">
    <div>📷 插图占位</div>
    <div class="prompt-hint">Prompt: ${escHtml(prompt.trim())}</div>
  </div>
</div>`;
    }
  );
  return result;
}

/**
 * H9 Mermaid处理：```mermaid 代码块 → .mermaid-container
 * 若 enableMermaidCDN 为 true，保留 <div class="mermaid"> 供CDN渲染
 * 否则作为 .mermaid-code 代码展示
 */
function H9_mermaid(html, enableCDN = true) {
  return html.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    (match, code) => {
      const safe = escHtml(code);
      if (enableCDN) {
        return `<div class="mermaid-container"><div class="mermaid">${safe}</div></div>`;
      }
      return `<div class="mermaid-container"><pre class="mermaid-code show">${safe}</pre></div>`;
    }
  );
}

/** 串行执行 H1→H9 */
function postProcess(html, book = {}) {
  let result = html;
  result = H1_jinqu(result);
  result = H2_epigraph(result);
  result = H3_chapterNext(result);
  result = H4_flowBlock(result);
  result = H5_cta(result);
  result = H6_figure(result);
  result = H7_checklist(result);
  result = H8_illustration(result);
  result = H9_mermaid(result, book.enableMermaidCDN !== false);
  return result;
}

// ──────────────────────────────────────────────
// §4  辅助函数
// ──────────────────────────────────────────────

/** 生成注入配色的 CSS */
function buildCSS(book) {
  let css = CSS_RAW
    .replace(/#2C5F7C/g, book.color || '#2C5F7C')
    .replace(/#D4A843/g, book.accentGold || '#D4A843')
    .replace(/#F4F7FA/g, book.lightBg || '#F4F7FA')
    .replace(/#E3EDF4/g, book.accentBg || '#E3EDF4');
  return css;
}

/** 密度 class */
function densityClass(book) {
  const d = book.density || 'standard';
  if (d === 'compact') return 'density-compact';
  if (d === 'loose')   return 'density-loose';
  return '';
}

/** 提取目录（h1 + h2 双层） */
function extractTOC(html) {
  const items = [];
  const re = /<h([12])[^>]*id="([^"]*)"[^>]*>(.*?)<\/h\1>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    items.push({ level: +m[1], id: m[2], text: m[3].replace(/<[^>]+>/g, '') });
  }
  return items;
}

/** 给 h1/h2 加 id */
function addHeadingIds(html) {
  let h1Count = 0, h2Count = 0;
  return html.replace(/<h([12])>/g, (match, level) => {
    if (level === '1') { h1Count++; h2Count = 0; return `<h1 id="ch${h1Count}">`; }
    else { h2Count++; return `<h2 id="ch${h1Count}-${h2Count}">`; }
  });
}

/** 生成 SVG 文字封面（无图片时） */
function generateSVGCover(book) {
  const color = book.color || '#2C5F7C';
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${color}"/>
      <stop offset="100%" stop-color="${color}88"/>
    </linearGradient>
  </defs>
  <rect width="600" height="800" fill="url(#bg)"/>
  <rect x="40" y="40" width="520" height="720" rx="8" fill="none" stroke="#fff3" stroke-width="2"/>
  <text x="300" y="340" text-anchor="middle" fill="#fff" font-size="42" font-weight="700"
        font-family="Source Han Sans SC,Microsoft YaHei,sans-serif">${escSvg(book.title)}</text>
  <text x="300" y="400" text-anchor="middle" fill="#ffffffbb" font-size="20"
        font-family="Source Han Sans SC,Microsoft YaHei,sans-serif">${escSvg(book.subtitle || '')}</text>
  <text x="300" y="540" text-anchor="middle" fill="#ffffffaa" font-size="16"
        font-family="Source Han Sans SC,Microsoft YaHei,sans-serif">${escSvg(book.author || '')}</text>
  <text x="300" y="700" text-anchor="middle" fill="#ffffff66" font-size="12"
        font-family="Source Han Sans SC,Microsoft YaHei,sans-serif">${escSvg(coverFooterLine(book))}</text>
</svg>`;
}

function escSvg(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 设计感SVG封面（L2降级：含装饰图案+渐变，比纯文字版丰富）
 * visualPreset: 'geometric'|'wave'|'grid'|'bubble'|'ladder'
 */
function generateDesignedSVGCover(book) {
  const color = book.color || '#2C5F7C';
  const preset = book.visualPreset || 'geometric';

  // 装饰图案生成（按预设选择不同SVG路径）
  const decorations = {
    geometric: `<polygon points="100,700 200,600 300,700" fill="#fff1" /><polygon points="350,650 450,550 550,650" fill="#fff1" /><rect x="80" y="100" width="60" height="60" rx="8" fill="none" stroke="#fff2" stroke-width="2" transform="rotate(15,110,130)"/>`,
    wave: `<path d="M0,620 Q150,570 300,620 T600,620 L600,800 L0,800 Z" fill="#fff1"/><path d="M0,660 Q150,610 300,660 T600,660 L600,800 L0,800 Z" fill="#fff0a"/>`,
    grid: `<line x1="100" y1="0" x2="100" y2="800" stroke="#fff1" /><line x1="200" y1="0" x2="200" y2="800" stroke="#fff0a" /><line x1="400" y1="0" x2="400" y2="800" stroke="#fff0a" /><line x1="500" y1="0" x2="500" y2="800" stroke="#fff1" /><line x1="0" y1="200" x2="600" y2="200" stroke="#fff0a" /><line x1="0" y1="500" x2="600" y2="500" stroke="#fff0a" />`,
    bubble: `<circle cx="80" cy="650" r="40" fill="#fff1"/><circle cx="200" cy="700" r="25" fill="#fff0a"/><circle cx="480" cy="630" r="50" fill="#fff1"/><circle cx="520" cy="720" r="20" fill="#fff0a"/><circle cx="350" cy="680" r="30" fill="#fff0a"/>`,
    ladder: `<rect x="60" y="600" width="80" height="160" rx="4" fill="#fff1"/><rect x="180" y="520" width="80" height="240" rx="4" fill="#fff1"/><rect x="300" y="440" width="80" height="320" rx="4" fill="#fff1"/><rect x="420" y="360" width="80" height="400" rx="4" fill="#fff1"/>`,
  };

  const deco = decorations[preset] || decorations.geometric;

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800">
  <defs>
    <linearGradient id="bg-designed" x1="0" y1="0" x2="0.5" y2="1">
      <stop offset="0%" stop-color="${color}"/>
      <stop offset="60%" stop-color="${color}dd"/>
      <stop offset="100%" stop-color="${color}88"/>
    </linearGradient>
  </defs>
  <rect width="600" height="800" fill="url(#bg-designed)"/>
  <rect x="30" y="30" width="540" height="740" rx="12" fill="none" stroke="#fff2" stroke-width="1.5"/>
  ${deco}
  <text x="300" y="300" text-anchor="middle" fill="#fff" font-size="44" font-weight="700"
        font-family="Source Han Sans SC,Microsoft YaHei,sans-serif">${escSvg(book.title)}</text>
  <text x="300" y="360" text-anchor="middle" fill="#ffffffcc" font-size="20"
        font-family="Source Han Sans SC,Microsoft YaHei,sans-serif">${escSvg(book.subtitle || '')}</text>
  <line x1="200" y1="400" x2="400" y2="400" stroke="#fff6" stroke-width="1"/>
  <text x="300" y="460" text-anchor="middle" fill="#ffffffaa" font-size="16"
        font-family="Source Han Sans SC,Microsoft YaHei,sans-serif">${escSvg(book.author || '')}</text>
  <text x="300" y="760" text-anchor="middle" fill="#ffffff55" font-size="11"
        font-family="Source Han Sans SC,Microsoft YaHei,sans-serif">${escSvg(coverFooterLine(book))}</text>
</svg>`;
}

/** 日期字符串 YYYY-MM-DD */
function dateStr() {
  return new Date().toISOString().slice(0, 10);
}

// ──────────────────────────────────────────────
// §5  封面 / 版权页 / 目录 HTML 生成
// ──────────────────────────────────────────────

function buildCoverHTML(book) {
  let coverInner;
  if (book.coverImage && existsSync(resolve(ROOT, book.coverImage))) {
    // L1: 外部封面图（如即梦AI生成）
    const imgBuf = readFileSync(resolve(ROOT, book.coverImage));
    const b64 = imgBuf.toString('base64');
    const ext = book.coverImage.split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    coverInner = `<img src="data:${mime};base64,${b64}" style="max-width:100%;max-height:90vh;" alt="封面"/>`;
  } else if (book.visualPreset) {
    // L2: 设计感SVG封面（含装饰图案）
    coverInner = generateDesignedSVGCover(book);
  } else {
    // L3: 纯文字SVG封面
    coverInner = generateSVGCover(book);
  }
  return `
<div class="cover-page">
  ${coverInner}
</div>`;
}

function buildCopyrightHTML(book) {
  const brandPara = brandOn(book)
    ? `<p style="font-size:0.88em;color:#555;">协作支持：${escHtml(BRAND.product)}（${escHtml(BRAND.trademark)}®）· ${escHtml(BRAND.team)}<br/>
     ${escHtml(BRAND.company)} · ${escHtml(BRAND.email)}</p>`
    : '';
  return `
<div class="copyright-page">
  <p><strong>${escHtml(book.title)}</strong></p>
  ${book.subtitle ? `<p>${escHtml(book.subtitle)}</p>` : ''}
  <p>作者：${escHtml(book.author || '（待定）')}</p>
  ${book.copyrightExtra ? `<p>${escHtml(book.copyrightExtra)}</p>` : ''}
  ${brandPara}
  <p>本书在资料整理、数据分析和初稿形成过程中可能使用人工智能辅助工具，具体以实际流程为准。<br>
     内容应经人工审核与事实核对。最终文责由作者承担。</p>
  <p>文档日期：${dateStr()}</p>
  <p style="font-size:0.82em;color:#888;">构建信息：FBS-BookWriter <code>assets/build.mjs</code> v${BUILD_SCRIPT_VERSION} · ISO ${new Date().toISOString()}</p>
  <p>（可按项目填写工具与平台声明）</p>
</div>`;
}

function buildTOCHTML(tocItems) {
  if (!tocItems.length) return '';
  const lis = tocItems.map(item => {
    const cls = item.level === 2 ? ' class="toc-h2"' : '';
    return `<li${cls}><a href="#${item.id}">${escHtml(item.text)}</a></li>`;
  }).join('\n');
  return `
<div class="toc-page">
  <h1 style="page-break-before:auto;">目录</h1>
  <ul>${lis}</ul>
</div>`;
}

// ──────────────────────────────────────────────
// §6  单本书构建
// ──────────────────────────────────────────────

async function buildBook(book, browser) {
  console.log(`\n📖 构建: ${book.title} (${book.id})`);
  buildProgress(book.id, '开始：读取并合并 Markdown 源文件…');

  const srcDir   = resolve(ROOT, book.srcDir || './src');
  const distDir  = resolve(ROOT, 'dist');
  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

  // 1. 读取并合并所有 Markdown 源文件
  const mdParts = [];
  const missingRel = [];
  for (const file of book.files) {
    const fp = join(srcDir, file);
    if (!existsSync(fp)) {
      missingRel.push(file);
      console.warn(`  [WARN] 文件不存在，跳过: ${fp}`);
      continue;
    }
    mdParts.push(readFileSync(fp, 'utf-8'));
  }

  if (strictSources && missingRel.length > 0) {
    console.error(
      `  [ERROR] --strict-sources / FBS_BUILD_STRICT_SOURCES：${book.id} 缺失 ${missingRel.length} 个文件 — ${missingRel.join(', ')}`
    );
    return false;
  }

  if (mdParts.length === 0) {
    console.error(
      `  [ERROR] 无有效 Markdown 源（${book.id}）。请检查 assets/books.config.mjs 的 files 与 srcDir，勿产出空 HTML。`
    );
    return false;
  }

  const mdContent = mdParts.join('\n\n');
  buildProgress(book.id, `已读入 ${mdParts.length} 个片段，Markdown → HTML（后处理 H1–H9）…`);

  // 2. Markdown → HTML
  let bodyHtml = md.render(mdContent);

  // 3. 加 heading id
  bodyHtml = addHeadingIds(bodyHtml);

  // 4. H1-H9 后处理
  bodyHtml = postProcess(bodyHtml, book);

  // 5. 提取目录
  const tocItems = extractTOC(bodyHtml);

  // 6. 生成封面 + 版权页 + 目录
  const coverHtml     = buildCoverHTML(book);
  const copyrightHtml = buildCopyrightHTML(book);
  const tocHtml       = buildTOCHTML(tocItems);

  // 7. 注入配色的 CSS
  const css = buildCSS(book);
  const dClass = densityClass(book);

  // 8. Mermaid CDN 注入
  const mermaidScript = book.enableMermaidCDN !== false
    ? `<script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <script>mermaid.initialize({startOnLoad:true,theme:'${book.mermaidTheme || 'base'}',fontFamily:'Source Han Sans SC,Microsoft YaHei,sans-serif'});</script>`
    : '';

  // 9. 组装完整 HTML
  const fullHtml = injectPreviewWatermark(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="generator" content="FBS-BookWriter build.mjs v${BUILD_SCRIPT_VERSION}">
  <title>${escHtml(book.title)}</title>
  <style>${css}</style>
  ${mermaidScript}
</head>
<body class="${dClass}">
${coverHtml}
${copyrightHtml}
${tocHtml}
<div class="content">
${bodyHtml}
</div>
</body>
</html>`);

  // 9. 写入 HTML 预览
  const htmlPath = join(distDir, `${book.outputName}.html`);
  writeFileSync(htmlPath, fullHtml, 'utf-8');
  console.log(`  ✅ HTML → ${htmlPath}`);
  buildProgress(book.id, 'HTML 已写入；若生成 PDF，下一段可能静默较久（Chromium + 网络与 Mermaid）。');

  // 10. PDF 生成
  if (browser) {
    try {
      const page = await browser.newPage();
      buildProgress(
        book.id,
        'PDF：加载页面（waitUntil=networkidle0，超时 90s）— 无新输出属正常，请稍候…'
      );
      await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 90000 });
      if (book.enableMermaidCDN !== false && fullHtml.includes('class="mermaid"')) {
        buildProgress(book.id, 'PDF：等待 Mermaid 图表渲染（最长约 45s）…');
        try {
          await page.waitForFunction(
            () => {
              const nodes = document.querySelectorAll('.mermaid');
              if (!nodes.length) return true;
              return [...nodes].every(
                (n) => n.querySelector('svg') || n.getAttribute('data-processed') === 'true'
              );
            },
            { timeout: 45000 }
          );
        } catch {
          console.warn('  [WARN] Mermaid 渲染等待超时，PDF 中图表可能不完整');
        }
      }
      buildProgress(book.id, 'PDF：正在输出到磁盘…');
      const pdfPath = join(distDir, `${book.outputName}.pdf`);
      const pdfFooterBrand = brandOn(book)
        ? `<br/><span style="font-size:7pt;color:#aaa;">${escHtml(BRAND.product)} · ${escHtml(BRAND.team)}</span>`
        : '';
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '25mm', bottom: '25mm', left: '20mm', right: '20mm' },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `<div style="font-size:9pt;color:#999;width:100%;text-align:center;">
          第 <span class="pageNumber"></span> 页，共 <span class="totalPages"></span> 页${pdfFooterBrand}
        </div>`,
      });
      await page.close();
      console.log(`  ✅ PDF  → ${pdfPath}`);
    } catch (err) {
      console.error(`  [ERROR] PDF 生成失败: ${err.message}`);
    }
  }

  // 11. DOCX 生成
  if (HTMLtoDOCX) {
    try {
      buildProgress(book.id, 'DOCX：转换中（大文档可能需数十秒）…');
      // DOCX: 去掉 Base64 图片减体积，保留文字
      const docxHtml = fullHtml.replace(/src="data:[^"]+"/g, 'src=""');
      const docxBuf = await HTMLtoDOCX(docxHtml, null, {
        table: { row: { cantSplit: true } },
        footer: true,
        pageNumber: true,
      });
      const docxPath = join(distDir, `${book.outputName}.docx`);
      writeFileSync(docxPath, docxBuf);
      console.log(`  ✅ DOCX → ${docxPath}`);
    } catch (err) {
      console.error(`  [ERROR] DOCX 生成失败: ${err.message}`);
    }
  }
  buildProgress(book.id, '本书构建步骤结束。');
  return true;
}

// ──────────────────────────────────────────────
// §7  主入口
// ──────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════');
  console.log(' FBS-BookWriter 本地构建');
  console.log('═══════════════════════════════════════');
  console.log(`构建目标: ${targetId || '全部'} (${booksToProcess.length} 本)`);
  console.log(
    `[S4/build] markdown-it-footnote: ${mdFootnotePlugin ? '已启用（[^n] 脚注）' : '已豁免（无插件，仅建议内测）'}`
  );
  if (strictSources) {
    console.log('[S4/build] 已启用 --strict-sources（或 FBS_BUILD_STRICT_SOURCES=1）：books.config 所列 MD 缺失即失败。');
  }
  console.log('[S4/build] 提示：含 PDF 时 Chromium 启动与 networkidle 可能各需数十秒，日志含 [S4/build][书id] 即仍在进行。');

  // 共享 Puppeteer 实例
  let browser = null;
  if (puppeteer) {
    try {
      console.log('[S4/build] 正在启动 Chromium（Puppeteer）…');
      browser = await puppeteer.launch({ headless: 'new' });
      console.log('[S4/build] Chromium 已就绪。');
    } catch (err) {
      console.warn(`[WARN] Puppeteer 启动失败 (${err.message})，将跳过 PDF`);
    }
  }

  let buildFailed = false;
  for (const book of booksToProcess) {
    const ok = await buildBook(book, browser);
    if (ok === false) buildFailed = true;
  }

  if (browser) {
    await browser.close();
  }

  if (buildFailed) {
    console.error('\n[ERROR] 构建未全部成功（无有效 MD、--strict-sources 缺文件等）。');
    process.exit(1);
  }

  console.log('\n═══════════════════════════════════════');
  console.log(' 构建完成');
  console.log('═══════════════════════════════════════');
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
