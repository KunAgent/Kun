import { afterEach, describe, expect, it, vi } from 'vitest'
import { settleCleanupBeforeDeadline } from './runtime-factory-cleanup.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('bounded serve cleanup', () => {
  it('reports cleanup that settles before the deadline', async () => {
    await expect(settleCleanupBeforeDeadline(async () => undefined, 1_000)).resolves.toBe(true)
  })

  it('releases shutdown when cleanup remains pending', async () => {
    vi.useFakeTimers()
    const result = settleCleanupBeforeDeadline(
      () => new Promise<void>(() => undefined),
      10_000
    )

    await vi.advanceTimersByTimeAsync(10_000)

    await expect(result).resolves.toBe(false)
  })

  it('observes a cleanup failure that arrives after the deadline', async () => {
    vi.useFakeTimers()
    let rejectCleanup!: (error: Error) => void
    const cleanup = new Promise<void>((_resolve, reject) => { rejectCleanup = reject })
    const result = settleCleanupBeforeDeadline(() => cleanup, 10_000)

    await vi.advanceTimersByTimeAsync(10_000)
    await expect(result).resolves.toBe(false)

    rejectCleanup(new Error('late close failure'))
    await Promise.resolve()
  })

  it('preserves cleanup failures before the deadline', async () => {
    await expect(settleCleanupBeforeDeadline(
      async () => { throw new Error('close failed') },
      1_000
    )).rejects.toThrow('close failed')
  })
})
