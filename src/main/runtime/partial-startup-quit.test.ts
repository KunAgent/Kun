import { describe, expect, it, vi } from 'vitest'
import { revokeBrowserBindingBeforeQuit } from './partial-startup-quit'
import { normalizeAppSettings } from '../../shared/app-settings'

describe('partial startup quit', () => {
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
})
