import type { CapabilityToolProvider } from './capability-registry.js'
import type { PaperSearchCapabilityConfig } from '../../contracts/capabilities-core.js'
import { LocalToolHost } from './local-tool-host.js'
import { createProxyFetch } from '../model/proxy-fetch.js'
import {
  DEFAULT_PAPER_SEARCH_SOURCES,
  PAPER_SEARCH_SOURCES,
  PAPER_SEARCH_SOURCE_LABELS,
  PaperSearchCache,
  PaperRateLimiter,
  buildPaperSearchMeta,
  formatPaperSearchForModel,
  mergePaperSearchResults,
  paperHitToCard,
  runPaperSearch,
  type PaperSearchCardHit,
  type PaperSearchCredentials,
  type PaperSearchFetch,
  type PaperSearchResponse,
  type PaperSourceHit
} from '../../services/paper-search/paper-search.js'
import { PaperSeenStore } from '../../services/paper-search/paper-search-seen-store.js'
import {
  fetchPaperCitationNeighbors,
  fetchPaperDetails
} from '../../services/paper-search/paper-search-lookup.js'
import type { PaperListEntryMeta, PaperReportPriority } from '../../services/paper-search/paper-search-types.js'
import { KUN_VERSION } from '../../version.js'

export const PAPER_SEARCH_TOOL_NAME = 'paper_search' as const
export const PAPER_REPORT_TOOL_NAME = 'paper_report' as const
export const PAPER_CITATIONS_TOOL_NAME = 'paper_citations' as const
export const PAPER_DETAILS_TOOL_NAME = 'paper_details' as const
export const PAPER_SEARCH_PROVIDER_ID = 'paper-search' as const

/** Merge capability credentials with env fallbacks (`KUN_*` overrides unset). */
export function resolvePaperSearchCredentials(
  paper: PaperSearchCapabilityConfig | undefined
): PaperSearchCredentials {
  const env = (key: string) => process.env[key]?.trim() || undefined
  return {
    semanticScholarApiKey: paper?.semanticScholarApiKey?.trim() || env('KUN_SEMANTIC_SCHOLAR_API_KEY'),
    coreApiKey: paper?.coreApiKey?.trim() || env('KUN_CORE_API_KEY'),
    openAlexMailto: paper?.openAlexMailto?.trim() || env('KUN_OPENALEX_MAILTO'),
    unpaywallEmail: paper?.unpaywallEmail?.trim() || env('KUN_UNPAYWALL_EMAIL')
  }
}

export type PaperSearchToolOptions = {
  /** Outbound proxy shared with model requests; blank means direct. */
  proxyUrl: () => string | undefined
  /** Runtime credentials (settings + env fallbacks resolved upstream). */
  credentials?: () => PaperSearchCredentials | undefined
  /**
   * Capability-level source allow-list from `capabilities.paperSearch`.
   * Empty/absent means "engine defaults"; a non-empty list intersects with
   * the `sources` arg so disabled sources are silently skipped.
   */
  enabledSources?: () => readonly string[] | undefined
  /** Test seam / shared engine state; defaults are process-wide singletons. */
  cache?: PaperSearchCache<PaperSourceHit[]>
  rateLimiter?: PaperRateLimiter
  seen?: PaperSeenStore
}

type SharedPaperState = {
  cache: PaperSearchCache<PaperSourceHit[]>
  rateLimiter: PaperRateLimiter
  seen: PaperSeenStore
}

let sharedState: SharedPaperState | undefined

function defaultSharedState(): SharedPaperState {
  sharedState ??= {
    cache: new PaperSearchCache<PaperSourceHit[]>(),
    rateLimiter: new PaperRateLimiter(),
    seen: new PaperSeenStore()
  }
  return sharedState
}

const SEARCH_DESCRIPTION = [
  'Search scholarly literature across several open indexes at once and get one merged, deduplicated, ranked list',
  '(title, authors, year, venue, citations, arXiv id / DOI, abstract excerpt, and which sources returned it).',
  'Sources: arxiv (preprints), openalex (broad metadata incl. journals), semantic_scholar (CS/AI with citations),',
  'venues (accepted papers of ML/NLP/CV/systems conferences such as ICLR, NeurIPS, ICML, ACL, CVPR via papers.cool),',
  'paperscool (arXiv with abstracts via papers.cool), crossref (DOI registry, all fields), europepmc (biomedical),',
  'openreview (ML conference submissions + reviews), pubmed (PubMed), hal (HAL open archive), zenodo (Zenodo),',
  'core (open-access aggregator, needs key), biorxiv (bioRxiv/medRxiv preprints), dblp (CS bibliography).',
  `Default sources: ${DEFAULT_PAPER_SEARCH_SOURCES.join(', ')}.`,
  'Write queries as short English keyword phrases (3-8 terms), not questions. For a literature survey, run several',
  'queries that cover synonyms, sub-topics and key method names, narrow with year_from/year_to, then judge relevance',
  'from the abstracts before recommending papers. When the user asks for a curated reading list, finish with a',
  'paper_report call whose ids come ONLY from papers this conversation already found.'
].join(' ')

