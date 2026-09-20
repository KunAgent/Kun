import type { WorkspaceEntry } from '@shared/workspace-file'
import {
  composerFileReferenceKey,
  isFileWithinDirectory,
  relativeWorkspacePath,
  type ComposerFileReference
} from './composer-file-references'
import { designDocumentComposerFileReferences } from '../design/design-document-file-reference'

const FILE_MENTION_TEXT_EXTENSIONS = new Set([
  '.astro',
  '.bash',
  '.c',
  '.cc',
  '.cjs',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.dart',
  '.env',
  '.fish',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.less',
  '.lock',
  '.log',
  '.md',
  '.mdx',
  '.mjs',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.sass',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh'
])
const FILE_MENTION_TEXT_NAMES = new Set([
  '.env',
  '.gitignore',
  'dockerfile',
  'makefile',
  'package-lock.json',
  'pnpm-lock.yaml',
  'readme'
])
const FILE_MENTION_IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out'
])
const FILE_MENTION_MAX_DEPTH = 10  /* #340: increased from 6 for deep paths */
const FILE_MENTION_MAX_DIRECTORIES = 200
const FILE_MENTION_MAX_FILES = 1600
const FILE_MENTION_MAX_DIRECTORY_SUGGESTIONS = 400
const FILE_MENTION_CACHE_TTL_MS = 30_000
export const MAX_WORKSPACE_FILE_INDEX_CACHE_ENTRIES = 16
export const MAX_WORKSPACE_MENTION_DIRECTORY_CACHE_ENTRIES = 128
const DESIGN_DOCUMENTS_INDEX_PATH = '.kun-design/documents.json'

export type WorkspaceFileIndex = {
  files: ComposerFileReference[]
  directories: ComposerFileReference[]
  loadedAt: number
}

const workspaceFileIndexCache = new Map<string, WorkspaceFileIndex | Promise<WorkspaceFileIndex>>()

function trimCache<T>(cache: Map<string, T>, maxEntries: number, protectedKey?: string): void {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value
    if (!oldestKey) return
    if (oldestKey === protectedKey) {
      const protectedValue = cache.get(oldestKey)
      cache.delete(oldestKey)
      if (protectedValue !== undefined) cache.set(oldestKey, protectedValue)
      continue
    }
    cache.delete(oldestKey)
  }
}

function pruneWorkspaceFileIndexCache(now = Date.now()): void {
  for (const [key, value] of workspaceFileIndexCache) {
    if (!(value instanceof Promise) && now - value.loadedAt >= FILE_MENTION_CACHE_TTL_MS) {
      workspaceFileIndexCache.delete(key)
    }
  }
  trimCache(workspaceFileIndexCache, MAX_WORKSPACE_FILE_INDEX_CACHE_ENTRIES)
}

type DesignDocumentIndexJson = {
  id?: unknown
  title?: unknown
  order?: unknown
  createdAt?: unknown
}

function normalizePathFragment(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
}

function parseDesignDocumentDirectoryReferences(raw: string, workspaceRoot: string): ComposerFileReference[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const documents = (parsed as { documents?: unknown }).documents
  if (!Array.isArray(documents)) return []
  const normalized = documents
    .map((entry, fallbackOrder) => {
      if (!entry || typeof entry !== 'object') return null
      const source = entry as DesignDocumentIndexJson
      if (typeof source.id !== 'string') return null
      const id = normalizePathFragment(source.id)
      if (!id || id.includes('/')) return null
      const title = typeof source.title === 'string' && source.title.trim() ? source.title.trim() : id
      const order = typeof source.order === 'number' && Number.isFinite(source.order) ? source.order : fallbackOrder
      const createdAt = typeof source.createdAt === 'string' ? source.createdAt : ''
      return { id, title, order, createdAt }
    })
    .filter((entry): entry is { id: string; title: string; order: number; createdAt: string } => entry !== null)
    .sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt))
  return designDocumentComposerFileReferences(normalized, workspaceRoot)
}

async function loadDesignDocumentDirectoryReferences(workspaceRoot: string): Promise<ComposerFileReference[]> {
  if (typeof window.kunGui?.readWorkspaceFile !== 'function') return []
  const result = await window.kunGui
    .readWorkspaceFile({ workspaceRoot, path: DESIGN_DOCUMENTS_INDEX_PATH })
    .catch(() => null)
  return result && result.ok ? parseDesignDocumentDirectoryReferences(result.content, workspaceRoot) : []
}

