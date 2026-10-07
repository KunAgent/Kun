import { useEffect, useMemo } from 'react'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { normalizePath } from '../../../write/write-workspace-store-helpers'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import {
  EMPTY_LIBRARY_SLICE,
  ensurePaperLibraryIndexes,
  normalizeLibraryRoots,
  usePaperLibraryIndexStore,
  type PaperLibraryIndexSlice
} from '../../../paper/paper-library-index'

export type PaperSidebarLibraries = {
  /** Ordered normalized roots, matching `write.paperMode.libraries`. */
  roots: string[]
  /** Normalized mounted library root — '' while no library is mounted. */
  activeRoot: string
  /** Index slice per root; the active root mirrors `usePaperModeStore`. */
  byRoot: Record<string, PaperLibraryIndexSlice>
}

/**
 * Sidebar index for every configured library. The mounted root's slice is
 * synthesized from `usePaperModeStore` (the workspace scan); the other roots
 * are scanned lazily through `paper-library-index` only while expanded.
 */
export function usePaperSidebarLibraries(collapsed: ReadonlySet<string>): PaperSidebarLibraries {
  const libraries = useWriteWorkspaceStore((s) => s.paperMode.libraries)
  const papersDir = useWriteWorkspaceStore((s) => s.paperReading.papersDir)
  // Only a mounted papers surface owns a live index; on the documents surface
  // every library is scanned lazily like any other non-active root.
  const workspaceRoot = useWriteWorkspaceStore((s) => s.workSurface === 'papers' ? s.workspaceRoot : '')
  const activeEntries = usePaperModeStore((s) => s.entries)
  const activeGroups = usePaperModeStore((s) => s.groups)
  const activeCounts = usePaperModeStore((s) => s.counts)
  const activeLoading = usePaperModeStore((s) => s.entriesLoading)
  const activeError = usePaperModeStore((s) => s.entriesError)
  const refreshToken = usePaperModeStore((s) => s.entriesRefreshToken)
  const byRoot = usePaperLibraryIndexStore((s) => s.byRoot)
  const invalidations = usePaperLibraryIndexStore((s) => s.invalidations)

  const roots = useMemo(() => normalizeLibraryRoots(libraries), [libraries])
  const activeRoot = normalizePath(workspaceRoot)
  const expanded = useMemo(
    () => new Set(roots.filter((root) => !collapsed.has(root))),
    [roots, collapsed]
  )
  const rootsKey = roots.join('\n')
  const expandedKey = [...expanded].sort().join('\n')

  // `byRoot`/`invalidations` identities change on every index write; each
  // settle re-runs the scheduler so queued scans start as slots free up.
  useEffect(() => {
    ensurePaperLibraryIndexes({ roots, expanded, activeRoot, papersDir })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootsKey, expandedKey, activeRoot, papersDir, invalidations, byRoot, refreshToken])

  const merged = useMemo(() => {
    const out: Record<string, PaperLibraryIndexSlice> = {}
    for (const root of roots) {
      if (root === activeRoot) {
        out[root] = {
          status: activeLoading ? 'loading' : activeError ? 'error' : 'ready',
          entries: activeEntries,
          groups: activeGroups,
          counts: activeCounts,
          error: activeError,
          generation: -1
        }
      } else {
        out[root] = byRoot[root] ?? EMPTY_LIBRARY_SLICE
      }
    }
    return out
  }, [roots, activeRoot, byRoot, activeEntries, activeGroups, activeCounts, activeLoading, activeError])

  return { roots, activeRoot, byRoot: merged }
}
