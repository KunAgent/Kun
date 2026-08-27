import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'
import { workspaceRootIdentityKey } from '../../lib/workspace-path'
import type { SidebarDropPosition } from './sidebar-order'

export const SIDEBAR_FOLDERS_STORAGE_KEY = 'kun.sidebarFolders.v1'

export type SidebarVirtualFolder = {
  id: string
  name: string
  parentId: string | null
  threadIds: string[]
}

export type SidebarFolderRegistry = {
  version: 1
  foldersByScope: Record<string, SidebarVirtualFolder[]>
}

export function emptySidebarFolderRegistry(): SidebarFolderRegistry {
  return {
    version: 1,
    foldersByScope: {}
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

function normalizeFolderName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sidebarFolderNamesEqual(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0
}

function uniqueSidebarFolderName(name: string, reservedNames: readonly string[]): string {
  if (!reservedNames.some((reserved) => sidebarFolderNamesEqual(reserved, name))) return name
  for (let ordinal = 2; ; ordinal += 1) {
    const candidate = `${name} (${ordinal})`
    if (!reservedNames.some((reserved) => sidebarFolderNamesEqual(reserved, candidate))) {
      return candidate
    }
  }
}

function normalizeWorkspaceFolders(value: unknown): SidebarVirtualFolder[] {
  if (!Array.isArray(value)) return []
  const folderIds = new Set<string>()
  const candidates: Array<SidebarVirtualFolder & { parentId: string | null }> = []

  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Partial<SidebarVirtualFolder>
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    const name = normalizeFolderName(raw.name)
    if (!id || !name || folderIds.has(id)) continue
    folderIds.add(id)
    candidates.push({
      id,
      name,
      parentId: typeof raw.parentId === 'string' ? raw.parentId.trim() || null : null,
      threadIds: compactStrings(Array.isArray(raw.threadIds) ? raw.threadIds : [])
    })
  }

  const foldersById = new Map(candidates.map((folder) => [folder.id, folder] as const))
  const assignedThreadIds = new Set<string>()
  return candidates.map((folder) => {
    const requestedParentId = folder.parentId
    let validParent = requestedParentId !== null && foldersById.has(requestedParentId)
    let parentId = requestedParentId
    const ancestors = new Set<string>()
    while (validParent && parentId) {
      if (parentId === folder.id) {
        validParent = false
        break
      }
      if (ancestors.has(parentId)) break
      ancestors.add(parentId)
      const parent = foldersById.get(parentId)
      if (!parent) break
      parentId = parent.parentId
    }
    const normalizedParentId = validParent ? requestedParentId : null
    const threadIds = folder.threadIds.filter((threadId) => {
      if (assignedThreadIds.has(threadId)) return false
      assignedThreadIds.add(threadId)
      return true
    })
    return { ...folder, parentId: normalizedParentId, threadIds }
  })
}

export function sidebarFolderScope(workspacePath: string): string {
  return workspaceRootIdentityKey(workspacePath)
}

export function normalizeSidebarFolderRegistry(value: unknown): SidebarFolderRegistry {
  if (!value || typeof value !== 'object') return emptySidebarFolderRegistry()
  const raw = value as Partial<SidebarFolderRegistry>
  if (raw.version !== 1) return emptySidebarFolderRegistry()
  const foldersByScope: Record<string, SidebarVirtualFolder[]> = {}
  if (raw.foldersByScope && typeof raw.foldersByScope === 'object') {
    for (const [scope, folders] of Object.entries(raw.foldersByScope)) {
      const normalizedScope = scope.trim()
      if (!normalizedScope) continue
      const normalizedFolders = normalizeWorkspaceFolders(folders)
      if (normalizedFolders.length > 0) foldersByScope[normalizedScope] = normalizedFolders
    }
  }
  return {
    version: 1,
    foldersByScope
  }
}

export function readSidebarFolderRegistry(): SidebarFolderRegistry {
  try {
    const raw = readBrowserStorageItem(SIDEBAR_FOLDERS_STORAGE_KEY)
    if (!raw) return emptySidebarFolderRegistry()
    return normalizeSidebarFolderRegistry(JSON.parse(raw))
  } catch {
    return emptySidebarFolderRegistry()
  }
}

export function saveSidebarFolderRegistry(registry: SidebarFolderRegistry): void {
  writeBrowserStorageItem(
    SIDEBAR_FOLDERS_STORAGE_KEY,
    JSON.stringify(normalizeSidebarFolderRegistry(registry))
  )
}

export function sidebarFoldersForWorkspace(
  registry: SidebarFolderRegistry,
  workspacePath: string
): SidebarVirtualFolder[] {
  const scope = sidebarFolderScope(workspacePath)
  if (!scope) return []
  return normalizeSidebarFolderRegistry(registry).foldersByScope[scope] ?? []
}

function updateWorkspaceFolders(
  registry: SidebarFolderRegistry,
  workspacePath: string,
  update: (folders: SidebarVirtualFolder[]) => SidebarVirtualFolder[]
): SidebarFolderRegistry {
  const normalized = normalizeSidebarFolderRegistry(registry)
  const scope = sidebarFolderScope(workspacePath)
  if (!scope) return normalized
  const foldersByScope = { ...normalized.foldersByScope }
  const nextFolders = normalizeWorkspaceFolders(update(foldersByScope[scope] ?? []))
  if (nextFolders.length > 0) foldersByScope[scope] = nextFolders
  else delete foldersByScope[scope]
  return {
    version: 1,
    foldersByScope
  }
}

export function createSidebarFolder(
  registry: SidebarFolderRegistry,
  workspacePath: string,
  folder: Pick<SidebarVirtualFolder, 'id' | 'name'> & Partial<Pick<SidebarVirtualFolder, 'parentId'>>
): SidebarFolderRegistry {
  const id = folder.id.trim()
  const name = folder.name.trim()
  const requestedParentId = folder.parentId?.trim() || null
  if (!id || !name) return normalizeSidebarFolderRegistry(registry)
  return updateWorkspaceFolders(registry, workspacePath, (folders) => {
    const parentId = requestedParentId && folders.some((item) => item.id === requestedParentId)
      ? requestedParentId
      : null
    if (
      folders.some((item) =>
        item.id === id || (
          item.parentId === parentId
          && sidebarFolderNamesEqual(item.name, name)
        )
      )
    ) {
      return folders
    }
    return [...folders, { id, name, parentId, threadIds: [] }]
  })
}

export function renameSidebarFolder(
  registry: SidebarFolderRegistry,
  workspacePath: string,
  folderId: string,
  name: string
): SidebarFolderRegistry {
  const normalizedId = folderId.trim()
  const normalizedName = name.trim()
  if (!normalizedId || !normalizedName) return normalizeSidebarFolderRegistry(registry)
  return updateWorkspaceFolders(registry, workspacePath, (folders) => {
    const currentFolder = folders.find((item) => item.id === normalizedId)
    if (!currentFolder) return folders
    if (
      folders.some((item) =>
        item.id !== normalizedId
        && item.parentId === currentFolder.parentId
        && sidebarFolderNamesEqual(item.name, normalizedName)
      )
    ) {
      return folders
    }
    return folders.map((folder) =>
      folder.id === normalizedId ? { ...folder, name: normalizedName } : folder
    )
  })
}

export function deleteSidebarFolder(
  registry: SidebarFolderRegistry,
  workspacePath: string,
  folderId: string
): SidebarFolderRegistry {
  const normalizedId = folderId.trim()
  if (!normalizedId) return normalizeSidebarFolderRegistry(registry)
  return updateWorkspaceFolders(registry, workspacePath, (folders) => {
    const deleting = folders.find((folder) => folder.id === normalizedId)
    if (!deleting) return folders
    const reservedNames = folders
      .filter((folder) =>
        folder.id !== normalizedId &&
        folder.parentId === deleting.parentId &&
        folder.parentId !== normalizedId
      )
      .map((folder) => folder.name)
    return folders
      .filter((folder) => folder.id !== normalizedId)
      .map((folder) => {
        if (folder.parentId !== normalizedId) return folder
        const name = uniqueSidebarFolderName(folder.name, reservedNames)
        reservedNames.push(name)
        return { ...folder, name, parentId: deleting.parentId }
      })
  })
}

export function sidebarFolderIdForThread(
  folders: readonly SidebarVirtualFolder[],
  threadId: string
): string | null {
  const normalizedId = threadId.trim()
  if (!normalizedId) return null
  return folders.find((folder) => folder.threadIds.includes(normalizedId))?.id ?? null
}

export function moveThreadToSidebarFolder(
  registry: SidebarFolderRegistry,
  workspacePath: string,
  threadId: string,
  folderId: string | null,
  targetThreadId?: string,
  position: SidebarDropPosition = 'after',
  targetThreadOrder?: readonly string[]
): SidebarFolderRegistry {
  const normalizedThreadId = threadId.trim()
  const normalizedFolderId = folderId?.trim() || null
  const normalizedTargetId = targetThreadId?.trim() || ''
  if (!normalizedThreadId) return normalizeSidebarFolderRegistry(registry)

  return updateWorkspaceFolders(registry, workspacePath, (folders) => {
    const withoutThread = folders.map((folder) => ({
      ...folder,
      threadIds: folder.threadIds.filter((id) => id !== normalizedThreadId)
    }))
    if (!normalizedFolderId) return withoutThread
    return withoutThread.map((folder) => {
      if (folder.id !== normalizedFolderId) return folder
      const requestedOrder = compactStrings(targetThreadOrder ?? folder.threadIds)
        .filter((id) => id !== normalizedThreadId && folder.threadIds.includes(id))
      const requestedIds = new Set(requestedOrder)
      const baseThreadIds = [
        ...requestedOrder,
        ...folder.threadIds.filter((id) => id !== normalizedThreadId && !requestedIds.has(id))
      ]
      const targetIndex = normalizedTargetId
        ? baseThreadIds.findIndex((id) => id === normalizedTargetId)
        : -1
      const insertionIndex = targetIndex < 0
        ? baseThreadIds.length
        : targetIndex + (position === 'after' ? 1 : 0)
      const threadIds = [...baseThreadIds]
      threadIds.splice(insertionIndex, 0, normalizedThreadId)
      return { ...folder, threadIds }
    })
  })
}

export function removeSidebarThreadAssignments(
  registry: SidebarFolderRegistry,
  threadIds: readonly string[]
): SidebarFolderRegistry {
  const removing = new Set(compactStrings(threadIds))
  if (removing.size === 0) return normalizeSidebarFolderRegistry(registry)
  const normalized = normalizeSidebarFolderRegistry(registry)
  return normalizeSidebarFolderRegistry({
    ...normalized,
    foldersByScope: Object.fromEntries(
      Object.entries(normalized.foldersByScope).map(([scope, folders]) => [
        scope,
        folders.map((folder) => ({
          ...folder,
          threadIds: folder.threadIds.filter((id) => !removing.has(id))
        }))
      ])
    )
  })
}

export function sidebarChildFolders(
  folders: readonly SidebarVirtualFolder[],
  parentId: string | null
): SidebarVirtualFolder[] {
  return folders.filter((folder) => folder.parentId === parentId)
}

export function sidebarFolderDescendantThreadIds(
  folders: readonly SidebarVirtualFolder[],
  folderId: string
): string[] {
  const descendantIds = new Set([folderId])
  let changed = true
  while (changed) {
    changed = false
    for (const folder of folders) {
      if (folder.parentId && descendantIds.has(folder.parentId) && !descendantIds.has(folder.id)) {
        descendantIds.add(folder.id)
        changed = true
      }
    }
  }
  return folders.flatMap((folder) => descendantIds.has(folder.id) ? folder.threadIds : [])
}

export function sidebarFolderThreadCount(
  folders: readonly SidebarVirtualFolder[],
  folderId: string
): number {
  return sidebarFolderDescendantThreadIds(folders, folderId).length
}

export function sidebarFolderNameExists(
  folders: readonly SidebarVirtualFolder[],
  name: string,
  excludingFolderId?: string,
  parentId: string | null = null
): boolean {
  const normalizedName = name.trim()
  if (!normalizedName) return false
  return folders.some((folder) =>
    folder.id !== excludingFolderId
    && folder.parentId === parentId
    && sidebarFolderNamesEqual(folder.name, normalizedName)
  )
}
