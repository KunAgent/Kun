import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let appVersion: string
let appIsPackaged: boolean
let mockedFiles: Map<string, string>
let showMessageBox: ReturnType<typeof vi.fn>
let openExternal: ReturnType<typeof vi.fn>
let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  vi.resetModules()
  appVersion = '0.1.0'
  appIsPackaged = true
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
      get isPackaged() {
        return appIsPackaged
      },
      getPath: () => '/tmp/deepseek-gui-updater-test-user-data',
      getVersion: () => appVersion,
      getLocale: () => 'en-US'
    },
    BrowserWindow: class {},
    dialog: { showMessageBox },
    shell: { openExternal }
  }))
  vi.doMock('electron-updater', () => ({ default: { autoUpdater: {} }, autoUpdater: {} }))
})

afterEach(() => {
  process.env = originalEnv
  vi.doUnmock('electron')
  vi.doUnmock('electron-updater')
  vi.doUnmock('node:fs/promises')
  vi.resetModules()
})

const versionStatePath = join('/tmp/deepseek-gui-updater-test-user-data', 'gui-version-state.json')

async function showReleaseNotes(locale?: 'en' | 'zh'): Promise<void> {
  const { showGuiUpdateReleaseNotes } = await import('./gui-updater-release-notes')
  await showGuiUpdateReleaseNotes(() => null, locale ? () => locale : null)
}

describe('showGuiUpdateReleaseNotes', () => {
  it('records the first launched version without showing a notice', async () => {
    await showReleaseNotes()

    expect(showMessageBox).not.toHaveBeenCalled()
    expect(JSON.parse(mockedFiles.get(versionStatePath) ?? '{}')).toEqual({ lastSeenVersion: '0.1.0' })
  })

  it('does not show or overwrite release-note state in development', async () => {
    appIsPackaged = false
    mockedFiles.set(versionStatePath, JSON.stringify({ lastSeenVersion: '0.2.0' }))

    await showReleaseNotes()

    expect(showMessageBox).not.toHaveBeenCalled()
    expect(JSON.parse(mockedFiles.get(versionStatePath) ?? '{}')).toEqual({ lastSeenVersion: '0.2.0' })
  })

  it('does not show release notes when launching an older version', async () => {
    mockedFiles.set(versionStatePath, JSON.stringify({ lastSeenVersion: '0.2.0' }))

    await showReleaseNotes()

    expect(showMessageBox).not.toHaveBeenCalled()
    expect(JSON.parse(mockedFiles.get(versionStatePath) ?? '{}')).toEqual({ lastSeenVersion: '0.2.0' })
  })

  it('shows downloaded release notes once after the version changes', async () => {
    appVersion = '0.2.0'
    mockedFiles.set(versionStatePath, JSON.stringify({
      lastSeenVersion: '0.1.0',
      pendingUpdate: { version: '0.2.0', releaseNotes: '修复更新流程并改进启动体验。' }
    }))
    showMessageBox.mockResolvedValue({ response: 0 })

    await showReleaseNotes('zh')
    await showReleaseNotes('zh')

    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Kun 已更新',
      message: '已更新到 Kun 0.2.0',
      detail: '修复更新流程并改进启动体验。',
      buttons: ['查看更新日志', '稍后']
    }))
    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/KunAgent/Kun/blob/master/release/release-v0.2.0.md'
    )
    expect(JSON.parse(mockedFiles.get(versionStatePath) ?? '{}')).toEqual({ lastSeenVersion: '0.2.0' })
  })

  it('substitutes a configured changelog URL', async () => {
    process.env.KUN_CHANGELOG_URL = 'https://example.com/release/release-{version}.md'
    appVersion = '0.2.1'
    mockedFiles.set(versionStatePath, JSON.stringify({
      lastSeenVersion: '0.2.0',
      pendingUpdate: { version: '0.2.1' }
    }))
    showMessageBox.mockResolvedValue({ response: 0 })

    await showReleaseNotes()

    expect(openExternal).toHaveBeenCalledWith('https://example.com/release/release-v0.2.1.md')
  })
})
