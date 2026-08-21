import type {
  Dispatch,
  DragEvent as ReactDragEvent,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
  SetStateAction
} from 'react'
import { ChevronDown, ChevronRight, Folder, FolderPlus, FolderOpen, Plus } from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { workspaceRootIdentityKey } from '../../lib/workspace-path'
import { SidebarIconButton, SidebarSearchField, SidebarTreeRow } from '../sidebar/SidebarPrimitives'
import { SidebarProjectsHeader } from './SidebarProjectsHeader'
import { SidebarEmpty, SidebarThreadSkeleton, ThreadRow, ThreadRunningIndicator } from './SidebarProjectRows'
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
import {
  prioritizeSidebarThreadActivity,
  sidebarThreadActivity,
  sortSidebarThreads,
  workspaceContextLabel,
  worktreeRecordForSidebarThread,
  type SidebarThreadWorktreeRecord,
  type SidebarThreadWorktrees,
  type SidebarWorkspaceGroup
} from './sidebar-project-selectors'
import { reconcileSidebarThreadOrder, sidebarThreadOrderScope, type SidebarOrderRegistry } from './sidebar-order'
import {
  isSidebarFolderCollapsed,
  isSidebarWorkspaceCollapsed,
  setSidebarFolderCollapsed,
  setSidebarWorkspaceCollapsed,
  type SidebarCollapseRegistry
} from './sidebar-collapse'
import {
  sidebarChildFolders,
  sidebarFolderDescendantThreadIds,
  sidebarFolderThreadCount,
  sidebarFoldersForWorkspace,
  type SidebarFolderRegistry,
  type SidebarVirtualFolder
} from './sidebar-folders'
import type {
  FolderDropTarget,
  ThreadOrderDropTarget,
  WorkspaceOrderDropTarget
} from './sidebar-project-drag-actions'
import {
  nextSidebarProjectExpansionStage,
  sidebarProjectVisibleItems,
  sidebarProjectVisibleThreadCount,
  type SidebarProjectExpansionStage
} from './sidebar-project-expansion'

type T = (key: string, options?: Record<string, unknown>) => string

export type SidebarThreadListStatus = 'idle' | 'loading' | 'ready' | 'refreshing' | 'error'

