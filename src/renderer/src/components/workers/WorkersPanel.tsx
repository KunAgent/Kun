import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import type { AdeTeamOverview } from '@shared/ade-teams'
import { useActivityStore } from '../../store/activity-store'
import { useChatStore } from '../../store/chat-store'
import { selectWorkerRowsForParent } from '../../store/activity-selectors'
import { getProvider } from '../../agent/registry'
import { mergeWorkerRows, summarizeWorkerRows } from './worker-row-data'
import { WorkerRow } from './WorkerRow'

/**
 * Right-panel Workers surface (12 §6.1): team summary on top, one WorkerRow
 * per team worker. Data = `GET /v1/teams/by-manager/:threadId` merged with
 * live ActivityStore rows; the overview refetches (debounced) whenever a
 * worker row's `updatedAt` advances so the panel tracks ongoing work.
 */
export function WorkersPanel({ className }: { className?: string }): ReactElement {
  const { t } = useTranslation('common')
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const selectThread = useChatStore((s) => s.selectThread)
  const activityRows = useActivityStore((s) => s.rows)
  const workerRows = useMemo(
    () => (activeThreadId ? selectWorkerRowsForParent(activityRows, activeThreadId) : []),
    [activityRows, activeThreadId]
  )
  const [overview, setOverview] = useState<AdeTeamOverview | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<{ workerId: string; action: 'stop' | 'detach' | 'answer' } | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reload = useCallback(async (threadId: string): Promise<void> => {
    const provider = getProvider()
    if (!provider.getTeamOverview) return
    try {
      setOverview(await provider.getTeamOverview(threadId))
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    }
  }, [])

  useEffect(() => {
    setOverview(null)
    setLoadFailed(false)
    if (activeThreadId) void reload(activeThreadId)
  }, [activeThreadId, reload])

  // Debounced refetch when worker activity rows move (09 §9: the panel must
  // reflect state changes without a manual refresh).
  const rowStamp = workerRows.map((row) => `${row.unitId}:${row.updatedAt}`).join('|')
  useEffect(() => {
    if (!activeThreadId || !overview) return
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => void reload(activeThreadId), 800)
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [rowStamp, activeThreadId, overview, reload])

  const rows = useMemo(
    () => (overview ? mergeWorkerRows(overview, workerRows) : []),
    [overview, workerRows]
  )
  const summary = useMemo(() => summarizeWorkerRows(rows), [rows])

  const runAction = useCallback(
    (workerId: string, action: 'stop' | 'detach', run: () => Promise<void>): void => {
      setBusy({ workerId, action })
      void run()
        .then(() => (activeThreadId ? reload(activeThreadId) : undefined))
        .catch(() => setLoadFailed(true))
        .finally(() => setBusy(null))
    },
    [activeThreadId, reload]
  )

  const onOpen = useCallback(
    (workerId: string) => {
      void selectThread(workerId).catch(() => undefined)
    },
    [selectThread]
  )
  const onStop = useCallback(
    (workerId: string) =>
      runAction(workerId, 'stop', async () => {
        const provider = getProvider()
        if (!provider.controlTeamWorker) return
        await provider.controlTeamWorker(workerId, 'stop')
      }),
    [runAction]
  )
  const onDetach = useCallback(
    (workerId: string) =>
      runAction(workerId, 'detach', async () => {
        const provider = getProvider()
        if (!provider.controlTeamWorker) return
        await provider.controlTeamWorker(workerId, 'detach')
      }),
    [runAction]
  )
  const onAnswer = useCallback(
    (questionId: string, answer: string): void => {
      const provider = getProvider()
      if (!provider.answerTeamQuestion) return
      setBusy({ workerId: questionId, action: 'answer' })
      void provider.answerTeamQuestion(questionId, answer)
        .then(() => (activeThreadId ? reload(activeThreadId) : undefined))
        .catch(() => setLoadFailed(true))
        .finally(() => setBusy(null))
    },
    [activeThreadId, reload]
  )

  return (
    <div className={`flex h-full min-h-0 min-w-0 flex-col ${className ?? ''}`} data-workers-panel>
      <div className="flex items-center gap-2 border-b border-ds-border px-4 py-3">
        <Users className="h-4 w-4 text-ds-muted" strokeWidth={1.9} aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ds-ink">
          {t('workersPanelTitle')}
        </h2>
        {overview ? (
          <span className="shrink-0 text-[11px] text-ds-faint" data-workers-summary>
            {t('workersSummary', {
              running: summary.running,
              waiting: summary.waiting,
              done: summary.done,
              failed: summary.failed
            })}
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {rows.map((row) => (
          <div key={row.workerId} className="mb-2">
            <WorkerRow
              row={row}
              busyAction={
                busy && (busy.workerId === row.workerId || busy.workerId === row.openQuestion?.questionId)
                  ? busy.action
                  : null
              }
              onOpen={onOpen}
              onAnswer={onAnswer}
              onStop={onStop}
              onDetach={onDetach}
            />
          </div>
        ))}
        {overview && rows.length === 0 ? (
          <p className="px-1 py-6 text-center text-[12.5px] text-ds-faint">
            {t('workersEmpty')}
          </p>
        ) : null}
        {!overview && !loadFailed ? (
          <p className="px-1 py-6 text-center text-[12.5px] text-ds-faint">
            {t('workersLoading')}
          </p>
        ) : null}
        {loadFailed ? (
          <p className="px-1 py-6 text-center text-[12.5px] text-ds-faint" data-workers-error>
            {t('workersUnavailable')}
          </p>
        ) : null}
      </div>
    </div>
  )
}
