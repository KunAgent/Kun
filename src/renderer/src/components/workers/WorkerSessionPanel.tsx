import { useCallback, useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Loader2, RefreshCw, Square, Unplug } from 'lucide-react'
import { useActivityStore } from '../../store/activity-store'
import { useChatStore } from '../../store/chat-store'
import type { WorkerRowData } from './worker-row-data'
import {
  workerIsLive,
  workerMetaParts,
  workerStatus,
  workerTimeLabel
} from './worker-presentation'
import { WorkerAvatar, WorkerStatusGlyph } from './WorkerParts'
import { WorkerMoreMenu } from './WorkerMoreMenu'
import { WorkerTranscript } from './WorkerTranscript'
import { WorkerComposer } from './WorkerComposer'
import { WorkerActionError } from './WorkerActionError'
import { useTeamWorkers } from './use-team-workers'
import { useWorkerActions } from './use-worker-actions'
import { useWorkerTranscript } from './use-worker-transcript'
import { useWorkerClock } from './use-worker-clock'
import { EMPTY_WORKER_DRAFT, rememberWorkerLabel, updateWorkerViewDraft, useWorkerViewStore, type WorkerDraft } from './worker-view-store'
import './workers-panel.css'

/**
 * One worker's own right-panel tab: a status bar (state, clock, agent,
 * usage, controls), its conversation, and a composer addressed only to it.
 * The main thread and its composer are never touched.
 */
export function WorkerSessionPanel({
  workerId,
  active = true,
  className
}: {
  workerId: string
  active?: boolean
  className?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const managerThreadId = useActivityStore((s) => s.rows[workerId]?.parentThreadId) ?? activeThreadId
  const { rows, loaded, reload } = useTeamWorkers(managerThreadId, active)
  const row = rows.find((entry) => entry.workerId === workerId)

  useEffect(() => {
    if (row) rememberWorkerLabel(workerId, row.label)
  }, [row, workerId])

  if (!active) return <div className={className} data-worker-inspector={workerId} data-worker-inactive />
  if (!row) {
    return (
      <div className={`flex h-full items-center justify-center gap-2 px-6 text-center text-[12.5px] text-ds-faint ${className ?? ''}`} data-worker-inspector={workerId}>
        {loaded ? t('workerTab.missing') : <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />{t('workersLoading')}</>}
      </div>
    )
  }
  return <WorkerSession key={workerId} row={row} reload={reload} className={className} />
}

function WorkerSession({
  row,
  reload,
  className
}: {
  row: WorkerRowData
  reload: () => Promise<void>
  className?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const workerId = row.workerId
  const threadId = row.child?.threadId ?? workerId
  const selectThread = useChatStore((s) => s.selectThread)
  const draft = useWorkerViewStore((s) => s.drafts[workerId]) ?? EMPTY_WORKER_DRAFT
  const updateDraft = useCallback(
    (update: (current: WorkerDraft) => WorkerDraft) => updateWorkerViewDraft(workerId, update),
    [workerId]
  )
  const { busy, error: actionError, dismissError, stop, detach, answer } = useWorkerActions(reload)
  const { detail, loading, error, loadingOlder, loadOlder, refresh } =
    useWorkerTranscript(threadId, row.activityRow?.updatedAt)
  const status = workerStatus(row)
  const live = workerIsLive(row)
  const now = useWorkerClock(live)
  const time = workerTimeLabel(row, now, t)
  const meta = workerMetaParts(row)
  const canStop = live && (row.child ? Boolean(row.child.turnId) : row.state === 'active')

  return (
    <section className={`flex h-full min-h-0 flex-col ${className ?? ''}`} data-worker-inspector={workerId}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-ds-border-muted pl-3.5 pr-2">
        <WorkerAvatar workerId={workerId} harnessId={row.harnessId ?? row.activityRow?.harnessId} size={24} />
        <span
          className="ds-worker-tone ds-worker-tone-pill inline-flex h-[22px] shrink-0 items-center gap-[5px] rounded-md px-2 text-[11.5px] font-semibold"
          data-tone={status.tone}
          data-worker-status={status.kind}
        >
          <WorkerStatusGlyph kind={status.kind} size={11} />
          {t(`workersStatus.${status.kind}`)}
          {time ? <span className="font-medium tabular-nums">{time}</span> : null}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ds-faint" title={meta.join(' · ')}>
          {meta.join(' · ')}
          {row.diffStats ? (
            <span className="font-mono tabular-nums" data-worker-preview-diff>
              {meta.length ? ' · ' : ''}
              <span className="text-ds-diff-added">+{row.diffStats.insertions}</span>{' '}
              <span className="text-ds-diff-removed">−{row.diffStats.deletions}</span>
            </span>
          ) : null}
        </span>
        {canStop ? (
          <button
            type="button"
            disabled={busy?.action === 'stop'}
            onClick={() => stop(row)}
            aria-label={t('workersStop')}
            title={t('workersStop')}
            data-worker-stop-action
            className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40"
          >
            <Square className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void selectThread(threadId).catch(() => undefined)}
          aria-label={t('workersAction.openInMain')}
          title={t('workersAction.openInMain')}
          data-worker-full-open={workerId}
          className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        </button>
        <WorkerMoreMenu
          size="md"
          label={t('workersAction.more')}
          items={[
            {
              id: 'refresh',
              label: t('reviewRefresh'),
              icon: <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.9} />,
              onSelect: () => {
                refresh()
                void reload()
              }
            },
            ...(row.state === 'active' && !row.child ? [{
              id: 'detach',
              label: t('workersDetach'),
              confirmLabel: t('workersDetachConfirm'),
              icon: <Unplug className="h-3.5 w-3.5" strokeWidth={1.9} />,
              onSelect: () => detach(row)
            }] : [])
          ]}
        />
      </div>
      {actionError ? (
        <div className="shrink-0 px-3 pt-2"><WorkerActionError message={actionError} onDismiss={dismissError} /></div>
      ) : null}
      <WorkerTranscript
        threadId={threadId}
        workspaceRoot={row.activityRow?.workspace.path ?? ''}
        detail={detail}
        loading={loading}
        loadingOlder={loadingOlder}
        error={error}
        onLoadOlder={loadOlder}
      />
      <WorkerComposer
        row={row}
        draft={draft}
        updateDraft={updateDraft}
        answerBusy={busy?.action === 'answer'}
        onAnswer={answer}
        onRefreshTeam={reload}
        onSent={refresh}
      />
    </section>
  )
}
