import type { BrowserStorageLike } from './browser-storage'
import { normalizeWorkspaceRoot, workspaceRootIdentityKey } from './workspace-path'

/**
 * Durable "removed from the Code project list" markers for workspace roots.
 * Removing a sidebar project only hides it from the picker/sidebar; threads,
 * snapshots and files on disk stay untouched. Without this registry every
 * refresh/boot would resurrect the project from the surviving thread history.
 */
export type RemovedCodeWorkspaceRecord = {
  /** Primary project path the user removed from the sidebar. */
  projectPath: string
  /** Other known roots that display as the same project (main dir, worktrees). */
  aliases: string[]
  removedAt: string
}

export type RemovedCodeWorkspacesRegistry = {
  version: 1
  removed: RemovedCodeWorkspaceRecord[]
}

export const MAX_REMOVED_CODE_WORKSPACES = 100

export const REMOVED_CODE_WORKSPACES_STORAGE_KEY = 'kun.removedCodeWorkspaces.v1'

export function emptyRemovedCodeWorkspacesRegistry(): RemovedCodeWorkspacesRegistry {
  return { version: 1, removed: [] }
}

function normalizeAlias(value: unknown): string {
  return normalizeWorkspaceRoot(typeof value === 'string' ? value : '')
}

/** Trailing-separator/case-insensitive canonical form for durable display paths. */
function trimStoredWorkspacePath(path: string): string {
  return normalizeWorkspaceRoot(path).replace(/[\\/]+$/, '')
}

function trimRegistry(
  removed: RemovedCodeWorkspaceRecord[]
): RemovedCodeWorkspaceRecord[] {
  return removed.slice(-MAX_REMOVED_CODE_WORKSPACES)
}

export function normalizeRemovedCodeWorkspacesRegistry(
  raw: unknown
): RemovedCodeWorkspacesRegistry {
  if (!raw || typeof raw !== 'object') return emptyRemovedCodeWorkspacesRegistry()
  const source = raw as { removed?: unknown }
  if (!Array.isArray(source.removed)) return emptyRemovedCodeWorkspacesRegistry()

  const seenKeys = new Set<string>()
  const removed: RemovedCodeWorkspaceRecord[] = []
  for (const entry of source.removed) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as { projectPath?: unknown; aliases?: unknown; removedAt?: unknown }
    const projectPath = trimStoredWorkspacePath(
      typeof record.projectPath === 'string' ? record.projectPath : ''
    )
    const projectKey = workspaceRootIdentityKey(projectPath)
    if (!projectPath || !projectKey || seenKeys.has(projectKey)) continue
    seenKeys.add(projectKey)
    const aliases: string[] = []
    const aliasKeys = new Set<string>([projectKey])
    if (Array.isArray(record.aliases)) {
      for (const alias of record.aliases) {
        const normalized = trimStoredWorkspacePath(normalizeAlias(alias))
        const aliasKey = workspaceRootIdentityKey(normalized)
        if (!normalized || !aliasKey || aliasKeys.has(aliasKey)) continue
        aliasKeys.add(aliasKey)
        aliases.push(normalized)
      }
    }
    removed.push({
      projectPath,
      aliases,
      removedAt:
        typeof record.removedAt === 'string' && record.removedAt.trim()
          ? record.removedAt
          : new Date(0).toISOString()
    })
  }

  return { version: 1, removed: trimRegistry(removed) }
}

export function readRemovedCodeWorkspaces(
  storage: BrowserStorageLike | null = readStorage()
): RemovedCodeWorkspacesRegistry {
  const raw = storage ? readStoredItem(storage) : null
  if (!raw) return emptyRemovedCodeWorkspacesRegistry()
  try {
    return normalizeRemovedCodeWorkspacesRegistry(JSON.parse(raw))
  } catch {
    return emptyRemovedCodeWorkspacesRegistry()
  }
}

export function saveRemovedCodeWorkspaces(
  registry: RemovedCodeWorkspacesRegistry,
  storage: BrowserStorageLike | null = readStorage()
): RemovedCodeWorkspacesRegistry {
  const normalized = normalizeRemovedCodeWorkspacesRegistry(registry)
  if (storage) {
    writeStoredItem(storage, JSON.stringify(normalized))
  }
  return normalized
}

/**
 * Record a project (and every path that resolves to it) as removed from the
 * Code project list. Removing an already-removed project merges aliases.
 */
