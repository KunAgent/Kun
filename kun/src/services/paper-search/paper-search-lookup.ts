import type {
  PaperSearchCredentials,
  PaperSearchFetch,
  PaperSourceHit
} from './paper-search-types.js'
import { PaperSourceHttpError } from './paper-search-api-sources.js'
import { cleanText, normalizeArxivId, normalizeDoi, yearOf } from './paper-search-text.js'

/**
 * Seed-paper lookups for `paper_citations` / `paper_details`. Semantic Scholar
 * is the primary index (it accepts DOI/arXiv/PMID/S2 ids and returns both
 * citation directions in one call); OpenAlex covers DOI seeds as a fallback.
 */

type S2Paper = {
  paperId?: string
  title?: string
  abstract?: string | null
  year?: number | null
  venue?: string | null
  url?: string
  citationCount?: number
  authors?: Array<{ name?: string }>
  externalIds?: { DOI?: string; ArXiv?: string; PubMed?: string; CorpusId?: number } | null
  openAccessPdf?: { url?: string } | null
  tldr?: { text?: string } | null
  fieldsOfStudy?: string[] | null
}

const S2_FIELDS =
  'title,abstract,year,venue,url,citationCount,authors,externalIds,openAccessPdf,tldr,fieldsOfStudy'

export function mapS2Paper(paper: S2Paper): PaperSourceHit | null {
  const title = cleanText(paper.title)
  if (!title) return null
  const arxivId = normalizeArxivId(paper.externalIds?.ArXiv)
  return {
    title,
    authors: (paper.authors ?? []).map((a) => cleanText(a.name)).filter(Boolean),
    abstract: paper.abstract ?? undefined,
    year: paper.year ?? undefined,
    venue: paper.venue || undefined,
    doi: normalizeDoi(paper.externalIds?.DOI),
    arxivId,
    url: paper.url,
    pdfUrl: paper.openAccessPdf?.url || (arxivId ? `https://arxiv.org/pdf/${arxivId}` : undefined),
    citations: paper.citationCount
  }
}

export type LookupContext = {
  fetch: PaperSearchFetch
  signal?: AbortSignal
  credentials?: PaperSearchCredentials
}

async function getJson<T>(
  ctx: LookupContext,
  url: string,
  headers: Record<string, string> = {}
): Promise<T> {
  const response = await ctx.fetch(url, {
    headers: { accept: 'application/json', ...headers },
    signal: ctx.signal
  })
  if (!response.ok) {
    const hint = response.status === 429 ? ' (rate limited)' : ''
    throw new PaperSourceHttpError(response.status, `HTTP ${response.status}${hint}`)
  }
  return (await response.json()) as T
}

/**
 * Map a user/model-supplied identifier to a Semantic Scholar path id.
 * Accepts DOI, arXiv id, PMID/PMCID, CorpusId, S2 paperId and URLs.
 */
export function s2PaperId(raw: string): string | undefined {
  const id = raw.trim()
  if (!id) return undefined
  const doi = normalizeDoi(id)
  if (doi) return `DOI:${doi}`
  const arxiv = normalizeArxivId(id)
  if (arxiv) return `ARXIV:${arxiv}`
  const corpus = id.match(/^corpus\s*id[:\s]*(\d+)$/i) ?? id.match(/^corpusid[:\s]*(\d+)$/i)
  if (corpus) return `CorpusId:${corpus[1]}`
  const pmcid = id.match(/^pmc(id)?:?\s*(PMC\d+|\d+)$/i)
  if (pmcid) return `PMCID:${pmcid[2].startsWith('PMC') ? pmcid[2] : `PMC${pmcid[2]}`}`
  const pmid = id.match(/^pmid:?\s*(\d+)$/i)
  if (pmid) return `PMID:${pmid[1]}`
  if (/^[0-9a-f]{40}$/i.test(id)) return id
  return undefined
}

type S2NeighborsResponse = {
  data?: Array<{ citedPaper?: S2Paper | null; citingPaper?: S2Paper | null }>
}

export type PaperCitationsResult = {
  seed?: PaperSourceHit
  hits: PaperSourceHit[]
  via: 'semantic_scholar' | 'openalex'
}

