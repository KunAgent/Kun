import type { NormalizedThread } from '../agent/types'
import { browserStorage, type BrowserStorageLike } from '../lib/browser-storage'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'

/**
 * Thin design-thread registry — preserves each legacy 设计稿 (design document)
 * conversation and its original document binding in the unified Code task
 * list. Records are keyed by a composite (workspace + 设计稿) scope so that
 * switching 设计稿 switches the conversation. Legacy per-workspace records are
 * re-keyed onto the default 设计稿 by {@link migrateRegistryToDoc}.
 */

export const DESIGN_ASSISTANT_THREAD_TITLE = 'Design Assistant'
const MAX_DESIGN_THREAD_IDS_PER_WORKSPACE = 20
const MAX_DESIGN_REGISTRY_WORKSPACES = 80
export const DESIGN_THREAD_REGISTRY_KEY = 'kun.design.threadRegistry.v1'
export const LEGACY_DESIGN_ASSISTANT_THREAD_REGISTRY_KEY = 'kun.design-assistant.threadRegistry.v1'

export type DesignThreadWorkspaceRecord = {
  activeThreadId: string
  threadIds: string[]
}

export type DesignThreadRegistry = {
  version: 1
  workspaces: Record<string, DesignThreadWorkspaceRecord>
}

export type DesignDocThreadRef = {
  workspaceRoot: string
  docId: string
}

export function designWorkspaceKey(workspaceRoot: string | undefined | null): string {
  return normalizeWorkspaceRoot(workspaceRoot ?? '')
}

/**
 * Scope separator joining a workspace key and a 设计稿 id into one registry key.
 * A NUL byte can never appear in a filesystem path, so a composite scope key is
 * unambiguous to split and a plain workspace key (legacy, pre-migration) never
 * collides with a composite one.
 */
const DOC_SCOPE_SEP = String.fromCharCode(0)

/** Composite registry key: each 设计稿 has its own design-assistant thread. */
export function designDocKey(
  workspaceRoot: string | undefined | null,
  docId: string | undefined | null
): string {
  const ws = designWorkspaceKey(workspaceRoot)
  const doc = (docId ?? '').trim()
  return doc ? `${ws}${DOC_SCOPE_SEP}${doc}` : ws
}

export function splitDesignDocKey(scopeKey: string): DesignDocThreadRef | null {
  const key = normalizeScopeKey(scopeKey)
  const i = key.indexOf(DOC_SCOPE_SEP)
  if (i === -1) return null
  const workspaceRoot = key.slice(0, i)
  const docId = key.slice(i + DOC_SCOPE_SEP.length).trim()
  if (!workspaceRoot || !docId) return null
  return { workspaceRoot, docId }
}

/** Normalize a stored key, preserving the 设计稿 suffix of a composite scope key. */
function normalizeScopeKey(key: string): string {
  const i = key.indexOf(DOC_SCOPE_SEP)
  if (i === -1) return designWorkspaceKey(key)
  const ws = designWorkspaceKey(key.slice(0, i))
  if (!ws) return ''
  return `${ws}${DOC_SCOPE_SEP}${key.slice(i + DOC_SCOPE_SEP.length)}`
}

export function emptyDesignThreadRegistry(): DesignThreadRegistry {
  return { version: 1, workspaces: {} }
}

function normalizeThreadIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  const ordered = new Set<string>()
  for (const id of ids) {
    if (typeof id === 'string' && id.trim()) ordered.add(id.trim())
  }
  return [...ordered].slice(0, MAX_DESIGN_THREAD_IDS_PER_WORKSPACE)
}

export function normalizeDesignThreadRegistry(raw: unknown): DesignThreadRegistry {
  if (!raw || typeof raw !== 'object') return emptyDesignThreadRegistry()
  const source = raw as { workspaces?: unknown }
  if (!source.workspaces || typeof source.workspaces !== 'object') return emptyDesignThreadRegistry()

  const workspaces: DesignThreadRegistry['workspaces'] = {}
  for (const [scopeKey, value] of Object.entries(source.workspaces as Record<string, unknown>)) {
    const key = normalizeScopeKey(scopeKey)
    if (!key || !value || typeof value !== 'object') continue
    const record = value as { activeThreadId?: unknown; threadIds?: unknown }
    const threadIds = normalizeThreadIds(record.threadIds)
    if (threadIds.length === 0) continue
    const activeThreadId =
      typeof record.activeThreadId === 'string' && threadIds.includes(record.activeThreadId.trim())
        ? record.activeThreadId.trim()
        : threadIds[0]
    workspaces[key] = { activeThreadId, threadIds }
  }
  const unique = enforceUniqueThreadScopes(workspaces)
  const trimmed = Object.fromEntries(
    Object.entries(unique).slice(-MAX_DESIGN_REGISTRY_WORKSPACES)
  )
  return { version: 1, workspaces: trimmed }
}

