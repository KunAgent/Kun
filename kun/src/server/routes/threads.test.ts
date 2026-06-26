import { describe, expect, it } from 'vitest'
import { getThread } from './threads.js'
import { createThreadRecord } from '../../domain/thread.js'
import { InMemoryUserInputGate } from '../../adapters/in-memory-user-input-gate.js'
import type { ThreadService } from '../../services/thread-service.js'

function serviceWith(threadId: string): ThreadService {
  const record = createThreadRecord({
    id: threadId,
    title: 'Demo',
    workspace: '/tmp',
    model: 'deepseek-chat',
    status: 'running'
  })
  return {
    get: async (id: string) => (id === threadId ? record : null)
  } as unknown as ThreadService
}

describe('getThread pendingUserInputIds (#606)', () => {
  it('reports request ids the user-input gate is still awaiting for the thread', async () => {
    const gate = new InMemoryUserInputGate()
    // request() returns a promise that stays pending until resolved; we only
    // care that the request is now addressable in the gate.
    void gate
      .request({
        id: 'in_live',
        threadId: 'thr_1',
        turnId: 'turn_1',
        itemId: 'item_input',
        prompt: 'north or south?',
        questions: []
      })
      .catch(() => undefined)
    // A request for a different thread must not leak into this thread's list.
    void gate
      .request({
        id: 'in_other',
        threadId: 'thr_2',
        turnId: 'turn_x',
        itemId: 'item_x',
        prompt: 'unrelated',
        questions: []
      })
      .catch(() => undefined)

    const response = await getThread(serviceWith('thr_1'), 'thr_1', undefined, gate)
    const body = JSON.parse(response.body)
    expect(body.pendingUserInputIds).toEqual(['in_live'])
  })

  it('reports an empty list when nothing is awaiting (finished thread)', async () => {
    const response = await getThread(serviceWith('thr_1'), 'thr_1', undefined, new InMemoryUserInputGate())
    const body = JSON.parse(response.body)
    expect(body.pendingUserInputIds).toEqual([])
  })

  it('omits no field when no gate is provided', async () => {
    const response = await getThread(serviceWith('thr_1'), 'thr_1')
    const body = JSON.parse(response.body)
    expect(body.pendingUserInputIds).toEqual([])
  })
})
