import type { PaperSourceConnector, PaperSourceHit } from './paper-search-types.js'
import { PaperSourceHttpError } from './paper-search-api-sources.js'
import { cleanText, inYearRange, normalizeArxivId, normalizeDoi, yearOf } from './paper-search-text.js'

/**
 * OpenReview API v2 term search. Covers ICLR/NeurIPS/ICML submissions and
 * accepted papers with venue labels such as "ICLR.cc/2025/Conference".
 */

type OpenReviewNote = {
  id?: string
  forum?: string
  cdate?: number
  pdate?: number
  tcdate?: number
  content?: Record<string, { value?: unknown } | undefined>
}

function contentString(note: OpenReviewNote, key: string): string | undefined {
  const value = note.content?.[key]?.value
  return typeof value === 'string' ? cleanText(value) || undefined : undefined
}

function contentList(note: OpenReviewNote, key: string): string[] {
  const value = note.content?.[key]?.value
  return Array.isArray(value) ? value.map((v) => cleanText(String(v))).filter(Boolean) : []
}

export function mapOpenReviewNote(note: OpenReviewNote): PaperSourceHit | null {
  const title = contentString(note, 'title')
  if (!title || !note.id) return null
  const venueRaw = contentString(note, 'venue')
  // Venue strings read like "ICLR.cc/2025/Conference Poster"; keep a compact label.
  const venue = venueRaw?.replace(/\.cc/g, '').replace(/\/Conference/g, '').replace(/\s+/g, ' ').trim()
  const yearMs = note.pdate ?? note.cdate ?? note.tcdate
  return {
    title,
    authors: contentList(note, 'authors'),
    abstract: contentString(note, 'abstract'),
    year: yearMs ? yearOf(new Date(yearMs).toISOString().slice(0, 10)) : undefined,
    venue: venue || undefined,
    doi: normalizeDoi(contentString(note, 'doi')),
    arxivId: normalizeArxivId(contentString(note, 'arxiv')),
    url: `https://openreview.net/forum?id=${note.forum ?? note.id}`,
    pdfUrl: `https://openreview.net/pdf?id=${note.forum ?? note.id}`
  }
}

export function parseOpenReviewSearch(body: unknown): PaperSourceHit[] {
  const notes = (body as { notes?: OpenReviewNote[] } | undefined)?.notes ?? []
  return notes.map(mapOpenReviewNote).filter((hit): hit is PaperSourceHit => hit !== null)
}

export const searchOpenReview: PaperSourceConnector = async (q, { fetch, signal }) => {
  const params = new URLSearchParams({
    term: q.query,
    limit: String(Math.min(q.limit, 25)),
    content: 'all',
    source: 'all'
  })
  const response = await fetch(`https://api2.openreview.net/notes/search?${params.toString()}`, {
    headers: { accept: 'application/json' },
    signal
  })
  if (!response.ok) {
    const hint = response.status === 429 ? ' (rate limited)' : ''
    throw new PaperSourceHttpError(response.status, `HTTP ${response.status}${hint}`)
  }
  const body = (await response.json()) as unknown
  return parseOpenReviewSearch(body)
    .filter((hit) => inYearRange(hit.year, q.yearFrom, q.yearTo) || hit.year === undefined)
    .slice(0, q.limit)
}
