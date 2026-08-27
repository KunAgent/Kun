import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeBackgroundMaintenance } from './runtime-background-maintenance.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('Runtime background maintenance', () => {
  it('does not run historical work until it is started and delayed', async () => {
    vi.useFakeTimers()
    const seedUsage = vi.fn(async () => undefined)
    const pruneAttachments = vi.fn(async () => undefined)
    const inspectThreads = vi.fn(async () => undefined)
    const maintenance = createRuntimeBackgroundMaintenance({
      seedUsage,
      pruneAttachments,
      inspectThreads,
      onError: vi.fn(),
      usageDelayMs: 50,
      attachmentDelayMs: 100,
      attachmentIntervalMs: 200,
      guardianDelayMs: 150,
      guardianIntervalMs: 300
    })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(seedUsage).not.toHaveBeenCalled()
    expect(pruneAttachments).not.toHaveBeenCalled()
    expect(inspectThreads).not.toHaveBeenCalled()

    maintenance.start()
    await vi.advanceTimersByTimeAsync(49)
    expect(seedUsage).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(seedUsage).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(50)
    expect(pruneAttachments).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(50)
    expect(inspectThreads).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(150)
    expect(pruneAttachments).toHaveBeenCalledTimes(2)
  })

  it('keeps task failures non-fatal and reports them', async () => {
    vi.useFakeTimers()
    const onError = vi.fn()
    const failure = new Error('maintenance unavailable')
    const maintenance = createRuntimeBackgroundMaintenance({
      seedUsage: vi.fn(async () => { throw failure }),
      pruneAttachments: vi.fn(async () => undefined),
      inspectThreads: vi.fn(async () => undefined),
      onError,
      usageDelayMs: 1,
      attachmentDelayMs: 100,
      guardianDelayMs: 100
    })

    maintenance.start()
    await vi.advanceTimersByTimeAsync(1)
    await Promise.resolve()
    expect(onError).toHaveBeenCalledWith('usage carryover', failure)
  })

  it('cancels pending and recurring work during shutdown', async () => {
    vi.useFakeTimers()
    const seedUsage = vi.fn(async () => undefined)
    const pruneAttachments = vi.fn(async () => undefined)
    const inspectThreads = vi.fn(async () => undefined)
    const maintenance = createRuntimeBackgroundMaintenance({
      seedUsage,
      pruneAttachments,
      inspectThreads,
      onError: vi.fn(),
      usageDelayMs: 100,
      attachmentDelayMs: 10,
      attachmentIntervalMs: 10,
      guardianDelayMs: 10,
      guardianIntervalMs: 10
    })

    maintenance.start()
    await vi.advanceTimersByTimeAsync(10)
    expect(pruneAttachments).toHaveBeenCalledOnce()
    expect(inspectThreads).toHaveBeenCalledOnce()
    maintenance.stop()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(seedUsage).not.toHaveBeenCalled()
    expect(pruneAttachments).toHaveBeenCalledOnce()
    expect(inspectThreads).toHaveBeenCalledOnce()
  })
})
