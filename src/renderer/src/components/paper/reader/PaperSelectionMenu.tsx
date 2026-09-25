import { useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import { Languages, MessageSquarePlus, MessagesSquare, TextQuote } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { PaperHighlightColor } from '@shared/paper/paper-marks-types'

const COLORS: PaperHighlightColor[] = ['yellow', 'green', 'blue', 'pink']

/**
 * Floating menu over a text selection (U2): highlight swatches, annotate,
 * inline translate card, quick-ask popover, and add-to-conversation.
 * Positions itself near the selection anchor and clamps inside the reader.
 */
export function PaperSelectionMenu({
  anchor,
  containerRef,
  selectionLength,
  onHighlight,
  onAnnotate,
  onTranslate,
  onAsk,
  onAddToChat,
  onClose,
  t
}: {
  anchor: { x: number; y: number }
  containerRef: RefObject<HTMLElement | null>
  /** Selected text length — translation is capped at 2000 chars (plan). */
  selectionLength: number
  onHighlight: (color: PaperHighlightColor) => void
  onAnnotate?: (comment: string) => void
  onTranslate: () => void
  onAsk?: () => void
  onAddToChat?: () => void
  onClose: () => void
  t: TFunction
}): ReactElement {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.x, top: anchor.y + 8 })
  const [annotating, setAnnotating] = useState(false)
  const [comment, setComment] = useState('')
  const [translating, setTranslating] = useState(false)

  useLayoutEffect(() => {
    const menu = menuRef.current
    const container = containerRef.current
    if (!menu || !container) return
    const bounds = container.getBoundingClientRect()
    const rect = menu.getBoundingClientRect()
    const left = Math.min(
      Math.max(8, anchor.x - bounds.left),
      Math.max(8, bounds.width - rect.width - 8)
    )
    const top = Math.min(
      Math.max(8, anchor.y - bounds.top + 8),
      Math.max(8, bounds.height - rect.height - 8)
    )
    setPos({ left, top })
  }, [anchor, containerRef, annotating])

  return (
    <div
      ref={menuRef}
      className="absolute z-20 rounded-xl border border-ds-border bg-ds-card p-1.5 shadow-xl"
      style={{ left: pos.left, top: pos.top }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {annotating ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            onAnnotate?.(comment.trim())
            onClose()
          }}
        >
          <input
            autoFocus
            className="w-[220px] rounded-md border border-ds-border-muted bg-ds-surface-subtle px-2 py-1 text-[12px] text-ds-ink outline-none"
            value={comment}
            placeholder={t('writePaperReaderCommentPlaceholder')}
            onChange={(event) => setComment(event.target.value)}
          />
          <button
            type="submit"
            className="rounded-md bg-ds-accent px-2 py-1 text-[12px] font-medium text-white"
            disabled={!comment.trim()}
          >
            {t('writePaperReaderSave')}
          </button>
        </form>
      ) : (
        <div className="flex items-center gap-1">
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              title={t(`writePaperReaderHighlight_${color}`)}
              className={`paper-swatch paper-swatch-${color} h-5 w-5 rounded-full border border-black/10`}
              onClick={() => onHighlight(color)}
            />
          ))}
          <span className="mx-0.5 h-4 w-px bg-ds-border-muted" />
          {onAnnotate ? (
            <button
              type="button"
              className="write-pdf-icon-button"
              title={t('writePaperReaderAnnotate')}
              aria-label={t('writePaperReaderAnnotate')}
              onClick={() => setAnnotating(true)}
            >
              <MessageSquarePlus className="h-4 w-4" strokeWidth={1.9} />
            </button>
          ) : null}
          <button
            type="button"
            className="write-pdf-icon-button"
            title={
              selectionLength > 2000
                ? t('writePaperReaderTranslateTooLong', { count: selectionLength })
                : t('writePaperReaderTranslate')
            }
            aria-label={t('writePaperReaderTranslate')}
            disabled={translating || selectionLength > 2000}
            onClick={() => {
              setTranslating(true)
              void Promise.resolve(onTranslate()).finally(() => setTranslating(false))
            }}
          >
            <Languages className="h-4 w-4" strokeWidth={1.9} />
          </button>
          {onAsk ? (
            <button
              type="button"
              className="write-pdf-icon-button"
              title={t('writePaperReaderAsk')}
              aria-label={t('writePaperReaderAsk')}
              onClick={onAsk}
            >
              <MessagesSquare className="h-4 w-4" strokeWidth={1.9} />
            </button>
          ) : null}
          {onAddToChat ? (
            <button
              type="button"
              className="write-pdf-icon-button"
              title={t('writePaperReaderAddToChat')}
              aria-label={t('writePaperReaderAddToChat')}
              onClick={onAddToChat}
            >
              <TextQuote className="h-4 w-4" strokeWidth={1.9} />
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}