async function s2Neighbors(
  direction: 'references' | 'citations',
  paperId: string,
  limit: number,
  ctx: LookupContext
): Promise<PaperSourceHit[]> {
  const key = ctx.credentials?.semanticScholarApiKey
  const params = new URLSearchParams({ fields: S2_FIELDS, limit: String(Math.min(limit, 100)) })
  const body = await getJson<S2NeighborsResponse>(
    ctx,
    `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(paperId)}/${direction}?${params.toString()}`,
    key ? { 'x-api-key': key } : {}
  )
  return (body.data ?? [])
    .map((row) => (direction === 'references' ? row.citedPaper : row.citingPaper))
    .map((paper) => (paper ? mapS2Paper(paper) : null))
    .filter((hit): hit is PaperSourceHit => hit !== null)
}

type OpenAlexWork = {
  id?: string
  display_name?: string
  publication_year?: number
  doi?: string
  cited_by_count?: number
  abstract_inverted_index?: Record<string, number[]> | null
  authorships?: Array<{ author?: { display_name?: string } }>
  primary_location?: { landing_page_url?: string; pdf_url?: string; source?: { display_name?: string } | null } | null
  best_oa_location?: { pdf_url?: string } | null
  ids?: { openalex?: string }
  locations?: Array<{ landing_page_url?: string }>
  referenced_works?: string[]
  counts_by_year?: Array<{ year?: number; cited_by_count?: number }>
}

function openAlexAbstract(index: Record<string, number[]> | null | undefined): string | undefined {
  if (!index) return undefined
  const words: string[] = []
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words[position] = word
  }
  return words.filter(Boolean).join(' ').trim() || undefined
}

function mapOpenAlexWork(work: OpenAlexWork): PaperSourceHit | null {
  const title = cleanText(work.display_name)
  if (!title) return null
  const arxivUrl = (work.locations ?? [])
    .map((location) => location.landing_page_url ?? '')
    .find((url) => url.includes('arxiv.org/'))
  const doi = normalizeDoi(work.doi)
  return {
    title,
    authors: (work.authorships ?? []).map((a) => cleanText(a.author?.display_name)).filter(Boolean),
    abstract: openAlexAbstract(work.abstract_inverted_index),
    year: work.publication_year,
    venue: work.primary_location?.source?.display_name || undefined,
    doi: doi && !doi.startsWith('10.48550/') ? doi : undefined,
    arxivId:
      (arxivUrl ? normalizeArxivId(arxivUrl) : undefined) ??
      (doi?.startsWith('10.48550/arxiv.') ? normalizeArxivId(doi) : undefined),
    url: work.primary_location?.landing_page_url ?? work.ids?.openalex,
    pdfUrl: work.best_oa_location?.pdf_url ?? work.primary_location?.pdf_url ?? undefined,
    citations: work.cited_by_count
  }
}

function openAlexMailtoParams(ctx: LookupContext): string {
  const mailto = ctx.credentials?.openAlexMailto?.trim()
  return mailto ? `&mailto=${encodeURIComponent(mailto)}` : ''
}

async function openAlexWorkById(ctx: LookupContext, rawId: string): Promise<OpenAlexWork | null> {
  const doi = normalizeDoi(rawId)
  const arxiv = normalizeArxivId(rawId)
  const mailto = openAlexMailtoParams(ctx)
  if (doi) {
    const body = await getJson<{ results?: OpenAlexWork[] }>(
      ctx,
      `https://api.openalex.org/works?filter=doi:${encodeURIComponent(doi)}&per_page=1${mailto}`
    )
    return body.results?.[0] ?? null
  }
  if (arxiv) {
    const body = await getJson<{ results?: OpenAlexWork[] }>(
      ctx,
      `https://api.openalex.org/works?filter=locations.landing_page_url:${encodeURIComponent(
        `https://arxiv.org/abs/${arxiv}`
      )}&per_page=1${mailto}`
    )
    return body.results?.[0] ?? null
  }
  const s2ish = rawId.match(/^W\d+$/)
  if (s2ish) {
    const body = await getJson<OpenAlexWork>(ctx, `https://api.openalex.org/works/${rawId}?${mailto.slice(1)}`)
    return body.id ? body : null
  }
  return null
}

