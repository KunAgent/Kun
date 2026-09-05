import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactElement
} from 'react'
import { AlertTriangle, Columns3, RefreshCw, WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../../store/chat-store'
import { normalizeWorkspaceRoot, workspaceRootIdentityKey } from '../../lib/workspace-path'
import { openWorkspaceFileWithSystemDefault } from '../../lib/open-workspace-path'
import { resolveProjectWorkspacePath } from '../../lib/worktree-project-path'
import { readThreadWorktreeRegistry } from '../../lib/thread-worktree-registry'
import { useProjectBoardStore } from '../../project-board/project-board-store'
import { selectVisibleProjectBoardCards } from '../../project-board/project-board-selectors'
import {
  EMPTY_PROJECT_BOARD_SELECTION,
  projectBoardSelectionCards,
  reconcileProjectBoardSelection,
  selectionForProjectBoardDrag,
  setProjectBoardColumnSelection,
  toggleProjectBoardCardSelection,
  type ProjectBoardSelection
} from '../../project-board/project-board-selection'
import {
  PROJECT_BOARD_DRAG_MIME,
  type ProjectBoardCard,
  type ProjectBoardStatus
} from '../../project-board/project-board-types'
import { ProjectBoard } from './ProjectBoard'
import { ProjectBoardArchive } from './ProjectBoardArchive'
import { ProjectBoardCardDialog, type ProjectBoardCardDraft } from './ProjectBoardCardDialog'
import { ProjectBoardHeader } from './ProjectBoardHeader'
import { ProjectBoardOverview } from './ProjectBoardOverview'
import { ProjectBoardToolbar } from './ProjectBoardToolbar'
import { ProjectBoardSelectionToolbar } from './ProjectBoardSelectionToolbar'

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
}

