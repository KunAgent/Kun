import { describe, expect, it, vi } from 'vitest'
import { MemoryRecord } from '../../contracts/memory.js'
import type { MemoryStore } from '../../memory/memory-store.js'
import { memoryInScope, memoryLifecycleState } from '../../memory/memory-ranking.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { buildMemoryReadTools, MEMORY_TOOL_RESULT_CHARACTER_BUDGET } from './memory-read-tools.js'

const timestamp = '2026-08-28T00:00:00.000Z'
const context: ToolHostContext = {
  threadId: 'thread-1', turnId: 'turn-1', workspace: '/workspace-a', approvalPolicy: 'auto',
  abortSignal: new AbortController().signal, awaitApproval: async () => 'allow',
  memoryPolicy: { enabled: true, scopes: ['user', 'workspace', 'project'] }
}

type Page = {
  memories: Array<{ id: string; content: string; truncated: boolean; metadataTruncated: boolean }>
  nextCursor?: string
  totalActiveInScope: number | string
}

function record(index: number, patch: Partial<MemoryRecord> = {}): MemoryRecord {
  return MemoryRecord.parse({
    id: `mem_${String(index).padStart(4, '0')}`, content: `memory ${index}`,
    scope: 'workspace', workspace: context.workspace, createdAt: timestamp, updatedAt: timestamp,
    ...patch
  })
}

