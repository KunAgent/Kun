import { describe, expect, it, vi } from 'vitest'
import type { MemoryFeedbackEvent } from '../contracts/memory-feedback.js'
import { recordRetrieved } from './memory-retrieval-feedback.js'

describe('recordRetrieved', () => {
  it('records one stable content-free event per final selected id', async () => {
    const events: MemoryFeedbackEvent[] = []
    const feedback = {
      enabled: () => true,
      append: vi.fn(async (event: MemoryFeedbackEvent) => { events.push(event) })
    }
    const input = {
      feedback,
      selectedIds: ['mem_1', 'mem_1', 'mem_2'],
      threadId: 'thread_1',
      turnId: 'turn_1',
      occurredAt: '2026-09-15T03:00:00.000Z'
    }

    await recordRetrieved(input)
    const firstIds = events.map((event) => event.id)
    await recordRetrieved(input)

    expect(events).toHaveLength(4)
    expect(events.slice(0, 2).map((event) => event.id)).toEqual(firstIds)
    expect(events.slice(0, 2).map((event) => event.memoryId)).toEqual(['mem_1', 'mem_2'])
    expect(JSON.stringify(events)).not.toMatch(/content|query|workspace|project/iu)
  })

  it('does nothing when disabled and contains adapter failures', async () => {
    const append = vi.fn(async () => { throw new Error('ledger unavailable') })
    await expect(recordRetrieved({
      feedback: { enabled: () => false, append },
      selectedIds: ['mem_1'],
      threadId: 'thread_1',
      turnId: 'turn_1',
      occurredAt: '2026-09-15T03:00:00.000Z'
    })).resolves.toBeUndefined()
    expect(append).not.toHaveBeenCalled()

    await expect(recordRetrieved({
      feedback: { enabled: () => true, append },
      selectedIds: ['mem_1'],
      threadId: 'thread_1',
      turnId: 'turn_1',
      occurredAt: '2026-09-15T03:00:00.000Z'
    })).resolves.toBeUndefined()
    expect(append).toHaveBeenCalledOnce()

    await expect(recordRetrieved({
      feedback: {
        enabled: () => { throw new Error('configuration unavailable') },
        append
      },
      selectedIds: ['mem_1'],
      threadId: 'thread_1',
      turnId: 'turn_1',
      occurredAt: '2026-09-15T03:00:00.000Z'
    })).resolves.toBeUndefined()
  })
})
