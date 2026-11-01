import { describe, expect, it, vi } from 'vitest'
import { bootstrapThread, makeHarness, makeSilentModel } from '../../tests/loop-test-harness.js'
import { ServiceManagerTransportError } from '../manager/usage-errors.js'
import type { ModelClient } from '../ports/model-client.js'

describe('AgentLoop data-service disconnect cleanup', () => {
  it('releases execution admission even when the first read and terminal persistence both fail', async () => {
    const h = makeHarness(makeSilentModel())
    await bootstrapThread(h)
    expect(h.turns.isTurnExecutionActive(h.turnId)).toBe(true)
    const error = new ServiceManagerTransportError('socket_closed', 'Kun Service Manager connection failed.')
    const read = vi.spyOn(h.threadStore, 'get').mockRejectedValue(error)
    await expect(h.loop.runTurn(h.threadId, h.turnId)).rejects.toBe(error)
    expect(h.turns.isTurnExecutionActive(h.turnId)).toBe(false)
    expect(h.inflight.size()).toBe(0)
    read.mockRestore()
  })

  it('records a precise terminal failure when the data service recovers after the initial read', async () => {
    const h = makeHarness(makeSilentModel())
    await bootstrapThread(h)
    const error = new ServiceManagerTransportError('socket_closed', 'Kun Service Manager connection failed.')
    vi.spyOn(h.threadStore, 'get').mockRejectedValueOnce(error)
    await expect(h.loop.runTurn(h.threadId, h.turnId)).rejects.toBe(error)
    const turn = await h.turns.getTurn(h.threadId, h.turnId)
    expect(turn).toMatchObject({ status: 'failed', terminalCode: 'service_manager_unavailable' })
    expect(h.turns.isTurnExecutionActive(h.turnId)).toBe(false)
  })

  it('keeps an in-turn Manager timeout typed so the turn stays resumable', async () => {
    const error = new ServiceManagerTransportError(
      'timeout',
      'Kun Service Manager connection failed (timeout; 30000ms).'
    )
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      // eslint-disable-next-line require-yield
      async *stream() { throw error }
    }
    const h = makeHarness(model)
    await bootstrapThread(h)
    expect(await h.loop.runTurn(h.threadId, h.turnId)).toBe('failed')
    const turn = await h.turns.getTurn(h.threadId, h.turnId)
    expect(turn).toMatchObject({ status: 'failed', terminalCode: 'service_manager_unavailable' })
    expect(turn?.error).toContain('error=Kun Service Manager connection failed (timeout; 30000ms).')
  })
})
