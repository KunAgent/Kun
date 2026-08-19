import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWriteWorkspaceStore } from '../write-workspace-store'
import { scanAllWorkspaceMarkdown, type WikilinkScanRoot } from './wikilink-scan'
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
 * The scan costs one directory IPC call per folder, so it is deferred until the
 * menu is actually opened and then cached until the workspace list changes.
 */
export function useWikilinkTargets(): WikilinkTargetsHandle {
  const workspaceRoots = useWriteWorkspaceStore((state) => state.workspaceRoots)
  const [targets, setTargets] = useState<readonly WikilinkTarget[]>([])
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scanningRef = useRef(false)
  const scannedKeyRef = useRef('')

  const roots = useMemo<WikilinkScanRoot[]>(
    () => workspaceRoots.map((root) => ({ root, name: workspaceName(root) })),
    [workspaceRoots]
  )
  const rootsKey = useMemo(() => roots.map((entry) => entry.root).join(' '), [roots])

  const invalidate = useCallback(() => {
    scannedKeyRef.current = ''
    setTargets([])
    setError(null)
  }, [])

  // A workspace added or removed invalidates the cache; the next open rescans.
  useEffect(() => {
    invalidate()
  }, [invalidate, rootsKey])

  const request = useCallback(() => {
    if (scanningRef.current || scannedKeyRef.current === rootsKey) return
    const api = window.kunGui
    if (typeof api?.listWorkspaceDirectory !== 'function') {
      setError('workspace listing is unavailable')
      return
    }
    if (roots.length === 0) {
      setError('no Work workspace is open')
      return
    }
    scanningRef.current = true
    setScanning(true)
    setError(null)
    void scanAllWorkspaceMarkdown(roots, (input) => api.listWorkspaceDirectory(input))
      .then((found) => {
        scannedKeyRef.current = rootsKey
        setTargets(found)
      })
      .catch((scanError: unknown) => {
        // Swallowing this made a broken scan look identical to an empty vault.
        setError(scanError instanceof Error ? scanError.message : String(scanError))
      })
      .finally(() => {
        scanningRef.current = false
        setScanning(false)
      })
  }, [roots, rootsKey])

  // Scan as soon as an editor mounts, so the list is usually ready before the
  // first `[[` rather than arriving after it.
  useEffect(() => {
    request()
  }, [request])

  return { targets, scanning, error, request, invalidate }
}
