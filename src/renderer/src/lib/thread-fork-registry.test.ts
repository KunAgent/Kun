import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import {
  emptyThreadForkRegistry,
  enrichThreadsWithForkInfo,
  forgetThreadFork,
  hydrateThreadForkRegistry,
  markThreadFork,
  readThreadForkRegistry,
  saveThreadForkRegistry
} from './thread-fork-registry'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function thread(id: string, title = id): NormalizedThread {
  return {
    id,
    title,
    updatedAt: '2026-05-24T00:00:00.000Z',
    model: 'auto',
    mode: 'agent',
    workspace: '/Users/zxy/workspace'
  }
}

describe('thread-fork-registry', () => {
  it('saves and restores fork lineage', () => {
    const storage = new MemoryStorage()
    const registry = markThreadFork(
      'child-thread',
      thread('parent-thread', 'Parent Thread'),
      {
        createdAt: '2026-05-25T00:00:00.000Z',
        forkedFromMessageCount: 12,
        forkedFromTurnCount: 3
      },
      emptyThreadForkRegistry()
    )

    saveThreadForkRegistry(registry, storage)
    const restored = readThreadForkRegistry(storage)

    expect(restored.forks['child-thread']).toEqual({
      parentThreadId: 'parent-thread',
      parentTitle: 'Parent Thread',
      createdAt: '2026-05-25T00:00:00.000Z',
      forkedFromMessageCount: 12,
      forkedFromTurnCount: 3
    })
  })

  it('enriches runtime threads with persisted fork metadata', () => {
    const registry = markThreadFork(
      'child-thread',
      thread('parent-thread', 'Parent Thread'),
      { forkedFromTurnCount: 2 },
      emptyThreadForkRegistry()
    )

    const enriched = enrichThreadsWithForkInfo(
      [thread('parent-thread', 'Parent Thread'), thread('child-thread', 'Parent Thread')],
      registry
    )

    expect(enriched.find((item) => item.id === 'child-thread')).toMatchObject({
      forkedFromThreadId: 'parent-thread',
      forkedFromTitle: 'Parent Thread',
      forkedFromTurnCount: 2
    })
  })

  it('hydrates future runtime lineage fields into the registry and drops missing children', () => {
    const registry = markThreadFork(
      'missing-child',
      thread('parent-thread', 'Old Parent'),
      {},
      emptyThreadForkRegistry()
    )
    const hydrated = hydrateThreadForkRegistry(
      [
        thread('parent-thread', 'Parent Thread'),
        {
          ...thread('child-thread', 'Parent Thread'),
          forkedFromThreadId: 'parent-thread',
          forkedFromTitle: 'Parent Thread',
          forkedFromMessageCount: 8
        }
      ],
      registry
    )

    expect(hydrated.forks['missing-child']).toBeUndefined()
    expect(hydrated.forks['child-thread']).toMatchObject({
      parentThreadId: 'parent-thread',
      parentTitle: 'Parent Thread',
      forkedFromMessageCount: 8
    })
  })

  it('forgets deleted fork children', () => {
    const registry = markThreadFork(
      'child-thread',
      thread('parent-thread', 'Parent Thread'),
      {},
      emptyThreadForkRegistry()
    )

    expect(forgetThreadFork('child-thread', registry).forks['child-thread']).toBeUndefined()
  })
})
