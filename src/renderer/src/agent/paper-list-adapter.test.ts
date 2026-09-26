import { describe, expect, it } from 'vitest'
import {
  isPaperReportToolName,
  isPaperSearchToolName,
  isPaperToolName,
  paperCardImportInput,
  paperCardImportMeta,
  paperCardUrl,
  paperDetailsFromToolItem,
  paperListFromToolItem,
  paperSearchMetaFromToolItem,
  parseRendererPaperListMeta,
  parseRendererPaperSearchMeta
} from './paper-list-adapter'
import { chatBlockFromItem, toolEventFromItem } from './kun-mapper-events'

const CARD = {
  id: '10.1145/repoaudit',
  title: 'RepoAudit',
  authors: ['Jinyao Guo'],
  year: 2024,
  venue: 'ICLR',
  doi: '10.1145/repoaudit',
  arxivId: '2401.00001',
  url: 'https://openreview.net/forum?id=x',
  pdfUrl: 'https://openreview.net/pdf?id=x',
  citations: 12,
  sources: ['openalex', 'arxiv']
}

const SEARCH_META = {
  version: 1,
  query: 'repo audit',
  total: 1,
  papers: [CARD],
  sources: [{ source: 'openalex', count: 1, ms: 340 }]
}

const LIST_META = {
  version: 1,
  title: 'Audit agents',
  summary: 'Short list.',
  papers: [
    { id: '10.1145/repoaudit', title: 'RepoAudit', reason: 'Core audit agent.', group: 'agents', priority: 'must', verified: true, paper: CARD },
    { id: '10.9/invented', title: 'Made Up', reason: 'Not verified.', verified: false }
  ]
}

const completedItem = (toolName: string, meta: Record<string, unknown>) => ({
  id: 'item-1',
  turnId: 'turn-1',
  threadId: 'thread-1',
  role: 'tool' as const,
  status: 'completed' as const,
  createdAt: '2026-08-27T00:00:00Z',
  kind: 'tool_result',
  callId: 'call-1',
  toolName,
  output: 'paper_report recorded: 2 recommended papers',
  meta
})

describe('paper list adapter (P1.3)', () => {
  it('parses governed meta payloads', () => {
    expect(parseRendererPaperSearchMeta(SEARCH_META)).toMatchObject({ query: 'repo audit', total: 1 })
    expect(parseRendererPaperListMeta(LIST_META)?.papers).toHaveLength(2)
    expect(parseRendererPaperListMeta({ ...LIST_META, version: 2 })).toBeNull()
    expect(parseRendererPaperListMeta({ papers: [] })).toBeNull()
    expect(parseRendererPaperSearchMeta('nope')).toBeNull()
  })

  it('maps a completed paper_report result to a paper-list block on replay', () => {
    const item = completedItem('paper_report', { paperList: LIST_META })
    expect(chatBlockFromItem(item)).toMatchObject({
      kind: 'paper-list',
      id: 'tool_call-1',
      list: { title: 'Audit agents' }
    })
    expect(toolEventFromItem(item).meta).toMatchObject({ paperList: { title: 'Audit agents' } })
  })

  it('keeps paper_search results on the tool block meta, not a paper-list block', () => {
    const item = completedItem('paper_search', { paperSearch: SEARCH_META })
    expect(paperListFromToolItem(item)).toBeNull()
    expect(paperSearchMetaFromToolItem(item)).toMatchObject({ query: 'repo audit' })
    expect(chatBlockFromItem(item)).toMatchObject({ kind: 'tool' })
  })

  it('extracts paper_details meta for the tool block detail', () => {
    const item = completedItem('paper_details', { paperDetails: { version: 1, papers: [CARD] } })
    expect(paperDetailsFromToolItem(item)).toMatchObject({ papers: [{ title: 'RepoAudit' }] })
  })

  it('never renders failed, running or foreign-tool items', () => {
    expect(paperListFromToolItem({ kind: 'tool_result', status: 'completed', isError: true, toolName: 'paper_report', meta: { paperList: LIST_META } })).toBeNull()
    expect(paperListFromToolItem({ kind: 'tool_call', status: 'running', toolName: 'paper_report', meta: { paperList: LIST_META } })).toBeNull()
    expect(paperListFromToolItem({ kind: 'tool_result', status: 'completed', toolName: 'bash', meta: { paperList: LIST_META } })).toBeNull()
    expect(paperSearchMetaFromToolItem(completedItem('paper_details', { paperSearch: SEARCH_META }))).toBeNull()
  })

  it('accepts namespaced SDK tool names', () => {
    expect(isPaperReportToolName('mcp__kun_server__paper_report')).toBe(true)
    expect(isPaperSearchToolName('paper_citations')).toBe(true)
    expect(isPaperToolName('paper_details')).toBe(true)
    expect(isPaperToolName('bash')).toBe(false)
  })

  it('projects import handles and urls in a stable order', () => {
    expect(paperCardImportInput({ arxivId: '2401.00001', doi: '10.1/x' })).toBe('2401.00001')
    expect(paperCardImportInput({ coolId: 'abc@ICLR', doi: '10.1/x' })).toBe('abc@ICLR')
    expect(paperCardImportInput({ doi: '10.1/x' })).toBe('10.1/x')
    expect(paperCardUrl({ arxivId: '2401.00001' })).toBe('https://arxiv.org/abs/2401.00001')
    expect(paperCardUrl({ doi: '10.1/x' })).toBe('https://doi.org/10.1/x')
    expect(paperCardUrl({ url: 'https://x.test/p' })).toBe('https://x.test/p')
    const meta = paperCardImportMeta(CARD as never)
    expect(meta).toMatchObject({ doi: '10.1145/repoaudit', arxivId: '2401.00001', year: '2024' })
  })
})
