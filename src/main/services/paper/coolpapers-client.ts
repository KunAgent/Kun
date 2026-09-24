/**
 * Cool Papers (papers.cool) client.
 *
 * Ported from Agentero (`src-tauri/src/features/paper/discovery/coolpapers/`,
 * MIT licensed): resolution order, truncated-title matching, the kimi
 * HTML+Markdown hybrid conversion, and the CTA/footer removal all follow the
 * reference implementation. papers.cool is server-rendered with no JSON API;
 * `/kimi` answers 200 with an empty body for unknown ids and may generate
 * content upstream on first request, so every call is serialized through a
 * module-level queue and callers use a 180s timeout.
 */
import {
  isVenueCoolId,
  parseCoolPapersUrl,
  stripArxivVersion
} from '../../../shared/paper/paper-ids'
import type { PaperCoolNotesMatchedBy } from '../../../shared/paper/paper-types'
import { PAPER_HTML_MAX_BYTES, paperFetchText } from './paper-http'

const COOL_PAPERS_ORIGIN = 'https://papers.cool'
const COOL_PAPERS_TIMEOUT_MS = 180_000
const COOL_BRANCHES = ['arxiv', 'venue'] as const
const TITLE_PREFIX_MIN = 24

export type CoolTextFetcher = (url: string, options: { signal?: AbortSignal }) => Promise<string>

// ---- serialized access ----------------------------------------------------

let coolPapersQueue: Promise<unknown> = Promise.resolve()

/**
 * papers.cool generates Kimi notes on demand; concurrent requests would pile
 * onto their LLM quota. Every fetch goes through this process-wide chain.
 */
export function runCoolPapersSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = coolPapersQueue.then(fn, fn)
  coolPapersQueue = run.catch(() => undefined)
  return run
}

// ---- pure helpers (ported from mod.rs) ------------------------------------

/** Comparison key for titles: alphanumerics only, lowercased. */
export function titleKey(raw: string): string {
  return [...raw]
    .filter((c) => /[\p{L}\p{N}]/u.test(c))
    .map((c) => c.toLowerCase())
    .join('')
}

/** Query string papers.cool expects: alphanumeric runs joined by spaces. */
export function searchQuery(title: string): string {
  return [...title]
    .map((c) => (/[\p{L}\p{N}]/u.test(c) ? c : ' '))
    .join('')
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .join(' ')
}

export function stripTags(input: string): string {
  let out = ''
  let depth = 0
  for (const c of input) {
    if (c === '<') depth += 1
    else if (c === '>') depth = Math.max(0, depth - 1)
    else if (depth === 0) out += c
  }
  return out
}

/**
 * Decode named and numeric HTML entities by scanning characters — a bare `&`
 * in front of CJK text must not slice mid-codepoint.
 */
export function decodeEntities(input: string): string {
  if (!input.includes('&')) return input
  let out = ''
  let rest = input
  for (;;) {
    const amp = rest.indexOf('&')
    if (amp < 0) break
    out += rest.slice(0, amp)
    const tail = rest.slice(amp)
    // Entities are short; cap the scan window like the Rust `take(32)`.
    let semi = -1
    let i = 0
    for (const c of tail) {
      if (i >= 32) break
      if (c === ';') {
        semi = i
        break
      }
      i += c.length
    }
    if (semi < 0) {
      out += '&'
      rest = tail.slice(1)
      continue
    }
    const entity = tail.slice(1, semi)
    let decoded: string | null = null
    switch (entity) {
      case 'amp': decoded = '&'; break
      case 'lt': decoded = '<'; break
      case 'gt': decoded = '>'; break
      case 'quot': decoded = '"'; break
      case 'apos': decoded = "'"; break
      case 'nbsp': decoded = ' '; break
      default: {
        if (entity.startsWith('#')) {
          const num = entity.slice(1)
          const code = /^[xX]/.test(num)
            ? parseInt(num.slice(1), 16)
            : parseInt(num, 10)
          if (Number.isFinite(code)) {
            try {
              decoded = String.fromCodePoint(code)
            } catch {
              decoded = null
            }
          }
        }
      }
    }
    if (decoded !== null) {
      out += decoded
      rest = tail.slice(semi + 1)
    } else {
      out += '&'
      rest = tail.slice(1)
    }
  }
  return out + rest
}

/** Collapse runs of 3+ newlines down to a blank-line separator. */
export function squeezeBlankLines(input: string): string {
  let out = ''
  let newlines = 0
  for (const c of input) {
    if (c === '\n') {
      newlines += 1
      if (newlines <= 2) out += c
    } else {
      newlines = 0
      out += c
    }
  }
  return out
}