function enforceUniqueThreadScopes(
  records: DesignThreadRegistry['workspaces']
): DesignThreadRegistry['workspaces'] {
  const seen = new Set<string>()
  const workspaces: DesignThreadRegistry['workspaces'] = {}
  for (const [scopeKey, record] of Object.entries(records)) {
    const threadIds = record.threadIds.filter((id) => {
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    if (threadIds.length === 0) continue
    workspaces[scopeKey] = {
      activeThreadId: threadIds.includes(record.activeThreadId) ? record.activeThreadId : threadIds[0],
      threadIds
    }
  }
  return workspaces
}

export function readDesignThreadRegistry(
  storage: BrowserStorageLike | null = browserStorage()
): DesignThreadRegistry {
  if (!storage) return emptyDesignThreadRegistry()
  let registry = emptyDesignThreadRegistry()
  try {
    const raw = storage.getItem(DESIGN_THREAD_REGISTRY_KEY)
    registry = normalizeDesignThreadRegistry(raw ? JSON.parse(raw) : null)
  } catch {
    // A corrupt current value must not hide a still-valid legacy binding.
    // Continue below so the legacy key can repair the registry in one pass.
  }
  const legacy = readLegacyDesignAssistantRegistry(storage)
  if (legacy === null) return registry
  const merged = mergeLegacyDesignAssistantThreads(registry, legacy)
  // The old key must be consumed, not merely merged on every read. Otherwise
  // clearing a migrated drawing can be undone by the next registry read.
  try {
    storage.setItem(DESIGN_THREAD_REGISTRY_KEY, JSON.stringify(merged))
    if (storage.removeItem) storage.removeItem(LEGACY_DESIGN_ASSISTANT_THREAD_REGISTRY_KEY)
    else storage.setItem(LEGACY_DESIGN_ASSISTANT_THREAD_REGISTRY_KEY, '{}')
  } catch {
    // Keep the successfully parsed in-memory view even when storage is full
    // or unavailable. A later read can retry the one-time migration.
  }
  return merged
}

export function saveDesignThreadRegistry(
  registry: DesignThreadRegistry,
  storage: BrowserStorageLike | null = browserStorage()
): void {
  if (!storage) return
  try {
    storage.setItem(DESIGN_THREAD_REGISTRY_KEY, JSON.stringify(normalizeDesignThreadRegistry(registry)))
  } catch {
    /* ignore storage failures */
  }
}

export function designThreadIds(
  registry: DesignThreadRegistry = readDesignThreadRegistry()
): Set<string> {
  const ids = new Set<string>()
  for (const record of Object.values(registry.workspaces)) {
    for (const id of record.threadIds) ids.add(id)
  }
  return ids
}

function mergeLegacyDesignAssistantThreads(
  registry: DesignThreadRegistry,
  raw: unknown
): DesignThreadRegistry {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return registry
  let next = registry
  for (const [workspaceRoot, value] of Object.entries(raw as Record<string, unknown>)) {
    const threadId = typeof value === 'string' ? value.trim() : ''
    if (!threadId) continue
    if (designThreadIds(next).has(threadId)) continue
    next = markDesignThread(workspaceRoot, '', threadId, next)
  }
  return next
}

function readLegacyDesignAssistantRegistry(storage: BrowserStorageLike): unknown {
  try {
    const raw = storage.getItem(LEGACY_DESIGN_ASSISTANT_THREAD_REGISTRY_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function isDesignThreadId(
  threadId: string | null | undefined,
  registry: DesignThreadRegistry = readDesignThreadRegistry()
): boolean {
  return Boolean(threadId && designThreadIds(registry).has(threadId))
}

export function markDesignThread(
  workspaceRoot: string,
  docId: string,
  threadId: string,
  registry: DesignThreadRegistry = readDesignThreadRegistry()
): DesignThreadRegistry {
  const key = designDocKey(workspaceRoot, docId)
  const id = threadId.trim()
  if (!key || !id) return registry
  const workspaces: DesignThreadRegistry['workspaces'] = {}
  for (const [scopeKey, existing] of Object.entries(registry.workspaces)) {
    const threadIds = existing.threadIds.filter((item) => item !== id)
    if (scopeKey !== key && threadIds.length === 0) continue
    workspaces[scopeKey] = {
      activeThreadId: existing.activeThreadId === id ? threadIds[0] ?? '' : existing.activeThreadId,
      threadIds
    }
  }
  const record = workspaces[key] ?? { activeThreadId: '', threadIds: [] }
  const threadIds = [id, ...record.threadIds.filter((item) => item !== id)]
  return normalizeDesignThreadRegistry({
    ...registry,
    workspaces: { ...workspaces, [key]: { activeThreadId: id, threadIds } }
  })
}

export function forgetDesignThread(
  threadId: string,
  registry: DesignThreadRegistry = readDesignThreadRegistry()
): DesignThreadRegistry {
  const id = threadId.trim()
  if (!id) return registry
  const workspaces: DesignThreadRegistry['workspaces'] = {}
  for (const [scopeKey, record] of Object.entries(registry.workspaces)) {
    const threadIds = record.threadIds.filter((item) => item !== id)
    if (threadIds.length === 0) continue
    workspaces[scopeKey] = {
      activeThreadId: record.activeThreadId === id ? threadIds[0] : record.activeThreadId,
      threadIds
    }
  }
  return normalizeDesignThreadRegistry({ version: 1, workspaces })
}

/**
 * Replace the complete remembered thread set for one design document without
 * disturbing other documents. Passing an empty list removes the document
 * scope, which is the durable "no current history" state used between a
 * successful clear and best-effort replacement-thread creation.
 */
export function replaceDesignThreadsForDocument(
  workspaceRoot: string,
  docId: string,
  threadIds: readonly string[],
  activeThreadId?: string | null,
  registry: DesignThreadRegistry = readDesignThreadRegistry()
): DesignThreadRegistry {
  const key = designDocKey(workspaceRoot, docId)
  if (!key) return registry
  const ids = normalizeThreadIds(threadIds)
  const workspaces = { ...registry.workspaces }
  if (ids.length === 0) {
    delete workspaces[key]
    return normalizeDesignThreadRegistry({ version: 1, workspaces })
  }
  const active = activeThreadId?.trim()
  workspaces[key] = {
    activeThreadId: active && ids.includes(active) ? active : ids[0],
    threadIds: ids
  }
  return normalizeDesignThreadRegistry({ version: 1, workspaces })
}

export function designDocRefForThreadId(
  threadId: string | null | undefined,
  registry: DesignThreadRegistry = readDesignThreadRegistry()
): DesignDocThreadRef | null {
  const id = threadId?.trim()
  if (!id) return null
  for (const [scopeKey, record] of Object.entries(registry.workspaces)) {
    if (!record.threadIds.includes(id)) continue
    const ref = splitDesignDocKey(scopeKey)
    if (ref) return ref
  }
  return null
}

export function activeDesignThreadForWorkspace(
  workspaceRoot: string,
  docId: string,
  threads: NormalizedThread[],
  registry: DesignThreadRegistry = readDesignThreadRegistry()
): NormalizedThread | null {
  const key = designDocKey(workspaceRoot, docId)
  if (!key) return null
  const record = registry.workspaces[key]
  if (!record) return null
  const candidates = record.threadIds
    .map((id) => threads.find((thread) => thread.id === id) ?? null)
    .filter((thread): thread is NormalizedThread => Boolean(thread))
    .filter((thread) => thread.archived !== true)
  return candidates.find((thread) => thread.id === record.activeThreadId) ?? candidates[0] ?? null
}

/**
 * One-time migration: re-key a workspace's legacy per-workspace record (written
 * before 设计稿 existed) onto the default 设计稿's composite scope key, so the
 * existing conversation stays attached after the hierarchy upgrade. Idempotent —
 * once the plain workspace key is gone, subsequent calls are no-ops.
 */
export function migrateRegistryToDoc(
  registry: DesignThreadRegistry,
  workspaceRoot: string,
  docId: string
): DesignThreadRegistry {
  const wsKey = designWorkspaceKey(workspaceRoot)
  if (!wsKey) return registry
  const legacy = registry.workspaces[wsKey]
  if (!legacy) return registry
  const docKey = designDocKey(workspaceRoot, docId)
  const workspaces = { ...registry.workspaces }
  delete workspaces[wsKey]
  const existing = workspaces[docKey]
  const threadIds = existing ? [...existing.threadIds, ...legacy.threadIds] : [...legacy.threadIds]
  workspaces[docKey] = {
    activeThreadId: legacy.activeThreadId || existing?.activeThreadId || threadIds[0] || '',
    threadIds
  }
  return normalizeDesignThreadRegistry({ version: 1, workspaces })
}
