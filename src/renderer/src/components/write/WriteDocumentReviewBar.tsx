/**
 * Top bar shown while the rich diff review is active: a Kun mark with the
 * change count, a pill n/N stepper, and the two bulk decisions (reject all
 * stays quiet, accept all is the strong ink pill). Replaces the CodeMirror
 * panel used by the source editor.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
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
    <div className="write-review-bar" role="toolbar" aria-label={t('writeDiffReviewing')}>
      <span className="write-review-bar-mark" aria-hidden="true">K</span>
      <span className="min-w-0 truncate text-[13px] font-semibold text-ds-ink">
        {t('writeDiffKunChanges', { count: total })}
      </span>
      <span className="flex-1" />
      <div className="write-review-stepper">
        <button
          type="button"
          onClick={onPrev}
          disabled={total === 0 || index <= 0}
          aria-label={t('writeDiffPrev')}
          title={t('writeDiffPrev')}
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <span className="px-1.5 text-[12.5px] tabular-nums text-ds-ink">
          {t('writeDiffProgress', { current: Math.min(index + 1, total), total })}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={total === 0 || index >= total - 1}
          aria-label={t('writeDiffNext')}
          title={t('writeDiffNext')}
        >
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      <button type="button" className="write-review-bar-button" onClick={onRejectAll}>
        {t('writeDiffRejectAll')}
      </button>
      <button type="button" className="write-review-bar-button is-primary" onClick={onAcceptAll}>
        {t('writeDiffAcceptAll')}
      </button>
    </div>
  )
}
