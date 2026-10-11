import { describe, expect, it } from 'vitest'
import type { ToolHostContext } from '../ports/tool-host.js'
import { completed, harness, input, prepared } from '../../tests/loop-cases/round-outcome-support.cases.js'

const roomContext = { roomStepKind: 'conversation', roomAgent: true } as ToolHostContext
const delivery = (phase: 'start' | 'progress' | 'none', overrides: Record<string, unknown> = {}) => prepared({
  toolDiscoveryContext: roomContext,
  privateDelivery: { gate: phase, communicationRequired: true, published: phase !== 'start',
    finalResponseRequired: true, waitingOnUser: false, finalCurrent: false, workSinceVisible: 0, ...overrides }
})

describe('private Room public response boundary', () => {
  it('suppresses 44 work calls and dispatches only the first public response', async () => {
    const h = harness({ ordinaryResults: [{ output: { accepted: true, phase: 'start' }, isError: false }] })
    const business = Array.from({ length: 44 }, (_, n) => ({ callId: `bash-${n}`, toolName: 'bash',
      arguments: { command: 'echo work' } }))
    const message = { callId: 'say', toolName: 'send_im_message', arguments: { text: 'I will inspect the logs.', phase: 'start' } }
    await expect(h.coordinator.resolve(input(completed({ toolCalls: [...business, message] }), {
      prepared: delivery('start')
    }))).resolves.toBe('continue')
    expect(h.suppressToolCalls).toHaveBeenCalledOnce()
    const [suppressed] = h.suppressToolCalls.mock.lastCall as unknown as [{ calls: unknown[] }]
    expect(suppressed.calls).toHaveLength(44)
    expect(h.dispatches.map((entry) => entry.calls.map((call) => call.toolName))).toEqual([['send_im_message']])
  })

  it('fails after bounded missing-response recovery without dispatching work', async () => {
    const h = harness()
    const request = input(completed({ text: 'I will start now.' }), {
      prepared: delivery('start'), toolKinds: new Map([['send_im_message', 'tool_call']])
    })
    expect(await h.coordinator.resolve(request)).toBe('continue')
    expect(await h.coordinator.resolve(request)).toBe('continue')
    expect(await h.coordinator.resolve(request)).toBe('failed')
    expect(h.dispatches).toHaveLength(0)
    expect(h.failures).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'im_final_missing' })]))
  })

  it('bounds retries when the publication tool itself fails', async () => {
    const h = harness({ ordinaryResults: Array.from({ length: 3 }, () => ({ output: { error: 'persistence failed' }, isError: true })) })
    const request = input(completed({ toolCalls: [{ callId: 'say', toolName: 'send_im_message', arguments: { text: 'Starting' } }] }), {
      prepared: delivery('start')
    })
    expect(await h.coordinator.resolve(request)).toBe('continue')
    expect(await h.coordinator.resolve(request)).toBe('continue')
    expect(await h.coordinator.resolve(request)).toBe('failed')
    expect(h.dispatches.every((entry) => entry.calls.every((call) => call.toolName === 'send_im_message'))).toBe(true)
  })

  it('does not mistake an already connected app for a visible connection card', async () => {
    const h = harness({ ordinaryResults: [{ output: { connected: true, serverId: 'gmail' }, isError: false }] })
    const request = input(completed({ toolCalls: [{ callId: 'app', toolName: 'request_app_connection',
      arguments: { serverId: 'gmail' } }] }), { prepared: delivery('start') })
    expect(await h.coordinator.resolve(request)).toBe('continue')
    expect(h.coordinator.imPublicationRecoverySteps(request.turnId)).toBe(1)
  })

  it('does not treat a start update as a final answer', async () => {
    const h = harness()
    const request = input(completed(), {
      prepared: delivery('none', { published: true, lastPhase: 'start' }),
      toolKinds: new Map([['send_im_message', 'tool_call']])
    })
    expect(await h.coordinator.resolve(request)).toBe('continue')
    expect(h.coordinator.imPublicationRecoverySteps(request.turnId)).toBe(1)
    expect(await h.coordinator.resolve(input(completed(), {
      prepared: delivery('none', { published: true, lastPhase: 'final', finalCurrent: true }),
      toolKinds: new Map([['send_im_message', 'tool_call']])
    }))).toBe('stop')
  })

  it('requires a final result after an app-connection continuation without requiring a new start', async () => {
    const h = harness()
    const request = input(completed(), { prepared: delivery('none', { communicationRequired: false,
      finalResponseRequired: true, published: false }), toolKinds: new Map([['send_im_message', 'tool_call']]) })
    expect(await h.coordinator.resolve(request)).toBe('continue')
  })
})
