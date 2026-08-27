import type { Dispatch, DragEvent as ReactDragEvent, SetStateAction } from 'react'
import type { NormalizedThread } from '../../agent/types'
import { workspaceRootIdentityKey } from '../../lib/workspace-path'
import {
  SIDEBAR_THREAD_DRAG_DATA_KEY,
  SIDEBAR_WORKSPACE_DRAG_DATA_KEY,
  reconcileSidebarThreadOrder,
  reorderSidebarThreadIds,
  reorderSidebarWorkspacePaths,
  setSidebarThreadOrder,
  setSidebarWorkspaceOrder,
  sidebarDropPosition,
  sidebarThreadOrderScope,
  type SidebarDropPosition,
  type SidebarOrderRegistry
} from './sidebar-order'
import { setSidebarFolderCollapsed, type SidebarCollapseRegistry } from './sidebar-collapse'
import {
  moveThreadToSidebarFolder,
  sidebarFolderIdForThread,
  sidebarFoldersForWorkspace,
  type SidebarFolderRegistry
} from './sidebar-folders'
import {
  sidebarWorkspacePathForThread,
  worktreeRecordForSidebarThread,
  type SidebarThreadWorktrees,
  type SidebarWorkspaceGroup
} from './sidebar-project-selectors'
import type { SidebarThreadOrderTracker } from './sidebar-thread-order-tracker'

export type WorkspaceOrderDropTarget = {
  workspacePath: string
  position: SidebarDropPosition
}

export type ThreadOrderDropTarget = WorkspaceOrderDropTarget & {
  threadId: string
  folderId: string | null
}

export type FolderDropTarget = {
  workspacePath: string
  folderId: string
}

type Params = {
  threads: NormalizedThread[]
  allProjectGroups: SidebarWorkspaceGroup[]
  allThreadIdsByScope: Record<string, string[]>
  workspacePathsForOrder: string[]
  threadWorktrees: SidebarThreadWorktrees
  sidebarFolders: SidebarFolderRegistry
  sidebarOrder: SidebarOrderRegistry
  orderTracker: SidebarThreadOrderTracker
  deletingThreadIds: Record<string, boolean>
  draggingWorkspacePath: string | null
  draggingThreadId: string | null
  setDraggingWorkspacePath: Dispatch<SetStateAction<string | null>>
  setWorkspaceOrderDropTarget: Dispatch<SetStateAction<WorkspaceOrderDropTarget | null>>
  setDraggingThreadId: Dispatch<SetStateAction<string | null>>
  setThreadOrderDropTarget: Dispatch<SetStateAction<ThreadOrderDropTarget | null>>
  setDragOverWorkspace: Dispatch<SetStateAction<string | null>>
  setFolderDropTarget: Dispatch<SetStateAction<FolderDropTarget | null>>
  persistSidebarOrder: (update: (current: SidebarOrderRegistry) => SidebarOrderRegistry) => void
  persistSidebarFolders: (update: (current: SidebarFolderRegistry) => SidebarFolderRegistry) => void
  persistSidebarCollapse: (update: (current: SidebarCollapseRegistry) => SidebarCollapseRegistry) => void
  threadMoveDisabledReason: (thread: NormalizedThread, record?: ReturnType<typeof worktreeRecordForSidebarThread>) => string
  moveTargetsForThread: (thread: NormalizedThread) => string[]
  confirmThreadWorkspaceMove: (
    thread: NormalizedThread,
    workspacePath: string,
    record?: ReturnType<typeof worktreeRecordForSidebarThread>
  ) => void
}

