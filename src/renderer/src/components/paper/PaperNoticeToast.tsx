import { useEffect, type ReactElement } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePaperStore } from '../../write/paper/paper-store'

const PAPER_NOTICE_MS = 6000

/**
 * Single renderer for `usePaperStore.notice` on both Work surfaces. Paper
 * actions run from the library, discover view, onboarding, the sidebar toggle
 * and the docs-surface "add to paper library" action, so the notice cannot
 * live inside the reader-only paper bar.
 */
export function PaperNoticeToast(): ReactElement | null {
  const { t } = useTranslation('common')
  const notice = usePaperStore((s) => s.notice)

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => {
      if (usePaperStore.getState().notice === notice) usePaperStore.getState().setNotice(null)
    }, PAPER_NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

  if (!notice) return null
  const toneClass = notice.tone === 'error'
    ? 'border-red-200/70 bg-red-50/95 text-red-700 dark:border-red-900/60 dark:bg-red-950/90 dark:text-red-200'
    : notice.tone === 'success'
      ? 'border-emerald-200/80 bg-emerald-50/95 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/90 dark:text-emerald-200'
      : 'border-ds-border-muted bg-ds-card text-ds-ink'
  return (
    <div
      role={notice.tone === 'error' ? 'alert' : 'status'}
      className={`ds-no-drag fixed left-1/2 top-3 z-50 flex max-w-[min(560px,calc(100vw-32px))] -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-2 text-[13px] shadow-[0_14px_32px_rgba(20,47,95,0.12)] ${toneClass}`}
    >
      <span className="min-w-0 flex-1 truncate" title={notice.message}>{notice.message}</span>
      <button
        type="button"
        aria-label={t('close')}
        onClick={() => usePaperStore.getState().setNotice(null)}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full opacity-70 transition hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  )
}
