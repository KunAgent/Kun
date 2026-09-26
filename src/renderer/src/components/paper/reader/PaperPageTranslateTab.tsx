import type { ReactElement } from 'react'
import { Loader2 } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { PageTranslateStatus } from './use-paper-page-translate'

/**
 * R2.2 vertical 「译」 tab pinned to each page's right edge, outside the page
 * surface. Fixed px size (does not scale with zoom). States:
 *  idle        → hover-revealed; click translates this page
 *  translating → spinner
 *  done        → accent tint; click hides this page's overlay
 *  hidden      → outlined; click shows the overlay again
 *  error       → click retries
 */
export function PaperPageTranslateTab({
  status,
  onClick,
  t
}: {
  status: PageTranslateStatus
  onClick: () => void
  t: TFunction
}): ReactElement {
  const translating = status === 'translating'
  const label =
    status === 'done'
      ? t('writePaperReaderTranslateHide')
      : status === 'hidden'
        ? t('writePaperReaderTranslateShow')
        : status === 'error'
          ? t('writePaperReaderRetry')
          : t('writePaperReaderTranslatePage')
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={status === 'done'}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      className={`ds-no-drag absolute -right-1 top-2 z-[5] flex h-12 w-4 items-center justify-center rounded-r-md border-y border-r border-ds-border text-ds-faint shadow-sm transition ${
        translating
          ? 'bg-ds-card text-accent'
          : status === 'done'
            ? 'bg-accent-tint/15 text-accent'
            : status === 'hidden'
              ? 'bg-ds-card text-ds-faint'
              : 'bg-ds-elevated opacity-0 hover:text-accent group-hover/page:opacity-100'
      }`}
    >
      {translating ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={2} />
      ) : (
        <span className="text-[10px] font-medium leading-none" style={{ writingMode: 'vertical-rl' }}>
          {t('writePaperReaderTranslatePageMark')}
        </span>
      )}
    </button>
  )
}
