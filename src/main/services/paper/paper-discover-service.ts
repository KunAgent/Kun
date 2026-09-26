import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  PaperArxivTodayItem,
  PaperFeedItem,
  PaperTitleSearchCandidate
} from '../../../shared/paper/paper-library-types'
import { decodeEntities, stripTags } from './coolpapers-client'
import type { PaperFetchContext } from './arxiv-client'
import { searchArxivByTitle } from './arxiv-client'
import { scholarSearchByTitle } from './scholar-client'
import { PaperFetchError, paperFetchText, PAPER_HTML_MAX_BYTES } from './paper-http'

/**
 * Discovery/import enrichment (plan §6.4): RSS 2.0 / Atom / JSON Feed
 * fetching for user subscriptions, arXiv category "today" RSS with a per-day
 * disk cache, `citation_*` meta extraction for
 * publisher pages, and the parallel S2+arXiv title search.
 */

const TITLE_SEARCH_BUDGET_MS = 5000
const FEED_MAX_ITEMS = 200

// ---- feed parsing ------------------------------------------------------------

function xmlTagText(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  if (!m) return undefined
  const text = decodeEntities(stripTags(m[1])).trim()
  return text || undefined
}

function xmlLink(block: string): string | undefined {
  const atom = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i)?.[1]
  if (atom) return decodeEntities(atom.trim())
  return xmlTagText(block, 'link')
}

const ARXIV_ABS_RE = /arxiv\.org\/abs\/([^?\s"']+)/i
const DOI_IN_TEXT_RE = /\b10\.\d{4,9}\/[A-Za-z0-9._;()/:+-]+/

function feedItemIds(url: string, text: string): { arxivId?: string; doi?: string } {
  const arxivId = ARXIV_ABS_RE.exec(url)?.[1] ?? ARXIV_ABS_RE.exec(text)?.[1]
  const doi = DOI_IN_TEXT_RE.exec(url)?.[0] ?? DOI_IN_TEXT_RE.exec(text)?.[0]
  return {
    arxivId: arxivId?.replace(/v\d+$/, ''),
    doi: doi?.replace(/[.,;\])}]+$/, '')
  }
}

function parseRssItems(xml: string): { title: string; items: PaperFeedItem[] } {
  const title = xmlTagText(xml, 'title') ?? ''
  const items: PaperFeedItem[] = []
  const isAtom = /<entry[\s>]/.test(xml)
  const blocks = isAtom
    ? [...xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi)].map((m) => m[1])
    : [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)].map((m) => m[1])
  for (const block of blocks.slice(0, FEED_MAX_ITEMS)) {
    const itemTitle = xmlTagText(block, 'title')
    const url = xmlLink(block)
    if (!itemTitle || !url) continue
    const summary = xmlTagText(block, isAtom ? 'summary' : 'description')
      ?? xmlTagText(block, 'content')
    const publishedAt = xmlTagText(block, isAtom ? 'published' : 'pubDate')
      ?? xmlTagText(block, 'updated')
    items.push({
      title: itemTitle.replace(/\s+/g, ' '),
      url,
      summary,
      publishedAt,
      ...feedItemIds(url, `${itemTitle} ${summary ?? ''}`)
    })
  }
  return { title, items }
}

function parseJsonFeed(text: string): { title: string; items: PaperFeedItem[] } | null {
  try {
    const json = JSON.parse(text) as {
      title?: string
      items?: { title?: string; url?: string; id?: string; date_published?: string; summary?: string; content_text?: string }[]
    }
    if (!Array.isArray(json.items)) return null
    const items = json.items.slice(0, FEED_MAX_ITEMS).flatMap((item) => {
      const url = item.url ?? item.id
      if (!item.title || !url) return []
      return [{
        title: item.title.replace(/\s+/g, ' '),
        url,
        summary: item.summary ?? item.content_text?.slice(0, 2000),
        publishedAt: item.date_published,
        ...feedItemIds(url, `${item.title} ${item.summary ?? ''}`)
      }]
    })
    return { title: json.title ?? '', items }
  } catch {
    return null
  }
}

export type PaperFeedOutcome =
  | { ok: true; title: string; items: PaperFeedItem[] }
  | { ok: false; code: 'network' | 'timeout' | 'invalid-feed' | 'invalid-input'; message: string }

