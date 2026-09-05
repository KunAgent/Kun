import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseStartupFailureAction,
  sanitizeStartupFailureMessage,
  startupFailurePresentation,
  startupFailureHtml
} from './startup-failure-content'
import {
  ClientRuntimeOwnerBusyError,
  KunHandoffError
} from './runtime/kun-installed-build-handoff'

const electron = vi.hoisted(() => {
  const webHandlers = new Map<string, (...args: unknown[]) => void>()
  const windowHandlers = new Map<string, (...args: unknown[]) => void>()
  const window = {
    webContents: {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((name: string, handler: (...args: unknown[]) => void) => {
        webHandlers.set(name, handler)
      })
    },
    once: vi.fn((name: string, handler: (...args: unknown[]) => void) => {
      windowHandlers.set(name, handler)
    }),
    loadURL: vi.fn().mockResolvedValue(undefined),
    isDestroyed: vi.fn(() => false),
    show: vi.fn()
  }
  return {
    app: {
      isPackaged: true,
      relaunch: vi.fn(),
      quit: vi.fn()
    },
    BrowserWindow: vi.fn(function MockBrowserWindow(_options?: unknown) {
      return window
    }),
    dialog: { showErrorBox: vi.fn() },
    shell: { openPath: vi.fn().mockResolvedValue('') },
    webHandlers,
    windowHandlers,
    window
  }
})

vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: electron.BrowserWindow,
  dialog: electron.dialog,
  shell: electron.shell
}))

vi.mock('./main-app-context', () => ({
  appIcon: { isEmpty: () => true }
}))

vi.mock('./logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn()
}))

import { showStartupFailureWindow } from './startup-failure-window'

beforeEach(() => {
  vi.clearAllMocks()
  electron.webHandlers.clear()
  electron.windowHandlers.clear()
  electron.window.loadURL.mockResolvedValue(undefined)
  electron.window.isDestroyed.mockReturnValue(false)
  electron.shell.openPath.mockResolvedValue('')
})

function runtimeHandoffError(retryable = true): KunHandoffError {
  return new KunHandoffError(
    'runtime_stop_failed',
    'stop-runtimes',
    'installed-build-change',
    retryable,
    {
      kind: 'runtime',
      flavor: 'production',
      instanceId: 'runtime-instance',
      pid: 4312,
      port: 18899,
      buildId: 'a'.repeat(64)
    },
    'The previous Runtime did not exit; runtimeToken=do-not-render'
  )
}

function lastRenderedHtml(): string {
  const value = electron.window.loadURL.mock.calls.at(-1)?.[0]
  if (typeof value !== 'string') return ''
  return decodeURIComponent(value.slice(value.indexOf(',') + 1))
}

describe('startup failure recovery helpers', () => {
  it('redacts credentials and OAuth secrets from startup diagnostics', () => {
    const message = sanitizeStartupFailureMessage(
      'failed https://user:pass@proxy.test/?access_token=secret Bearer abc.def '
      + '{"refresh_token":"hidden"}'
    )

    expect(message).not.toContain('user:pass')
    expect(message).not.toContain('secret')
    expect(message).not.toContain('abc.def')
    expect(message).not.toContain('hidden')
    expect(message).toContain('[redacted]')
  })

  it('explains Runtime authentication failures without exposing the JSON envelope', () => {
const presentation = startupFailurePresentation(
new Error('{"code":"unauthorized","message":"unauthorized"}')
)

expect(presentation.message).toContain('rejected the desktop access credential')
expect(presentation.message).not.toContain('{"code"')
})

it('gives a client owner conflict an actionable, non-destructive recovery', () => {
const presentation = startupFailurePresentation(Object.assign(
new Error('Kun Runtime is already owned by tui process 4313'),
{ code: 'client_runtime_owner_busy' }
))

expect(presentation.message).toContain('Close the other Kun GUI or TUI')
expect(presentation.message).toContain('will not stop another client automatically')
})

it('presents a typed handoff failure with safe owner details and task continuity', () => {
    const presentation = startupFailurePresentation(runtimeHandoffError())
    const html = startupFailureHtml(presentation.message, '/tmp/logs', {
      handoff: presentation.handoff,
      retryable: presentation.retryable
    })

    expect(presentation.message).toContain('Phase: stop-runtimes')
    expect(presentation.message).toContain('Owner: runtime/production')
    expect(presentation.message).toContain('PID: 4312')
    expect(presentation.message).toContain(`Build: ${'a'.repeat(12)}`)
    expect(presentation.message).not.toContain('do-not-render')
    expect(html).toContain('pause and checkpoint active work')
    expect(html).toContain('Safely stop old Kun and retry')
  })

  it('does not render retry or force actions for an unverified owner', () => {
    const presentation = startupFailurePresentation(runtimeHandoffError(false))
    const html = startupFailureHtml(presentation.message, '/tmp/logs', {
      handoff: presentation.handoff,
      retryable: presentation.retryable
    })

    expect(html).not.toContain('kun-startup-action:retry')
    expect(html).not.toContain('force')
    expect(html).toContain('left the process, active work, and saved data untouched')
    expect(html).toContain('kun-startup-action:open-logs')
    expect(html).toContain('kun-startup-action:quit')
  })

  it('escapes diagnostic content before rendering static recovery HTML', () => {
    const html = startupFailureHtml('<script>alert(1)</script>', 'C:\\Users\\<name>')

    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('C:\\Users\\&lt;name&gt;')
  })

  it('accepts only known recovery actions', () => {
    expect(parseStartupFailureAction('kun-startup-action:retry')).toBe('retry')
    expect(parseStartupFailureAction('kun-startup-action:open-logs')).toBe('open-logs')
    expect(parseStartupFailureAction('kun-startup-action:quit')).toBe('quit')
    expect(parseStartupFailureAction('kun-startup-action:erase-data')).toBeNull()
    expect(parseStartupFailureAction('https://example.test')).toBeNull()
  })
})

