import type { PaperSearchCredentials, PaperSearchFetch } from './paper-search-types.js'
import { PaperSourceHttpError } from './paper-search-api-sources.js'
import { normalizeArxivId, normalizeDoi } from './paper-search-text.js'

/**
 * Open-access PDF resolution (P3). Given a paper's identifiers we build an
 * ordered list of candidate download URLs:
 *
 *   1. the search-hit `pdfUrl` itself,
 *   2. the matching arXiv version (via OpenAlex location lookup on the DOI),
 *   3. Unpaywall `best_oa_location.url_for_pdf` (needs `unpaywallEmail`),
 *   4. Europe PMC `fullTextPdf` when a PMCID exists,
 *   5. CORE `downloadUrl` (needs `coreApiKey`).
 *
 * Callers verify `%PDF-` magic and page-1 title similarity themselves.
 */

export type OaPdfCandidate = {
  url: string
  via: 'direct' | 'arxiv' | 'unpaywall' | 'europepmc' | 'core'
}

export type OaResolveInput = {
  doi?: string
  arxivId?: string
  pdfUrl?: string
  /** europepmc.org article URL or bare PMID. */
  pmid?: string
  pmcid?: string
}

export type OaResolveContext = {
  fetch: PaperSearchFetch
  signal?: AbortSignal
  credentials?: PaperSearchCredentials
}

async function getJson<T>(ctx: OaResolveContext, url: string, headers: Record<string, string> = {}): Promise<T> {
  const response = await ctx.fetch(url, { headers: { accept: 'application/json', ...headers }, signal: ctx.signal })
  if (!response.ok) throw new PaperSourceHttpError(response.status, `HTTP ${response.status}`)
  return (await response.json()) as T
}

/** Find an arXiv twin of a DOI-identified paper through OpenAlex locations. */
async function arxivIdForDoi(doi: string, ctx: OaResolveContext): Promise<string | undefined> {
  const mailto = ctx.credentials?.openAlexMailto?.trim()
  const body = await getJson<{ results?: Array<{ locations?: Array<{ landing_page_url?: string }> }> }>(
    ctx,
    `https://api.openalex.org/works?filter=doi:${encodeURIComponent(doi)}&per_page=1&select=locations${mailto ? `&mailto=${encodeURIComponent(mailto)}` : ''}`
  )
  const urls = body.results?.[0]?.locations?.map((l) => l.landing_page_url ?? '') ?? []
  for (const url of urls) {
    const id = normalizeArxivId(url)
    if (id) return id
  }
  return undefined
}

type UnpaywallLocation = { url_for_pdf?: string | null; url?: string | null; host_type?: string }

async function unpaywallPdfs(doi: string, ctx: OaResolveContext): Promise<string[]> {
  const email = ctx.credentials?.unpaywallEmail?.trim()
  if (!email) return []
  const body = await getJson<{
    is_oa?: boolean
    best_oa_location?: UnpaywallLocation | null
    oa_locations?: UnpaywallLocation[]
  }>(ctx, `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`)
  if (body.is_oa === false) return []
  const urls = [body.best_oa_location, ...(body.oa_locations ?? [])]
    .map((loc) => loc?.url_for_pdf ?? undefined)
    .filter((url): url is string => typeof url === 'string' && /^https:\/\//.test(url))
  return [...new Set(urls)]
}

async function europePmcPdf(input: OaResolveInput, ctx: OaResolveContext): Promise<string | undefined> {
  let pmcid = input.pmcid?.replace(/^PMC/i, '')
  if (!pmcid && (input.doi || input.pmid)) {
    const term = input.pmid ? `EXT_ID:${input.pmid} AND SRC:MED` : `DOI:"${input.doi}"`
    const body = await getJson<{ resultList?: { result?: Array<{ pmcid?: string; isOpenAccess?: string }> } }>(
      ctx,
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(term)}&format=json&pageSize=1&resultType=core`
    )
    const hit = body.resultList?.result?.[0]
    if (hit?.isOpenAccess !== 'Y') return undefined
    pmcid = hit.pmcid?.replace(/^PMC/i, '')
  }
  if (!pmcid) return undefined
  return `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC${pmcid}/fullTextPdf`
}

async function corePdf(doi: string, ctx: OaResolveContext): Promise<string | undefined> {
  const key = ctx.credentials?.coreApiKey?.trim()
  if (!key) return undefined
  const body = await getJson<{ results?: Array<{ downloadUrl?: string }> }>(
    ctx,
    `https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(`doi:"${doi}"`)}&limit=1`,
    { authorization: `Bearer ${key}` }
  )
  const url = body.results?.[0]?.downloadUrl
  return url && /^https:\/\//.test(url) ? url : undefined
}

function pmidFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  return url.match(/europepmc\.org\/article\/MED\/(\d+)/)?.[1] ?? url.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/)?.[1]
}

export async function resolveOaPdfUrls(input: OaResolveInput, ctx: OaResolveContext): Promise<OaPdfCandidate[]> {
  const out: OaPdfCandidate[] = []
  const seen = new Set<string>()
  const push = (via: OaPdfCandidate['via'], url: string | undefined): void => {
    if (!url || !/^https:\/\//.test(url) || seen.has(url)) return
    seen.add(url)
    out.push({ via, url })
  }
  push('direct', input.pdfUrl)
  let arxivId = input.arxivId
  const doi = input.doi ? normalizeDoi(input.doi) : undefined
  if (!arxivId && doi) {
    try {
      arxivId = await arxivIdForDoi(doi, ctx)
    } catch {
      // OpenAlex lookup is best-effort.
    }
  }
  if (arxivId) push('arxiv', `https://arxiv.org/pdf/${arxivId}`)
  if (doi) {
    try {
      for (const url of await unpaywallPdfs(doi, ctx)) push('unpaywall', url)
    } catch {
      // Unpaywall is optional.
    }
  }
  try {
    push('europepmc', await europePmcPdf({ ...input, doi, pmid: input.pmid ?? pmidFromUrl(input.pdfUrl) }, ctx))
  } catch {
    // Europe PMC is optional.
  }
  if (doi) {
    try {
      push('core', await corePdf(doi, ctx))
    } catch {
      // CORE is optional.
    }
  }
  return out
}