export async function fetchPaperFeed(
  url: string,
  options: PaperFetchContext = {}
): Promise<PaperFeedOutcome> {
  try {
    const text = await paperFetchText(url, {
      ...options,
      allowAnyHost: true,
      timeoutMs: options.timeoutMs ?? 15_000,
      maxBytes: PAPER_HTML_MAX_BYTES
    })
    if (/^\s*</.test(text)) {
      const parsed = parseRssItems(text)
      if (parsed.items.length === 0 && !parsed.title) {
        return { ok: false, code: 'invalid-feed', message: 'Feed contains no items.' }
      }
      return { ok: true, title: parsed.title, items: parsed.items }
    }
    const json = parseJsonFeed(text)
    if (json) return { ok: true, title: json.title, items: json.items }
    return { ok: false, code: 'invalid-feed', message: 'Not an RSS/Atom/JSON feed.' }
  } catch (error) {
    if (error instanceof PaperFetchError) {
      return {
        ok: false,
        code: error.code === 'timeout' ? 'timeout' : 'network',
        message: error.message
      }
    }
    return { ok: false, code: 'network', message: error instanceof Error ? error.message : String(error) }
  }
}

// ---- arXiv today --------------------------------------------------------------

function arxivTodayCachePath(cacheDir: string, date: string): string {
  return join(cacheDir, `arxiv-today-${date}.json`)
}

type ArxivTodayCache = {
  date: string
  fetchedAt: string
  items: PaperArxivTodayItem[]
}

async function readArxivTodayCache(cacheDir: string, date: string): Promise<ArxivTodayCache | null> {
  try {
    const raw = await readFile(arxivTodayCachePath(cacheDir, date), 'utf8')
    const parsed = JSON.parse(raw) as ArxivTodayCache
    return parsed.date === date && Array.isArray(parsed.items) ? parsed : null
  } catch {
    return null
  }
}

/** Fetch today's arXiv RSS per category; results cache per UTC day. */
export async function fetchArxivToday(input: {
  categories: string[]
  date: string
  cacheDir: string
  force?: boolean
  fetchContext?: PaperFetchContext
}): Promise<
  | { ok: true; date: string; items: PaperArxivTodayItem[]; fromCache: boolean }
  | { ok: false; code: 'network' | 'timeout' | 'invalid-input'; message: string }
> {
  if (!input.force) {
    const cached = await readArxivTodayCache(input.cacheDir, input.date)
    if (cached) return { ok: true, date: input.date, items: cached.items, fromCache: true }
  }
  const seen = new Map<string, PaperArxivTodayItem>()
  try {
    for (const category of input.categories.slice(0, 16)) {
      const url = `https://rss.arxiv.org/rss/${encodeURIComponent(category)}`
      const xml = await paperFetchText(url, {
        ...input.fetchContext,
        timeoutMs: 20_000,
        maxBytes: PAPER_HTML_MAX_BYTES
      })
      for (const item of parseRssItems(xml).items) {
        const arxivId = ARXIV_ABS_RE.exec(item.url)?.[1]?.replace(/v\d+$/, '')
          ?? item.arxivId
        if (!arxivId || seen.has(arxivId)) continue
        seen.set(arxivId, {
          arxivId,
          title: item.title,
          authors: [],
          abstract: item.summary,
          categories: [category],
          publishedAt: item.publishedAt,
          relevance: 0
        })
      }
    }
  } catch (error) {
    if (error instanceof PaperFetchError && error.code === 'timeout') {
      return { ok: false, code: 'timeout', message: error.message }
    }
    return { ok: false, code: 'network', message: error instanceof Error ? error.message : String(error) }
  }
  const items = [...seen.values()]
  const cache: ArxivTodayCache = { date: input.date, fetchedAt: new Date().toISOString(), items }
  await mkdir(input.cacheDir, { recursive: true })
    .then(() => writeFile(arxivTodayCachePath(input.cacheDir, input.date), JSON.stringify(cache), 'utf8'))
    .catch(() => undefined)
  return { ok: true, date: input.date, items, fromCache: false }
}

// ---- publisher-page citation_* meta --------------------------------------------

function metaTagValues(html: string, name: string): string[] {
  const out: string[] = []
  const re = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'gi')
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'gi')
  for (const m of html.matchAll(re)) out.push(decodeEntities(m[1].trim()))
  for (const m of html.matchAll(re2)) out.push(decodeEntities(m[1].trim()))
  return out
}

