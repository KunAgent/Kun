import type {
  PaperSearchFetch,
  PaperSourceConnector,
  PaperSourceHit,
  PaperSourceQuery
} from './paper-search-types.js'
import {
  cleanText,
  decodeEntities,
  inYearRange,
  normalizeArxivId,
  normalizeDoi,
  yearOf
} from './paper-search-text.js'

/**
 * JSON/Atom API connectors: arXiv, OpenAlex, Semantic Scholar, Crossref and
 * Europe PMC. Each maps one response page into `PaperSourceHit`s; errors
 * propagate so the orchestrator can report them per source.
 */

export class PaperSourceHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'PaperSourceHttpError'
  }
}

async function getText(
  fetchImpl: PaperSearchFetch,
  url: string,
  signal: AbortSignal | undefined,
  headers: Record<string, string> = {}
): Promise<string> {
  const response = await fetchImpl(url, { headers, signal })
  if (!response.ok) {
    const hint = response.status === 429 ? ' (rate limited)' : ''
    throw new PaperSourceHttpError(response.status, `HTTP ${response.status}${hint}`)
  }
  return response.text()
}

async function getJson<T>(
  fetchImpl: PaperSearchFetch,
  url: string,
  signal: AbortSignal | undefined,
  headers: Record<string, string> = {}
): Promise<T> {
  const text = await getText(fetchImpl, url, signal, { accept: 'application/json', ...headers })
  return JSON.parse(text) as T
}

// ---- arXiv -------------------------------------------------------------------

function atomTag(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : undefined
}

export function parseArxivAtom(xml: string): PaperSourceHit[] {
  const hits: PaperSourceHit[] = []
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = match[1]
    const arxivId = normalizeArxivId(atomTag(entry, 'id'))
    const title = atomTag(entry, 'title')
    if (!arxivId || !title) continue
    const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)]
      .map((m) => decodeEntities(m[1]).trim())
    const pdf = entry.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"|<link[^>]*href="([^"]+)"[^>]*title="pdf"/)
    hits.push({
      title,
      authors,
      abstract: atomTag(entry, 'summary'),
      year: yearOf(atomTag(entry, 'published')),
      venue: atomTag(entry, 'arxiv:journal_ref'),
      doi: normalizeDoi(atomTag(entry, 'arxiv:doi')),
      arxivId,
      url: `https://arxiv.org/abs/${arxivId}`,
      pdfUrl: pdf ? (pdf[1] ?? pdf[2]) : `https://arxiv.org/pdf/${arxivId}`
    })
  }
  return hits
}

const ARXIV_STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'for', 'in', 'on', 'at', 'to', 'and', 'or', 'not',
  'with', 'via', 'by', 'is', 'are', 'be', 'as', 'from', 'using', 'based',
  'paper', 'papers', 'study', 'research', 'about', 'how', 'what', 'find',
  'search', 'review', 'survey'
])

/** Words ANDed across all fields; quoted phrases stay intact, stopwords dropped. */
export function arxivSearchQuery(query: string): string {
  const terms = query.match(/"[^"]+"|[^\s"]+/g) ?? []
  const clean = terms
    .map((term) => term.replace(/[():]/g, ' ').trim())
    .filter((term) => term.length > 0 && !/^(and|or|not)$/i.test(term))
  const phrases = clean.filter((term) => /\s/.test(term))
  const words = clean.filter((term) => !/\s/.test(term) && !ARXIV_STOPWORDS.has(term.toLowerCase()))
  return [...phrases, ...words]
    .slice(0, 12)
    .map((term) => `all:${term}`)
    .join(' AND ')
}

export const searchArxiv: PaperSourceConnector = async (q, { fetch, signal }) => {
  let search = arxivSearchQuery(q.query)
  if (!search) return []
  if (q.yearFrom !== undefined || q.yearTo !== undefined) {
    const from = `${q.yearFrom ?? 1991}01010000`
    const to = `${q.yearTo ?? 2100}12312359`
    search = `(${search}) AND submittedDate:[${from} TO ${to}]`
  }
  const params = new URLSearchParams({
    search_query: search,
    start: '0',
    max_results: String(q.limit),
    sortBy: 'relevance'
  })
  const xml = await getText(fetch, `https://export.arxiv.org/api/query?${params.toString()}`, signal)
  return parseArxivAtom(xml)
}

// ---- OpenAlex ----------------------------------------------------------------

type OpenAlexWork = {
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
}

