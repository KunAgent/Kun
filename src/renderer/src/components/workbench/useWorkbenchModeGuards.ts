import { useEffect, type MutableRefObject } from 'react'
import type { RuntimeConnectionStatus } from '../../agent/types'
import type { AppRoute } from '../../store/chat-store'

/**
 * Lab-flag and route guards shared by the workbench shell: a disabled feature
 * route falls back to Code, and entering ADE refreshes its own inventory.
 */
export function useWorkbenchModeGuards({
  routeRef,
  runtimeConnectionRef,
  route,
  runtimeConnection,
  projectBoardEnabled,
  projectBoardSettingsLoaded,
  setRoute,
}: {
  routeRef: MutableRefObject<string>
  runtimeConnectionRef: MutableRefObject<RuntimeConnectionStatus>
  route: AppRoute
  runtimeConnection: RuntimeConnectionStatus
  projectBoardEnabled: boolean
  projectBoardSettingsLoaded: boolean
  adeEnabled: boolean
  adeSettingsLoaded: boolean
  setRoute: (route: AppRoute) => void
  refreshAdeThreads: () => Promise<void>
}): void {
  useEffect(() => {
    routeRef.current = route
    if (projectBoardSettingsLoaded && !projectBoardEnabled && route === 'board') setRoute('chat')
    // Historical ADE links enter the same Code workbench. Refresh its unified
    // inventory through the ordinary Code path; the old separate catalog is
    // retained only for compatibility while existing clients still use it.
    if (route === 'ade') setRoute('chat')
    runtimeConnectionRef.current = runtimeConnection
  }, [
    projectBoardEnabled, projectBoardSettingsLoaded,
    route, runtimeConnection, routeRef, runtimeConnectionRef, setRoute
  ])
}
