import { useCallback, useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, RefreshCw, Users } from 'lucide-react'
import { useChatStore } from '../../store/chat-store'
import { summarizeWorkerRows, type WorkerRowData } from './worker-row-data'
import { formatWorkerTokens, groupWorkerRows, workerIsLive, type WorkerTone } from './worker-presentation'
import { WorkerRow } from './WorkerRow'
import { openWorkerSession } from './worker-view-store'
import { useTeamWorkers } from './use-team-workers'
import { busyActionFor, useWorkerActions } from './use-worker-actions'
import { useWorkerClock } from './use-worker-clock'
import { WorkerActionError } from './WorkerActionError'
import './workers-panel.css'

/**
 * Right-panel Collaboration tab: team progress on top, then the members
 * grouped by what they need — waiting on you, working, finished. A member
 * opens in its own right-panel tab; this tab stays the list.
 */
export function WorkersPanel({
  className,
  active = true,
  managerThreadId: explicitManagerThreadId
}: {
  className?: string
  active?: boolean
  /** Lets the host keep the manager scope when another thread is active. */
  managerThreadId?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const managerThreadId = explicitManagerThreadId ?? activeThreadId
  const selectThread = useChatStore((s) => s.selectThread)
  const { overview, rows, loaded, loadFailed, reload } = useTeamWorkers(managerThreadId, active)
  const { busy, error, dismissError, stop, detach, answer } = useWorkerActions(reload)
  const summary = useMemo(() => summarizeWorkerRows(rows), [rows])
  const groups = useMemo(() => groupWorkerRows(rows), [rows])
  const now = useWorkerClock(active && rows.some(workerIsLive))

  const onOpen = useCallback((row: WorkerRowData): void => openWorkerSession(row.workerId, row.label), [])
  const onFullOpen = useCallback((row: WorkerRowData): void => {
    void selectThread(row.child?.threadId ?? row.workerId).catch(() => undefined)
  }, [selectThread])

  if (!active) return <div className={className} data-workers-panel data-workers-inactive />

  const usage = overview?.usage
  const segments: Array<{ tone: WorkerTone; count: number }> = [
    { tone: 'success', count: summary.done },
    { tone: 'running', count: summary.running },
    { tone: 'warning', count: summary.waiting },
    { tone: 'danger', count: summary.failed }
  ]

  return (
    <div className={`ds-no-drag flex h-full min-h-0 min-w-0 flex-col ${className ?? ''}`} data-workers-panel>
      {rows.length > 0 ? (
        <div className="flex shrink-0 flex-col gap-2.5 border-b border-ds-border-muted px-4 pb-3.5 pt-4" data-workers-summary>
          <div className="flex items-baseline gap-2">
            <span className="text-[14px] font-semibold text-ds-ink">{t('workersHeader.members', { n: rows.length })}</span>
            <span className="flex-1" />
            {usage && usage.totalTokens > 0 ? (
              <span
                data-workers-usage
                data-budget-exceeded={usage.hardExceeded ? 'hard' : usage.softExceeded ? 'soft' : undefined}
                title={t('workersHeader.usageTitle')}
                className={`font-mono text-[11.5px] tabular-nums ${
                  usage.hardExceeded ? 'text-ds-status-danger' : usage.softExceeded ? 'text-ds-status-warning' : 'text-ds-faint'
                }`}
              >
                {formatWorkerTokens(usage.totalTokens)}
                {usage.hardTokens !== undefined ? ` / ${formatWorkerTokens(usage.hardTokens)}` : ''} tokens
              </span>
            ) : null}
          </div>
          <div
            role="img"
            aria-label={t('workersSummary', summary)}
            className="flex h-1.5 gap-[3px]"
          >
            {segments.filter((segment) => segment.count > 0).map((segment) => (
              <span
                key={segment.tone}
                className="ds-worker-tone ds-worker-tone-dot rounded-[3px]"
                data-tone={segment.tone}
                style={{ flex: segment.count }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] text-ds-muted">
            {segments.filter((segment) => segment.count > 0).map((segment) => (
              <span key={segment.tone} className="inline-flex items-center gap-[5px]">
                <span className="ds-worker-tone ds-worker-tone-dot h-1.5 w-1.5 rounded-full" data-tone={segment.tone} />
                <b className="font-semibold text-ds-ink">{segment.count}</b>
                {t(`workersHeader.${segment.tone}`)}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-0.5" data-workers-scroll>
        {error ? <div className="px-0.5 pt-2"><WorkerActionError message={error} onDismiss={dismissError} /></div> : null}
        {groups.map((group) => (
          <section key={group.section} data-workers-section={group.section}>
            <h3 className="px-2.5 pb-1.5 pt-3.5 text-[11.5px] font-semibold text-ds-faint">
              {t(`workersSection.${group.section}`)} · {group.rows.length}
            </h3>
            {group.rows.map((row) => (
              <WorkerRow
                key={row.workerId}
                row={row}
                now={now}
                busyAction={busyActionFor(busy, row)}
                onOpen={onOpen}
                onFullOpen={onFullOpen}
                onAnswer={answer}
                onStop={stop}
                onDetach={detach}
              />
            ))}
          </section>
        ))}
        {loaded && rows.length === 0 && !loadFailed ? (
          <PanelNotice icon={<Users className="h-5 w-5" strokeWidth={1.8} />} title={t('workersEmptyTitle')} body={t('workersEmpty')} data-workers-empty />
        ) : null}
        {!loaded && !loadFailed ? <WorkersSkeleton label={t('workersLoading')} /> : null}
        {loadFailed && rows.length === 0 ? (
          <PanelNotice
            danger
            icon={<AlertCircle className="h-5 w-5" strokeWidth={1.9} />}
            title={t('workersUnavailableTitle')}
            body={t('workersUnavailable')}
            action={(
              <button
                type="button"
                onClick={() => void reload()}
                className="mt-1 inline-flex h-[30px] items-center gap-1.5 rounded-[9px] border border-ds-border bg-ds-card px-3.5 text-[12.5px] font-semibold text-ds-ink transition hover:bg-ds-hover"
              >
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                {t('workersRetry')}
              </button>
            )}
            data-workers-error
          />
        ) : null}
      </div>
    </div>
  )
}

function PanelNotice({
  icon,
  title,
  body,
  action,
  danger = false,
  ...data
}: {
  icon: ReactElement
  title: string
  body: string
  action?: ReactElement
  danger?: boolean
} & Record<`data-${string}`, boolean>): ReactElement {
  return (
    <div {...data} className="flex flex-col items-center gap-2.5 px-6 py-14 text-center">
      <span
        className={`grid h-11 w-11 place-items-center rounded-[14px] ${danger ? 'bg-ds-danger-soft text-ds-status-danger' : 'bg-ds-subtle text-ds-muted'}`}
        aria-hidden
      >
        {icon}
      </span>
      <span className="text-[13.5px] font-semibold text-ds-ink">{title}</span>
      <span className="max-w-[240px] text-[12px] leading-[1.6] text-ds-faint">{body}</span>
      {action}
    </div>
  )
}

function WorkersSkeleton({ label }: { label: string }): ReactElement {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-[18px] px-2.5 py-4" data-workers-loading>
      {[60, 48, 55].map((width) => (
        <div key={width} className="flex gap-[11px]">
          <span className="h-8 w-8 animate-pulse rounded-[10px] bg-ds-subtle" />
          <span className="flex flex-1 flex-col gap-[7px] pt-0.5">
            <span className="h-[11px] animate-pulse rounded bg-ds-subtle" style={{ width: `${width}%` }} />
            <span className="h-[9px] animate-pulse rounded bg-ds-subtle" style={{ width: `${width + 22}%` }} />
          </span>
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  )
}