export function createSidebarProjectDragActions({
  threads,
  allProjectGroups,
  allThreadIdsByScope,
  workspacePathsForOrder,
  threadWorktrees,
  sidebarFolders,
  sidebarOrder,
  orderTracker,
  deletingThreadIds,
  draggingWorkspacePath,
  draggingThreadId,
  setDraggingWorkspacePath,
  setWorkspaceOrderDropTarget,
  setDraggingThreadId,
  setThreadOrderDropTarget,
  setDragOverWorkspace,
  setFolderDropTarget,
  persistSidebarOrder,
  persistSidebarFolders,
  persistSidebarCollapse,
  threadMoveDisabledReason,
  moveTargetsForThread,
  confirmThreadWorkspaceMove
}: Params) {
  const clearDragState = (): void => {
    setDraggingWorkspacePath(null)
    setWorkspaceOrderDropTarget(null)
    setDraggingThreadId(null)
    setThreadOrderDropTarget(null)
    setDragOverWorkspace(null)
    setFolderDropTarget(null)
  }

  const handleWorkspaceDragStart = (
    event: ReactDragEvent<HTMLDivElement>,
    workspacePath: string
  ): void => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(SIDEBAR_WORKSPACE_DRAG_DATA_KEY, workspacePath)
    clearDragState()
    setDraggingWorkspacePath(workspacePath)
  }

  const handleWorkspaceDragEnd = clearDragState

  const handleThreadDragStart = (
    event: ReactDragEvent<HTMLDivElement>,
    thread: NormalizedThread
  ): void => {
    if (!thread.id.trim() || deletingThreadIds[thread.id] === true) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(SIDEBAR_THREAD_DRAG_DATA_KEY, thread.id)
    clearDragState()
    setDraggingThreadId(thread.id)
  }

  const handleThreadDragEnd = clearDragState

  const handleWorkspaceDragOver = (
    event: ReactDragEvent<HTMLDivElement>,
    workspacePath: string
  ): void => {
    const sourceWorkspacePath = draggingWorkspacePath
      || event.dataTransfer.getData(SIDEBAR_WORKSPACE_DRAG_DATA_KEY)
    if (sourceWorkspacePath) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDragOverWorkspace(null)
      setWorkspaceOrderDropTarget(
        workspaceRootIdentityKey(sourceWorkspacePath) === workspaceRootIdentityKey(workspacePath)
          ? null
          : {
              workspacePath,
              position: sidebarDropPosition(
                event.clientY,
                event.currentTarget.getBoundingClientRect().top,
                event.currentTarget.getBoundingClientRect().height
              )
            }
      )
      return
    }
    const threadId = draggingThreadId || event.dataTransfer.getData(SIDEBAR_THREAD_DRAG_DATA_KEY)
    if (!threadId) return
    const thread = threads.find((item) => item.id === threadId)
    if (!thread) return
    const sourceWorkspace = sidebarWorkspacePathForThread(
      thread,
      threadWorktrees,
      allProjectGroups.map(([path]) => path)
    )
    if (workspaceRootIdentityKey(sourceWorkspace) === workspaceRootIdentityKey(workspacePath)) {
      const folders = sidebarFoldersForWorkspace(sidebarFolders, workspacePath)
      if (!sidebarFolderIdForThread(folders, threadId)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setWorkspaceOrderDropTarget(null)
      setFolderDropTarget(null)
      setDragOverWorkspace(workspacePath)
      return
    }
    const worktreeRecord = worktreeRecordForSidebarThread(thread, threadWorktrees)
    if (threadMoveDisabledReason(thread, worktreeRecord)) return
    if (!moveTargetsForThread(thread).some(
      (target) => workspaceRootIdentityKey(target) === workspaceRootIdentityKey(workspacePath)
    )) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setWorkspaceOrderDropTarget(null)
    setFolderDropTarget(null)
    setDragOverWorkspace(workspacePath)
  }

  const handleWorkspaceDragLeave = (
    event: ReactDragEvent<HTMLDivElement>,
    workspacePath: string
  ): void => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    setWorkspaceOrderDropTarget((current) =>
      current && workspaceRootIdentityKey(current.workspacePath) === workspaceRootIdentityKey(workspacePath)
        ? null
        : current
    )
    setDragOverWorkspace((current) =>
      workspaceRootIdentityKey(current ?? undefined) === workspaceRootIdentityKey(workspacePath)
        ? null
        : current
    )
  }

  const handleWorkspaceDrop = (
    event: ReactDragEvent<HTMLDivElement>,
    workspacePath: string
  ): void => {
    event.preventDefault()
    const sourceWorkspacePath = draggingWorkspacePath
      || event.dataTransfer.getData(SIDEBAR_WORKSPACE_DRAG_DATA_KEY)
    if (sourceWorkspacePath) {
      const rect = event.currentTarget.getBoundingClientRect()
      const nextWorkspacePaths = reorderSidebarWorkspacePaths({
        workspacePaths: workspacePathsForOrder,
        sourcePath: sourceWorkspacePath,
        targetPath: workspacePath,
        position: sidebarDropPosition(event.clientY, rect.top, rect.height)
      })
      persistSidebarOrder((current) => setSidebarWorkspaceOrder(current, nextWorkspacePaths))
      clearDragState()
      return
    }
    const threadId = draggingThreadId || event.dataTransfer.getData(SIDEBAR_THREAD_DRAG_DATA_KEY)
    clearDragState()
    if (!threadId) return
    const thread = threads.find((item) => item.id === threadId)
    if (!thread) return
    const sourceWorkspace = sidebarWorkspacePathForThread(
      thread,
      threadWorktrees,
      allProjectGroups.map(([path]) => path)
    )
    if (workspaceRootIdentityKey(sourceWorkspace) === workspaceRootIdentityKey(workspacePath)) {
      persistSidebarFolders((current) =>
        moveThreadToSidebarFolder(current, workspacePath, threadId, null)
      )
      return
    }
    confirmThreadWorkspaceMove(thread, workspacePath, worktreeRecordForSidebarThread(thread, threadWorktrees))
  }

  const handleThreadDragOver = (
    event: ReactDragEvent<HTMLDivElement>,
    targetThread: NormalizedThread,
    workspacePath: string,
    folderId: string | null
  ): void => {
    const sourceId = draggingThreadId || event.dataTransfer.getData(SIDEBAR_THREAD_DRAG_DATA_KEY)
    if (!sourceId || sourceId === targetThread.id) return
    const sourceThread = threads.find((thread) => thread.id === sourceId)
    if (!sourceThread) return
    const sourceWorkspace = sidebarWorkspacePathForThread(
      sourceThread,
      threadWorktrees,
      allProjectGroups.map(([path]) => path)
    )
    if (workspaceRootIdentityKey(sourceWorkspace) !== workspaceRootIdentityKey(workspacePath)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    setThreadOrderDropTarget({
      workspacePath,
      threadId: targetThread.id,
      folderId,
      position: sidebarDropPosition(event.clientY, rect.top, rect.height)
    })
    setDragOverWorkspace(null)
    setFolderDropTarget(null)
  }

  const handleThreadDragLeave = (
    event: ReactDragEvent<HTMLDivElement>,
    threadId: string
  ): void => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    setThreadOrderDropTarget((current) => current?.threadId === threadId ? null : current)
  }

  const handleThreadDrop = (
    event: ReactDragEvent<HTMLDivElement>,
    targetThread: NormalizedThread,
    workspacePath: string,
    folderId: string | null
  ): void => {
    const sourceId = draggingThreadId || event.dataTransfer.getData(SIDEBAR_THREAD_DRAG_DATA_KEY)
    if (!sourceId || sourceId === targetThread.id) return
    const sourceThread = threads.find((thread) => thread.id === sourceId)
    if (!sourceThread) return
    const sourceWorkspace = sidebarWorkspacePathForThread(
      sourceThread,
      threadWorktrees,
      allProjectGroups.map(([path]) => path)
    )
    if (workspaceRootIdentityKey(sourceWorkspace) !== workspaceRootIdentityKey(workspacePath)) return
    event.preventDefault()
    event.stopPropagation()
    const position = sidebarDropPosition(
      event.clientY,
      event.currentTarget.getBoundingClientRect().top,
      event.currentTarget.getBoundingClientRect().height
    )
    const scope = sidebarThreadOrderScope(workspacePath)
    const containerKey = folderId
      ? `${scope}:folder:${folderId}`
      : `${scope}:root`
    const displayedIds = orderTracker.currentOrder(containerKey)
    persistSidebarFolders((current) =>
      moveThreadToSidebarFolder(
        current,
        workspacePath,
        sourceId,
        folderId,
        targetThread.id,
        position,
        displayedIds
      )
    )
    if (!folderId) {
      const orderedIds = displayedIds.length > 0
        ? displayedIds
        : reconcileSidebarThreadOrder(
            (allThreadIdsByScope[scope] ?? []).map((id) => ({ id })),
            sidebarOrder.threadIdsByScope[scope] ?? []
          ).map(({ id }) => id)
      const nextRootIds = reorderSidebarThreadIds({
        threadIds: orderedIds,
        sourceId,
        targetId: targetThread.id,
        position
      })
      const rootIds = new Set(nextRootIds)
      const nextIds = [
        ...nextRootIds,
        ...(allThreadIdsByScope[scope] ?? []).filter((id) => !rootIds.has(id))
      ]
      persistSidebarOrder((current) => setSidebarThreadOrder(current, workspacePath, nextIds))
    }
    clearDragState()
  }

  const handleFolderDragOver = (
    event: ReactDragEvent<HTMLDivElement>,
    workspacePath: string,
    folderId: string
  ): void => {
    const threadId = draggingThreadId || event.dataTransfer.getData(SIDEBAR_THREAD_DRAG_DATA_KEY)
    if (!threadId) return
    const thread = threads.find((item) => item.id === threadId)
    if (!thread) return
    const sourceWorkspace = sidebarWorkspacePathForThread(
      thread,
      threadWorktrees,
      allProjectGroups.map(([path]) => path)
    )
    if (workspaceRootIdentityKey(sourceWorkspace) !== workspaceRootIdentityKey(workspacePath)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setThreadOrderDropTarget(null)
    setDragOverWorkspace(null)
    setFolderDropTarget({ workspacePath, folderId })
  }

  const handleFolderDragLeave = (
    event: ReactDragEvent<HTMLDivElement>,
    workspacePath: string,
    folderId: string
  ): void => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    setFolderDropTarget((current) =>
      current
      && current.folderId === folderId
      && workspaceRootIdentityKey(current.workspacePath) === workspaceRootIdentityKey(workspacePath)
        ? null
        : current
    )
  }

  const handleFolderDrop = (
    event: ReactDragEvent<HTMLDivElement>,
    workspacePath: string,
    folderId: string
  ): void => {
    const threadId = draggingThreadId || event.dataTransfer.getData(SIDEBAR_THREAD_DRAG_DATA_KEY)
    if (!threadId) return
    const thread = threads.find((item) => item.id === threadId)
    if (!thread) return
    const sourceWorkspace = sidebarWorkspacePathForThread(
      thread,
      threadWorktrees,
      allProjectGroups.map(([path]) => path)
    )
    if (workspaceRootIdentityKey(sourceWorkspace) !== workspaceRootIdentityKey(workspacePath)) return
    event.preventDefault()
    event.stopPropagation()
    persistSidebarFolders((current) =>
      moveThreadToSidebarFolder(current, workspacePath, threadId, folderId)
    )
    persistSidebarCollapse((current) =>
      setSidebarFolderCollapsed(current, workspacePath, folderId, false)
    )
    clearDragState()
  }

  return {
    handleFolderDragLeave,
    handleFolderDragOver,
    handleFolderDrop,
    handleThreadDragEnd,
    handleThreadDragLeave,
    handleThreadDragOver,
    handleThreadDragStart,
    handleThreadDrop,
    handleWorkspaceDragEnd,
    handleWorkspaceDragLeave,
    handleWorkspaceDragOver,
    handleWorkspaceDragStart,
    handleWorkspaceDrop
  }
}
