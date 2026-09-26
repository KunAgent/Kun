import type { BrowserStorageLike } from './browser-storage'
import { readBrowserStorageItem, writeBrowserStorageItem } from './browser-storage'
import { normalizeWorkspaceRoot, workspaceRootIdentityKey } from './workspace-path'

export type CodeWorkspaceFolderSet = {
  primary: string
  extraRoots: string[]
}

export type CodeWorkspaceFolderSetsRegistry = {
  version: 1
  sets: CodeWorkspaceFolderSet[]
}

export type AddWorkspaceFolderError = 'missing-primary' | 'missing-folder' | 'same-as-primary' | 'duplicate' | 'nested' | 'limit'

export const CODE_WORKSPACE_FOLDER_SETS_STORAGE_KEY = 'kun.codeWorkspaceFolderSets.v1'
export const MAX_CODE_WORKSPACE_FOLDER_SETS = 30
export const MAX_ADDITIONAL_WORKSPACES = 32

export function emptyCodeWorkspaceFolderSetsRegistry(): CodeWorkspaceFolderSetsRegistry {
  return { version: 1, sets: [] }
}

function trimStoredWorkspacePath(path: string): string {
  return normalizeWorkspaceRoot(path).replace(/[\\/]+$/, '')
}

export function workspacePathsOverlap(left: string, right: string): boolean {
  const leftKey = workspaceRootIdentityKey(left)
  const rightKey = workspaceRootIdentityKey(right)
  if (!leftKey || !rightKey) return false
  if (leftKey === rightKey) return true
  return leftKey.startsWith(`${rightKey}/`) || rightKey.startsWith(`${leftKey}/`)
}

export function additionalWorkspacesEqual(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
): boolean {
  const leftKeys = new Set((left ?? []).map((path) => workspaceRootIdentityKey(path)).filter(Boolean))
  const rightKeys = new Set((right ?? []).map((path) => workspaceRootIdentityKey(path)).filter(Boolean))
  if (leftKeys.size !== rightKeys.size) return false
  for (const key of leftKeys) {
    if (!rightKeys.has(key)) return false
  }
  return true
}

function findSetIndex(
  sets: readonly CodeWorkspaceFolderSet[],
  primary: string
): number {
  const key = workspaceRootIdentityKey(primary)
  if (!key) return -1
  return sets.findIndex((entry) => workspaceRootIdentityKey(entry.primary) === key)
}

export function normalizeCodeWorkspaceFolderSetsRegistry(
  raw: unknown
): CodeWorkspaceFolderSetsRegistry {
  if (!raw || typeof raw !== 'object') return emptyCodeWorkspaceFolderSetsRegistry()
  const source = raw as { sets?: unknown }
  if (!Array.isArray(source.sets)) return emptyCodeWorkspaceFolderSetsRegistry()

  const seenPrimaries = new Set<string>()
  const sets: CodeWorkspaceFolderSet[] = []
  for (const entry of source.sets) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as { primary?: unknown; extraRoots?: unknown }
    const primary = trimStoredWorkspacePath(typeof record.primary === 'string' ? record.primary : '')
    const primaryKey = workspaceRootIdentityKey(primary)
    if (!primary || !primaryKey || seenPrimaries.has(primaryKey)) continue
    seenPrimaries.add(primaryKey)
    const extraRoots: string[] = []
    const extraKeys = new Set<string>([primaryKey])
    if (Array.isArray(record.extraRoots)) {
      for (const extra of record.extraRoots) {
        const normalized = trimStoredWorkspacePath(typeof extra === 'string' ? extra : '')
        const extraKey = workspaceRootIdentityKey(normalized)
        if (!normalized || !extraKey || extraKeys.has(extraKey)) continue
        if ([primary, ...extraRoots].some((root) => workspacePathsOverlap(root, normalized))) continue
        extraKeys.add(extraKey)
        extraRoots.push(normalized)
        if (extraRoots.length >= MAX_ADDITIONAL_WORKSPACES) break
      }
    }
    if (extraRoots.length === 0) continue
    sets.push({ primary, extraRoots })
    if (sets.length >= MAX_CODE_WORKSPACE_FOLDER_SETS) break
  }
  return { version: 1, sets }
}

export function readCodeWorkspaceFolderSets(
  storage?: BrowserStorageLike | null
): CodeWorkspaceFolderSetsRegistry {
  const raw = storage
    ? storage.getItem(CODE_WORKSPACE_FOLDER_SETS_STORAGE_KEY)
    : readBrowserStorageItem(CODE_WORKSPACE_FOLDER_SETS_STORAGE_KEY)
  if (!raw) return emptyCodeWorkspaceFolderSetsRegistry()
  try {
    return normalizeCodeWorkspaceFolderSetsRegistry(JSON.parse(raw))
  } catch {
    return emptyCodeWorkspaceFolderSetsRegistry()
  }
}

