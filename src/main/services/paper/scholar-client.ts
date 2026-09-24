import { paperFetchText } from './paper-http'
import type { PaperFetchContext } from './arxiv-client'

/**
 * Semantic Scholar Graph API client: title search, paper metadata,
 * references/citations. Unauthenticated requests are rate-limited (~1 rps);
 * callers serialize through `enqueueScholarRequest`.
 */

const S2_API = 'https://api.semanticscholar.org/graph/v1'
const S2_FIELDS = 'title,abstract,year,venue,authors.name,externalIds,citationCount,openAccessPdf'

export type ScholarPaperMeta = {
  s2Id: string
  title: string
  authors: string[]
  year?: string
  venue?: string
  abstract?: string
  arxivId?: string
  doi?: string
  citationCount?: number
  pdfUrl?: string
}

type S2Paper = {
  paperId?: string
  title?: string
  abstract?: string | null
  year?: number | null
  venue?: string | null
  authors?: { name?: string }[]
  externalIds?: { ArXiv?: string; DOI?: string; [k: string]: unknown }
  citationCount?: number | null
  openAccessPdf?: { url?: string | null } | null
}

function toScholarMeta(paper: S2Paper): ScholarPaperMeta | null {
  if (!paper.paperId || !paper.title) return null
  return {
    s2Id: paper.paperId,
    title: paper.title,
    authors: (paper.authors ?? []).map((a) => a.name ?? '').filter(Boolean),
    year: paper.year ? String(paper.year) : undefined,
    venue: paper.venue || undefined,
    abstract: paper.abstract || undefined,
    arxivId: paper.externalIds?.ArXiv || undefined,
    doi: paper.externalIds?.DOI || undefined,
    citationCount: paper.citationCount ?? undefined,
    pdfUrl: paper.openAccessPdf?.url || undefined
  }
}

// Serialize S2 calls: the public API 429s aggressively on bursts.
let scholarQueue: Promise<void> = Promise.resolve()
const SCHOLAR_MIN_GAP_MS = 1100

async function enqueueScholarRequest<T>(fn: () => Promise<T>): Promise<T> {
  const run = scholarQueue.then(async () => {
    await new Promise((resolve) => setTimeout(resolve, SCHOLAR_MIN_GAP_MS))
    return fn()
  })
  scholarQueue = run.then(() => undefined, () => undefined)
  return run
}

export async function scholarSearchByTitle(
  query: string,
  options: PaperFetchContext & { limit?: number } = {}
): Promise<ScholarPaperMeta[]> {
  return enqueueScholarRequest(async () => {
    const url = `${S2_API}/paper/search?query=${encodeURIComponent(query)}&limit=${Math.min(options.limit ?? 5, 10)}&fields=${S2_FIELDS}`
    const raw = await paperFetchText(url, { ...options, timeoutMs: options.timeoutMs ?? 8000 })
    const data = JSON.parse(raw) as { data?: S2Paper[] }
    return (data.data ?? []).map(toScholarMeta).filter((m): m is ScholarPaperMeta => m !== null)
  })
}

export type ScholarReferenceEntry = {
  title?: string
  authors?: string[]
  year?: string
  venue?: string
  doi?: string
  arxivId?: string
}

function toReferenceEntry(paper: S2Paper): ScholarReferenceEntry | null {
  if (!paper.title) return null
  return {
    title: paper.title,
    authors: (paper.authors ?? []).map((a) => a.name ?? '').filter(Boolean),
    year: paper.year ? String(paper.year) : undefined,
    venue: paper.venue || undefined,
    doi: paper.externalIds?.DOI || undefined,
    arxivId: paper.externalIds?.ArXiv || undefined
  }
}

async function scholarPaperEdges(
  paperId: string,
  edge: 'references' | 'citations',
  options: PaperFetchContext & { limit?: number }
): Promise<ScholarReferenceEntry[]> {
  return enqueueScholarRequest(async () => {
    const fields = 'title,year,venue,authors.name,externalIds'
    const url = `${S2_API}/paper/${encodeURIComponent(paperId)}/${edge}?limit=${Math.min(options.limit ?? 100, 200)}&fields=${fields}`
    const raw = await paperFetchText(url, { ...options, timeoutMs: options.timeoutMs ?? 15_000 })
    const data = JSON.parse(raw) as { data?: { citedPaper?: S2Paper; citingPaper?: S2Paper }[] }
    const key = edge === 'references' ? 'citedPaper' : 'citingPaper'
    return (data.data ?? [])
      .map((row) => (row[key] ? toReferenceEntry(row[key]!) : null))
      .filter((m): m is ScholarReferenceEntry => m !== null)
  })
}

export function scholarFetchReferences(
  paperId: string,
  options: PaperFetchContext & { limit?: number } = {}
): Promise<ScholarReferenceEntry[]> {
  return scholarPaperEdges(paperId, 'references', options)
}

export function scholarFetchCitations(
  paperId: string,
  options: PaperFetchContext & { limit?: number } = {}
): Promise<ScholarReferenceEntry[]> {
  return scholarPaperEdges(paperId, 'citations', options)
}
