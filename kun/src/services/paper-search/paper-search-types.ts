/**
 * Multi-source scholarly search contract shared by the `paper_search` agent
 * tool and the GUI paper-search page. Every connector maps its API into
 * `PaperSearchHit`; the orchestrator merges duplicates across sources.
 */

export const PAPER_SEARCH_SOURCES = [
  'arxiv',
  'openalex',
  'semantic_scholar',
  'venues',
  'paperscool',
  'crossref',
  'europepmc'
] as const

export type PaperSearchSource = (typeof PAPER_SEARCH_SOURCES)[number]

/** Broad, free, CS-leaning default set; the rest are opt-in. */
export const DEFAULT_PAPER_SEARCH_SOURCES: readonly PaperSearchSource[] = [
  'arxiv',
  'openalex',
  'semantic_scholar',
  'venues'
]

export const PAPER_SEARCH_SOURCE_LABELS: Record<PaperSearchSource, string> = {
  arxiv: 'arXiv',
  openalex: 'OpenAlex',
  semantic_scholar: 'Semantic Scholar',
  venues: 'Conferences (papers.cool)',
  paperscool: 'papers.cool arXiv',
  crossref: 'Crossref',
  europepmc: 'Europe PMC'
}

export type PaperSearchHit = {
  /** Stable merge key: `doi:<doi>`, `arxiv:<id>`, `cool:<id>` or `title:<key>`. */
  key: string
  title: string
  authors: string[]
  abstract?: string
  year?: number
  venue?: string
  doi?: string
  arxivId?: string
  /** papers.cool venue row id (e.g. `abc@OpenReview`), importable as-is. */
  coolId?: string
  url?: string
  pdfUrl?: string
  citations?: number
  /** Every source that returned this paper, best rank first. */
  sources: PaperSearchSource[]
  /** Reciprocal-rank-fusion score across sources (higher is better). */
  score: number
}

export type PaperSearchRequest = {
  query: string
  sources?: readonly PaperSearchSource[]
  /** Per-source result cap (1-25). */
  limit?: number
  yearFrom?: number
  yearTo?: number
}

export type PaperSearchSourceReport = {
  source: PaperSearchSource
  count: number
  ms: number
  error?: string
}

export type PaperSearchResponse = {
  query: string
  hits: PaperSearchHit[]
  sources: PaperSearchSourceReport[]
}

/** Per-source connector input after normalization. */
export type PaperSourceQuery = {
  query: string
  limit: number
  yearFrom?: number
  yearTo?: number
}

/** Connector output before merging: `key`, `sources` and `score` are filled later. */
export type PaperSourceHit = Omit<PaperSearchHit, 'key' | 'sources' | 'score'>

export type PaperSearchFetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>

export type PaperSourceConnector = (
  query: PaperSourceQuery,
  context: { fetch: PaperSearchFetch; signal?: AbortSignal; semanticScholarApiKey?: string }
) => Promise<PaperSourceHit[]>
