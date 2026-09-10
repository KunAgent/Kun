import { describe, expect, it, vi } from 'vitest'
import { confirmQueueAdmission } from './queue-admission-recovery'
import { reconcileQueuedMessages } from './queued-message-persistence'
import type { AgentProvider } from '../agent/types'

const uncertain = () => new Error(JSON.stringify({ code: 'queue_admission_uncertain', message: 'Confirm again' }))
const row = { id: 'q', text: 'hi', clientRequestId: 'request-hi', deliveryState: 'starting' as const }

describe('queue admission confirmation', () => {
  it.each(['absent', 'pending'])('retries the exact request while an unrelated turn is running (%s)', async (state) => {
    const send = vi.fn().mockRejectedValueOnce(uncertain()).mockResolvedValue({ turnId: 'hi', status: 'queued' })
    const provider = { getQueuedTurns: async () => ({ queuedTurns: [],
      settledTurns: [{ turnId: 'first', clientRequestId: 'request-first', status: 'running' }],
      pendingAdmissions: state === 'pending' ? [{ turnId: 'hi', clientRequestId: row.clientRequestId }] : []
    }) } as unknown as AgentProvider
    const result = await confirmQueueAdmission({ provider, threadId: 'thread', clientRequestId: row.clientRequestId, send, wait: async () => {} })
    expect(result.turnId).toBe('hi')
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('acknowledges a lost response only for the matching committed admission', async () => {
    const send = vi.fn().mockRejectedValue(uncertain())
    const provider = { getQueuedTurns: async () => ({ queuedTurns: [{ turnId: 'hi', clientRequestId: row.clientRequestId }] }) } as unknown as AgentProvider
    expect(await confirmQueueAdmission({ provider, threadId: 'thread', clientRequestId: row.clientRequestId, send }))
      .toMatchObject({ turnId: 'hi', status: 'queued' })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('bounds retries when both admission and lookup remain unavailable', async () => {
    const send = vi.fn().mockRejectedValue(uncertain()), wait = vi.fn(async () => {})
    const provider = { getQueuedTurns: async () => { throw new Error('offline') } } as unknown as AgentProvider
    await expect(confirmQueueAdmission({ provider, threadId: 'thread', clientRequestId: row.clientRequestId, send, wait })).rejects.toThrow()
    expect(send).toHaveBeenCalledTimes(5)
    expect(wait.mock.calls.flat()).toEqual([1000, 2000, 4000, 5000])
  })

  it('keeps pending admissions unconfirmed and committed failures visible', () => {
    const state = { busy: true, turnId: 'unrelated', blocks: [] }
    expect(reconcileQueuedMessages([row], state, [{ turnId: 'hi', clientRequestId: row.clientRequestId, status: 'admission_pending' }]))
      .toMatchObject([{ deliveryState: 'starting', deliveryTurnId: 'hi' }])
    expect(reconcileQueuedMessages([row], state, [{ turnId: 'hi', clientRequestId: row.clientRequestId, status: 'failed', terminalCode: 'model_error' }]))
      .toMatchObject([{ deliveryState: 'failed', errorCode: 'model_error' }])
    for (const status of ['running', 'completed', 'aborted']) {
      expect(reconcileQueuedMessages([row], state, [{ turnId: 'hi', clientRequestId: row.clientRequestId, status }])).toEqual([])
    }
    expect(reconcileQueuedMessages([{ ...row, deliveryState: 'in_flight', deliveryTurnId: 'gone' }], { busy: false }, []))
      .toMatchObject([{ deliveryState: 'pending', clientRequestId: row.clientRequestId }])
  })
})
