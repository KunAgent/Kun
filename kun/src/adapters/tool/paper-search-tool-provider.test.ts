import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPaperSearchToolProvider } from './paper-search-tool-provider.js'
import { PaperSeenStore } from '../../services/paper-search/paper-search-seen-store.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

const CONTEXT = {
  threadId: 'thread-1',
  turnId: 'turn-1',
  workspace: '/tmp/ws',
  agentSurface: 'write' as const
} as ToolHostContext

const OPENALEX_WORK = {
  display_name: 'RepoAudit: Autonomous LLM Agents for Repository Auditing',
  publication_year: 2024,
  doi: 'https://doi.org/10.1145/repoaudit',
  cited_by_count: 12,
  authorships: [{ author: { display_name: 'Jinyao Guo' } }],
  primary_location: { landing_page_url: 'https://openreview.net/forum?id=x', source: { display_name: 'ICLR' } },
  best_oa_location: { pdf_url: 'https://openreview.net/pdf?id=x' }
}

const S2_PAPER = {
  title: 'RepoAudit: Autonomous LLM Agents for Repository Auditing',
  year: 2024,
  venue: 'ICLR',
  url: 'https://www.semanticscholar.org/paper/x',
  citationCount: 12,
  authors: [{ name: 'Jinyao Guo' }],
  externalIds: { DOI: '10.1145/repoaudit' },
  openAccessPdf: { url: 'https://openreview.net/pdf?id=x' }
}

function stubFetch(): ReturnType<typeof vi.fn> {
  const impl = vi.fn(async (input: unknown): Promise<Response> => {
    const url = String(input)
    if (url.includes('api.openalex.org')) {
      return Response.json({ results: [OPENALEX_WORK] })
    }
    if (url.includes('api.semanticscholar.org')) {
      // Neighbor endpoints wrap each row; direct paper lookups do not.
      const wrapped = url.includes('/citations') || url.includes('/references')
      return Response.json(
        wrapped ? { data: [{ citingPaper: S2_PAPER, citedPaper: S2_PAPER }] } : { data: [S2_PAPER] }
      )
    }
    return new Response('unexpected url', { status: 404 })
  })
  vi.stubGlobal('fetch', impl as unknown as typeof fetch)
  return impl
}

function toolMap(seen = new PaperSeenStore()) {
  const providers = buildPaperSearchToolProvider({ proxyUrl: () => undefined, seen })
  const tools = new Map(providers[0]!.tools.map((tool) => [tool.name, tool]))
  return { tools, seen }
}

