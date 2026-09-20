import { afterEach, describe, expect, it, vi } from 'vitest'
import { settleCleanupBeforeDeadline, settleCleanupSteps } from './runtime-factory-cleanup.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('bounded serve cleanup', () => {
  it('attempts later tool hosts and the writer after individual cleanup failures', async () => {
    const calls: string[] = []
    const cleanup = settleCleanupSteps([
      async () => { calls.push('shell'); throw new Error('shell failed') },
      async () => { calls.push('extension'); throw new Error('extension failed') },
      async () => { calls.push('lsp') },
      async () => { calls.push('mcp') },
      async () => { calls.push('owned process groups') },
      async () => { calls.push('store') }
    ])
    await expect(cleanup).rejects.toThrow('shell failed')
    expect(calls).toEqual(['shell', 'extension', 'lsp', 'mcp', 'owned process groups', 'store'])
  })

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
