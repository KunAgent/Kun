import { beforeEach, describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import {
  EMPTY_THREAD_ACTIVATION_STORAGE_KEY,
  MAX_EMPTY_THREAD_ACTIVATION_ENTRIES,
  clearSidebarThreadPromotion,
  emptyThreadActivatedAtMs,
  forgetEmptyThreadActivations,
  hydrateEmptyThreadActivations,
  matchingSidebarThreadPromotions,
  normalizeEmptyThreadActivationRegistry,
  noteEmptyThreadActivated,
  readEmptyThreadActivationRegistry,
  requestSidebarThreadPromotion,
  resetSidebarThreadPromotions,
  threadDisplayUpdatedAt,
  threadDisplayUpdatedAtMs
} from './empty-thread-activation'

class MemoryStorage {
  values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const thread = (id: string, updatedAt: string): Pick<NormalizedThread, 'id' | 'updatedAt'> => ({
  id,
  updatedAt
})

describe('empty thread activation registry', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
    hydrateEmptyThreadActivations(storage)
    resetSidebarThreadPromotions()
  })

  it('keeps the real creation time as the display time until a New-session click', () => {
    const row = thread('t1', '2026-10-27T04:00:00.000Z')
    expect(threadDisplayUpdatedAt(row)).toBe('2026-10-27T04:00:00.000Z')
    noteEmptyThreadActivated('t1', Date.parse('2026-10-27T05:00:00.000Z'), storage)
    expect(threadDisplayUpdatedAt(row)).toBe('2026-10-27T05:00:00.000Z')
    expect(threadDisplayUpdatedAtMs(row)).toBe(Date.parse('2026-10-27T05:00:00.000Z'))
    // The thread's own timestamp is never rewritten.
    expect(row.updatedAt).toBe('2026-10-27T04:00:00.000Z')
  })

  it('never moves display time backwards once real content is newer', () => {
    noteEmptyThreadActivated('t1', Date.parse('2026-10-27T05:00:00.000Z'), storage)
    expect(threadDisplayUpdatedAt(thread('t1', '2026-10-27T06:00:00.000Z')))
      .toBe('2026-10-27T06:00:00.000Z')
  })

  it('persists, hydrates and forgets activations', () => {
    noteEmptyThreadActivated('t1', Date.parse('2026-10-27T05:00:00.000Z'), storage)
    expect(JSON.parse(storage.getItem(EMPTY_THREAD_ACTIVATION_STORAGE_KEY) ?? '{}')).toEqual({
      version: 1,
      activatedAt: { t1: '2026-10-27T05:00:00.000Z' }
    })
    hydrateEmptyThreadActivations(storage)
    expect(emptyThreadActivatedAtMs('t1')).toBe(Date.parse('2026-10-27T05:00:00.000Z'))
    forgetEmptyThreadActivations('t1', storage)
    expect(emptyThreadActivatedAtMs('t1')).toBe(0)
    expect(readEmptyThreadActivationRegistry(storage).activatedAt).toEqual({})
  })

  it('keeps only the newest entries and ignores malformed rows', () => {
    const activatedAt: Record<string, string> = {}
    for (let i = 0; i < MAX_EMPTY_THREAD_ACTIVATION_ENTRIES + 5; i += 1) {
      activatedAt[`t${i}`] = new Date(Date.parse('2026-01-01T00:00:00.000Z') + i * 1000).toISOString()
    }
    activatedAt[''] = '2026-01-02T00:00:00.000Z'
    activatedAt.broken = 'not a date'
    const registry = normalizeEmptyThreadActivationRegistry({ activatedAt })
    expect(Object.keys(registry.activatedAt)).toHaveLength(MAX_EMPTY_THREAD_ACTIVATION_ENTRIES)
    expect(registry.activatedAt.t0).toBeUndefined()
    expect(registry.activatedAt.broken).toBeUndefined()
    expect(normalizeEmptyThreadActivationRegistry('nope')).toEqual({ version: 1, activatedAt: {} })
  })

  it('survives a storage that rejects writes', () => {
    const failing = {
      getItem: () => null,
      setItem: () => { throw new Error('quota') }
    }
    expect(() => noteEmptyThreadActivated('t1', Date.parse('2026-10-27T05:00:00.000Z'), failing)).not.toThrow()
    expect(emptyThreadActivatedAtMs('t1')).toBe(Date.parse('2026-10-27T05:00:00.000Z'))
  })
})

describe('sidebar promotion requests', () => {
  beforeEach(() => resetSidebarThreadPromotions())

  it('only reports rows that belong to the reconciling container', () => {
    requestSidebarThreadPromotion('t2')
    expect(matchingSidebarThreadPromotions(['t1', 't3'])).toEqual([])
    expect(matchingSidebarThreadPromotions(['t1', 't2'])).toEqual(['t2'])
    // Consuming is explicit so the owning container can apply it first.
    expect(matchingSidebarThreadPromotions(['t2'])).toEqual(['t2'])
    clearSidebarThreadPromotion('t2')
    expect(matchingSidebarThreadPromotions(['t2'])).toEqual([])
  })

  it('orders multiple requests oldest first and expires stale ones', () => {
    requestSidebarThreadPromotion('t1', 1_000)
    requestSidebarThreadPromotion('t2', 2_000)
    expect(matchingSidebarThreadPromotions(['t1', 't2'], 3_000)).toEqual(['t1', 't2'])
    expect(matchingSidebarThreadPromotions(['t1'], 1_000 + 6 * 60_000)).toEqual([])
  })
})
