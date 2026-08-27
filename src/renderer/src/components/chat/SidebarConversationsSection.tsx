import {
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, MessageCirclePlus, Plus, Search } from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { defaultConversationWorkspaceRoot, isConversationWorkspacePath } from '../../lib/workspace-path'
import {
  SidebarIconButton,
  SidebarSearchField
} from '../sidebar/SidebarPrimitives'
import {
  RenameThreadDialogState,
  ThreadRow,
  ThreadRenameDialog,
  ThreadRunningIndicator,
  sortSidebarThreads
} from './SidebarProjectsSection'
import { useChatStore } from '../../store/chat-store'
import {
  sidebarThreadActivity,
  sidebarThreadsHaveRunningActivity
} from './sidebar-project-selectors'
import { createSidebarThreadOrderTracker } from './sidebar-thread-order-tracker'
import {
  SIDEBAR_THREAD_DRAG_DATA_KEY,
  readSidebarOrderRegistry,
  reconcileSidebarThreadOrder,
  reorderSidebarThreadIds,
  saveSidebarOrderRegistry,
  setSidebarThreadOrder,
  sidebarDropPosition,
  sidebarThreadOrderScope,
  type SidebarDropPosition,
  type SidebarOrderRegistry
} from './sidebar-order'

type Props = {
  threads: NormalizedThread[]
  activeThreadId: string | null
  runtimeReady: boolean
  conversationRoot: string
  onNewConversation: () => void
  onSelectThread: (threadId: string) => void
  onRenameThread: (threadId: string, title: string) => Promise<void>
  onPinThread: (threadId: string, pinned: boolean) => Promise<void>
  onArchiveThread: (threadId: string) => Promise<void>
  onDeleteThread: (threadId: string) => Promise<void>
  onRestoreThread: (threadId: string) => Promise<void>
  t: (k: string, opts?: Record<string, unknown>) => string
}

type LocalRenameState = RenameThreadDialogState

