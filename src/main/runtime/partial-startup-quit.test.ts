import { afterEach, describe, expect, it, vi } from 'vitest'
import { revokeBrowserBindingBeforeQuit } from './partial-startup-quit'
import { normalizeAppSettings } from '../../shared/app-settings'
import { DesktopShutdownSteps } from './desktop-shutdown-steps'

describe('partial startup quit', () => {
  afterEach(() => vi.useRealTimers())
  it.each([
    { hasStore: false, hasBinding: true, runtimeIsLive: true },
    { hasStore: true, hasBinding: false, runtimeIsLive: true },
    { hasStore: true, hasBinding: true, runtimeIsLive: false }
  ])('does not access unavailable resources: %j', async ({ hasStore, ...state }) => {
    const load = vi.fn(async () => { throw new Error('must not load') })
    const revoke = vi.fn()
    await revokeBrowserBindingBeforeQuit({ ...state, store: hasStore ? { load } : undefined, revoke })
    expect(load).not.toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
  })
  it('revokes initialized authority with the loaded settings', async () => {
    const settings = normalizeAppSettings({} as never)
    const revoke = vi.fn(async () => false)
    await revokeBrowserBindingBeforeQuit({ store: { load: async () => settings }, hasBinding: true, runtimeIsLive: true, revoke })
    expect(revoke).toHaveBeenCalledWith(settings)
  })

  it('does not start a settings read after the best-effort revoke deadline', async () => {
    const load = vi.fn(), revoke = vi.fn()
    await revokeBrowserBindingBeforeQuit({ store: { load }, hasBinding: true, runtimeIsLive: true,
      deadline: Date.now() - 1, revoke })
    expect(load).not.toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
  })

  it('does not issue a late revoke when settings loading consumes the remaining budget', async () => {
    vi.useFakeTimers()
    const settings = normalizeAppSettings({} as never), revoke = vi.fn()
    let finishLoad!: (value: typeof settings) => void
    const load = new Promise<typeof settings>(resolve => { finishLoad = resolve })
    const work = revokeBrowserBindingBeforeQuit({ store: { load: () => load }, hasBinding: true,
      runtimeIsLive: true, deadline: Date.now() + 50, revoke })
    await vi.advanceTimersByTimeAsync(50)
    await work
    finishLoad(settings)
    await Promise.resolve()
    expect(revoke).not.toHaveBeenCalled()
  })

  it('passes only the budget remaining after settings loading to the revoke transport', async () => {
    vi.useFakeTimers()
    const settings = normalizeAppSettings({} as never), revoke = vi.fn(async () => false)
    const work = revokeBrowserBindingBeforeQuit({
      store: { load: async () => { await new Promise(resolve => setTimeout(resolve, 20)); return settings } },
      hasBinding: true, runtimeIsLive: true, deadline: Date.now() + 80, revoke
    })
    await vi.advanceTimersByTimeAsync(20)
    await work
    expect(revoke).toHaveBeenCalledWith(settings, 60)
  })

  it('leaves time for verified Runtime cleanup after a slow best-effort browser revoke', async () => {
    vi.useFakeTimers()
    const settings = normalizeAppSettings({} as never)
    const cleanup = new DesktopShutdownSteps(Date.now() - 1800)
    const revoke = vi.fn(() => new Promise<never>(() => {}))
    const browser = cleanup.settle({ name: 'browser-authority', run: () => revokeBrowserBindingBeforeQuit({
      store: { load: async () => settings }, hasBinding: true, runtimeIsLive: true,
      deadline: cleanup.deadline(2000) - 100, revoke
    }) }, cleanup.deadline(2000))
    await vi.advanceTimersByTimeAsync(100)
    expect(await browser).toBe(true)
    expect(revoke).toHaveBeenCalledWith(settings, 100)
    const stopRuntime = vi.fn(async () => { throw new Error('owned Runtime is still alive') })
    expect(await cleanup.settle({ name: 'runtime', run: stopRuntime }, cleanup.deadline(12000))).toBe(false)
    expect(() => cleanup.assertComplete()).toThrow('owned Runtime is still alive')
  })
})
