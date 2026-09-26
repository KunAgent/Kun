import type {
  PaperVenueCatalogEntry,
  PaperVenueCatalogResult,
  PaperVenueItem,
  PaperVenueListResult
} from '../../../shared/paper/paper-library-types'
import { decodeEntities, stripTags } from './coolpapers-client'
import type { PaperFetchContext } from './arxiv-client'
import { PaperFetchError, paperFetchText } from './paper-http'

/**
 * papers.cool conference listings: the venue catalog scraped from the home
 * page (`ICLR.2025` + its `?group=` tracks) and paged venue pages parsed into
 * full paper cards (title, authors, abstract, PDF, track, reading stars).
 */

const COOL_ORIGIN = 'https://papers.cool'
const VENUE_TIMEOUT_MS = 20_000
const CATALOG_TTL_MS = 12 * 60 * 60 * 1000
const VENUE_ID_RE = /^[A-Za-z0-9.+-]{1,60}$/

export const PAPER_VENUE_PAGE_SIZE = 50

type ErrorResult = { ok: false; code: 'network' | 'timeout' | 'invalid-input'; message: string }

function errorResult(error: unknown): ErrorResult {
  if (error instanceof PaperFetchError && error.code === 'timeout') {
    return { ok: false, code: 'timeout', message: error.message }
  }
  return { ok: false, code: 'network', message: error instanceof Error ? error.message : String(error) }
}

function textOf(fragment: string): string {
  return decodeEntities(stripTags(fragment)).replace(/\s+/g, ' ').trim()
}

// ---- catalog -------------------------------------------------------------------

/** `ICLR.2025` → series `ICLR`, year `2025`; ids without a year are skipped. */
function splitVenueId(id: string): { series: string; year: string } | null {
  const m = id.match(/^(.+)\.(\d{4})$/)
  return m ? { series: m[1], year: m[2] } : null
}

/** Venue ids and their tracks, in page order, from the papers.cool home page. */
export function parseCoolVenueCatalog(html: string): PaperVenueCatalogEntry[] {
  const byId = new Map<string, PaperVenueCatalogEntry>()
  for (const match of html.matchAll(/href="\/venue\/([A-Za-z0-9.+-]+)(?:\?group=([^"]*))?"/g)) {
    const id = match[1]
    const parts = splitVenueId(id)
    if (!parts) continue
    let entry = byId.get(id)
    if (!entry) {
      entry = { id, series: parts.series, year: parts.year, groups: [] }
      byId.set(id, entry)
    }
    const group = match[2] ? decodeEntities(match[2]).trim() : ''
    if (group && !entry.groups.includes(group)) entry.groups.push(group)
  }
  return [...byId.values()]
}

let catalogCache: { at: number; venues: PaperVenueCatalogEntry[] } | null = null

export async function fetchCoolVenueCatalog(
  options: PaperFetchContext & { force?: boolean } = {}
): Promise<PaperVenueCatalogResult> {
  if (!options.force && catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return { ok: true, venues: catalogCache.venues }
  }
  try {
    const html = await paperFetchText(`${COOL_ORIGIN}/`, { ...options, timeoutMs: VENUE_TIMEOUT_MS })
    const venues = parseCoolVenueCatalog(html)
    if (venues.length) catalogCache = { at: Date.now(), venues }
    return { ok: true, venues }
  } catch (error) {
    return errorResult(error)
  }
}

// ---- venue page ----------------------------------------------------------------

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`))
  return m ? decodeEntities(m[1]).trim() : undefined
}

/** One `<div class="panel paper">` block → card; null when it has no title. */
function parsePaperPanel(id: string, block: string): PaperVenueItem | null {
  const titleMatch = block.match(/<a[^>]*class="title-link[^"]*"[^>]*>([\s\S]*?)<\/a>/)
  const title = titleMatch ? textOf(titleMatch[1]) : ''
  if (!title) return null
  const authors = [...block.matchAll(/<a[^>]*class="author[^"]*"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((m) => textOf(m[1]))
    .filter(Boolean)
  const summary = block.match(/<p[^>]*class="summary[^"]*"[^>]*>([\s\S]*?)<\/p>/)
  const pdfTag = block.match(/<a[^>]*class="title-pdf[^"]*"[^>]*>/)
  const stars = block.match(/id="pdf-stars-[^"]*">(\d+)</)
  const subject = block.match(/<a[^>]*class="subject-[^"]*"[^>]*>([\s\S]*?)<\/a>/)
  const forum = block.match(/<h2 class="title">\s*<a href="([^"]+)"/)
  const item: PaperVenueItem = { coolId: id, title, authors }
  const abstract = summary ? textOf(summary[1]) : ''
  if (abstract) item.abstract = abstract
  const pdfUrl = pdfTag ? attr(pdfTag[0], 'data') : undefined
  if (pdfUrl && /^https?:\/\//.test(pdfUrl)) item.pdfUrl = pdfUrl
  if (stars) item.stars = Number(stars[1])
  if (subject) {
    // "ICLR.2025 - Oral" → "Oral"; plain venue subjects keep their text.
    const text = textOf(subject[1])
    item.group = text.includes(' - ') ? text.slice(text.indexOf(' - ') + 3) : text
  }
  const forumUrl = forum ? decodeEntities(forum[1]) : ''
  if (/^https?:\/\//.test(forumUrl)) item.sourceUrl = forumUrl
  return item
}

export function parseCoolVenuePage(html: string): { total: number; items: PaperVenueItem[] } {
  const totalMatch = html.match(/Total:\s*(\d+)/)
  const starts = [...html.matchAll(/<div id="([^"]+)" class="panel paper"/g)]
  const items: PaperVenueItem[] = []
  const seen = new Set<string>()
  starts.forEach((match, index) => {
    const id = decodeEntities(match[1])
    if (seen.has(id)) return
    const end = index + 1 < starts.length ? starts[index + 1].index : html.length
    const item = parsePaperPanel(id, html.slice(match.index, end))
    if (!item) return
    seen.add(id)
    items.push(item)
  })
  return { total: totalMatch ? Number(totalMatch[1]) : items.length, items }
}

export async function fetchCoolVenue(
  request: { venue: string; group?: string; skip?: number },
  options: PaperFetchContext = {}
): Promise<PaperVenueListResult> {
  const venue = request.venue.trim()
  if (!VENUE_ID_RE.test(venue)) {
    return { ok: false, code: 'invalid-input', message: 'Invalid venue id.' }
  }
  const group = request.group?.trim() || ''
  const skip = Math.max(0, Math.floor(request.skip ?? 0))
  const params = new URLSearchParams()
  if (group) params.set('group', group)
  if (skip) params.set('skip', String(skip))
  params.set('show', String(PAPER_VENUE_PAGE_SIZE))
  try {
    const html = await paperFetchText(
      `${COOL_ORIGIN}/venue/${encodeURIComponent(venue)}?${params.toString()}`,
      { ...options, timeoutMs: VENUE_TIMEOUT_MS }
    )
    const page = parseCoolVenuePage(html)
    return { ok: true, venue, group, skip, total: page.total, items: page.items }
  } catch (error) {
    return errorResult(error)
  }
}
