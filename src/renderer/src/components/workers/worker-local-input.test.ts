import { describe, expect, it, vi } from 'vitest'
import type { AgentProvider } from '../../agent/types'
import { sendWorkerLocalInput } from './worker-local-input'

describe('sendWorkerLocalInput', () => {
  it('awaits host take-over before sending to the exact worker with durable queuing', async () => {
    let acknowledge!: () => void
    const order: string[] = []
    const controlTeamWorker = vi.fn(() => new Promise<void>((resolve) => {
      acknowledge = () => { order.push('control'); resolve() }
    }))
    const sendUserMessage = vi.fn(async () => {
      order.push('send')
      return { threadId: 'worker-a', turnId: 'turn-a', status: 'queued' as const, queuedPosition: 1 }
    })
    const provider = { controlTeamWorker, sendUserMessage } as unknown as AgentProvider
    const sending = sendWorkerLocalInput({
      provider,
      workerId: 'worker-a',
      text: 'Fix the API',
      attachmentIds: ['attachment-a'],
      clientRequestId: 'turn-request-a'
    })
    expect(controlTeamWorker).toHaveBeenCalledWith('worker-a', 'take-over')
    expect(sendUserMessage).not.toHaveBeenCalled()
    acknowledge()
    await expect(sending).resolves.toMatchObject({ status: 'queued', queuedPosition: 1 })
    expect(order).toEqual(['control', 'send'])
    expect(sendUserMessage).toHaveBeenCalledWith('worker-a', 'Fix the API', {
      clientRequestId: 'turn-request-a',
      enqueueIfBusy: true,
      agentSurface: 'code',
      attachmentIds: ['attachment-a']
    })
  })

  it('does not send if take-over fails', async () => {
    const sendUserMessage = vi.fn()
    const provider = {
      controlTeamWorker: vi.fn().mockRejectedValue(new Error('control refused')),
      sendUserMessage
    } as unknown as AgentProvider
    await expect(sendWorkerLocalInput({
      provider, workerId: 'worker-a', text: 'hello', attachmentIds: [], clientRequestId: 'turn-request-a'
    })).rejects.toThrow('control refused')
    expect(sendUserMessage).not.toHaveBeenCalled()
  })

  it('reconciles an uncertain admission using the same request ID', async () => {
    const sendUserMessage = vi.fn().mockRejectedValue(new Error(JSON.stringify({
      code: 'queue_admission_uncertain', message: 'confirm again'
    })))
    const getQueuedTurns = vi.fn(async () => ({
      queuedTurns: [{ turnId: 'queued-a', clientRequestId: 'turn-request-a', position: 0, createdAt: '2026-01-01' }]
    }))
    const provider = {
      controlTeamWorker: vi.fn(async () => undefined),
      sendUserMessage,
      getQueuedTurns
    } as unknown as AgentProvider
    await expect(sendWorkerLocalInput({
      provider, workerId: 'worker-a', text: 'hello', attachmentIds: [], clientRequestId: 'turn-request-a'
    })).resolves.toMatchObject({ turnId: 'queued-a', status: 'queued' })
    expect(sendUserMessage).toHaveBeenCalledTimes(1)
    expect(getQueuedTurns).toHaveBeenCalledWith('worker-a')
  })
})
