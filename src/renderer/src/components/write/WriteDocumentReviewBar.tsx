/**
 * Top bar shown while the rich diff review is active (implementation §6.4):
 * progress + prev/next navigation + bulk accept/reject. Replaces the
 * CodeMirror panel used by the source editor.
 */
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'

export type WriteDocumentReviewBarProps = {
  /** Total pending chunks. */
  total: number
  /** Currently highlighted chunk index (0-based). */
  index: number
  onPrev: () => void
  onNext: () => void
  onAcceptAll: () => void
  onRejectAll: () => void
}

export function WriteDocumentReviewBar({
  total,
  index,
  onPrev,
  onNext,
  onAcceptAll,
  onRejectAll
}: WriteDocumentReviewBarProps): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-ds-border bg-ds-card/95 px-4 py-2 text-[12.5px]">
      <span className="font-medium text-ds-ink">{t('writeDiffReviewing')}</span>
      <span className="text-ds-muted">
        {t('writeDiffProgress', { current: Math.min(index + 1, total), total })}
      </span>
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-ds-border text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40"
        onClick={onPrev}
        disabled={total === 0}
        aria-label={t('writeDiffPrev')}
        title={t('writeDiffPrev')}
      >
        <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-ds-border text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40"
        onClick={onNext}
        disabled={total === 0}
        aria-label={t('writeDiffNext')}
        title={t('writeDiffNext')}
      >
        <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-red-300/70 px-2.5 py-1 text-red-600 transition hover:bg-red-50 dark:border-red-800/60 dark:text-red-400 dark:hover:bg-red-950/40"
          onClick={onRejectAll}
        >
          {t('writeDiffRejectAll')}
        </button>
        <button
          type="button"
          className="rounded-md border border-emerald-300/70 px-2.5 py-1 text-emerald-600 transition hover:bg-emerald-50 dark:border-emerald-800/60 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
          onClick={onAcceptAll}
        >
          {t('writeDiffAcceptAll')}
        </button>
      </div>
    </div>
  )
}
