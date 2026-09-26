import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'
import { createProxyFetch } from '../model/proxy-fetch.js'
import {
  DEFAULT_PAPER_SEARCH_SOURCES,
  PAPER_SEARCH_SOURCES,
  formatPaperSearchForModel,
  runPaperSearch,
  type PaperSearchFetch
} from '../../services/paper-search/paper-search.js'
import { KUN_VERSION } from '../../version.js'

export const PAPER_SEARCH_TOOL_NAME = 'paper_search' as const
export const PAPER_SEARCH_PROVIDER_ID = 'paper-search' as const

export type PaperSearchToolOptions = {
  /** Outbound proxy shared with model requests; blank means direct. */
  proxyUrl: () => string | undefined
  semanticScholarApiKey?: () => string | undefined
}

const description = [
  'Search scholarly literature across several open indexes at once and get one merged, deduplicated, ranked list',
  '(title, authors, year, venue, citations, arXiv id / DOI, abstract excerpt, and which sources returned it).',
  'Sources: arxiv (preprints), openalex (broad metadata incl. journals), semantic_scholar (CS/AI with citations),',
  'venues (accepted papers of ML/NLP/CV/systems conferences such as ICLR, NeurIPS, ICML, ACL, CVPR via papers.cool),',
  'paperscool (arXiv with abstracts via papers.cool), crossref (DOI registry, all fields), europepmc (biomedical).',
  `Default sources: ${DEFAULT_PAPER_SEARCH_SOURCES.join(', ')}.`,
  'Write queries as short English keyword phrases (3-8 terms), not questions. For a literature survey, run several',
  'queries that cover synonyms, sub-topics and key method names, narrow with year_from/year_to, then judge relevance',
  'from the abstracts before recommending papers. Cite papers by title plus arXiv id or DOI so the user can import them.'
].join(' ')

export function buildPaperSearchToolProvider(options: PaperSearchToolOptions): CapabilityToolProvider[] {
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
    tools: [LocalToolHost.defineTool({
      name: PAPER_SEARCH_TOOL_NAME,
      description,
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
        const proxyUrl = options.proxyUrl()?.trim()
        const fetchImpl: PaperSearchFetch | undefined = proxyUrl
          ? (createProxyFetch(proxyUrl) as PaperSearchFetch | null) ?? undefined
          : undefined
        const response = await runPaperSearch(
          {
            query,
            sources: Array.isArray(args?.sources) ? args.sources.filter((s: unknown): s is string => typeof s === 'string') as never : undefined,
            limit: typeof args?.limit === 'number' ? args.limit : undefined,
            yearFrom: typeof args?.year_from === 'number' ? args.year_from : undefined,
            yearTo: typeof args?.year_to === 'number' ? args.year_to : undefined
          },
          {
            fetch: fetchImpl,
            signal: context?.abortSignal,
            semanticScholarApiKey: options.semanticScholarApiKey?.(),
            userAgent: `Kun/${KUN_VERSION} (paper search)`
          }
        )
        const allFailed = response.sources.length > 0 && response.sources.every((report) => report.error)
        return {
          output: formatPaperSearchForModel(response),
          ...(allFailed ? { isError: true } : {})
        }
      }
    })]
  }]
}
