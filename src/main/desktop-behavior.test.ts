import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '../shared/app-settings'

const setLoginItemSettings = vi.fn()
const logWarn = vi.fn()

vi.mock('electron', () => ({
  app: {
    setLoginItemSettings
  }
}))

vi.mock('./logger', () => ({
  logWarn
}))

function settings(appBehavior: Partial<AppSettingsV1['appBehavior']>): AppSettingsV1 {
  return {
    appBehavior: {
      openAtLogin: false,
      startMinimized: false,
      closeToTray: false,
      ...appBehavior
    }
  } as AppSettingsV1
}

describe('desktop behavior', () => {
  beforeEach(() => {
    setLoginItemSettings.mockReset()
    logWarn.mockReset()
  })

  it('starts hidden only for Windows login launch with the hidden arg', async () => {
    const { HIDDEN_START_ARG, shouldStartHidden } = await import('./desktop-behavior')
    const startupSettings = settings({ openAtLogin: true, startMinimized: true })

    expect(shouldStartHidden(startupSettings, 'win32', ['kun', HIDDEN_START_ARG])).toBe(true)
    expect(shouldStartHidden(startupSettings, 'win32', ['kun'])).toBe(false)
    expect(shouldStartHidden(startupSettings, 'darwin', ['kun', HIDDEN_START_ARG])).toBe(false)
    expect(shouldStartHidden(settings({ openAtLogin: true }), 'win32', ['kun', HIDDEN_START_ARG])).toBe(false)
  })

  it('syncs login item args on supported desktop platforms', async () => {
    const { syncLoginItemSettings } = await import('./desktop-behavior')

    syncLoginItemSettings(settings({ openAtLogin: true, startMinimized: true }), 'win32')
    syncLoginItemSettings(settings({ openAtLogin: true, startMinimized: true }), 'darwin')
    syncLoginItemSettings(settings({ openAtLogin: true, startMinimized: true }), 'linux')

    expect(setLoginItemSettings).toHaveBeenCalledTimes(2)
    expect(setLoginItemSettings).toHaveBeenNthCalledWith(1, {
      openAtLogin: true,
      args: ['--hidden']
    })
    expect(setLoginItemSettings).toHaveBeenNthCalledWith(2, {
      openAtLogin: true,
      args: []
    })
  })
})