/** `(id, title)` for every paper on a list page. */
export function parseSearchHits(html: string): Array<{ id: string; title: string }> {
  const ANCHOR = '<a id="title-'
  const out: Array<{ id: string; title: string }> = []
  let rest = html
  for (;;) {
    const start = rest.indexOf(ANCHOR)
    if (start < 0) break
    rest = rest.slice(start + ANCHOR.length)
    const quote = rest.indexOf('"')
    if (quote < 0) break
    const id = rest.slice(0, quote)
    rest = rest.slice(quote)
    const gt = rest.indexOf('>')
    if (gt < 0) break
    rest = rest.slice(gt + 1)
    const close = rest.indexOf('</a>')
    if (close < 0) break
    const title = decodeEntities(stripTags(rest.slice(0, close))).trim()
    rest = rest.slice(close + 4)
    if (id && title) out.push({ id, title })
  }
  return out
}

/**
 * Search-result titles are often clipped. Accept exact keys, or a long prefix
 * of at least TITLE_PREFIX_MIN normalized characters.
 */
export function titlesCompatible(want: string, hit: string): boolean {
  const wantKey = titleKey(want)
  const hitKey = titleKey(hit)
  if (!wantKey || !hitKey) return false
  if (wantKey === hitKey) return true
  const [short, long] = wantKey.length <= hitKey.length ? [wantKey, hitKey] : [hitKey, wantKey]
  return long.startsWith(short) && short.length >= TITLE_PREFIX_MIN
}

/** Cool Papers ends every FAQ with a "chat on Kimi web" promo (usually Q7). */
export function isKimiWebCtaQuestion(question: string): boolean {
  const q = question.trim()
  return q.includes('想要进一步了解') || q.includes('进一步了解论文')
}

const FAQ_A_OPEN = '<div class="faq-a"'

/** Drop the `<div class="faq-a">…</div>` that follows a skipped CTA question. */
function skipFollowingFaqAnswer(afterQ: string): string {
  const start = afterQ.indexOf(FAQ_A_OPEN)
  if (start < 0) return afterQ
  const from = afterQ.slice(start)
  const close = from.indexOf('</div>')
  return close >= 0 ? from.slice(close + '</div>'.length) : afterQ
}

/**
 * Turn the `/kimi` HTML+Markdown hybrid into plain Markdown.
 *
 * Questions arrive as `<p class="faq-q"><strong>Q1</strong>: …</p>` and become
 * `## Qn: …` so answer-body `###` subsections nest cleanly. `$…$` math is kept
 * verbatim; the trailing Kimi-web CTA question and its answer are dropped.
 */
export function kimiHtmlToMarkdown(raw: string): string {
  const Q_OPEN = '<p class="faq-q">'
  let staged = ''
  let rest = raw
  for (;;) {
    const start = rest.indexOf(Q_OPEN)
    if (start < 0) break
    staged += rest.slice(0, start)
    const after = rest.slice(start + Q_OPEN.length)
    const end = after.indexOf('</p>')
    if (end < 0) {
      rest = after
      break
    }
    const question = decodeEntities(stripTags(after.slice(0, end)))
    const afterQ = after.slice(end + '</p>'.length)
    if (isKimiWebCtaQuestion(question)) {
      rest = skipFollowingFaqAnswer(afterQ)
      continue
    }
    staged += `## ${question.trim()}`
    rest = afterQ
  }
  staged += rest

  let body = ''
  for (const line of staged.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith(FAQ_A_OPEN) || trimmed === '</div>') continue
    body += `${line}\n`
  }
  return squeezeBlankLines(decodeEntities(body.trim()).trim())
}

// ---- venue page metadata (ported from page.rs) ----------------------------

export type CoolPageMeta = {
  title: string
  authors: string[]
  abstractText?: string
  pdfUrl?: string
  publicUrl?: string
  publisher?: string
  /** `citation_date` when present, else `citation_year`. */
  date?: string
}

function metaContent(html: string, name: string): string | undefined {
  const needle = `<meta name="${name}" content="`
  const start = html.indexOf(needle)
  if (start < 0) return undefined
  const rest = html.slice(start + needle.length)
  const end = rest.indexOf('"')
  if (end < 0) return undefined
  const value = decodeEntities(rest.slice(0, end)).trim()
  return value || undefined
}

