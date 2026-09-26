import {
  DEFAULT_PAPER_SEARCH_SOURCES,
  PAPER_SEARCH_SOURCES,
  PAPER_SEARCH_SOURCE_LABELS,
  type PaperSearchFetch,
  type PaperSearchHit,
  type PaperSearchRequest,
  type PaperSearchResponse,
  type PaperSearchSource,
  type PaperSearchSourceReport,
  type PaperSourceConnector,
  type PaperSourceHit,
  type PaperSourceQuery
} from './paper-search-types.js'
import {
  PaperSourceHttpError,
  searchArxiv,
  searchCrossref,
  searchEuropePmc,
  searchOpenAlex,
  searchSemanticScholar
} from './paper-search-api-sources.js'
import { searchCoolArxiv, searchCoolVenues } from './paper-search-cool-sources.js'
import { titleKey } from './paper-search-text.js'

export * from './paper-search-types.js'

const CONNECTORS: Record<PaperSearchSource, PaperSourceConnector> = {
  arxiv: searchArxiv,
  openalex: searchOpenAlex,
  semantic_scholar: searchSemanticScholar,
  venues: searchCoolVenues,
  paperscool: searchCoolArxiv,
  crossref: searchCrossref,
  europepmc: searchEuropePmc
}

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 25
const SOURCE_TIMEOUT_MS = 20_000
const RATE_LIMIT_RETRY_MS = 1_500
// Reciprocal rank fusion constant; 60 is the usual choice from the RRF paper.
const RRF_K = 60

export type PaperSearchOptions = {
  fetch?: PaperSearchFetch
  signal?: AbortSignal
  semanticScholarApiKey?: string
  userAgent?: string
  timeoutMs?: number
  /** Test seam for the retry delay. */
  sleep?: (ms: number) => Promise<void>
}

export function normalizePaperSearchSources(raw: readonly string[] | undefined): PaperSearchSource[] {
  const valid = (raw ?? []).filter((value): value is PaperSearchSource =>
    (PAPER_SEARCH_SOURCES as readonly string[]).includes(value)
  )
  return valid.length ? [...new Set(valid)] : [...DEFAULT_PAPER_SEARCH_SOURCES]
}

function normalizeYear(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 1800 && value < 2200 ? value : undefined
}

function withUserAgent(fetchImpl: PaperSearchFetch, userAgent: string): PaperSearchFetch {
  return (url, init) => fetchImpl(url, { ...init, headers: { 'user-agent': userAgent, ...init?.headers } })
}

async function runSource(
  source: PaperSearchSource,
  query: PaperSourceQuery,
  options: Required<Pick<PaperSearchOptions, 'fetch' | 'timeoutMs' | 'sleep'>> & PaperSearchOptions
): Promise<{ report: PaperSearchSourceReport; hits: PaperSourceHit[] }> {
  const started = Date.now()
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, options.timeoutMs)
  const context = {
    fetch: options.fetch,
    signal: controller.signal,
    semanticScholarApiKey: options.semanticScholarApiKey
  }
  try {
    let hits: PaperSourceHit[]
    try {
      hits = await CONNECTORS[source](query, context)
    } catch (error) {
      // Keyless Semantic Scholar shares a global rate limit; one late retry
      // recovers most bursts without stalling the other sources.
      if (!(error instanceof PaperSourceHttpError && error.status === 429) || controller.signal.aborted) throw error
      await options.sleep(RATE_LIMIT_RETRY_MS)
      hits = await CONNECTORS[source](query, context)
    }
    return { report: { source, count: hits.length, ms: Date.now() - started }, hits }
  } catch (error) {
    const message = controller.signal.aborted && !options.signal?.aborted
      ? `timed out after ${Math.round(options.timeoutMs / 1000)}s`
      : error instanceof Error ? error.message : String(error)
    return { report: { source, count: 0, ms: Date.now() - started, error: message }, hits: [] }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}

function mergeKey(hit: Pick<PaperSearchHit, 'doi' | 'arxivId' | 'coolId' | 'title'>): string {
  if (hit.doi) return `doi:${hit.doi}`
  if (hit.arxivId) return `arxiv:${hit.arxivId}`
  if (hit.coolId) return `cool:${hit.coolId}`
  return `title:${titleKey(hit.title)}`
}

function mergeInto(target: PaperSearchHit, hit: PaperSourceHit): void {
  target.doi ??= hit.doi
  target.arxivId ??= hit.arxivId
  target.coolId ??= hit.coolId
  target.year ??= hit.year
  target.venue ??= hit.venue
  target.url ??= hit.url
  target.pdfUrl ??= hit.pdfUrl
  if (!target.authors.length) target.authors = hit.authors
  if ((hit.abstract?.length ?? 0) > (target.abstract?.length ?? 0)) target.abstract = hit.abstract
  if (hit.citations !== undefined) target.citations = Math.max(target.citations ?? 0, hit.citations)
}

