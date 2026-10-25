import { useMemo, useState, type ReactElement } from 'react'
import {
  AlertTriangle,
  BellRing,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Mail
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { selectAttentionItems, type AttentionItemKind } from '../../store/attention-items'
import type { SidebarThreadActivityContext } from './sidebar-project-selectors'

type Translate = (key: string, options?: Record<string, unknown>) => string

const MAX_ROWS = 6

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
  t
}: {
  threads: NormalizedThread[]
  activityContext: SidebarThreadActivityContext
  onSelectThread: (id: string) => void
  t: Translate
}): ReactElement | null {
  const [collapsed, setCollapsed] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const items = useMemo(
    () => selectAttentionItems({ threads, activityContext }),
    [threads, activityContext]
  )

  if (items.length === 0) return null

  const visible = showAll ? items : items.slice(0, MAX_ROWS)
  const overflow = items.length - visible.length
  const urgent = items.some((item) => item.kind === 'awaiting-input' || item.kind === 'failed')

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
          {items.length}
        </span>
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={2} />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={2} />
        )}
      </button>
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