export function saveCodeWorkspaceFolderSets(
  registry: CodeWorkspaceFolderSetsRegistry,
  storage?: BrowserStorageLike | null
): CodeWorkspaceFolderSetsRegistry {
  const normalized = normalizeCodeWorkspaceFolderSetsRegistry(registry)
  const payload = JSON.stringify(normalized)
  if (storage) storage.setItem(CODE_WORKSPACE_FOLDER_SETS_STORAGE_KEY, payload)
  else writeBrowserStorageItem(CODE_WORKSPACE_FOLDER_SETS_STORAGE_KEY, payload)
  return normalized
}

export function extraRootsForPrimary(
  primary: string,
  registry: CodeWorkspaceFolderSetsRegistry = readCodeWorkspaceFolderSets()
): string[] {
  const index = findSetIndex(registry?.sets ?? [], primary)
  if (index < 0) return []
  return [...(registry?.sets[index]?.extraRoots ?? [])]
}

export function additionalWorkspacesForThread(
  threadWorkspace: string,
  extras: readonly string[]
): string[] {
  const workspaceKey = workspaceRootIdentityKey(threadWorkspace)
  return extras.filter((root) => workspaceRootIdentityKey(root) !== workspaceKey)
}

export function addWorkspaceFolderToRegistry(
  primary: string,
  extraRoot: string,
  registry: CodeWorkspaceFolderSetsRegistry
): { registry: CodeWorkspaceFolderSetsRegistry; extraRoots: string[]; error?: AddWorkspaceFolderError } {
  const normalizedPrimary = trimStoredWorkspacePath(primary)
  const normalizedExtra = trimStoredWorkspacePath(extraRoot)
  if (!normalizedPrimary || !workspaceRootIdentityKey(normalizedPrimary)) {
    return { registry, extraRoots: extraRootsForPrimary(primary, registry), error: 'missing-primary' }
  }
  if (!normalizedExtra || !workspaceRootIdentityKey(normalizedExtra)) {
    return { registry, extraRoots: extraRootsForPrimary(normalizedPrimary, registry), error: 'missing-folder' }
  }
  if (workspaceRootIdentityKey(normalizedPrimary) === workspaceRootIdentityKey(normalizedExtra)) {
    return { registry, extraRoots: extraRootsForPrimary(normalizedPrimary, registry), error: 'same-as-primary' }
  }

  const current = extraRootsForPrimary(normalizedPrimary, registry)
  if (current.some((root) => workspaceRootIdentityKey(root) === workspaceRootIdentityKey(normalizedExtra))) {
    return { registry, extraRoots: current, error: 'duplicate' }
  }
  if ([normalizedPrimary, ...current].some((root) => workspacePathsOverlap(root, normalizedExtra))) {
    return { registry, extraRoots: current, error: 'nested' }
  }
  if (current.length >= MAX_ADDITIONAL_WORKSPACES) {
    return { registry, extraRoots: current, error: 'limit' }
  }

  const extraRoots = [...current, normalizedExtra]
  const nextSets = [...registry.sets]
  const index = findSetIndex(nextSets, normalizedPrimary)
  if (index >= 0) {
    nextSets[index] = { primary: nextSets[index]!.primary, extraRoots }
  } else {
    nextSets.push({ primary: normalizedPrimary, extraRoots })
    if (nextSets.length > MAX_CODE_WORKSPACE_FOLDER_SETS) nextSets.shift()
  }
  return {
    registry: { version: 1, sets: nextSets },
    extraRoots
  }
}

export function removeWorkspaceFolderFromRegistry(
  primary: string,
  extraRoot: string,
  registry: CodeWorkspaceFolderSetsRegistry
): { registry: CodeWorkspaceFolderSetsRegistry; extraRoots: string[] } {
  const extraKey = workspaceRootIdentityKey(extraRoot)
  const index = findSetIndex(registry.sets, primary)
  if (index < 0 || !extraKey) {
    return { registry, extraRoots: extraRootsForPrimary(primary, registry) }
  }
  const current = registry.sets[index]!
  const extraRoots = current.extraRoots.filter((root) => workspaceRootIdentityKey(root) !== extraKey)
  const nextSets = [...registry.sets]
  if (extraRoots.length === 0) nextSets.splice(index, 1)
  else nextSets[index] = { primary: current.primary, extraRoots }
  return { registry: { version: 1, sets: nextSets }, extraRoots }
}

export function forgetCodeWorkspaceFolderSet(
  primary: string,
  registry: CodeWorkspaceFolderSetsRegistry
): CodeWorkspaceFolderSetsRegistry {
  const index = findSetIndex(registry.sets, primary)
  if (index < 0) return registry
  return { version: 1, sets: registry.sets.filter((_, itemIndex) => itemIndex !== index) }
}

export function unionWorkspaceFoldersIntoRegistry(
  primary: string,
  extras: readonly string[],
  registry: CodeWorkspaceFolderSetsRegistry
): { registry: CodeWorkspaceFolderSetsRegistry; extraRoots: string[]; changed: boolean } {
  let next = registry
  let extraRoots = extraRootsForPrimary(primary, next)
  let changed = false
  for (const extra of extras) {
    const added = addWorkspaceFolderToRegistry(primary, extra, next)
    if (added.error) continue
    if (!additionalWorkspacesEqual(added.extraRoots, extraRoots)) changed = true
    next = added.registry
    extraRoots = added.extraRoots
  }
  return { registry: next, extraRoots, changed }
}
