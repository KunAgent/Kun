import { browserStorage, type BrowserStorageLike } from './browser-storage'

/**
 * Renderer-side registry that maps a thread id to the worktree pool slot it
 * was assigned to. The worktree-service owns the physical worktrees; this
 * registry is the durable ownership record so that releasing a thread can
 * release the correct pool slot (and survive an app restart, since the
 * worktree-service taskMap is in-memory only).
 *
 * Modeled after thread-fork-registry.ts.
 */

export type ThreadWorktreeRecord = {
  projectPath: string
  poolIndex?: number
  worktreePath: string
  branch: string
  createdAt?: string
}

export type ThreadWorktreeRegistry = {
  version: 1
  worktrees: Record<string, ThreadWorktreeRecord>
}

export const MAX_THREAD_WORKTREE_REGISTRY_ENTRIES = 500

export const THREAD_WORKTREE_REGISTRY_KEY = 'kun.threadWorktrees.v1'

export function emptyThreadWorktreeRegistry(): ThreadWorktreeRegistry {
  return { version: 1, worktrees: {} }
}

function normalizeThreadId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeOptionalString(value: unknown): string | undefined {
  const text = normalizeThreadId(value)
  return text || undefined
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined
}

function trimWorktreeRegistryEntries(
  worktrees: ThreadWorktreeRegistry['worktrees']
): ThreadWorktreeRegistry['worktrees'] {
  return Object.fromEntries(Object.entries(worktrees).slice(-MAX_THREAD_WORKTREE_REGISTRY_ENTRIES))
}

export function normalizeThreadWorktreeRegistry(raw: unknown): ThreadWorktreeRegistry {
  if (!raw || typeof raw !== 'object') return emptyThreadWorktreeRegistry()
  const source = raw as { worktrees?: unknown }
  if (!source.worktrees || typeof source.worktrees !== 'object') return emptyThreadWorktreeRegistry()

  const worktrees: ThreadWorktreeRegistry['worktrees'] = {}
  for (const [threadIdKey, value] of Object.entries(source.worktrees as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const threadId = normalizeThreadId(threadIdKey)
    const record = value as Record<string, unknown>
    const projectPath = normalizeThreadId(record.projectPath)
    const poolIndex = normalizeOptionalNumber(record.poolIndex)
    const worktreePath = normalizeThreadId(record.worktreePath)
    if (!threadId || !projectPath || !worktreePath) continue
    const branch = normalizeThreadId(record.branch) || (poolIndex === undefined ? 'worktree' : `kun-pool-${poolIndex}`)
    const createdAt = normalizeOptionalString(record.createdAt)
    delete worktrees[threadId]
    worktrees[threadId] = {
      projectPath,
      worktreePath,
      branch,
      ...(poolIndex === undefined ? {} : { poolIndex }),
      ...(createdAt ? { createdAt } : {})
    }
  }

  return { version: 1, worktrees: trimWorktreeRegistryEntries(worktrees) }
}

export function readThreadWorktreeRegistry(
  storage: BrowserStorageLike | null = browserStorage()
): ThreadWorktreeRegistry {
  if (!storage) return emptyThreadWorktreeRegistry()
  try {
    const raw = storage.getItem(THREAD_WORKTREE_REGISTRY_KEY)
    return normalizeThreadWorktreeRegistry(raw ? JSON.parse(raw) : null)
  } catch {
    return emptyThreadWorktreeRegistry()
  }
}

export function saveThreadWorktreeRegistry(
  registry: ThreadWorktreeRegistry,
  storage: BrowserStorageLike | null = browserStorage()
): void {
  if (!storage) return
  try {
    storage.setItem(THREAD_WORKTREE_REGISTRY_KEY, JSON.stringify(normalizeThreadWorktreeRegistry(registry)))
  } catch {
    /* ignore storage failures */
  }
}

export function markThreadWorktree(
  threadId: string,
  record: ThreadWorktreeRecord,
  registry: ThreadWorktreeRegistry = readThreadWorktreeRegistry()
): ThreadWorktreeRegistry {
  const id = normalizeThreadId(threadId)
  if (!id) return registry
  const worktrees = { ...registry.worktrees }
  delete worktrees[id]
  return normalizeThreadWorktreeRegistry({
    ...registry,
    worktrees: {
      ...worktrees,
      [id]: record
    }
  })
}

export function forgetThreadWorktree(
  threadId: string,
  registry: ThreadWorktreeRegistry = readThreadWorktreeRegistry()
): ThreadWorktreeRegistry {
  const id = normalizeThreadId(threadId)
  if (!id || !registry.worktrees[id]) return registry
  const worktrees = { ...registry.worktrees }
  delete worktrees[id]
  return normalizeThreadWorktreeRegistry({ version: 1, worktrees })
}

/**
 * Prune registry entries whose thread id no longer appears in `threads`.
 * Call after refreshing the thread list to drop stale mappings.
 */
export function hydrateThreadWorktreeRegistry(
  threadIds: string[],
  registry: ThreadWorktreeRegistry = readThreadWorktreeRegistry()
): ThreadWorktreeRegistry {
  const normalized = normalizeThreadWorktreeRegistry(registry)
  const ids = new Set(threadIds.filter(Boolean))
  const worktrees: ThreadWorktreeRegistry['worktrees'] = {}
  for (const id of ids) {
    const record = normalized.worktrees[id]
    if (record) worktrees[id] = record
  }
  return normalizeThreadWorktreeRegistry({ version: 1, worktrees })
}
