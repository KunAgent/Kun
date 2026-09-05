import type {
  DragEvent as ReactDragEvent,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement
} from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  FolderOpen,
  Plus,
  Search
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { getProvider } from '../../agent/registry'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { useChatStore } from '../../store/chat-store'
import { rememberCodeWorkspaceRoots } from '../../store/chat-store-helpers'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { removedWorkspaceIdentityKeys } from '../../lib/removed-code-workspaces'
import {
  normalizeWorkspaceRoot,
  workspaceRootIdentityKey
} from '../../lib/workspace-path'
import {
  SidebarIconButton,
  SidebarSearchField,
  SidebarTreeRow
} from '../sidebar/SidebarPrimitives'
import { readThreadWorktreeRegistry } from '../../lib/thread-worktree-registry'
import {
  SidebarEmpty,
  ThreadRow
} from './SidebarProjectRows'
export { SddDraftHistoryRows, ThreadRow, ThreadRunningIndicator } from './SidebarProjectRows'
import {
  FolderContextMenu,
  MoveThreadDialog,
  SidebarActionDialog,
  SidebarFolderDialog,
  ThreadContextMenu,
  ThreadRenameDialog,
  WorkspaceContextMenu,
  type FolderContextMenuState,
  type MoveThreadDialogState,
  type RenameThreadDialogState,
  type SidebarActionDialogState,
  type SidebarFolderDialogState,
  type ThreadContextMenuState,
  type WorkspaceContextMenuState
} from './SidebarProjectOverlays'
export {
  MoveThreadDialog,
  sidebarOverlayPortalHost,
  SidebarActionDialog,
  ThreadRenameDialog
} from './SidebarProjectOverlays'
export type { RenameThreadDialogState } from './SidebarProjectOverlays'
import { threadLooksRunning } from '../../store/chat-store-runtime-helpers'
import {
  buildSidebarDraftWorkspacePaths,
  buildSidebarThreadMoveTargets,
  buildSidebarWorkspaceGroups,
  filterEmptySddAssistantThreadsFromSidebar,
  filterSddDraftHistoryItems,
  isSidebarProjectWorkspacePath,
  mergeSidebarWorkspaceGroupsWithDraftHistory,
  prioritizeSidebarThreadActivity,
  sidebarThreadActivity,
  sidebarWorkspacePathForThread,
  sidebarWorkspaceResolutionCandidates,
  sortSidebarThreads,
  worktreeRecordForSidebarThread,
  type SidebarThreadWorktreeRecord,
  type SidebarThreadWorktrees
} from './sidebar-project-selectors'
import { createSidebarThreadOrderTracker } from './sidebar-thread-order-tracker'
import {
  SIDEBAR_THREAD_DRAG_DATA_KEY,
  SIDEBAR_WORKSPACE_DRAG_DATA_KEY,
  readSidebarOrderRegistry,
  reconcileSidebarThreadOrder,
  reconcileSidebarWorkspaceOrder,
  reorderSidebarThreadIds,
  reorderSidebarWorkspacePaths,
  saveSidebarOrderRegistry,
  setSidebarThreadOrder,
  setSidebarWorkspaceOrder,
  sidebarDropPosition,
  sidebarThreadOrderScope,
  type SidebarDropPosition,
  type SidebarOrderRegistry
} from './sidebar-order'
import {
  isSidebarFolderCollapsed,
  isSidebarWorkspaceCollapsed,
  readSidebarCollapseRegistry,
  removeSidebarFolderCollapse,
  saveSidebarCollapseRegistry,
  setSidebarFolderCollapsed,
  setSidebarWorkspaceCollapsed,
  setSidebarWorkspacesCollapsed,
  type SidebarCollapseRegistry
} from './sidebar-collapse'
import {
  createSidebarFolder,
  deleteSidebarFolder,
  moveThreadToSidebarFolder,
  readSidebarFolderRegistry,
  removeSidebarThreadAssignments,
  renameSidebarFolder,
  saveSidebarFolderRegistry,
  sidebarChildFolders,
  sidebarFolderIdForThread,
  sidebarFolderNameExists,
  sidebarFolderThreadCount,
  sidebarFoldersForWorkspace,
  type SidebarFolderRegistry,
  type SidebarVirtualFolder
} from './sidebar-folders'
import { createSidebarProjectThreadActions } from './sidebar-project-thread-actions'
import {
  createSidebarProjectDragActions,
  type FolderDropTarget,
  type ThreadOrderDropTarget,
  type WorkspaceOrderDropTarget
} from './sidebar-project-drag-actions'
import { createSidebarProjectWorkspaceActions } from './sidebar-project-workspace-actions'
import { useSidebarWorkspaceAutoLoad } from './sidebar-project-auto-load'
import type { SidebarProjectExpansionStage } from './sidebar-project-expansion'
import { SidebarProjectsContent, type SidebarThreadListStatus } from './SidebarProjectsContent'
import { useSidebarWorktreeDiscovery } from './sidebar-worktree-discovery'
import { useSidebarWorkspaceCreationTimes } from './sidebar-project-creation-times'
import { useRemovedWorkspaceDiscoveredAliases } from './use-removed-workspace-discovered-aliases'
export {
  buildSidebarDraftWorkspacePaths,
  buildSidebarThreadMoveTargets,
  buildSidebarWorkspaceGroups,
  filterEmptySddAssistantThreadsFromSidebar,
  filterSddDraftHistoryItems,
  isSidebarThreadMoveBlocked,
  mergeSidebarWorkspaceGroupsWithDraftHistory,
  prioritizeSidebarThreadActivity,
  resolveThreadPreviewPosition,
  sidebarThreadActivity,
  sortSidebarThreads
} from './sidebar-project-selectors'
export type { SidebarWorkspaceGroup } from './sidebar-project-selectors'

