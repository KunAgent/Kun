import { describe, expect, it } from 'vitest'
import { makeAssistantTextItem } from '../../domain/item.js'
import { ItemsCache } from './file-session-items-cache.js'

const item = (text: string) => makeAssistantTextItem({
  id: 'assistant', threadId: 'thread', turnId: 'turn', text, status: 'completed'
})

describe('ItemsCache bounded admission sizing', () => {
  it('accounts exactly for array punctuation and UTF-8 bytes at the per-thread budget', () => {
    const items = [item('a"\\\n'), { ...item('\u4e2d\u6587'), id: 'second' }]
    const bytes = Buffer.byteLength(JSON.stringify(items))
    const cache = new ItemsCache(2, bytes * 2)
    cache.set('thread', items)
    expect(cache.get('thread')).toEqual(items)
    expect(cache.stats().bytes).toBe(bytes)
    const smaller = new ItemsCache(2, bytes * 2 - 1)
    smaller.set('thread', items)
    expect(smaller.stats().entries).toBe(0)
  })

  it('stops traversing an oversized history as soon as the budget is exceeded', () => {
    const cache = new ItemsCache(2, 1024)
    cache.set('thread', [item('small')])
    expect(cache.get('thread')).toBeDefined()
    const unread = item('not needed')
    Object.defineProperty(unread, 'text', { get() { throw new Error('unbounded cache sizing') } })
    cache.set('thread', [item('x'.repeat(1024)), unread])
    expect(cache.get('thread')).toBeUndefined()
    expect(cache.stats().bytes).toBe(0)
  })
})
