import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeBackgroundMaintenance } from './runtime-background-maintenance.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('Runtime background maintenance', () => {
  it('does not run historical work until it is started and delayed', async () => {
    vi.useFakeTimers()
    const pruneAttachments = vi.fn(async () => undefined)
    const inspectThreads = vi.fn(async () => undefined)
    const maintenance = createRuntimeBackgroundMaintenance({
      pruneAttachments,
      inspectThreads,
      onError: vi.fn(),
      attachmentDelayMs: 100,
      attachmentIntervalMs: 200,
      guardianDelayMs: 150,
      guardianIntervalMs: 300
    })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(pruneAttachments).not.toHaveBeenCalled()
    expect(inspectThreads).not.toHaveBeenCalled()

    maintenance.start()
    await vi.advanceTimersByTimeAsync(100)
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
      pruneAttachments: vi.fn(async () => { throw failure }),
      inspectThreads: vi.fn(async () => undefined),
      onError,
      attachmentDelayMs: 1,
      guardianDelayMs: 100
    })

    maintenance.start()
    await vi.advanceTimersByTimeAsync(1)
    await Promise.resolve()
    expect(onError).toHaveBeenCalledWith('attachment pruning', failure)
  })

  it('cancels pending and recurring work during shutdown', async () => {
    vi.useFakeTimers()
    const pruneAttachments = vi.fn(async () => undefined)
    const inspectThreads = vi.fn(async () => undefined)
    const maintenance = createRuntimeBackgroundMaintenance({
      pruneAttachments,
      inspectThreads,
      onError: vi.fn(),
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
    expect(pruneAttachments).toHaveBeenCalledOnce()
    expect(inspectThreads).toHaveBeenCalledOnce()
  })

  it('schedules the event-index rebuild as a third task and wakes it on demand', async () => {
    vi.useFakeTimers()
    const pruneAttachments = vi.fn(async () => undefined)
    const inspectThreads = vi.fn(async () => undefined)
    const rebuildEventIndex = vi.fn(async () => true)
    const maintenance = createRuntimeBackgroundMaintenance({
      pruneAttachments,
      inspectThreads,
      rebuildEventIndex,
      onError: vi.fn(),
      attachmentDelayMs: 10_000,
      guardianDelayMs: 10_000,
      eventIndexRebuildDelayMs: 100,
      eventIndexRebuildIntervalMs: 200
    })

    maintenance.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(rebuildEventIndex).toHaveBeenCalledOnce()
    expect(pruneAttachments).not.toHaveBeenCalled()
    expect(inspectThreads).not.toHaveBeenCalled()

    maintenance.wake()
    await vi.advanceTimersByTimeAsync(0)
    expect(rebuildEventIndex).toHaveBeenCalledTimes(2)
  })
})
