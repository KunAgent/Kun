import { describe, expect, it, vi } from 'vitest'
import { DesktopStartupState } from './desktop-startup-state'
import { probeUpdateRuntimeAfterStartup } from './update-runtime-health-check'

describe('update runtime health waits for desktop startup', () => {
  it('leaves unfinished startup pending without polling timers or a failed-health result', async () => {
    vi.useFakeTimers()
    try {
      const state = new DesktopStartupState(() => null)
      const probe = vi.fn(async () => ({ ok: true }))
      const checking = probeUpdateRuntimeAfterStartup(state, async () => ({}), probe)
      // A process quitting before readiness does not owe this background check
      // a result. It owns no timer/handle and never blocks the quit barrier.
      expect(await Promise.race([checking, Promise.resolve('pending')])).toBe('pending')
      expect(vi.getTimerCount()).toBe(0)
      expect(probe).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('does not probe or fail health merely because the shell precedes runtime startup', async () => {
    const state = new DesktopStartupState(() => null)
    const load = vi.fn(async () => ({ credential: 'fixture' }))
    const probe = vi.fn(async () => ({ ok: true }))
    const settled = vi.fn()
    const checking = probeUpdateRuntimeAfterStartup(state, load, probe).then(settled)
    state.transition('shell_ready')
    state.transition('manager_starting')
    state.transition('runtime_starting')
    await Promise.resolve()
    expect(load).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
    expect(settled).not.toHaveBeenCalled()
    state.transition('ready')
    await checking
    expect(probe).toHaveBeenCalledExactlyOnceWith({ credential: 'fixture' })
    expect(settled).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('retains a real failed authenticated probe after readiness', async () => {
    const state = new DesktopStartupState(() => null)
    state.transition('runtime_handoff')
    state.transition('ready')
    const probe = vi.fn(async () => ({ ok: false }))
    expect(await probeUpdateRuntimeAfterStartup(state, async () => ({}), probe)).toBe(false)
    expect(probe).toHaveBeenCalledOnce()
  })

  it('resolves concurrent waiting and later checks as failed on terminal recovery', async () => {
    const state = new DesktopStartupState(() => null)
    const load = vi.fn(async () => ({}))
    const probe = vi.fn(async () => ({ ok: true }))
    const checks = [probeUpdateRuntimeAfterStartup(state, load, probe), state.whenReady()]
    state.transition('recovery_required')
    expect(await Promise.all(checks)).toEqual([false, false])
    expect(await probeUpdateRuntimeAfterStartup(state, load, probe)).toBe(false)
    expect(load).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
  })
})
