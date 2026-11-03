import { useEffect, useRef, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GitChangeEntry } from '@shared/git-commit'
import { discardSummary, splitRepositoryPath, statusLetter } from './change-source'

/**
 * Confirmation before a discard. Tracked files go back to their staged or
 * committed content and cannot be recovered; untracked files go to the Trash.
 */
export function GitDiscardDialog({
  entries,
  busy,
  onCancel,
  onConfirm
}: {
  entries: GitChangeEntry[]
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const cancelRef = useRef<HTMLButtonElement>(null)
  const { tracked, untracked } = discardSummary(entries)
  const total = tracked.length + untracked.length
  const single = total === 1 ? (tracked[0] ?? untracked[0]) : null

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  if (typeof document === 'undefined') return null
  const title = single
    ? t('changesDiscardTitleOne', { name: splitRepositoryPath(single.path).name })
    : t('changesDiscardTitleMany')
  const confirmLabel = single?.status === 'untracked'
    ? t('changesMoveToTrash')
    : t('changesDiscardConfirm', { count: total })

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/35 p-4" role="presentation">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="git-discard-title"
        aria-describedby="git-discard-body"
        className="flex w-[420px] max-w-full flex-col gap-3 rounded-[16px] border border-ds-border bg-ds-card p-[18px] shadow-[var(--ds-shadow-overlay)]"
      >
        <div className="flex items-start gap-2.5">
          <span className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-ds-danger-soft text-ds-danger">
            <RotateCcw className="h-[15px] w-[15px]" strokeWidth={1.9} />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="git-discard-title" className="m-0 break-words text-[14px] font-semibold text-ds-ink">{title}</h2>
            <p id="git-discard-body" className="m-0 text-[12px] leading-[18px] text-ds-muted">
              {[
                tracked.length ? t('changesDiscardTracked', { count: tracked.length }) : '',
                untracked.length ? t('changesDiscardUntracked', { count: untracked.length }) : '',
                t('changesDiscardStagedKept')
              ].filter(Boolean).join(' ')}
            </p>
          </div>
        </div>
        <ul className="m-0 max-h-[220px] list-none overflow-y-auto rounded-[10px] border border-ds-border-muted p-0 py-1">
          {[...tracked, ...untracked].map((entry) => (
            <li key={entry.path} className="flex h-[26px] items-center gap-2 px-2.5">
              <span className="w-3 shrink-0 text-center font-mono text-[11px] font-bold text-ds-muted">{statusLetter(entry.status)}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ds-ink" title={entry.path}>{entry.path}</span>
              {entry.status === 'untracked' ? (
                <span className="shrink-0 text-[11px] text-ds-muted">{t('changesDiscardToTrash')}</span>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-8 rounded-[9px] border border-ds-border bg-ds-card px-3.5 text-[12px] font-semibold text-ds-ink hover:bg-ds-hover disabled:opacity-50"
          >
            {t('changesCancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || total === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-red-700 px-3.5 text-[12px] font-semibold text-white hover:bg-red-600 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