export function isMentionableWorkspaceFile(entry: WorkspaceEntry): boolean {
  if (entry.type !== 'file') return false
  const name = entry.name.toLowerCase()
  if (FILE_MENTION_TEXT_NAMES.has(name)) return true
  if (!entry.ext) return false
  return FILE_MENTION_TEXT_EXTENSIONS.has(entry.ext.toLowerCase())
}

function referenceFromEntry(
  entry: WorkspaceEntry,
  workspaceRoot: string,
  type: 'file' | 'directory'
): ComposerFileReference {
  return {
    path: entry.path,
    relativePath: relativeWorkspacePath(entry.path, workspaceRoot),
    name: entry.name,
    type,
    workspaceRoot
  }
}

async function buildWorkspaceFileIndex(root: string): Promise<WorkspaceFileIndex> {
  const files: ComposerFileReference[] = []
  const directories: ComposerFileReference[] = []
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }]
  let visitedDirectories = 0

  while (
    queue.length > 0 &&
    visitedDirectories < FILE_MENTION_MAX_DIRECTORIES &&
    files.length < FILE_MENTION_MAX_FILES
  ) {
    const current = queue.shift()
    if (!current) break
    visitedDirectories += 1
    const result = await window.kunGui.listWorkspaceDirectory({ workspaceRoot: root, path: current.path })
    if (!result.ok) continue

    for (const entry of result.entries) {
      if (entry.type === 'directory') {
        if (FILE_MENTION_IGNORED_DIRS.has(entry.name.toLowerCase())) continue
        if (directories.length < FILE_MENTION_MAX_DIRECTORY_SUGGESTIONS) {
          directories.push(referenceFromEntry(entry, root, 'directory'))
        }
        if (current.depth < FILE_MENTION_MAX_DEPTH) {
          queue.push({ path: entry.path, depth: current.depth + 1 })
        }
        continue
      }
      if (isMentionableWorkspaceFile(entry)) {
        files.push(referenceFromEntry(entry, root, 'file'))
        if (files.length >= FILE_MENTION_MAX_FILES) break
      }
    }
  }

  const designDocumentDirectories = await loadDesignDocumentDirectoryReferences(root)
  return {
    files,
    directories: mergeMentionCandidates(designDocumentDirectories, directories),
    loadedAt: Date.now()
  }
}

export async function loadWorkspaceFileIndex(workspaceRoot: string): Promise<WorkspaceFileIndex> {
  const root = workspaceRoot.trim()
  pruneWorkspaceFileIndexCache()
  const cached = workspaceFileIndexCache.get(root)
  if (cached && !(cached instanceof Promise) && Date.now() - cached.loadedAt < FILE_MENTION_CACHE_TTL_MS) {
    workspaceFileIndexCache.delete(root)
    workspaceFileIndexCache.set(root, cached)
    return cached
  }
  if (cached instanceof Promise) return cached

  const task = buildWorkspaceFileIndex(root)
  workspaceFileIndexCache.set(root, task)
  trimCache(workspaceFileIndexCache, MAX_WORKSPACE_FILE_INDEX_CACHE_ENTRIES, root)
  try {
    const result = await task
    workspaceFileIndexCache.delete(root)
    workspaceFileIndexCache.set(root, result)
    trimCache(workspaceFileIndexCache, MAX_WORKSPACE_FILE_INDEX_CACHE_ENTRIES, root)
    return result
  } catch (error) {
    workspaceFileIndexCache.delete(root)
    throw error
  }
}

/** All indexed files that live inside the given workspace-relative directory. */
export function filesUnderDirectory(
  files: ComposerFileReference[],
  dirRelativePath: string
): ComposerFileReference[] {
  return files.filter((file) => isFileWithinDirectory(file.relativePath, dirRelativePath))
}

export async function loadWorkspaceDirectoryContextFiles(
  workspaceRoot: string,
  dirRelativePath: string,
  limit: number
): Promise<ComposerFileReference[]> {
  const root = workspaceRoot.trim()
  const maxFiles = Math.max(0, Math.floor(limit))
  if (!root || maxFiles <= 0 || typeof window.kunGui?.listWorkspaceDirectory !== 'function') return []

  const files: ComposerFileReference[] = []
  const queue: Array<{ path: string; depth: number }> = [
    { path: normalizePathFragment(dirRelativePath), depth: 0 }
  ]
  const seenDirectories = new Set<string>()

  while (
    queue.length > 0 &&
    seenDirectories.size < FILE_MENTION_MAX_DIRECTORIES &&
    files.length < maxFiles
  ) {
    const current = queue.shift()
    if (!current) break
    const currentPath = current.path || root
    const key = currentPath.toLowerCase()
    if (seenDirectories.has(key)) continue
    seenDirectories.add(key)

    const result = await window.kunGui
      .listWorkspaceDirectory({ workspaceRoot: root, path: currentPath })
      .catch(() => null)
    if (!result || !result.ok) continue

    for (const entry of result.entries) {
      if (entry.type === 'directory') {
        if (FILE_MENTION_IGNORED_DIRS.has(entry.name.toLowerCase())) continue
        if (current.depth < FILE_MENTION_MAX_DEPTH) {
          queue.push({
            path: relativeWorkspacePath(entry.path, root),
            depth: current.depth + 1
          })
        }
        continue
      }
      if (!isMentionableWorkspaceFile(entry)) continue
      files.push(referenceFromEntry(entry, root, 'file'))
      if (files.length >= maxFiles) break
    }
  }

  return files
}