/** Highwire `citation_*` metadata scraped from a papers.cool paper page. */
export function parseCoolPageMeta(html: string): CoolPageMeta {
  const authors = (metaContent(html, 'citation_authors') ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return {
    title: metaContent(html, 'citation_title') ?? '',
    authors,
    abstractText: metaContent(html, 'citation_abstract'),
    pdfUrl: metaContent(html, 'citation_pdf_url'),
    publicUrl: metaContent(html, 'citation_public_url'),
    publisher: metaContent(html, 'citation_publisher'),
    date: metaContent(html, 'citation_date') ?? metaContent(html, 'citation_year')
  }
}

// ---- networked resolution -------------------------------------------------

export type CoolNotesResolution = {
  branch: 'arxiv' | 'venue'
  id: string
  matchedBy: PaperCoolNotesMatchedBy
}

/**
 * Resolution order: papers.cool `sourceUrl` → venue catalog id → arXiv id.
 * Title search is a separate step (see `resolveCoolNotesByTitle`).
 */
export function resolveCoolNotesRef(input: {
  sourceUrl?: string
  coolId?: string
  arxivId?: string
}): CoolNotesResolution | null {
  const fromUrl = input.sourceUrl ? parseCoolPapersUrl(input.sourceUrl) : null
  if (fromUrl) return { branch: fromUrl.branch, id: fromUrl.id, matchedBy: 'sourceUrl' }
  if (input.coolId && isVenueCoolId(input.coolId)) {
    return { branch: 'venue', id: input.coolId.trim(), matchedBy: 'coolId' }
  }
  if (input.arxivId) {
    const id = stripArxivVersion(input.arxivId).trim()
    if (id) return { branch: 'arxiv', id, matchedBy: 'arxivId' }
  }
  return null
}

/**
 * Title lookup across branches. Never trust rank: papers.cool reports a
 * constant `Total: 1000` and wrong-branch queries still return plausible
 * results, so only an exact normalized title or a unique long-prefix hit wins.
 */
export async function resolveCoolNotesByTitle(
  title: string,
  fetchText: CoolTextFetcher
): Promise<CoolNotesResolution | null> {
  const query = searchQuery(title)
  const want = titleKey(title)
  if (!query || !want) return null
  for (const branch of COOL_BRANCHES) {
    const url = `${COOL_PAPERS_ORIGIN}/${branch}/search?query=${encodeURIComponent(query)}`
    let html: string
    try {
      html = await fetchText(url, {})
    } catch {
      continue
    }
    const hits = parseSearchHits(html)
    const exact = hits.find((hit) => titleKey(hit.title) === want)
    if (exact) return { branch, id: exact.id, matchedBy: 'title' }
    const prefix = hits.filter((hit) => titlesCompatible(title, hit.title))
    if (prefix.length === 1) return { branch, id: prefix[0].id, matchedBy: 'title' }
  }
  return null
}

export type CoolNotesOutcome =
  | {
      found: true
      markdown: string
      /** papers.cool paper page URL used for the source link. */
      pageUrl: string
      matchedBy: PaperCoolNotesMatchedBy
    }
  | { found: false }

export type CoolFetchOptions = {
  signal?: AbortSignal
  proxyUrl?: string
  fetchText?: CoolTextFetcher
}

/**
 * Resolve the unit's Cool Papers row and fetch its Kimi analysis as Markdown.
 * Serialized process-wide; empty kimi bodies mean "not found".
 */
export async function fetchCoolNotesMarkdown(
  meta: { sourceUrl?: string; coolId?: string; arxivId?: string; title?: string },
  options: CoolFetchOptions = {}
): Promise<CoolNotesOutcome> {
  return runCoolPapersSerialized(async () => {
    const fetchText: CoolTextFetcher =
      options.fetchText ??
      ((url, opts) =>
        paperFetchText(url, {
          signal: opts.signal ?? options.signal,
          timeoutMs: COOL_PAPERS_TIMEOUT_MS,
          maxBytes: PAPER_HTML_MAX_BYTES,
          proxyUrl: options.proxyUrl
        }))
    let resolution = resolveCoolNotesRef(meta)
    if (!resolution) {
      const title = meta.title?.trim()
      if (!title) return { found: false }
      resolution = await resolveCoolNotesByTitle(title, fetchText)
      if (!resolution) return { found: false }
    }
    const kimiUrl = `${COOL_PAPERS_ORIGIN}/${resolution.branch}/kimi?paper=${encodeURIComponent(resolution.id)}`
    const raw = await fetchText(kimiUrl, { signal: options.signal })
    const markdown = kimiHtmlToMarkdown(raw)
    if (!markdown) return { found: false }
    const pageUrl = `${COOL_PAPERS_ORIGIN}/${resolution.branch}/${encodeURIComponent(resolution.id)}`
    return { found: true, markdown, pageUrl, matchedBy: resolution.matchedBy }
  })
}

/** Fetch a papers.cool paper page and parse its `citation_*` metadata. */
export async function fetchCoolPageMeta(
  ref: { branch: 'arxiv' | 'venue'; id: string },
  options: { signal?: AbortSignal; proxyUrl?: string } = {}
): Promise<CoolPageMeta | null> {
  const url = `${COOL_PAPERS_ORIGIN}/${ref.branch}/${encodeURIComponent(ref.id)}`
  const html = await paperFetchText(url, {
    signal: options.signal,
    timeoutMs: 60_000,
    maxBytes: PAPER_HTML_MAX_BYTES,
    proxyUrl: options.proxyUrl
  })
  const meta = parseCoolPageMeta(html)
  return meta.title ? meta : null
}

/**
 * Markdown block appended to NOTES.md. Bold label (not a heading) so the
 * `## Qn` questions nest cleanly under the note's own `#` title.
 */
export function buildCoolNotesBlock(markdown: string, pageUrl: string): string {
  return `**Cool Papers · Kimi 解析**\n\n> 来源：[${pageUrl}](${pageUrl})\n\n${markdown}`
}