export function openAlexAbstract(index: Record<string, number[]> | null | undefined): string | undefined {
  if (!index) return undefined
  const words: string[] = []
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words[position] = word
  }
  const text = words.filter(Boolean).join(' ').trim()
  return text || undefined
}

export function mapOpenAlexWork(work: OpenAlexWork): PaperSourceHit | null {
  const title = cleanText(work.display_name)
  if (!title) return null
  const arxivUrl = (work.locations ?? [])
    .map((location) => location.landing_page_url ?? '')
    .find((url) => url.includes('arxiv.org/'))
  const arxivId = arxivUrl ? normalizeArxivId(arxivUrl) : undefined
  const doi = normalizeDoi(work.doi)
  return {
    title,
    authors: (work.authorships ?? []).map((a) => a.author?.display_name ?? '').filter(Boolean),
    abstract: openAlexAbstract(work.abstract_inverted_index),
    year: work.publication_year,
    venue: work.primary_location?.source?.display_name || undefined,
    doi: doi && !doi.startsWith('10.48550/') ? doi : undefined,
    arxivId: arxivId ?? (doi?.startsWith('10.48550/arxiv.') ? normalizeArxivId(doi) : undefined),
    url: work.primary_location?.landing_page_url ?? work.ids?.openalex,
    pdfUrl: work.best_oa_location?.pdf_url ?? work.primary_location?.pdf_url ?? undefined,
    citations: work.cited_by_count
  }
}

export const searchOpenAlex: PaperSourceConnector = async (q, { fetch, signal, credentials }) => {
  const filters = [`title_and_abstract.search:${q.query.replace(/[,|:]/g, ' ')}`]
  if (q.yearFrom !== undefined) filters.push(`from_publication_date:${q.yearFrom}-01-01`)
  if (q.yearTo !== undefined) filters.push(`to_publication_date:${q.yearTo}-12-31`)
  const params = new URLSearchParams({
    filter: filters.join(','),
    per_page: String(q.limit),
    select: 'display_name,publication_year,doi,cited_by_count,abstract_inverted_index,authorships,primary_location,best_oa_location,ids,locations'
  })
  const mailto = credentials?.openAlexMailto?.trim()
  if (mailto) params.set('mailto', mailto)
  const body = await getJson<{ results?: OpenAlexWork[] }>(fetch, `https://api.openalex.org/works?${params.toString()}`, signal)
  return (body.results ?? []).map(mapOpenAlexWork).filter((hit): hit is PaperSourceHit => hit !== null)
}

// ---- Semantic Scholar --------------------------------------------------------

type S2Paper = {
  title?: string
  abstract?: string | null
  year?: number | null
  venue?: string | null
  url?: string
  citationCount?: number
  authors?: Array<{ name?: string }>
  externalIds?: { DOI?: string; ArXiv?: string } | null
  openAccessPdf?: { url?: string } | null
}

export const searchSemanticScholar: PaperSourceConnector = async (q, { fetch, signal, credentials }) => {
  const params = new URLSearchParams({
    query: q.query,
    limit: String(q.limit),
    fields: 'title,abstract,year,venue,url,citationCount,authors,externalIds,openAccessPdf'
  })
  if (q.yearFrom !== undefined || q.yearTo !== undefined) {
    params.set('year', `${q.yearFrom ?? ''}-${q.yearTo ?? ''}`)
  }
  const apiKey = credentials?.semanticScholarApiKey
  const headers: Record<string, string> = apiKey ? { 'x-api-key': apiKey } : {}
  const body = await getJson<{ data?: S2Paper[] }>(
    fetch,
    `https://api.semanticscholar.org/graph/v1/paper/search?${params.toString()}`,
    signal,
    headers
  )
  return (body.data ?? []).flatMap((paper): PaperSourceHit[] => {
    const title = cleanText(paper.title)
    if (!title) return []
    const arxivId = normalizeArxivId(paper.externalIds?.ArXiv)
    return [{
      title,
      authors: (paper.authors ?? []).map((a) => a.name ?? '').filter(Boolean),
      abstract: paper.abstract ?? undefined,
      year: paper.year ?? undefined,
      venue: paper.venue || undefined,
      doi: normalizeDoi(paper.externalIds?.DOI),
      arxivId,
      url: paper.url,
      pdfUrl: paper.openAccessPdf?.url || (arxivId ? `https://arxiv.org/pdf/${arxivId}` : undefined),
      citations: paper.citationCount
    }]
  })
}