describe('showStartupFailureWindow', () => {
  it('keeps a real recovery window alive without automatically quitting', () => {
    const window = showStartupFailureWindow(new Error('manager failed'), 'C:\\Kun\\logs')

    expect(window).toBe(electron.window)
    expect(electron.BrowserWindow).toHaveBeenCalledOnce()
    expect(electron.window.loadURL).toHaveBeenCalledWith(expect.stringMatching(/^data:text\/html/))
    expect(electron.app.quit).not.toHaveBeenCalled()

    electron.windowHandlers.get('ready-to-show')?.()
    expect(electron.window.show).toHaveBeenCalledOnce()
  })

  it('creates the recovery window before destroying the workbench window', () => {
    const workbenchWindow = {
      isDestroyed: vi.fn(() => false),
      destroy: vi.fn()
    }

    const window = showStartupFailureWindow(
      new Error('manager failed'),
      'C:\\Kun\\logs',
      { replaceWindow: workbenchWindow as never }
    )

    expect(window).toBe(electron.window)
    expect(workbenchWindow.destroy).toHaveBeenCalledOnce()
    expect(electron.BrowserWindow.mock.invocationCallOrder[0])
      .toBeLessThan(workbenchWindow.destroy.mock.invocationCallOrder[0]!)
  })

  it('preserves the workbench window when recovery window creation fails', () => {
    const workbenchWindow = {
      isDestroyed: vi.fn(() => false),
      destroy: vi.fn()
    }
    electron.BrowserWindow.mockImplementationOnce(() => {
      throw new Error('window creation failed')
    })

    const window = showStartupFailureWindow(
      new Error('manager failed'),
      'C:\\Kun\\logs',
      { replaceWindow: workbenchWindow as never }
    )

    expect(window).toBeNull()
    expect(workbenchWindow.destroy).not.toHaveBeenCalled()
    expect(electron.dialog.showErrorBox).toHaveBeenCalledWith(
      'Kun failed to start',
      'manager failed'
    )
  })

  it('runs only an explicit recovery action from intercepted navigation', async () => {
    const recoverRetry = vi.fn().mockResolvedValue(undefined)
    showStartupFailureWindow(new Error('manager failed'), 'C:\\Kun\\logs', { recoverRetry })
    const preventDefault = vi.fn()
    const navigate = electron.webHandlers.get('will-navigate')

    navigate?.({ preventDefault }, 'kun-startup-action:open-logs')
    await Promise.resolve()
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(electron.shell.openPath).toHaveBeenCalledWith('C:\\Kun\\logs')
    expect(electron.app.quit).not.toHaveBeenCalled()

    navigate?.({ preventDefault }, 'kun-startup-action:retry')
    await vi.waitFor(() => expect(electron.app.relaunch).toHaveBeenCalledOnce())
    expect(recoverRetry).toHaveBeenCalledOnce()
    expect(electron.app.quit).toHaveBeenCalledOnce()
  })

  it('relaunches without authorizing handoff cleanup for a client-owned Runtime conflict', async () => {
    const recoverHandoff = vi.fn().mockResolvedValue(undefined)
    const recoverRetry = vi.fn().mockResolvedValue(undefined)
    const error = new ClientRuntimeOwnerBusyError('tui', {
      kind: 'runtime',
      flavor: 'production',
      instanceId: 'tui-runtime',
      pid: 4313,
      port: 18899
    })

    showStartupFailureWindow(error, '/tmp/kun-logs', { recoverHandoff, recoverRetry })
    expect(lastRenderedHtml()).toContain('Retry Kun')
    expect(lastRenderedHtml()).not.toContain('Safely stop old Kun')

    electron.webHandlers.get('will-navigate')?.(
      { preventDefault: vi.fn() },
      'kun-startup-action:retry'
    )

    expect(recoverHandoff).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(electron.app.relaunch).toHaveBeenCalledOnce())
    expect(recoverRetry).toHaveBeenCalledOnce()
    expect(electron.app.quit).toHaveBeenCalledOnce()
  })

  it('keeps recovery open when ordinary retry cleanup fails', async () => {
    const recoverRetry = vi.fn().mockRejectedValue(new Error('cleanup failed'))
    showStartupFailureWindow(new Error('manager failed'), '/tmp/kun-logs', { recoverRetry })

    electron.webHandlers.get('will-navigate')?.(
      { preventDefault: vi.fn() },
      'kun-startup-action:retry'
    )

    await vi.waitFor(() => expect(lastRenderedHtml()).toContain('Retry failed: cleanup failed'))
    expect(electron.app.relaunch).not.toHaveBeenCalled()
    expect(electron.app.quit).not.toHaveBeenCalled()
  })

  it('runs handoff recovery once and relaunches only after it succeeds', async () => {
    let finishRecovery!: () => void
    const recovery = new Promise<void>((resolve) => {
      finishRecovery = resolve
    })
    const recoverHandoff = vi.fn(() => recovery)
    showStartupFailureWindow(runtimeHandoffError(), '/tmp/kun-logs', { recoverHandoff })
    const navigate = electron.webHandlers.get('will-navigate')
    const preventDefault = vi.fn()

    navigate?.({ preventDefault }, 'kun-startup-action:retry')
    navigate?.({ preventDefault }, 'kun-startup-action:retry')

    expect(recoverHandoff).toHaveBeenCalledOnce()
    expect(electron.app.relaunch).not.toHaveBeenCalled()
    expect(electron.app.quit).not.toHaveBeenCalled()
    expect(lastRenderedHtml()).toContain('Safely stopping old Kun')

    finishRecovery()
    await vi.waitFor(() => expect(electron.app.relaunch).toHaveBeenCalledOnce())
    expect(electron.app.quit).toHaveBeenCalledOnce()
  })

  it('keeps the recovery window open and sanitized when a safe retry fails', async () => {
    const recoverHandoff = vi.fn().mockRejectedValue(
      new Error('shutdown rejected runtimeToken=secret-value')
    )
    showStartupFailureWindow(runtimeHandoffError(), '/tmp/kun-logs', { recoverHandoff })

    electron.webHandlers.get('will-navigate')?.(
      { preventDefault: vi.fn() },
      'kun-startup-action:retry'
    )

    await vi.waitFor(() => expect(lastRenderedHtml()).toContain('Retry failed'))
    expect(lastRenderedHtml()).toContain('runtimeToken=[redacted]')
    expect(lastRenderedHtml()).not.toContain('secret-value')
    expect(lastRenderedHtml()).toContain('kun-startup-action:retry')
    expect(electron.app.relaunch).not.toHaveBeenCalled()
    expect(electron.app.quit).not.toHaveBeenCalled()
  })

  it('finishes a successful handoff even if the recovery window was closed', async () => {
    let finishRecovery!: () => void
    const recoverHandoff = vi.fn(() => new Promise<void>((resolve) => {
      finishRecovery = resolve
    }))
    showStartupFailureWindow(runtimeHandoffError(), '/tmp/kun-logs', { recoverHandoff })
    electron.webHandlers.get('will-navigate')?.(
      { preventDefault: vi.fn() },
      'kun-startup-action:retry'
    )
    electron.window.isDestroyed.mockReturnValue(true)

    finishRecovery()
    await vi.waitFor(() => expect(electron.app.relaunch).toHaveBeenCalledOnce())
    expect(electron.app.quit).toHaveBeenCalledOnce()
  })

  it('keeps the recovery page without any privileged preload', () => {
    showStartupFailureWindow(new Error('failed'), '/tmp/kun-logs')

    const constructorOptions = electron.BrowserWindow.mock.calls[0]?.[0] as {
      webPreferences?: { preload?: string; contextIsolation?: boolean; sandbox?: boolean }
    }
    expect(constructorOptions.webPreferences?.preload).toBeUndefined()
    expect(constructorOptions.webPreferences?.contextIsolation).toBe(true)
    expect(constructorOptions.webPreferences?.sandbox).toBe(true)
  })

  it('ignores a forged retry navigation when owner verification failed', () => {
    const recoverHandoff = vi.fn().mockResolvedValue(undefined)
    showStartupFailureWindow(runtimeHandoffError(false), '/tmp/kun-logs', { recoverHandoff })

    expect(lastRenderedHtml()).not.toContain('kun-startup-action:retry')
    electron.webHandlers.get('will-navigate')?.(
      { preventDefault: vi.fn() },
      'kun-startup-action:retry'
    )

    expect(recoverHandoff).not.toHaveBeenCalled()
    expect(electron.app.relaunch).not.toHaveBeenCalled()
  })
})
