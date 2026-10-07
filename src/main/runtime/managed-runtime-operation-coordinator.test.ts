import { describe, expect, it, vi } from 'vitest'
import { ManagedRuntimeOperationCoordinator } from './managed-runtime-operation-coordinator'

function createGate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

describe('ManagedRuntimeOperationCoordinator', () => {
  it('shares only adjacent ensures with the same fingerprint', async () => {
    const coordinator = new ManagedRuntimeOperationCoordinator<{ id: string }>()
    const gate = createGate()
    const trace: string[] = []
    const firstOperation = vi.fn(async () => {
      trace.push('a1-start')
      await gate.promise
      trace.push('a1-end')
      return { id: 'a1' }
    })
    const secondAOperation = vi.fn(async () => {
      trace.push('a2')
      return { id: 'a2' }
    })

    const first = coordinator.ensure('a', firstOperation)
    const sharedFirst = coordinator.ensure('a', firstOperation)
    const different = coordinator.ensure('b', async () => {
      trace.push('b')
      return { id: 'b' }
    })
    const secondA = coordinator.ensure('a', secondAOperation)
    const sharedSecondA = coordinator.ensure('a', secondAOperation)

    expect(sharedFirst).toBe(first)
    expect(secondA).not.toBe(first)
    expect(sharedSecondA).toBe(secondA)
    expect(trace).toEqual(['a1-start'])

    gate.release()
    await expect(Promise.all([first, sharedFirst, different, secondA, sharedSecondA]))
      .resolves.toEqual([
        { id: 'a1' },
        { id: 'a1' },
        { id: 'b' },
        { id: 'a2' },
        { id: 'a2' }
      ])
    expect(trace).toEqual(['a1-start', 'a1-end', 'b', 'a2'])
    expect(firstOperation).toHaveBeenCalledOnce()
    expect(secondAOperation).toHaveBeenCalledOnce()
  })

  it('runs ensure, restart, and settings apply in one FIFO lane', async () => {
    const coordinator = new ManagedRuntimeOperationCoordinator<string>()
    const ensureGate = createGate()
    const restartGate = createGate()
    const settingsGate = createGate()
    const trace: string[] = []

    const ensured = coordinator.ensure('runtime', async () => {
      trace.push('ensure-start')
      await ensureGate.promise
      trace.push('ensure-end')
      return 'ready'
    })
    const restarted = coordinator.restart(async () => {
      trace.push('restart-start')
      await restartGate.promise
      trace.push('restart-end')
    })
    coordinator.enqueueSettingsApply(async () => {
      trace.push('settings-start')
      await settingsGate.promise
      trace.push('settings-end')
    }, vi.fn())

    expect(trace).toEqual(['ensure-start'])
    expect(coordinator.hasPendingOperation()).toBe(true)

    ensureGate.release()
    await expect(ensured).resolves.toBe('ready')
    await vi.waitFor(() => expect(trace).toContain('restart-start'))
    expect(trace).toEqual(['ensure-start', 'ensure-end', 'restart-start'])
    expect(coordinator.hasPendingOperation()).toBe(true)

    restartGate.release()
    await restarted
    await vi.waitFor(() => expect(trace).toContain('settings-start'))
    expect(trace).toEqual([
      'ensure-start',
      'ensure-end',
      'restart-start',
      'restart-end',
      'settings-start'
    ])
    expect(coordinator.hasPendingOperation()).toBe(true)

    settingsGate.release()
    await coordinator.waitForIdle()
    expect(trace).toEqual([
      'ensure-start',
      'ensure-end',
      'restart-start',
      'restart-end',
      'settings-start',
      'settings-end'
    ])
    expect(coordinator.hasPendingOperation()).toBe(false)
  })

  it('shares adjacent restarts but starts a new ensure generation after the barrier', async () => {
    const coordinator = new ManagedRuntimeOperationCoordinator<string>()
    const ensureGate = createGate()
    const restartOperation = vi.fn(async () => {})
    const secondEnsureOperation = vi.fn(async () => 'second')

    const firstEnsure = coordinator.ensure('same', async () => {
      await ensureGate.promise
      return 'first'
    })
    const firstRestart = coordinator.restart(restartOperation)
    const sharedRestart = coordinator.restart(restartOperation)
    const secondEnsure = coordinator.ensure('same', secondEnsureOperation)
    const sharedSecondEnsure = coordinator.ensure('same', secondEnsureOperation)

    expect(sharedRestart).toBe(firstRestart)
    expect(secondEnsure).not.toBe(firstEnsure)
    expect(sharedSecondEnsure).toBe(secondEnsure)

    ensureGate.release()
    await expect(Promise.all([firstEnsure, firstRestart, sharedRestart, secondEnsure]))
      .resolves.toEqual(['first', undefined, undefined, 'second'])
    expect(restartOperation).toHaveBeenCalledOnce()
    expect(secondEnsureOperation).toHaveBeenCalledOnce()
  })

  it('keeps explicit replacements separate from normal restarts', async () => {
    const coordinator = new ManagedRuntimeOperationCoordinator<string>()
    const trace: string[] = []
    const restart = coordinator.restart(async () => { trace.push('restart') })
    const replacement = coordinator.replace(async () => { trace.push('replace') })
    const sharedReplacement = coordinator.replace(async () => { trace.push('unexpected') })

    expect(sharedReplacement).toBe(replacement)
    await Promise.all([restart, replacement, sharedReplacement])
    expect(trace).toEqual(['restart', 'replace'])
  })

  it('coalesces only adjacent settings applies that have not started', async () => {
    const coordinator = new ManagedRuntimeOperationCoordinator<{ value: number }>()
    const ensureGate = createGate()
    const trace: string[] = []
    coordinator.noteLatest({ value: 4 })

    const ensured = coordinator.ensure('runtime', async () => {
      trace.push('ensure-start')
      await ensureGate.promise
      trace.push('ensure-end')
      return { value: 0 }
    })
    coordinator.enqueueSettingsApply(async () => { trace.push('stale-before') }, vi.fn())
    coordinator.enqueueSettingsApply(async () => {
      trace.push(`latest-before:${coordinator.latestOr({ value: 0 }).value}`)
    }, vi.fn())
    const restarted = coordinator.restart(async () => { trace.push('restart') })
    coordinator.enqueueSettingsApply(async () => { trace.push('stale-after') }, vi.fn())
    coordinator.enqueueSettingsApply(async () => { trace.push('latest-after') }, vi.fn())

    expect(trace).toEqual(['ensure-start'])
    ensureGate.release()
    await ensured
    await restarted
    await coordinator.waitForIdle()

    expect(trace).toEqual([
      'ensure-start',
      'ensure-end',
      'latest-before:4',
      'restart',
      'latest-after'
    ])
    expect(coordinator.hasPendingOperation()).toBe(false)
  })

  it('does not coalesce adjacent settings tasks from different reconciliation domains', async () => {
    const coordinator = new ManagedRuntimeOperationCoordinator<string>()
    const ensureGate = createGate()
    const trace: string[] = []
    const ensured = coordinator.ensure('runtime', async () => {
      await ensureGate.promise
      return 'ready'
    })
    coordinator.enqueueSettingsApply(
      async () => { trace.push('runtime-settings') },
      vi.fn(),
      'runtime-settings'
    )
    coordinator.enqueueSettingsApply(
      async () => { trace.push('mcp-config') },
      vi.fn(),
      'mcp-config'
    )

    ensureGate.release()
    await ensured
    await coordinator.waitForIdle()

    expect(trace).toEqual(['runtime-settings', 'mcp-config'])
  })

  it('waits for the latest replacement behind a running settings apply', async () => {
    const coordinator = new ManagedRuntimeOperationCoordinator<string>()
    const settingsGate = createGate()
    const trace: string[] = []

    coordinator.enqueueSettingsApply(async () => {
      trace.push('first-start')
      await settingsGate.promise
      trace.push('first-end')
    }, vi.fn())
    coordinator.enqueueSettingsApply(async () => { trace.push('stale') }, vi.fn())
    const waiting = coordinator.waitForIdle()
    coordinator.enqueueSettingsApply(async () => { trace.push('latest') }, vi.fn())

    settingsGate.release()
    await waiting
    expect(trace).toEqual(['first-start', 'first-end', 'latest'])
    expect(coordinator.hasPendingOperation()).toBe(false)
  })

  it('continues draining after operation and error-handler failures', async () => {
    const coordinator = new ManagedRuntimeOperationCoordinator<string>()
    const trace: string[] = []

    const failedEnsure = coordinator.ensure('failed', async () => {
      trace.push('ensure-failed')
      throw new Error('ensure boom')
    })
    const ensureFailure = expect(failedEnsure).rejects.toThrow('ensure boom')
    const failedRestart = coordinator.restart(async () => {
      trace.push('restart-failed')
      throw new Error('restart boom')
    })
    const restartFailure = expect(failedRestart).rejects.toThrow('restart boom')
    const onError = vi.fn(() => {
      trace.push('settings-error')
      throw new Error('reporting boom')
    })
    coordinator.enqueueSettingsApply(async () => {
      trace.push('settings-failed')
      throw new Error('settings boom')
    }, onError)
    const recovered = coordinator.ensure('recovered', async () => {
      trace.push('ensure-recovered')
      return 'ready'
    })

    await ensureFailure
    await restartFailure
    await expect(recovered).resolves.toBe('ready')
    expect(onError).toHaveBeenCalledOnce()
    expect(trace).toEqual([
      'ensure-failed',
      'restart-failed',
      'settings-failed',
      'settings-error',
      'ensure-recovered'
    ])
    expect(coordinator.hasPendingOperation()).toBe(false)
  })

  it('advances the lifecycle generation around restarts and settings applies but not ensures', async () => {
    const coordinator = new ManagedRuntimeOperationCoordinator<string>()
    await coordinator.ensure('a', async () => 'settings')
    expect(coordinator.lifecycleGeneration()).toBe(0)
    let during = -1
    await coordinator.restart(async () => { during = coordinator.lifecycleGeneration() })
    expect(during).toBe(1)
    expect(coordinator.lifecycleGeneration()).toBe(2)
    coordinator.enqueueSettingsApply(async () => undefined, () => undefined)
    await coordinator.waitForIdle()
    expect(coordinator.lifecycleGeneration()).toBe(4)
  })
})

