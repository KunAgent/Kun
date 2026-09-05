import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockUpdater = EventEmitter & {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  forceDevUpdateConfig: boolean
  logger: unknown
  setFeedURL: ReturnType<typeof vi.fn>
  checkForUpdates: ReturnType<typeof vi.fn>
  downloadUpdate: ReturnType<typeof vi.fn>
  quitAndInstall: ReturnType<typeof vi.fn>
}

let updater: MockUpdater
let nativeUpdater: EventEmitter
let originalEnv: NodeJS.ProcessEnv
let appVersion: string
let appIsPackaged: boolean
let mockedFiles: Map<string, string>
let showMessageBox: ReturnType<typeof vi.fn>
let openExternal: ReturnType<typeof vi.fn>
let relaunchApp: ReturnType<typeof vi.fn>
let exitApp: ReturnType<typeof vi.fn>
let appListeners: Map<string, () => void>

function createUpdater(): MockUpdater {
  return Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    allowDowngrade: true,
    forceDevUpdateConfig: false,
    logger: null,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn()
  })
}

beforeEach(() => {
  originalEnv = { ...process.env }
  vi.useFakeTimers()
  vi.resetModules()
  updater = createUpdater()
  nativeUpdater = new EventEmitter()
  appVersion = '0.1.0'
  appIsPackaged = true
  mockedFiles = new Map()
  showMessageBox = vi.fn().mockResolvedValue({ response: 1 })
  openExternal = vi.fn().mockResolvedValue(undefined)
  relaunchApp = vi.fn()
  exitApp = vi.fn()
  appListeners = new Map()
  vi.doMock('node:fs/promises', () => ({
    mkdir: vi.fn().mockResolvedValue(undefined),
    open: vi.fn(async (path: string) => ({
      writeFile: vi.fn(async (value: string) => {
        mockedFiles.set(String(path), String(value))
      }),
      sync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    })),
    readFile: vi.fn(async (path: string) => {
      const value = mockedFiles.get(String(path))
      if (value === undefined) throw Object.assign(new Error('not found'), { code: 'ENOENT' })
      return value
    }),
    writeFile: vi.fn(async (path: string, value: string) => {
      mockedFiles.set(String(path), String(value))
    }),
    rename: vi.fn(async (from: string, to: string) => {
      const value = mockedFiles.get(String(from))
      if (value === undefined) throw Object.assign(new Error('not found'), { code: 'ENOENT' })
      mockedFiles.delete(String(from))
      mockedFiles.set(String(to), value)
    }),
    rm: vi.fn(async (path: string) => {
      mockedFiles.delete(String(path))
    })
  }))
  vi.doMock('electron', () => ({
    app: {
      get isPackaged() {
        return appIsPackaged
      },
      getAppPath: () => '/tmp/deepseek-gui-updater-test-app',
      getPath: () => '/tmp/deepseek-gui-updater-test-user-data',
      getVersion: () => appVersion,
      getLocale: () => 'en-US',
      relaunch: relaunchApp,
      exit: exitApp,
      on: (event: string, listener: () => void) => appListeners.set(event, listener)
    },
    autoUpdater: nativeUpdater,
    BrowserWindow: class {},
    dialog: { showMessageBox },
    shell: { openExternal }
  }))
  vi.doMock('electron-updater', () => ({
    default: { autoUpdater: updater },
    autoUpdater: updater
  }))
})

afterEach(() => {
  process.env = originalEnv
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.doUnmock('electron')
  vi.doUnmock('electron-updater')
  vi.doUnmock('node:fs/promises')
  vi.resetModules()
})

function platformManifestName(): string {
  if (process.platform === 'darwin') return 'latest-mac.yml'
  if (process.platform === 'linux') return 'latest-linux.yml'
  return 'latest.yml'
}