export function ProjectBoardView(props: Props): ReactElement {
  const { t } = useTranslation('common')
  const runtimeReady = useChatStore((state) => state.runtimeConnection === 'ready')
  const workspaceRoot = useChatStore((state) => state.workspaceRoot)
  const workspaceRoots = useChatStore((state) => state.codeWorkspaceRoots)
  const board = useProjectBoardStore(useShallow((state) => ({
    selectedWorkspaceRoot: state.selectedWorkspaceRoot,
    snapshot: state.snapshotByWorkspace[state.selectedWorkspaceRoot],
    loading: state.loading,
    mutatingCardIds: state.mutatingCardIds,
    loadedAt: state.loadedAtByWorkspace[state.selectedWorkspaceRoot] ?? 0,
    error: state.error,
    searchQuery: state.searchQuery,
    filters: state.filters,
    activeTab: state.activeTab,
    selectWorkspace: state.selectWorkspace,
    setSearchQuery: state.setSearchQuery,
    setFilters: state.setFilters,
    setActiveTab: state.setActiveTab,
    loadBoard: state.loadBoard,
    loadMore: state.loadMore,
    createManualCard: state.createManualCard,
    patchManualCard: state.patchManualCard,
    deleteManualCard: state.deleteManualCard,
    patchTodoOverlay: state.patchTodoOverlay,
    moveCards: state.moveCards
  })))
  const selectBoardWorkspace = board.selectWorkspace
  const loadBoard = board.loadBoard
  const patchManualCard = board.patchManualCard
  const patchTodoOverlay = board.patchTodoOverlay
  const moveBoardCards = board.moveCards
  const deleteManualCard = board.deleteManualCard
  const [dialog, setDialog] = useState<{ card?: ProjectBoardCard; status: ProjectBoardStatus } | null>(null)
  const [selection, setSelection] = useState<ProjectBoardSelection>(EMPTY_PROJECT_BOARD_SELECTION)
  const selected = board.selectedWorkspaceRoot
  const snapshot = board.snapshot
  const threadWorktrees = readThreadWorktreeRegistry().worktrees
  const todoRevision = useChatStore((state) => state.threads
    .filter((thread) => {
      const resolved = resolveProjectWorkspacePath(thread.workspace ?? '', {
        threadWorktrees,
        candidateProjectPaths: [selected, workspaceRoot, ...workspaceRoots]
      })
      return workspaceRootIdentityKey(resolved) === workspaceRootIdentityKey(selected)
    })
    .map((thread) => `${thread.id}:${thread.todos?.updatedAt ?? ''}`)
    .sort()
    .join('|'))

  useEffect(() => {
    if (selected) return
    const fallback = normalizeWorkspaceRoot(workspaceRoot) || workspaceRoots[0]
    if (fallback) selectBoardWorkspace(fallback)
  }, [selectBoardWorkspace, selected, workspaceRoot, workspaceRoots])

  useEffect(() => {
    if (selected && runtimeReady) void loadBoard(selected)
  }, [loadBoard, runtimeReady, selected])

  useEffect(() => {
    if (!selected || !runtimeReady) return
    const refreshIfStale = (): void => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - board.loadedAt >= 30_000
      ) void loadBoard(selected)
    }
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadBoard(selected)
    }, 60_000)
    window.addEventListener('focus', refreshIfStale)
    document.addEventListener('visibilitychange', refreshIfStale)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshIfStale)
      document.removeEventListener('visibilitychange', refreshIfStale)
    }
  }, [board.loadedAt, loadBoard, runtimeReady, selected])

  const todoRevisionRef = useRef(todoRevision)
  useEffect(() => {
    if (!runtimeReady || todoRevision === todoRevisionRef.current) return
    todoRevisionRef.current = todoRevision
    const timer = window.setTimeout(() => void loadBoard(selected, { force: true }), 250)
    return () => window.clearTimeout(timer)
  }, [loadBoard, runtimeReady, selected, todoRevision])

  const visible = useMemo(() => selectVisibleProjectBoardCards({
    cards: snapshot?.cards ?? [],
    searchQuery: board.searchQuery,
    filters: board.filters,
    archived: board.activeTab === 'archive'
  }), [board.activeTab, board.filters, board.searchQuery, snapshot?.cards])
  const disabled = !runtimeReady
  const selectedCards = useMemo(
    () => projectBoardSelectionCards(selection, visible),
    [selection, visible]
  )
  const selectionBusy = selection.cardIds.some((id) => board.mutatingCardIds[id] === true)

  useEffect(() => {
    setSelection((current) => {
      if (current.cardIds.some((id) => board.mutatingCardIds[id] === true)) return current
      const next = reconcileProjectBoardSelection(current, visible)
      return sameSelection(current, next) ? current : next
    })
  }, [board.mutatingCardIds, visible])

  useEffect(() => {
    setSelection(EMPTY_PROJECT_BOARD_SELECTION)
  }, [selected, board.activeTab])

  useEffect(() => {
    const clearSelection = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSelection(EMPTY_PROJECT_BOARD_SELECTION)
    }
    window.addEventListener('keydown', clearSelection)
    return () => window.removeEventListener('keydown', clearSelection)
  }, [])

  const editOverlay = useCallback((card: ProjectBoardCard, patch: { archived?: boolean }): void => {
    if (card.kind === 'manual') void patchManualCard(card.id, patch)
    else void patchTodoOverlay(card, patch)
  }, [patchManualCard, patchTodoOverlay])
  const openThread = useCallback((card: ProjectBoardCard): void => {
    if (card.source.threadId) void useChatStore.getState().selectThread(card.source.threadId)
  }, [])
  const openPlan = useCallback((card: ProjectBoardCard): void => {
    if (card.source.planRelativePath) {
      void openWorkspaceFileWithSystemDefault(card.source.planRelativePath, card.workspaceRoot)
    }
  }, [])
  const toggleSelection = useCallback((
    card: ProjectBoardCard,
    options: { range: boolean }
  ): void => {
    const orderedCardIds = visible
      .filter((candidate) => candidate.status === card.status)
      .map((candidate) => candidate.id)
    setSelection((current) => toggleProjectBoardCardSelection({
      selection: current,
      card,
      orderedCardIds,
      range: options.range
    }))
  }, [visible])
  const toggleColumnSelection = useCallback((
    status: ProjectBoardStatus,
    cards: ProjectBoardCard[],
    shouldSelect: boolean
  ): void => {
    setSelection(setProjectBoardColumnSelection(
      status,
      cards.map((card) => card.id),
      shouldSelect
    ))
  }, [])
  const moveCards = useCallback(async (
    cards: ProjectBoardCard[],
    status: ProjectBoardStatus
  ): Promise<void> => {
    const result = await moveBoardCards(cards, status)
    const failed = new Set(result.failedCardIds)
    setSelection((current) => {
      const cardIds = current.cardIds.filter((id) => failed.has(id))
      return cardIds.length > 0
        ? { ...current, cardIds, anchorId: cardIds[0] ?? null }
        : EMPTY_PROJECT_BOARD_SELECTION
    })
  }, [moveBoardCards])
  const dragCard = useCallback((card: ProjectBoardCard, event: DragEvent<HTMLElement>): void => {
    const dragSelection = selectionForProjectBoardDrag(selection, card)
    if (!sameSelection(selection, dragSelection)) setSelection(dragSelection)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(PROJECT_BOARD_DRAG_MIME, JSON.stringify({
      cardIds: dragSelection.cardIds,
      status: dragSelection.status
    }))
    setProjectBoardDragImage(event, dragSelection.cardIds.length)
  }, [selection])
  const moveOneCard = useCallback((card: ProjectBoardCard, status: ProjectBoardStatus): void => {
    void moveCards([card], status)
  }, [moveCards])
  const editCard = useCallback((card: ProjectBoardCard): void => {
    setDialog({ card, status: card.status })
  }, [])
  const archiveCard = useCallback((card: ProjectBoardCard, archived: boolean): void => {
    editOverlay(card, { archived })
  }, [editOverlay])
  const deleteCard = useCallback((card: ProjectBoardCard): void => {
    if (window.confirm(t('projectBoardDeleteConfirm'))) void deleteManualCard(card.id)
  }, [deleteManualCard, t])
  const submitDialog = async (draft: ProjectBoardCardDraft): Promise<void> => {
    if (!dialog) return
    if (!dialog.card) {
      const id = await board.createManualCard({
        title: draft.title,
        description: draft.description,
        status: draft.status,
        category: draft.category ?? 'other',
        priority: draft.priority
      })
      if (!id) return
      setDialog(null)
      requestAnimationFrame(() => document.getElementById(`project-board-${cssId(id)}`)?.focus())
      return
    }
    if (dialog.card.kind === 'manual') {
      await board.patchManualCard(dialog.card.id, {
        title: draft.title,
        description: draft.description,
        status: draft.status,
        category: draft.category ?? 'other',
        priority: draft.priority
      })
    } else {
      await board.patchTodoOverlay(dialog.card, {
        description: draft.description,
        category: draft.category,
        priority: draft.priority
      })
    }
    if (!useProjectBoardStore.getState().error) setDialog(null)
  }

  if (!selected) {
    return <EmptyWorkspace leftSidebarCollapsed={props.leftSidebarCollapsed} onToggleLeftSidebar={props.onToggleLeftSidebar} />
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-ds-main text-ds-ink">
      <ProjectBoardHeader
        workspaceRoot={selected}
        activeTab={board.activeTab}
        leftSidebarCollapsed={props.leftSidebarCollapsed}
        onToggleLeftSidebar={props.onToggleLeftSidebar}
        onTab={board.setActiveTab}
        onNewTask={() => setDialog({ status: 'pending' })}
      />
      {!runtimeReady ? (
        <div className="ds-no-drag flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-6 py-2 text-xs text-amber-800 dark:text-amber-200">
          <WifiOff className="h-3.5 w-3.5" /> {t('projectBoardOffline')}
        </div>
      ) : null}
      {board.error ? (
        <div className="ds-no-drag flex items-center gap-2 border-b border-red-500/20 bg-red-500/10 px-6 py-2 text-xs text-red-700 dark:text-red-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className="min-w-0 flex-1 truncate">{board.error}</span>
          <button type="button" onClick={() => void board.loadBoard(selected, { force: true })} className="flex items-center gap-1 hover:underline">
            <RefreshCw className="h-3 w-3" /> {t('projectBoardRetry')}
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        {board.loading && !snapshot ? (
          <BoardSkeleton />
        ) : board.activeTab === 'overview' ? (
          <ProjectBoardOverview cards={snapshot?.cards ?? []} />
        ) : board.activeTab === 'archive' ? (
          <ProjectBoardArchive cards={visible} disabled={disabled} onRestore={(card) => editOverlay(card, { archived: false })} />
        ) : (
          <div className="flex h-full min-h-0 gap-4 overflow-x-auto overflow-y-hidden p-4 sm:p-5">
            <ProjectBoardToolbar
              query={board.searchQuery}
              filters={board.filters}
              resultCount={visible.length}
              onQuery={board.setSearchQuery}
              onFilters={board.setFilters}
            />
            <div className="min-h-0 flex-1">
              {visible.length === 0 && (snapshot?.counts.total ?? 0) === 0 ? (
                <BoardEmpty onNew={() => setDialog({ status: 'pending' })} />
              ) : (
                <ProjectBoard
                  cards={visible}
                  disabled={disabled}
                  mutatingCardIds={board.mutatingCardIds}
                  selection={selection}
                  onAdd={(status) => setDialog({ status })}
                  onMove={moveOneCard}
                  onMoveCards={(cards, status) => void moveCards(cards, status)}
                  onToggleSelect={toggleSelection}
                  onToggleColumnSelection={toggleColumnSelection}
                  onDragCard={dragCard}
                  onEdit={editCard}
                  onArchive={archiveCard}
                  onDelete={deleteCard}
                  onOpenThread={openThread}
                  onOpenPlan={openPlan}
                />
              )}
              {snapshot?.truncated ? (
                <button type="button" onClick={() => void board.loadMore(selected)} className="mt-2 text-xs text-accent hover:underline">
                  {t('projectBoardLoadMore')}
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
      {selection.status && selection.cardIds.length > 0 ? (
        <ProjectBoardSelectionToolbar
          count={selection.cardIds.length}
          sourceStatus={selection.status}
          disabled={disabled || selectionBusy}
          onMove={(status) => void moveCards(selectedCards, status)}
          onClear={() => setSelection(EMPTY_PROJECT_BOARD_SELECTION)}
        />
      ) : null}
      {dialog ? (
        <ProjectBoardCardDialog
          card={dialog.card}
          initialStatus={dialog.status}
          busy={Object.keys(board.mutatingCardIds).length > 0}
          onClose={() => setDialog(null)}
          onSubmit={submitDialog}
        />
      ) : null}
    </div>
  )
}

function EmptyWorkspace(props: Props): ReactElement {
  const { t } = useTranslation('common')
  return <div className="flex h-full items-center justify-center bg-ds-main text-sm text-ds-faint">{t('projectBoardNoProjects')}</div>
}
function BoardEmpty({ onNew }: { onNew: () => void }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="flex h-full min-h-[460px] min-w-[700px] flex-col items-center justify-center rounded-2xl border border-dashed border-ds-border-muted text-center">
      <Columns3 className="h-9 w-9 text-ds-faint" strokeWidth={1.3} />
      <h2 className="mt-3 text-sm font-semibold text-ds-ink">{t('projectBoardNoTasks')}</h2>
      <p className="mt-1 max-w-sm text-xs leading-5 text-ds-muted">{t('projectBoardNoTasksHint')}</p>
      <button type="button" onClick={onNew} className="mt-4 rounded-xl bg-accent px-4 py-2 text-xs font-medium text-white">{t('projectBoardNewTask')}</button>
    </div>
  )
}
function BoardSkeleton(): ReactElement {
  return <div className="grid h-full min-w-[930px] grid-cols-3 gap-4 p-5">{[0, 1, 2].map((column) => <div key={column} className="animate-pulse rounded-2xl border border-ds-border-muted bg-ds-main/50 p-3"><div className="h-5 w-24 rounded bg-ds-card" /><div className="mt-5 h-28 rounded-xl bg-ds-card" /><div className="mt-3 h-28 rounded-xl bg-ds-card" /></div>)}</div>
}
function cssId(value: string): string { return value.replace(/[^A-Za-z0-9_-]/g, '-') }

function sameSelection(
  left: ProjectBoardSelection,
  right: ProjectBoardSelection
): boolean {
  return left.status === right.status &&
    left.anchorId === right.anchorId &&
    left.cardIds.length === right.cardIds.length &&
    left.cardIds.every((id, index) => id === right.cardIds[index])
}

function setProjectBoardDragImage(
  event: DragEvent<HTMLElement>,
  count: number
): void {
  if (count <= 1) return
  const preview = document.createElement('div')
  preview.textContent = String(count)
  preview.style.cssText = [
    'position:fixed',
    'left:-9999px',
    'top:-9999px',
    'width:44px',
    'height:32px',
    'border-radius:10px',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'background:#2563eb',
    'color:white',
    'font:600 13px system-ui',
    'box-shadow:0 6px 18px rgba(0,0,0,.2)'
  ].join(';')
  document.body.appendChild(preview)
  event.dataTransfer.setDragImage(preview, 22, 16)
  window.setTimeout(() => preview.remove(), 0)
}