type SidebarProjectsSectionProps = {
  threads: NormalizedThread[]
  activeView: 'chat' | 'write' | 'claw'
  activeThreadId: string | null
  runtimeReady: boolean
  threadListStatus: SidebarThreadListStatus
  threadListError: string | null
  onRetryThreads: () => void
  onLoadMoreThreads: (workspacePath: string) => void
  threadListCursorByWorkspace: Record<string, import('../../store/chat-store-thread-pagination').WorkspaceThreadPageMeta>
  searchQuery: string
  showArchived: boolean
  workspaceRoot: string
  workspaceRoots: string[]
  /** 对话工作目录根,用于在项目区块中过滤掉对话会话。 */
  conversationRoot: string
  busy: boolean
  watchTurnCompletion: Record<string, boolean>
  unreadThreadIds: Parameters<typeof sidebarThreadActivity>[1]['unreadThreadIds']
  scheduledThreadActivities?: Parameters<typeof sidebarThreadActivity>[1]['scheduledThreadActivities']
  awaitingUserInputThreadIds?: Parameters<typeof sidebarThreadActivity>[1]['awaitingUserInputThreadIds']
  locale: string
  onPickWorkspace: () => void
  /**
   * Remove the whole project identity (main dir + resolved worktree aliases)
   * from the Code sidebar/picker. Keeps threads and files on disk.
   */
  onRemoveWorkspace: (workspacePath: string, relatedPaths?: string[]) => Promise<void>
  onCreateThreadInWorkspace: (
    workspacePath: string,
    options?: { forceNew?: boolean }
  ) => Promise<string | null>
  onSelectThread: (threadId: string) => void
  onRenameThread: (threadId: string, title: string) => Promise<void>
  onPinThread: (threadId: string, pinned: boolean) => Promise<void>
  onArchiveThread: (threadId: string) => Promise<void>
  onDeleteThread: (threadId: string) => Promise<void>
  onRestoreThread: (threadId: string) => Promise<void>
  onSearchQueryChange: (query: string) => void
  t: (k: string, opts?: Record<string, unknown>) => string
}

export function sddDraftHistorySavedRevision(
  draft: { id: string; updatedAt: string } | null | undefined
): string {
  return draft ? `${draft.id}\n${draft.updatedAt}` : ''
}

/** Stable across title, status, sequence, and other activity-only updates. */
export function sidebarThreadWorkspaceIdentityKey(threads: NormalizedThread[]): string {
  return threads
    .map((thread) => `${thread.id}\u0000${normalizeWorkspaceRoot(thread.workspace ?? '')}`)
    .sort()
    .join('\n')
}

