import { describe, expect, it } from 'vitest'
import { resolveMainWindowCloseDecision } from './window-close-behavior'

describe('window close behavior', () => {
  it('hides the window for ordinary close-to-tray closes', () => {
    expect(resolveMainWindowCloseDecision({
      closeAction: 'tray',
      isQuitting: false,
      isUpdateInstallQuitting: false
    })).toBe('hide-to-tray')
  })

  it('allows close-to-tray windows to close during update install quits', () => {
    expect(resolveMainWindowCloseDecision({
      closeAction: 'tray',
      isQuitting: false,
      isUpdateInstallQuitting: true
    })).toBe('allow')
  })

  it('prompts instead of hiding when tray initialization is unavailable', () => {
    expect(resolveMainWindowCloseDecision({
      closeAction: 'tray',
      isQuitting: false,
      isUpdateInstallQuitting: false,
      trayAvailable: false
    })).toBe('prompt')
  })

  it('allows windows to close during ordinary app quits', () => {
    expect(resolveMainWindowCloseDecision({
      closeAction: 'tray',
      isQuitting: true,
      isUpdateInstallQuitting: false
    })).toBe('allow')
  })

  it('routes a saved quit action through the application quit barrier', () => {
    expect(resolveMainWindowCloseDecision({
      closeAction: 'quit',
      isQuitting: false,
      isUpdateInstallQuitting: false
    })).toBe('quit-app')
  })
})
