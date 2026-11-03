import { describe, expect, it, vi } from 'vitest'
import { MemoryRecord } from '../contracts/memory.js'
import { emptyMemoryRelationContext, type MemoryRelationContextRequest } from '../contracts/memory-working-context.js'
import { resolveMemoryTurnContext, type MemoryTurnStore } from './memory-turn-context.js'
import { assembleMemoryRelationContext } from './memory-working-context.js'
import { memoryInjectionMetadata, memoryContextBlocks } from '../loop/model-step-preparation-memory.js'

const record = (id: string, content = 'The project uses Postgres.') => MemoryRecord.parse({
  id, content, scope: 'user', createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z'
})
const annotation = {
  id: 'relation_' + 'a'.repeat(64), kind: 'contradicts' as const,
  source: { id: 'mem_a', revision: 1 }, target: { id: 'mem_b', revision: 1 },
  reviewedAt: '2026-10-20T00:00:00Z'
}
const input = { query: 'project database', workspace: '/synthetic-preview' }
function store() {
  return {
    retrieve: vi.fn(async () => [record('mem_a'), record('mem_b')]),
    listDirectives: vi.fn(async () => ({ records: [], excludedByBudget: [], truncatedIds: [], characters: 0 })),
    setLastInjected: vi.fn(),
    relationContext: vi.fn(async (_request: MemoryRelationContextRequest) => assembleMemoryRelationContext([annotation], 1600, true))
  } satisfies MemoryTurnStore
}

describe('shared relation context for turn paths', () => {
  it('keeps selection and ordering unchanged, rendering annotations as untrusted reference data', async () => {
    const memory = store()
    const result = await resolveMemoryTurnContext(memory, input)
    expect(result.memories.map((entry) => entry.id)).toEqual(['mem_a', 'mem_b'])
    expect(result.referenceBlocks[1]).toContain('untrusted="true" authority="reference"')
    expect(result.referenceBlocks[1]).toContain('do not choose a winner')
    expect(memory.relationContext).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'injection', selected: result.memories.map(({ id, revision, content }) => ({ id, revision, content }))
    }))
    expect(memoryInjectionMetadata({ ...result })).toMatchObject({ injectedMemoryRelations: [annotation] })
    expect(memoryContextBlocks({ memories: result.memories, directives: [], referenceBlocks: result.referenceBlocks }).map((block) => block.content))
      .toEqual(result.referenceBlocks)
  })

  it('preview uses the same rendering without recording injection or reading directives', async () => {
    const memory = store()
    const preview = await resolveMemoryTurnContext(memory, { ...input, preview: true })
    expect(memory.retrieve).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'preview' }))
    expect(memory.relationContext).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'preview' }))
    expect(memory.setLastInjected).not.toHaveBeenCalled()
    expect(memory.listDirectives).not.toHaveBeenCalled()
    const live = await resolveMemoryTurnContext(memory, input)
    expect(preview.referenceBlocks).toEqual(live.referenceBlocks)
  })

  it('disabled and failing enrichment leave the foundation reference block intact', async () => {
    const memory = store()
    memory.relationContext.mockResolvedValueOnce(emptyMemoryRelationContext())
    const disabled = await resolveMemoryTurnContext(memory, input)
    memory.relationContext.mockRejectedValueOnce(new Error('private-path-and-key'))
    const failed = await resolveMemoryTurnContext(memory, input)
    expect(failed.referenceBlocks).toEqual(disabled.referenceBlocks)
    expect(failed.relationContext?.state).toBe('unavailable')
    expect(JSON.stringify(failed)).not.toContain('private-path-and-key')
    expect(memoryInjectionMetadata({ ...failed }).injectedMemoryRelations).toEqual([])
  })

  it('bounds enrichment latency and supplies only the remaining prompt budget', async () => {
    const memory = store()
    memory.relationContext.mockImplementationOnce(async (request) => {
      expect(request.remainingCharacters).toBeLessThan(6000)
      return assembleMemoryRelationContext([annotation], request.remainingCharacters, true)
    })
    const result = await resolveMemoryTurnContext(memory, input)
    expect(result.referenceBlocks.join('\n').length).toBeLessThanOrEqual(6000)
    memory.relationContext.mockImplementationOnce(() => new Promise(() => {}))
    const timedOut = await resolveMemoryTurnContext(memory, input)
    expect(timedOut.relationContext?.state).toBe('unavailable')
    expect(timedOut.memories).toEqual(result.memories)
  })
})
