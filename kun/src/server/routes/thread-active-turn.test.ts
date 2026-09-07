import { describe, expect, it } from 'vitest'
import { createThreadRecord } from '../../domain/thread.js'
import { createTurnRecord } from '../../domain/turn.js'
import type { ThreadService } from '../../services/thread-service.js'
import { getThreadState } from './threads.js'

describe('active turn identity with durable queued siblings', () => {
  it.each(['running', 'completed'] as const)('separates a %s turn from the newest queued turn', async (status) => {
    const thread = createThreadRecord({
      id: 'thread', title: 'queue', workspace: '/tmp', model: 'test', status: 'running'
    })
    thread.turns = [
      createTurnRecord({ id: 'a', threadId: thread.id, prompt: 'first', status }),
      createTurnRecord({ id: 'b', threadId: thread.id, prompt: 'next', status: 'queued' })
    ]
    const service = { getMetadata: async () => thread } as unknown as ThreadService
    const response = await getThreadState(service, thread.id)
    const body = JSON.parse(response.body)
    expect(body.latestTurn.id).toBe('b')
    expect(body.activeTurn?.id ?? null).toBe(status === 'running' ? 'a' : null)
  })
})
