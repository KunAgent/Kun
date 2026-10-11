import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { logWarn } from './logger'

type UserDataPathResolver = {
  getPath(name: 'userData'): string
}

export function resolveLogDirectory(app: UserDataPathResolver): string {
  return join(app.getPath('userData'), 'logs')
}

export type NamedPreloadName =
  | 'index'
  | 'extension-view'
  | 'extension-protected-surface'
  | 'storage-relocation-recovery'
  | 'runtime-data-recovery'
  | 'tray-quota'
  | 'protected-room-dialog'

export function resolvePreloadPath(
  appPath: string,
  fileExists: (path: string) => boolean = existsSync
): string {
  return resolveNamedPreloadPath(appPath, 'index', fileExists)
}

/**
 * Preload bundles always live in <appPath>/out/preload. Anchoring on
 * app.getAppPath() instead of the calling module's __dirname keeps the lookup
 * correct even when the caller is bundled into out/main/chunks, where a
 * '../preload' join would escape into out/main/preload and miss the bundle.
 */
export function resolveNamedPreloadPath(
  appPath: string,
  name: NamedPreloadName,
  fileExists: (path: string) => boolean = existsSync
): string {
  const cjsPath = join(appPath, 'out', 'preload', `${name}.cjs`)
  if (fileExists(cjsPath)) return cjsPath
  const mjsPath = join(appPath, 'out', 'preload', `${name}.mjs`)
  if (!fileExists(mjsPath)) {
    logWarn('main-paths', 'Preload bundle is missing; the window will fail to load its script.', {
      name,
      resolvedPath: mjsPath
    })
  }
  return mjsPath
}
