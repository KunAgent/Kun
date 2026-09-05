import { app } from 'electron'
import { posix, win32 } from 'node:path'

export function bundledSkillsDirectory(options?: {
  isPackaged?: boolean
  resourcesPath?: string
  appRoot?: string
}): string {
  const isPackaged = options?.isPackaged ?? app.isPackaged
  if (isPackaged) {
    const root = options?.resourcesPath ?? process.resourcesPath
    return pathApiFor(root).join(root, 'bundled-skills')
  }
  const root = options?.appRoot ?? app.getAppPath()
  return pathApiFor(root).resolve(root, 'resources', 'bundled-skills')
}

function pathApiFor(root: string): typeof posix | typeof win32 {
  return /^[A-Za-z]:[\\/]/u.test(root) || root.startsWith('\\\\') ? win32 : posix
}
