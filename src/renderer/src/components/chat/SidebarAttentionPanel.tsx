import { useMemo, useState, type ReactElement } from 'react'
import {
  AlertTriangle,
  BellRing,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Loader2,
  Mail
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import {
  sidebarThreadActivity,
  type SidebarThreadActivity,
  type SidebarThreadActivityContext
} from './sidebar-project-selectors'

type Translate = (key: string, options?: Record<string, unknown>) => string

const ATTENTION_ORDER: Record<SidebarThreadActivity, number> = {
  'awaiting-input': 0,
  failed: 1,
  unread: 2,
  running: 3,
  scheduled: 4,
  read: 5
}
const ATTENTION_STATUSES = new Set<SidebarThreadActivity>([
  'awaiting-input',
  'failed',
  'unread',
  'running'
])
const MAX_ROWS = 6

function statusLabelKey(status: SidebarThreadActivity): string {
  switch (status) {
    case 'awaiting-input':
      return 'attentionStatusAwaitingInput'
    case 'failed':
      return 'attentionStatusFailed'
    case 'unread':
      return 'attentionStatusUnread'
    default:
      return 'attentionStatusRunning'
  }
}

function AttentionIcon({ status }: { status: SidebarThreadActivity }): ReactElement {
  switch (status) {
    case 'awaiting-input':
      return <CircleHelp className="h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={2} />
    case 'failed':
      return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" strokeWidth={2} />
    case 'unread':
      return <Mail className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
    default:
      return (
        <Loader2
          className="h-3.5 w-3.5 shrink-0 text-ds-muted motion-safe:animate-spin"
          strokeWidth={2}
        />
      )
  }
}

/**
 * Cross-thread "needs you" strip pinned above the project list. Threads the
 * user is not looking at surface here in priority order — a pending question
 * outranks a failure, which outranks unread output, which outranks work still
 * in flight — so parallel agents never hide a blocker deep in the list.
 */
export function SidebarAttentionPanel({
  threads,
  activityContext,
  onSelectThread,
  t
}: {
  threads: NormalizedThread[]
  activityContext: SidebarThreadActivityContext
  onSelectThread: (id: string) => void
  t: Translate
}): ReactElement | null {
  const [collapsed, setCollapsed] = useState(false)
  const entries = useMemo(() => {
    const flagged: Array<{ thread: NormalizedThread; status: SidebarThreadActivity }> = []
    for (const thread of threads) {
      if (thread.archived === true) continue
      if (thread.id === activityContext.activeThreadId) continue
      const status = sidebarThreadActivity(thread, activityContext)
      if (!ATTENTION_STATUSES.has(status)) continue
      flagged.push({ thread, status })
    }
    flagged.sort(
      (left, right) => ATTENTION_ORDER[left.status] - ATTENTION_ORDER[right.status]
    )
    return flagged
  }, [threads, activityContext])

  if (entries.length === 0) return null

  const visible = entries.slice(0, MAX_ROWS)
  const overflow = entries.length - visible.length
  const urgent = entries.some((entry) => entry.status === 'awaiting-input' || entry.status === 'failed')

  return (
    <section
      aria-label={t('attentionTitle')}
      className="ds-no-drag mx-1 mb-1 overflow-hidden rounded-xl border border-ds-border-muted bg-ds-card/60"
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1.5 px-2.5 py-2 text-left transition hover:bg-ds-hover"
      >
        <BellRing
          className={`h-3.5 w-3.5 shrink-0 ${urgent ? 'text-amber-500' : 'text-ds-faint'}`}
          strokeWidth={2}
        />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ds-ink">
          {t('attentionTitle')}
        </span>
        <span className="shrink-0 rounded-full bg-ds-subtle px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-ds-muted">
          {entries.length}
        </span>
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={2} />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={2} />
        )}
      </button>
      {!collapsed ? (
        <ul className="flex flex-col border-t border-ds-border-muted/60 px-1 py-1">
          {visible.map(({ thread, status }) => (
            <li key={thread.id}>
              <button
                type="button"
                onClick={() => onSelectThread(thread.id)}
                className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-ds-hover"
                title={thread.title}
              >
                <AttentionIcon status={status} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ds-ink">
                  {thread.title || t('untitledThread')}
                </span>
                <span className="shrink-0 text-[10.5px] font-medium text-ds-faint">
                  {t(statusLabelKey(status))}
                </span>
              </button>
            </li>
          ))}
          {overflow > 0 ? (
            <li className="px-2.5 py-1 text-[11px] text-ds-faint">
              {t('attentionMore', { count: overflow })}
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  )
}
