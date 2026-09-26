import type { PaperSourceConnector, PaperSourceHit } from './paper-search-types.js'
import { PaperSourceHttpError } from './paper-search-api-sources.js'
import { cleanText, inYearRange, normalizeDoi } from './paper-search-text.js'

/**
 * DBLP publication API (`dblp.org/search/publ/api`). Excellent coverage of CS
 * venues; doubles as the availability probe for the DBLP mirror.
 */

type DblpAuthor = { text?: string } | string

type DblpHit = {
  info?: {
    title?: string
    authors?: { author?: DblpAuthor[] | DblpAuthor }
    year?: string | number
    venue?: string
    doi?: string
    url?: string
    ee?: string
    type?: string
  }
}

function dblpAuthors(info: DblpHit['info']): string[] {
  const author = info?.authors?.author
  if (!author) return []
  const list = Array.isArray(author) ? author : [author]
  return list.map((a) => cleanText(typeof a === 'string' ? a : a.text)).filter(Boolean)
}

export function mapDblpHit(hit: DblpHit): PaperSourceHit | null {
  const info = hit.info
  const title = cleanText(info?.title).replace(/\.$/, '')
  if (!title) return null
  const year = typeof info?.year === 'number' ? info.year : Number(info?.year) || undefined
  return {
    title,
    authors: dblpAuthors(info),
    year,
    venue: cleanText(info?.venue) || undefined,
    doi: normalizeDoi(info?.doi),
    url: info?.ee ?? info?.url
  }
}

export function parseDblpSearch(body: unknown): PaperSourceHit[] {
  const hits = (body as { result?: { hits?: { hit?: DblpHit[] | DblpHit } } } | undefined)?.result?.hits?.hit
  const list = !hits ? [] : Array.isArray(hits) ? hits : [hits]
  return list.map(mapDblpHit).filter((hit): hit is PaperSourceHit => hit !== null)
}

export const searchDblp: PaperSourceConnector = async (q, { fetch, signal }) => {
  const query = q.query.trim()
  if (!query) return []
  const params = new URLSearchParams({
    q: query,
    h: String(q.limit),
    format: 'json'
  })
  const response = await fetch(`https://dblp.org/search/publ/api?${params.toString()}`, {
    headers: { accept: 'application/json' },
    signal
  })
  if (!response.ok) {
    const hint = response.status === 429 ? ' (rate limited)' : ''
    throw new PaperSourceHttpError(response.status, `HTTP ${response.status}${hint}`)
  }
  return parseDblpSearch(await response.json())
    .filter((hit) => hit.year === undefined || inYearRange(hit.year, q.yearFrom, q.yearTo))
    .slice(0, q.limit)
}
