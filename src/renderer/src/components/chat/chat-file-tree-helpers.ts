import type {
  WorkspaceDirectoryListResult,
  WorkspaceDirectoryTarget,
  WorkspaceEntry
} from '@shared/workspace-file'
import {
  owningComposerWorkspaceRoot,
  relativeWorkspacePath,
  type ComposerFileReference
} from '../../lib/composer-file-references'
import { isWorkspacePreviewPath } from '../../lib/workspace-text-preview'

export type ChatFileTreeReference = ComposerFileReference & {
  type: 'file' | 'directory'
}

export type FileTreeSortMode = 'name' | 'modified'

type ListWorkspaceDirectory = (target: WorkspaceDirectoryTarget) => Promise<WorkspaceDirectoryListResult>

type RecentScanOptions = {
  isCancelled?: () => boolean
  limit?: number
  maxDepth?: number
  maxEntries?: number
}

const IGNORED_DIRS = new Set(['.git', '.hg', '.svn', 'node_modules'])
const RECENT_FILE_LIMIT = 8
const RECENT_SCAN_MAX_ENTRIES = 2_000
const RECENT_SCAN_MAX_DEPTH = 8

export function normalizeChatFileTreePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/g, '')
}

export function chatFileTreePathKey(path: string): string {
  return normalizeChatFileTreePath(path).toLowerCase()
}

export function chatFileTreeDisplayName(path: string): string {
  const normalized = normalizeChatFileTreePath(path)
  const parts = normalized.split('/').filter(Boolean)
  return parts.at(-1) ?? path
}

export function chatFileTreeUniqueRoots(primary: string, extraRoots: readonly string[] = []): string[] {
  const roots: string[] = []
  const seen = new Set<string>()
  for (const root of [primary, ...extraRoots]) {
    const trimmed = root.trim()
    const key = chatFileTreePathKey(trimmed)
    if (!trimmed || !key || seen.has(key)) continue
    seen.add(key)
    roots.push(trimmed)
  }
  return roots
}

export function owningChatFileTreeRoot(path: string, roots: readonly string[]): string {
  return owningComposerWorkspaceRoot(path, roots) || roots[0] || ''
}

export function chatFileTreeEntryReference(
  entry: WorkspaceEntry,
  workspaceRoot: string
): ChatFileTreeReference {
  return {
    path: entry.path,
    relativePath: relativeWorkspacePath(entry.path, workspaceRoot),
    name: entry.name,
    type: entry.type,
    workspaceRoot
  }
}

export function compareChatFileTreeEntriesByName(left: WorkspaceEntry, right: WorkspaceEntry): number {
  if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
}

export function compareChatFileTreeEntriesByModified(left: WorkspaceEntry, right: WorkspaceEntry): number {
  if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
  const leftTime = left.mtimeMs ?? 0
  const rightTime = right.mtimeMs ?? 0
  if (leftTime !== rightTime) return rightTime - leftTime
  return compareChatFileTreeEntriesByName(left, right)
}

export function sortChatFileTreeEntries(entries: WorkspaceEntry[], mode: FileTreeSortMode): WorkspaceEntry[] {
  return [...entries].sort(mode === 'modified' ? compareChatFileTreeEntriesByModified : compareChatFileTreeEntriesByName)
}

function sortRecentFiles(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return [...entries]
    .filter(isChatFileTreePreviewableEntry)
    .sort((left, right) => {
      const leftTime = left.mtimeMs ?? 0
      const rightTime = right.mtimeMs ?? 0
      if (leftTime !== rightTime) return rightTime - leftTime
      return compareChatFileTreeEntriesByName(left, right)
    })
}

export async function scanChatFileTreeRecentFiles(
  root: string,
  listWorkspaceDirectory: ListWorkspaceDirectory,
  options: RecentScanOptions = {}
): Promise<WorkspaceEntry[]> {
  const limit = options.limit ?? RECENT_FILE_LIMIT
  const maxDepth = options.maxDepth ?? RECENT_SCAN_MAX_DEPTH
  const maxEntries = options.maxEntries ?? RECENT_SCAN_MAX_ENTRIES
  const isCancelled = options.isCancelled ?? (() => false)
  const collected: WorkspaceEntry[] = []

  const scanDirectory = async (
    path: string,
    depth: number,
    seenDirectories: Set<string>
  ): Promise<void> => {
    if (isCancelled() || depth > maxDepth || collected.length >= maxEntries) return
    const directoryKey = chatFileTreePathKey(path || root)
    if (seenDirectories.has(directoryKey)) return
    seenDirectories.add(directoryKey)
    const result = await listWorkspaceDirectory({ workspaceRoot: root, path: path || root })
    if (!result.ok) throw new Error(result.message)
    for (const entry of result.entries) {
      if (isCancelled() || collected.length >= maxEntries) return
      if (entry.type === 'directory') {
        if (!isChatFileTreeIgnoredDirectory(entry.name)) {
          await scanDirectory(entry.path, depth + 1, seenDirectories)
        }
        continue
      }
      if (isChatFileTreePreviewableEntry(entry)) collected.push(entry)
    }
  }

  await scanDirectory(root, 0, new Set())
  return sortRecentFiles(collected).slice(0, limit)
}

export async function scanChatFileTreeRecentFilesInRoots(
  roots: readonly string[],
  listWorkspaceDirectory: ListWorkspaceDirectory,
  options: RecentScanOptions = {}
): Promise<WorkspaceEntry[]> {
  const limit = options.limit ?? RECENT_FILE_LIMIT
  const collected: WorkspaceEntry[] = []
  for (const root of roots) {
    if (options.isCancelled?.() || collected.length >= RECENT_SCAN_MAX_ENTRIES) break
    collected.push(...await scanChatFileTreeRecentFiles(root, listWorkspaceDirectory, {
      ...options,
      limit: RECENT_SCAN_MAX_ENTRIES
    }))
  }
  return sortRecentFiles(collected).slice(0, limit)
}

export function isChatFileTreeIgnoredDirectory(name: string): boolean {
  return IGNORED_DIRS.has(name.toLowerCase())
}

export function isChatFileTreePreviewableEntry(entry: WorkspaceEntry): boolean {
  return entry.type === 'file' && isWorkspacePreviewPath(entry.path || entry.name)
}

export function formatChatFileTreeUnsupportedMessage(name: string): string {
  return `${name} does not have an in-app preview.`
}

export function chatFileTreeEntryMatchesQuery(
  entry: WorkspaceEntry,
  workspaceRoot: string,
  query: string
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return true
  const relativePath = relativeWorkspacePath(entry.path, workspaceRoot).toLocaleLowerCase()
  return entry.name.toLocaleLowerCase().includes(normalizedQuery) || relativePath.includes(normalizedQuery)
}