const workspaceMentionDirectoryCache = new Map<
  string,
  ComposerFileReference[] | Promise<ComposerFileReference[]>
>()

/** Directory portion of a path-like @-mention query (`src/a/b/file` → `src/a/b`). */
export function mentionQueryDirectory(query: string): string | null {
  const normalized = query.replaceAll('\\', '/').replace(/\/+/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash < 0) return null
  return normalized.slice(0, lastSlash)
}

/**
 * Resolve the directory a path-like @-mention points at, on demand. The cached
 * BFS index ([[buildWorkspaceFileIndex]]) is bounded by depth/dir/file caps, so
 * a file in a deep or wide tree may never be indexed. When the user types a
 * path (`@src/a/b/c/deep.ts`) we list exactly that directory through the
 * existing workspace IPC so the file shows up regardless of how deep it sits
 * (issue #340). Returns [] for name-only queries — the index covers those.
 */
export async function loadWorkspaceMentionPathSuggestions(
  workspaceRoot: string,
  query: string
): Promise<ComposerFileReference[]> {
  const root = workspaceRoot.trim()
  if (!root) return []
  const dir = mentionQueryDirectory(query)
  if (dir == null) return []

  const cacheKey = `${root}::${dir}`
  const cached = workspaceMentionDirectoryCache.get(cacheKey)
  if (cached) {
    workspaceMentionDirectoryCache.delete(cacheKey)
    workspaceMentionDirectoryCache.set(cacheKey, cached)
    return cached
  }

  const task = (async () => {
    const result = await window.kunGui.listWorkspaceDirectory({ workspaceRoot: root, path: dir })
    if (!result.ok) return []
    const references: ComposerFileReference[] = []
    for (const entry of result.entries) {
      if (entry.type === 'directory') {
        if (FILE_MENTION_IGNORED_DIRS.has(entry.name.toLowerCase())) continue
        references.push(referenceFromEntry(entry, root, 'directory'))
      } else if (isMentionableWorkspaceFile(entry)) {
        references.push(referenceFromEntry(entry, root, 'file'))
      }
    }
    return references
  })()

  workspaceMentionDirectoryCache.set(cacheKey, task)
  trimCache(
    workspaceMentionDirectoryCache,
    MAX_WORKSPACE_MENTION_DIRECTORY_CACHE_ENTRIES,
    cacheKey
  )
  try {
    const references = await task
    workspaceMentionDirectoryCache.delete(cacheKey)
    workspaceMentionDirectoryCache.set(cacheKey, references)
    trimCache(
      workspaceMentionDirectoryCache,
      MAX_WORKSPACE_MENTION_DIRECTORY_CACHE_ENTRIES,
      cacheKey
    )
    // Bound the cache; deep typing can touch many directories.
    setTimeout(() => {
      if (workspaceMentionDirectoryCache.get(cacheKey) === references) {
        workspaceMentionDirectoryCache.delete(cacheKey)
      }
    }, FILE_MENTION_CACHE_TTL_MS)
    return references
  } catch (error) {
    workspaceMentionDirectoryCache.delete(cacheKey)
    throw error
  }
}

export function clearWorkspaceFileIndexCaches(): void {
  workspaceFileIndexCache.clear()
  workspaceMentionDirectoryCache.clear()
}

export function workspaceFileIndexCacheSizes(): { indexes: number; mentionDirectories: number } {
  return {
    indexes: workspaceFileIndexCache.size,
    mentionDirectories: workspaceMentionDirectoryCache.size
  }
}

/** Merge on-demand path suggestions into the indexed candidates, de-duped by path. */
export function mergeMentionCandidates(
  base: ComposerFileReference[],
  extra: ComposerFileReference[]
): ComposerFileReference[] {
  if (extra.length === 0) return base
  const seen = new Set(base.map(composerFileReferenceKey))
  const merged = [...base]
  for (const reference of extra) {
    const key = composerFileReferenceKey(reference)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(reference)
  }
  return merged
}
