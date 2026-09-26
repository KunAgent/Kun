import type { PaperSourceConnector, PaperSourceHit } from './paper-search-types.js'
import { PaperSourceHttpError } from './paper-search-api-sources.js'
import { cleanText, inYearRange, normalizeDoi } from './paper-search-text.js'

/**
 * HAL open archive (`api.archives-ouvertes.fr`). Broad French/EU deposit
 * covering preprints, journal articles and theses.
 */

type HalDoc = {
  halId_s?: string
  title_s?: string[]
  authFullName_s?: string[]
  abstract_s?: string[]
  producedDateY_i?: number
  publicationDateY_i?: number
  doiId_s?: string
  uri_s?: string
  journalTitle_s?: string
  conferenceTitle_s?: string
  docType_s?: string
  fileMain_s?: string
}

export function mapHalDoc(doc: HalDoc): PaperSourceHit | null {
  const title = cleanText(doc.title_s?.[0])
  if (!title) return null
  return {
    title,
    authors: (doc.authFullName_s ?? []).map((name) => cleanText(name)).filter(Boolean),
    abstract: cleanText(doc.abstract_s?.[0]) || undefined,
    year: doc.publicationDateY_i ?? doc.producedDateY_i,
    venue: cleanText(doc.journalTitle_s ?? doc.conferenceTitle_s) || undefined,
    doi: normalizeDoi(doc.doiId_s),
    url: doc.uri_s ?? (doc.halId_s ? `https://hal.science/${doc.halId_s}` : undefined),
    pdfUrl: doc.fileMain_s && /^https?:\/\//.test(doc.fileMain_s) ? doc.fileMain_s : undefined
  }
}

export function parseHalSearch(body: unknown): PaperSourceHit[] {
  const docs = (body as { response?: { docs?: HalDoc[] } } | undefined)?.response?.docs ?? []
  return docs.map(mapHalDoc).filter((hit): hit is PaperSourceHit => hit !== null)
}

export const searchHal: PaperSourceConnector = async (q, { fetch, signal }) => {
  const query = q.query.trim()
  if (!query) return []
  const params = new URLSearchParams({
    q: query,
    fl: 'halId_s,title_s,authFullName_s,abstract_s,producedDateY_i,publicationDateY_i,doiId_s,uri_s,journalTitle_s,conferenceTitle_s,docType_s,fileMain_s',
    rows: String(q.limit),
    wt: 'json',
    sort: 'score desc'
  })
  const response = await fetch(`https://api.archives-ouvertes.fr/search/?${params.toString()}`, {
    headers: { accept: 'application/json' },
    signal
  })
  if (!response.ok) {
    const hint = response.status === 429 ? ' (rate limited)' : ''
    throw new PaperSourceHttpError(response.status, `HTTP ${response.status}${hint}`)
  }
  return parseHalSearch(await response.json())
    .filter((hit) => hit.year === undefined || inYearRange(hit.year, q.yearFrom, q.yearTo))
    .slice(0, q.limit)
}
