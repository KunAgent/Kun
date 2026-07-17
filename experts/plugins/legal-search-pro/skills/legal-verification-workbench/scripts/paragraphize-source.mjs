// paragraphize-source.mjs — Split a source document into stable, numbered paragraphs.
//
// Ported splitting strategy from LawBuddy paragraph-index.ts:
//  - primary split on blank lines (\n\n+)
//  - re-split over-long paragraphs on single \n using legal/structural boundary regexes
//  - force-break when an accumulated chunk exceeds a length cap
// Extended here with legal article detection (第X条) for article_index.
//
// Exports paragraphizeContent() used by persist-legal-sources.mjs, and can run standalone:
//   node paragraphize-source.mjs --in source.md

import { parseArgs, normalizeArticleKey, sha1, printJson, readText } from './lib.mjs';

const MAX_PARAGRAPH_LEN = 2000; // re-split threshold
const FORCE_BREAK_LEN = 1500; // force a break while merging single-\n lines

// Structural boundary detectors (a line that starts a new paragraph)
const BOUNDARY_RES = [
  /^#{1,6}\s/, // markdown heading
  /^第\s*[一二三四五六七八九十百千万零〇\d]+\s*(章|节|条|部分|编)/, // CN legal sections
  /^\d+(?:\.\d+)*\s*[、.．]\s*.{2,}/, // numbered 1.  1.1
  /^[（(]\s*[\d一二三四五六七八九十]+\s*[）)]/, // (1) （一）
  /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]/, // circled numbers
  /^Article\s+\d+/i,
  /^Section\s+\d+/i,
  /^Chapter\s+\d+/i,
];

// Article line: 第X条 / 第X条之一 at start of paragraph
const ARTICLE_RE = /^第\s*([一二三四五六七八九十百千万零〇\d]+)\s*条(?:\s*之\s*([一二三四五六七八九十\d]+))?/;
// Inline article start: a 第X条 marker right after a newline (legal text often packs the
// whole statute into one block separated only by single \n, or even runs articles together).
// We use this to FORCE a paragraph break before each article so article_index is complete.
const INLINE_ARTICLE_BREAK_RE =
  /(?:^|\n)\s*(第\s*[一二三四五六七八九十百千万零〇\d]+\s*条(?:\s*之\s*[一二三四五六七八九十\d]+)?)/g;
// Heading line for headingPath tracking
const HEADING_RE = /^(#{1,6}\s+.+|第\s*[一二三四五六七八九十百千万零〇\d]+\s*[章节编]\s*.*)/;
// Case markers
const CASE_SECTION_RES = [
  { key: '案号', re: /[（(]\s*\d{4}\s*[）)][^\s，。；]{2,40}号/ },
  { key: '裁判要旨', re: /裁判要旨|裁判摘要/ },
  { key: '本院认为', re: /本院认为|法院认为|本院经审理认为/ },
  { key: '裁判结果', re: /裁判结果|判决如下|裁定如下/ },
];

function isBoundary(line) {
  return BOUNDARY_RES.some((re) => re.test(line.trim()));
}

/**
 * Split a block on inline 第X条 article markers, so each statute article becomes its own
 * paragraph (and thus a distinct article_index entry). Many web-fetched statutes pack all
 * articles into one block separated only by single \n — without this they'd never be indexed
 * and every article citation would fall through to "待核验". Only splits when ≥2 markers are
 * present, to avoid fragmenting ordinary prose that merely mentions one 第X条.
 */
function splitOnArticles(text) {
  const markers = [];
  for (const m of text.matchAll(INLINE_ARTICLE_BREAK_RE)) {
    // index of the article token itself (skip any leading whitespace/newline captured)
    const tokenStart = m.index + m[0].lastIndexOf(m[1]);
    markers.push(tokenStart);
  }
  if (markers.length < 2) return [text];
  const out = [];
  // preamble before the first article (if any non-trivial text)
  if (markers[0] > 0) {
    const pre = text.slice(0, markers[0]).trim();
    if (pre.length >= 4) out.push(pre);
  }
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i];
    const end = i + 1 < markers.length ? markers[i + 1] : text.length;
    const seg = text.slice(start, end).trim();
    if (seg) out.push(seg);
  }
  return out;
}

/** Re-split a long paragraph by single newline, merging short lines until a boundary or cap. */
function resplitLong(text) {
  const lines = text.split('\n');
  const out = [];
  let buf = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const startsNew = isBoundary(trimmed) || buf.length + trimmed.length > FORCE_BREAK_LEN;
    if (startsNew && buf) {
      out.push(buf.trim());
      buf = trimmed;
    } else {
      buf = buf ? `${buf}\n${trimmed}` : trimmed;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.length ? out : [text.trim()];
}

/**
 * Paragraphize raw content into records.
 * @returns { paragraphs: Array, articleIndex: object }
 *   paragraph: { paragraphIndex, paragraphId, text, startOffset, endOffset, hash,
 *                headingPath, articleNo, caseSection }
 */
export function paragraphizeContent(content, sourceId) {
  const normalized = String(content || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[\t\f\v]/g, ' ');

  // primary split on blank lines
  let blocks = normalized
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  // re-split over-long blocks, and split statute blocks on inline article markers
  const refined = [];
  for (const b of blocks) {
    // First, break apart packed statute text so each 第X条 is its own paragraph.
    const articleParts = splitOnArticles(b);
    for (const part of articleParts) {
      if (part.length > MAX_PARAGRAPH_LEN && part.includes('\n')) {
        refined.push(...resplitLong(part));
      } else {
        refined.push(part);
      }
    }
  }
  blocks = refined.filter(Boolean);

  const paragraphs = [];
  const articleIndex = {}; // { lawTitleGuess: { 第13条: [P13,...] } } filled by caller w/ title
  const headingPath = [];
  let cursor = 0;

  blocks.forEach((text, i) => {
    const paragraphIndex = i + 1;
    const paragraphId = `${sourceId}:P${paragraphIndex}`;
    // locate offset in normalized text (best-effort, monotonic)
    const startOffset = normalized.indexOf(text, cursor);
    const realStart = startOffset >= 0 ? startOffset : cursor;
    const endOffset = realStart + text.length;
    cursor = endOffset;

    // heading tracking
    if (HEADING_RE.test(text) && text.length < 60) {
      const depth = (text.match(/^#+/) || [''])[0].length || 1;
      headingPath.length = Math.max(0, depth - 1);
      headingPath.push(text.replace(/^#+\s*/, '').trim());
    }

    // article detection
    let articleNo = null;
    const am = text.match(ARTICLE_RE);
    if (am) {
      articleNo = normalizeArticleKey(am[0]);
    }

    // case section detection
    let caseSection = null;
    for (const c of CASE_SECTION_RES) {
      if (c.re.test(text)) {
        caseSection = c.key;
        break;
      }
    }

    paragraphs.push({
      paragraphIndex,
      paragraphId,
      sourceId,
      text,
      startOffset: realStart,
      endOffset,
      hash: sha1(text).slice(0, 16),
      headingPath: [...headingPath],
      articleNo,
      caseSection,
    });
  });

  return { paragraphs };
}

/** Render paragraphs back to Markdown body with [PN] markers. */
export function formatParagraphsMarkdown(paragraphs) {
  return paragraphs.map((p) => `[P${p.paragraphIndex}] ${p.text}`).join('\n\n');
}

// standalone CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const content = args.in ? readText(args.in) : '';
  const { paragraphs } = paragraphizeContent(content, 'standalone');
  printJson({ count: paragraphs.length, paragraphs });
}
