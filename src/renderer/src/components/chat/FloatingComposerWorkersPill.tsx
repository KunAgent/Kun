import { useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import { useActivityStore } from '../../store/activity-store'
import { selectWorkerRowsForParent } from '../../store/activity-selectors'
import { workersPillState } from '../workers/worker-row-data'

/** Window event asking the workbench to open the Workers right panel. */
export const OPEN_WORKERS_PANEL_EVENT = 'kun:open-workers-panel'

export function requestOpenWorkersPanel(): void {
  window.dispatchEvent(new CustomEvent(OPEN_WORKERS_PANEL_EVENT))
}

/**
 * ADE composer track pill (12 §6.1): `Workers N` while manager-dispatched
 * workers are in flight on this thread; switches to the amber
 * `Workers · N 待回答` variant when a worker waits on an answer. Hidden for
 * non-ADE threads and teams with nothing in flight.
 */
export function FloatingComposerWorkersPill({
  threadId,
  enabled
}: {
  threadId: string | null
  enabled: boolean
}): ReactElement | null {
  const { t } = useTranslation('common')
  const activityRows = useActivityStore((s) => s.rows)
  const workerRows = useMemo(
    () => (threadId && enabled ? selectWorkerRowsForParent(activityRows, threadId) : []),
    [activityRows, threadId, enabled]
  )
  const { active, waitingQuestions } = workersPillState(workerRows)
  if (!enabled || !threadId || active === 0) return null
  const waiting = waitingQuestions > 0
  return (
    <button
      type="button"
      data-workers-pill
      onClick={requestOpenWorkersPanel}
      className={`ds-composer-status-glass pointer-events-auto inline-flex min-h-8 items-center gap-1.5 self-start rounded-full border px-3 py-1 text-[12px] font-medium transition hover:border-accent/40 ${
        waiting ? 'border-ds-status-warning/40 text-ds-status-warning' : 'text-ds-muted hover:text-ds-ink'
      }`}
    >
      <Users className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
      {waiting
        ? t('workersPillWaiting', { count: waitingQuestions })
        : t('workersPill', { count: active })}
    </button>
  )
}
