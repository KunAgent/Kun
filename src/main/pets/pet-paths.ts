import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'

export function isUnsafePetRelativePath(value: string): boolean {
  if (!value || value.includes('\0')) return true
  const trimmed = value.trim()
  if (!trimmed || trimmed !== value) return true
  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return true
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || /^[a-zA-Z]:$/.test(trimmed)) return true
  if (trimmed.startsWith('//') || trimmed.startsWith('\\\\')) return true
  if (path.win32.isAbsolute(trimmed) || path.posix.isAbsolute(trimmed)) return true
  const segments = trimmed.replace(/\\/g, '/').split('/')
  return segments.some((segment) => segment === '..' || segment === '')
}

export async function resolveContainedFile(rootDir: string, relativePath: string): Promise<string> {
  if (isUnsafePetRelativePath(relativePath)) throw new Error('spritesheet path escapes the pet directory')
  const root = await realpath(rootDir)
  const candidate = path.resolve(root, relativePath)
  let realFile: string
  try {
    realFile = await realpath(candidate)
  } catch {
    throw new Error('spritesheet is missing or not readable')
  }
  const relative = path.relative(root, realFile)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('spritesheet resolves outside the pet directory')
  }
  const info = await stat(realFile)
  if (!info.isFile()) throw new Error('spritesheet is not a file')
  return realFile
}

export function directoryStateFromError(error: unknown): 'missing' | 'unreadable' {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing'
  return 'unreadable'
}
