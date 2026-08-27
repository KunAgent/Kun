import { describe, expect, it, vi } from 'vitest'
import { InMemoryUserInputGate } from '../../adapters/in-memory-user-input-gate.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import { resolveUserInput } from './user-inputs.js'

describe('resolveUserInput', () => {
  it('accepts structured multi-select answers and records them on the resolved event', async () => {
    const gate = new InMemoryUserInputGate()
    const pending = gate.request({
      id: 'input_1',
      threadId: 'thread_1',
      turnId: 'turn_1',
      itemId: 'item_input_1',
      prompt: 'Pick requirements',
      questions: [
        {
          header: 'Requirements',
          id: 'requirements',
          question: 'Pick requirements',
          options: [
            { label: 'Keep ratio', description: '' },
            { label: 'App icon', description: '' }
          ],
          selectionMode: 'multiple',
          minSelections: 1,
          maxSelections: 2
        }
      ]
    })
    const events = {
      record: vi.fn(async (event) => event)
    } as unknown as RuntimeEventRecorder
    const answers = [
      {
        id: 'requirements',
        label: 'Keep ratio, App icon',
        value: 'Keep ratio, App icon',
        labels: ['Keep ratio', 'App icon'],
        values: ['Keep ratio', 'App icon']
      }
    ]

    const response = await resolveUserInput({
      inputId: 'input_1',
      request: new Request('http://127.0.0.1/v1/user-inputs/input_1', {
        method: 'POST',
        body: JSON.stringify({ answers })
      }),
      gate,
      events
    })

    expect(response.status).toBe(200)
    await expect(pending).resolves.toEqual({ status: 'submitted', answers })
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'user_input_resolved',
        inputId: 'input_1',
        status: 'submitted',
        questions: expect.arrayContaining([
          expect.objectContaining({ id: 'requirements', selectionMode: 'multiple' })
        ]),
        answers
      })
    )
  })

  it('keeps an accepted submission authoritative while its resolved event is persisted', async () => {
    const gate = new InMemoryUserInputGate()
    const pending = gate.request({
      id: 'input_1',
      threadId: 'thread_1',
      turnId: 'turn_1',
      itemId: 'item_input_1',
      prompt: 'Continue?',
      questions: []
    })
    let releaseRecord!: () => void
    const recordStarted = new Promise<void>((resolve) => { releaseRecord = resolve })
    const events = {
      record: vi.fn(async () => recordStarted)
    } as unknown as RuntimeEventRecorder

    const responsePromise = resolveUserInput({
      inputId: 'input_1',
      request: new Request('http://127.0.0.1/v1/user-inputs/input_1', {
        method: 'POST',
        body: JSON.stringify({ answers: [] })
      }),
      gate,
      events
    })
    await vi.waitFor(() => expect(events.record).toHaveBeenCalledTimes(1))

    // A turn abort racing after validation must not supersede the submission
    // whose event is already in flight.
    expect(gate.resolve('input_1', { status: 'cancelled' })).toBe('claimed')
    releaseRecord()

    await expect(responsePromise).resolves.toMatchObject({ status: 200 })
    await expect(pending).resolves.toEqual({ status: 'submitted', answers: [] })
  })

  it('accepts a non-empty typed Other answer for an option question', async () => {
    const gate = new InMemoryUserInputGate()
    const pending = gate.request({
      id: 'input_other',
      threadId: 'thread_1',
      turnId: 'turn_1',
      itemId: 'item_input_other',
      prompt: 'Choose a target',
      questions: [{
        header: 'Target',
        id: 'target',
        question: 'Choose a target',
        options: [{ label: 'Web', description: '' }]
      }]
    })
    const events = { record: vi.fn(async (event) => event) } as unknown as RuntimeEventRecorder
    const answers = [{ id: 'target', label: 'Other', value: 'Terminal' }]

    const response = await resolveUserInput({
      inputId: 'input_other',
      request: new Request('http://127.0.0.1/v1/user-inputs/input_other', {
        method: 'POST',
        body: JSON.stringify({ answers })
      }),
      gate,
      events
    })

    expect(response.status).toBe(200)
    await expect(pending).resolves.toEqual({ status: 'submitted', answers })
  })

  it('settles an expired request after the claimed submission event fails to persist', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-22T00:00:00.000Z'))
      const gate = new InMemoryUserInputGate()
      const pending = gate.request({
        id: 'input_timeout_race',
        threadId: 'thread_1',
        turnId: 'turn_1',
        itemId: 'item_timeout_race',
        prompt: 'Continue?',
        questions: [],
        timeoutSeconds: 1,
        deadlineAtMs: Date.now() + 1_000
      })
      let rejectRecord!: (error: Error) => void
      const recordStarted = new Promise<void>((_resolve, reject) => { rejectRecord = reject })
      const events = {
        record: vi.fn(async () => recordStarted)
      } as unknown as RuntimeEventRecorder

      const responsePromise = resolveUserInput({
        inputId: 'input_timeout_race',
        request: new Request('http://127.0.0.1/v1/user-inputs/input_timeout_race', {
          method: 'POST',
          body: JSON.stringify({ answers: [] })
        }),
        gate,
        events
      })
      await vi.waitFor(() => expect(events.record).toHaveBeenCalledTimes(1))
      vi.setSystemTime(new Date('2026-08-22T00:00:01.100Z'))
      expect(gate.resolve('input_timeout_race', { status: 'timeout' })).toBe('claimed')

      rejectRecord(new Error('disk full'))
      await expect(responsePromise).rejects.toThrow('disk full')
      await expect(pending).resolves.toEqual({ status: 'timeout' })
      expect(gate.resolve('input_timeout_race', { status: 'submitted', answers: [] })).toBe('missing')
    } finally {
      vi.useRealTimers()
    }
  })
})
