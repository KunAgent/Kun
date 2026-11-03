import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'
import type { NormalizedThread } from '../agent/types'

/**
 * Lightweight sidebar thread inventory cache used only as a first-paint
 * placeholder. The authoritative list always comes from the runtime refresh;
 * this cache exists so the sidebar can render instantly on startup and then
 * reconcile in the background (marked `refreshing`, never `ready`).
 */

const THREAD_LIST_CACHE_KEY = 'kun.sidebar.threadCache.v1'
const THREAD_LIST_CACHE_VERSION = 1

export type CacheThreadEntry = {
  id: string
  title: string
  workspace?: string
  pinned?: boolean
  status?: string
  relation?: 'primary' | 'fork' | 'side' | 'task'
  parentThreadId?: string
  taskOrigin?: NormalizedThread['taskOrigin']
  planBuildRunId?: string
  model: string
  mode: string
  updatedAt: string
  archived?: boolean
}

type ThreadListCachePayload = {
  version: number
  savedAt: string
  threads: CacheThreadEntry[]
}

export function loadThreadListCache(): CacheThreadEntry[] {
  try {
    const raw = readBrowserStorageItem(THREAD_LIST_CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ThreadListCachePayload
    if (parsed.version !== THREAD_LIST_CACHE_VERSION || !Array.isArray(parsed.threads)) return []
    return parsed.threads.filter(isCacheThreadEntry)
  } catch {
    return []
  }
}

function isCacheThreadEntry(value: unknown): value is CacheThreadEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.id === 'string' &&
    entry.id.trim().length > 0 &&
    typeof entry.title === 'string' &&
    typeof entry.updatedAt === 'string' &&
    typeof entry.model === 'string'
  )
}

export function saveThreadListCache(threads: NormalizedThread[]): void {
  try {
    const entries: CacheThreadEntry[] = threads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      workspace: thread.workspace,
      pinned: thread.pinned,
      status: thread.status,
      relation: thread.relation,
      ...(thread.parentThreadId ? { parentThreadId: thread.parentThreadId } : {}),
      ...(thread.taskOrigin ? { taskOrigin: thread.taskOrigin } : {}),
      planBuildRunId: thread.planBuildRunId,
      model: thread.model,
      mode: thread.mode,
      updatedAt: thread.updatedAt,
      archived: thread.archived
    }))
    const payload: ThreadListCachePayload = {
      version: THREAD_LIST_CACHE_VERSION,
      savedAt: new Date().toISOString(),
      threads: entries
    }
    writeBrowserStorageItem(THREAD_LIST_CACHE_KEY, JSON.stringify(payload))
  } catch {
    /* ignore cache write failures */
  }
}

/**
 * Convert cached summary entries back into sidebar-compatible threads. Fields
 * that the sidebar does not need stay absent so the placeholder cannot pretend
 * to be a full projection (e.g. no goal/todos/systemPrompt).
 */
export function cacheEntriesToThreads(entries: CacheThreadEntry[]): NormalizedThread[] {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    workspace: entry.workspace,
    pinned: entry.pinned,
    status: entry.status,
    relation: entry.relation,
    ...(entry.parentThreadId ? { parentThreadId: entry.parentThreadId } : {}),
    ...(entry.taskOrigin ? { taskOrigin: entry.taskOrigin } : {}),
    planBuildRunId: entry.planBuildRunId,
    model: entry.model,
    mode: entry.mode ?? '',
    updatedAt: entry.updatedAt,
    archived: entry.archived
  }))
}
