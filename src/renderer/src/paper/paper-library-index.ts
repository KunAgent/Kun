import { create } from 'zustand'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import { normalizePath } from '../write/write-workspace-store-helpers'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { usePaperModeStore } from './paper-mode-store'

/**
 * Multi-library sidebar index. The editor only mounts `activeLibrary`, but the
 * sidebar shows every configured workspace at once — this store caches one
 * index slice per normalized library root and scans non-active roots lazily
 * (expanded roots only, a few at a time). Results are generation-checked so a
 * late response can never overwrite fresher data.
 */

export type PaperLibraryCounts = {
  total: number
  unread: number
  reading: number
  read: number
  missingPdf: number
}

export type PaperLibraryIndexSlice = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  entries: PaperLibraryEntry[]
  groups: string[]
  counts: PaperLibraryCounts
  error: string | null
  /** Invalidation generation this data was scanned for. */
  generation: number
}

export type PaperLibraryIndexRequest = {
  /** Ordered normalized roots shown in the sidebar. */
  roots: readonly string[]
  /** Roots whose trees are currently expanded. */
  expanded: ReadonlySet<string>
  /** Mounted library root — indexed by the workspace, skipped here. */
  activeRoot: string
  papersDir: string
}

const MAX_CONCURRENT_SCANS = 2

export const EMPTY_LIBRARY_COUNTS: PaperLibraryCounts = {
  total: 0,
  unread: 0,
  reading: 0,
  read: 0,
  missingPdf: 0
}

export const EMPTY_LIBRARY_SLICE: PaperLibraryIndexSlice = {
  status: 'idle',
  entries: [],
  groups: [],
  counts: EMPTY_LIBRARY_COUNTS,
  error: null,
  generation: -1
}

type IndexState = {
  byRoot: Record<string, PaperLibraryIndexSlice>
  invalidations: Record<string, number>
}

export const usePaperLibraryIndexStore = create<IndexState>(() => ({
  byRoot: {},
  invalidations: {}
}))

/** Root -> invalidation generation its in-flight scan was started for. */
const inflight = new Map<string, number>()
let lastRequest: PaperLibraryIndexRequest | null = null

function generationOf(root: string): number {
  return usePaperLibraryIndexStore.getState().invalidations[root] ?? 0
}

function setSlice(root: string, build: (prev: PaperLibraryIndexSlice) => PaperLibraryIndexSlice): void {
  usePaperLibraryIndexStore.setState((state) => ({
    byRoot: {
      ...state.byRoot,
      [root]: build(state.byRoot[root] ?? EMPTY_LIBRARY_SLICE)
    }
  }))
}

/** Bump the invalidation generation for one root (or all when omitted). */
export function invalidatePaperLibraryIndex(libraryRoot?: string): void {
  const normalized = normalizePath(libraryRoot ?? '')
  usePaperLibraryIndexStore.setState((state) => {
    const invalidations = { ...state.invalidations }
    if (normalized) {
      invalidations[normalized] = (invalidations[normalized] ?? 0) + 1
    } else {
      for (const root of new Set([...Object.keys(invalidations), ...Object.keys(state.byRoot), ...inflight.keys()])) {
        invalidations[root] = (invalidations[root] ?? 0) + 1
      }
    }
    return { invalidations }
  })
  reensure()
}

/**
 * Refresh whichever index owns this root: the mounted library rescans through
 * the workspace refresh token, other libraries go through this sidebar index.
 */
export function refreshPaperLibrary(libraryRoot: string): void {
  const root = normalizePath(libraryRoot)
  if (!root) return
  if (root === normalizePath(useWriteWorkspaceStore.getState().workspaceRoot)) {
    usePaperModeStore.getState().refreshEntries()
  } else {
    invalidatePaperLibraryIndex(root)
  }
}

/** Ordered, normalized, deduplicated roots for the workspace list. */
export function normalizeLibraryRoots(libraries: readonly string[]): string[] {
  const seen = new Set<string>()
  const roots: string[] = []
  for (const item of libraries) {
    const normalized = normalizePath(item)
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized)
      roots.push(normalized)
    }
  }
  return roots
}

/** Kick off scans for expanded roots that are missing fresh data. */
export function ensurePaperLibraryIndexes(request: PaperLibraryIndexRequest): void {
  lastRequest = request
  const wanted = new Set(request.roots)

  // Prune slices of libraries that were removed from settings. Threads and
  // files on disk are untouched; this only drops the cached index.
  const stale = Object.keys(usePaperLibraryIndexStore.getState().byRoot).filter(
    (root) => !wanted.has(root)
  )
  if (stale.length > 0) {
    usePaperLibraryIndexStore.setState((state) => {
      const byRoot = { ...state.byRoot }
      for (const root of stale) delete byRoot[root]
      return { byRoot }
    })
  }

  const pending: string[] = []
  for (const root of request.roots) {
    if (!request.expanded.has(root) || root === request.activeRoot) continue
    if (inflight.has(root)) continue
    const generation = generationOf(root)
    const slice = usePaperLibraryIndexStore.getState().byRoot[root]
    if (slice && slice.generation === generation && slice.status !== 'idle') continue
    pending.push(root)
  }

  const slots = Math.max(0, MAX_CONCURRENT_SCANS - inflight.size)
  for (const root of pending.slice(0, slots)) {
    void scanRoot(root, request.papersDir)
  }
}

async function scanRoot(root: string, papersDir: string): Promise<void> {
  const generation = generationOf(root)
  inflight.set(root, generation)
  setSlice(root, (prev) => ({ ...prev, status: 'loading', generation, error: null }))

  try {
    if (typeof window.kunGui?.paperLibraryList !== 'function') {
      throw new Error('paper-library-list-unavailable')
    }
    const result = await window.kunGui.paperLibraryList({ workspaceRoot: root, papersDir })
    inflight.delete(root)
    // A newer invalidation superseded this scan while it was in flight; drop
    // the result and let the next pass rescan.
    if (generationOf(root) !== generation) return reensure()
    if (result.ok) {
      setSlice(root, () => ({
        status: 'ready',
        generation,
        entries: result.entries,
        groups: result.groups,
        counts: result.counts,
        error: null
      }))
    } else {
      setSlice(root, (prev) => ({ ...prev, status: 'error', error: result.message }))
    }
  } catch (error) {
    inflight.delete(root)
    if (generationOf(root) !== generation) return reensure()
    setSlice(root, (prev) => ({
      ...prev,
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    }))
  }
  reensure()
}

function reensure(): void {
  if (lastRequest) ensurePaperLibraryIndexes(lastRequest)
}
