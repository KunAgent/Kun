import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useWriteWorkspaceStore } from '../write-workspace-store'
import type { WikilinkScanRoot } from './wikilink-scan'
import {
  getWikilinkTargetsSnapshot,
  invalidateWikilinkTargets,
  requestWikilinkTargets,
  subscribeWikilinkTargets
} from './wikilink-target-service'
import { toPosix, type WikilinkTarget } from './wikilink-targets'

export type WikilinkTargetsHandle = {
  targets: readonly WikilinkTarget[]
  /** True while a scan is in flight, so the menu can say so. */
  scanning: boolean
  /** Last scan failure. Surfaced rather than swallowed. */
  error: string | null
  /** Scans on first use; repeat calls while a scan is in flight are ignored. */
  request: () => void
  /** Discards the cache so the next request rescans. */
  invalidate: () => void
}

function workspaceName(root: string): string {
  const normalized = toPosix(root).replace(/\/+$/, '')
  return normalized.slice(normalized.lastIndexOf('/') + 1) || normalized
}

/**
 * Markdown targets for the `[[` menu, across every Work workspace.
 *
 * A thin view over the shared target service: the scan is deferred until a
 * menu first asks for completions (`request()` fires from the menu's own
 * update, never from mount), and its cache is workspace-level, so any number
 * of mounted editors share one walk.
 */
export function useWikilinkTargets(): WikilinkTargetsHandle {
  const workspaceRoots = useWriteWorkspaceStore((state) => state.workspaceRoots)
  const snapshot = useSyncExternalStore(subscribeWikilinkTargets, getWikilinkTargetsSnapshot)

  const roots = useMemo<WikilinkScanRoot[]>(
    () => workspaceRoots.map((root) => ({ root, name: workspaceName(root) })),
    [workspaceRoots]
  )

  const request = useCallback(() => {
    const api = window.kunGui
    requestWikilinkTargets(
      roots,
      typeof api?.listWorkspaceDirectory === 'function'
        ? (input) => api.listWorkspaceDirectory(input)
        : undefined
    )
  }, [roots])

  const invalidate = useCallback(() => {
    invalidateWikilinkTargets()
  }, [])

  return {
    targets: snapshot.targets,
    scanning: snapshot.scanning,
    error: snapshot.error,
    request,
    invalidate
  }
}
