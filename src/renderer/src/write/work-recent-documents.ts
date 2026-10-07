import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'
import { normalizePath } from './write-workspace-store-helpers'

/** Recently opened documents per space, newest first, for the home cards. */
export const WORK_RECENT_DOCUMENTS_KEY = 'kun.work.recentDocuments.v1'
const MAX_PER_SPACE = 8
const MAX_SPACES = 40

export type WorkRecentDocument = { path: string; at: number }
type Stored = Record<string, WorkRecentDocument[]>

function readAll(): Stored {
  try {
    const parsed = JSON.parse(readBrowserStorageItem(WORK_RECENT_DOCUMENTS_KEY) ?? '{}') as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Stored : {}
  } catch {
    return {}
  }
}

export function recordWorkRecentDocument(workspaceRoot: string, path: string, at = Date.now()): void {
  const root = normalizePath(workspaceRoot)
  const file = normalizePath(path)
  if (!root || !file) return
  const stored = readAll()
  const list = (stored[root] ?? []).filter((entry) => entry.path !== file)
  stored[root] = [{ path: file, at }, ...list].slice(0, MAX_PER_SPACE)
  const spaces = Object.entries(stored)
    .sort(([, a], [, b]) => (b[0]?.at ?? 0) - (a[0]?.at ?? 0))
    .slice(0, MAX_SPACES)
  writeBrowserStorageItem(WORK_RECENT_DOCUMENTS_KEY, JSON.stringify(Object.fromEntries(spaces)))
}

export function readWorkRecentDocuments(workspaceRoot: string): WorkRecentDocument[] {
  const list = readAll()[normalizePath(workspaceRoot)]
  return Array.isArray(list) ? list.filter((entry) => typeof entry?.path === 'string') : []
}
