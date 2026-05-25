import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronRight,
  Archive,
  Folder,
  FolderOpen,
  GitFork,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { formatRelativeTime } from '../../lib/format-relative-time'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { isClawWorkspacePath, isInternalTemporaryWorkspace, normalizeWorkspaceRoot } from '../../lib/workspace-path'

type SidebarProjectsSectionProps = {
  threads: NormalizedThread[]
  activeView: 'chat' | 'write' | 'claw'
  activeThreadId: string | null
  runtimeReady: boolean
  searchQuery: string
  showArchived: boolean
  workspaceRoot: string
  busy: boolean
  watchTurnCompletion: Record<string, boolean>
  unreadThreadIds: Record<string, boolean>
  locale: string
  onPickWorkspace: () => void
  onRemoveWorkspace: (workspacePath: string) => Promise<void>
  onCreateThreadInWorkspace: (workspacePath: string) => void
  onSelectThread: (threadId: string) => void
  onDeleteThread: (threadId: string) => Promise<void>
  onRestoreThread: (threadId: string) => Promise<void>
  onSearchQueryChange: (query: string) => void
  onShowArchivedChange: (show: boolean) => void
  t: (k: string, opts?: Record<string, unknown>) => string
}

export function SidebarProjectsSection({
  threads,
  activeView,
  activeThreadId,
  runtimeReady,
  searchQuery,
  showArchived,
  workspaceRoot,
  busy,
  watchTurnCompletion,
  unreadThreadIds,
  locale,
  onPickWorkspace,
  onRemoveWorkspace,
  onCreateThreadInWorkspace,
  onSelectThread,
  onDeleteThread,
  onRestoreThread,
  onSearchQueryChange,
  onShowArchivedChange,
  t
}: SidebarProjectsSectionProps): ReactElement {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>({})
  const [deletingThreadIds, setDeletingThreadIds] = useState<Record<string, boolean>>({})

  const groups = useMemo(() => {
    const map = new Map<string, NormalizedThread[]>()
    const selectedWorkspace = normalizeWorkspaceRoot(workspaceRoot)
    const query = searchQuery.trim().toLowerCase()

    for (const th of threads) {
      if (isInternalTemporaryWorkspace(th.workspace)) continue
      if (isClawWorkspacePath(th.workspace)) continue
      if ((th.archived === true) !== showArchived) continue
      const key = normalizeWorkspaceRoot(th.workspace)
      if (!key) continue
      if (query) {
        const haystack = [th.title, th.preview, key, workspaceLabelFromPath(key)]
          .filter(Boolean)
          .join('\n')
          .toLowerCase()
        if (!haystack.includes(query)) continue
      }
      const arr = map.get(key) ?? []
      arr.push(th)
      map.set(key, arr)
    }

    if (selectedWorkspace && !map.has(selectedWorkspace)) {
      map.set(selectedWorkspace, [])
    }

    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === selectedWorkspace && b !== selectedWorkspace) return -1
      if (b === selectedWorkspace && a !== selectedWorkspace) return 1
      return a.localeCompare(b)
    })
  }, [searchQuery, showArchived, threads, workspaceRoot])

  const handleDeleteThread = async (thread: NormalizedThread): Promise<void> => {
    const threadId = thread.id.trim()
    if (!threadId || deletingThreadIds[threadId]) return
    const confirmMessage = t('sidebarThreadArchiveConfirm', { title: thread.title })
    if (!window.confirm(confirmMessage)) return
    setDeletingThreadIds((prev) => ({ ...prev, [threadId]: true }))
    try {
      await onDeleteThread(threadId)
    } finally {
      setDeletingThreadIds((prev) => {
        const next = { ...prev }
        delete next[threadId]
        return next
      })
    }
  }

  const handleRestoreThread = async (thread: NormalizedThread): Promise<void> => {
    const threadId = thread.id.trim()
    if (!threadId || deletingThreadIds[threadId]) return
    setDeletingThreadIds((prev) => ({ ...prev, [threadId]: true }))
    try {
      await onRestoreThread(threadId)
    } finally {
      setDeletingThreadIds((prev) => {
        const next = { ...prev }
        delete next[threadId]
        return next
      })
    }
  }

  const handleRemoveWorkspace = async (workspacePath: string): Promise<void> => {
    const confirmMessage = t('sidebarWorkspaceRemoveConfirm', { path: workspacePath })
    if (!window.confirm(confirmMessage)) return
    await onRemoveWorkspace(workspacePath)
  }

  return (
    <div className="ds-no-drag flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-2 pb-1 pt-0.5">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
          {t('sidebarProjects')}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onPickWorkspace}
            title={workspaceRoot ? t('changeWorkspace') : t('selectWorkspace')}
            className="rounded-md p-1 text-ds-faint transition hover:bg-ds-hover/70 hover:text-ds-ink"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="mb-2 flex items-center gap-1 px-1">
        <label className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-faint"
            strokeWidth={1.8}
          />
          <input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder={t('sidebarSearchThreads')}
            className="h-8 w-full rounded-lg border border-transparent bg-white/35 pl-7 pr-7 text-[13px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent/30 focus:bg-white/60 dark:bg-white/5 dark:focus:bg-white/8"
          />
          {searchQuery.trim() ? (
            <button
              type="button"
              onClick={() => onSearchQueryChange('')}
              className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              title={t('clear')}
              aria-label={t('clear')}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
          ) : null}
        </label>
        <button
          type="button"
          onClick={() => onShowArchivedChange(!showArchived)}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition ${
            showArchived
              ? 'border-accent/30 bg-accent-soft text-accent'
              : 'border-transparent bg-white/35 text-ds-faint hover:border-ds-border-muted hover:bg-white/60 hover:text-ds-ink dark:bg-white/5 dark:hover:bg-white/8'
          }`}
          title={showArchived ? t('sidebarShowActiveThreads') : t('sidebarShowArchivedThreads')}
          aria-label={showArchived ? t('sidebarShowActiveThreads') : t('sidebarShowArchivedThreads')}
          aria-pressed={showArchived}
        >
          <Archive className="h-3.5 w-3.5" strokeWidth={1.9} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-0.5 pb-1">
        {groups.length === 0 ? (
          <SidebarEmpty
            runtimeReady={runtimeReady}
            hasWorkspace={!!workspaceRoot}
            onPickWorkspace={onPickWorkspace}
            t={t}
          />
        ) : null}

        {groups.map(([workspacePath, list]) => {
          const folderName = workspaceLabelFromPath(workspacePath)
          const isCollapsed = collapsed[workspacePath] === true
          const sortedThreads = [...list].sort(
            (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
          )
          const workspaceExpanded = expandedWorkspaces[workspacePath] === true
          const hasOverflow = sortedThreads.length > 5
          const visibleThreads = workspaceExpanded
            ? sortedThreads
            : sortedThreads.slice(0, 5)
          return (
            <div key={workspacePath} className="mb-1">
              <div
                className="group flex w-full items-center gap-0.5 rounded-[10px] text-[14px] font-medium text-ds-ink transition hover:bg-ds-hover/45"
                title={workspacePath}
              >
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((current) => ({ ...current, [workspacePath]: !current[workspacePath] }))
                  }
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
                  ) : (
                    <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
                  )}
                  {isCollapsed ? (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
                  ) : (
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
                  )}
                  <span className="min-w-0 flex-1 truncate">{folderName}</span>
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onCreateThreadInWorkspace(workspacePath)
                  }}
                  className="shrink-0 rounded-md p-1 text-ds-faint opacity-45 transition hover:bg-ds-hover/80 hover:text-ds-ink hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                  title={t('sidebarWorkspaceNewThread')}
                  aria-label={t('sidebarWorkspaceNewThread')}
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleRemoveWorkspace(workspacePath)
                  }}
                  className="mr-1 shrink-0 rounded-md p-1 text-ds-faint opacity-45 transition hover:bg-ds-hover/80 hover:text-red-500 hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                  title={t('sidebarWorkspaceRemove')}
                  aria-label={t('sidebarWorkspaceRemove')}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                </button>
              </div>

              {!isCollapsed ? (
                <div className="mt-0.5 space-y-0.5 pl-2">
                  {sortedThreads.length === 0 ? (
                    <div className="flex items-center justify-between gap-2 px-2 py-1">
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
                          onClick={() => onCreateThreadInWorkspace(workspacePath)}
                          className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                        >
                          {t('sidebarWorkspaceNewThread')}
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    visibleThreads.map((thread) => (
                      <ThreadRow
                        key={thread.id}
                        thread={thread}
                        active={(activeView === 'chat' || activeView === 'write') && activeThreadId === thread.id}
                        deleting={deletingThreadIds[thread.id] === true}
                        locale={locale}
                        showRunning={
                          thread.status?.trim().toLowerCase() === 'running' ||
                          (activeThreadId === thread.id && busy) ||
                          watchTurnCompletion[thread.id] === true
                        }
                        showUnread={
                          unreadThreadIds[thread.id] === true && activeThreadId !== thread.id
                        }
                        onSelect={() => onSelectThread(thread.id)}
                        onDelete={() => void handleDeleteThread(thread)}
                        onRestore={() => void handleRestoreThread(thread)}
                      />
                    ))
                  )}
                  {hasOverflow ? (
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedWorkspaces((current) => ({
                          ...current,
                          [workspacePath]: !workspaceExpanded
                        }))
                      }
                      className="ml-1 mt-0.5 rounded-md px-2 py-1 text-[12.5px] text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                    >
                      {workspaceExpanded
                        ? t('sidebarWorkspaceShowLess')
                        : t('sidebarWorkspaceShowMore', {
                            count: sortedThreads.length - 5
                          })}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

type ThreadRowProps = {
  thread: NormalizedThread
  active: boolean
  deleting: boolean
  locale: string
  showRunning: boolean
  showUnread: boolean
  onSelect: () => void
  onDelete: () => void
  onRestore: () => void
}

function ThreadRow({
  thread,
  active,
  deleting,
  locale,
  showRunning,
  showUnread,
  onSelect,
  onDelete,
  onRestore
}: ThreadRowProps): ReactElement {
  const { t } = useTranslation('common')
  const showUnreadDot = showUnread && !showRunning
  const archived = thread.archived === true
  const forkedFromTitle = thread.forkedFromTitle?.trim() ?? ''
  const forked = Boolean(thread.forkedFromThreadId)
  const forkLabel = forked
    ? forkedFromTitle
      ? t('sidebarThreadForkedFrom', { title: forkedFromTitle })
      : t('sidebarThreadForked')
    : ''
  const ariaLabel = [
    thread.title,
    showRunning ? t('sidebarThreadRunning') : '',
    showUnreadDot ? t('sidebarThreadUnread') : '',
    forkLabel
  ].filter(Boolean).join(' — ')

  return (
    <div
      className={`group relative w-full overflow-hidden rounded-[10px] transition ${
        active
          ? 'bg-black/8 text-ds-ink dark:bg-white/[0.055]'
          : 'hover:bg-ds-hover/4 dark:hover:bg-white/[0.03]'
      }`}
    >
      <span
        aria-hidden
        className={`absolute bottom-1 top-1 left-0 w-[2px] rounded-full transition ${
          active ? 'bg-accent opacity-100' : 'bg-transparent opacity-0'
        }`}
      />
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-start gap-1.5 px-3 py-2 pr-8 text-left"
        disabled={deleting}
        aria-label={ariaLabel}
        title={forkLabel ? `${thread.title}\n${forkLabel}` : thread.title}
      >
        <span
          className="flex w-4 shrink-0 flex-col items-center justify-center self-start pt-0.5"
          aria-hidden={!showRunning && !showUnreadDot}
        >
          {showRunning ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" strokeWidth={2} />
          ) : showUnreadDot ? (
            <span
              className="block h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_0_1px_rgba(79,124,255,0.2)]"
              title={t('sidebarThreadUnread')}
            />
          ) : null}
        </span>
        {forked ? (
          <GitFork
            className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${active ? 'text-accent' : 'text-ds-faint/90'}`}
            strokeWidth={1.8}
          />
        ) : (
          <MessageSquare
            className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${active ? 'text-accent' : 'text-ds-faint/90'}`}
            strokeWidth={1.8}
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={`min-w-0 flex-1 truncate text-[14px] leading-[1.35] ${
                showUnreadDot && !active ? 'font-semibold text-ds-ink' : 'text-ds-ink'
              }`}
            >
              {thread.title}
            </span>
            {forked ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/15 bg-accent/8 px-1.5 py-0.5 text-[10.5px] font-semibold leading-none text-accent">
                <GitFork className="h-2.5 w-2.5" strokeWidth={1.8} />
                {t('sidebarThreadForkBadge')}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] leading-4 text-ds-faint">
            <span className="shrink-0 tabular-nums">{formatRelativeTime(thread.updatedAt, locale)}</span>
            {forkLabel ? (
              <>
                <span className="opacity-70">·</span>
                <span className="truncate">{forkLabel}</span>
              </>
            ) : null}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          if (archived) {
            onRestore()
          } else {
            onDelete()
          }
        }}
        disabled={deleting}
        className={`absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-ds-faint opacity-0 transition hover:bg-ds-hover focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-100 ${
          archived ? 'hover:text-accent' : 'hover:text-red-600'
        }`}
        title={archived ? t('sidebarThreadRestore') : t('sidebarThreadArchive')}
        aria-label={archived ? t('sidebarThreadRestore') : t('sidebarThreadArchive')}
      >
        {deleting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : archived ? (
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.9} />
        ) : (
          <Archive className="h-3.5 w-3.5" strokeWidth={1.9} />
        )}
      </button>
    </div>
  )
}

type SidebarEmptyProps = {
  runtimeReady: boolean
  hasWorkspace: boolean
  onPickWorkspace: () => void
  t: (k: string, opts?: Record<string, unknown>) => string
}

function SidebarEmpty({
  runtimeReady,
  hasWorkspace,
  onPickWorkspace,
  t
}: SidebarEmptyProps): ReactElement {
  if (!hasWorkspace && runtimeReady) {
    return (
      <button
        type="button"
        onClick={onPickWorkspace}
        className="mx-1 mt-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
      >
        <LayoutGrid className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
          {t('selectWorkspace')}
        </span>
      </button>
    )
  }

  return (
    <div className="mx-2 mt-2 rounded-lg px-2 py-2">
      <p className="text-[15px] font-medium text-ds-muted">{t('sidebarEmptyTitle')}</p>
      <p className="mt-1 text-[13px] leading-5 text-ds-faint">
        {runtimeReady ? t('sidebarEmptySub') : t('sidebarEmptySubOffline')}
      </p>
    </div>
  )
}