// ---- Crossref ----------------------------------------------------------------

type CrossrefItem = {
  DOI?: string
  title?: string[]
  author?: Array<{ given?: string; family?: string; name?: string }>
  issued?: { 'date-parts'?: number[][] }
  'container-title'?: string[]
  abstract?: string
  'is-referenced-by-count'?: number
  URL?: string
}

export const searchCrossref: PaperSourceConnector = async (q, { fetch, signal, credentials }) => {
  const params = new URLSearchParams({
    'query.bibliographic': q.query,
    rows: String(q.limit),
    select: 'DOI,title,author,issued,container-title,abstract,is-referenced-by-count,URL'
  })
  const mailto = credentials?.openAlexMailto?.trim()
  if (mailto) params.set('mailto', mailto)
  const filters: string[] = []
  if (q.yearFrom !== undefined) filters.push(`from-pub-date:${q.yearFrom}`)
  if (q.yearTo !== undefined) filters.push(`until-pub-date:${q.yearTo}`)
  if (filters.length) params.set('filter', filters.join(','))
  const body = await getJson<{ message?: { items?: CrossrefItem[] } }>(
    fetch,
    `https://api.crossref.org/works?${params.toString()}`,
    signal
  )
  return (body.message?.items ?? []).flatMap((item): PaperSourceHit[] => {
    const title = cleanText(item.title?.[0])
    if (!title) return []
    return [{
      title,
      authors: (item.author ?? [])
        .map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(' '))
        .filter(Boolean),
      abstract: cleanText(item.abstract).replace(/^abstract\s+/i, '') || undefined,
      year: item.issued?.['date-parts']?.[0]?.[0],
      venue: item['container-title']?.[0] || undefined,
      doi: normalizeDoi(item.DOI),
      url: item.URL,
      citations: item['is-referenced-by-count']
    }]
  })
}

// ---- Europe PMC --------------------------------------------------------------

type EuropePmcResult = {
  title?: string
  authorString?: string
  pubYear?: string
  doi?: string
  abstractText?: string
  journalTitle?: string
  journalInfo?: { journal?: { title?: string } }
  citedByCount?: number
  pmid?: string
  pmcid?: string
}

export function mapEuropePmcResult(item: EuropePmcResult): PaperSourceHit | null {
  const title = cleanText(item.title).replace(/\.$/, '')
  if (!title) return null
  return {
    title,
    authors: (item.authorString ?? '').replace(/\.$/, '').split(/,\s*/).filter(Boolean),
    abstract: cleanText(item.abstractText) || undefined,
    year: yearOf(item.pubYear),
    venue: item.journalInfo?.journal?.title ?? item.journalTitle,
    doi: normalizeDoi(item.doi),
    url: item.pmid
      ? `https://europepmc.org/article/MED/${item.pmid}`
      : item.pmcid ? `https://europepmc.org/article/PMC/${item.pmcid}` : undefined,
    citations: item.citedByCount
  }
}

async function searchEuropePmcQuery(
  query: string,
  q: PaperSourceQuery,
  { fetch, signal }: { fetch: PaperSearchFetch; signal?: AbortSignal }
): Promise<PaperSourceHit[]> {
  let fullQuery = query
  if (q.yearFrom !== undefined || q.yearTo !== undefined) {
    fullQuery = `(${fullQuery}) AND PUB_YEAR:[${q.yearFrom ?? 1800} TO ${q.yearTo ?? 2100}]`
  }
  const params = new URLSearchParams({
    query: fullQuery,
    format: 'json',
    resultType: 'core',
    pageSize: String(q.limit)
  })
  const body = await getJson<{ resultList?: { result?: EuropePmcResult[] } }>(
    fetch,
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params.toString()}`,
    signal
  )
  return (body.resultList?.result ?? [])
    .map(mapEuropePmcResult)
    .filter((hit): hit is PaperSourceHit => hit !== null)
    .filter((hit) => hit.year === undefined || inYearRange(hit.year, q.yearFrom, q.yearTo))
}

export const searchEuropePmc: PaperSourceConnector = async (q, context) =>
  searchEuropePmcQuery(q.query, q, context)

/**
 * bioRxiv/medRxiv preprints are indexed by Europe PMC under `SRC:PPR`.
 * `PREPRINT_SRC` terms keep the query scoped to those two servers.
 */
export const searchBiorxiv: PaperSourceConnector = async (q, context) =>
  searchEuropePmcQuery(`(${q.query}) AND SRC:PPR`, q, context)
