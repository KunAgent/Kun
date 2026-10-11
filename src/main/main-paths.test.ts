import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveLogDirectory, resolveNamedPreloadPath, resolvePreloadPath } from './main-paths'

describe('main paths', () => {
  it('resolves the log directory under Electron userData', () => {
    expect(resolveLogDirectory({ getPath: () => 'C:\\Users\\test\\AppData\\Kun' })).toBe(
      join('C:\\Users\\test\\AppData\\Kun', 'logs')
    )
  })

  it('prefers the CommonJS preload build when present', () => {
    const appPath = 'C:\\app'

    expect(resolvePreloadPath(appPath, (path) => path.endsWith('index.cjs'))).toBe(
      join(appPath, 'out', 'preload', 'index.cjs')
    )
  })

  it('falls back to the ESM preload build', () => {
    const appPath = 'C:\\app'

    expect(resolvePreloadPath(appPath, () => false)).toBe(
      join(appPath, 'out', 'preload', 'index.mjs')
    )
  })

  it('resolves preloads under a packaged app.asar application root', () => {
    // Regression for the chunk-layout bug: callers bundled into
    // out/main/chunks produced <app>/out/main/preload/<name> paths. Anchoring
    // on app.getAppPath() keeps the target under <app>/out/preload regardless
    // of where the calling bundle lives.
    const appPath = '/Applications/Kun.app/Contents/Resources/app.asar'
    expect(resolveNamedPreloadPath(appPath, 'index', (path) => path.endsWith('index.cjs'))).toBe(
      join(appPath, 'out', 'preload', 'index.cjs')
    )
    expect(resolveNamedPreloadPath(appPath, 'index', () => false)).toBe(
      join(appPath, 'out', 'preload', 'index.mjs')
    )
  })

  it('resolves packaged extension preloads independently from the workbench preload', () => {
    const appPath = 'C:\\app'
    expect(resolveNamedPreloadPath(appPath, 'extension-view', () => true)).toBe(
      join(appPath, 'out', 'preload', 'extension-view.cjs')
    )
    expect(resolveNamedPreloadPath(appPath, 'extension-protected-surface', () => false)).toBe(
      join(appPath, 'out', 'preload', 'extension-protected-surface.mjs')
    )
  })

  it('resolves the isolated tray quota preload', () => {
    const appPath = 'C:\\app'
    expect(resolveNamedPreloadPath(appPath, 'tray-quota', () => true)).toBe(
      join(appPath, 'out', 'preload', 'tray-quota.cjs')
    )
  })

  it('resolves dedicated recovery preloads', () => {
    const appPath = 'C:\\app'
    expect(resolveNamedPreloadPath(appPath, 'storage-relocation-recovery', () => true)).toBe(
      join(appPath, 'out', 'preload', 'storage-relocation-recovery.cjs')
    )
    expect(resolveNamedPreloadPath(appPath, 'runtime-data-recovery', () => false)).toBe(
      join(appPath, 'out', 'preload', 'runtime-data-recovery.mjs')
    )
  })
})
