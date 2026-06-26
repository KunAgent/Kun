import { useMemo, useState, type FormEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, MessageCirclePlus, Plus, Search } from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { isConversationWorkspacePath } from '../../lib/workspace-path'
import {
  SidebarIconButton,
  SidebarSearchField
} from '../sidebar/SidebarPrimitives'
import {
  RenameThreadDialogState,
  ThreadRow,
  ThreadRenameDialog,
  sortSidebarThreads
} from './SidebarProjectsSection'
import { useChatStore } from '../../store/chat-store'

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
  const { i18n } = useTranslation('common')
  const locale = i18n.language
  const watchTurnCompletion = useChatStore((s) => s.watchTurnCompletion)
  const unreadThreadIds = useChatStore((s) => s.unreadThreadIds)

  const [collapsed, setCollapsed] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [deletingThreadIds, setDeletingThreadIds] = useState<Record<string, boolean>>({})
  const [renameState, setRenameState] = useState<LocalRenameState | null>(null)

  const conversationThreads = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = threads.filter((thread) => {
      if (!isConversationWorkspacePath(thread.workspace, conversationRoot)) return false
      if (thread.archived === true) return false
      if (!query) return true
      const haystack = [thread.title, thread.preview, thread.workspace]
        .filter(Boolean)
        .join('\n')
        .toLowerCase()
      return haystack.includes(query)
    })
    return sortSidebarThreads(filtered)
  }, [threads, conversationRoot, search])

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

  return (
    <div className="ds-no-drag flex shrink-0 flex-col">
      <div className="flex min-h-[34px] items-center justify-between px-2 pb-1 pt-2">
        <button
          type="button"
          onClick={() => setCollapsed((open) => !open)}
          className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-muted"
          title={t('sidebarConversations')}
          aria-label={t('sidebarConversations')}
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={2} />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={2} />
          )}
          <span className="truncate">{t('sidebarConversations')}</span>
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

          {conversationThreads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              active={activeThreadId === thread.id}
              deleting={deletingThreadIds[thread.id] === true}
              locale={locale}
              showRunning={watchTurnCompletion[thread.id] === true}
              showUnread={unreadThreadIds[thread.id] === true}
              onSelect={() => onSelectThread(thread.id)}
              onContextMenu={noOp}
              onPreviewOpen={noOp}
              onPreviewClose={noOp}
              onPin={() => handlePin(thread.id, thread.pinned !== true)}
              onRename={() => openRename(thread)}
              onArchive={() => handleArchive(thread.id)}
              onDelete={() => void handleDelete(thread.id)}
              onRestore={() => void onRestoreThread(thread.id)}
            />
          ))}
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
