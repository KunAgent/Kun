import { describe, expect, it } from 'vitest'
import { hydrateThreadItems } from './hybrid-thread-projection.js'
import { createThreadRecord } from '../../domain/thread.js'
import { createTurnRecord } from '../../domain/turn.js'
import { makeUserItem } from '../../domain/item.js'

describe('hydrated durable queue order', () => {
  it('retains reordered queued turns while hydrating chronological session items', () => {
    const thread = createThreadRecord({ id: 'thread', title: 'queue', workspace: '/tmp/queue', model: 'test-model' })
    const b = { ...createTurnRecord({ id: 'b', threadId: thread.id, prompt: 'B' }), createdAt: '2026-09-01T00:00:00Z' }
    const c = { ...createTurnRecord({ id: 'c', threadId: thread.id, prompt: 'C' }), createdAt: '2026-09-01T00:00:01Z' }
    const result = hydrateThreadItems({ ...thread, turns: [c, b] }, [
      makeUserItem({ id: 'ib', threadId: thread.id, turnId: b.id, text: 'B' }),
      makeUserItem({ id: 'ic', threadId: thread.id, turnId: c.id, text: 'C' })
    ], { preserveExistingItemsWhenNoFileItems: true })
    expect(result.turns.map((turn) => turn.id)).toEqual(['c', 'b'])
    expect(result.turns.map((turn) => turn.prompt)).toEqual(['C', 'B'])
  })
})
