import type { PaperSourceConnector, PaperSourceHit } from './paper-search-types.js'
import { PaperSourceHttpError } from './paper-search-api-sources.js'
import { cleanText, inYearRange, normalizeDoi } from './paper-search-text.js'

/**
 * CORE API v3 (`api.core.ac.uk`). Aggregates open-access papers from
 * repositories worldwide. Requires an API key; without one the connector
 * returns no hits so the source can stay in the catalog but hidden.
 */

type CoreWork = {
  id?: number
  title?: string
  authors?: Array<{ name?: string }>
  abstract?: string
  yearPublished?: number
  doi?: string
  downloadUrl?: string
  links?: Array<{ type?: string; url?: string }>
  publisher?: string
  journals?: Array<{ title?: string }>
}

export function mapCoreWork(work: CoreWork): PaperSourceHit | null {
  const title = cleanText(work.title)
  if (!title) return null
  const landing = work.links?.find((link) => link.type === 'display')?.url
  return {
    title,
    authors: (work.authors ?? []).map((a) => cleanText(a.name)).filter(Boolean),
    abstract: cleanText(work.abstract) || undefined,
    year: work.yearPublished,
    venue: cleanText(work.journals?.[0]?.title ?? work.publisher) || undefined,
    doi: normalizeDoi(work.doi),
    url: landing ?? (work.id !== undefined ? `https://core.ac.uk/works/${work.id}` : undefined),
    pdfUrl: work.downloadUrl
  }
}

export function parseCoreSearch(body: unknown): PaperSourceHit[] {
  const results = (body as { results?: CoreWork[] } | undefined)?.results ?? []
  return results.map(mapCoreWork).filter((hit): hit is PaperSourceHit => hit !== null)
}

export const searchCore: PaperSourceConnector = async (q, { fetch, signal, credentials }) => {
  const apiKey = credentials?.coreApiKey
  if (!apiKey) return []
  const query = q.query.trim()
  if (!query) return []
  let fullQuery = query
  if (q.yearFrom !== undefined) fullQuery += ` AND yearPublished>=${q.yearFrom}`
  if (q.yearTo !== undefined) fullQuery += ` AND yearPublished<=${q.yearTo}`
  const params = new URLSearchParams({ q: fullQuery, limit: String(q.limit) })
  const response = await fetch(`https://api.core.ac.uk/v3/search/works?${params.toString()}`, {
    headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    signal
  })
  if (!response.ok) {
    const hint = response.status === 429 ? ' (rate limited)' : ''
    throw new PaperSourceHttpError(response.status, `HTTP ${response.status}${hint}`)
  }
  return parseCoreSearch(await response.json())
    .filter((hit) => hit.year === undefined || inYearRange(hit.year, q.yearFrom, q.yearTo))
    .slice(0, q.limit)
}
