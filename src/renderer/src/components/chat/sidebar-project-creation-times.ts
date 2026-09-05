import { useEffect, useState } from 'react'
import type { WorkspaceCreationTimeEntry } from '@shared/kun-gui-api'
import { normalizeWorkspaceRoot, workspaceRootIdentityKey } from '../../lib/workspace-path'
import type { SidebarWorkspaceCreationTimes } from './sidebar-project-selectors'
import { firstSeenTimesFor } from './sidebar-project-first-seen'

/**
 * Dedupes workspace paths by identity key while keeping the first seen real
 * path, then serializes the identity keys as a stable effect dependency.
 */
export function sidebarWorkspaceCreationTimesKey(workspacePaths: readonly string[]): string {
  const keys = new Set<string>()
  for (const workspacePath of workspacePaths) {
    const key = workspaceRootIdentityKey(normalizeWorkspaceRoot(workspacePath))
    if (key) keys.add(key)
  }
  return [...keys].sort().join('\n')
}

export function sidebarWorkspaceCreationTimesFromEntries(
  entries: readonly WorkspaceCreationTimeEntry[]
): SidebarWorkspaceCreationTimes {
  const result: SidebarWorkspaceCreationTimes = {}
  for (const entry of entries) {
    const key = workspaceRootIdentityKey(normalizeWorkspaceRoot(entry.path))
    const createdAtMs = entry.createdAtMs
    if (!key || typeof createdAtMs !== 'number' || !Number.isFinite(createdAtMs) || createdAtMs <= 0) {
      continue
    }
    result[key] = createdAtMs
  }
  return result
}

/**
 * Loads folder creation times for the sidebar project list (newest-first
 * ordering). Stat calls happen in the main process; the map stays stale (not
 * reset) while a new path set is being fetched so the list does not reshuffle
 * twice.
 */
export function useSidebarWorkspaceCreationTimes(
  workspacePaths: readonly string[]
): SidebarWorkspaceCreationTimes {
  const pathsKey = sidebarWorkspaceCreationTimesKey(workspacePaths)
  const [creationTimes, setCreationTimes] = useState<SidebarWorkspaceCreationTimes>({})

  useEffect(() => {
    if (typeof window === 'undefined') return
    const read = window.kunGui?.getWorkspaceCreationTimes
    if (typeof read !== 'function' || !pathsKey) return
    // Stat the real (case-preserving) paths; identity keys are lowercased and
    // can point at a non-existent spelling on case-sensitive filesystems.
    const uniquePaths = new Map<string, string>()
    for (const workspacePath of workspacePaths) {
      const normalized = normalizeWorkspaceRoot(workspacePath)
      const key = workspaceRootIdentityKey(normalized)
      if (key && !uniquePaths.has(key)) uniquePaths.set(key, normalized)
    }
    let cancelled = false
    void read([...uniquePaths.values()]).then((entries) => {
      if (cancelled) return
      const seedTimes = sidebarWorkspaceCreationTimesFromEntries(entries)
      setCreationTimes(firstSeenTimesFor(Object.keys(seedTimes), seedTimes))
    }).catch(() => {
      // Ordering falls back to the legacy active-first/name comparator.
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pathsKey serializes workspacePaths
  }, [pathsKey])

  return creationTimes
}
