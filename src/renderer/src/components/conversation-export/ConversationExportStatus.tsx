import type { ReactElement } from 'react'
import { AlertCircle, Check, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NormalizedThread } from '../../agent/types'
import type { ExportFailure, ExportOutcome, ExportProgress } from './conversation-export-run'

type Props =
  | { progress: ExportProgress; chosen: NormalizedThread[]; onStop: () => void; outcome?: undefined; onRetry?: undefined; onDone?: undefined }
  | { outcome: ExportOutcome; onRetry: () => void; onDone: () => void; progress?: undefined; chosen?: undefined; onStop?: undefined }

function failureText(failure: ExportFailure, t: (key: string) => string): string {
  if (failure.reason === 'empty') return t('exportDialogFailEmpty')
  if (failure.reason === 'tooLarge') return t('exportDialogFailTooLarge')
  return failure.message ?? t('exportDialogFailUnknown')
}

/** Right-hand pane while exporting, and the full-width result after it. */
export function ConversationExportStatus(props: Props): ReactElement {
  const { t } = useTranslation('common')

  if (props.progress) {
    const { progress, chosen } = props
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-4 px-6 py-[18px]" role="status" aria-live="polite">
        <div className="flex flex-col gap-1">
          <strong className="text-sm font-semibold">{t('exportDialogProgressTitle')}</strong>
          <span className="text-[12.5px] text-ds-muted">
            {t('exportDialogProgressStep', { index: Math.min(progress.index + 1, progress.total), total: progress.total })}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-ds-subtle">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${Math.round((progress.index / Math.max(progress.total, 1)) * 100)}%` }}
          />
        </div>
        <ul className="m-0 flex list-none flex-col gap-2.5 overflow-y-auto p-0">
          {chosen.map((thread) => {
            const done = progress.doneIds.includes(thread.id)
            const failed = progress.failedIds.includes(thread.id)
            const current = progress.currentId === thread.id
            return (
              <li key={thread.id} className="flex items-center gap-2.5 text-[13px]">
                {done ? <Check className="h-4 w-4 shrink-0 text-ds-status-success" strokeWidth={2.2} aria-hidden="true" />
                  : failed ? <AlertCircle className="h-4 w-4 shrink-0 text-ds-status-danger" strokeWidth={2} aria-hidden="true" />
                  : current ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" strokeWidth={2.2} aria-hidden="true" />
                  : <span className="h-4 w-4 shrink-0 rounded-full border-[1.5px] border-ds-border" aria-hidden="true" />}
                <span className={`min-w-0 flex-1 truncate ${current || done || failed ? 'text-ds-ink' : 'text-ds-faint'}`}>{thread.title}</span>
                <span className="shrink-0 text-xs text-ds-faint">
                  {current ? t('exportDialogReading') : done || failed ? '' : t('exportDialogWaiting')}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  const { outcome } = props
  const failures = outcome.kind === 'canceled' ? [] : outcome.failures
  const saved = outcome.kind === 'saved' ? outcome : null
  const ok = saved !== null && failures.length === 0
  const title = saved
    ? failures.length === 0
      ? t('exportDialogDoneTitle', { count: saved.written })
      : t('exportDialogPartialTitle', { ok: saved.written, failed: failures.length })
    : t('exportDialogFailedTitle')
  const detail = outcome.kind === 'failed' && outcome.message && outcome.message !== 'tooLarge' && outcome.message !== 'unavailable'
    ? t('exportDialogFailedBody', { message: outcome.message })
    : outcome.kind === 'failed' && outcome.message === 'tooLarge'
      ? t('exportDialogFailTooLarge')
      : outcome.kind === 'failed' && outcome.message === 'unavailable'
        ? t('conversationExportUnavailable')
        : ''

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-8 py-8 text-center">
        <span className={`grid h-12 w-12 place-items-center rounded-full ${ok ? 'bg-accent-soft text-ds-status-success' : 'bg-ds-subtle text-ds-status-warning'}`}>
          {ok ? <Check className="h-6 w-6" strokeWidth={2.4} aria-hidden="true" /> : <AlertCircle className="h-6 w-6" strokeWidth={2} aria-hidden="true" />}
        </span>
        <h3 className="m-0 text-[15px] font-semibold">{title}</h3>
        {saved ? (
          <>
            <span className="text-[12.5px] text-ds-muted">{t('exportDialogDoneMessages', { count: saved.messageCount })}</span>
            <code className="max-w-full break-all rounded-lg bg-ds-subtle px-2.5 py-1.5 text-[11.5px] text-ds-ink">{saved.location}</code>
          </>
        ) : detail ? <p className="m-0 max-w-[460px] text-[12.5px] leading-relaxed text-ds-muted">{detail}</p> : null}
        {failures.length > 0 ? (
          <ul className="m-0 mt-2 flex w-full max-w-[520px] list-none flex-col gap-2 p-0 text-left">
            {failures.map((failure) => (
              <li key={failure.id} className="flex gap-2.5 rounded-[10px] bg-ds-subtle px-3 py-2.5 text-[13px]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-ds-status-danger" strokeWidth={2} aria-hidden="true" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate">{failure.title}</span>
                  <span className="text-xs leading-snug text-ds-status-danger">{failureText(failure, t)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-ds-border py-3 pl-6 pr-5">
        {failures.length > 0 || outcome.kind === 'failed' ? (
          <button type="button" onClick={props.onRetry} className="h-[34px] rounded-[9px] border border-ds-border bg-ds-card px-3.5 text-[13px] text-ds-ink transition hover:bg-ds-hover">
            {t('exportDialogRetry')}
          </button>
        ) : null}
        <button type="button" onClick={props.onDone} className="h-[34px] rounded-[9px] bg-ds-ink px-4 text-[13px] font-semibold text-ds-card transition hover:opacity-90">
          {t('exportDialogDone')}
        </button>
      </footer>
    </div>
  )
}