describe('paper search tool provider (P1.1/P4)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('advertises the four paper tools only on the write surface', () => {
    const { tools } = toolMap()
    expect([...tools.keys()].sort()).toEqual([
      'paper_citations',
      'paper_details',
      'paper_report',
      'paper_search'
    ])
    const search = tools.get('paper_search')!
    expect(search.shouldAdvertise?.(CONTEXT)).toBe(true)
    expect(search.shouldAdvertise?.({ ...CONTEXT, agentSurface: 'code' })).toBe(false)
  })

  it('paper_search returns compact text plus meta.paperSearch and remembers cards', async () => {
    stubFetch()
    const { tools, seen } = toolMap()
    const result = await tools.get('paper_search')!.execute(
      { query: 'repository auditing agents', sources: ['openalex'] },
      CONTEXT
    )
    expect(result.isError).toBeUndefined()
    expect(String(result.output)).toContain('RepoAudit')
    const meta = result.meta?.paperSearch as {
      version: number
      papers: Array<{ id: string; title: string; doi?: string }>
      sources: Array<{ source: string; count: number }>
    }
    expect(meta.version).toBe(1)
    expect(meta.papers).toHaveLength(1)
    expect(meta.papers[0]).toMatchObject({ doi: '10.1145/repoaudit' })
    expect(meta.sources).toEqual([{ source: 'openalex', count: 1, ms: expect.any(Number) }])
    expect(seen.hasAny()).toBe(true)
    expect(seen.resolve('10.1145/repoaudit')?.title).toContain('RepoAudit')
  })

  it('paper_search errors on a blank query', async () => {
    const { tools } = toolMap()
    const result = await tools.get('paper_search')!.execute({ query: '  ' }, CONTEXT)
    expect(result.isError).toBe(true)
    expect(String(result.output)).toContain('query is required')
  })

  it('paper_search respects the enabled-sources capability', async () => {
    const impl = stubFetch()
    const providers = buildPaperSearchToolProvider({
      proxyUrl: () => undefined,
      seen: new PaperSeenStore(),
      enabledSources: () => ['arxiv']
    })
    const search = providers[0]!.tools.find((tool) => tool.name === 'paper_search')!
    const result = await search.execute({ query: 'x', sources: ['openalex'] }, CONTEXT)
    expect(result.isError).toBe(true)
    expect(String(result.output)).toContain('enabled')
    expect(impl).not.toHaveBeenCalled()
  })

  it('paper_report verifies ids against the seen store and flags the rest', async () => {
    stubFetch()
    const { tools } = toolMap()
    await tools.get('paper_search')!.execute({ query: 'audit', sources: ['openalex'] }, CONTEXT)
    const result = await tools.get('paper_report')!.execute(
      {
        title: 'Audit papers',
        summary: 'Short list.',
        papers: [
          { id: '10.1145/repoaudit', title: 'RepoAudit', reason: 'Core audit agent.', priority: 'must' },
          { id: '10.9999/invented', title: 'Made Up', reason: 'Hallucinated entry.' }
        ]
      },
      CONTEXT
    )
    expect(result.isError).toBeUndefined()
    const list = result.meta?.paperList as {
      version: number
      title?: string
      papers: Array<{ id: string; verified: boolean; priority?: string; paper?: { doi?: string } }>
    }
    expect(list.version).toBe(1)
    expect(list.title).toBe('Audit papers')
    expect(list.papers).toHaveLength(2)
    expect(list.papers[0]).toMatchObject({ verified: true, priority: 'must' })
    expect(list.papers[0].paper?.doi).toBe('10.1145/repoaudit')
    expect(list.papers[1]).toMatchObject({ id: '10.9999/invented', verified: false })
    expect(String(result.output)).toContain('1 verified')
  })

  it('paper_report rejects an empty list', async () => {
    const { tools } = toolMap()
    const result = await tools.get('paper_report')!.execute({ papers: [] }, CONTEXT)
    expect(result.isError).toBe(true)
    expect(String(result.output)).toContain('1-30')
  })

  it('paper_citations returns neighbor hits as meta.paperSearch', async () => {
    stubFetch()
    const { tools } = toolMap()
    const result = await tools.get('paper_citations')!.execute(
      { seed_id: '10.1145/repoaudit', direction: 'citations', limit: 5 },
      CONTEXT
    )
    // S2 resolves DOI seeds; the stubbed citations endpoint returns S2_PAPER.
    expect(result.isError).toBeUndefined()
    const meta = result.meta?.paperSearch as { papers: Array<{ title: string }> }
    expect(meta.papers.map((p) => p.title)).toContain('RepoAudit: Autonomous LLM Agents for Repository Auditing')
  })

  it('paper_details resolves ids into meta.paperDetails', async () => {
    stubFetch()
    const { tools, seen } = toolMap()
    const result = await tools.get('paper_details')!.execute({ ids: ['10.1145/repoaudit'] }, CONTEXT)
    expect(result.isError).toBeUndefined()
    const meta = result.meta?.paperDetails as { version: number; papers: Array<{ title: string }> }
    expect(meta.version).toBe(1)
    expect(meta.papers).toHaveLength(1)
    expect(seen.size).toBeGreaterThan(0)
  })

  it('paper_details rejects empty id lists', async () => {
    const { tools } = toolMap()
    const result = await tools.get('paper_details')!.execute({ ids: [] }, CONTEXT)
    expect(result.isError).toBe(true)
  })
})
