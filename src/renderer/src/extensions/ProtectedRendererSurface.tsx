import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import type { ProtectedSurfaceKind } from './content-script-planner'
import {
  clearProtectedSurfaceRestore,
  markProtectedSurfaceRestore,
  type ProtectedSurfaceRestoreTarget
} from './protected-surface-session'

/**
 * Keeps credential/policy DOM unmounted until Main confirms that this document
 * has no active Direct DOM principal. If arbitrary script effects require a
 * clean reload, the target is restored from session storage after that reload.
 */
export function ProtectedRendererSurface({
  kind,
  restoreTarget,
  fallback,
  children
}: {
  kind: ProtectedSurfaceKind
  restoreTarget: ProtectedSurfaceRestoreTarget
  fallback: ReactNode
  children: ReactNode
}): ReactElement {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // A Remote browser has no Direct DOM extension principal to isolate from,
    // and the host-only extensionSyncHostContentScripts IPC does not exist
    // there — waiting on it would fail closed and show the fallback forever.
    if (window.kunGui?.isRemoteWeb === true) {
      clearProtectedSurfaceRestore(restoreTarget)
      setReady(true)
      return undefined
    }
    let cancelled = false
    setReady(false)
    // Remote browser clients have no Electron content-script channel, so the
    // isolation handshake can never complete — render children instead of an
    // endless fallback.
    if (window.kunGui?.isRemoteWeb === true
      || typeof window.kunGui?.extensionSyncHostContentScripts !== 'function') {
      clearProtectedSurfaceRestore(restoreTarget)
      setReady(true)
      return () => { cancelled = true }
    }
    markProtectedSurfaceRestore(restoreTarget)
    void window.kunGui.extensionSyncHostContentScripts({
      surface: null,
      protectedSurface: kind,
      descriptors: []
    }).then((result) => {
      if (cancelled || result.reloadScheduled) return
      if (result.ok || result.code === 'EXTENSION_PROTECTED_SURFACE_DENIED') {
        clearProtectedSurfaceRestore(restoreTarget)
        setReady(true)
      }
    }).catch((error) => {
      // Fail closed: the protected children remain unmounted.
      void window.kunGui?.logError?.('protected-surface', 'Failed to isolate protected renderer surface', {
        kind,
        message: error instanceof Error ? error.message : String(error)
      }).catch(() => undefined)
    })
    return () => {
      cancelled = true
    }
  }, [kind, restoreTarget])

  return <>{ready ? children : fallback}</>
}
