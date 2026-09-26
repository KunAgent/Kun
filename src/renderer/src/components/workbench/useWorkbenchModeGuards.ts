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
  adeEnabled,
  adeSettingsLoaded,
  setRoute,
  refreshAdeThreads
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
    // ADE 关闭时回到 Code;已有 ADE 线程在服务端保留,不在 Code 列表出现。
    if (adeSettingsLoaded && !adeEnabled && route === 'ade') setRoute('chat')
    // ADE 清单独立刷新:进入 ADE 路由且开关开启时才拉取 workspace_mode=ade。
    if (route === 'ade' && adeEnabled && runtimeConnection === 'ready') void refreshAdeThreads()
    runtimeConnectionRef.current = runtimeConnection
  }, [
    projectBoardEnabled, projectBoardSettingsLoaded, adeEnabled, adeSettingsLoaded,
    refreshAdeThreads, route, runtimeConnection, routeRef, runtimeConnectionRef, setRoute
  ])
}
