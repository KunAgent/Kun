import type { BrowserStorageLike } from './browser-storage'
import { readBrowserStorageItem, writeBrowserStorageItem } from './browser-storage'
import { normalizeWorkspaceRoot, workspaceRootIdentityKey } from './workspace-path'

/**
 * A Code project. `displayName` is optional so folders persisted by the old
 * single-directory model keep loading; unnamed projects fall back to the
 * folder's basename for display only.
 */
export type CodeWorkspaceFolderSet = {
  primary: string
  extraRoots: string[]
  displayName?: string
}

export type CodeWorkspaceFolderSetsRegistry = {
  version: 1
  sets: CodeWorkspaceFolderSet[]
}

export type AddWorkspaceFolderError =
  | 'missing-primary'
  | 'missing-folder'
  | 'same-as-primary'
  | 'duplicate'
  | 'nested'
  | 'limit'
  | 'project-limit'

export type SaveWorkspaceProjectError =
  | 'missing-name'
  | 'invalid-name'
  | 'missing-primary'
  | 'duplicate-primary'
  | 'duplicate'
  | 'same-as-primary'
  | 'nested'
  | 'limit'
  | 'project-limit'

export const CODE_WORKSPACE_FOLDER_SETS_STORAGE_KEY = 'kun.codeWorkspaceFolderSets.v1'
export const MAX_CODE_WORKSPACE_FOLDER_SETS = 30
export const MAX_ADDITIONAL_WORKSPACES = 32
export const MAX_CODE_WORKSPACE_PROJECT_NAME_LENGTH = 80

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
    const record = entry as { primary?: unknown; extraRoots?: unknown; displayName?: unknown }
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
      }
    }
    const displayName = normalizeCodeWorkspaceProjectName(record.displayName)
    // Older registries only stored projects that gained an extra folder. A
    // named project with a single folder is a first-class project now, and
    // over-limit registries are kept intact instead of being truncated.
    if (extraRoots.length === 0 && !displayName) continue
    sets.push(displayName ? { primary, extraRoots, displayName } : { primary, extraRoots })
  }
  return { version: 1, sets }
}

export function normalizeCodeWorkspaceProjectName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s+/g, ' ').trim()
}

/** Basename fallback used only for projects persisted before names existed. */
export function workspaceProjectFallbackName(primary: string): string {
  const normalized = primary.replace(/[/\\]+$/, '')
  const parts = normalized.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? primary
}

export function codeWorkspaceProjectFor(
  registry: CodeWorkspaceFolderSetsRegistry | null | undefined,
  primary: string
): CodeWorkspaceFolderSet | undefined {
  const index = findSetIndex(registry?.sets ?? [], primary)
  return index < 0 ? undefined : registry!.sets[index]
}

export function codeWorkspaceProjectDisplayName(
  registry: CodeWorkspaceFolderSetsRegistry | null | undefined,
  primary: string
): string {
  const project = codeWorkspaceProjectFor(registry, primary)
  return project?.displayName || workspaceProjectFallbackName(primary)
}

export function codeWorkspaceProjectFolderCount(
  registry: CodeWorkspaceFolderSetsRegistry | null | undefined,
  primary: string
): number {
  const project = codeWorkspaceProjectFor(registry, primary)
  return 1 + (project?.extraRoots.length ?? 0)
}

/**
 * A worktree only isolates the main repository; extra folders would silently
 * grant the run write access to other source checkouts.
 */
export function isMultiRootWorktreeBlocked(
  extraRootCount: number,
  isolation: string | undefined
): boolean {
  return isolation === 'worktree' && extraRootCount > 0
}

export type SaveWorkspaceProjectDraft = {
  mode: 'create' | 'manage'
  displayName: string
  primary: string
  extraRoots: readonly string[]
}

/**
 * Creates or updates one project without touching any other project or its
 * files. Validation is explicit: callers surface the error instead of
 * writing a partially repaired draft.
 */
export function saveWorkspaceProject(
  registry: CodeWorkspaceFolderSetsRegistry,
  draft: SaveWorkspaceProjectDraft
): { registry: CodeWorkspaceFolderSetsRegistry; error?: SaveWorkspaceProjectError; set?: CodeWorkspaceFolderSet } {
  const displayName = normalizeCodeWorkspaceProjectName(draft.displayName)
  if (!displayName) return { registry, error: 'missing-name' }
  if (displayName.length > MAX_CODE_WORKSPACE_PROJECT_NAME_LENGTH) {
    return { registry, error: 'invalid-name' }
  }
  const primary = trimStoredWorkspacePath(draft.primary)
  const primaryKey = workspaceRootIdentityKey(primary)
  if (!primary || !primaryKey) return { registry, error: 'missing-primary' }

  const existingIndex = findSetIndex(registry.sets, primary)
  if (draft.mode === 'create' && existingIndex >= 0) return { registry, error: 'duplicate-primary' }
  if (draft.mode === 'manage' && existingIndex < 0) return { registry, error: 'missing-primary' }
  if (draft.mode === 'create' && registry.sets.length >= MAX_CODE_WORKSPACE_FOLDER_SETS) {
    return { registry, error: 'project-limit' }
  }

  const extraRoots: string[] = []
  const extraKeys = new Set<string>([primaryKey])
  for (const raw of draft.extraRoots) {
    const normalized = trimStoredWorkspacePath(raw)
    const extraKey = workspaceRootIdentityKey(normalized)
    if (!normalized || !extraKey) continue
    if (extraKey === primaryKey) return { registry, error: 'same-as-primary' }
    if (extraKeys.has(extraKey)) return { registry, error: 'duplicate' }
    if (workspacePathsOverlap(primary, normalized)) return { registry, error: 'nested' }
    if (extraRoots.some((root) => workspacePathsOverlap(root, normalized))) {
      return { registry, error: 'nested' }
    }
    if (extraRoots.length >= MAX_ADDITIONAL_WORKSPACES) return { registry, error: 'limit' }
    extraKeys.add(extraKey)
    extraRoots.push(normalized)
  }

  const set: CodeWorkspaceFolderSet = { primary, extraRoots, displayName }
  const nextSets = [...registry.sets]
  if (existingIndex >= 0) nextSets[existingIndex] = set
  else nextSets.push(set)
  return { registry: { version: 1, sets: nextSets }, set }
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
    nextSets[index] = { ...nextSets[index]!, extraRoots }
  } else {
    // A new project must not evict an existing one. Surface the limit so the
    // caller can pick a different entry point instead of losing user data.
    if (nextSets.length >= MAX_CODE_WORKSPACE_FOLDER_SETS) {
      return { registry, extraRoots: current, error: 'project-limit' }
    }
    nextSets.push({ primary: normalizedPrimary, extraRoots })
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
  // Named projects survive losing their last extra folder; only unnamed legacy
  // sets collapse, because they exist solely to describe extra folders.
  if (extraRoots.length === 0 && !current.displayName) nextSets.splice(index, 1)
  else nextSets[index] = { ...current, extraRoots }
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
