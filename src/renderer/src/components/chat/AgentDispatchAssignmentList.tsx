import type { AdeDispatchRecord } from '@shared/ade-teams'
import { useTranslation } from 'react-i18next'
import { ChevronRight, CircleCheck, CircleSlash, CircleX, Clock3, Hand, Loader2 } from 'lucide-react'
import type { AgentDispatchAssignmentRoute, AgentDispatchAssignmentView, AgentDispatchIntentView } from '@shared/agent-dispatch'
import { AgentIcon } from '../agent-icon'
import { agentIconId } from '../../lib/agent-icon-aliases'
import { AgentDispatchRouteLabel, AgentDispatchRoutePicker } from './AgentDispatchRoutePicker'
import { formatDispatchClock, workerElapsed, type WorkerProgress } from './agent-dispatch-card-model'

function ProgressChip({ progress }: { progress: WorkerProgress }) {
  const { t } = useTranslation('common')
  const label = t(`dispatchIntent.worker.${progress.state}`)
  const base = 'inline-flex min-w-0 max-w-[14rem] items-center gap-1 text-[12px]'
  switch (progress.state) {
    case 'working': return <span className={`${base} text-ds-status-running`} title={progress.detail}>
      <Loader2 size={12} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden /><span className="truncate">{progress.detail || label}</span></span>
    case 'waiting': return <span className={`${base} text-ds-status-warning`}>
      <Hand size={12} className="shrink-0" aria-hidden />
      <span className="truncate">{progress.waitingReason ? t(`dispatchIntent.waitingReason.${progress.waitingReason}`) : label}</span></span>
    case 'passed': case 'waived': return <span className={`${base} text-ds-status-success`}><CircleCheck size={12} className="shrink-0" aria-hidden />{label}</span>
    case 'needs_changes': case 'awaiting_review': return <span className={`${base} text-ds-status-warning`} title={progress.detail}><Clock3 size={12} className="shrink-0" aria-hidden />{label}</span>
    case 'refused':
    case 'rejected':
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
export function AgentDispatchAssignmentList({ intent, assignments, editable, busy, onRouteChange, onInteract, onPendingChange, onOpenWorker, progresses, now }: {
  intent: AgentDispatchIntentView
  dispatches?: readonly AdeDispatchRecord[]
  assignments: readonly AgentDispatchAssignmentView[]
  progresses: readonly WorkerProgress[]
  now: number
  editable: boolean
  busy: boolean
  onRouteChange: (index: number, route: AgentDispatchAssignmentRoute) => void
  onInteract?: () => void
  onPendingChange?: (index: number, pending: boolean) => void
  onOpenWorker: (workerId: string, label?: string) => void
}) {
  const { t } = useTranslation('common')
  const batch = assignments.length > 1
  return <ol className="divide-y divide-ds-border-muted border-t border-ds-border-muted" data-dispatch-assignments>
    {assignments.map((assignment, index) => {
      const progress = progresses[index]
      const elapsed = workerElapsed(progress, now)
      const preview = (['working', 'waiting'].includes(progress.executionState) ? progress.detail : progress.summary)?.replace(/\s+/g, ' ').trim()
      return <li key={index} className="flex min-w-0 items-start gap-3 px-4 py-3" data-dispatch-assignment={index}>
        <span className="mt-0.5 shrink-0 text-ds-muted" aria-hidden><AgentIcon harnessId={agentIconId(assignment.agentId)} size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {progress.workerId ? <button type="button" onClick={() => onOpenWorker(progress.workerId!, assignment.label)}
              className="min-w-0 flex-1 truncate rounded text-left text-[13px] font-medium text-ds-ink hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" title={assignment.label}>
              {assignment.label}
            </button> : <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ds-ink" title={assignment.label}>{assignment.label}</span>}
            <ProgressChip progress={progress} />
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {editable
              ? <AgentDispatchRoutePicker route={assignment} disabled={busy} roleUse="worker"
                workspace={intent.recommendation.workspace}
                onChange={(route) => onRouteChange(index, route)} onInteract={onInteract}
                onPendingChange={onPendingChange ? (pending) => onPendingChange(index, pending) : undefined} />
              : <AgentDispatchRouteLabel route={assignment} agentName={assignment.agentName} />}
            {progress.reportOutcome && progress.reportOutcome !== 'succeeded' ? <span className="text-[11.5px] text-ds-status-warning">
              {t(`dispatchIntent.group.report.${progress.reportOutcome}`)}
            </span> : null}
          </div>
          {preview ? <p className="mt-1 truncate text-[12px] leading-5 text-ds-muted" title={progress.summary || progress.detail} data-dispatch-preview>{preview}</p> : null}
          {assignment.workspaceIsolation === 'worktree' ? <p className="mt-1 text-[11.5px] leading-4 text-ds-muted"
            data-dispatch-workspace-isolation="worktree">{t('dispatchIntent.isolatedWorkspaceHint')}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1 pt-0.5">
          <span className="text-[12px] tabular-nums text-ds-muted" title={t(elapsed === null ? 'dispatchIntent.group.timingUnknown' : 'dispatchIntent.group.elapsed')} data-dispatch-elapsed>
            {elapsed === null ? '—' : formatDispatchClock(elapsed)}
          </span>
          {progress.workerId ? <button type="button" onClick={() => onOpenWorker(progress.workerId!, assignment.label)}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-[12px] font-medium text-accent hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={`${t('dispatchIntent.viewProcess')} ${batch ? index + 1 : ''}`.trim()}>
            {t('dispatchIntent.view')}<ChevronRight size={13} aria-hidden />
          </button> : null}
        </div>
      </li>
    })}
  </ol>
}
