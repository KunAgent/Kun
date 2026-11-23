import { useEffect, useId, useState, type ComponentProps, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useActivityStore } from '../../store/activity-store'
import { AgentIcon } from '../agent-icon'
import { agentIconId } from '../../lib/agent-icon-aliases'
import { AgentDispatchAssignmentList } from './AgentDispatchAssignmentList'
import { dispatchGroupElapsed, dispatchRollup, formatDispatchClock, workerProgress } from './agent-dispatch-card-model'

type Props = Omit<ComponentProps<typeof AgentDispatchAssignmentList>, 'progresses' | 'now'> & { status: ReactNode }

/** One clock and disclosure per dispatch intent; control/approval actions stay outside the fold. */
export function AgentDispatchWorkerGroup({ status, ...props }: Props) {
  const { t } = useTranslation('common')
  const id = useId()
  const rows = useActivityStore((state) => state.rows)
  const progresses = props.assignments.map((_, index) => workerProgress(props.intent, index, rows, props.dispatches))
  const counts = dispatchRollup(progresses)
  const [expanded, setExpanded] = useState(true)
  const [now, setNow] = useState(Date.now)
  const ticking = progresses.some((progress) => progress.startedAt && !progress.finishedAt &&
    ['working', 'waiting'].includes(progress.executionState))
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [ticking])
  const open = props.editable || expanded
  const elapsed = dispatchGroupElapsed(progresses, now)
  const summary = Object.entries(counts).filter(([, count]) => count > 0)
    .map(([state, count]) => t(`dispatchIntent.group.${state}`, { count })).join(' · ')
  const title = props.assignments.length > 1
    ? t('dispatchIntent.group.title', { count: props.assignments.length }) : props.intent.recommendation.title
  const attention = progresses.flatMap((progress, index) => {
    const reviewProblem = ['rejected', 'needs_changes'].includes(progress.state)
    const reportProblem = progress.reportOutcome === 'failed' || progress.reportOutcome === 'partial'
    if (!['waiting', 'failed', 'refused'].includes(progress.executionState) && !reviewProblem && !reportProblem) return []
    const detail = reviewProblem ? progress.detail || progress.summary : progress.summary || progress.detail
    const label = progress.waitingReason ? t(`dispatchIntent.waitingReason.${progress.waitingReason}`)
      : reportProblem && !reviewProblem ? t(`dispatchIntent.group.report.${progress.reportOutcome}`) : t(`dispatchIntent.worker.${progress.state}`)
    return [{ progress, assignment: props.assignments[index], detail, label }]
  })
  return <>
    <header className="flex min-w-0 flex-wrap items-center gap-2 px-4 py-3">
      <button type="button" aria-expanded={open} aria-controls={id} disabled={props.editable}
        onClick={() => setExpanded((value) => !value)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default">
        <span className="flex shrink-0 -space-x-2" aria-hidden>
          {props.assignments.slice(0, 3).map((assignment, index) => <span key={index}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-ds-border bg-ds-card">
            <AgentIcon harnessId={agentIconId(assignment.agentId)} size={15} />
          </span>)}
          {props.assignments.length > 3 ? <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-ds-subtle px-1 text-[11px] text-ds-muted">+{props.assignments.length - 3}</span> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold leading-5 text-ds-ink" title={props.intent.recommendation.title}>{title}</span>
          <span className="block text-[12px] leading-5 text-ds-muted" data-dispatch-rollup>{summary}</span>
        </span>
        {elapsed !== null ? <span className="shrink-0 text-[12px] tabular-nums text-ds-muted" title={t('dispatchIntent.group.elapsed')} data-dispatch-group-elapsed>{formatDispatchClock(elapsed)}</span> : null}
        <ChevronDown size={14} aria-hidden className={`shrink-0 text-ds-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>
      {status}
    </header>
    <div id={id} hidden={!open}>
      {open ? <AgentDispatchAssignmentList {...props} progresses={progresses} now={now} /> : null}
    </div>
    {!open && attention.length ? <div className="space-y-1 border-t border-ds-border-muted px-4 py-2 text-[12px] text-ds-status-warning" role="status">
      {attention.map(({ progress, assignment, detail, label }, index) => <div key={index} className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate" title={detail}>
          {assignment.label}: {label}{detail ? ` — ${detail}` : ''}
        </span>
        {progress.workerId ? <button type="button" className="shrink-0 rounded px-2 py-1 text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onClick={() => props.onOpenWorker(progress.workerId!, assignment.label)}>{t('dispatchIntent.view')}</button> : null}
      </div>)}
    </div> : null}
  </>
}
