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
    const distDir = 'C:\\app\\out\\main'

    expect(resolvePreloadPath(distDir, (path) => path.endsWith('index.cjs'))).toBe(
      join(distDir, '../preload/index.cjs')
    )
  })

  it('falls back to the ESM preload build', () => {
    const distDir = 'C:\\app\\out\\main'

    expect(resolvePreloadPath(distDir, () => false)).toBe(
      join(distDir, '../preload/index.mjs')
    )
  })

  it('resolves packaged extension preloads independently from the workbench preload', () => {
    const distDir = 'C:\\app\\out\\main'
    expect(resolveNamedPreloadPath(distDir, 'extension-view', () => true)).toBe(
      join(distDir, '../preload/extension-view.cjs')
    )
    expect(resolveNamedPreloadPath(distDir, 'extension-protected-surface', () => false)).toBe(
      join(distDir, '../preload/extension-protected-surface.mjs')
    )
  })

  it('resolves the isolated tray quota preload', () => {
    const distDir = 'C:\\app\\out\\main'
    expect(resolveNamedPreloadPath(distDir, 'tray-quota', () => true)).toBe(
      join(distDir, '../preload/tray-quota.cjs')
    )
  })

  it('resolves dedicated recovery preloads', () => {
    const distDir = 'C:\\app\\out\\main'
    expect(resolveNamedPreloadPath(distDir, 'storage-relocation-recovery', () => true)).toBe(
      join(distDir, '../preload/storage-relocation-recovery.cjs')
    )
    expect(resolveNamedPreloadPath(distDir, 'runtime-data-recovery', () => false)).toBe(
      join(distDir, '../preload/runtime-data-recovery.mjs')
    )
  })
})
