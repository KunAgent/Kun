import { useId, useMemo, useState, type ReactElement } from 'react'
import {
  AlertTriangle,
  BellRing,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Mail
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { selectAttentionItems, type AttentionItemKind } from '../../store/attention-items'
import type { AttentionReadUndo } from '../../store/attention-read-actions'
import { useToastStore } from '../../toast/toast-store'
import type { SidebarThreadActivityContext } from './sidebar-project-selectors'
import './sidebar-attention-panel.css'

type Translate = (key: string, options?: Record<string, unknown>) => string

const MAX_ROWS = 6
const UNDO_DURATION_MS = 8_000
let nextReadNoticeId = 0

function statusLabelKey(kind: AttentionItemKind): string {
  switch (kind) {
    case 'awaiting-input':
      return 'attentionStatusAwaitingInput'
    case 'failed':
      return 'attentionStatusFailed'
    default:
      return 'attentionStatusUnread'
  }
}

function AttentionIcon({ kind }: { kind: AttentionItemKind }): ReactElement {
  switch (kind) {
    case 'awaiting-input':
      return <CircleHelp className="h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={2} />
    case 'failed':
      return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" strokeWidth={2} />
    default:
      return <Mail className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
  }
}

/**
 * Cross-thread "needs you" strip pinned above the project list. Its rows come
 * from the same selector that feeds the app badge, so every badge number has a
 * matching row here that opens on click. A pending question outranks a failure,
 * which outranks unread output; work still in flight is not unread and stays on
 * its own thread row instead.
 */
export function SidebarAttentionPanel({
  threads,
  activityContext,
  onSelectThread,
  onMarkRead,
  t
}: {
  threads: NormalizedThread[]
  activityContext: SidebarThreadActivityContext
  onSelectThread: (id: string) => void
  onMarkRead: (threadIds: readonly string[]) => AttentionReadUndo | null
  t: Translate
}): ReactElement | null {
  const [collapsed, setCollapsed] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const tooltipId = useId()
  const items = useMemo(
    () => selectAttentionItems({ threads, activityContext }),
    [threads, activityContext]
  )

  if (items.length === 0) return null

  const unreadIds = items.filter((item) => item.kind === 'unread').map((item) => item.threadId)
  const visible = showAll ? items : items.slice(0, MAX_ROWS)
  const overflow = items.length - visible.length
  const urgent = items.some((item) => item.kind === 'awaiting-input' || item.kind === 'failed')
  const toggleCollapsed = (): void => setCollapsed((value) => !value)
  const markRead = (): void => {
    const batch = onMarkRead(unreadIds)
    if (!batch) return
    useToastStore.getState().publish({
      id: `attention-read:${++nextReadNoticeId}`,
      tone: 'success',
      title: t('attentionMarkReadDone', { count: batch.count }),
      durationMs: UNDO_DURATION_MS,
      actions: [{ label: t('attentionMarkReadUndo'), run: batch.undo }],
      onDismiss: batch.dispose
    })
  }

  return (
    <section
      aria-label={t('attentionTitle')}
      className="sidebar-attention-panel ds-no-drag relative z-10 mx-1 mb-1 rounded-xl border border-ds-border-muted bg-ds-card/60"
    >
      <div className="flex items-center gap-1 px-1.5 py-1">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <BellRing
            className={`h-3.5 w-3.5 shrink-0 ${urgent ? 'text-amber-500' : 'text-ds-faint'}`}
            strokeWidth={2}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ds-ink">
            {t('attentionTitle')}
          </span>
          <span className="shrink-0 rounded-full bg-ds-subtle px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-ds-muted">
            {items.length}
          </span>
        </button>
        <span className="sidebar-attention-read-wrap relative shrink-0">
          <button
            type="button"
            onClick={markRead}
            disabled={unreadIds.length === 0}
            aria-label={unreadIds.length > 0
              ? t('attentionMarkAllReadTooltip', { count: unreadIds.length })
              : t('attentionNoUnread')}
            aria-describedby={tooltipId}
            className="sidebar-attention-read flex h-7 items-center justify-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium text-ds-muted transition hover:bg-accent-soft hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-default disabled:text-ds-faint disabled:hover:bg-transparent disabled:hover:text-ds-faint"
          >
            <CheckCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className="sidebar-attention-read-label whitespace-nowrap">{t('attentionMarkAllRead')}</span>
          </button>
          <span
            id={tooltipId}
            role="tooltip"
            className="sidebar-attention-read-tooltip pointer-events-none absolute right-0 top-full z-50 mt-1 rounded-lg border border-ds-border bg-ds-subtle px-3 py-2 text-left text-[11.5px] leading-5 text-ds-ink shadow-xl"
          >
            {unreadIds.length > 0 ? t('attentionMarkAllReadTooltip', { count: unreadIds.length }) : t('attentionNoUnread')}
            {unreadIds.length > 0 ? <span className="block text-[11px] text-ds-muted">{t('attentionMarkAllReadScope')}</span> : null}
          </span>
        </span>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? 'attentionExpand' : 'attentionCollapse')}
          className="flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            : <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
        </button>
      </div>
      {!collapsed ? (
        <ul className="flex flex-col border-t border-ds-border-muted/60 px-1 py-1">
          {visible.map((item) => (
            <li key={item.threadId}>
              <button
                type="button"
                onClick={() => onSelectThread(item.threadId)}
                className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-ds-hover"
                title={item.title}
              >
                <AttentionIcon kind={item.kind} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ds-ink">
                  {item.title || t('untitledThread')}
                </span>
                <span className="shrink-0 text-[10.5px] font-medium text-ds-faint">
                  {t(statusLabelKey(item.kind))}
                </span>
              </button>
            </li>
          ))}
          {overflow > 0 || showAll ? (
            <li className="px-1 pt-0.5">
              <button
                type="button"
                onClick={() => setShowAll((value) => !value)}
                aria-expanded={showAll}
                className="w-full rounded-lg px-1.5 py-1 text-left text-[11px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              >
                {showAll
                  ? t('attentionShowLess')
                  : t('attentionShowAll', { count: items.length })}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  )
}
