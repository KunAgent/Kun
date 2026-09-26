import type { PaperSourceConnector, PaperSourceHit } from './paper-search-types.js'
import { PaperSourceHttpError } from './paper-search-api-sources.js'
import { cleanText, inYearRange, normalizeDoi, yearOf } from './paper-search-text.js'

/**
 * Zenodo records API. Covers preprints, datasets and reports; only
 * publication-like records are mapped into hits.
 */

type ZenodoRecord = {
  id?: number
  metadata?: {
    title?: string
    creators?: Array<{ name?: string }>
    description?: string
    publication_date?: string
    doi?: string
    resource_type?: { type?: string; title?: string }
    journal?: { title?: string }
  }
  links?: { self_html?: string; pdf?: string }
  files?: Array<{ key?: string; links?: { self?: string } }>
}

const PUBLICATION_TYPES = new Set(['publication', 'preprint', 'report', 'workingpaper', 'article'])

export function mapZenodoRecord(record: ZenodoRecord): PaperSourceHit | null {
  const meta = record.metadata
  const title = cleanText(meta?.title)
  if (!title || record.id === undefined) return null
  const type = meta?.resource_type?.type ?? 'publication'
  if (!PUBLICATION_TYPES.has(type)) return null
  const pdfFile = record.files?.find((file) => file.key?.toLowerCase().endsWith('.pdf'))
  return {
    title,
    authors: (meta?.creators ?? []).map((c) => cleanText(c.name)).filter(Boolean),
    abstract: cleanText(meta?.description) || undefined,
    year: yearOf(meta?.publication_date),
    venue: cleanText(meta?.journal?.title) || 'Zenodo',
    doi: normalizeDoi(meta?.doi),
    url: record.links?.self_html ?? `https://zenodo.org/records/${record.id}`,
    pdfUrl: record.links?.pdf ?? pdfFile?.links?.self
  }
}

export function parseZenodoSearch(body: unknown): PaperSourceHit[] {
  const hits = (body as { hits?: { hits?: ZenodoRecord[] } } | undefined)?.hits?.hits ?? []
  return hits.map(mapZenodoRecord).filter((hit): hit is PaperSourceHit => hit !== null)
}

export const searchZenodo: PaperSourceConnector = async (q, { fetch, signal }) => {
  const query = q.query.trim()
  if (!query) return []
  let fullQuery = `(${query}) AND resource_type.type:publication`
  if (q.yearFrom !== undefined || q.yearTo !== undefined) {
    fullQuery += ` AND publication_date:[${q.yearFrom ?? 1800}-01-01 TO ${q.yearTo ?? 2100}-12-31]`
  }
  const params = new URLSearchParams({
    q: fullQuery,
    size: String(q.limit),
    sort: 'bestmatch'
  })
  const response = await fetch(`https://zenodo.org/api/records?${params.toString()}`, {
    headers: { accept: 'application/json' },
    signal
  })
  if (!response.ok) {
    const hint = response.status === 429 ? ' (rate limited)' : ''
    throw new PaperSourceHttpError(response.status, `HTTP ${response.status}${hint}`)
  }
  return parseZenodoSearch(await response.json())
    .filter((hit) => hit.year === undefined || inYearRange(hit.year, q.yearFrom, q.yearTo))
    .slice(0, q.limit)
}
