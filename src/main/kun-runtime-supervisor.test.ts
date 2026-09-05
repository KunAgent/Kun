import { describe, expect, it, vi } from 'vitest'
import {
  KunRuntimeSupervisor,
  MAX_RESTART_DELAY_MS,
  RestartBudget,
  type KunRuntimeStatus
} from './kun-runtime-supervisor'

function createGate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

type TestSettings = { autoStart: boolean; revision?: number }

function budgetAt(times: { value: number }): RestartBudget {
  return new RestartBudget({
    windowMs: 60_000,
    maxRestarts: 3,
    baseDelayMs: 1_000,
    delayFactor: 3,
    now: () => times.value
  })
}

describe('RestartBudget', () => {
  it('allows up to maxRestarts attempts with exponential backoff delays', () => {
    const clock = { value: 0 }
    const budget = budgetAt(clock)

    expect(budget.note()).toEqual({ allowed: true, attempt: 1, delayMs: 1_000 })
    clock.value += 1_000
    expect(budget.note()).toEqual({ allowed: true, attempt: 2, delayMs: 3_000 })
    clock.value += 1_000
    expect(budget.note()).toEqual({ allowed: true, attempt: 3, delayMs: 9_000 })
  })

  it('circuit-breaks once the window is saturated', () => {
    const clock = { value: 0 }
    const budget = budgetAt(clock)
    budget.note()
    budget.note()
    budget.note()

    const verdict = budget.note()
    expect(verdict.allowed).toBe(false)
    expect(verdict.delayMs).toBe(0)
  })

  it('previews backoff without consuming an attempt', () => {
    const clock = { value: 0 }
    const budget = budgetAt(clock)

    expect(budget.preview()).toEqual({ allowed: true, attempt: 1, delayMs: 1_000 })
    expect(budget.preview()).toEqual({ allowed: true, attempt: 1, delayMs: 1_000 })
    expect(budget.note()).toEqual({ allowed: true, attempt: 1, delayMs: 1_000 })
    expect(budget.preview()).toEqual({ allowed: true, attempt: 2, delayMs: 3_000 })
  })

  it('frees attempts as they age out of the sliding window', () => {
    const clock = { value: 0 }
    const budget = budgetAt(clock)
    budget.note()
    budget.note()
    budget.note()
    expect(budget.note().allowed).toBe(false)

    clock.value = 60_001
    const verdict = budget.note()
    expect(verdict.allowed).toBe(true)
    expect(verdict.attempt).toBe(1)
    expect(verdict.delayMs).toBe(1_000)
  })

  it('reset() clears the window so the next crash starts fresh', () => {
    const clock = { value: 0 }
    const budget = budgetAt(clock)
    budget.note()
    budget.note()
    budget.reset()

    const verdict = budget.note()
    expect(verdict).toEqual({ allowed: true, attempt: 1, delayMs: 1_000 })
  })

  it('clamps restart delays to the maximum timer delay', () => {
    const budget = new RestartBudget({
      windowMs: 60_000,
      maxRestarts: 3,
      baseDelayMs: Number.MAX_SAFE_INTEGER,
      delayFactor: Number.MAX_SAFE_INTEGER,
      now: () => 0
    })

    expect(budget.note()).toEqual({
      allowed: true,
      attempt: 1,
      delayMs: MAX_RESTART_DELAY_MS
    })
  })

  it('falls back from non-finite numeric options', () => {
    const budget = new RestartBudget({
      windowMs: Number.NaN,
      maxRestarts: Number.NaN,
      baseDelayMs: Number.NaN,
      delayFactor: Number.NaN,
      now: () => 0
    })

    expect(budget.note()).toEqual({ allowed: true, attempt: 1, delayMs: 1_000 })
  })
})