async function downloadInstallEligibleUpdate(
  module: typeof import('./gui-updater'),
  channel: 'stable' | 'frontier' = 'stable'
): Promise<void> {
  process.env.KUN_UPDATE_URL = `https://updates.example.test/${channel}/`
  process.env.DEEPSEEK_GUI_ALLOW_UNSIGNED_UPDATES = '1'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  updater.checkForUpdates.mockResolvedValue({
    updateInfo: { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' },
    isUpdateAvailable: true
  })
  updater.downloadUpdate.mockResolvedValue(['C:\\Temp\\Kun-0.2.0.exe'])
  await expect(module.checkGuiUpdate(channel)).resolves.toMatchObject({ ok: true, hasUpdate: true })
  await expect(module.downloadGuiUpdate(channel)).resolves.toMatchObject({ ok: true })
}

describe('checkGuiUpdate feed URL', () => {
  it('uses architecture-specific Linux update metadata', async () => {
    const { platformManifestName: manifestName } = await import('./gui-updater-support')
    expect(manifestName('linux', 'x64')).toBe('latest-linux.yml')
    expect(manifestName('linux', 'arm64')).toBe('latest-linux-arm64.yml')
  })

  it('prefers the kun-agent update feed when metadata is reachable', async () => {
    process.env.DEEPSEEK_GUI_ALLOW_UNSIGNED_UPDATES = '1'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    updater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' },
      isUpdateAvailable: true
    })

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    await expect(module.checkGuiUpdate('stable')).resolves.toMatchObject({
      ok: true,
      latestVersion: '0.2.0',
      hasUpdate: true
    })
    expect(fetchMock).toHaveBeenCalledWith(
      `https://www.kun-agent.com/api/r2/deepseek-gui/channels/stable/latest/${platformManifestName()}`,
      expect.objectContaining({ method: 'HEAD' })
    )
    expect(updater.setFeedURL).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: 'https://www.kun-agent.com/api/r2/deepseek-gui/channels/stable/latest/'
    })
  })

  it('falls back to the bare kun-agent feed before the legacy feed', async () => {
    process.env.DEEPSEEK_GUI_ALLOW_UNSIGNED_UPDATES = '1'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    updater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' },
      isUpdateAvailable: true
    })

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    await expect(module.checkGuiUpdate('stable')).resolves.toMatchObject({
      ok: true,
      latestVersion: '0.2.0',
      hasUpdate: true
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `https://www.kun-agent.com/api/r2/deepseek-gui/channels/stable/latest/${platformManifestName()}`,
      expect.objectContaining({ method: 'HEAD' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://kun-agent.com/api/r2/deepseek-gui/channels/stable/latest/${platformManifestName()}`,
      expect.objectContaining({ method: 'HEAD' })
    )
    expect(updater.setFeedURL).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: 'https://kun-agent.com/api/r2/deepseek-gui/channels/stable/latest/'
    })
  })

  it('falls back to the legacy deepseek-gui feed when both kun-agent feeds are unavailable', async () => {
    process.env.DEEPSEEK_GUI_ALLOW_UNSIGNED_UPDATES = '1'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    updater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' },
      isUpdateAvailable: true
    })

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    await expect(module.checkGuiUpdate('stable')).resolves.toMatchObject({
      ok: true,
      latestVersion: '0.2.0',
      hasUpdate: true
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `https://www.kun-agent.com/api/r2/deepseek-gui/channels/stable/latest/${platformManifestName()}`,
      expect.objectContaining({ method: 'HEAD' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://kun-agent.com/api/r2/deepseek-gui/channels/stable/latest/${platformManifestName()}`,
      expect.objectContaining({ method: 'HEAD' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `https://deepseek-gui.com/api/r2/deepseek-gui/channels/stable/latest/${platformManifestName()}`,
      expect.objectContaining({ method: 'HEAD' })
    )
    expect(updater.setFeedURL).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: 'https://deepseek-gui.com/api/r2/deepseek-gui/channels/stable/latest/'
    })
  })
})

