import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockUpdater = EventEmitter & {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
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
let mockedFiles: Map<string, string>
let showMessageBox: ReturnType<typeof vi.fn>
let openExternal: ReturnType<typeof vi.fn>

function createUpdater(): MockUpdater {
  return Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
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
  mockedFiles = new Map()
  showMessageBox = vi.fn().mockResolvedValue({ response: 1 })
  openExternal = vi.fn().mockResolvedValue(undefined)
  vi.doMock('node:fs/promises', () => ({
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(async (path: string) => {
      const value = mockedFiles.get(String(path))
      if (value === undefined) throw Object.assign(new Error('not found'), { code: 'ENOENT' })
      return value
    }),
    writeFile: vi.fn(async (path: string, value: string) => {
      mockedFiles.set(String(path), String(value))
    })
  }))
  vi.doMock('electron', () => ({
    app: {
      isPackaged: true,
      getAppPath: () => '/tmp/deepseek-gui-updater-test-app',
      getPath: () => '/tmp/deepseek-gui-updater-test-user-data',
      getVersion: () => appVersion,
      getLocale: () => 'en-US'
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

describe('checkGuiUpdate feed URL', () => {
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
  it('waits for managed runtime cleanup before asking the updater to quit and install', async () => {
    const module = await import('./gui-updater')
    let finishCleanup = (): void => {
      throw new Error('cleanup resolver was not set')
    }
    const beforeInstall = vi.fn(() => new Promise<void>((resolve) => {
      finishCleanup = resolve
    }))

    module.initializeGuiUpdater(() => null, () => 'stable', beforeInstall)
    updater.emit('update-downloaded', { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' })

    const installing = module.installGuiUpdate()
    await Promise.resolve()

    expect(beforeInstall).toHaveBeenCalledTimes(1)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    finishCleanup()
    await expect(installing).resolves.toEqual({ ok: true })
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('reuses the same cleanup when the native updater emits before-quit-for-update', async () => {
    const module = await import('./gui-updater')
    let finishCleanup = (): void => {
      throw new Error('cleanup resolver was not set')
    }
    const beforeInstall = vi.fn(() => new Promise<void>((resolve) => {
      finishCleanup = resolve
    }))

    module.initializeGuiUpdater(() => null, () => 'stable', beforeInstall)
    updater.emit('update-downloaded', { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' })

    nativeUpdater.emit('before-quit-for-update')
    const installing = module.installGuiUpdate()
    await Promise.resolve()

    expect(beforeInstall).toHaveBeenCalledTimes(1)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    finishCleanup()
    await expect(installing).resolves.toEqual({ ok: true })
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })
})

describe('showPostUpdateReleaseNotes', () => {
  const versionStatePath = join(
    '/tmp/deepseek-gui-updater-test-user-data',
    'gui-version-state.json'
  )

  it('records the first launched version without showing a notice', async () => {
    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    await module.showPostUpdateReleaseNotes()

    expect(showMessageBox).not.toHaveBeenCalled()
    expect(JSON.parse(mockedFiles.get(versionStatePath) ?? '{}')).toEqual({
      lastSeenVersion: '0.1.0'
    })
  })

  it('shows downloaded release notes once after the version changes', async () => {
    appVersion = '0.2.0'
    mockedFiles.set(
      versionStatePath,
      JSON.stringify({
        lastSeenVersion: '0.1.0',
        pendingUpdate: {
          version: '0.2.0',
          releaseNotes: '修复更新流程并改进启动体验。'
        }
      })
    )
    showMessageBox.mockResolvedValue({ response: 0 })
    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable', undefined, () => 'zh')

    await module.showPostUpdateReleaseNotes()
    await module.showPostUpdateReleaseNotes()

    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Kun 已更新',
        message: '已更新到 Kun 0.2.0',
        detail: '修复更新流程并改进启动体验。',
        buttons: ['查看更新日志', '稍后']
      })
    )
    expect(openExternal).toHaveBeenCalledWith('https://deepseek-gui.com/changelog')
    expect(JSON.parse(mockedFiles.get(versionStatePath) ?? '{}')).toEqual({
      lastSeenVersion: '0.2.0'
    })
  })
})
