import { useState, type ReactElement } from 'react'
import { X } from 'lucide-react'
import type { PaperHighlight, PaperVisualMark } from '@shared/paper/paper-marks-types'
import { setPaperEditingMark, usePaperMarksStore } from '../../../paper/paper-marks-store'

/**
 * Absolute overlay that renders a page's highlights as %-positioned rects.
 * Marks store normalized [x, y, w, h] so zoom never shifts their position.
 * Click a mark to see its quote/comment and delete it. Hover is forwarded so
 * the comment gutter can draw its connector line (R1.4).
 */
export function PaperPageMarksLayer({
  marks,
  visualMarks = [],
  onDelete
}: {
  marks: readonly PaperHighlight[]
  visualMarks?: readonly PaperVisualMark[]
  onDelete: (id: string) => void
}): ReactElement {
  const [openId, setOpenId] = useState<string | null>(null)
  const hoveredMarkId = usePaperMarksStore((s) => s.hoveredMarkId)
  const open = marks.find((mark) => mark.id === openId)
  return (
    <div className="pointer-events-none absolute inset-0 z-[2]">
      {/* R2.4 region marks: dashed outline; clicking opens the gutter card. */}
      {visualMarks.map((mark) => (
        <button
          key={mark.id}
          type="button"
          aria-label={mark.comment ?? 'region mark'}
          title={mark.comment}
          className={`pointer-events-auto absolute rounded-[2px] border border-dashed border-[#3b82f6]/80 bg-[#3b82f6]/8 transition hover:bg-[#3b82f6]/15 ${
            hoveredMarkId === mark.id ? 'paper-mark-rect-active' : ''
          }`}
          style={{
            left: `${mark.rect[0] * 100}%`,
            top: `${mark.rect[1] * 100}%`,
            width: `${mark.rect[2] * 100}%`,
            height: `${mark.rect[3] * 100}%`
          }}
          onClick={() => setPaperEditingMark(mark.id)}
          onMouseEnter={() => usePaperMarksStore.setState({ hoveredMarkId: mark.id })}
          onMouseLeave={() => usePaperMarksStore.setState({ hoveredMarkId: null })}
        />
      ))}
      {marks.map((mark) =>
        mark.rects.map((rect, index) => (
          <button
            key={`${mark.id}-${index}`}
            type="button"
            aria-label="highlight"
            className={`paper-mark-rect paper-mark-${mark.color} pointer-events-auto absolute cursor-pointer ${
              hoveredMarkId === mark.id ? 'paper-mark-rect-active' : ''
            }`}
            style={{
              left: `${rect[0] * 100}%`,
              top: `${rect[1] * 100}%`,
              width: `${rect[2] * 100}%`,
              height: `${rect[3] * 100}%`
            }}
            onClick={() => setOpenId(openId === mark.id ? null : mark.id)}
            onMouseEnter={() => usePaperMarksStore.setState({ hoveredMarkId: mark.id })}
            onMouseLeave={() => usePaperMarksStore.setState({ hoveredMarkId: null })}
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
