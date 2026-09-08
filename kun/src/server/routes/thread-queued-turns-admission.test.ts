import { describe, expect, it } from 'vitest'
import { createThreadRecord } from '../../domain/thread.js'
import { createTurnRecord } from '../../domain/turn.js'
import type { ThreadService } from '../../services/thread-service.js'
import type { TurnService } from '../../services/turn-service.js'
import { QueueAdmissionUncertainError } from '../../services/queue-admission.js'
import { getQueuedTurns } from './thread-queued-turns.js'
import { startTurn } from './turns.js'

describe('queue admission HTTP contract', () => {
  it('separates pending metadata, executable queue and failed outcomes without returning prompts', async () => {
    const thread = createThreadRecord({ id: 'thread', title: 'test', workspace: '/tmp', model: 'test' })
    thread.turns = [
      { ...createTurnRecord({ id: 'pending', threadId: 'thread', prompt: 'private', clientRequestId: 'req-pending' }), status: 'queued', admissionPending: true },
      { ...createTurnRecord({ id: 'queued', threadId: 'thread', prompt: 'private', clientRequestId: 'req-queued' }), status: 'queued', admissionCompletedAt: new Date().toISOString() },
      { ...createTurnRecord({ id: 'failed', threadId: 'thread', prompt: 'private', clientRequestId: 'req-failed' }), status: 'failed', terminalCode: 'model_failed' }
    ]
    const response = await getQueuedTurns({ getMetadata: async () => thread } as unknown as ThreadService, 'thread')
    const body = JSON.parse(response.body)
    expect(body.queuedTurns.map((turn: { turnId: string }) => turn.turnId)).toEqual(['queued'])
    expect(body.pendingAdmissions).toMatchObject([{ turnId: 'pending', clientRequestId: 'req-pending' }])
    expect(body.settledTurns).toMatchObject([{ turnId: 'failed', terminalCode: 'model_failed' }])
    expect(response.body).not.toContain('private')
  })

  it('returns a retryable exact-request receipt when persistence is uncertain', async () => {
    const turns = { startTurn: async () => { throw new QueueAdmissionUncertainError('req', 'persist', new Error('private manager error')) } }
    const response = await startTurn(turns as unknown as TurnService, 'thread', new Request('http://local/turns', {
      method: 'POST', body: JSON.stringify({ prompt: 'hi', clientRequestId: 'req', enqueueIfBusy: true })
    }))
    expect(response.status).toBe(503)
    const body = response instanceof Response ? await response.json() : JSON.parse(response.body)
    expect(body).toMatchObject({ code: 'queue_admission_uncertain', details: { clientRequestId: 'req', stage: 'persist', retryable: true } })
    expect(JSON.stringify(body)).not.toContain('private manager error')
  })
})