export type SidebarProjectsContentProps = {
  t: T
  runtimeReady: boolean; workspaceRoot: string; searchQuery: string; showArchived: boolean
  allGroupsCollapsed: boolean; searchVisible: boolean; busy: boolean
  threadListStatus: SidebarThreadListStatus; threadListError: string | null
  onRetryThreads: () => void
  onLoadMoreThreads: (workspacePath: string) => void
  threadListCursorByWorkspace: Record<string, {
    workspaceKey: string
    nextCursor?: string
    hasMore: boolean
    total?: number
  }>
  activeView: 'chat' | 'write' | 'claw'; activeThreadId: string | null; locale: string
  displayGroups: SidebarWorkspaceGroup[]
  sidebarCollapse: SidebarCollapseRegistry; sidebarOrder: SidebarOrderRegistry; sidebarFolders: SidebarFolderRegistry
  expandedWorkspaces: Record<string, SidebarProjectExpansionStage>; deletingThreadIds: Record<string, boolean>
  draggingWorkspacePath: string | null; draggingThreadId: string | null
  workspaceOrderDropTarget: WorkspaceOrderDropTarget | null
  threadOrderDropTarget: ThreadOrderDropTarget | null; dragOverWorkspace: string | null
  folderDropTarget: FolderDropTarget | null; threadWorktrees: SidebarThreadWorktrees
  sidebarThreadActivityContext: Parameters<typeof sidebarThreadActivity>[1]
  threadContextMenu: ThreadContextMenuState | null; workspaceContextMenu: WorkspaceContextMenuState | null
  folderContextMenu: FolderContextMenuState | null; actionDialog: SidebarActionDialogState | null
  renameThreadDialog: RenameThreadDialogState | null; moveThreadDialog: MoveThreadDialogState | null
  folderDialog: SidebarFolderDialogState | null
  setSearchOpen: Dispatch<SetStateAction<boolean>>
  setExpandedWorkspaces: Dispatch<SetStateAction<Record<string, SidebarProjectExpansionStage>>>
  setThreadContextMenu: Dispatch<SetStateAction<ThreadContextMenuState | null>>
  setWorkspaceContextMenu: Dispatch<SetStateAction<WorkspaceContextMenuState | null>>
  setFolderContextMenu: Dispatch<SetStateAction<FolderContextMenuState | null>>
  setRenameThreadDialog: Dispatch<SetStateAction<RenameThreadDialogState | null>>
  setFolderDialog: Dispatch<SetStateAction<SidebarFolderDialogState | null>>
  onPickWorkspace: () => void; onSearchQueryChange: (query: string) => void
  onCreateThreadInWorkspace: (workspacePath: string, options?: { forceNew?: boolean }) => Promise<string | null>
  onSelectThread: (threadId: string) => void
  toggleAllGroups: () => void
  persistSidebarCollapse: (update: (current: SidebarCollapseRegistry) => SidebarCollapseRegistry) => void
  openCreateFolderDialog: (workspacePath: string, parentId?: string | null) => void
  openRenameFolderDialog: (workspacePath: string, folder: SidebarVirtualFolder) => void
  submitFolderDialog: (event: FormEvent<HTMLFormElement>) => void
  handleCreateThreadInFolder: (workspacePath: string, folderId: string) => Promise<void>
  handleDeleteFolder: (workspacePath: string, folder: SidebarVirtualFolder) => void
  openThreadContextMenu: (event: ReactMouseEvent<HTMLDivElement>, thread: NormalizedThread) => void
  openWorkspaceContextMenu: (event: ReactMouseEvent<HTMLDivElement>, workspacePath: string) => void
  openFolderContextMenu: (event: ReactMouseEvent<HTMLDivElement>, workspacePath: string, folder: SidebarVirtualFolder) => void
  openThreadPreview: () => void; closeThreadPreview: () => void
  handleWorkspaceDragStart: (event: ReactDragEvent<HTMLDivElement>, workspacePath: string) => void
  handleWorkspaceDragEnd: () => void
  handleWorkspaceDragOver: (event: ReactDragEvent<HTMLDivElement>, workspacePath: string) => void
  handleWorkspaceDragLeave: (event: ReactDragEvent<HTMLDivElement>, workspacePath: string) => void
  handleWorkspaceDrop: (event: ReactDragEvent<HTMLDivElement>, workspacePath: string) => void
  handleThreadDragStart: (event: ReactDragEvent<HTMLDivElement>, thread: NormalizedThread) => void
  handleThreadDragEnd: () => void
  handleThreadDragOver: (event: ReactDragEvent<HTMLDivElement>, thread: NormalizedThread, workspacePath: string, folderId: string | null) => void
  handleThreadDragLeave: (event: ReactDragEvent<HTMLDivElement>, threadId: string) => void
  handleThreadDrop: (event: ReactDragEvent<HTMLDivElement>, thread: NormalizedThread, workspacePath: string, folderId: string | null) => void
  handleFolderDragOver: (event: ReactDragEvent<HTMLDivElement>, workspacePath: string, folderId: string) => void
  handleFolderDragLeave: (event: ReactDragEvent<HTMLDivElement>, workspacePath: string, folderId: string) => void
  handleFolderDrop: (event: ReactDragEvent<HTMLDivElement>, workspacePath: string, folderId: string) => void
  threadMoveDisabledReason: (thread: NormalizedThread, record?: SidebarThreadWorktreeRecord) => string
  openMoveThreadDialog: (thread: NormalizedThread, record?: SidebarThreadWorktreeRecord) => void
  handlePinThread: (thread: NormalizedThread, pinned: boolean) => Promise<void>
  openRenameThreadDialog: (thread: NormalizedThread) => void
  handleSummarizeThread: (thread: NormalizedThread) => Promise<void>
  handleCopyThreadId: (thread: NormalizedThread) => Promise<void>
  handleArchiveThread: (thread: NormalizedThread) => Promise<void>
  handleDeleteThread: (thread: NormalizedThread) => Promise<void>
  handleRestoreThread: (thread: NormalizedThread) => Promise<void>
  openWorkspaceInSystem: (workspacePath: string) => Promise<void>
  handleArchiveWorkspaceThreads: (workspacePath: string) => Promise<void>
  handleRemoveWorkspace: (workspacePath: string) => Promise<void>
  archivableWorkspaceThreads: (workspacePath: string) => NormalizedThread[]
  closeRenameThreadDialog: () => void; submitRenameThreadDialog: (event: FormEvent<HTMLFormElement>) => Promise<void>
  closeMoveThreadDialog: () => void
  confirmThreadWorkspaceMove: (thread: NormalizedThread, workspacePath: string, record?: SidebarThreadWorktreeRecord) => void
  submitMoveThreadDialog: () => Promise<void>; closeActionDialog: () => void; submitActionDialog: () => Promise<void>
}

