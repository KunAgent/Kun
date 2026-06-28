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
  const cjsPath = join(distDir, '../preload/index.cjs')
  if (fileExists(cjsPath)) return cjsPath
  return join(distDir, '../preload/index.mjs')
}
