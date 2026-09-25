import { useState, type ReactElement } from 'react'
import { Trash2, X } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { PaperHighlight } from '@shared/paper/paper-marks-types'

/**
 * Comment gutter on the reader's right edge (U2): one dot per commented
 * highlight on the current page, positioned by the mark's vertical fraction
 * inside its page. Clicking a dot opens the quote + comment and exposes
 * delete; jumping to another page re-anchors the rail.
 */
export function PaperCommentGutter({
  marks,
  currentPage,
  onJumpToPage,
  onDelete,
  t
}: {
  marks: readonly PaperHighlight[]
  currentPage: number
  onJumpToPage: (page: number) => void
  onDelete: (id: string) => void
  t: TFunction
}): ReactElement | null {
  const [openId, setOpenId] = useState<string | null>(null)
  const commented = marks.filter((mark) => mark.comment)
  if (commented.length === 0) return null
  const onPage = commented.filter((mark) => mark.page === currentPage)
  const open = commented.find((mark) => mark.id === openId)

  return (
    <div className="pointer-events-none absolute bottom-16 right-2 top-16 z-10 w-7">
      {onPage.map((mark) => {
        const top = Math.min(0.96, Math.max(0.02, mark.rects[0]?.[1] ?? 0))
        return (
          <button
            key={mark.id}
            type="button"
            title={mark.comment}
            aria-label={t('writePaperReaderComment')}
            onClick={() => setOpenId(openId === mark.id ? null : mark.id)}
            className={`paper-swatch-${mark.color} pointer-events-auto absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full border border-white/70 shadow transition hover:scale-125 dark:border-black/40`}
            style={{ top: `${top * 100}%` }}
          />
        )
      })}
      {commented.length > onPage.length ? (
        <span
          className="pointer-events-auto absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full bg-ds-card px-1 py-px text-[9px] text-ds-faint shadow"
          title={t('writePaperReaderCommentOthers', { count: commented.length - onPage.length })}
        >
          +{commented.length - onPage.length}
        </span>
      ) : null}
      {open ? (
        <div className="pointer-events-auto absolute right-8 top-0 w-[240px] rounded-lg border border-ds-border bg-ds-card p-2 shadow-xl">
          <div className="mb-1 flex items-start justify-between gap-2">
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                onJumpToPage(open.page)
                setOpenId(null)
              }}
            >
              <span className="text-[10.5px] text-ds-faint">
                {t('writePdfPageLabel', { page: open.page })}
              </span>
              <p className="line-clamp-3 text-[11px] leading-4 text-ds-muted">{open.quote}</p>
            </button>
            <button
              type="button"
              className="write-pdf-icon-button shrink-0"
              aria-label={t('close')}
              onClick={() => setOpenId(null)}
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
          <p className="text-[12px] leading-4 text-ds-ink">{open.comment}</p>
          <button
            type="button"
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-red-500"
            onClick={() => {
              onDelete(open.id)
              setOpenId(null)
            }}
          >
            <Trash2 className="h-3 w-3" strokeWidth={1.9} />
            {t('writePaperReaderDelete')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