export function rememberRemovedCodeWorkspace(
  options: { projectPath: string; aliases?: readonly (string | undefined | null)[] },
  registry: RemovedCodeWorkspacesRegistry = readRemovedCodeWorkspaces()
): RemovedCodeWorkspacesRegistry {
  const projectPath = normalizeWorkspaceRoot(options.projectPath)
  const projectKey = workspaceRootIdentityKey(projectPath)
  if (!projectPath || !projectKey) return registry

  const aliasKeys = new Set<string>([projectKey])
  const aliases: string[] = []
  for (const alias of options.aliases ?? []) {
    const normalized = normalizeWorkspaceRoot(alias ?? '')
    const aliasKey = workspaceRootIdentityKey(normalized)
    if (!normalized || !aliasKey || aliasKeys.has(aliasKey)) continue
    aliasKeys.add(aliasKey)
    aliases.push(normalized)
  }

  const removed = registry.removed.filter((record) => {
    const recordKey = workspaceRootIdentityKey(record.projectPath)
    if (recordKey !== projectKey) return true
    // Merge previous aliases so a repeated removal keeps full coverage.
    for (const alias of record.aliases) {
      const aliasKey = workspaceRootIdentityKey(alias)
      if (!aliasKey || aliasKeys.has(aliasKey)) continue
      aliasKeys.add(aliasKey)
      aliases.push(alias)
    }
    return false
  })

  return saveRemovedCodeWorkspaces({
    version: 1,
    removed: trimRegistry([
      ...removed,
      { projectPath, aliases, removedAt: new Date().toISOString() }
    ])
  })
}

/**
 * Clear the removal marker for a project identity (primary path or any alias).
 * Returns the stored registry untouched when nothing matches.
 */
export function restoreRemovedCodeWorkspace(
  projectPath: string,
  registry: RemovedCodeWorkspacesRegistry = readRemovedCodeWorkspaces()
): RemovedCodeWorkspacesRegistry {
  const keys = new Set<string>()
  const directKey = workspaceRootIdentityKey(normalizeWorkspaceRoot(projectPath))
  if (directKey) keys.add(directKey)
  if (keys.size === 0) return registry

  const removed = registry.removed.filter((record) => {
    const recordKeys = removedRecordIdentityKeys(record)
    for (const key of recordKeys) {
      if (keys.has(key)) return false
    }
    return true
  })
  if (removed.length === registry.removed.length) return registry
  return saveRemovedCodeWorkspaces({ version: 1, removed })
}

function removedRecordIdentityKeys(record: RemovedCodeWorkspaceRecord): Set<string> {
  const keys = new Set<string>()
  const projectKey = workspaceRootIdentityKey(record.projectPath)
  if (projectKey) keys.add(projectKey)
  for (const alias of record.aliases) {
    const aliasKey = workspaceRootIdentityKey(alias)
    if (aliasKey) keys.add(aliasKey)
  }
  return keys
}

/** Identity key of the removed project this path belongs to ('' when none). */
export function removedProjectKeyForPath(
  path: string | undefined | null,
  registry: RemovedCodeWorkspacesRegistry | null | undefined
): string {
  if (!registry || !Array.isArray(registry.removed)) return ''
  const key = workspaceRootIdentityKey(normalizeWorkspaceRoot(path ?? ''))
  if (!key) return ''
  for (const record of registry.removed) {
    if (removedRecordIdentityKeys(record).has(key)) {
      return workspaceRootIdentityKey(record.projectPath) || key
    }
  }
  return ''
}

export function isCodeWorkspaceRemoved(
  path: string | undefined | null,
  registry: RemovedCodeWorkspacesRegistry | null | undefined
): boolean {
  return removedProjectKeyForPath(path, registry) !== ''
}

export function removedWorkspaceIdentityKeys(
  registry: RemovedCodeWorkspacesRegistry | null | undefined
): Set<string> {
  const keys = new Set<string>()
  for (const record of registry?.removed ?? []) {
    for (const path of [record.projectPath, ...record.aliases]) {
      const key = workspaceRootIdentityKey(path)
      if (key) keys.add(key)
    }
  }
  return keys
}

export function effectiveCodeWorkspaceRoot(
  workspaceRoot: string | null | undefined,
  registry: RemovedCodeWorkspacesRegistry | null | undefined
): string {
  const normalized = normalizeWorkspaceRoot(workspaceRoot)
  return isCodeWorkspaceRemoved(normalized, registry) ? '' : normalized
}

export function removedProjectKeyForPaths(
  paths: readonly (string | null | undefined)[],
  registry: RemovedCodeWorkspacesRegistry | null | undefined
): string {
  for (const path of paths) {
    const key = removedProjectKeyForPath(path, registry)
    if (key) return key
  }
  return ''
}

/** Drop candidate roots whose project identity was removed by the user. */
export function filterRemovedCodeWorkspaceRoots(
  roots: readonly (string | undefined | null)[],
  registry: RemovedCodeWorkspacesRegistry
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    const normalized = normalizeWorkspaceRoot(root ?? '')
    const key = workspaceRootIdentityKey(normalized)
    if (!normalized || !key || seen.has(key)) continue
    if (removedProjectKeyForPath(normalized, registry)) continue
    seen.add(key)
    out.push(normalized)
  }
  return out
}

function readStorage(): BrowserStorageLike | null {
  // Route through the shared accessor so tests can stub window.localStorage
  // and get the same normalized storage object as the other registries.
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

function readStoredItem(storage: BrowserStorageLike): string | null {
  try {
    return storage.getItem(REMOVED_CODE_WORKSPACES_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredItem(storage: BrowserStorageLike, value: string): void {
  try {
    storage.setItem(REMOVED_CODE_WORKSPACES_STORAGE_KEY, value)
  } catch {
    /* ignore persistence failures */
  }
}
