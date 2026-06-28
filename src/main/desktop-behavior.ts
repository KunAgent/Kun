import { app } from 'electron'
import type { AppSettingsV1 } from '../shared/app-settings'
import { logWarn } from './logger'

export const HIDDEN_START_ARG = '--hidden'

export function shouldStartHidden(
  settings: AppSettingsV1,
  platform = process.platform,
  argv: readonly string[] = process.argv
): boolean {
  return (
    platform === 'win32' &&
    settings.appBehavior.openAtLogin &&
    settings.appBehavior.startMinimized &&
    argv.includes(HIDDEN_START_ARG)
  )
}

export function syncLoginItemSettings(
  settings: AppSettingsV1,
  platform = process.platform
): void {
  if (platform !== 'win32' && platform !== 'darwin') return
  const behavior = settings.appBehavior
  try {
    app.setLoginItemSettings({
      openAtLogin: behavior.openAtLogin,
      args:
        platform === 'win32' && behavior.openAtLogin && behavior.startMinimized
          ? [HIDDEN_START_ARG]
          : []
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[kun-gui] failed to update login item settings:', error)
    logWarn('desktop-behavior', 'Failed to update login item settings.', { message })
  }
}
