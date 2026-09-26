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
  'europepmc',
  'openreview',
  'pubmed',
  'hal',
  'zenodo',
  'core',
  'biorxiv',
  'dblp'
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
  europepmc: 'Europe PMC',
  openreview: 'OpenReview',
  pubmed: 'PubMed',
  hal: 'HAL',
  zenodo: 'Zenodo',
  core: 'CORE',
  biorxiv: 'bioRxiv (Europe PMC)',
  dblp: 'DBLP'
}

/** Sources that stay hidden until the matching credential is configured. */
export const PAPER_SEARCH_KEY_GATED_SOURCES: readonly PaperSearchSource[] = ['core']

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
  /** True when the result came from the local result cache. */
  cached?: boolean
  /** True when consecutive rate limits auto-skipped the source this round. */
  degraded?: boolean
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

/** Optional per-source credentials; absent keys just lower rate limits. */
export type PaperSearchCredentials = {
  semanticScholarApiKey?: string
  coreApiKey?: string
  /** Polite-pool identifier, not a secret. */
  openAlexMailto?: string
  unpaywallEmail?: string
}

export type PaperSourceConnectorContext = {
  fetch: PaperSearchFetch
  signal?: AbortSignal
  credentials?: PaperSearchCredentials
}

export type PaperSourceConnector = (
  query: PaperSourceQuery,
  context: PaperSourceConnectorContext
) => Promise<PaperSourceHit[]>

// ---- Renderer-facing meta payloads (tool result `meta`, never model-side) ------

/**
 * Card-ready projection of a merged hit for `meta.paperSearch`. `id` is the
 * preferred import handle (arXiv id > papers.cool id > DOI).
 */
export type PaperSearchCardHit = {
  id: string
  title: string
  authors: string[]
  abstract?: string
  year?: number
  venue?: string
  doi?: string
  arxivId?: string
  coolId?: string
  url?: string
  pdfUrl?: string
  citations?: number
  sources: PaperSearchSource[]
}

export type PaperSearchResultMeta = {
  version: 1
  query: string
  /** Merged hit count before the card cap. */
  total: number
  papers: PaperSearchCardHit[]
  sources: PaperSearchSourceReport[]
}

export type PaperReportPriority = 'must' | 'should' | 'optional'

/**
 * One `paper_report` entry. `verified` means the id came from this turn's
 * `paper_search`/`paper_citations`/`paper_details` results; unverified ids
 * are kept visible instead of silently dropped.
 */
export type PaperListEntryMeta = {
  id: string
  title: string
  reason: string
  group?: string
  priority?: PaperReportPriority
  verified: boolean
  /** Enriched card fields when the id was verified against the seen store. */
  paper?: PaperSearchCardHit
}

export type PaperListMeta = {
  version: 1
  title?: string
  summary?: string
  papers: PaperListEntryMeta[]
}

/** `paper_details` sideband: one fully resolved record. */
export type PaperDetailsMeta = {
  version: 1
  paper: PaperSearchCardHit & {
    tldr?: string
    fieldsOfStudy?: string[]
    openAccess?: boolean
  }
}
