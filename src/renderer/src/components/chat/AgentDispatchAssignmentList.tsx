import { useTranslation } from 'react-i18next'
import { ChevronRight, CircleCheck, CircleSlash, CircleX, Clock3, Hand, Loader2 } from 'lucide-react'
import type { AgentDispatchAssignmentRoute, AgentDispatchAssignmentView, AgentDispatchIntentView } from '@shared/agent-dispatch'
import { useActivityStore } from '../../store/activity-store'
import { AgentDispatchRouteLabel, AgentDispatchRoutePicker } from './AgentDispatchRoutePicker'
import { dispatchPhase, workerProgress, type WorkerProgress } from './agent-dispatch-card-model'

function ProgressChip({ progress }: { progress: WorkerProgress }) {
  const { t } = useTranslation('common')
  const label = t(`dispatchIntent.worker.${progress.state}`)
  const base = 'inline-flex min-w-0 max-w-[14rem] items-center gap-1 text-[12px]'
  switch (progress.state) {
    case 'working': return <span className={`${base} text-ds-status-running`} title={progress.detail}>
      <Loader2 size={12} className="shrink-0 animate-spin" aria-hidden /><span className="truncate">{progress.detail || label}</span></span>
    case 'waiting': return <span className={`${base} text-ds-status-warning`}>
      <Hand size={12} className="shrink-0" aria-hidden />
      <span className="truncate">{progress.waitingReason ? t(`dispatchIntent.waitingReason.${progress.waitingReason}`) : label}</span></span>
    case 'done': return <span className={`${base} text-ds-status-success`}><CircleCheck size={12} className="shrink-0" aria-hidden />{label}</span>
    case 'failed': return <span className={`${base} text-ds-status-danger`} title={progress.detail}>
      <CircleX size={12} className="shrink-0" aria-hidden />{label}</span>
    case 'cancelled': return <span className={`${base} text-ds-faint`}><CircleSlash size={12} className="shrink-0" aria-hidden />{label}</span>
    default: return <span className={`${base} text-ds-faint`}><Clock3 size={12} className="shrink-0" aria-hidden />{label}</span>
  }
}

/**
 * One row per worker. While the card waits, each row carries its own Agent and
 * model choice; once admitted, the row shows live progress and opens the worker.
 */
export function AgentDispatchAssignmentList({ intent, assignments, editable, busy, onRouteChange, onInteract, onOpenWorker }: {
  intent: AgentDispatchIntentView
  assignments: readonly AgentDispatchAssignmentView[]
  editable: boolean
  busy: boolean
  onRouteChange: (index: number, route: AgentDispatchAssignmentRoute) => void
  onInteract?: () => void
  onOpenWorker: (workerId: string, label?: string) => void
}) {
  const { t } = useTranslation('common')
  const rows = useActivityStore((state) => state.rows)
  const phase = dispatchPhase(intent.state)
  const showProgress = !['waiting', 'paused', 'reviewing'].includes(phase)
  const batch = assignments.length > 1
  return <ol className="divide-y divide-ds-border-muted border-t border-ds-border-muted" data-dispatch-assignments>
    {assignments.map((assignment, index) => {
      const progress = showProgress ? workerProgress(intent, index, rows) : undefined
      return <li key={index} className="flex min-w-0 items-center gap-3 px-4 py-2.5" data-dispatch-assignment={index}>
        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-ds-subtle px-1 text-[11px] font-semibold tabular-nums text-ds-muted">
          {batch ? index + 1 : <span aria-hidden>→</span>}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className={`min-w-[8rem] flex-1 truncate text-[13px] ${batch ? 'font-medium text-ds-ink' : 'text-ds-faint'}`}
            title={batch ? assignment.label : undefined}>
            {batch ? assignment.label : t('dispatchIntent.executor')}
          </span>
          {editable
            ? <AgentDispatchRoutePicker route={assignment} disabled={busy} roleUse="worker"
              workspace={intent.recommendation.workspace}
              onChange={(route) => onRouteChange(index, route)} onInteract={onInteract} />
            : <AgentDispatchRouteLabel route={assignment} agentName={assignment.agentName} />}
        </div>
        {progress ? <ProgressChip progress={progress} /> : null}
        {progress?.workerId ? <button type="button" onClick={() => onOpenWorker(progress.workerId!, assignment.label)}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-[12px] font-medium text-accent hover:bg-ds-hover"
          aria-label={`${t('dispatchIntent.viewProcess')} ${batch ? index + 1 : ''}`.trim()}>
          {t('dispatchIntent.view')}<ChevronRight size={13} aria-hidden />
        </button> : null}
      </li>
    })}
  </ol>
}