const REPORT_DESCRIPTION = [
  'Submit the final recommended-paper list for a literature search, rendered in the chat as importable cards.',
  'Every papers[].id MUST be the arXiv id, DOI, or papers.cool id of a paper already returned by paper_search or',
  'paper_citations in this conversation — never invent ids. Ids that cannot be verified stay visible but are',
  'marked unverified. Give each paper a one-sentence reason, an optional thematic group, and a priority',
  '(must = core reading, should = recommended, optional = background).'
].join(' ')

const CITATIONS_DESCRIPTION = [
  'Walk one hop of the citation graph around a seed paper: its references (direction="references") or the',
  'papers citing it (direction="citations"). seed_id accepts a DOI, arXiv id, PMID or Semantic Scholar id.',
  'Use it after paper_search to expand a survey around the strongest seeds.'
].join(' ')

const DETAILS_DESCRIPTION = [
  'Fetch authoritative metadata (full abstract, venue, tldr, fields of study, citation count) for up to 8 papers',
  'identified by DOI, arXiv id or PMID. Use it to verify details before recommending a paper in paper_report.'
].join(' ')

const PRIORITIES: ReadonlySet<string> = new Set(['must', 'should', 'optional'])

export function buildPaperSearchToolProvider(options: PaperSearchToolOptions): CapabilityToolProvider[] {
  const shared = defaultSharedState()
  const cache = options.cache ?? shared.cache
  const rateLimiter = options.rateLimiter ?? shared.rateLimiter
  const seen = options.seen ?? shared.seen

  const fetchFor = (): PaperSearchFetch | undefined => {
    const proxyUrl = options.proxyUrl()?.trim()
    return proxyUrl ? ((createProxyFetch(proxyUrl) as PaperSearchFetch | null) ?? undefined) : undefined
  }

  // Session-wide seen store: delegated literature children run in their own
  // thread, so findings are recorded process-wide for `paper_report`.
  const remember = (cards: PaperSearchCardHit[]): void => {
    seen.record(cards)
  }

  const searchTool = LocalToolHost.defineTool({
    name: PAPER_SEARCH_TOOL_NAME,
    description: SEARCH_DESCRIPTION,
    toolKind: 'tool_call',
    policy: 'auto',
    sideEffect: 'read-only',
    // Work (docs + paper mode) is where research happens; keep the schema
    // out of Code/Design prompts.
    shouldAdvertise: (context) => context.agentSurface === 'write',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          minLength: 2,
          maxLength: 300,
          description: 'English keyword query, e.g. "repository-level code agent issue resolution".'
        },
        sources: {
          type: 'array',
          items: { type: 'string', enum: [...PAPER_SEARCH_SOURCES] },
          uniqueItems: true,
          description: 'Indexes to query; omit for the default set.'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 25,
          description: 'Results per source (default 10).'
        },
        year_from: { type: 'integer', minimum: 1900, maximum: 2100 },
        year_to: { type: 'integer', minimum: 1900, maximum: 2100 }
      },
      required: ['query'],
      additionalProperties: false
    },
    execute: async (args, context) => {
      const query = typeof args?.query === 'string' ? args.query.trim() : ''
      if (!query) return { output: 'paper_search failed: query is required.', isError: true }
      const enabled = options.enabledSources?.()
      const requested = Array.isArray(args?.sources)
        ? args.sources.filter((s: unknown): s is string => typeof s === 'string') as never
        : undefined
      const credentials = options.credentials?.()
      const baseSources = enabled?.length
        ? (requested ?? [...PAPER_SEARCH_SOURCES]).filter((s) => enabled.includes(s as never))
        : requested
      const sources = (baseSources ?? []).filter((s) => s !== 'core' || credentials?.coreApiKey)
      if (enabled?.length && !sources.length) {
        return {
          output: `paper_search: none of the requested sources are enabled; enabled sources: ${enabled.join(', ')}.`,
          isError: true
        }
      }
      const response = await runPaperSearch(
        {
          query,
          sources: sources.length ? sources : undefined,
          limit: typeof args?.limit === 'number' ? args.limit : undefined,
          yearFrom: typeof args?.year_from === 'number' ? args.year_from : undefined,
          yearTo: typeof args?.year_to === 'number' ? args.year_to : undefined
        },
        {
          fetch: fetchFor(),
          signal: context?.abortSignal,
          credentials,
          userAgent: `Kun/${KUN_VERSION} (paper search)`,
          cache,
          rateLimiter
        }
      )
      const meta = buildPaperSearchMeta(response)
      remember(meta.papers)
      const allFailed = response.sources.length > 0 && response.sources.every((report) => report.error)
      return {
        output: formatPaperSearchForModel(response),
        ...(allFailed ? { isError: true } : {}),
        meta: { paperSearch: meta as unknown as Record<string, unknown> }
      }
    }
  })

  const reportTool = LocalToolHost.defineTool({
    name: PAPER_REPORT_TOOL_NAME,
    description: REPORT_DESCRIPTION,
    toolKind: 'tool_call',
    policy: 'auto',
    sideEffect: 'read-only',
    shouldAdvertise: (context) => context.agentSurface === 'write',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 200, description: 'Short report title.' },
        summary: { type: 'string', maxLength: 1200, description: 'One-paragraph overview of the findings.' },
        papers: {
          type: 'array',
          minItems: 1,
          maxItems: 30,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 300, description: 'arXiv id, DOI or papers.cool id from an earlier paper_search/paper_citations result.' },
              title: { type: 'string', minLength: 1, maxLength: 400 },
              reason: { type: 'string', minLength: 1, maxLength: 600, description: 'One sentence on why this paper matters for the question.' },
              group: { type: 'string', maxLength: 120, description: 'Optional thematic group label.' },
              priority: { type: 'string', enum: ['must', 'should', 'optional'] }
            },
            required: ['id', 'title', 'reason'],
            additionalProperties: false
          },
          description: 'Recommended papers, best first (1-30).'
        }
      },
      required: ['papers'],
      additionalProperties: false
    },
    execute: async (args, context) => {
      const raw = Array.isArray(args?.papers) ? args.papers : []
      if (!raw.length || raw.length > 30) {
        return { output: 'paper_report failed: provide 1-30 papers.', isError: true }
      }
      const hasContext = seen.hasAny()
      const entries: PaperListEntryMeta[] = []
      for (const item of raw.slice(0, 30)) {
        const id = typeof item?.id === 'string' ? item.id.trim() : ''
        const title = typeof item?.title === 'string' ? item.title.trim() : ''
        const reason = typeof item?.reason === 'string' ? item.reason.trim() : ''
        if (!id || !title || !reason) continue
        const found = seen.resolve(id)
        const entry: PaperListEntryMeta = {
          id,
          title,
          reason,
          verified: !!found,
          ...(found ? { paper: found } : {})
        }
        const group = typeof item?.group === 'string' ? item.group.trim() : ''
        if (group) entry.group = group
        const priority = typeof item?.priority === 'string' && PRIORITIES.has(item.priority)
          ? (item.priority as PaperReportPriority)
          : undefined
        if (priority) entry.priority = priority
        entries.push(entry)
      }
      if (!entries.length) {
        return { output: 'paper_report failed: every paper needs id, title and reason.', isError: true }
      }
      const verified = entries.filter((entry) => entry.verified).length
      const unverified = entries.length - verified
      const warning = !hasContext
        ? ' No paper_search results are recorded for this conversation — every entry is unverified; run paper_search first next time.'
        : unverified > 0
          ? ` ${unverified} entr${unverified === 1 ? 'y was' : 'ies were'} not among the papers found earlier — shown as unverified.`
          : ''
      return {
        output: `paper_report recorded: ${entries.length} recommended paper${entries.length === 1 ? '' : 's'} (${verified} verified).${warning}`,
        meta: {
          paperList: {
            version: 1,
            ...(typeof args?.title === 'string' && args.title.trim() ? { title: args.title.trim() } : {}),
            ...(typeof args?.summary === 'string' && args.summary.trim() ? { summary: args.summary.trim() } : {}),
            papers: entries
          } as unknown as Record<string, unknown>
        }
      }
    }
  })

  const citationsTool = LocalToolHost.defineTool({
    name: PAPER_CITATIONS_TOOL_NAME,
    description: CITATIONS_DESCRIPTION,
    toolKind: 'tool_call',
    policy: 'auto',
    sideEffect: 'read-only',
    shouldAdvertise: (context) => context.agentSurface === 'write',
    inputSchema: {
      type: 'object',
      properties: {
        seed_id: { type: 'string', minLength: 1, maxLength: 300, description: 'DOI, arXiv id, PMID or Semantic Scholar paper id.' },
        direction: { type: 'string', enum: ['references', 'citations'], description: '"references" = papers the seed cites; "citations" = papers citing the seed.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max neighbor papers (default 25).' }
      },
      required: ['seed_id', 'direction'],
      additionalProperties: false
    },
    execute: async (args, context) => {
      const seedId = typeof args?.seed_id === 'string' ? args.seed_id.trim() : ''
      const direction = args?.direction === 'citations' ? 'citations' : 'references'
      if (!seedId) return { output: 'paper_citations failed: seed_id is required.', isError: true }
      const fetchImpl = fetchFor()
      const started = Date.now()
      try {
        const result = await fetchPaperCitationNeighbors(
          { id: seedId, direction, limit: typeof args?.limit === 'number' ? args.limit : 25 },
          { fetch: fetchImpl ?? ((url, init) => fetch(url, init)), signal: context?.abortSignal, credentials: options.credentials?.() }
        )
        const viaSource = result.via === 'semantic_scholar' ? 'semantic_scholar' : 'openalex'
        const merged = mergePaperSearchResults([{ source: viaSource, hits: result.hits }])
        const response: PaperSearchResponse = {
          query: `${direction} of ${seedId}`,
          hits: merged,
          sources: [{ source: viaSource, count: result.hits.length, ms: Date.now() - started }]
        }
        const meta = buildPaperSearchMeta(response)
        remember(meta.papers)
        const seedLine = result.seed ? `Seed: ${result.seed.title}\n` : ''
        return {
          output: `${seedLine}${formatPaperSearchForModel(response)}`,
          meta: { paperSearch: meta as unknown as Record<string, unknown> }
        }
      } catch (error) {
        return {
          output: `paper_citations failed: ${error instanceof Error ? error.message : String(error)}`,
          isError: true
        }
      }
    }
  })

  const detailsTool = LocalToolHost.defineTool({
    name: PAPER_DETAILS_TOOL_NAME,
    description: DETAILS_DESCRIPTION,
    toolKind: 'tool_call',
    policy: 'auto',
    sideEffect: 'read-only',
    shouldAdvertise: (context) => context.agentSurface === 'write',
    inputSchema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: { type: 'string', minLength: 1, maxLength: 300 },
          description: 'DOI, arXiv id or PMID values to verify.'
        }
      },
      required: ['ids'],
      additionalProperties: false
    },
    execute: async (args, context) => {
      const ids = Array.isArray(args?.ids)
        ? args.ids.filter((id: unknown): id is string => typeof id === 'string' && !!id.trim()).slice(0, 8)
        : []
      if (!ids.length) return { output: 'paper_details failed: provide 1-8 ids.', isError: true }
      const fetchImpl = fetchFor()
      try {
        const details = await fetchPaperDetails(ids, {
          fetch: fetchImpl ?? ((url, init) => fetch(url, init)),
          signal: context?.abortSignal,
          credentials: options.credentials?.()
        })
        const resolved = details.filter((entry) => entry.hit)
        const cards = resolved
          .map((entry) => paperHitToCard({ ...entry.hit!, key: '', sources: ['semantic_scholar'], score: 0 }))
        remember(cards)
        const lines: string[] = []
        details.forEach((entry, i) => {
          if (!entry.hit) {
            lines.push(`[${i + 1}] ${entry.id}: not found.`)
            return
          }
          const hit = entry.hit
          const idsLine = [
            hit.arxivId ? `arXiv:${hit.arxivId}` : '',
            hit.doi ? `doi:${hit.doi}` : ''
          ].filter(Boolean).join(' ')
          lines.push(`[${i + 1}] ${hit.title}`)
          lines.push(`    ${hit.authors.slice(0, 6).join(', ')}${hit.authors.length > 6 ? ' et al.' : ''}`)
          lines.push(`    ${[hit.year, hit.venue, hit.citations !== undefined ? `${hit.citations} citations` : '', idsLine].filter(Boolean).join(' | ')}`)
          if (entry.extra?.fieldsOfStudy?.length) lines.push(`    fields: ${entry.extra.fieldsOfStudy.join(', ')}`)
          if (entry.extra?.tldr) lines.push(`    tldr: ${entry.extra.tldr}`)
          if (hit.abstract) lines.push(`    ${hit.abstract.length > 900 ? `${hit.abstract.slice(0, 900)}…` : hit.abstract}`)
          if (hit.pdfUrl) lines.push(`    pdf: ${hit.pdfUrl}`)
        })
        return {
          output: lines.join('\n') || 'No details found.',
          meta: { paperDetails: { version: 1, papers: cards } as unknown as Record<string, unknown> }
        }
      } catch (error) {
        return {
          output: `paper_details failed: ${error instanceof Error ? error.message : String(error)}`,
          isError: true
        }
      }
    }
  })

  return [{
    id: PAPER_SEARCH_PROVIDER_ID,
    kind: 'built-in',
    enabled: true,
    available: true,
    effects: {
      network: true,
      externalWrite: false,
      processExecution: false,
      guiAutomation: false
    },
    tools: [searchTool, reportTool, citationsTool, detailsTool]
  }]
}

/** Test/helper hook: shared process-wide state used by both registration paths. */
export function paperSearchSharedState(): SharedPaperState {
  return defaultSharedState()
}
