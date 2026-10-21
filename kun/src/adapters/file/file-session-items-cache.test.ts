import { describe, expect, it } from 'vitest'
import type { TurnItem } from '../../contracts/items.js'
import { makeAssistantTextItem } from '../../domain/item.js'
import { ItemsCache } from './file-session-items-cache.js'
import { serializedArrayBytesUpTo } from './file-session-jsonl.js'

const item = (index: number, text: string) => makeAssistantTextItem({
  id: `item_${index}`, threadId: 'thread', turnId: 'turn', text, status: 'completed'
})

describe('size-capped item history caching', () => {
  it('measures the exact JSON size of a history that fits', () => {
    for (const values of [[], [item(0, 'a')], [item(0, 'é🙂'), item(1, 'x'.repeat(100))]]) {
      expect(serializedArrayBytesUpTo(values, 1_000_000)).toBe(Buffer.byteLength(JSON.stringify(values)))
    }
  })

  it('stops serializing once a history is over the limit', () => {
    let serialized = 0
    const values = Array.from({ length: 100 }, (_, index) => ({
      toJSON: () => { serialized += 1; return item(index, 'x'.repeat(1_000)) }
    }))
    expect(serializedArrayBytesUpTo(values, 3_000)).toBeGreaterThan(3_000)
    expect(serialized).toBeLessThan(5)
  })

  it('admits a small history at its exact size and rejects a large one', () => {
    const cache = new ItemsCache(4, 4_096)
    const small = [item(0, 'small')]
    cache.set('small', small)
    expect(cache.stats().bytes).toBe(Buffer.byteLength(JSON.stringify(small)))

    let serialized = 0
    const large = Array.from({ length: 1_000 }, (_, index) => ({
      toJSON: () => { serialized += 1; return item(index, 'x'.repeat(1_000)) }
    })) as unknown as TurnItem[]
    cache.set('large', large)
    expect(cache.get('large')).toBeUndefined()
    expect(serialized).toBeLessThan(5)
  })
})
