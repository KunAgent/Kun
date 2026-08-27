import { describe, expect, it, vi } from 'vitest'
import { DesktopStartupState } from './desktop-startup-state'

describe('DesktopStartupState', () => {
  it('walks the startup phases and publishes each state to the current window', () => {
    const send = vi.fn()
    const state = new DesktopStartupState(() => ({
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send }
    } as never))

    expect(state.phase).toBe('bootstrapping')
    state.transition('shell_ready')
    state.transition('services_starting')
    state.transition('data_migrating')
    state.transition('manager_starting')
    state.transition('runtime_handoff')
    state.transition('runtime_starting')
    state.transition('ready')

    expect(state.isReady()).toBe(true)
    expect(send.mock.calls.map((call) => call[1])).toEqual([
      { phase: 'shell_ready' },
      { phase: 'services_starting' },
      { phase: 'data_migrating' },
      { phase: 'manager_starting' },
      { phase: 'runtime_handoff' },
      { phase: 'runtime_starting' },
      { phase: 'ready' }
    ])
  })

  it('publishes progress details without advancing the phase', () => {
    const send = vi.fn()
    const state = new DesktopStartupState(() => ({
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send }
    } as never))

    state.transition('shell_ready')
    state.transition('manager_starting', 'Waiting for the previous Kun runtime...')
    state.noteDetail('Still waiting for 2 active task(s)...')

    expect(state.phase).toBe('manager_starting')
    expect(send.mock.calls[2][1]).toEqual({
      phase: 'manager_starting',
      detail: 'Still waiting for 2 active task(s)...'
    })
  })

  it('exposes shell readiness before runtime readiness', () => {
    const state = new DesktopStartupState(() => null)
    expect(() => state.assertShellReady()).toThrow(/shell is not ready/)
    state.transition('shell_ready')
    expect(() => state.assertReady()).toThrow(/not ready/)
    expect(state.assertShellReady()).toBeUndefined()
  })

  it('rejects skipped or repeated transitions and locks recovery', () => {
    const state = new DesktopStartupState(() => null)

    expect(() => state.transition('ready')).toThrow(/Invalid desktop startup transition/)
    state.transition('runtime_handoff')
    state.transition('recovery_required')
    expect(() => state.transition('runtime_starting')).toThrow(/Invalid desktop startup transition/)
    expect(() => state.assertReady()).toThrow(/recovery_required/)
  })
})
