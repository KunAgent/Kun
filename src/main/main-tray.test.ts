import { beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from 'electron'

const state = vi.hoisted(() => {
  class FakeTray {
    readonly destroy = vi.fn()
    readonly isDestroyed = vi.fn(() => false)
    readonly on = vi.fn()
    readonly setToolTip = vi.fn()
    readonly setContextMenu = vi.fn()
    readonly getBounds = vi.fn()
    readonly popUpContextMenu = vi.fn()

    constructor(_image: unknown) {
      state.createdTrays.push(this)
    }
  }

  const state = { createdTrays: [] as FakeTray[] }
  return { FakeTray, ...state }
})

vi.mock('electron', () => ({
  app: { quit: vi.fn() },
  BrowserWindow: class {},
  dialog: { showMessageBox: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(() => ({})) },
  nativeImage: { createEmpty: vi.fn(() => ({ isEmpty: () => true })) },
  Notification: { isSupported: vi.fn() },
  screen: { getCursorScreenPoint: vi.fn(), getDisplayMatching: vi.fn() },
  Tray: state.FakeTray
}))

vi.mock('./app-icon', () => ({
  notificationIconOptions: vi.fn(),
  pickTrayIcon: vi.fn(() => ({ isEmpty: () => false })),
  prepareTrayIcon: vi.fn((icon) => icon)
}))
vi.mock('./tray-session-menu', () => ({
  buildTrayMenuTemplate: vi.fn(() => []),
  parseTrayThreads: vi.fn(() => [])
}))
vi.mock('./tray-quota-position', () => ({
  resolveTrayQuotaAnchorBounds: vi.fn(),
  resolveTrayQuotaPopoverPosition: vi.fn()
}))
vi.mock('./tray-quota-window-options', () => ({
  resolveTrayQuotaWindowPlatformOptions: vi.fn(),
  resolveTrayQuotaWorkspaceOptions: vi.fn()
}))
vi.mock('./desktop-behavior', () => ({ syncLoginItemSettings: vi.fn() }))
vi.mock('./main-paths', () => ({ resolveNamedPreloadPath: vi.fn() }))
vi.mock('./runtime/kun-adapter', () => ({
  getRuntimeBaseUrlForSettings: vi.fn(),
  kunRuntimeAdapter: { resolveConnection: vi.fn() },
  runtimeAuthHeaders: vi.fn()
}))
vi.mock('./logger', () => ({ logError: vi.fn(), logWarn: vi.fn() }))
vi.mock('./window-close-behavior', () => ({ resolveMainWindowCloseDecision: vi.fn() }))
vi.mock('./notification-preferences', () => ({ turnCompleteNotificationDisabledReason: vi.fn() }))
vi.mock('./main-lifecycle', () => ({ runtimeShutdown: { requestQuit: vi.fn() } }))
vi.mock('./main-app-context', () => ({
  __dirname: '/tmp',
  appEnvironment: { appName: 'Kun', flavor: 'development' },
  appIcon: { isEmpty: () => false },
  developmentRendererUrl: () => undefined,
  mainState: {
    appBehavior: {}, tray: null, trayAvailable: false, trayMenu: null, trayMenuOpenPromise: null,
    trayQuotaWindow: null, trayQuotaWindowReady: null, trayQuotaToggleGeneration: 0,
    mainWindow: null, createWindow: vi.fn(), store: { load: vi.fn() }
  },
  nativeDialogCoordinator: { run: vi.fn() },
  trayIcon: { isEmpty: () => false }
}))

import { mainState } from './main-app-context'
import { runtimeShutdown } from './main-lifecycle'
import { handleMainWindowClose, syncTray } from './main-tray'
import { resolveMainWindowCloseDecision } from './window-close-behavior'

function settings(closeAction: 'ask' | 'tray' | 'quit') {
  return { locale: 'en', appBehavior: { closeAction } } as never
}

describe('syncTray', () => {
  beforeEach(() => {
    state.createdTrays.length = 0
    mainState.tray = null
    mainState.trayAvailable = false
    mainState.trayMenu = null
    mainState.trayQuotaWindow = null
    mainState.trayQuotaWindowReady = null
    mainState.trayQuotaToggleGeneration = 0
    vi.mocked(app.quit).mockClear()
    vi.mocked(runtimeShutdown.requestQuit).mockClear()
    vi.mocked(resolveMainWindowCloseDecision).mockReset()
  })

  it('enters the real quit barrier for a saved quit close action', () => {
    vi.mocked(resolveMainWindowCloseDecision).mockReturnValue('quit-app')
    const event = { preventDefault: vi.fn() }
    const window = { isDestroyed: () => false, hide: vi.fn() }

    handleMainWindowClose(window as never, event as never)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(runtimeShutdown.requestQuit).toHaveBeenCalledOnce()
    expect(app.quit).toHaveBeenCalledOnce()
    expect(window.hide).not.toHaveBeenCalled()
  })

  it('creates a quota tray entry when closing the window quits the app', () => {
    syncTray(settings('quit'))

    expect(state.createdTrays).toHaveLength(1)
    expect(mainState.tray).toBe(state.createdTrays[0])
    expect(mainState.trayAvailable).toBe(true)
    expect(state.createdTrays[0].setToolTip).toHaveBeenCalledWith('Kun')
    expect(state.createdTrays[0].on).toHaveBeenCalledWith('click', expect.any(Function))
    expect(state.createdTrays[0].on).toHaveBeenCalledWith('double-click', expect.any(Function))
    expect(state.createdTrays[0].on).toHaveBeenCalledWith('right-click', expect.any(Function))
  })

  it('keeps the existing tray and quota popover through close-action changes', () => {
    syncTray(settings('tray'))
    const tray = state.createdTrays[0]
    const quotaWindow = {
      isDestroyed: () => false,
      destroy: vi.fn(),
      webContents: { isLoadingMainFrame: () => false, send: vi.fn() }
    }
    mainState.trayQuotaWindow = quotaWindow as never

    syncTray(settings('ask'))
    syncTray(settings('quit'))

    expect(mainState.tray).toBe(tray)
    expect(mainState.trayAvailable).toBe(true)
    expect(tray.destroy).not.toHaveBeenCalled()
    expect(quotaWindow.destroy).not.toHaveBeenCalled()
  })
})
