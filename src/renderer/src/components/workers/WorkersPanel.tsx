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
import { ensureWorkerView, selectWorkerPreview, updateWorkerViewDraft, useWorkerViewStore } from './worker-view-store'
import { EMPTY_WORKER_DRAFT, WorkerInspector, type WorkerDraft } from './WorkerInspector'

/**
 * Right-panel Workers surface (12 §6.1): team summary on top, one WorkerRow
 * per team worker. Data = `GET /v1/teams/by-manager/:threadId` merged with
 * live ActivityStore rows; the overview refetches (debounced) whenever a
 * worker row's `updatedAt` advances so the panel tracks ongoing work.
 */
export function WorkersPanel({
  className,
  active = true,
  managerThreadId: explicitManagerThreadId
}: {
  className?: string
  active?: boolean
  /** Lets the host retain the manager context while a worker is inspected. */
  managerThreadId?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const managerThreadId = explicitManagerThreadId ?? activeThreadId
  const managerThreadRef = useRef(managerThreadId)
  managerThreadRef.current = managerThreadId
  const selectThread = useChatStore((s) => s.selectThread)
  const activityRows = useActivityStore((s) => s.rows)
  const workerRows = useMemo(
    () => (managerThreadId ? selectWorkerRowsForParent(activityRows, managerThreadId) : []),
    [activityRows, managerThreadId]
  )
  const [overview, setOverview] = useState<AdeTeamOverview | null>(null)
  const view = useWorkerViewStore((s) => managerThreadId ? s.managers[managerThreadId] : undefined)
  const selectedWorkerId = view?.selectedWorkerId ?? null
  const workerDrafts = view?.drafts ?? {}
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<{ workerId: string; action: 'stop' | 'detach' | 'answer' } | null>(null)
  const loadGeneration = useRef(0)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reload = useCallback(async (threadId: string): Promise<void> => {
    const request = ++loadGeneration.current
    const provider = getProvider()
    if (!provider.getTeamOverview) return
    try {
      const next = await provider.getTeamOverview(threadId)
      if (managerThreadRef.current !== threadId || request !== loadGeneration.current) return
      setOverview(next)
      setLoadFailed(false)
    } catch {
      if (managerThreadRef.current === threadId && request === loadGeneration.current) setLoadFailed(true)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    setOverview(null)
    setLoadFailed(false)
    if (managerThreadId) {
      ensureWorkerView(managerThreadId)
      void reload(managerThreadId)
    }
    return () => { loadGeneration.current += 1 }
  }, [managerThreadId, active, reload])

  // Debounced refetch when worker activity rows move (09 §9: the panel must
  // reflect state changes without a manual refresh).
  const hasOverview = overview !== null
  const rowStamp = workerRows.map((row) => `${row.unitId}:${row.updatedAt}`).join('|')
  useEffect(() => {
    if (!active || !managerThreadId || !hasOverview) return
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => void reload(managerThreadId), 800)
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [rowStamp, managerThreadId, hasOverview, active, reload])

  const rows = useMemo(
    () => (overview ? mergeWorkerRows(overview, workerRows) : []),
    [overview, workerRows]
  )
  const summary = useMemo(() => summarizeWorkerRows(rows), [rows])
  const selectedRow = rows.find((row) => row.workerId === selectedWorkerId)

  const runAction = useCallback(
    (workerId: string, action: 'stop' | 'detach', run: () => Promise<void>): void => {
      setBusy({ workerId, action })
      void run()
        .then(() => (managerThreadId ? reload(managerThreadId) : undefined))
        .catch(() => setLoadFailed(true))
        .finally(() => setBusy(null))
    },
    [managerThreadId, reload]
  )

  const onOpen = useCallback(
    (workerId: string) => {
      if (managerThreadId) selectWorkerPreview(managerThreadId, workerId)
    },
    [managerThreadId]
  )
  const onFullOpen = useCallback((workerId: string): void => {
    void selectThread(workerId).catch(() => undefined)
  }, [selectThread])
  const updateWorkerDraft = useCallback((workerId: string, update: (current: WorkerDraft) => WorkerDraft): void => {
    if (managerThreadId) updateWorkerViewDraft(managerThreadId, workerId, update)
  }, [managerThreadId])
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
        .then(() => (managerThreadId ? reload(managerThreadId) : undefined))
        .catch(() => setLoadFailed(true))
        .finally(() => setBusy(null))
    },
    [managerThreadId, reload]
  )

  if (!active) return <div className={className} data-workers-panel data-workers-inactive />

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
            {overview.usage ? (
              <span
                data-workers-usage
                data-budget-exceeded={
                  overview.usage.hardExceeded ? 'hard'
                    : overview.usage.softExceeded ? 'soft' : undefined
                }
                className={
                  overview.usage.hardExceeded
                    ? 'text-ds-status-danger'
                    : overview.usage.softExceeded
                      ? 'text-ds-status-warning'
                      : undefined
                }
              >
                {' '}· {overview.usage.totalTokens.toLocaleString()}
                {overview.usage.hardTokens !== undefined
                  ? `/${overview.usage.hardTokens.toLocaleString()}`
                  : ''}{' '}tok
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className={`${selectedRow ? 'max-h-[45%] shrink-0' : 'min-h-0 flex-1'} overflow-y-auto px-3 py-3`}>
        {rows.map((row) => (
          <div key={row.workerId} className="mb-2">
            <WorkerRow
              row={row}
              selected={row.workerId === selectedWorkerId}
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
      {active && selectedRow ? (
        <WorkerInspector
          key={selectedRow.workerId}
          row={selectedRow}
          draft={workerDrafts[selectedRow.workerId] ?? EMPTY_WORKER_DRAFT}
          updateDraft={updateWorkerDraft}
          onRefreshTeam={() => managerThreadId ? reload(managerThreadId) : Promise.resolve()}
          onClose={() => managerThreadId && selectWorkerPreview(managerThreadId, null)}
          onFullOpen={onFullOpen}
          scrollPositions={view!.scrollPositions}
        />
      ) : null}
    </div>
  )
}