function fixture(records: MemoryRecord[]) {
  const ordered = [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const list = vi.fn(async (filter = {}) => {
    const input = filter as Parameters<MemoryStore['list']>[0]
    return ordered.filter((item) =>
      memoryInScope(item, input ?? {}) && (!input?.authority || input.authority === item.authority) &&
      (!input?.type || input.type === item.type) &&
      (!input?.before || item.updatedAt < input.before.updatedAt ||
        item.updatedAt === input.before.updatedAt && item.id > input.before.id)
    ).slice(0, input?.limit ?? Infinity)
  })
  const getById = vi.fn(async (id: string) => {
    const value = records.find((item) => item.id === id)
    if (!value) throw new Error('not found')
    return value
  })
  const retrieve = vi.fn(async () => ordered)
  const store = { list, getById, retrieve } as unknown as MemoryStore
  const tools = buildMemoryReadTools(store)
  const tool = (name: string) => tools.find((candidate) => candidate.name === name)!
  return { list, getById, retrieve, tool }
}

async function enumerate(records: MemoryRecord[], limit: number, filter: Record<string, unknown> = {}) {
  const { tool, list } = fixture(records)
  const ids: string[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  let pages = 0
  do {
    const result = await tool('memory_list').execute({ limit, ...filter, ...(cursor ? { cursor } : {}) }, context)
    expect(result.isError).not.toBe(true)
    expect(JSON.stringify(result.output).length).toBeLessThanOrEqual(MEMORY_TOOL_RESULT_CHARACTER_BUDGET)
    const page = result.output as Page
    expect(page.memories.length).toBeLessThanOrEqual(limit)
    ids.push(...page.memories.map((memory) => memory.id))
    cursor = page.nextCursor
    if (cursor) {
      expect(cursors.has(cursor)).toBe(false)
      cursors.add(cursor)
    }
    pages += 1
    expect(pages).toBeLessThanOrEqual(records.length + 2)
  } while (cursor)
  expect(new Set(ids).size).toBe(ids.length)
  return { ids, list }
}

describe('bounded memory recall', () => {
  for (const size of [60, 600]) {
    for (const limit of [1, 20, 50]) {
      it(`enumerates ${size} timestamp-tied records with limit ${limit} without skips or repeats`, async () => {
        const records = Array.from({ length: size }, (_, index) => record(index))
        const { ids } = await enumerate(records, limit)
        expect(ids).toEqual(records.map((item) => item.id))
      // This contract deliberately performs 600 serial tool calls, each with bounded lookahead.
      // Give contended CI workers headroom without changing the cases or production pagination.
      }, size === 600 && limit === 1 ? 30_000 : undefined)
    }
  }

  for (const limit of [1, 20, 50]) {
    it(`enumerates 600 mixed lifecycle/filter rows with limit ${limit}`, async () => {
      const records = Array.from({ length: 600 }, (_, index) => record(index, {
        scope: index % 3 === 0 ? 'user' : 'workspace',
        type: index % 2 === 0 ? 'fact' : 'decision',
        authority: index % 4 === 0 ? 'directive' : 'reference',
        updatedAt: new Date(Date.parse(timestamp) - Math.floor(index / 13) * 1000).toISOString(),
        ...(index % 11 === 0 ? { deletedAt: timestamp } : {}),
        ...(index % 11 === 1 ? { disabledAt: timestamp } : {}),
        ...(index % 11 === 2 ? { supersededAt: timestamp } : {}),
        ...(index % 11 === 3 ? { validTo: '2000-01-01T00:00:00.000Z' } : {}),
        ...(index % 11 === 4 ? { validFrom: '2999-01-01T00:00:00.000Z' } : {}),
        ...(index % 11 === 5 ? { expiresAt: '2000-01-01T00:00:00.000Z' } : {})
      }))
      const filter = { scope: 'workspace', type: 'fact', authority: 'reference' }
      const expected = records.filter((item) => item.scope === filter.scope && item.type === filter.type &&
        item.authority === filter.authority && memoryLifecycleState(item, Date.now()) === 'active')
      expect((await enumerate(records, limit, filter)).ids).toEqual(expected.map((item) => item.id))
    })
  }

  it('continues after the scan cap even when the first 500 rows are inactive', async () => {
    const records = Array.from({ length: 600 }, (_, index) => record(index,
      index < 500 ? { disabledAt: timestamp } : {}))
    const { tool, list } = fixture(records)
    const first = (await tool('memory_list').execute({ limit: 50 }, context)).output as Page
    expect(first.memories).toEqual([])
    expect(first.totalActiveInScope).toBe('0+')
    expect(first.nextCursor).toBeDefined()
    expect(list.mock.calls.reduce((count, call) => count + (call[0] as { limit: number }).limit, 0)).toBe(500)
    expect((await enumerate(records, 50)).ids).toEqual(records.slice(500).map((item) => item.id))
  })

  it('does not consume the next item when escaped JSON and metadata exhaust the budget', async () => {
    const records = Array.from({ length: 60 }, (_, index) => record(index, {
      content: `item ${index} ${'\u0000\\"'.repeat(20_000)}`,
      tags: Array.from({ length: 1_000 }, () => '\u0000'.repeat(1_000))
    }))
    const first = (await fixture(records).tool('memory_list').execute({ limit: 50 }, context)).output as Page
    expect(first.memories.length).toBeGreaterThan(0)
    expect(first.memories.length).toBeLessThan(50)
    expect(first.memories.every((item) => item.truncated && item.metadataTruncated)).toBe(true)
    expect((await enumerate(records, 50)).ids).toEqual(records.map((item) => item.id))
  })

  it('caps the complete search JSON as well as per-record content', async () => {
    const records = Array.from({ length: 20 }, (_, index) => record(index, {
      content: '\u0000'.repeat(20_000), tags: ['\\"'.repeat(10_000)]
    }))
    const result = await fixture(records).tool('memory_search').execute({ query: 'memory' }, context)
    expect(JSON.stringify(result.output).length).toBeLessThanOrEqual(MEMORY_TOOL_RESULT_CHARACTER_BUDGET)
    expect(result.output).toMatchObject({ truncated: true })
  })

  it('discovers bounded derived topics, then resolves canonical IDs through memory_read', async () => {
    const records = [record(1, { tags: ['architecture'], content: 'Uses adapters for storage' }),
      record(2, { tags: ['architecture'], disabledAt: timestamp }),
      record(3, { tags: ['private'], workspace: '/other-workspace' }),
      record(4, { tags: ['personal'], scope: 'user' })]
    const { tool } = fixture(records)
    const result = await tool('memory_topics').execute({}, {
      ...context, memoryPolicy: { enabled: true, scopes: ['workspace'] }
    })
    expect(result.output).toMatchObject({ derived: true, truncated: false,
      countScope: 'bounded-active-window', topics: [{ label: 'architecture', memoryIds: ['mem_0001'], total: 1 }] })
    const read = await tool('memory_read').execute({ id: 'mem_0001' }, context)
    expect(read.output).toMatchObject({ memory: { content: 'Uses adapters for storage' } })
    records[0].deletedAt = timestamp
    expect((await tool('memory_topics').execute({ scope: 'workspace' }, context)).output)
      .toMatchObject({ topics: [] })
    expect((await tool('memory_read').execute({ id: 'mem_0001' }, context)).isError).toBe(true)
  })

  it('bounds topic JSON with oversized escaped labels and long IDs', async () => {
    const records = Array.from({ length: 600 }, (_, index) => record(index, {
      id: `m${'x'.repeat(119)}${String(index).padStart(5, '0')}`,
      tags: [`${index % 24}\u0000${'\\'.repeat(500)}`]
    }))
    const result = await fixture(records).tool('memory_topics').execute({}, context)
    expect(JSON.stringify(result.output).length).toBeLessThanOrEqual(MEMORY_TOOL_RESULT_CHARACTER_BUDGET)
    expect(result.output).toMatchObject({ derived: true, truncated: true })
  })

  it('reads a large body losslessly through bounded escaped-content chunks', async () => {
    const source = record(1, { content: '\u0000\\"\n漢字🙂'.repeat(4_000), tags: ['x'.repeat(50_000)] })
    const { tool } = fixture([source])
    let offset: number | undefined = 0
    let content = ''
    do {
      const result = await tool('memory_read').execute({ id: source.id, offset, length: 6_000 }, context)
      expect(result.isError).not.toBe(true)
      expect(JSON.stringify(result.output).length).toBeLessThanOrEqual(MEMORY_TOOL_RESULT_CHARACTER_BUDGET)
      const chunk = result.output as { memory: { content: string }; offset: number; totalCharacters: number; nextOffset?: number }
      expect(chunk.offset).toBe(offset)
      expect(chunk.totalCharacters).toBe(source.content.length)
      content += chunk.memory.content
      if (chunk.nextOffset !== undefined) expect(chunk.nextOffset).toBeGreaterThan(offset!)
      offset = chunk.nextOffset
    } while (offset !== undefined)
    expect(content).toBe(source.content)
    expect((await tool('memory_read').execute({ id: source.id, offset: 1, expectedRevision: 999 }, context)).isError)
      .toBe(true)
  })

  it('checks lifecycle, workspace, policy and agent ownership before returning any by-ID metadata', async () => {
    const records = [
      record(1, { workspace: '/other-workspace' }), record(2, { scope: 'user' }),
      record(3, { deletedAt: timestamp }), record(4, { disabledAt: timestamp }),
      record(5, { supersededAt: timestamp }), record(6, { expiresAt: '2000-01-01T00:00:00.000Z' }),
      record(7, { validFrom: '2999-01-01T00:00:00.000Z' }),
      record(8, { validTo: '2000-01-01T00:00:00.000Z' }),
      record(9, { agentContext: { schemaVersion: 1, agentId: 'agent', sourceConversationId: 'private',
        shared: false, sharedConversationIds: [], sharedProjectRoots: [], locked: false } })
    ]
    const { tool } = fixture(records)
    for (const item of records) {
      const result = await tool('memory_read').execute({ id: item.id }, {
        ...context, memoryPolicy: { enabled: true, scopes: ['workspace'] }
      })
      expect(result).toMatchObject({ isError: true, output: { error: 'memory not found' } })
      expect(JSON.stringify(result.output)).not.toContain(item.id)
    }
    for (const name of ['memory_read', 'memory_search', 'memory_list', 'memory_topics']) {
      const result = await tool(name).execute({ id: 'mem_0002', query: 'memory' }, {
        ...context, memoryPolicy: { enabled: false }
      })
      expect(result.isError).toBe(true)
    }
  })

  it('does not touch the by-ID store when memory is disabled or no scope is allowed', async () => {
    const { tool, getById } = fixture([record(1)])
    for (const memoryPolicy of [{ enabled: false }, { enabled: true, scopes: [] }]) {
      const result = await tool('memory_read').execute({ id: 'mem_0001' }, { ...context, memoryPolicy })
      expect(result.isError).toBe(true)
    }
    expect(getById).not.toHaveBeenCalled()
  })

  it('rejects malformed cursors, IDs and offsets, and does not expose provenance details', async () => {
    const { tool } = fixture([record(1, { sources: [{ id: 'private-source', kind: 'file', trust: 'observed',
      locator: '/private/file.txt', excerpt: 'hidden excerpt', threadId: 'private-thread' }] })])
    expect((await tool('memory_list').execute({ cursor: 'garbage' }, context)).isError).toBe(true)
    for (const args of [{ id: '../x' }, { id: 'mem_0001', offset: -1 }, { id: 'mem_0001', offset: 1.5 },
      { id: 'mem_0001', offset: 99_999 }]) {
      expect((await tool('memory_read').execute(args, context)).isError).toBe(true)
    }
    const result = await tool('memory_read').execute({ id: 'mem_0001' }, context)
    expect(JSON.stringify(result.output)).not.toMatch(/private-source|private\/file|hidden excerpt|private-thread/)
    expect(result.output).toMatchObject({ memory: { source: { kind: 'file', trust: 'observed' } } })
  })
})
