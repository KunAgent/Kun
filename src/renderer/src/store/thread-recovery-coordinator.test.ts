import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cancelThreadRecovery,
  markThreadRecoveryCatchingUp,
  noteThreadRecoveryEvidence,
  releaseThreadRecoveryCatchup,
  resetThreadRecoveryCoordinator,
  runThreadRecovery,
  threadRecoveryDiagnostics
} from './thread-recovery-coordinator'

describe('thread recovery coordinator', () => {
  afterEach(() => resetThreadRecoveryCoordinator())

  it('joins concurrent triggers to one physical recovery', async () => {
    let release!: (value: boolean) => void
    const physical = vi.fn(() => new Promise<boolean>((resolve) => { release = resolve }))

    const first = runThreadRecovery('thread-1', 'watchdog', physical)
    const second = runThreadRecovery('thread-1', 'manual_retry', physical)
    await Promise.resolve()
    expect(physical).toHaveBeenCalledOnce()

    release(true)
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(threadRecoveryDiagnostics()).toMatchObject({ started: 1, joined: 1, inflight: 0 })
  })

  it('aborts an obsolete physical recovery', async () => {
    let observedSignal!: AbortSignal
    const recovery = runThreadRecovery('thread-old', 'selection', async (signal) => {
      observedSignal = signal
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
      return false
    })
    await Promise.resolve()
    cancelThreadRecovery('thread-old')

    await expect(recovery).resolves.toBe(false)
    expect(observedSignal.aborted).toBe(true)
    expect(threadRecoveryDiagnostics()).toMatchObject({ cancelled: 1, inflight: 0 })
  })

  it('preempts a stuck catching-up stream for manual_retry and fences stale evidence', async () => {
    const oldGeneration = markThreadRecoveryCatchingUp('thread-live')
    const physical = vi.fn(async () => true)

    await expect(runThreadRecovery('thread-live', 'manual_retry', physical)).resolves.toBe(true)
    expect(physical).toHaveBeenCalledOnce()

    // Model the replacement stream re-entering catching up; the old stream's
    // late release/evidence must be dropped by the generation fence.
    const newGeneration = markThreadRecoveryCatchingUp('thread-live')
    expect(newGeneration).not.toBe(oldGeneration)

    releaseThreadRecoveryCatchup('thread-live', oldGeneration)
    expect(threadRecoveryDiagnostics().inflight).toBe(1)

    noteThreadRecoveryEvidence('thread-live', oldGeneration)
    expect(threadRecoveryDiagnostics().inflight).toBe(1)

    releaseThreadRecoveryCatchup('thread-live', newGeneration)
    expect(threadRecoveryDiagnostics().inflight).toBe(0)
  })

  it.each(['watchdog', 'replay_reset', 'runtime_restart'] as const)(
    'preempts a stuck catching-up stream for %s',
    async (reason) => {
      markThreadRecoveryCatchingUp('thread-preempt')
      const physical = vi.fn(async () => true)

      await expect(runThreadRecovery('thread-preempt', reason, physical)).resolves.toBe(true)
      expect(physical).toHaveBeenCalledOnce()
    }
  )

  it('keeps joining a catching-up stream for passive reasons', async () => {
    markThreadRecoveryCatchingUp('thread-passive')
    const physical = vi.fn(async () => true)

    await expect(runThreadRecovery('thread-passive', 'sse_disconnect', physical)).resolves.toBe(true)
    expect(physical).not.toHaveBeenCalled()
    expect(threadRecoveryDiagnostics().inflight).toBe(1)
  })

  it('fires the catch-up deadline exactly once and allows recovery', async () => {
    vi.useFakeTimers()
    try {
      const onDeadline = vi.fn()
      markThreadRecoveryCatchingUp('thread-deadline', onDeadline)
      expect(threadRecoveryDiagnostics().inflight).toBe(1)

      vi.advanceTimersByTime(29_999)
      expect(onDeadline).not.toHaveBeenCalled()
      expect(threadRecoveryDiagnostics().inflight).toBe(1)

      vi.advanceTimersByTime(1)
      expect(onDeadline).toHaveBeenCalledOnce()
      expect(threadRecoveryDiagnostics().inflight).toBe(0)

      const physical = vi.fn(async () => true)
      await runThreadRecovery('thread-deadline', 'watchdog', physical)
      expect(physical).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
