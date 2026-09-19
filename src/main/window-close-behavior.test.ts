import { describe, expect, it } from 'vitest'
import { resolveMainWindowCloseDecision } from './window-close-behavior'

describe('window close behavior', () => {
  it.each(['ask', 'tray', 'quit', undefined])('quits on main window close with legacy preference %s', (closeAction) => {
    expect(resolveMainWindowCloseDecision({
      closeAction, isQuitting: false, isUpdateInstallQuitting: false
    })).toBe('quit-app')
  })

  it('quits when the system tray is unavailable', () => {
    expect(resolveMainWindowCloseDecision({
      closeAction: 'tray', isQuitting: false, isUpdateInstallQuitting: false, trayAvailable: false
    })).toBe('quit-app')
  })

  it.each([
    { isQuitting: true, isUpdateInstallQuitting: false },
    { isQuitting: false, isUpdateInstallQuitting: true }
  ])('allows closing after a quit has been requested', (state) => {
    expect(resolveMainWindowCloseDecision(state)).toBe('allow')
  })
})