export function sidebarWorktreeDiscoveryKey(
  threads: NormalizedThread[],
  workspaceRoot: string,
  workspaceRoots: string[]
): string {
  const pathsByIdentity = new Map<string, string>()
  for (const path of [
    workspaceRoot,
    ...workspaceRoots,
    ...threads.map((thread) => thread.workspace ?? '')
  ]) {
    const key = workspaceRootIdentityKey(path)
    if (key && !pathsByIdentity.has(key)) pathsByIdentity.set(key, path)
  }
  return JSON.stringify(
    [...pathsByIdentity.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, path]) => path)
  )
}

export function SidebarProjectsSection({
  threads,
  activeView,
  activeThreadId,
  runtimeReady,
  threadListStatus,
  threadListError,
  onRetryThreads,
  onLoadMoreThreads,
  threadListCursorByWorkspace,
  searchQuery,
  showArchived,
  workspaceRoot,
  workspaceRoots,
  conversationRoot,
  busy,
  watchTurnCompletion,
  unreadThreadIds,
  scheduledThreadActivities = {},
  awaitingUserInputThreadIds,
  locale,
  onPickWorkspace,
  onRemoveWorkspace,
  onCreateThreadInWorkspace,
  onSelectThread,
  onRenameThread,
  onPinThread,
  onArchiveThread,
  onDeleteThread,
  onRestoreThread,
  onSearchQueryChange,
  t
}: SidebarProjectsSectionProps): ReactElement {
  const orderTracker = useRef(createSidebarThreadOrderTracker()).current
  const [sidebarCollapse, setSidebarCollapse] = useState<SidebarCollapseRegistry>(
    () => readSidebarCollapseRegistry()
  )
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, SidebarProjectExpansionStage>>({})
  const [deletingThreadIds, setDeletingThreadIds] = useState<Record<string, boolean>>({})
  const [searchOpen, setSearchOpen] = useState(false)
  const [threadContextMenu, setThreadContextMenu] = useState<ThreadContextMenuState | null>(null)
  const [workspaceContextMenu, setWorkspaceContextMenu] = useState<WorkspaceContextMenuState | null>(null)
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenuState | null>(null)
  const [actionDialog, setActionDialog] = useState<SidebarActionDialogState | null>(null)
  const [renameThreadDialog, setRenameThreadDialog] = useState<RenameThreadDialogState | null>(null)
  const [moveThreadDialog, setMoveThreadDialog] = useState<MoveThreadDialogState | null>(null)
  const [folderDialog, setFolderDialog] = useState<SidebarFolderDialogState | null>(null)
  const [sidebarOrder, setSidebarOrder] = useState<SidebarOrderRegistry>(() => readSidebarOrderRegistry())
  const [sidebarFolders, setSidebarFolders] = useState<SidebarFolderRegistry>(() => readSidebarFolderRegistry())
  const [draggingWorkspacePath, setDraggingWorkspacePath] = useState<string | null>(null)
  const [workspaceOrderDropTarget, setWorkspaceOrderDropTarget] = useState<WorkspaceOrderDropTarget | null>(null)
  const [draggingThreadId, setDraggingThreadId] = useState<string | null>(null)
  const [threadOrderDropTarget, setThreadOrderDropTarget] = useState<ThreadOrderDropTarget | null>(null)
  const [dragOverWorkspace, setDragOverWorkspace] = useState<string | null>(null)
  const [folderDropTarget, setFolderDropTarget] = useState<FolderDropTarget | null>(null)
  const [registeredThreadWorktrees, setRegisteredThreadWorktrees] = useState<SidebarThreadWorktrees>(
    () => readThreadWorktreeRegistry().worktrees
  )
  const removedCodeWorkspaces = useChatStore((s) => s.removedCodeWorkspaces)
  const threadWorkspaceIdentityKey = sidebarThreadWorkspaceIdentityKey(threads)
  const workspaceRootsIdentityKey = workspaceRoots.map(normalizeWorkspaceRoot).sort().join('\n')

  useEffect(() => {
    setRegisteredThreadWorktrees(readThreadWorktreeRegistry().worktrees)
  }, [activeThreadId, threadWorkspaceIdentityKey, workspaceRootsIdentityKey])

  const worktreeDiscoveryKey = sidebarWorktreeDiscoveryKey(
    threads,
    workspaceRoot,
    workspaceRoots
  )
  const discoveredThreadWorktrees = useSidebarWorktreeDiscovery(worktreeDiscoveryKey)

  const threadWorktrees = useMemo(() => ({
    ...discoveredThreadWorktrees,
    ...registeredThreadWorktrees
  }), [discoveredThreadWorktrees, registeredThreadWorktrees])

  const workspaceCreationTimes = useSidebarWorkspaceCreationTimes(
    sidebarWorkspaceResolutionCandidates({ workspaceRoot, workspaceRoots, threadWorktrees, threads })
  )

  useRemovedWorkspaceDiscoveredAliases(discoveredThreadWorktrees, removedCodeWorkspaces)

  const sidebarThreadActivityContext = {
    activeThreadId,
    busy,
    watchTurnCompletion,
    unreadThreadIds,
    scheduledThreadActivities,
    awaitingUserInputThreadIds
  }

  const removedProjectKeys = useMemo(
    () => removedWorkspaceIdentityKeys(removedCodeWorkspaces),
    [removedCodeWorkspaces]
  )

  const groups = useMemo(() => {
    return buildSidebarWorkspaceGroups({
      threads,
      searchQuery,
      showArchived,
      workspaceRoot,
      workspaceRoots,
      conversationRoot,
      threadWorktrees,
      removedProjectKeys,
      workspaceCreatedAt: workspaceCreationTimes
    })
  }, [searchQuery, showArchived, threadWorktrees, threads, workspaceRoot, workspaceRoots, conversationRoot, removedProjectKeys, workspaceCreationTimes])

  const allProjectGroups = useMemo(() => {
    const byWorkspace = new Map<string, [string, NormalizedThread[]]>()
    for (const archived of [false, true]) {
      const nextGroups = buildSidebarWorkspaceGroups({
        threads,
        searchQuery: '',
        showArchived: archived,
        workspaceRoot,
        workspaceRoots,
        conversationRoot,
        threadWorktrees,
        removedProjectKeys,
        workspaceCreatedAt: workspaceCreationTimes
      })
      for (const [workspacePath, items] of nextGroups) {
        const key = workspaceRootIdentityKey(workspacePath)
        const existing = byWorkspace.get(key)
        if (existing) existing[1].push(...items)
        else byWorkspace.set(key, [workspacePath, [...items]])
      }
    }
    return [...byWorkspace.values()]
  }, [conversationRoot, threadWorktrees, threads, workspaceRoot, workspaceRoots, removedProjectKeys, workspaceCreationTimes])

  const allThreadIdsByScope = useMemo(() => {
    return Object.fromEntries(allProjectGroups.map(([workspacePath, items]) => [
      sidebarThreadOrderScope(workspacePath),
      sortSidebarThreads(items).map((thread) => thread.id)
    ]))
  }, [allProjectGroups])

  const unorderedDisplayGroups = groups

  const displayGroups = useMemo(() => {
    const byWorkspace = new Map(
      unorderedDisplayGroups.map((group) => [workspaceRootIdentityKey(group[0]), group] as const)
    )
    return reconcileSidebarWorkspaceOrder(
      unorderedDisplayGroups.map(([workspacePath]) => workspacePath),
      sidebarOrder.workspacePaths
    ).flatMap((workspacePath) => {
      const group = byWorkspace.get(workspaceRootIdentityKey(workspacePath))
      return group ? [group] : []
    })
  }, [sidebarOrder.workspacePaths, unorderedDisplayGroups])

  const workspacePathsForOrder = useMemo(() => reconcileSidebarWorkspaceOrder(
    [
      ...allProjectGroups.map(([workspacePath]) => workspacePath),
      ...unorderedDisplayGroups.map(([workspacePath]) => workspacePath)
    ],
    sidebarOrder.workspacePaths
  ), [allProjectGroups, sidebarOrder.workspacePaths, unorderedDisplayGroups])

  const searchVisible = searchOpen || searchQuery.trim().length > 0
  const allGroupsCollapsed = displayGroups.length > 0 && displayGroups.every(([workspacePath]) =>
    isSidebarWorkspaceCollapsed(sidebarCollapse, workspacePath)
  )
  const projectWorkspaceGroups = displayGroups.filter(([workspacePath]) => isSidebarProjectWorkspacePath(workspacePath))

  useSidebarWorkspaceAutoLoad({ displayGroups, sidebarCollapse, showArchived, searchQuery, runtimeReady, threadListStatus, threadListCursorByWorkspace, onLoadMoreThreads })

  useEffect(() => {
    if (!threadContextMenu && !workspaceContextMenu && !folderContextMenu) return
    const close = (): void => {
      setThreadContextMenu(null)
      setWorkspaceContextMenu(null)
      setFolderContextMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [folderContextMenu, threadContextMenu, workspaceContextMenu])

  const toggleAllGroups = (): void => {
    if (displayGroups.length === 0) return
    persistSidebarCollapse((current) => setSidebarWorkspacesCollapsed(
      current,
      displayGroups.map(([workspacePath]) => workspacePath),
      !allGroupsCollapsed
    ))
  }

  const persistSidebarOrder = (
    update: (current: SidebarOrderRegistry) => SidebarOrderRegistry
  ): void => {
    const next = update(readSidebarOrderRegistry())
    saveSidebarOrderRegistry(next)
    setSidebarOrder(next)
  }

  const persistSidebarFolders = (
    update: (current: SidebarFolderRegistry) => SidebarFolderRegistry
  ): void => {
    const next = update(readSidebarFolderRegistry())
    saveSidebarFolderRegistry(next)
    setSidebarFolders(next)
  }

  const persistSidebarCollapse = (
    update: (current: SidebarCollapseRegistry) => SidebarCollapseRegistry
  ): void => {
    const next = update(readSidebarCollapseRegistry())
    saveSidebarCollapseRegistry(next)
    setSidebarCollapse(next)
  }

  const {
    closeActionDialog,
    closeMoveThreadDialog,
    closeRenameThreadDialog,
    confirmThreadWorkspaceMove,
    handleArchiveThread,
    handleCopyThreadId,
    handleDeleteThread,
    handlePinThread,
    handleRestoreThread,
    handleSummarizeThread,
    handlePruneThread,
    moveTargetsForThread,
    moveThreadToWorkspace,
    openActionDialog,
    openMoveThreadDialog,
    openRenameThreadDialog,
    submitActionDialog,
    submitMoveThreadDialog,
    submitRenameThreadDialog,
    threadMoveDisabledReason
  } = createSidebarProjectThreadActions({
    t,
    activeThreadId,
    busy,
    watchTurnCompletion,
    projectWorkspaceGroups,
    threadWorktrees,
    deletingThreadIds,
    actionDialog,
    renameThreadDialog,
    moveThreadDialog,
    setDeletingThreadIds,
    setActionDialog,
    setRenameThreadDialog,
    setMoveThreadDialog,
    setThreadContextMenu,
    setDragOverWorkspace,
    persistSidebarFolders,
    onRenameThread,
    onPinThread,
    onArchiveThread,
    onDeleteThread,
    onRestoreThread
  })

  const openCreateFolderDialog = (
    workspacePath: string,
    parentId: string | null = null
  ): void => {
    setFolderDialog({
      mode: 'create',
      workspacePath,
      parentId,
      value: ''
    })
    setWorkspaceContextMenu(null)
    setFolderContextMenu(null)
  }

  const openRenameFolderDialog = (
    workspacePath: string,
    folder: SidebarVirtualFolder
  ): void => {
    setFolderDialog({
      mode: 'rename',
      workspacePath,
      folder,
      value: folder.name
    })
    setFolderContextMenu(null)
  }

  const submitFolderDialog = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const dialog = folderDialog
    const name = dialog?.value.trim() ?? ''
    if (!dialog || !name) return
    const folders = sidebarFoldersForWorkspace(sidebarFolders, dialog.workspacePath)
    const parentId = dialog.mode === 'create'
      ? dialog.parentId ?? null
      : dialog.folder?.parentId ?? null
    if (sidebarFolderNameExists(folders, name, dialog.folder?.id, parentId)) {
      setFolderDialog((current) => current ? {
        ...current,
        value: name,
        error: t('sidebarFolderNameExists')
      } : current)
      return
    }
    if (dialog.mode === 'create') {
      const folderId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      persistSidebarFolders((current) =>
        createSidebarFolder(current, dialog.workspacePath, {
          id: folderId,
          name,
          parentId
        })
      )
    } else if (dialog.folder) {
      persistSidebarFolders((current) =>
        renameSidebarFolder(current, dialog.workspacePath, dialog.folder?.id ?? '', name)
      )
    }
    setFolderDialog(null)
  }

  const handleCreateThreadInFolder = async (
    workspacePath: string,
    folderId: string
  ): Promise<void> => {
    persistSidebarCollapse((current) =>
      setSidebarFolderCollapsed(current, workspacePath, folderId, false)
    )
    const threadId = await onCreateThreadInWorkspace(workspacePath, { forceNew: true })
    if (!threadId) return
    persistSidebarFolders((current) =>
      moveThreadToSidebarFolder(current, workspacePath, threadId, folderId)
    )
  }

  const handleDeleteFolder = (
    workspacePath: string,
    folder: SidebarVirtualFolder
  ): void => {
    openActionDialog({
      title: t('sidebarFolderDeleteDialogTitle', { name: folder.name }),
      description: t('sidebarFolderDeleteDialogDescription'),
      detail: t('sidebarFolderDeleteDialogDetail', { count: folder.threadIds.length }),
      confirmLabel: t('sidebarFolderDeleteConfirmButton'),
      danger: true,
      onConfirm: async () => {
        persistSidebarFolders((current) =>
          deleteSidebarFolder(current, workspacePath, folder.id)
        )
        persistSidebarCollapse((current) =>
          removeSidebarFolderCollapse(current, workspacePath, folder.id)
        )
      }
    })
    setFolderContextMenu(null)
  }

  const {
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
  } = createSidebarProjectDragActions({
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
  })

  const {
    archivableWorkspaceThreads,
    closeThreadPreview,
    handleArchiveWorkspaceThreads,
    handleRemoveWorkspace,
    openFolderContextMenu,
    openThreadContextMenu,
    openThreadPreview,
    openWorkspaceContextMenu,
    openWorkspaceInSystem
  } = createSidebarProjectWorkspaceActions({
    t,
    threads,
    workspaceRoot,
    workspaceRoots,
    threadWorktrees,
    setThreadContextMenu,
    setWorkspaceContextMenu,
    setFolderContextMenu,
    setDeletingThreadIds,
    openActionDialog,
    onRemoveWorkspace,
    onArchiveThread
  })
  return <SidebarProjectsContent {...{
    t, runtimeReady, workspaceRoot, searchQuery, showArchived, allGroupsCollapsed, searchVisible,
    busy, activeView, activeThreadId, locale, displayGroups, sidebarCollapse, sidebarOrder, orderTracker,
    threadListStatus, threadListError, onRetryThreads, onLoadMoreThreads, threadListCursorByWorkspace,
    sidebarFolders, expandedWorkspaces, deletingThreadIds, draggingWorkspacePath, draggingThreadId,
    workspaceOrderDropTarget, threadOrderDropTarget, dragOverWorkspace, folderDropTarget,
    threadWorktrees, sidebarThreadActivityContext, threadContextMenu, workspaceContextMenu,
    folderContextMenu, actionDialog, renameThreadDialog, moveThreadDialog, folderDialog,
    setSearchOpen, setExpandedWorkspaces, setThreadContextMenu, setWorkspaceContextMenu,
    setFolderContextMenu, setRenameThreadDialog, setFolderDialog, onPickWorkspace,
    onSearchQueryChange, onCreateThreadInWorkspace, onSelectThread, toggleAllGroups,
    persistSidebarCollapse, openCreateFolderDialog, openRenameFolderDialog, submitFolderDialog,
    handleCreateThreadInFolder, handleDeleteFolder, openThreadContextMenu,
    openWorkspaceContextMenu, openFolderContextMenu, openThreadPreview, closeThreadPreview,
    handleWorkspaceDragStart, handleWorkspaceDragEnd, handleWorkspaceDragOver,
    handleWorkspaceDragLeave, handleWorkspaceDrop, handleThreadDragStart, handleThreadDragEnd,
    handleThreadDragOver, handleThreadDragLeave, handleThreadDrop, handleFolderDragOver,
    handleFolderDragLeave, handleFolderDrop, threadMoveDisabledReason, openMoveThreadDialog,
    handlePinThread, openRenameThreadDialog, handleSummarizeThread, handlePruneThread, handleCopyThreadId,
    handleArchiveThread,
    handleDeleteThread, handleRestoreThread, openWorkspaceInSystem, handleArchiveWorkspaceThreads,
    handleRemoveWorkspace, archivableWorkspaceThreads, closeRenameThreadDialog,
    submitRenameThreadDialog, closeMoveThreadDialog, confirmThreadWorkspaceMove,
    submitMoveThreadDialog, closeActionDialog, submitActionDialog
  }} />
}