export type PaperUrlMetaOutcome =
  | {
      ok: true
      meta: {
        title: string
        authors: string[]
        year?: string
        venue?: string
        doi?: string
        arxivId?: string
        pdfUrl?: string
        abstract?: string
      }
    }
  | { ok: false; code: 'network' | 'timeout' | 'invalid-input' | 'not-found'; message: string }

export async function fetchUrlPaperMeta(
  url: string,
  options: PaperFetchContext = {}
): Promise<PaperUrlMetaOutcome> {
  try {
    const html = await paperFetchText(url, {
      ...options,
      allowAnyHost: true,
      timeoutMs: 15_000,
      maxBytes: PAPER_HTML_MAX_BYTES
    })
    const title = metaTagValues(html, 'citation_title')[0]
    if (!title) {
      return { ok: false, code: 'not-found', message: 'Page has no citation_title meta.' }
    }
    const date = metaTagValues(html, 'citation_publication_date')[0]
      ?? metaTagValues(html, 'citation_date')[0]
    return {
      ok: true,
      meta: {
        title,
        authors: metaTagValues(html, 'citation_author'),
        year: date?.slice(0, 4),
        venue: metaTagValues(html, 'citation_journal_title')[0]
          ?? metaTagValues(html, 'citation_conference_title')[0],
        doi: metaTagValues(html, 'citation_doi')[0],
        arxivId: metaTagValues(html, 'citation_arxiv_id')[0],
        pdfUrl: metaTagValues(html, 'citation_pdf_url')[0],
        abstract: metaTagValues(html, 'citation_abstract')[0]?.slice(0, 8000)
      }
    }
  } catch (error) {
    if (error instanceof PaperFetchError) {
      return {
        ok: false,
        code: error.code === 'timeout' ? 'timeout' : error.code === 'invalid-url' ? 'invalid-input' : 'network',
        message: error.message
      }
    }
    return { ok: false, code: 'network', message: error instanceof Error ? error.message : String(error) }
  }
}

// ---- parallel title search ------------------------------------------------------

export type PaperTitleSearchOutcome =
  | { ok: true; candidates: PaperTitleSearchCandidate[] }
  | { ok: false; code: 'network' | 'timeout' | 'invalid-input'; message: string }

export async function searchPapersByTitle(input: {
  query: string
  limit?: number
  fetchContext?: PaperFetchContext
}): Promise<PaperTitleSearchOutcome> {
  const query = input.query.trim()
  if (!query) return { ok: false, code: 'invalid-input', message: 'Empty title.' }
  const limit = Math.min(Math.max(1, input.limit ?? 3), 10)
  const budget = AbortSignal.timeout(TITLE_SEARCH_BUDGET_MS)
  const signal = input.fetchContext?.signal
    ? AbortSignal.any([input.fetchContext.signal, budget])
    : budget
  const context = { signal, proxyUrl: input.fetchContext?.proxyUrl }

  const [s2, arxiv] = await Promise.allSettled([
    scholarSearchByTitle(query, { ...context, limit }),
    searchArxivByTitle(query, { ...context, limit })
  ])
  if (s2.status === 'rejected' && arxiv.status === 'rejected') {
    const timedOut = [s2.reason, arxiv.reason].some(
      (reason) => reason instanceof PaperFetchError && reason.code === 'timeout'
    ) || signal.aborted
    return {
      ok: false,
      code: timedOut ? 'timeout' : 'network',
      message: 'Title search failed.'
    }
  }
  const candidates: PaperTitleSearchCandidate[] = []
  const seen = new Set<string>()
  const push = (candidate: PaperTitleSearchCandidate) => {
    const key = candidate.doi?.toLowerCase() ?? candidate.arxivId ?? `t:${candidate.title.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    candidates.push(candidate)
  }
  if (s2.status === 'fulfilled') {
    for (const meta of s2.value) {
      push({
        title: meta.title,
        authors: meta.authors,
        year: meta.year,
        venue: meta.venue,
        arxivId: meta.arxivId,
        doi: meta.doi,
        source: 's2',
        citationCount: meta.citationCount
      })
    }
  }
  if (arxiv.status === 'fulfilled') {
    for (const meta of arxiv.value) {
      push({
        title: meta.title,
        authors: meta.authors,
        year: meta.year,
        venue: meta.doi ? 'arXiv' : undefined,
        arxivId: meta.arxivId,
        doi: meta.doi,
        source: 'arxiv'
      })
    }
  }
  return { ok: true, candidates: candidates.slice(0, limit) }
}
