import { useState, type ReactElement } from 'react'
import { X } from 'lucide-react'
import type { PaperHighlight } from '@shared/paper/paper-marks-types'

/**
 * Absolute overlay that renders a page's highlights as %-positioned rects.
 * Marks store normalized [x, y, w, h] so zoom never shifts their position.
 * Click a mark to see its quote/comment and delete it.
 */
export function PaperPageMarksLayer({
  marks,
  onDelete
}: {
  marks: readonly PaperHighlight[]
  onDelete: (id: string) => void
}): ReactElement {
  const [openId, setOpenId] = useState<string | null>(null)
  const open = marks.find((mark) => mark.id === openId)
  return (
    <div className="pointer-events-none absolute inset-0 z-[2]">
      {marks.map((mark) =>
        mark.rects.map((rect, index) => (
          <button
            key={`${mark.id}-${index}`}
            type="button"
            aria-label="highlight"
            className={`paper-mark-rect paper-mark-${mark.color} pointer-events-auto absolute cursor-pointer`}
            style={{
              left: `${rect[0] * 100}%`,
              top: `${rect[1] * 100}%`,
              width: `${rect[2] * 100}%`,
              height: `${rect[3] * 100}%`
            }}
            onClick={() => setOpenId(openId === mark.id ? null : mark.id)}
          />
        ))
      )}
      {open ? (
        <div className="pointer-events-auto absolute left-2 top-2 z-10 w-[240px] rounded-lg border border-ds-border bg-ds-card p-2 shadow-lg">
          <div className="mb-1 flex items-start justify-between gap-2">
            <p className="line-clamp-3 text-[11px] leading-4 text-ds-muted">{open.quote}</p>
            <button
              type="button"
              className="write-pdf-icon-button shrink-0"
              aria-label="delete"
              onClick={() => {
                onDelete(open.id)
                setOpenId(null)
              }}
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
          {open.comment ? (
            <p className="text-[12px] leading-4 text-ds-ink">{open.comment}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
