import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  CheckCircle2,
  Circle,
  ExternalLink,
  GitCompare,
  Loader2,
  ShieldQuestion,
  Square,
  Unplug
} from 'lucide-react'
import type { WorkerRowData } from './worker-row-data'
import { StatusDot } from '../activity/StatusDot'

/**
 * One row in the Workers panel (12 §6.1): label + agent/model + status +
 * progress + diff stats + verdict badge, with open / inline-answer / stop /
 * release (confirm) actions. `worker_update` cards reuse the same pieces.
 */
export function WorkerRow({
  row,
  busyAction,
  onOpen,
  onAnswer,
  onStop,
  onDetach
}: {
  row: WorkerRowData
  busyAction: 'stop' | 'detach' | 'answer' | null
  onOpen: (workerId: string) => void
  onAnswer: (questionId: string, answer: string) => void
  onStop: (workerId: string) => void
  onDetach: (workerId: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [answer, setAnswer] = useState('')
  const [confirmDetach, setConfirmDetach] = useState(false)
  const inactive = row.state !== 'active'
  const diff = row.diffStats
  const question = row.openQuestion
  const verdict = row.verdict

  return (
    <div
      data-worker-row={row.workerId}
      className="rounded-xl border border-ds-border bg-ds-card px-3 py-2.5"
    >
      <div className="flex min-w-0 items-center gap-2">
        {row.activityRow ? (
          <StatusDot row={row.activityRow} />
        ) : (
          <span
            className={inactive ? 'text-ds-faint' : 'text-ds-status-running'}
            role="img"
            aria-label={inactive ? t('workersStatusInactive') : t('adeStatusWorking')}
          >
            {inactive ? (
              <Circle className="h-3.5 w-3.5" strokeWidth={0} fill="currentColor" aria-hidden />
            ) : (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden />
            )}
          </span>
        )}
        <button
          type="button"
          onClick={() => onOpen(row.workerId)}
          className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold text-ds-ink transition hover:text-accent"
          title={row.label}
        >
          {row.label}
        </button>
        {row.reviewer ? (
          <span className="shrink-0 rounded-full border border-accent/30 bg-accent/8 px-1.5 py-0.5 text-[10px] font-medium text-accent">
            {t('workersReviewerBadge')}
          </span>
        ) : null}
        {verdict ? (
          <span
            className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
              verdict.status === 'passed'
                ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300'
                : verdict.status === 'rejected' || verdict.status === 'needs_changes'
                  ? 'border-ds-status-danger/30 bg-ds-status-danger/8 text-ds-status-danger'
                  : 'border-ds-border bg-ds-card text-ds-muted'
            }`}
          >
            {verdict.status === 'passed' ? (
              <CheckCircle2 className="mr-0.5 inline h-3 w-3" strokeWidth={2} aria-hidden />
            ) : null}
            {t(`workersVerdict.${verdict.status}`)}
          </span>
        ) : null}
      </div>

      <div className="mt-1 flex min-w-0 items-center gap-2 text-[11.5px] text-ds-faint">
        {row.harnessId ? (
          <span className="inline-flex min-w-0 items-center gap-1 truncate">
            <Bot className="h-3 w-3 shrink-0" strokeWidth={1.9} aria-hidden />
            <span className="truncate">{row.harnessId}{row.model ? ` · ${row.model}` : ''}</span>
          </span>
        ) : null}
        {diff ? (
          <span className="inline-flex shrink-0 items-center gap-1" title={t('workersDiffStats')}>
            <GitCompare className="h-3 w-3" strokeWidth={1.9} aria-hidden />
            <span className="font-mono">+{diff.insertions} −{diff.deletions}</span>
          </span>
        ) : null}
      </div>

      {row.progressNote || row.lastMessagePreview ? (
        <p className="mt-1.5 line-clamp-2 break-words text-[12px] leading-5 text-ds-muted">
          {row.progressNote || row.lastMessagePreview}
        </p>
      ) : null}

      {question ? (
        <div
          data-worker-question={question.questionId}
          className="mt-2 rounded-lg border border-ds-status-warning/30 bg-ds-status-warning/8 px-2.5 py-2"
        >
          <div className="flex items-start gap-1.5 text-[12px] text-ds-ink">
            <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ds-status-warning" strokeWidth={2} aria-hidden />
            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words leading-5">
              {question.question}
            </p>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && answer.trim()) onAnswer(question.questionId, answer.trim())
              }}
              placeholder={t('workersAnswerPlaceholder')}
              className="min-w-0 flex-1 rounded-md border border-ds-border bg-ds-main px-2 py-1 text-[12px] text-ds-ink placeholder:text-ds-faint focus:border-accent/50 focus:outline-none"
            />
            <button
              type="button"
              disabled={!answer.trim() || busyAction === 'answer'}
              onClick={() => onAnswer(question.questionId, answer.trim())}
              className="shrink-0 rounded-md bg-accent px-2 py-1 text-[11.5px] font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              {t('workersAnswerSend')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => onOpen(row.workerId)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <ExternalLink className="h-3 w-3" strokeWidth={1.9} aria-hidden />
          {t('workersOpen')}
        </button>
        <span className="flex-1" />
        {!inactive ? (
          <button
            type="button"
            disabled={busyAction === 'stop'}
            onClick={() => onStop(row.workerId)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40"
          >
            <Square className="h-3 w-3" strokeWidth={1.9} aria-hidden />
            {t('workersStop')}
          </button>
        ) : null}
        {!inactive ? (
          confirmDetach ? (
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                disabled={busyAction === 'detach'}
                onClick={() => onDetach(row.workerId)}
                className="rounded-md border border-ds-status-danger/40 px-1.5 py-1 text-[11.5px] font-semibold text-ds-status-danger transition hover:bg-ds-status-danger/10 disabled:opacity-40"
              >
                {t('workersDetachConfirm')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDetach(false)}
                className="rounded-md px-1.5 py-1 text-[11.5px] text-ds-muted transition hover:bg-ds-hover"
              >
                {t('workersDetachCancel')}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDetach(true)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <Unplug className="h-3 w-3" strokeWidth={1.9} aria-hidden />
              {t('workersDetach')}
            </button>
          )
        ) : null}
      </div>
    </div>
  )
}
