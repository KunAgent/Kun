import { describe, expect, it, vi } from 'vitest'
import type { SessionStore } from '../ports/session-store.js'
import { settleUserInputResolution } from './user-input-settlement.js'

function baseInput(overrides: Partial<Parameters<typeof settleUserInputResolution>[0]> = {}) {
  const updateItem = vi.fn(async () => null)
  const record = vi.fn(async () => ({ seq: 10 }) as never)
  const loadEventsSince = vi.fn(async () => [] as never[])
  const warn = vi.fn()
  return {
    turns: { updateItem },
    events: { record },
    sessionStore: { loadEventsSince } as unknown as SessionStore,
    threadId: 'thread_1',
    turnId: 'turn_1',
    itemId: 'item_in_1',
    inputId: 'in_1',
    prompt: 'Pick',
    questions: [],
    resolution: { status: 'submitted' as const, answers: [] },
    requestedSeq: 5,
    nowIso: () => '2026-09-27T00:00:00.000Z',
    warn,
    ...overrides
  }
}

describe('settleUserInputResolution', () => {
  it('marks the item terminal and records the resolution when nobody else did', async () => {
    const input = baseInput()
    await settleUserInputResolution(input)
    expect(input.turns.updateItem).toHaveBeenCalledWith(
      'thread_1',
      'item_in_1',
      expect.objectContaining({ status: 'submitted', answers: [] })
    )
    expect(input.events.record).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'user_input_resolved',
      status: 'submitted'
    }))
    expect(input.warn).not.toHaveBeenCalled()
  })

  it('bounds the dedup probe to events after the request seq', async () => {
    const loadEventsSince = vi.fn(async () => [] as never[])
    const input = baseInput({
      sessionStore: { loadEventsSince } as unknown as SessionStore,
      requestedSeq: 42
    })
    await settleUserInputResolution(input)
    expect(loadEventsSince).toHaveBeenCalledWith('thread_1', 42)
  })

  it('skips the resolved event when another writer already recorded it', async () => {
    const input = baseInput({
      sessionStore: {
        loadEventsSince: async () => [{ kind: 'user_input_resolved', inputId: 'in_1' }]
      } as unknown as SessionStore
    })
    await settleUserInputResolution(input)
    expect(input.turns.updateItem).toHaveBeenCalled()
    expect(input.events.record).not.toHaveBeenCalled()
  })

  it('records the resolution even when the dedup probe fails', async () => {
    const input = baseInput({
      sessionStore: {
        loadEventsSince: async () => { throw new Error('events log unreadable') }
      } as unknown as SessionStore
    })
    await settleUserInputResolution(input)
    expect(input.warn).toHaveBeenCalledWith(expect.stringContaining('probe failed'))
    expect(input.events.record).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'user_input_resolved'
    }))
  })

  it('propagates bookkeeping failures while the turn is alive', async () => {
    const input = baseInput({
      turns: { updateItem: vi.fn(async (): Promise<null> => { throw new Error('items log locked') }) }
    })
    await expect(settleUserInputResolution(input)).rejects.toThrow('items log locked')
    expect(input.warn).toHaveBeenCalledWith(expect.stringContaining('settlement failed'))
  })

  it('returns immediately on abort while terminal writes continue detached', async () => {
    const controller = new AbortController()
    let releaseUpdate: () => void = () => undefined
    const updateItem = vi.fn(() => {
      controller.abort()
      return new Promise<null>((resolve) => { releaseUpdate = () => resolve(null) })
    })
    const input = baseInput({
      turns: { updateItem },
      signal: controller.signal
    })
    await settleUserInputResolution(input)
    expect(input.warn).toHaveBeenCalledWith(expect.stringContaining('detached on abort'))

    releaseUpdate()
    await vi.waitFor(() => {
      expect(input.events.record).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'user_input_resolved',
        status: 'submitted'
      }))
    })
  })

  it('warns when settlement exceeds the slow threshold', async () => {
    vi.useFakeTimers()
    try {
      const input = baseInput({
        turns: {
          updateItem: vi.fn(async (): Promise<null> => {
            await vi.advanceTimersByTimeAsync(1_500)
            return null
          })
        }
      })
      await settleUserInputResolution(input)
      expect(input.warn).toHaveBeenCalledWith(expect.stringContaining('took'))
    } finally {
      vi.useRealTimers()
    }
  })
})
