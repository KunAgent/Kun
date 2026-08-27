import { describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const webListeners = new Map<string, (...args: unknown[]) => void>()
  const windowListeners = new Map<string, (...args: unknown[]) => void>()
  const webContents = {
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      webListeners.set(event, listener)
    }),
    once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      webListeners.set(event, listener)
    }),
    setWindowOpenHandler: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    loadFile: vi.fn(async () => undefined)
  }
  const window = {
    webContents,
    setMenu: vi.fn(),
    loadFile: webContents.loadFile,
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      windowListeners.set(event, listener)
    }),
    once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      windowListeners.set(event, listener)
    }),
    show: vi.fn(),
    isDestroyed: () => false,
    isVisible: () => false
  }
  return {
    BrowserWindow: vi.fn(function MockBrowserWindow(_options?: unknown) {
      return window
    }),
    window,
    webContents,
    webListeners,
    windowListeners,
    app: { isPackaged: true },
    appIcon: { isEmpty: () => true }
  }
})

vi.mock('electron', () => ({ BrowserWindow: electron.BrowserWindow }))
vi.mock('./main-app-context', () => ({
  __dirname: '/tmp/out/main',
  appEnvironment: { flavor: 'production' },
  appIcon: electron.appIcon,
  developmentRendererUrl: () => undefined,
  mainState: {
    mainWindow: null,
    runtimeSettingsSyncStatus: null
  },
  traceStartup: vi.fn()
}))
vi.mock('./main-window-renderer-recovery', () => ({
  MAIN_WINDOW_RENDERER_RECOVERY_DELAY_MS: 0,
  MAIN_WINDOW_RENDERER_RECOVERY_MAX_ATTEMPTS: 0,
  MAIN_WINDOW_RENDERER_RECOVERY_WINDOW_MS: 0,
  MainWindowRendererRecoveryBudget: class {},
  shouldRecoverMainFrameLoad: () => false,
  shouldRecoverRendererProcess: () => false
}))
vi.mock('./logger', () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }))
vi.mock('./main-lifecycle', () => ({ isAppQuitInProgress: () => false }))
vi.mock('./main-tray', () => ({
  handleMainWindowClose: vi.fn(),
  showRendererContextMenu: vi.fn()
}))
vi.mock('./main-runtime-health', () => ({ runtimeSupervisor: { lastStatus: null } }))
vi.mock('./dev-renderer-cache', () => ({ reloadRenderer: vi.fn() }))
vi.mock('../shared/desktop-title-bar', () => ({ resolveDesktopTitleBarMode: () => 'system' }))
vi.mock('../shared/app-environment', () => ({ appWindowTitleForFlavor: () => 'Kun' }))

import {
  createRuntimeDataRecoveryWindow,
  createStorageRelocationWindow
} from './main-window'

describe('auxiliary renderer window hardening', () => {
  it('gives Storage Relocation a minimal preload and blocks navigation plus redirects', () => {
    createStorageRelocationWindow()

    expect(electron.webContents.setWindowOpenHandler).toHaveBeenCalled()
    const constructorOptions = electron.BrowserWindow.mock.calls[0]?.[0] as {
      webPreferences: { preload?: string }
    }
    expect(String(constructorOptions.webPreferences.preload)).toContain(
      'storage-relocation-recovery'
    )
    for (const eventName of ['will-navigate', 'will-redirect']) {
      const preventDefault = vi.fn()
      electron.webListeners.get(eventName)?.({ preventDefault }, 'https://example.com')
      expect(preventDefault).toHaveBeenCalledOnce()
    }
  })

  it('gives Runtime Data Recovery a minimal preload and blocks untrusted redirects', () => {
    electron.BrowserWindow.mockClear()
    electron.webListeners.clear()
    createRuntimeDataRecoveryWindow()

    const constructorOptions = electron.BrowserWindow.mock.calls[0]?.[0] as {
      webPreferences: { preload?: string }
    }
    expect(String(constructorOptions.webPreferences.preload)).toContain(
      'runtime-data-recovery'
    )
    const preventDefault = vi.fn()
    electron.webListeners.get('will-redirect')?.({ preventDefault }, 'https://example.com')
    expect(preventDefault).toHaveBeenCalledOnce()
  })
})