async function openAlexNeighbors(
  direction: 'references' | 'citations',
  seed: OpenAlexWork,
  limit: number,
  ctx: LookupContext
): Promise<PaperSourceHit[]> {
  const mailto = openAlexMailtoParams(ctx)
  if (direction === 'citations') {
    const body = await getJson<{ results?: OpenAlexWork[] }>(
      ctx,
      `https://api.openalex.org/works?filter=cites:${encodeURIComponent(seed.id ?? '')}&per_page=${Math.min(limit, 50)}${mailto}`
    )
    return (body.results ?? []).map(mapOpenAlexWork).filter((h): h is PaperSourceHit => h !== null)
  }
  const refs = (seed.referenced_works ?? []).slice(0, Math.min(limit, 50))
  if (!refs.length) return []
  const ids = refs.map((id) => id.replace('https://openalex.org/', '')).join('|')
  const body = await getJson<{ results?: OpenAlexWork[] }>(
    ctx,
    `https://api.openalex.org/works?filter=openalex_id:${encodeURIComponent(ids)}&per_page=${Math.min(limit, 50)}${mailto}`
  )
  return (body.results ?? []).map(mapOpenAlexWork).filter((h): h is PaperSourceHit => h !== null)
}

/**
 * Resolve references/citations around a seed id. Semantic Scholar first;
 * when S2 cannot resolve the id we fall back to OpenAlex for DOI/arXiv seeds.
 */
export async function fetchPaperCitationNeighbors(
  request: { id: string; direction: 'references' | 'citations'; limit?: number },
  ctx: LookupContext
): Promise<PaperCitationsResult> {
  const limit = Math.min(Math.max(request.limit ?? 25, 1), 100)
  const s2Id = s2PaperId(request.id)
  if (s2Id) {
    try {
      const hits = await s2Neighbors(request.direction, s2Id, limit, ctx)
      return { hits, via: 'semantic_scholar' }
    } catch (error) {
      if (error instanceof PaperSourceHttpError && error.status === 404) {
        // Fall through to OpenAlex below.
      } else throw error
    }
  }
  const seed = await openAlexWorkById(ctx, request.id)
  if (!seed?.id) {
    throw new PaperSourceHttpError(404, `Cannot resolve paper id "${request.id.slice(0, 80)}" for citations.`)
  }
  const hits = await openAlexNeighbors(request.direction, seed, limit, ctx)
  return { seed: mapOpenAlexWork(seed) ?? undefined, hits, via: 'openalex' }
}

/**
 * Per-year citation counts for the GUI detail pane (plan P5). Resolves the
 * seed through OpenAlex only — S2 does not expose a citation trend.
 */
export async function fetchOpenAlexCitationTrend(
  id: string,
  ctx: LookupContext
): Promise<Array<{ year: number; citations: number }> | undefined> {
  const work = await openAlexWorkById(ctx, id).catch(() => null)
  const counts = work?.counts_by_year
  if (!Array.isArray(counts) || !counts.length) return undefined
  return counts
    .filter(
      (row): row is { year: number; cited_by_count: number } =>
        typeof row.year === 'number' && typeof row.cited_by_count === 'number'
    )
    .map((row) => ({ year: row.year, citations: row.cited_by_count }))
    .sort((a, b) => a.year - b.year)
}

/**
 * Resolve full details for up to `ids.length` papers (S2 batch, then an
 * OpenAlex lookup for anything S2 missed).
 */
export async function fetchPaperDetails(
  ids: string[],
  ctx: LookupContext
): Promise<Array<{ id: string; hit?: PaperSourceHit; extra?: { tldr?: string; fieldsOfStudy?: string[] } }>> {
  const s2Ids = ids.map(s2PaperId)
  const results: Array<{ id: string; hit?: PaperSourceHit; extra?: { tldr?: string; fieldsOfStudy?: string[] } }> =
    ids.map((id) => ({ id }))
  const resolved = ids.map((id, i) => ({ index: i, id, s2Id: s2Ids[i] })).filter((row) => row.s2Id)
  for (const row of resolved) {
    try {
      const key = ctx.credentials?.semanticScholarApiKey
      const paper = await getJson<S2Paper>(
        ctx,
        `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(row.s2Id!)}?fields=${S2_FIELDS}`,
        key ? { 'x-api-key': key } : {}
      )
      const hit = mapS2Paper(paper)
      if (hit) {
        results[row.index] = {
          id: row.id,
          hit,
          extra: {
            tldr: paper.tldr?.text || undefined,
            fieldsOfStudy: paper.fieldsOfStudy ?? undefined
          }
        }
      }
    } catch {
      // Leave unresolved; OpenAlex fallback below may still cover DOIs.
    }
  }
  for (const [index, entry] of results.entries()) {
    if (entry.hit) continue
    try {
      const work = await openAlexWorkById(ctx, entry.id)
      const hit = work ? mapOpenAlexWork(work) : null
      if (hit) results[index] = { id: entry.id, hit }
    } catch {
      // Unresolved ids stay unresolved.
    }
  }
  return results
}
