import { existsSync } from 'node:fs'
import { join } from 'node:path'

type UserDataPathResolver = {
  getPath(name: 'userData'): string
}

export function resolveLogDirectory(app: UserDataPathResolver): string {
  return join(app.getPath('userData'), 'logs')
}

export function resolvePreloadPath(
  distDir: string,
  fileExists: (path: string) => boolean = existsSync
): string {
  return resolveNamedPreloadPath(distDir, 'index', fileExists)
}

export function resolveNamedPreloadPath(
  distDir: string,
  name: 'index' |
    'extension-view' |
    'extension-protected-surface' |
    'storage-relocation-recovery' |
    'runtime-data-recovery' |
    'tray-quota',
  fileExists: (path: string) => boolean = existsSync
): string {
  const cjsPath = join(distDir, `../preload/${name}.cjs`)
  if (fileExists(cjsPath)) return cjsPath
  return join(distDir, `../preload/${name}.mjs`)
}
