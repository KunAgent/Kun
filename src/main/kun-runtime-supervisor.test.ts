import { describe, expect, it, vi } from 'vitest'
import {
  KunRuntimeSupervisor,
  MAX_RESTART_DELAY_MS,
  RestartBudget,
  type KunRuntimeStatus
} from './kun-runtime-supervisor'

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
    stopped?: boolean
  } = {}) {
    const statuses: KunRuntimeStatus[] = []
    const settings = { autoStart: true }
    const deps = {
      loadSettings: async () => settings,
      canAutoRestart: () => true,
      ensureRuntime: async () => settings,
      restartRuntime: async () => {
        if (overrides.restartError) throw overrides.restartError
      },
      checkHealth: async () => overrides.healthy ?? false,
      isChildRunning: () => true,
      isStopped: () => overrides.stopped ?? false,
      publish: (status: KunRuntimeStatus) => { statuses.push(status) },
      warn: () => undefined,
      error: () => undefined,
      sleep: async () => undefined
    }
    const supervisor = new KunRuntimeSupervisor({
      deps,
      watchdogFailureThreshold: 2,
      restartBudget: new RestartBudget({ windowMs: 60_000, maxRestarts: 3, baseDelayMs: 0 })
    })
    return { supervisor, statuses, deps }
  }

  it('restarts after the configured consecutive watchdog failures', async () => {
    const h = harness()
    await h.supervisor.watchdogTick()
    expect(h.statuses.map((status) => status.state)).toEqual(['degraded'])
    await h.supervisor.watchdogTick()
    expect(h.statuses.map((status) => status.state)).toEqual(['degraded', 'restarting', 'running'])
  })

  it('does not recover or restart after shutdown begins', async () => {
    const h = harness({ stopped: true })
    h.supervisor.handleUnexpectedExit({ code: 1, signal: null, stderrTail: 'failed' })
    await Promise.resolve()
    await h.supervisor.watchdogTick()
    expect(h.statuses).toEqual([])
  })

  it('publishes failed when watchdog restart fails', async () => {
    const h = harness({ restartError: new Error('restart failed') })
    await h.supervisor.watchdogTick()
    await h.supervisor.watchdogTick()
    expect(h.statuses.at(-1)).toMatchObject({ state: 'failed', source: 'watchdog' })
    await h.supervisor.watchdogTick()
    expect(h.statuses.at(-1)).toMatchObject({ state: 'failed', source: 'watchdog' })
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
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const onError = vi.fn()
    h.supervisor.enqueueSettingsApply(() => gate, onError)

    await vi.waitFor(() => expect(h.supervisor.hasPendingOperation()).toBe(true))
    await h.supervisor.watchdogTick()
    expect(h.statuses).toEqual([])

    release()
    await h.supervisor.waitForSettingsApply()
    expect(h.supervisor.hasPendingOperation()).toBe(false)
    expect(onError).not.toHaveBeenCalled()
  })
})