/**
 * Merge per-source ranked lists: duplicates collapse on DOI, arXiv id,
 * papers.cool id or normalized title, and the fused score rewards papers
 * that several sources rank highly.
 */
export function mergePaperSearchResults(
  lists: Array<{ source: PaperSearchSource; hits: PaperSourceHit[] }>
): PaperSearchHit[] {
  const merged: PaperSearchHit[] = []
  const index = new Map<string, PaperSearchHit>()
  const lookupKeys = (hit: PaperSourceHit): string[] => [
    ...(hit.doi ? [`doi:${hit.doi}`] : []),
    ...(hit.arxivId ? [`arxiv:${hit.arxivId}`] : []),
    ...(hit.coolId ? [`cool:${hit.coolId}`] : []),
    `title:${titleKey(hit.title)}`
  ]
  for (const { source, hits } of lists) {
    hits.forEach((hit, rank) => {
      const keys = lookupKeys(hit)
      let target = keys.map((key) => index.get(key)).find(Boolean)
      if (!target) {
        target = { ...hit, authors: [...hit.authors], key: '', sources: [], score: 0 }
        merged.push(target)
      } else {
        mergeInto(target, hit)
      }
      if (!target.sources.includes(source)) {
        target.sources.push(source)
        target.score += 1 / (RRF_K + rank + 1)
      }
      for (const key of lookupKeys(target)) index.set(key, target)
    })
  }
  for (const hit of merged) hit.key = mergeKey(hit)
  return merged.sort((a, b) => b.score - a.score || (b.citations ?? 0) - (a.citations ?? 0))
}

export async function runPaperSearch(
  request: PaperSearchRequest,
  options: PaperSearchOptions = {}
): Promise<PaperSearchResponse> {
  const query = request.query.replace(/\s+/g, ' ').trim()
  const sources = normalizePaperSearchSources(request.sources)
  if (!query) return { query, hits: [], sources: [] }
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(request.limit ?? DEFAULT_LIMIT)))
  let yearFrom = normalizeYear(request.yearFrom)
  let yearTo = normalizeYear(request.yearTo)
  if (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo) [yearFrom, yearTo] = [yearTo, yearFrom]
  const baseFetch = options.fetch ?? ((url, init) => fetch(url, init))
  const runOptions = {
    ...options,
    fetch: options.userAgent ? withUserAgent(baseFetch, options.userAgent) : baseFetch,
    timeoutMs: options.timeoutMs ?? SOURCE_TIMEOUT_MS,
    sleep: options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  }
  const results = await Promise.all(
    sources.map((source) => runSource(source, { query, limit, yearFrom, yearTo }, runOptions))
  )
  return {
    query,
    hits: mergePaperSearchResults(results.map((result, i) => ({ source: sources[i], hits: result.hits }))),
    sources: results.map((result) => result.report)
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

/** Compact, citation-friendly listing for model context. */
export function formatPaperSearchForModel(
  response: PaperSearchResponse,
  options: { maxHits?: number; abstractChars?: number } = {}
): string {
  const maxHits = options.maxHits ?? 30
  const abstractChars = options.abstractChars ?? 360
  const lines: string[] = [`Query: ${response.query}`]
  const status = response.sources
    .map((report) => `${PAPER_SEARCH_SOURCE_LABELS[report.source]} ${report.error ? `failed (${report.error})` : report.count}`)
    .join('; ')
  lines.push(`Sources: ${status}`)
  const hits = response.hits.slice(0, maxHits)
  if (!hits.length) {
    lines.push('No papers found. Try broader or alternative English keywords, fewer terms, or other sources.')
    return lines.join('\n')
  }
  lines.push(`Showing ${hits.length} of ${response.hits.length} merged results (best first).`, '')
  hits.forEach((hit, i) => {
    const ids = [
      hit.arxivId ? `arXiv:${hit.arxivId}` : '',
      hit.doi ? `doi:${hit.doi}` : '',
      hit.coolId && !hit.arxivId && !hit.doi ? `cool:${hit.coolId}` : ''
    ].filter(Boolean).join(' ')
    const authors = hit.authors.length > 4 ? `${hit.authors.slice(0, 3).join(', ')} et al.` : hit.authors.join(', ')
    const meta = [
      hit.year ? String(hit.year) : '',
      hit.venue ?? '',
      hit.citations !== undefined ? `${hit.citations} citations` : '',
      `via ${hit.sources.map((s) => PAPER_SEARCH_SOURCE_LABELS[s]).join(', ')}`
    ].filter(Boolean).join(' | ')
    lines.push(`[${i + 1}] ${hit.title}`)
    if (authors) lines.push(`    ${authors}`)
    lines.push(`    ${meta}${ids ? ` | ${ids}` : ''}`)
    if (hit.abstract) lines.push(`    ${truncate(hit.abstract, abstractChars)}`)
  })
  return lines.join('\n')
}
