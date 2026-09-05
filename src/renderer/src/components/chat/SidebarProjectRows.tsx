import {
  useEffect,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  ClipboardList,
  FolderPlus,
  GitBranch,
  Loader2,
  Pin,
  PinOff,
  RotateCcw,
  Trash2
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { formatRelativeTime } from '../../lib/format-relative-time'
import type { SddDraftHistoryItem } from '../../sdd/sdd-draft-history'
import type { SddDraft } from '../../sdd/sdd-draft-store'
import { SidebarIconButton, SidebarTreeRow } from '../sidebar/SidebarPrimitives'
import type { SidebarThreadWorktreeRecord } from './sidebar-project-selectors'
import type { ScheduledThreadActivity } from '../../store/chat-store-types'
import type { SidebarDropPosition } from './sidebar-order'
import { cancelThreadPrewarm, requestThreadPrewarm } from '../../store/thread-detail-prewarm'

const DRAFT_HISTORY_PAGE_SIZE = 3

export function SddDraftHistoryRows({
  items,
  activeDraftId,
  onOpen,
  onDelete,
  deletingDraftIds = {},
  error = '',
  t
}: {
  items: SddDraftHistoryItem[]
  activeDraftId: string
  onOpen: (draft: SddDraft) => void
  onDelete?: (draft: SddDraftHistoryItem) => void
  deletingDraftIds?: Record<string, boolean>
  error?: string
  t: (key: string, options?: Record<string, unknown>) => string
}): ReactElement | null {
  const itemKey = items.map((item) => item.id).join('\n')
  const [collapsed, setCollapsed] = useState(true)
  const [visibleCount, setVisibleCount] = useState(DRAFT_HISTORY_PAGE_SIZE)

  useEffect(() => {
    setCollapsed(true)
    setVisibleCount(DRAFT_HISTORY_PAGE_SIZE)
  }, [itemKey])

  if (items.length === 0) return null
  const visibleItems = items.slice(0, visibleCount)
  const remainingCount = Math.max(0, items.length - visibleItems.length)
  const nextCount = Math.min(DRAFT_HISTORY_PAGE_SIZE, remainingCount)

  return (
    <div className="mb-1.5 rounded-lg border border-transparent bg-[var(--ds-sidebar-row-hover)]/35 px-1 py-1">
      <SidebarTreeRow
        title={t('sddDraftHistoryTitle')}
        ariaLabel={collapsed ? t('sddDraftHistoryExpand') : t('sddDraftHistoryCollapse')}
        onClick={() => setCollapsed((current) => !current)}
        className="min-h-[28px]"
        buttonClassName="items-center gap-1.5 px-2 py-1.5"
      >
        {collapsed
          ? <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
          : <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />}
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ds-faint">
          {t('sddDraftHistoryTitle')}
        </span>
        <span className="shrink-0 rounded-md bg-ds-card/70 px-1.5 py-0.5 text-[10.5px] text-ds-faint tabular-nums">
          {items.length}
        </span>
      </SidebarTreeRow>
      {error ? <div className="px-2 py-1 text-[11.5px] leading-4 text-red-600 dark:text-red-300">{error}</div> : null}
      {!collapsed ? (
        <div className="space-y-[2px] pt-1">
          {visibleItems.map((item) => (
            <SidebarTreeRow
              key={item.id}
              active={activeDraftId === item.id}
              activeVariant="outline"
              actionsVisibility={deletingDraftIds[item.id] ? 'visible' : 'hidden'}
              actionsLayout="overlay"
              actions={onDelete ? (
                <SidebarIconButton
                  onClick={() => onDelete(item)}
                  disabled={deletingDraftIds[item.id] === true}
                  tone="danger"
                  title={t('sddDraftHistoryDelete')}
                  ariaLabel={t('sddDraftHistoryDelete')}
                  stopPropagation
                >
                  {deletingDraftIds[item.id]
                    ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                    : <Trash2 className="h-3 w-3" strokeWidth={1.9} />}
                </SidebarIconButton>
              ) : null}
              className="min-h-[32px]"
              buttonClassName="items-center gap-2 px-2 py-1.5"
              title={item.relativePath}
              ariaLabel={t('sddDraftHistoryOpen', { title: item.title })}
              onClick={() => onOpen(item)}
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border transition ${
                  activeDraftId === item.id
                    ? 'border-accent/25 bg-accent/10 text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]'
                    : 'border-ds-border-muted bg-ds-card/70 text-ds-faint group-hover:border-accent/20 group-hover:bg-accent/10 group-hover:text-accent'
                }`}
                aria-hidden="true"
              >
                <ClipboardList className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] leading-4 text-ds-ink">{item.title}</span>
                <span className="block truncate text-[11.5px] leading-4 text-ds-faint">{item.relativePath}</span>
              </span>
              <span className="shrink-0 rounded-md bg-ds-card/70 px-1.5 py-0.5 text-[10.5px] text-ds-faint transition group-hover:opacity-0 group-focus-within:opacity-0">
                {item.source === 'remembered' ? t('sddDraftHistoryRemembered') : t('sddDraftHistoryDisk')}
              </span>
            </SidebarTreeRow>
          ))}
        </div>
      ) : null}
      {!collapsed && remainingCount > 0 ? (
        <button
          type="button"
          data-cursor-spotlight-target
          onClick={() => setVisibleCount((count) => Math.min(items.length, count + DRAFT_HISTORY_PAGE_SIZE))}
          className="ml-1 mt-1 rounded-md px-2.5 py-1.5 text-[12.5px] text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink"
        >
          {t('sddDraftHistoryShowMore', { count: nextCount })}
        </button>
      ) : null}
    </div>
  )
}

type ThreadRowProps = {
  thread: NormalizedThread
  worktreeRecord?: SidebarThreadWorktreeRecord
  active: boolean
  deleting: boolean
  locale: string
  showRunning: boolean
  showUnread: boolean
  showFailed?: boolean
  showAwaitingInput?: boolean
  scheduledActivity?: ScheduledThreadActivity
  onSelect: () => void
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void
  onPreviewOpen: (
    event: ReactMouseEvent<HTMLDivElement>,
    worktreeRecord?: SidebarThreadWorktreeRecord
  ) => void
  onPreviewClose: () => void
  draggable?: boolean
  dragging?: boolean
  dropPosition?: SidebarDropPosition | null
  onDragStart?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragEnd?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragOver?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragLeave?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDrop?: (event: ReactDragEvent<HTMLDivElement>) => void
  onPin: () => void
  onRename: () => void
  onArchive: () => void
  onDelete: () => void
  onRestore: () => void
}

export function ThreadRow({
  thread,
  worktreeRecord,
  active,
  deleting,
  locale,
  showRunning,
  showUnread,
  showFailed = false,
  showAwaitingInput = false,
  scheduledActivity,
  onSelect,
  onContextMenu,
  onPreviewOpen,
  onPreviewClose,
  draggable = false,
  dragging = false,
  dropPosition = null,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onPin,
  onArchive,
  onDelete,
  onRestore
}: ThreadRowProps): ReactElement {
  const { t } = useTranslation('common')
  const showUnreadDot = showUnread && !showRunning
  const archived = thread.archived === true
  const pinned = thread.pinned === true
  const worktreeBranch = worktreeRecord?.branch?.trim() || 'worktree'
  const worktreeLabel = worktreeRecord
    ? t('sidebarThreadWorktree', { branch: worktreeBranch })
    : ''
  const updatedLabel = formatRelativeTime(thread.updatedAt, locale)
  const scheduledTime = scheduledActivity?.nextRunAt
    ? (() => {
        const date = new Date(scheduledActivity.nextRunAt)
        return Number.isFinite(date.getTime())
          ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
          : ''
      })()
    : ''
  const scheduledLabel = scheduledActivity
    ? scheduledActivity.taskCount > 1
      ? t('sidebarThreadScheduledMultiple', {
          count: scheduledActivity.taskCount,
          time: scheduledTime || t('sidebarThreadScheduledTimePending')
        })
      : scheduledActivity.queued
        ? t('sidebarThreadScheduledQueued')
        : t('sidebarThreadScheduled', {
            time: scheduledTime || t('sidebarThreadScheduledTimePending')
          })
    : ''
  const ariaLabel = [
    thread.title,
    updatedLabel,
    pinned ? t('sidebarThreadPinned') : '',
    showAwaitingInput ? t('sidebarThreadAwaitingInput') : '',
    showRunning ? t('sidebarThreadRunning') : '',
    showFailed ? t('sidebarThreadFailed') : '',
    showUnreadDot ? t('sidebarThreadUnread') : '',
    !showRunning && !showFailed && !showUnreadDot ? scheduledLabel : '',
    worktreeLabel
  ].filter(Boolean).join(' - ')

  return (
    <SidebarTreeRow
      active={active}
      actionsVisibility={deleting ? 'visible' : 'hidden'}
      actionsLayout="overlay"
      actions={(
        <>
          {!archived ? (
            <SidebarIconButton
              onClick={onPin}
              disabled={deleting}
              tone="accent"
              title={pinned ? t('sidebarThreadUnpin') : t('sidebarThreadPin')}
              ariaLabel={pinned ? t('sidebarThreadUnpin') : t('sidebarThreadPin')}
              active={pinned}
              stopPropagation
            >
              {pinned
                ? <PinOff className="h-3 w-3" strokeWidth={1.9} />
                : <Pin className="h-3 w-3" strokeWidth={1.9} />}
            </SidebarIconButton>
          ) : null}
          <SidebarIconButton
            onClick={archived ? onRestore : onArchive}
            disabled={deleting}
            tone="accent"
            title={archived ? t('sidebarThreadRestore') : t('sidebarThreadArchive')}
            ariaLabel={archived ? t('sidebarThreadRestore') : t('sidebarThreadArchive')}
            stopPropagation
          >
            {deleting
              ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
              : archived
                ? <RotateCcw className="h-3 w-3" strokeWidth={1.9} />
                : <Archive className="h-3 w-3" strokeWidth={1.9} />}
          </SidebarIconButton>
          <SidebarIconButton
            onClick={onDelete}
            disabled={deleting}
            tone="danger"
            title={t('sidebarThreadDelete')}
            ariaLabel={t('sidebarThreadDelete')}
            stopPropagation
          >
            <Trash2 className="h-3 w-3" strokeWidth={1.9} />
          </SidebarIconButton>
        </>
      )}
      className={`min-h-[34px] ${
        dragging ? 'opacity-55' : ''
      } ${
        dropPosition === 'before'
          ? "before:absolute before:inset-x-2 before:top-0 before:z-10 before:h-0.5 before:rounded-full before:bg-accent before:content-['']"
          : dropPosition === 'after'
            ? "after:absolute after:bottom-0 after:inset-x-2 after:z-10 after:h-0.5 after:rounded-full after:bg-accent after:content-['']"
            : ''
      }`}
      buttonClassName="items-center gap-2 px-2.5 py-1.5"
      disabled={deleting}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      ariaLabel={ariaLabel}
      title={[thread.title, thread.summary?.trim(), worktreeLabel].filter(Boolean).join('\n')}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onMouseEnter={(event) => {
        if (!active) requestThreadPrewarm(thread, { dwell: true })
        onPreviewOpen(event, worktreeRecord)
      }}
      onFocusCapture={() => {
        if (!active) requestThreadPrewarm(thread, { dwell: true })
      }}
      onMouseLeave={(event) => {
        cancelThreadPrewarm(thread.id)
        onPreviewClose()
      }}
      onBlurCapture={() => cancelThreadPrewarm(thread.id)}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {pinned ? <Pin className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.9} /> : null}
        {worktreeRecord ? (
          <span
            className="flex min-w-0 max-w-[42%] shrink items-center gap-1 rounded-md border border-ds-border-muted bg-ds-card/80 px-1.5 py-0.5 text-[10.5px] leading-4 text-ds-muted"
            title={worktreeLabel}
            aria-label={worktreeLabel}
          >
            <GitBranch className="h-3 w-3 shrink-0" strokeWidth={1.8} />
            <span className="truncate">{worktreeBranch}</span>
          </span>
        ) : null}
        <span className={`min-w-0 flex-1 truncate text-[13.5px] leading-5 ${
          showUnreadDot && !active ? 'font-semibold text-ds-ink' : 'text-ds-ink'
        }`}>
          {thread.title}
        </span>
        <span className={`ml-auto flex min-w-[3.75rem] shrink-0 items-center justify-end gap-1.5 transition ${
          deleting ? 'opacity-0' : 'group-hover:opacity-0 group-focus-within:opacity-0'
        }`}>
          <span className="shrink-0 text-right text-[12px] leading-4 text-ds-faint tabular-nums">
            {updatedLabel}
          </span>
          <ThreadActivityIndicator
            running={showRunning}
            failed={showFailed}
            unread={showUnreadDot}
            awaitingInput={showAwaitingInput}
            scheduled={!showRunning && !showFailed && !showUnreadDot ? scheduledActivity : undefined}
            unreadLabel={t(showRunning ? 'sidebarThreadRunning' : 'sidebarThreadUnread')}
            failedLabel={t('sidebarThreadFailed')}
            scheduledLabel={scheduledLabel}
            awaitingInputLabel={t('sidebarThreadAwaitingInput')}
          />
        </span>
      </span>
    </SidebarTreeRow>
  )
}

export function ThreadRunningIndicator({
  label,
  className = ''
}: {
  label: string
  className?: string
}): ReactElement {
  return (
    <Loader2
      className={`h-3.5 w-3.5 shrink-0 animate-spin text-accent motion-reduce:animate-none ${className}`}
      strokeWidth={2}
      role="img"
      aria-label={label}
    />
  )
}

function ThreadActivityIndicator({
  running,
  failed,
  unread,
  scheduled,
  awaitingInput,
  unreadLabel,
  failedLabel,
  scheduledLabel,
  awaitingInputLabel
}: {
  running: boolean
  failed: boolean
  unread: boolean
  scheduled?: ScheduledThreadActivity
  awaitingInput: boolean
  unreadLabel: string
  failedLabel: string
  scheduledLabel: string
  awaitingInputLabel: string
}): ReactElement | null {
  if (awaitingInput) {
    return (
      <span className="inline-flex" title={awaitingInputLabel}>
        <CircleHelp
          className="h-3.5 w-3.5 shrink-0 text-amber-500 motion-safe:animate-pulse"
          strokeWidth={2.2}
          role="img"
          aria-label={awaitingInputLabel}
        />
      </span>
    )
  }
  if (running) return <ThreadRunningIndicator label={unreadLabel} />
  if (failed) {
    return (
      <span className="inline-flex" title={failedLabel}>
        <CircleAlert
          className="h-3.5 w-3.5 shrink-0 text-red-500"
          strokeWidth={2}
          role="img"
          aria-label={failedLabel}
        />
      </span>
    )
  }
  if (unread) {
    return (
      <span
        className="block h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_0_1px_rgba(79,124,255,0.2)]"
        title={unreadLabel}
      />
    )
  }
  if (scheduled) {
    return (
      <span className="inline-flex" title={scheduledLabel}>
        <CalendarClock
          className="h-3.5 w-3.5 shrink-0 text-ds-faint"
          strokeWidth={1.8}
          role="img"
          aria-label={scheduledLabel}
        />
      </span>
    )
  }
  return null
}

export function SidebarEmpty({
  runtimeReady,
  hasWorkspace,
  onPickWorkspace,
  t
}: {
  runtimeReady: boolean
  hasWorkspace: boolean
  onPickWorkspace: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}): ReactElement {
  if (!hasWorkspace && runtimeReady) {
    return (
      <button
        type="button"
        onClick={onPickWorkspace}
        className="mx-1 mt-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ds-muted transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink"
      >
        <FolderPlus className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{t('selectWorkspace')}</span>
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

/**
 * Skeleton placeholder rows shown while the first thread inventory is still
 * loading. Uses a calm pulse so it reads as "loading", never as "no threads".
 */
export function SidebarThreadSkeleton(): ReactElement {
  return (
    <div
      aria-hidden="true"
      className="mx-1 mt-1 space-y-1"
    >
      {[0, 1, 2, 3].map((row) => (
        <div
          key={row}
          className="flex h-[34px] items-center gap-2 rounded-md px-2"
        >
          <div className="h-4 w-4 shrink-0 rounded-[5px] bg-ds-card/80 motion-safe:animate-pulse" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-2.5 w-3/4 rounded-full bg-ds-card/80 motion-safe:animate-pulse" />
            <div className="h-2 w-1/2 rounded-full bg-ds-card/60 motion-safe:animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}
