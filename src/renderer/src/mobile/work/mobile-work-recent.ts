import { normalizePath } from '../../write/write-workspace-store-helpers'

const STORAGE_KEY = 'kun.mobile.work.recent'
const MAX_RECENT = 20

export type MobileWorkRecent = { root: string; path: string; title: string }

function readAll(): MobileWorkRecent[] {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is MobileWorkRecent => Boolean(item) &&
      typeof item.root === 'string' && typeof item.path === 'string' && typeof item.title === 'string') : []
  } catch { return [] }
}

export function readMobileWorkRecent(root: string): MobileWorkRecent[] {
  const normalized = normalizePath(root)
  return readAll().filter((item) => normalizePath(item.root) === normalized).slice(0, MAX_RECENT)
}

export function rememberMobileWorkRecent(root: string, path: string, title: string): void {
  const normalizedRoot = normalizePath(root)
  const normalizedPath = normalizePath(path)
  if (!normalizedRoot || !normalizedPath || !title.trim()) return
  try {
    const all = readAll().filter((item) => item.root !== normalizedRoot || item.path !== normalizedPath)
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([
      { root: normalizedRoot, path: normalizedPath, title }, ...all
    ].slice(0, MAX_RECENT)))
  } catch { /* private mode */ }
}

export function forgetMobileWorkRecent(root: string, path: string): void {
  const normalizedRoot = normalizePath(root)
  const normalizedPath = normalizePath(path)
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(readAll().filter((item) =>
      item.root !== normalizedRoot || item.path !== normalizedPath)))
  } catch { /* private mode */ }
}
