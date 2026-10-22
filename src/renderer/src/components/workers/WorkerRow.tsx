import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock3, ExternalLink, Square, Unplug } from 'lucide-react'
import type { WorkerRowData } from './worker-row-data'
import {
  workerActivityText,
  workerIsLive,
  workerMetaParts,
  workerStatus,
  workerTimeLabel
} from './worker-presentation'
import { WorkerAvatar, WorkerQuestionCard, WorkerStatusGlyph } from './WorkerParts'
import { WorkerMoreMenu, type WorkerMenuItem } from './WorkerMoreMenu'

/**
 * One Collaboration list row: who, what it is doing now, how long, and
 * what it cost. Clicking opens the worker in its own tab; Stop and the
 * "⋯" menu appear on hover. An open question is answered in place.
 */
export function WorkerRow({
  row,
  now,
  busyAction,
  onOpen,
  onFullOpen,
  onAnswer,
  onStop,
  onDetach
}: {
  row: WorkerRowData
  now: number
  busyAction: 'stop' | 'detach' | 'answer' | null
  onOpen: (row: WorkerRowData) => void
  onFullOpen: (row: WorkerRowData) => void
  onAnswer: (questionId: string, answer: string) => void
  onStop: (row: WorkerRowData) => void
  onDetach: (row: WorkerRowData) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const status = workerStatus(row)
  const time = workerTimeLabel(row, now, t)
  const meta = workerMetaParts(row)
  const diff = row.diffStats
  const verdict = status.kind === 'done' ? row.verdict : undefined
  const canStop = workerIsLive(row) && (row.child ? Boolean(row.child.turnId) : row.state === 'active')
  const menuItems: WorkerMenuItem[] = [
    {
      id: 'full-open',
      label: t('workersAction.openInMain'),
      icon: <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />,
      onSelect: () => onFullOpen(row)
    },
    ...(row.state === 'active' && !row.child ? [{
      id: 'detach',
      label: t('workersDetach'),
      confirmLabel: t('workersDetachConfirm'),
      disabled: busyAction === 'detach',
      icon: <Unplug className="h-3.5 w-3.5" strokeWidth={1.9} />,
      onSelect: () => onDetach(row)
    }] : [])
  ]

  return (
    <div data-worker-row={row.workerId} data-worker-status={status.kind} className="group">
      <div className="flex items-start gap-1.5 rounded-xl py-2.5 pl-2.5 pr-1.5 transition hover:bg-ds-hover">
        <button
          type="button"
          onClick={() => onOpen(row)}
          data-worker-open={row.workerId}
          className="flex min-w-0 flex-1 gap-[11px] text-left outline-none"
        >
          <WorkerAvatar workerId={row.workerId} harnessId={row.harnessId ?? row.activityRow?.harnessId} />
          <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[13.5px] font-semibold leading-[18px] text-ds-ink" title={row.label}>
                {row.label}
              </span>
              {row.reviewer ? (
                <span className="inline-flex h-[18px] shrink-0 items-center rounded-[5px] bg-accent-soft px-1.5 text-[10.5px] font-semibold text-accent">
                  {t('workersReviewerBadge')}
                </span>
              ) : null}
              {verdict ? (
                <span
                  className="ds-worker-tone ds-worker-tone-pill inline-flex h-[18px] shrink-0 items-center rounded-[5px] px-1.5 text-[10.5px] font-semibold"
                  data-tone={verdict.status === 'passed' || verdict.status === 'waived' ? 'success'
                    : verdict.status === 'pending' ? 'running' : 'danger'}
                  data-worker-verdict={verdict.status}
                >
                  {t(`workersVerdict.${verdict.status}`)}
                </span>
              ) : null}
            </span>
            <span
              className={`ds-worker-tone flex min-w-0 items-center gap-[5px] text-[12.5px] ${
                status.tone === 'warning' || status.tone === 'danger' ? 'ds-worker-tone-text' : 'text-ds-muted'
              }`}
              data-tone={status.tone}
            >
              <WorkerStatusGlyph kind={status.kind} size={status.kind === 'working' ? 12 : 13} />
              <span className="truncate" data-worker-activity>{workerActivityText(row, t)}</span>
            </span>
            {meta.length || diff || row.activityRow?.stalled ? (
              <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ds-faint">
                {meta.length ? <span className="truncate">{meta.join(' · ')}</span> : null}
                {diff ? (
                  <span className="shrink-0 font-mono tabular-nums" title={t('workersDiffStats')}>
                    <span className="text-ds-diff-added">+{diff.insertions}</span>{' '}
                    <span className="text-ds-diff-removed">−{diff.deletions}</span>
                  </span>
                ) : null}
                {diff ? <span className="shrink-0">{t('workersRow.files', { n: diff.changedFiles })}</span> : null}
                {row.activityRow?.stalled && workerIsLive(row) ? (
                  <span className="ds-worker-tone ds-worker-tone-text inline-flex shrink-0 items-center gap-[3px]" data-tone="warning">
                    <Clock3 className="h-[11px] w-[11px]" strokeWidth={2.2} aria-hidden />
                    {t('adeStatusStalled')}
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        </button>
        <div className="relative flex shrink-0 items-start">
          {time ? (
            <span className="pr-1 text-[11.5px] leading-[18px] tabular-nums text-ds-faint group-focus-within:hidden group-hover:hidden">
              {time}
            </span>
          ) : null}
          <span className={`-mt-1 items-center ${time ? 'hidden group-focus-within:flex group-hover:flex' : 'flex'}`}>
            {canStop ? (
              <button
                type="button"
                disabled={busyAction === 'stop'}
                onClick={() => onStop(row)}
                aria-label={t('workersStop')}
                title={t('workersStop')}
                data-worker-row-stop={row.workerId}
                className="grid h-7 w-7 place-items-center rounded-lg text-ds-muted transition hover:bg-ds-card hover:text-ds-ink disabled:opacity-40"
              >
                <Square className="h-[13px] w-[13px]" strokeWidth={2} aria-hidden />
              </button>
            ) : null}
            <WorkerMoreMenu items={menuItems} label={t('workersAction.more')} />
          </span>
        </div>
      </div>
      {row.openQuestion ? (
        <div className="mb-1.5 ml-[53px] mr-2.5 mt-[-2px]">
          <WorkerQuestionCard
            question={row.openQuestion}
            busy={busyAction === 'answer'}
            onAnswer={onAnswer}
            variant="inline"
          />
        </div>
      ) : null}
    </div>
  )
}
