import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useNodeGraphEnabled } from '../../node-graph/use-node-graph-enabled'
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
  enabled: boolean
  targets: readonly WikilinkTarget[]
  /** True while a scan is in flight, so the menu can say so. */
  scanning: boolean
  /** Last scan failure. Surfaced rather than swallowed. */
  error: string | null
  /** True when limits or unreadable folders made the last scan incomplete. */
  truncated: boolean
  /** Scans on first use; repeat calls while a scan is in flight are ignored. */
  request: () => void
  /** Discards the cache so the next request rescans. */
  invalidate: () => void
}

const EMPTY_TARGETS: readonly WikilinkTarget[] = []

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
  const enabled = useNodeGraphEnabled()
  const workspaceRoots = useWriteWorkspaceStore((state) => state.workspaceRoots)
  const snapshot = useSyncExternalStore(subscribeWikilinkTargets, getWikilinkTargetsSnapshot)

  const roots = useMemo<WikilinkScanRoot[]>(
    () => workspaceRoots.map((root) => ({ root, name: workspaceName(root) })),
    [workspaceRoots]
  )

  const request = useCallback(() => {
    if (!enabled) return
    const api = window.kunGui
    requestWikilinkTargets(
      roots,
      typeof api?.listWorkspaceDirectory === 'function'
        ? (input) => api.listWorkspaceDirectory(input)
        : undefined
    )
  }, [enabled, roots])

  const invalidate = useCallback(() => {
    invalidateWikilinkTargets()
  }, [])

  return {
    enabled,
    targets: enabled ? snapshot.targets : EMPTY_TARGETS,
    scanning: enabled && snapshot.scanning,
    error: enabled ? snapshot.error : null,
    truncated: enabled && snapshot.truncated,
    request,
    invalidate
  }
}
