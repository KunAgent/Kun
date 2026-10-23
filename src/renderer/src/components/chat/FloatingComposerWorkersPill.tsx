import { useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  ClipboardCheck,
  Loader2
} from 'lucide-react'
import { useActivityStore } from '../../store/activity-store'
import { selectWorkerRowsForParent } from '../../store/activity-selectors'
import {
  selectSessionExecutionSummary,
  type SessionExecutionCounts,
  type SessionExecutionSummary
} from '../../store/session-execution-summary'

/** Window event asking the workbench to open the Workers right panel. */
export const OPEN_WORKERS_PANEL_EVENT = 'kun:open-workers-panel'

export function requestOpenWorkersPanel(): void {
  window.dispatchEvent(new CustomEvent(OPEN_WORKERS_PANEL_EVENT))
}

const STATUS_LABEL_KEY: Record<
  Exclude<SessionExecutionSummary['kind'], 'none'>,
  string
> = {
  running: 'backgroundTaskRunning',
  starting: 'backgroundTaskStarting',
  continuing: 'backgroundTaskContinuing',
  'waiting-user': 'backgroundTaskWaiting',
  review: 'backgroundTaskReview',
  failed: 'backgroundTaskFailed',
  completed: 'backgroundTaskCompleted',
  unknown: 'backgroundTaskUnknown'
}

function countLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  counts: SessionExecutionCounts
): string {
  const parts: string[] = []
  const push = (value: number, key: string): void => {
    if (value > 0) parts.push(t(key, { value }))
  }
  push(counts.running, 'backgroundTaskCountRunning')
  push(counts.starting, 'backgroundTaskCountStarting')
  push(counts.waiting, 'backgroundTaskCountWaiting')
  push(counts.review, 'backgroundTaskCountReview')
  push(counts.failed, 'backgroundTaskCountFailed')
  push(counts.completed, 'backgroundTaskCountDone')
  return parts.join(' · ')
}

/**
 * Composer status strip: the thread's background work stays visible after the
 * turn's reply finishes and its process log collapses.
 *
 * It only appears when this thread actually has background work, so ordinary
 * one-on-one turns are unchanged. The spinner is reserved for children that are
 * really executing; waiting, review, failure, and an unconfirmed feed use static
 * symbols so the strip never implies progress it cannot prove.
 */
export function FloatingComposerWorkersPill({
  threadId,
  mainRunning = false
}: {
  threadId: string | null
  mainRunning?: boolean
}): ReactElement | null {
  const { t } = useTranslation('common')
  const activityRows = useActivityStore((s) => s.rows)
  const feedError = useActivityStore((s) => s.status === 'error')
  const summary = useMemo(() => {
    if (!threadId) return null
    const rows = selectWorkerRowsForParent(activityRows, threadId)
    // No background work: leave the composer exactly as it was.
    if (rows.length === 0) return null
    return selectSessionExecutionSummary(rows, { feedError, mainRunning })
  }, [activityRows, threadId, feedError, mainRunning])

  if (!summary || summary.kind === 'none') return null

  const label = t(STATUS_LABEL_KEY[summary.kind])
  const counts = countLabel(t, summary.counts)
  const detail =
    counts ||
    (summary.kind === 'unknown' ? t('backgroundTaskUnknownHint') : '')
  const activity =
    summary.kind === 'unknown' ? undefined : summary.activityTitle
  const Icon =
    summary.kind === 'running' || summary.kind === 'starting' || summary.kind === 'continuing'
      ? Loader2
      : summary.kind === 'completed'
        ? CircleCheck
        : summary.kind === 'failed'
          ? CircleAlert
          : summary.kind === 'unknown'
            ? CircleDashed
            : summary.kind === 'review'
              ? ClipboardCheck
              : CircleHelp
  const spinning =
    summary.kind === 'running' || summary.kind === 'starting' || summary.kind === 'continuing'
  const iconClass = spinning
    ? 'text-accent'
    : summary.kind === 'completed'
      ? 'text-emerald-600 dark:text-emerald-400'
      : summary.kind === 'failed'
        ? 'text-red-500'
        : summary.kind === 'unknown'
          ? 'text-ds-faint'
          : 'text-amber-500'
  const action =
    summary.kind === 'waiting-user' || summary.kind === 'failed'
      ? t('backgroundTaskResolve')
      : t('backgroundTaskOpen')
  const remaining = summary.unfinished

  return (
    <div
      data-background-task-strip={summary.kind}
      data-background-task-unfinished={remaining}
      className="ds-composer-status-glass pointer-events-auto flex w-full max-w-[46rem] items-center gap-2.5 self-start rounded-xl border border-ds-border-muted/80 py-2 pl-3 pr-2"
    >
      <Icon
        className={`h-3.5 w-3.5 shrink-0 ${iconClass} ${spinning ? 'motion-safe:animate-spin motion-reduce:animate-none' : ''}`}
        strokeWidth={2}
        aria-hidden="true"
      />
      <div
        className="min-w-0 flex-1"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] leading-5">
          <span className="shrink-0 font-medium text-ds-ink">{label}</span>
          {activity ? (
            <span className="min-w-0 truncate text-ds-muted">· {activity}</span>
          ) : null}
        </div>
        {detail ? (
          <div className="truncate text-[11.5px] leading-4 text-ds-muted">{detail}</div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={requestOpenWorkersPanel}
        className="shrink-0 rounded-full border border-ds-border-muted px-2.5 py-1 text-[11.5px] font-medium text-ds-ink transition hover:border-accent/40 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        aria-label={t('backgroundTaskWorkersLabel', { status: label, remaining })}
      >
        {action}
      </button>
    </div>
  )
}
