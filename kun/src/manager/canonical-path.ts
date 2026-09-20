import { posix, win32 } from 'node:path'
import { realpathSync } from 'node:fs'

export function sameCanonicalPath(
  left: string,
  right: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (platform === process.platform) {
    left = resolveExistingAliases(left, platform)
    right = resolveExistingAliases(right, platform)
  }
  if (platform === 'win32') {
    return normalizeWindowsPath(left) === normalizeWindowsPath(right)
  }
  return posix.resolve(left) === posix.resolve(right)
}

function resolveExistingAliases(value: string, platform: NodeJS.Platform): string {
  const paths = platform === 'win32' ? win32 : posix
  const absolute = paths.resolve(value)
  try { return realpathSync.native(absolute) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return absolute
    const parent = paths.dirname(absolute)
    return parent === absolute ? absolute : paths.join(resolveExistingAliases(parent, platform), paths.basename(absolute))
  }
}

function normalizeWindowsPath(value: string): string {
  const resolved = win32.resolve(value)
  const withoutExtendedPrefix = resolved.startsWith('\\\\?\\UNC\\')
    ? `\\\\${resolved.slice(8)}`
    : resolved.startsWith('\\\\?\\')
      ? resolved.slice(4)
      : resolved
  return withoutExtendedPrefix.toLowerCase()
}
