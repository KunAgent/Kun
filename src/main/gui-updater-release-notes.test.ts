import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let appVersion: string
let appIsPackaged: boolean
let mockedFiles: Map<string, string>
let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  vi.resetModules()
  appVersion = '0.1.0'
  appIsPackaged = true
  mockedFiles = new Map()
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
    BrowserWindow: class {}
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

async function releaseNotes() {
  return import('./gui-updater-release-notes')
}

function versionState(): unknown {
  return JSON.parse(mockedFiles.get(versionStatePath) ?? '{}')
}

describe('post-update release notice', () => {
  it('records the first launched version without a notice', async () => {
    const { readReleaseNotice, recordFirstLaunchVersion } = await releaseNotes()
    await recordFirstLaunchVersion()

    expect(await readReleaseNotice()).toBeNull()
    expect(versionState()).toEqual({ lastSeenVersion: '0.1.0' })
  })

  it('does not track versions in development unless a notice is faked', async () => {
    appIsPackaged = false
    mockedFiles.set(versionStatePath, JSON.stringify({ lastSeenVersion: '0.0.1' }))
    const { readReleaseNotice, acknowledgeReleaseNotice, recordFirstLaunchVersion } = await releaseNotes()

    await recordFirstLaunchVersion()
    expect(await readReleaseNotice()).toBeNull()
    process.env.KUN_RELEASE_NOTICE_FROM = '0.0.9'
    expect(await readReleaseNotice()).toEqual({
      version: '0.1.0',
      previousVersion: '0.0.9',
      changelogUrl: 'https://github.com/KunAgent/Kun/blob/master/release/release-v0.1.0.md'
    })
    await acknowledgeReleaseNotice('0.1.0')
    expect(versionState()).toEqual({ lastSeenVersion: '0.0.1' })
  })

  it('stays quiet when launching an older version', async () => {
    mockedFiles.set(versionStatePath, JSON.stringify({ lastSeenVersion: '0.2.0' }))
    const { readReleaseNotice } = await releaseNotes()

    expect(await readReleaseNotice()).toBeNull()
    expect(versionState()).toEqual({ lastSeenVersion: '0.2.0' })
  })

  it('keeps the notice due until it is acknowledged, then never again', async () => {
    appVersion = '0.2.0'
    mockedFiles.set(versionStatePath, JSON.stringify({
      lastSeenVersion: '0.1.0',
      pendingUpdate: { version: '0.2.0', releaseNotes: '修复更新流程并改进启动体验。' }
    }))
    const { readReleaseNotice, acknowledgeReleaseNotice } = await releaseNotes()
    const expected = {
      version: '0.2.0',
      previousVersion: '0.1.0',
      releaseNotes: '修复更新流程并改进启动体验。',
      changelogUrl: 'https://github.com/KunAgent/Kun/blob/master/release/release-v0.2.0.md'
    }

    expect(await readReleaseNotice()).toEqual(expected)
    expect(await readReleaseNotice()).toEqual(expected)
    await acknowledgeReleaseNotice('0.1.9')
    expect(await readReleaseNotice()).toEqual(expected)

    await acknowledgeReleaseNotice('0.2.0')
    expect(await readReleaseNotice()).toBeNull()
    expect(versionState()).toEqual({ lastSeenVersion: '0.2.0' })
  })

  it('keeps a newer downloaded update when acknowledging', async () => {
    appVersion = '0.2.0'
    mockedFiles.set(versionStatePath, JSON.stringify({
      lastSeenVersion: '0.1.0',
      pendingUpdate: { version: '0.3.0' }
    }))
    const { readReleaseNotice, acknowledgeReleaseNotice } = await releaseNotes()

    expect((await readReleaseNotice())?.releaseNotes).toBeUndefined()
    await acknowledgeReleaseNotice('0.2.0')
    expect(versionState()).toEqual({ lastSeenVersion: '0.2.0', pendingUpdate: { version: '0.3.0' } })
  })

  it('returns the running version on request and substitutes a configured changelog URL', async () => {
    process.env.KUN_CHANGELOG_URL = 'https://example.com/release/release-{version}.md'
    appVersion = '0.2.1'
    mockedFiles.set(versionStatePath, JSON.stringify({ lastSeenVersion: '0.2.1' }))
    const { readReleaseNotice } = await releaseNotes()

    expect(await readReleaseNotice()).toBeNull()
    expect(await readReleaseNotice({ current: true })).toEqual({
      version: '0.2.1',
      changelogUrl: 'https://example.com/release/release-v0.2.1.md'
    })
  })
})