describe('KunRuntimeSupervisor', () => {
  function harness(overrides: {
    healthy?: boolean
    restartError?: Error
    ensureError?: Error
    stopped?: boolean
    childRunning?: boolean
    canAutoRestart?: boolean
    maxRestarts?: number
    ensureGate?: Promise<void>
    sleepGate?: Promise<void>
    onSleep?: () => void
    settingsSequence?: TestSettings[]
    watchdogFailureThreshold?: number
  } = {}) {
    const statuses: KunRuntimeStatus[] = []
    const settings: TestSettings = { autoStart: true }
    let settingsRead = 0
    const loadSettings = vi.fn(async () => {
      const sequence = overrides.settingsSequence
      if (!sequence?.length) return settings
      const current = sequence[Math.min(settingsRead, sequence.length - 1)] ?? settings
      settingsRead += 1
      return current
    })
    const ensureRuntime = vi.fn(async (_settings: TestSettings) => {
      await overrides.ensureGate
      if (overrides.ensureError) throw overrides.ensureError
      return settings
    })
    const restartRuntime = vi.fn(async (_settings: TestSettings) => {
      if (overrides.restartError) throw overrides.restartError
    })
    const checkHealth = vi.fn(async (_settings: TestSettings) => overrides.healthy ?? false)
    const deps = {
      loadSettings,
      canAutoRestart: (_settings: TestSettings) => overrides.canAutoRestart ?? true,
      ensureRuntime,
      restartRuntime,
      checkHealth,
      isChildRunning: () => overrides.childRunning ?? true,
      isStopped: () => overrides.stopped ?? false,
      publish: (status: KunRuntimeStatus) => { statuses.push(status) },
      warn: () => undefined,
      error: () => undefined,
      sleep: async () => {
        overrides.onSleep?.()
        await overrides.sleepGate
      }
    }
    const supervisor = new KunRuntimeSupervisor({
      deps,
      watchdogFailureThreshold: overrides.watchdogFailureThreshold ?? 2,
      restartBudget: new RestartBudget({
        windowMs: 60_000,
        maxRestarts: overrides.maxRestarts ?? 3,
        baseDelayMs: 0
      })
    })
    return { supervisor, statuses, deps, loadSettings, ensureRuntime, restartRuntime, checkHealth }
  }

  it('restarts after the configured consecutive watchdog failures', async () => {
    const h = harness()
    h.supervisor.setManagedRuntimeExpected(true)
    await h.supervisor.watchdogTick()
    expect(h.statuses).toEqual([])
    await h.supervisor.watchdogTick()
    expect(h.statuses.map((status) => status.state)).toEqual(['restarting', 'running'])
  })

  it('takes the missing/ensure path when health clears a stale childRunning cache (#1116)', async () => {
    let childRunning = true
    const h = harness({
      childRunning: true,
      watchdogFailureThreshold: 3
    })
    h.deps.isChildRunning = () => childRunning
    h.checkHealth.mockImplementation(async () => {
      childRunning = false
      return false
    })
    h.supervisor.setManagedRuntimeExpected(true)

    await h.supervisor.watchdogTick()

    expect(h.ensureRuntime).toHaveBeenCalledOnce()
    expect(h.restartRuntime).not.toHaveBeenCalled()
    expect(h.statuses.map((status) => status.state)).toEqual(['restarting', 'running'])
  })

  it('does not recover or restart after shutdown begins', async () => {
    const h = harness({ stopped: true })
    h.supervisor.setManagedRuntimeExpected(true)
    h.supervisor.handleUnexpectedExit({ code: 1, signal: null, stderrTail: 'failed' })
    await Promise.resolve()
    await h.supervisor.watchdogTick()
    expect(h.statuses).toEqual([])
  })

  it('does not spend restart budget while the host is suspended or recovering', async () => {
    const h = harness({ childRunning: false })
    h.supervisor.setManagedRuntimeExpected(true)
    h.supervisor.noteHostSuspended()

    h.supervisor.handleUnexpectedExit({ code: 1, signal: null, stderrTail: 'sleep' })
    await h.supervisor.watchdogTick()
    expect(h.ensureRuntime).not.toHaveBeenCalled()
    expect(h.statuses).toEqual([])

    h.supervisor.noteHostResumed(20_000)
    await h.supervisor.watchdogTick()
    expect(h.ensureRuntime).not.toHaveBeenCalled()

    h.supervisor.noteHostResumed(0)
    await h.supervisor.watchdogTick()
    expect(h.ensureRuntime).toHaveBeenCalledOnce()
    expect(h.statuses.map((status) => status.state)).toEqual(['restarting', 'running'])
  })

  it('does not publish a stale failure when suspend begins during restart', async () => {
    const gate = createGate()
    const h = harness({ ensureGate: gate.promise, ensureError: new Error('late restart failure') })
    h.supervisor.setManagedRuntimeExpected(true)
    h.supervisor.handleUnexpectedExit({ code: 1, signal: null, stderrTail: 'failed' })
    await vi.waitFor(() => expect(h.ensureRuntime).toHaveBeenCalledOnce())

    h.supervisor.noteHostSuspended()
    gate.release()
    await vi.waitFor(() => expect(h.statuses.map((status) => status.state)).toEqual([
      'crashed',
      'restarting'
    ]))
    expect(h.statuses.some((status) => status.state === 'failed')).toBe(false)
  })

  it('does not spend crash budget when suspend begins while settings reload', async () => {
    const gate = createGate()
    const h = harness({ maxRestarts: 1 })
    let settingsReads = 0
    h.deps.loadSettings = vi.fn(async () => {
      settingsReads += 1
      if (settingsReads === 2) await gate.promise
      return { autoStart: true }
    })
    h.supervisor.setManagedRuntimeExpected(true)
    h.supervisor.handleUnexpectedExit({ code: 1, signal: null, stderrTail: 'first' })
    await vi.waitFor(() => expect(settingsReads).toBe(2))

    h.supervisor.noteHostSuspended()
    gate.release()
    await vi.waitFor(() => expect(h.statuses.map((status) => status.state)).toEqual(['crashed']))
    await vi.waitFor(() => expect(
      (h.supervisor as unknown as { recoveryInFlight: boolean }).recoveryInFlight
    ).toBe(false))
    h.supervisor.noteHostResumed(0)
    h.supervisor.handleUnexpectedExit({ code: 1, signal: null, stderrTail: 'second' })
    await vi.waitFor(() => expect(h.ensureRuntime).toHaveBeenCalledOnce())

    expect(h.statuses.map((status) => status.state)).toEqual([
      'crashed', 'crashed', 'restarting', 'running'
    ])
  })

  it('publishes failed when watchdog restart fails', async () => {
    const h = harness({ restartError: new Error('restart failed') })
    h.supervisor.setManagedRuntimeExpected(true)
    await h.supervisor.watchdogTick()
    await h.supervisor.watchdogTick()
    expect(h.statuses.at(-1)).toMatchObject({ state: 'failed', source: 'watchdog' })
  })

  it('clears a stale watchdog failure after the preserved Runtime becomes healthy again', async () => {
    const h = harness({
      restartError: new Error('preserved live Runtime did not stop'),
      watchdogFailureThreshold: 1
    })
    h.supervisor.setManagedRuntimeExpected(true)

    await h.supervisor.watchdogTick()
    expect(h.statuses.at(-1)).toMatchObject({ state: 'failed', source: 'watchdog' })

    h.checkHealth.mockResolvedValue(true)
    await h.supervisor.watchdogTick()

    expect(h.statuses.map((status) => status.state)).toEqual([
      'restarting',
      'failed',
      'running'
    ])
    expect(h.restartRuntime).toHaveBeenCalledOnce()
  })

  it('owns single-flight ensure operations for one runtime fingerprint', async () => {
    const h = harness()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const operation = vi.fn(async () => {
      await gate
      return { autoStart: true }
    })

    const first = h.supervisor.ensure('fingerprint', operation)
    const second = h.supervisor.ensure('fingerprint', operation)
    release()

    await expect(first).resolves.toEqual({ autoStart: true })
    await expect(second).resolves.toEqual({ autoStart: true })
    expect(operation).toHaveBeenCalledOnce()
  })

  it('serializes settings apply and suppresses watchdog recovery while it is pending', async () => {
    const h = harness()
    h.supervisor.setManagedRuntimeExpected(true)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const onError = vi.fn()
    h.supervisor.enqueueSettingsApply(() => gate, onError)

    await vi.waitFor(() => expect(h.supervisor.hasPendingOperation()).toBe(true))
    await h.supervisor.watchdogTick()
    expect(h.statuses).toEqual([])

    release()
    await vi.waitFor(() => expect(h.supervisor.hasPendingOperation()).toBe(false))
    expect(h.supervisor.hasPendingOperation()).toBe(false)
    expect(onError).not.toHaveBeenCalled()
  })

  it('does not recover a Runtime that was never expected to start', async () => {
    const h = harness({ childRunning: false })

    await h.supervisor.watchdogTick()
    h.supervisor.handleUnexpectedExit({ code: 1, signal: null, stderrTail: 'failed' })
    await Promise.resolve()

    expect(h.supervisor.isManagedRuntimeExpected).toBe(false)
    expect(h.ensureRuntime).not.toHaveBeenCalled()
    expect(h.restartRuntime).not.toHaveBeenCalled()
    expect(h.statuses).toEqual([])
  })

  it('recovers when the Runtime is expected but child or discovery state is missing', async () => {
    const h = harness({ childRunning: false })
    h.supervisor.setManagedRuntimeExpected(true)

    await h.supervisor.watchdogTick()

    expect(h.ensureRuntime).toHaveBeenCalledOnce()
    expect(h.checkHealth).not.toHaveBeenCalled()
    expect(h.statuses.map((status) => status.state)).toEqual(['restarting', 'running'])
    expect(h.statuses[0]).toMatchObject({ source: 'watchdog', attempt: 1 })
  })

  it('keeps cold-start recovery armed after the first launch attempt fails', async () => {
    const launch: { childRunning: boolean; ensureError?: Error } = {
      childRunning: false,
      ensureError: new Error('first launch failed')
    }
    const h = harness(launch)
    h.supervisor.setManagedRuntimeExpected(true)

    await h.supervisor.watchdogTick()

    expect(h.supervisor.isManagedRuntimeExpected).toBe(true)
    expect(h.statuses.at(-1)).toMatchObject({ state: 'failed', source: 'watchdog' })

    delete launch.ensureError
    await h.supervisor.watchdogTick()

    expect(h.ensureRuntime).toHaveBeenCalledTimes(2)
    expect(h.statuses.at(-1)).toMatchObject({ state: 'running', source: 'watchdog' })
  })

  it('does not recover after an explicit stop clears the expectation', async () => {
    const h = harness({ childRunning: false })
    h.supervisor.setManagedRuntimeExpected(true)
    h.supervisor.setManagedRuntimeExpected(false)

    await h.supervisor.watchdogTick()
    h.supervisor.handleUnexpectedExit({ code: 1, signal: null, stderrTail: 'stopped' })
    await Promise.resolve()

    expect(h.ensureRuntime).not.toHaveBeenCalled()
    expect(h.statuses).toEqual([])
  })

  it('does not announce recovery when an explicit stop wins an in-flight ensure', async () => {
    let releaseEnsure!: () => void
    const ensureGate = new Promise<void>((resolve) => { releaseEnsure = resolve })
    const h = harness({ childRunning: false, ensureGate })
    h.supervisor.setManagedRuntimeExpected(true)

    const tick = h.supervisor.watchdogTick()
    await vi.waitFor(() => expect(h.ensureRuntime).toHaveBeenCalledOnce())
    h.supervisor.setManagedRuntimeExpected(false)
    releaseEnsure()
    await tick

    expect(h.statuses.map((status) => status.state)).toEqual(['restarting'])
    expect(h.supervisor.isManagedRuntimeExpected).toBe(false)
  })

  it('keeps the expectation independent from an ordinary healthy signal', () => {
    const h = harness({ healthy: true })

    h.supervisor.noteHealthy('probe')

    expect(h.supervisor.isManagedRuntimeExpected).toBe(false)
  })

  it('clears a stale rollback warning after a newer healthy apply', () => {
    const h = harness({ healthy: true })
    h.supervisor.setManagedRuntimeExpected(true)
    h.supervisor.publish({
      state: 'running',
      source: 'settings-apply',
      rolledBack: true,
      message: 'Previous settings were restored.'
    })

    h.supervisor.noteHealthy('settings-apply')

    expect(h.statuses.at(-1)).toMatchObject({ state: 'running', source: 'settings-apply' })
    expect(h.statuses.at(-1)).not.toHaveProperty('rolledBack')
    expect(h.statuses.at(-1)).not.toHaveProperty('message')
  })

  it('shares one restart budget between watchdog recovery and unexpected exits', async () => {
    const h = harness({ childRunning: false, maxRestarts: 1 })
    h.supervisor.setManagedRuntimeExpected(true)

    await h.supervisor.watchdogTick()
    h.supervisor.handleUnexpectedExit({ code: 1, signal: null, stderrTail: 'crashed again' })

    await vi.waitFor(() => {
      expect(h.statuses.at(-1)).toMatchObject({ state: 'failed', source: 'supervisor' })
    })
    expect(h.ensureRuntime).toHaveBeenCalledOnce()
    expect(h.statuses.map((status) => status.state)).toEqual([
      'restarting',
      'running',
      'crashed',
      'failed'
    ])
  })

  it('keeps restart attempts after a brief healthy recovery', async () => {
    const h = harness({ maxRestarts: 1 })
    h.supervisor.setManagedRuntimeExpected(true)
    h.supervisor.handleUnexpectedExit({ code: 1, signal: null, stderrTail: 'first crash' })
    await vi.waitFor(() => expect(h.ensureRuntime).toHaveBeenCalledOnce())

    h.supervisor.noteHealthy('brief-probe')
    h.supervisor.handleUnexpectedExit({ code: 1, signal: null, stderrTail: 'second crash' })

    await vi.waitFor(() => {
      expect(h.statuses.at(-1)).toMatchObject({ state: 'failed', source: 'supervisor' })
    })
    expect(h.ensureRuntime).toHaveBeenCalledOnce()
  })

  it('does not start crash recovery while watchdog recovery owns the shared lease', async () => {
    const sleepGate = createGate()
    const sleepStarted = createGate()
    const h = harness({
      childRunning: false,
      sleepGate: sleepGate.promise,
      onSleep: sleepStarted.release
    })
    h.supervisor.setManagedRuntimeExpected(true)

    const watchdog = h.supervisor.watchdogTick()
    await sleepStarted.promise
    h.supervisor.handleUnexpectedExit({ code: 1, signal: null, stderrTail: 'same crash' })
    await vi.waitFor(() => {
      expect(h.statuses).toContainEqual(expect.objectContaining({
        state: 'crashed',
        source: 'supervisor'
      }))
    })

    sleepGate.release()
    await watchdog

    expect(h.ensureRuntime).toHaveBeenCalledOnce()
    expect(h.restartRuntime).not.toHaveBeenCalled()
    expect(h.statuses.filter((status) => status.state === 'restarting')).toHaveLength(1)
  })

  it('reloads settings after watchdog backoff before restarting an unresponsive Runtime', async () => {
    const sleepGate = createGate()
    const sleepStarted = createGate()
    const initial = { autoStart: true, revision: 1 }
    const latest = { autoStart: true, revision: 2 }
    const h = harness({
      healthy: false,
      childRunning: true,
      watchdogFailureThreshold: 1,
      sleepGate: sleepGate.promise,
      onSleep: sleepStarted.release,
      settingsSequence: [initial, latest]
    })
    h.supervisor.setManagedRuntimeExpected(true)

    const tick = h.supervisor.watchdogTick()
    await sleepStarted.promise
    sleepGate.release()
    await tick

    expect(h.loadSettings).toHaveBeenCalledTimes(2)
    expect(h.restartRuntime).toHaveBeenCalledWith(latest)
    expect(h.ensureRuntime).not.toHaveBeenCalled()
  })

  it('does not consume restart budget when a lifecycle operation supersedes watchdog backoff', async () => {
    const sleepGate = createGate()
    const sleepStarted = createGate()
    const h = harness({
      childRunning: false,
      maxRestarts: 1,
      sleepGate: sleepGate.promise,
      onSleep: sleepStarted.release
    })
    h.supervisor.setManagedRuntimeExpected(true)

    const firstTick = h.supervisor.watchdogTick()
    await sleepStarted.promise
    const applyGate = createGate()
    h.supervisor.enqueueSettingsApply(() => applyGate.promise, vi.fn())
    await vi.waitFor(() => expect(h.supervisor.hasPendingOperation()).toBe(true))
    sleepGate.release()
    await firstTick

    expect(h.statuses).toEqual([])
    expect(h.ensureRuntime).not.toHaveBeenCalled()

    applyGate.release()
    await vi.waitFor(() => expect(h.supervisor.hasPendingOperation()).toBe(false))
    await h.supervisor.watchdogTick()

    expect(h.ensureRuntime).toHaveBeenCalledOnce()
    expect(h.statuses.map((status) => status.state)).toEqual(['restarting', 'running'])
    expect(h.statuses[0]).toMatchObject({ attempt: 1 })
  })

  it('lets shutdown wait until an in-flight settings apply leaves the lifecycle lane', async () => {
    const h = harness()
    const applyGate = createGate()
    h.supervisor.enqueueSettingsApply(() => applyGate.promise, vi.fn())

    let settled = false
    const waiting = h.supervisor.waitForIdle().then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    applyGate.release()
    await waiting
    expect(settled).toBe(true)
  })
})
