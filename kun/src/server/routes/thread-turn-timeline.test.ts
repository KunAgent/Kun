import { describe, expect, it, vi } from 'vitest'
import { createThreadRecord } from '../../domain/thread.js'
import { createTurnRecord } from '../../domain/turn.js'
import { makeAssistantTextItem, makeUserItem } from '../../domain/item.js'
import { InMemorySessionStore } from '../../adapters/in-memory-session-store.js'
import type { ThreadService } from '../../services/thread-service.js'
import { getThreadTimeline } from './threads.js'
import { threadTimelineReadKey } from './thread-timeline-read-key.js'

describe('exact-turn readonly timeline', () => {
  it('hydrates only the requested historical turn without healing durable running items', async () => {
    const thread = createThreadRecord({ id: 'thread', model: 'deepseek-chat', workspace: '/tmp', title: 'Test' })
    thread.turns = ['old', 'new'].map((id) => createTurnRecord({ id, threadId: thread.id, prompt: id, status: 'completed' }))
    const store = new InMemorySessionStore()
    for (const turn of thread.turns) {
      await store.appendItem(thread.id, makeUserItem({ id: `user_${turn.id}`, threadId: thread.id, turnId: turn.id, text: turn.id }))
      await store.appendItem(thread.id, makeAssistantTextItem({ id: `answer_${turn.id}`, threadId: thread.id, turnId: turn.id, text: 'answer', status: 'running' }))
    }
    const write = vi.spyOn(store, 'appendItem')
    const fullRead = vi.spyOn(store, 'loadItems')
    const service = { get: async () => thread } as unknown as ThreadService
    const response = await getThreadTimeline(service, thread.id, new Request('http://kun.local/timeline?turnId=old'), store)
    expect(response.status).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.turns.map((turn: { id: string }) => turn.id)).toEqual(['old'])
    expect(body.turns[0].items.map((item: { id: string }) => item.id)).toEqual(['user_old', 'answer_old'])
    expect(body.latestTurn.id).toBe('old')
    expect(body.activeTurn).toBeNull()
    expect(write).not.toHaveBeenCalled()
    expect(fullRead).not.toHaveBeenCalled()
    const missing = await getThreadTimeline(service, thread.id, new Request('http://kun.local/timeline?turnId=missing'), store)
    expect(missing.status).toBe(404)
    expect(JSON.parse(missing.body)).toMatchObject({ code: 'not_found' })
  })

  it('separates read-coalescing identities and rejects empty turn IDs', () => {
    const key = (query: string) => threadTimelineReadKey('thread', new URL(`http://kun.local/timeline?${query}`))
    expect(key('turnId=old')).not.toBe(key('turnId=new'))
    expect(key('turnId=old')).not.toBe(key(''))
    expect(key('turnId=old&limit=3')).toBe(key('limit=3&turnId=old'))
    expect(key('turnId=')).toContain('raw:')
  })
})