export function SidebarConversationsSection({
  threads,
  activeThreadId,
  runtimeReady,
  conversationRoot,
  onNewConversation,
  onSelectThread,
  onRenameThread,
  onPinThread,
  onArchiveThread,
  onDeleteThread,
  onRestoreThread,
  t
}: Props): ReactElement {
  const orderTracker = useRef(createSidebarThreadOrderTracker()).current
  const { i18n } = useTranslation('common')
  const locale = i18n.language
  const busy = useChatStore((s) => s.busy)
  const watchTurnCompletion = useChatStore((s) => s.watchTurnCompletion)
  const unreadThreadIds = useChatStore((s) => s.unreadThreadIds)
  const scheduledThreadActivities = useChatStore((s) => s.scheduledThreadActivities)
  const awaitingUserInputThreadIds = useChatStore((s) => s.awaitingUserInputThreadIds)

  const [collapsed, setCollapsed] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [deletingThreadIds, setDeletingThreadIds] = useState<Record<string, boolean>>({})
  const [renameState, setRenameState] = useState<LocalRenameState | null>(null)
  const [sidebarOrder, setSidebarOrder] = useState<SidebarOrderRegistry>(() => readSidebarOrderRegistry())
  const [draggingThreadId, setDraggingThreadId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ threadId: string; position: SidebarDropPosition } | null>(null)

  const conversationOrderScopePath = conversationRoot.trim() || defaultConversationWorkspaceRoot()
  const conversationOrderScope = sidebarThreadOrderScope(conversationOrderScopePath)

  const sidebarThreadActivityContext = useMemo(() => ({
    activeThreadId,
    busy,
    watchTurnCompletion,
    unreadThreadIds,
    scheduledThreadActivities,
    awaitingUserInputThreadIds
  }), [activeThreadId, awaitingUserInputThreadIds, busy, scheduledThreadActivities, unreadThreadIds, watchTurnCompletion])

  const allConversationThreads = useMemo(() => {
    const savedOrder = sidebarOrder.threadIdsByScope[conversationOrderScope] ?? []
    const baseThreads = reconcileSidebarThreadOrder(
      sortSidebarThreads(threads.filter((thread) =>
        isConversationWorkspacePath(thread.workspace, conversationRoot) && thread.archived !== true
      )),
      savedOrder
    )
    return orderTracker.reconcile({
      baselineKey: savedOrder.join('\n'),
      containerKey: `conversations:${conversationOrderScope}`,
      context: sidebarThreadActivityContext,
      threads: baseThreads
    })
  }, [conversationOrderScope, conversationRoot, orderTracker, sidebarOrder.threadIdsByScope, sidebarThreadActivityContext, threads])

  const conversationThreads = useMemo(() => {
    const query = search.trim().toLowerCase()
    return allConversationThreads.filter((thread) => {
      if (!query) return true
      const haystack = [thread.title, thread.preview, thread.workspace]
        .filter(Boolean)
        .join('\n')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [
    allConversationThreads,
    search
  ])

  const conversationsHaveRunning = sidebarThreadsHaveRunningActivity(
    allConversationThreads,
    sidebarThreadActivityContext
  )
  const runningLabel = t('sidebarThreadRunning')

  const handlePin = (threadId: string, pinned: boolean): void => {
    void onPinThread(threadId, pinned)
  }

  const handleArchive = (threadId: string): void => {
    void onArchiveThread(threadId)
  }

  const handleDelete = async (threadId: string): Promise<void> => {
    setDeletingThreadIds((current) => ({ ...current, [threadId]: true }))
    try {
      await onDeleteThread(threadId)
    } finally {
      setDeletingThreadIds((current) => {
        const next = { ...current }
        delete next[threadId]
        return next
      })
    }
  }

  const openRename = (thread: NormalizedThread): void => {
    setRenameState({ thread, value: thread.title, submitting: false })
  }

  const submitRename = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!renameState) return
    const nextTitle = renameState.value.trim()
    if (!nextTitle || nextTitle === renameState.thread.title) return
    setRenameState({ ...renameState, submitting: true })
    try {
      await onRenameThread(renameState.thread.id, nextTitle)
      setRenameState(null)
    } finally {
      setRenameState((current) => (current ? { ...current, submitting: false } : current))
    }
  }

  const noOp = (): void => {}

  const persistSidebarOrder = (
    update: (current: SidebarOrderRegistry) => SidebarOrderRegistry
  ): void => {
    const next = update(readSidebarOrderRegistry())
    saveSidebarOrderRegistry(next)
    setSidebarOrder(next)
  }

  const handleDragStart = (
    event: ReactDragEvent<HTMLDivElement>,
    threadId: string
  ): void => {
    if (!threadId.trim() || deletingThreadIds[threadId] === true) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(SIDEBAR_THREAD_DRAG_DATA_KEY, threadId)
    setDraggingThreadId(threadId)
    setDropTarget(null)
  }

  const handleDragEnd = (): void => {
    setDraggingThreadId(null)
    setDropTarget(null)
  }

  const handleDragOver = (
    event: ReactDragEvent<HTMLDivElement>,
    targetThreadId: string
  ): void => {
    const sourceId = draggingThreadId || event.dataTransfer.getData(SIDEBAR_THREAD_DRAG_DATA_KEY)
    if (!sourceId || sourceId === targetThreadId) return
    if (!allConversationThreads.some((thread) => thread.id === sourceId)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    setDropTarget({
      threadId: targetThreadId,
      position: sidebarDropPosition(event.clientY, rect.top, rect.height)
    })
  }

  const handleDragLeave = (
    event: ReactDragEvent<HTMLDivElement>,
    threadId: string
  ): void => {
    if (
      event.relatedTarget instanceof Node
      && event.currentTarget.contains(event.relatedTarget)
    ) return
    setDropTarget((current) => current?.threadId === threadId ? null : current)
  }

  const handleDrop = (
    event: ReactDragEvent<HTMLDivElement>,
    targetThreadId: string
  ): void => {
    const sourceId = draggingThreadId || event.dataTransfer.getData(SIDEBAR_THREAD_DRAG_DATA_KEY)
    if (!sourceId || sourceId === targetThreadId) return
    if (!allConversationThreads.some((thread) => thread.id === sourceId)) return
    event.preventDefault()
    const orderedIds = allConversationThreads.map((thread) => thread.id)
    const rect = event.currentTarget.getBoundingClientRect()
    const nextIds = reorderSidebarThreadIds({
      threadIds: orderedIds,
      sourceId,
      targetId: targetThreadId,
      position: sidebarDropPosition(event.clientY, rect.top, rect.height)
    })
    persistSidebarOrder((current) => setSidebarThreadOrder(current, conversationOrderScopePath, nextIds))
    setDraggingThreadId(null)
    setDropTarget(null)
  }

  return (
    <div className="ds-no-drag flex shrink-0 flex-col">
      <div className="flex min-h-[34px] items-center justify-between px-2 pb-1 pt-2">
        <button
          type="button"
          onClick={() => setCollapsed((open) => !open)}
          className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-muted"
          title={t('sidebarConversations')}
          aria-label={[
            t('sidebarConversations'),
            conversationsHaveRunning ? runningLabel : ''
          ].filter(Boolean).join(' - ')}
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={2} />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={2} />
          )}
          <span className="truncate">{t('sidebarConversations')}</span>
          {conversationsHaveRunning ? <ThreadRunningIndicator label={runningLabel} /> : null}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <SidebarIconButton
            onClick={() => setSearchOpen((open) => !open)}
            active={searchOpen}
            className="h-7 w-7"
            title={t('sidebarSearchThreads')}
            ariaLabel={t('sidebarSearchThreads')}
          >
            <Search className="h-3.5 w-3.5" strokeWidth={1.85} />
          </SidebarIconButton>
          <SidebarIconButton
            onClick={runtimeReady ? onNewConversation : undefined}
            disabled={!runtimeReady}
            className="h-7 w-7"
            title={t('newConversation')}
            ariaLabel={t('newConversation')}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          </SidebarIconButton>
        </div>
      </div>

      {searchOpen ? (
        <div className="mb-1 flex items-center gap-1 px-2">
          <SidebarSearchField
            value={search}
            onChange={setSearch}
            placeholder={t('sidebarSearchThreads')}
            clearLabel={t('clear')}
          />
        </div>
      ) : null}

      {!collapsed ? (
        <div className="max-h-[40vh] min-h-0 shrink-0 overflow-y-auto px-1 pb-2 pt-0.5">
          {conversationThreads.length === 0 ? (
            <button
              type="button"
              onClick={runtimeReady ? onNewConversation : undefined}
              disabled={!runtimeReady}
              className="flex w-full flex-col items-center gap-2 px-4 py-6 text-center transition hover:bg-[var(--ds-sidebar-row-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <MessageCirclePlus className="h-6 w-6 text-ds-faint" strokeWidth={1.5} />
              <p className="text-[12.5px] leading-5 text-ds-faint">{t('conversationsEmptyHint')}</p>
            </button>
          ) : null}

          {conversationThreads.map((thread) => {
            const activity = sidebarThreadActivity(thread, sidebarThreadActivityContext)
            return <ThreadRow
              key={thread.id}
              thread={thread}
              active={activeThreadId === thread.id}
              deleting={deletingThreadIds[thread.id] === true}
              locale={locale}
              showRunning={activity === 'running'}
              showFailed={activity === 'failed'}
              showUnread={activity === 'unread'}
              showAwaitingInput={activity === 'awaiting-input'}
              scheduledActivity={activity === 'scheduled'
                ? scheduledThreadActivities[thread.id]
                : undefined}
              onSelect={() => onSelectThread(thread.id)}
              onContextMenu={noOp}
              onPreviewOpen={noOp}
              onPreviewClose={noOp}
              draggable={deletingThreadIds[thread.id] !== true}
              dragging={draggingThreadId === thread.id}
              dropPosition={dropTarget?.threadId === thread.id ? dropTarget.position : null}
              onDragStart={(event) => handleDragStart(event, thread.id)}
              onDragEnd={handleDragEnd}
              onDragOver={(event) => handleDragOver(event, thread.id)}
              onDragLeave={(event) => handleDragLeave(event, thread.id)}
              onDrop={(event) => handleDrop(event, thread.id)}
              onPin={() => handlePin(thread.id, thread.pinned !== true)}
              onRename={() => openRename(thread)}
              onArchive={() => handleArchive(thread.id)}
              onDelete={() => void handleDelete(thread.id)}
              onRestore={() => void onRestoreThread(thread.id)}
            />
          })}
        </div>
      ) : null}

      {renameState ? (
        <ThreadRenameDialog
          state={renameState}
          onClose={() => setRenameState(null)}
          onValueChange={(value) => setRenameState((current) => (current ? { ...current, value } : current))}
          onSubmit={submitRename}
          t={t}
        />
      ) : null}
    </div>
  )
}
