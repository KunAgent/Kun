import { useEffect, useRef } from 'react'
import { workspaceRootIdentityKey } from '../../lib/workspace-path'
import {
  threadPageMode,
  type WorkspaceThreadPageMeta
} from '../../store/chat-store-thread-pagination'
import { isSidebarWorkspaceCollapsed, type SidebarCollapseRegistry } from './sidebar-collapse'
import type { SidebarWorkspaceGroup } from './sidebar-project-selectors'
import type { SidebarThreadListStatus } from './SidebarProjectsContent'

type SidebarWorkspaceAutoLoadOptions = {
  displayGroups: SidebarWorkspaceGroup[]
  sidebarCollapse: SidebarCollapseRegistry
  showArchived: boolean
  searchQuery: string
  runtimeReady: boolean
  threadListStatus: SidebarThreadListStatus
  threadListCursorByWorkspace: Record<string, WorkspaceThreadPageMeta>
  onLoadMoreThreads: (workspacePath: string) => void
}

/** Loads a project's first page when its expanded sidebar group has no local threads. */
export function useSidebarWorkspaceAutoLoad({
  displayGroups,
  sidebarCollapse,
  showArchived,
  searchQuery,
  runtimeReady,
  threadListStatus,
  threadListCursorByWorkspace,
  onLoadMoreThreads
}: SidebarWorkspaceAutoLoadOptions): void {
  const attempted = useRef(new Set<string>())
  const mode = threadPageMode(showArchived)
  const groupKey = displayGroups.map(([workspacePath, threads]) =>
    `${workspacePath}\u0000${threads.length}`
  ).join('\n')

  useEffect(() => {
    const activeAttempts = new Set<string>()
    const ready = threadListStatus === 'ready' || threadListStatus === 'refreshing'
    if (runtimeReady && ready && !searchQuery.trim()) {
      for (const [workspacePath, threads] of displayGroups) {
        if (threads.length > 0 || isSidebarWorkspaceCollapsed(sidebarCollapse, workspacePath)) continue
        const workspaceKey = workspaceRootIdentityKey(workspacePath)
        if (!workspaceKey) continue
        const attemptKey = `${workspaceKey}:${mode}`
        activeAttempts.add(attemptKey)
        const page = threadListCursorByWorkspace[workspaceKey]
        if (page?.mode !== mode || page.status !== 'unknown' || attempted.current.has(attemptKey)) continue
        attempted.current.add(attemptKey)
        onLoadMoreThreads(workspacePath)
      }
    }
    for (const key of attempted.current) {
      if (!activeAttempts.has(key)) attempted.current.delete(key)
    }
  }, [
    displayGroups,
    groupKey,
    mode,
    onLoadMoreThreads,
    runtimeReady,
    searchQuery,
    sidebarCollapse,
    threadListCursorByWorkspace,
    threadListStatus
  ])
}