describe('installGuiUpdate', () => {
  it('explicitly prevents automatic downgrade when changing update channels', async () => {
    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'frontier')
    module.setGuiUpdateChannel('frontier')
    module.setGuiUpdateChannel('stable')

    expect(updater.allowDowngrade).toBe(false)
  })

  it('passes the running Windows install directory to the spawned NSIS updater', async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    const execPathDescriptor = Object.getOwnPropertyDescriptor(process, 'execPath')
    Object.defineProperty(process, 'platform', {
      ...platformDescriptor,
      value: 'win32'
    })
    Object.defineProperty(process, 'execPath', {
      ...execPathDescriptor,
      value: 'D:\\Apps\\Kun\\Kun.exe'
    })

    try {
      const module = await import('./gui-updater')
      updater.quitAndInstall.mockImplementation(() => {
        expect(process.env.KUN_INSTALLER_UPDATE_SOURCE).toBe('D:\\Apps\\Kun')
      })
      module.initializeGuiUpdater(() => null, () => 'stable')
      await downloadInstallEligibleUpdate(module)

      await expect(module.installGuiUpdate()).resolves.toEqual({ ok: true })
      expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
    } finally {
      if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor)
      if (execPathDescriptor) Object.defineProperty(process, 'execPath', execPathDescriptor)
    }
  })

  it('binds a Windows installer child to the running packaged application directory', async () => {
    const module = await import('./gui-updater')
    const env: NodeJS.ProcessEnv = { KUN_INSTALLER_UPDATE_SOURCE: 'C:\\Previous' }

    const restore = module.setWindowsInstallerUpdateSource(
      env,
      'win32',
      'D:\\Apps\\Kun\\Kun.exe'
    )

    expect(env.KUN_INSTALLER_UPDATE_SOURCE).toBe('D:\\Apps\\Kun')
    restore()
    expect(env.KUN_INSTALLER_UPDATE_SOURCE).toBe('C:\\Previous')

    const emptyEnv: NodeJS.ProcessEnv = {}
    const clear = module.setWindowsInstallerUpdateSource(
      emptyEnv,
      'win32',
      'C:\\Users\\me\\AppData\\Local\\Programs\\Kun\\Kun.exe'
    )
    expect(emptyEnv.KUN_INSTALLER_UPDATE_SOURCE)
      .toBe('C:\\Users\\me\\AppData\\Local\\Programs\\Kun')
    clear()
    expect(emptyEnv.KUN_INSTALLER_UPDATE_SOURCE).toBeUndefined()
  })

  it('waits for managed runtime cleanup before asking the updater to quit and install', async () => {
    const module = await import('./gui-updater')
    let finishCleanup = (): void => {
      throw new Error('cleanup resolver was not set')
    }
    const beforeInstall = vi.fn(() => new Promise<void>((resolve) => {
      finishCleanup = resolve
    }))
    const setUpdateInstallQuitting = vi.fn()

    module.initializeGuiUpdater(
      () => null,
      () => 'stable',
      beforeInstall,
      undefined,
      setUpdateInstallQuitting
    )
    await downloadInstallEligibleUpdate(module)

    const installing = module.installGuiUpdate()
    for (let index = 0; index < 3; index += 1) await Promise.resolve()

    expect(beforeInstall).toHaveBeenCalledTimes(1)
    expect(setUpdateInstallQuitting).toHaveBeenCalledWith(true)
    expect(setUpdateInstallQuitting.mock.invocationCallOrder[0]).toBeLessThan(
      beforeInstall.mock.invocationCallOrder[0]
    )
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    finishCleanup()
    await expect(installing).resolves.toEqual({ ok: true })
    expect(setUpdateInstallQuitting).toHaveBeenCalledTimes(1)
    expect(setUpdateInstallQuitting).toHaveBeenCalledWith(true)
    expect(setUpdateInstallQuitting.mock.invocationCallOrder[0]).toBeLessThan(
      updater.quitAndInstall.mock.invocationCallOrder[0]
    )
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('rejects installation when the channel changes during cleanup', async () => {
    const module = await import('./gui-updater')
    let finishCleanup = (): void => undefined
    module.initializeGuiUpdater(
      () => null,
      () => 'stable',
      () => new Promise<void>((resolve) => { finishCleanup = resolve })
    )
    await downloadInstallEligibleUpdate(module)

    const installing = module.installGuiUpdate()
    for (let index = 0; index < 3; index += 1) await Promise.resolve()
    module.setGuiUpdateChannel('frontier')
    finishCleanup()

    await expect(installing).resolves.toMatchObject({
      ok: false,
      code: 'install_failed',
      message: 'The selected update is no longer eligible for installation.'
    })
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('reuses the same cleanup when the native updater emits before-quit-for-update', async () => {
    const module = await import('./gui-updater')
    let finishCleanup = (): void => {
      throw new Error('cleanup resolver was not set')
    }
    const beforeInstall = vi.fn(() => new Promise<void>((resolve) => {
      finishCleanup = resolve
    }))
    const setUpdateInstallQuitting = vi.fn()

    module.initializeGuiUpdater(
      () => null,
      () => 'stable',
      beforeInstall,
      undefined,
      setUpdateInstallQuitting
    )
    await downloadInstallEligibleUpdate(module)

    nativeUpdater.emit('before-quit-for-update')
    expect(setUpdateInstallQuitting).toHaveBeenCalledTimes(1)
    expect(setUpdateInstallQuitting).toHaveBeenCalledWith(true)
    expect(beforeInstall).not.toHaveBeenCalled()

    const installing = module.installGuiUpdate()
    await Promise.resolve()

    expect(beforeInstall).toHaveBeenCalledTimes(1)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    finishCleanup()
    await expect(installing).resolves.toEqual({ ok: true })
    expect(setUpdateInstallQuitting).toHaveBeenCalledTimes(1)
    expect(setUpdateInstallQuitting).toHaveBeenLastCalledWith(true)
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('clears the update quit marker when quitAndInstall throws synchronously', async () => {
    const module = await import('./gui-updater')
    const setUpdateInstallQuitting = vi.fn()
    updater.quitAndInstall.mockImplementation(() => {
      throw new Error('quit failed')
    })

    module.initializeGuiUpdater(
      () => null,
      () => 'stable',
      undefined,
      undefined,
      setUpdateInstallQuitting
    )
    await downloadInstallEligibleUpdate(module)

    await expect(module.installGuiUpdate()).resolves.toMatchObject({
      ok: false,
      code: 'install_failed',
      message: 'quit failed'
    })
    expect(setUpdateInstallQuitting.mock.calls).toEqual([[true], [false]])
    expect(relaunchApp).toHaveBeenCalledOnce()
    expect(exitApp).toHaveBeenCalledWith(0)
  })

  it('relaunches the old application when electron-updater emits an install error', async () => {
    const module = await import('./gui-updater')
    const setUpdateInstallQuitting = vi.fn()
    updater.quitAndInstall.mockImplementation(() => {
      updater.emit('error', new Error('installer could not start'))
    })
    module.initializeGuiUpdater(
      () => null,
      () => 'stable',
      async () => undefined,
      undefined,
      setUpdateInstallQuitting
    )
    await downloadInstallEligibleUpdate(module)

    await expect(module.installGuiUpdate()).resolves.toMatchObject({
      ok: false,
      code: 'install_failed',
      message: 'installer could not start'
    })
    expect(setUpdateInstallQuitting.mock.calls).toEqual([[true], [false]])
    expect(relaunchApp).toHaveBeenCalledOnce()
    expect(exitApp).toHaveBeenCalledWith(0)
  })

  it('recovers when electron-updater reports an asynchronous NSIS launch failure', async () => {
    const module = await import('./gui-updater')
    const setUpdateInstallQuitting = vi.fn()
    updater.quitAndInstall.mockImplementation(() => {
      queueMicrotask(() => updater.emit('error', new Error('async installer launch failed')))
    })
    module.initializeGuiUpdater(
      () => null,
      () => 'stable',
      async () => undefined,
      undefined,
      setUpdateInstallQuitting
    )
    await downloadInstallEligibleUpdate(module)

    await expect(module.installGuiUpdate()).resolves.toEqual({ ok: true })
    await Promise.resolve()

    expect(module.getGuiUpdateState()).toMatchObject({
      status: 'error',
      code: 'install_failed',
      message: 'async installer launch failed'
    })
    expect(setUpdateInstallQuitting.mock.calls).toEqual([[true], [false]])
    expect(relaunchApp).toHaveBeenCalledOnce()
    expect(exitApp).toHaveBeenCalledWith(0)
  })

  it('relaunches after a partially completed update preflight fails', async () => {
    const module = await import('./gui-updater')
    const setUpdateInstallQuitting = vi.fn()
    module.initializeGuiUpdater(
      () => null,
      () => 'stable',
      async () => {
        throw new Error('shared manager stop timed out')
      },
      undefined,
      setUpdateInstallQuitting
    )
    await downloadInstallEligibleUpdate(module)

    await expect(module.installGuiUpdate()).resolves.toMatchObject({
      ok: false,
      code: 'install_failed',
      message: 'shared manager stop timed out'
    })
    await Promise.resolve()

    expect(setUpdateInstallQuitting.mock.calls).toEqual([[true], [false]])
    expect(relaunchApp).toHaveBeenCalledOnce()
    expect(exitApp).toHaveBeenCalledWith(0)
  })

  it('writes pending installer state before handing off to NSIS', async () => {
    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')
    await downloadInstallEligibleUpdate(module)

    await expect(module.installGuiUpdate()).resolves.toEqual({ ok: true })
    const stored = [...mockedFiles.entries()].find(([path]) => path.endsWith('pending-update.json'))
    expect(stored?.[1]).toContain('"oldVersion": "0.1.0"')
    expect(stored?.[1]).toContain('"newVersion": "0.2.0"')
    expect(stored?.[1]).toContain('Kun-0.2.0.exe')
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('defers installation during Windows session end without discarding the download', async () => {
    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')
    await downloadInstallEligibleUpdate(module)
    appListeners.get('session-end')?.()

    await expect(module.installGuiUpdate()).resolves.toMatchObject({
      ok: false,
      code: 'install_deferred'
    })
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('shares one install operation when the action is triggered twice', async () => {
    const module = await import('./gui-updater')
    let finishCleanup = (): void => {
      throw new Error('cleanup resolver was not set')
    }
    module.initializeGuiUpdater(
      () => null,
      () => 'stable',
      () => new Promise<void>((resolve) => { finishCleanup = resolve })
    )
    await downloadInstallEligibleUpdate(module)

    const first = module.installGuiUpdate()
    const second = module.installGuiUpdate()
    expect(second).toBe(first)

    for (let index = 0; index < 3; index += 1) await Promise.resolve()
    finishCleanup()
    await expect(first).resolves.toEqual({ ok: true })
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })
})

describe('downloadGuiUpdate recovery', () => {
  it('clears stale download state so an interrupted download can be retried', async () => {
    process.env.KUN_UPDATE_URL = 'https://updates.example.test/'
    process.env.DEEPSEEK_GUI_ALLOW_UNSIGNED_UPDATES = '1'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')
    updater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' },
      isUpdateAvailable: true
    })
    await expect(module.checkGuiUpdate()).resolves.toMatchObject({ ok: true, hasUpdate: true })
    updater.downloadUpdate
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(['C:\\Temp\\Kun-0.2.0.exe'])

    await expect(module.downloadGuiUpdate()).resolves.toMatchObject({
      ok: false,
      code: 'download_failed'
    })
    await expect(module.installGuiUpdate()).resolves.toMatchObject({
      ok: false,
      code: 'install_failed',
      message: 'The update has not finished downloading yet.'
    })
    await expect(module.downloadGuiUpdate()).resolves.toEqual({
      ok: true,
      paths: ['C:\\Temp\\Kun-0.2.0.exe']
    })
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2)
  })

  it('ignores a stale download completion after switching from stable to frontier', async () => {
    process.env.KUN_UPDATE_URL_STABLE = 'https://updates.example.test/stable/'
    process.env.KUN_UPDATE_URL_FRONTIER = 'https://updates.example.test/frontier/'
    process.env.DEEPSEEK_GUI_ALLOW_UNSIGNED_UPDATES = '1'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    let finishDownload = (): void => undefined
    updater.downloadUpdate.mockImplementation(() => new Promise<string[]>((resolve) => {
      finishDownload = () => resolve(['C:\\Temp\\Kun-0.2.0.exe'])
    }))
    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')
    updater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' },
      isUpdateAvailable: true
    })
    await expect(module.checkGuiUpdate('stable')).resolves.toMatchObject({ ok: true, hasUpdate: true })

    const downloading = module.downloadGuiUpdate('stable')
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalledOnce())
    module.setGuiUpdateChannel('frontier')
    updater.emit('download-progress', { percent: 100 })
    updater.emit('update-downloaded', { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' })
    finishDownload()

    await expect(downloading).resolves.toMatchObject({ ok: false, code: 'download_failed' })
    expect(module.getGuiUpdateState()).toEqual({ status: 'idle' })
    await expect(module.installGuiUpdate()).resolves.toMatchObject({ ok: false, code: 'install_failed' })
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('ignores a stale check result after switching from stable to frontier', async () => {
    process.env.KUN_UPDATE_URL_STABLE = 'https://updates.example.test/stable/'
    process.env.KUN_UPDATE_URL_FRONTIER = 'https://updates.example.test/frontier/'
    process.env.DEEPSEEK_GUI_ALLOW_UNSIGNED_UPDATES = '1'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    let finishCheck = (_value: unknown): void => undefined
    updater.checkForUpdates.mockImplementation(() => new Promise((resolve) => {
      finishCheck = resolve
    }))
    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    const checking = module.checkGuiUpdate('stable')
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledOnce())
    module.setGuiUpdateChannel('frontier')
    updater.emit('update-available', { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' })
    finishCheck({ updateInfo: { version: '0.2.0' }, isUpdateAvailable: true })

    await expect(checking).resolves.toMatchObject({ ok: false, channel: 'stable' })
    expect(module.getGuiUpdateState()).toEqual({ status: 'idle' })
  })
})
