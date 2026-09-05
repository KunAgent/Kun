import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'
import {
  normalizeWorkspaceRoot,
  workspaceRootIdentityKey,
  workspaceRootScopeKey
} from '../../lib/workspace-path'

export const SIDEBAR_ORDER_STORAGE_KEY = 'kun.sidebarOrder.v1'
export const SIDEBAR_THREAD_DRAG_DATA_KEY = 'application/x-kun-thread-id'
export const SIDEBAR_WORKSPACE_DRAG_DATA_KEY = 'application/x-kun-workspace-path'

export type SidebarDropPosition = 'before' | 'after'

export type SidebarOrderRegistry = {
  version: 1
  workspacePaths: string[]
  threadIdsByScope: Record<string, string[]>
}

export function emptySidebarOrderRegistry(): SidebarOrderRegistry {
  return {
    version: 1,
    workspacePaths: [],
    threadIdsByScope: {}
  }
}

function compactStrings(values: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function compactWorkspacePaths(values: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const normalized = workspaceRootScopeKey(normalizeWorkspaceRoot(value))
    const key = workspaceRootIdentityKey(normalized)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result
}

export function normalizeSidebarOrderRegistry(value: unknown): SidebarOrderRegistry {
  if (!value || typeof value !== 'object') return emptySidebarOrderRegistry()
  const raw = value as Partial<SidebarOrderRegistry>
  if (raw.version !== 1) return emptySidebarOrderRegistry()
  const threadIdsByScope: Record<string, string[]> = {}
  if (raw.threadIdsByScope && typeof raw.threadIdsByScope === 'object') {
    for (const [scope, ids] of Object.entries(raw.threadIdsByScope)) {
      const normalizedScope = scope.trim()
      if (!normalizedScope || !Array.isArray(ids)) continue
      const compacted = compactStrings(ids)
      if (compacted.length > 0) threadIdsByScope[normalizedScope] = compacted
    }
  }
  return {
    version: 1,
    workspacePaths: compactWorkspacePaths(Array.isArray(raw.workspacePaths) ? raw.workspacePaths : []),
    threadIdsByScope
  }
}

export function readSidebarOrderRegistry(): SidebarOrderRegistry {
  try {
    const raw = readBrowserStorageItem(SIDEBAR_ORDER_STORAGE_KEY)
    if (!raw) return emptySidebarOrderRegistry()
    return normalizeSidebarOrderRegistry(JSON.parse(raw))
  } catch {
    return emptySidebarOrderRegistry()
  }
}

export function saveSidebarOrderRegistry(registry: SidebarOrderRegistry): void {
  writeBrowserStorageItem(
    SIDEBAR_ORDER_STORAGE_KEY,
    JSON.stringify(normalizeSidebarOrderRegistry(registry))
  )
}

export function sidebarThreadOrderScope(workspacePath: string): string {
  return workspaceRootIdentityKey(normalizeWorkspaceRoot(workspacePath))
}

export function setSidebarWorkspaceOrder(
  registry: SidebarOrderRegistry,
  workspacePaths: readonly string[]
): SidebarOrderRegistry {
  return {
    ...normalizeSidebarOrderRegistry(registry),
    workspacePaths: compactWorkspacePaths(workspacePaths)
  }
}

export function setSidebarThreadOrder(
  registry: SidebarOrderRegistry,
  workspacePath: string,
  threadIds: readonly string[]
): SidebarOrderRegistry {
  const normalized = normalizeSidebarOrderRegistry(registry)
  const scope = sidebarThreadOrderScope(workspacePath)
  if (!scope) return normalized
  const threadIdsByScope = { ...normalized.threadIdsByScope }
  const compacted = compactStrings(threadIds)
  if (compacted.length > 0) threadIdsByScope[scope] = compacted
  else delete threadIdsByScope[scope]
  return { ...normalized, threadIdsByScope }
}

export function reconcileSidebarWorkspaceOrder(
  workspacePaths: readonly string[],
  savedWorkspacePaths: readonly string[]
): string[] {
  return reconcileSavedOrder({
    items: compactWorkspacePaths(workspacePaths),
    savedKeys: savedWorkspacePaths,
    itemKey: (path) => workspaceRootIdentityKey(path),
    savedKey: (path) => workspaceRootIdentityKey(normalizeWorkspaceRoot(path))
  })
}

export function reconcileSidebarThreadOrder<T extends { id: string }>(
  threads: readonly T[],
  savedThreadIds: readonly string[]
): T[] {
  return reconcileSavedOrder({
    items: threads,
    savedKeys: savedThreadIds,
    itemKey: (thread) => thread.id.trim(),
    savedKey: (threadId) => threadId.trim(),
    unsavedPlacement: 'byNeighbor'
  })
}

type UnsavedPlacement = 'append' | 'byNeighbor'

function reconcileSavedOrder<T>(options: {
  items: readonly T[]
  savedKeys: readonly string[]
  itemKey: (item: T) => string
  savedKey: (key: string) => string
  unsavedPlacement?: UnsavedPlacement
}): T[] {
  const remainingByKey = new Map<string, T>()
  const itemKeys: string[] = []
  for (const item of options.items) {
    const key = options.itemKey(item)
    if (key && !remainingByKey.has(key)) {
      remainingByKey.set(key, item)
      itemKeys.push(key)
    }
  }

  const result: T[] = []
  const placed = new Set<string>()

  const place = (key: string): void => {
    const item = remainingByKey.get(key)
    if (!item) return
    result.push(item)
    placed.add(key)
    remainingByKey.delete(key)
  }

  for (const saved of options.savedKeys) {
    place(options.savedKey(saved))
  }

  if (options.unsavedPlacement !== 'byNeighbor') {
    result.push(...remainingByKey.values())
    return result
  }

  // Insert unsaved entries beside their nearest neighbor from the current
  // (already sorted) order, so a freshly created thread stays near the top
  // while the user's saved relative order is preserved.
  const indexOfPlaced = (key: string): number =>
    result.findIndex((item) => options.itemKey(item) === key)

  for (let index = 0; index < itemKeys.length; index += 1) {
    const key = itemKeys[index]!
    if (placed.has(key)) continue
    const item = remainingByKey.get(key)
    if (!item) continue
    const following = itemKeys.slice(index + 1).find((candidate) => placed.has(candidate))
    if (following) {
      result.splice(indexOfPlaced(following), 0, item)
    } else {
      const preceding = itemKeys.slice(0, index).reverse().find((candidate) => placed.has(candidate))
      if (preceding) {
        result.splice(indexOfPlaced(preceding) + 1, 0, item)
      } else {
        result.push(item)
      }
    }
    placed.add(key)
    remainingByKey.delete(key)
  }

  return result
}

export function reorderSidebarWorkspacePaths(options: {
  workspacePaths: readonly string[]
  sourcePath: string
  targetPath: string
  position: SidebarDropPosition
}): string[] {
  return moveItemAroundTarget({
    items: compactWorkspacePaths(options.workspacePaths),
    sourceKey: workspaceRootIdentityKey(normalizeWorkspaceRoot(options.sourcePath)),
    targetKey: workspaceRootIdentityKey(normalizeWorkspaceRoot(options.targetPath)),
    position: options.position,
    itemKey: (path) => workspaceRootIdentityKey(path)
  })
}

export function reorderSidebarThreadIds(options: {
  threadIds: readonly string[]
  sourceId: string
  targetId: string
  position: SidebarDropPosition
}): string[] {
  return moveItemAroundTarget({
    items: compactStrings(options.threadIds),
    sourceKey: options.sourceId.trim(),
    targetKey: options.targetId.trim(),
    position: options.position,
    itemKey: (threadId) => threadId
  })
}

function moveItemAroundTarget<T>(options: {
  items: readonly T[]
  sourceKey: string
  targetKey: string
  position: SidebarDropPosition
  itemKey: (item: T) => string
}): T[] {
  if (!options.sourceKey || !options.targetKey || options.sourceKey === options.targetKey) {
    return [...options.items]
  }
  const sourceIndex = options.items.findIndex((item) => options.itemKey(item) === options.sourceKey)
  const targetIndex = options.items.findIndex((item) => options.itemKey(item) === options.targetKey)
  if (sourceIndex < 0 || targetIndex < 0) return [...options.items]

  const result = [...options.items]
  const [source] = result.splice(sourceIndex, 1)
  const adjustedTargetIndex = result.findIndex((item) => options.itemKey(item) === options.targetKey)
  const insertionIndex = adjustedTargetIndex + (options.position === 'after' ? 1 : 0)
  result.splice(insertionIndex, 0, source)
  return result
}

export function sidebarDropPosition(clientY: number, top: number, height: number): SidebarDropPosition {
  return clientY < top + height / 2 ? 'before' : 'after'
}