export function SidebarProjectsContent(props: SidebarProjectsContentProps): ReactElement {
  const {
    t, runtimeReady, workspaceRoot, searchQuery, showArchived, allGroupsCollapsed, searchVisible,
    busy, activeView, activeThreadId, locale, displayGroups, sidebarCollapse, sidebarOrder,
    threadListStatus, threadListError, onRetryThreads, onLoadMoreThreads,
    threadListCursorByWorkspace,
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
    handlePinThread, openRenameThreadDialog, handleSummarizeThread, handleCopyThreadId,
    handleArchiveThread,
    handleDeleteThread, handleRestoreThread, openWorkspaceInSystem, handleArchiveWorkspaceThreads,
    handleRemoveWorkspace, archivableWorkspaceThreads, closeRenameThreadDialog,
    submitRenameThreadDialog, closeMoveThreadDialog, confirmThreadWorkspaceMove,
    submitMoveThreadDialog, closeActionDialog, submitActionDialog
  } = props

  const runningLabel = t('sidebarThreadRunning')

  const renderThreadRow = (
    thread: NormalizedThread,
    workspacePath: string,
    folderId: string | null
  ): ReactElement => {
    const activity = sidebarThreadActivity(thread, sidebarThreadActivityContext)
    return <ThreadRow
      key={thread.id}
      thread={thread}
      worktreeRecord={worktreeRecordForSidebarThread(thread, threadWorktrees)}
      active={(activeView === 'chat' || activeView === 'write') && activeThreadId === thread.id}
      deleting={deletingThreadIds[thread.id] === true}
      locale={locale}
      showRunning={activity === 'running'}
      showFailed={activity === 'failed'}
      showUnread={activity === 'unread'}
      scheduledActivity={activity === 'scheduled'
        ? sidebarThreadActivityContext.scheduledThreadActivities?.[thread.id]
        : undefined}
      onSelect={() => onSelectThread(thread.id)}
      onContextMenu={(event) => openThreadContextMenu(event, thread)}
      onPreviewOpen={openThreadPreview}
      onPreviewClose={closeThreadPreview}
      draggable={deletingThreadIds[thread.id] !== true}
      dragging={draggingThreadId === thread.id}
      dropPosition={
        threadOrderDropTarget?.threadId === thread.id
        && threadOrderDropTarget.folderId === folderId
        && workspaceRootIdentityKey(threadOrderDropTarget.workspacePath) === workspaceRootIdentityKey(workspacePath)
          ? threadOrderDropTarget.position
          : null
      }
      onDragStart={(event) => handleThreadDragStart(event, thread)}
      onDragEnd={handleThreadDragEnd}
      onDragOver={(event) => handleThreadDragOver(event, thread, workspacePath, folderId)}
      onDragLeave={(event) => handleThreadDragLeave(event, thread.id)}
      onDrop={(event) => handleThreadDrop(event, thread, workspacePath, folderId)}
      onPin={() => void handlePinThread(thread, thread.pinned !== true)}
      onRename={() => openRenameThreadDialog(thread)}
      onArchive={() => void handleArchiveThread(thread)}
      onDelete={() => void handleDeleteThread(thread)}
      onRestore={() => void handleRestoreThread(thread)}
    />
  }
  return (
    <div className="ds-no-drag flex min-h-0 flex-1 flex-col">
      <SidebarProjectsHeader
        allGroupsCollapsed={allGroupsCollapsed}
        searchVisible={searchVisible}
        workspaceRoot={workspaceRoot}
        onToggle={toggleAllGroups}
        onToggleSearch={() => setSearchOpen((open) => !open)}
        onPickWorkspace={onPickWorkspace}
        t={t}
      />

      {searchVisible ? (
        <div className="mb-2 flex items-center gap-1 px-2">
          <SidebarSearchField
            value={searchQuery}
            onChange={onSearchQueryChange}
            placeholder={t('sidebarSearchThreads')}
            clearLabel={t('clear')}
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2 pt-0.5">
        {displayGroups.length === 0 ? (
          threadListStatus === 'error' ? (
            <div className="mx-2 mt-2 rounded-lg px-2 py-2">
              <p className="text-[13px] leading-5 text-ds-faint">{t('sidebarWorkspaceLoadError')}</p>
              {threadListError ? (
                <p className="mt-0.5 text-[12px] leading-4 text-ds-faint/80">{threadListError}</p>
              ) : null}
              <button
                type="button"
                data-cursor-spotlight-target
                onClick={onRetryThreads}
                className="mt-2 rounded-md px-2 py-1 text-[12px] font-medium text-ds-muted transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink"
              >
                {t('retryConnection')}
              </button>
            </div>
          ) : threadListStatus === 'loading' || threadListStatus === 'idle' ? (
            <SidebarThreadSkeleton />
          ) : (
            <SidebarEmpty
              runtimeReady={runtimeReady}
              hasWorkspace={!!workspaceRoot}
              onPickWorkspace={onPickWorkspace}
              t={t}
            />
          )
        ) : null}

        {displayGroups.map(([workspacePath, list]) => {
          const folderName = workspaceLabelFromPath(workspacePath)
          const workspaceContext = workspaceContextLabel(workspacePath, folderName)
          const isCollapsed = isSidebarWorkspaceCollapsed(sidebarCollapse, workspacePath)
          const isDragOver =
            dragOverWorkspace !== null
            && workspaceRootIdentityKey(dragOverWorkspace) === workspaceRootIdentityKey(workspacePath)
          const workspaceDropPosition =
            workspaceOrderDropTarget
            && workspaceRootIdentityKey(workspaceOrderDropTarget.workspacePath) === workspaceRootIdentityKey(workspacePath)
              ? workspaceOrderDropTarget.position
              : null
          const threadOrderScope = sidebarThreadOrderScope(workspacePath)
          const sortedThreads = prioritizeSidebarThreadActivity(
            reconcileSidebarThreadOrder(
              sortSidebarThreads(list),
              sidebarOrder.threadIdsByScope[threadOrderScope] ?? []
            ),
            sidebarThreadActivityContext
          )
          const workspaceFolders = sidebarFoldersForWorkspace(sidebarFolders, workspacePath)
          const assignedThreadIds = new Set(
            workspaceFolders.flatMap((folder) => folder.threadIds)
          )
          const rootThreads = sortedThreads.filter((thread) => !assignedThreadIds.has(thread.id))
          const threadsById = new Map(sortedThreads.map((thread) => [thread.id, thread] as const))
          const visibleFolder = (folder: SidebarVirtualFolder): boolean => {
            if (!searchQuery.trim() && !showArchived) return true
            if (folder.threadIds.some((threadId) => threadsById.has(threadId))) return true
            return sidebarChildFolders(workspaceFolders, folder.id).some(visibleFolder)
          }
          const rootFolders = sidebarChildFolders(workspaceFolders, null).filter(visibleFolder)
          const expansionStage = expandedWorkspaces[workspacePath] ?? 0
          const visibleThreadCount = sidebarProjectVisibleThreadCount(
            rootThreads.length,
            expansionStage
          )
          const visibleSelection = sidebarProjectVisibleItems(
            rootThreads,
            visibleThreadCount,
            (thread) => sidebarThreadActivity(thread, sidebarThreadActivityContext) === 'running'
          )
          const visibleThreads = visibleSelection.items
          const hiddenThreadCount = visibleSelection.hiddenCount
          const workspaceCursor = threadListCursorByWorkspace[workspaceRootIdentityKey(workspacePath)]
          const hasWorkspaceRemoteMore = workspaceCursor?.hasMore === true
          const knownWorkspaceRemoteCount = Math.max(
            0,
            (workspaceCursor?.total ?? rootThreads.length) - rootThreads.length
          )
          const hasMoreProjectThreads = hiddenThreadCount > 0 || hasWorkspaceRemoteMore
          return (
            <div
              key={workspacePath}
              className={`relative mb-2 ${
                workspaceDropPosition === 'before'
                  ? "before:absolute before:inset-x-2 before:top-0 before:z-10 before:h-0.5 before:rounded-full before:bg-accent before:content-['']"
                  : workspaceDropPosition === 'after'
                    ? "after:absolute after:bottom-0 after:inset-x-2 after:z-10 after:h-0.5 after:rounded-full after:bg-accent after:content-['']"
                    : ''
              }`}
            >
              <SidebarTreeRow
                title={workspacePath}
                ariaLabel={workspacePath}
                onClick={() =>
                  persistSidebarCollapse((current) =>
                    setSidebarWorkspaceCollapsed(current, workspacePath, !isCollapsed)
                  )
                }
                onContextMenu={(event) => openWorkspaceContextMenu(event, workspacePath)}
                draggable
                onDragStart={(event) => handleWorkspaceDragStart(event, workspacePath)}
                onDragEnd={handleWorkspaceDragEnd}
                onDragOver={(event) => handleWorkspaceDragOver(event, workspacePath)}
                onDragLeave={(event) => handleWorkspaceDragLeave(event, workspacePath)}
                onDrop={(event) => handleWorkspaceDrop(event, workspacePath)}
                className={`min-h-[36px] text-[13.5px] ${
                  isDragOver
                    ? 'bg-accent/10 shadow-[inset_0_0_0_1px_rgba(79,124,255,0.32)]'
                    : ''
                } ${
                  draggingWorkspacePath !== null
                  && workspaceRootIdentityKey(draggingWorkspacePath) === workspaceRootIdentityKey(workspacePath)
                    ? 'opacity-55'
                    : ''
                }`}
                buttonClassName="items-center gap-2 px-2.5 py-2"
                actionsVisibility="hidden"
                actionsLayout="overlay"
                actions={
                  <>
                    <SidebarIconButton
                      onClick={() => openCreateFolderDialog(workspacePath)}
                      title={t('sidebarFolderCreate')}
                      ariaLabel={t('sidebarFolderCreate')}
                      className="h-6 w-6"
                      stopPropagation
                    >
                      <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </SidebarIconButton>
                    <SidebarIconButton
                      onClick={() => onCreateThreadInWorkspace(workspacePath)}
                      title={t('sidebarWorkspaceNewThread')}
                      ariaLabel={t('sidebarWorkspaceNewThread')}
                      className="h-6 w-6"
                      stopPropagation
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
                    </SidebarIconButton>
                  </>
                }
              >
                {isCollapsed ? (
                  <Folder className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.75} />
                ) : (
                  <FolderOpen className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.75} />
                )}
                <span className="min-w-0 flex-1 truncate">{folderName}</span>
                {workspaceContext ? (
                  <span className="min-w-0 max-w-[42%] shrink truncate text-[12.5px] text-ds-faint transition group-hover:opacity-0 group-focus-within:opacity-0">
                    {workspaceContext}
                  </span>
                ) : null}
              </SidebarTreeRow>

              {!isCollapsed ? (
                <div className="mt-1 space-y-[3px] pl-4">
                  {rootFolders.map((folder) => {
                    const renderFolder = (item: SidebarVirtualFolder): ReactElement => {
                      const folderCollapsed = isSidebarFolderCollapsed(
                        sidebarCollapse,
                        workspacePath,
                        item.id
                      )
                      const folderThreadIds = sidebarFolderDescendantThreadIds(workspaceFolders, item.id)
                      const folderHasRunning = folderThreadIds.some((threadId) => {
                        const thread = threadsById.get(threadId)
                        return thread && sidebarThreadActivity(thread, sidebarThreadActivityContext) === 'running'
                      })
                      const folderThreads = prioritizeSidebarThreadActivity(
                        item.threadIds.flatMap((threadId) => {
                          const thread = threadsById.get(threadId)
                          return thread ? [thread] : []
                        }),
                        sidebarThreadActivityContext
                      )
                      const childFolders = sidebarChildFolders(workspaceFolders, item.id).filter(visibleFolder)
                      const isFolderDragOver =
                        folderDropTarget?.folderId === item.id
                        && workspaceRootIdentityKey(folderDropTarget.workspacePath) === workspaceRootIdentityKey(workspacePath)
                      return (
                        <div key={item.id}>
                          <SidebarTreeRow
                            title={item.name}
                            ariaLabel={[
                              t('sidebarFolderAriaLabel', {
                                name: item.name,
                                count: sidebarFolderThreadCount(workspaceFolders, item.id)
                              }),
                              folderHasRunning ? runningLabel : ''
                            ].filter(Boolean).join(' - ')}
                            onClick={() =>
                              persistSidebarCollapse((current) =>
                                setSidebarFolderCollapsed(
                                  current,
                                  workspacePath,
                                  item.id,
                                  !folderCollapsed
                                )
                              )
                            }
                            onContextMenu={(event) => openFolderContextMenu(event, workspacePath, item)}
                            onDragOver={(event) => handleFolderDragOver(event, workspacePath, item.id)}
                            onDragLeave={(event) => handleFolderDragLeave(event, workspacePath, item.id)}
                            onDrop={(event) => handleFolderDrop(event, workspacePath, item.id)}
                            className={`min-h-[32px] ${
                              isFolderDragOver
                                ? 'bg-accent/10 shadow-[inset_0_0_0_1px_rgba(79,124,255,0.32)]'
                                : ''
                            }`}
                            buttonClassName="items-center gap-1.5 px-2 py-1.5"
                            actionsVisibility="hidden"
                            actionsLayout="overlay"
                            actions={
                              <>
                                <SidebarIconButton
                                  onClick={() => openCreateFolderDialog(workspacePath, item.id)}
                                  title={t('sidebarFolderCreateChild')}
                                  ariaLabel={t('sidebarFolderCreateChild')}
                                  className="h-6 w-6"
                                  stopPropagation
                                >
                                  <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.8} />
                                </SidebarIconButton>
                                <SidebarIconButton
                                  onClick={() => void handleCreateThreadInFolder(workspacePath, item.id)}
                                  title={t('sidebarWorkspaceNewThread')}
                                  ariaLabel={t('sidebarWorkspaceNewThread')}
                                  className="h-6 w-6"
                                  stopPropagation
                                >
                                  <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
                                </SidebarIconButton>
                              </>
                            }
                          >
                            {folderCollapsed
                              ? <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
                              : <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />}
                            {folderCollapsed
                              ? <Folder className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.8} />
                              : <FolderOpen className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.8} />}
                            <span className="min-w-0 flex-1 truncate text-[13px] text-ds-ink">
                              {item.name}
                            </span>
                            {folderHasRunning ? <ThreadRunningIndicator label={runningLabel} /> : null}
                            <span className="shrink-0 rounded-md bg-ds-card/70 px-1.5 py-0.5 text-[10.5px] text-ds-faint tabular-nums transition group-hover:opacity-0 group-focus-within:opacity-0">
                              {sidebarFolderThreadCount(workspaceFolders, item.id)}
                            </span>
                          </SidebarTreeRow>
                          {!folderCollapsed ? (
                            <div className="space-y-[3px] pl-4 pt-[3px]">
                              {childFolders.map(renderFolder)}
                              {folderThreads.map((thread) => renderThreadRow(thread, workspacePath, item.id))}
                              {folderThreads.length === 0 && childFolders.length === 0 ? (
                                <div className="px-2.5 py-1.5 text-[12px] leading-5 text-ds-faint">
                                  {t('sidebarFolderEmpty')}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      )
                    }
                    return renderFolder(folder)
                  })}
                  {rootThreads.length === 0 && rootFolders.length === 0 ? (
                    threadListStatus === 'ready' ? (
                      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                        <div className="text-[12.5px] leading-5 text-ds-faint">
                          {searchQuery.trim()
                            ? t('sidebarSearchEmpty')
                            : showArchived
                              ? t('sidebarArchiveEmpty')
                              : t('sidebarWorkspaceEmpty')}
                        </div>
                        {!showArchived && !searchQuery.trim() ? (
                          <button
                            type="button"
                            data-cursor-spotlight-target
                            onClick={() => onCreateThreadInWorkspace(workspacePath)}
                            className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink"
                          >
                            {t('sidebarWorkspaceNewThread')}
                          </button>
                        ) : null}
                      </div>
                    ) : threadListStatus === 'error' ? (
                      <div className="px-2.5 py-1.5">
                        <p className="text-[12.5px] leading-5 text-ds-faint">{t('sidebarWorkspaceLoadError')}</p>
                        <button
                          type="button"
                          data-cursor-spotlight-target
                          onClick={onRetryThreads}
                          className="mt-1 rounded-md px-2 py-1 text-[12px] font-medium text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink"
                        >
                          {t('retryConnection')}
                        </button>
                      </div>
                    ) : (
                      <SidebarThreadSkeleton />
                    )
                  ) : visibleThreads.map((thread) => renderThreadRow(thread, workspacePath, null))}
                  {hasMoreProjectThreads || rootThreads.length > 5 ? (
                    <button
                      type="button"
                      data-cursor-spotlight-target
                      onClick={() => {
                        if (workspaceCursor?.hasMore === true) {
                          onLoadMoreThreads(workspacePath)
                          return
                        }
                        setExpandedWorkspaces((current) => ({
                          ...current,
                          [workspacePath]: nextSidebarProjectExpansionStage(
                            rootThreads.length,
                            current[workspacePath] ?? 0
                          )
                        }))
                      }}
                      className="ml-1 mt-1 rounded-md px-2.5 py-1.5 text-[12.5px] text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink"
                    >
                      {hasMoreProjectThreads
                        ? t('sidebarWorkspaceShowMore', {
                            count: Math.max(
                              hiddenThreadCount,
                              knownWorkspaceRemoteCount
                            )
                          })
                        : t('sidebarWorkspaceShowLess')}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {threadContextMenu ? (
        <ThreadContextMenu
          state={threadContextMenu}
          busy={deletingThreadIds[threadContextMenu.thread.id] === true}
          moveDisabled={busy || Boolean(threadMoveDisabledReason(threadContextMenu.thread, threadContextMenu.worktreeRecord))}
          moveDisabledTitle={threadMoveDisabledReason(threadContextMenu.thread, threadContextMenu.worktreeRecord) || undefined}
          onClose={() => setThreadContextMenu(null)}
          onMove={() => openMoveThreadDialog(threadContextMenu.thread, threadContextMenu.worktreeRecord)}
          onPin={() => void handlePinThread(threadContextMenu.thread, threadContextMenu.thread.pinned !== true)}
          onRename={() => openRenameThreadDialog(threadContextMenu.thread)}
          onSummarize={() => void handleSummarizeThread(threadContextMenu.thread)}
          onCopyId={() => void handleCopyThreadId(threadContextMenu.thread)}
          onArchive={() => void handleArchiveThread(threadContextMenu.thread)}
          onDelete={() => void handleDeleteThread(threadContextMenu.thread)}
          onRestore={() => void handleRestoreThread(threadContextMenu.thread)}
          t={t}
        />
      ) : null}

      {workspaceContextMenu ? (
        <WorkspaceContextMenu
          state={workspaceContextMenu}
          onClose={() => setWorkspaceContextMenu(null)}
          onNewThread={() => onCreateThreadInWorkspace(workspaceContextMenu.workspacePath)}
          onNewFolder={() => openCreateFolderDialog(workspaceContextMenu.workspacePath)}
          onOpenInSystem={() => void openWorkspaceInSystem(workspaceContextMenu.workspacePath)}
          onArchiveThreads={() => void handleArchiveWorkspaceThreads(workspaceContextMenu.workspacePath)}
          onRemove={() => void handleRemoveWorkspace(workspaceContextMenu.workspacePath)}
          archiveDisabled={archivableWorkspaceThreads(workspaceContextMenu.workspacePath).length === 0}
          t={t}
        />
      ) : null}

      {folderContextMenu ? (
        <FolderContextMenu
          state={folderContextMenu}
          onClose={() => setFolderContextMenu(null)}
          onNewThread={() =>
            void handleCreateThreadInFolder(
              folderContextMenu.workspacePath,
              folderContextMenu.folder.id
            )
          }
          onNewFolder={() =>
            openCreateFolderDialog(
              folderContextMenu.workspacePath,
              folderContextMenu.folder.id
            )
          }
          onRename={() =>
            openRenameFolderDialog(folderContextMenu.workspacePath, folderContextMenu.folder)
          }
          onDelete={() =>
            handleDeleteFolder(folderContextMenu.workspacePath, folderContextMenu.folder)
          }
          t={t}
        />
      ) : null}

      {renameThreadDialog ? (
        <ThreadRenameDialog
          state={renameThreadDialog}
          onClose={closeRenameThreadDialog}
          onValueChange={(value) =>
            setRenameThreadDialog((current) => current ? { ...current, value } : current)
          }
          onSubmit={(event) => void submitRenameThreadDialog(event)}
          t={t}
        />
      ) : null}

      {folderDialog ? (
        <SidebarFolderDialog
          state={folderDialog}
          onClose={() => setFolderDialog(null)}
          onValueChange={(value) =>
            setFolderDialog((current) => current ? { ...current, value, error: '' } : current)
          }
          onSubmit={submitFolderDialog}
          t={t}
        />
      ) : null}

      {moveThreadDialog ? (
        <MoveThreadDialog
          state={moveThreadDialog}
          onClose={closeMoveThreadDialog}
          onPickTarget={(targetWorkspace) =>
            confirmThreadWorkspaceMove(
              moveThreadDialog.thread,
              targetWorkspace,
              worktreeRecordForSidebarThread(moveThreadDialog.thread, threadWorktrees)
            )
          }
          onConfirm={submitMoveThreadDialog}
          t={t}
        />
      ) : null}

      {actionDialog ? (
        <SidebarActionDialog
          state={actionDialog}
          onClose={closeActionDialog}
          onConfirm={() => void submitActionDialog()}
          t={t}
        />
      ) : null}
    </div>
  )
}
