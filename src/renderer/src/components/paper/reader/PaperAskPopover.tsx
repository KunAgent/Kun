import { useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import { CornerDownRight, MessagesSquare, X } from 'lucide-react'
import type { TFunction } from 'i18next'

/**
 * Quick-ask popover beside the selection (U2): a compact question box that
 * sends the quoted passage + question to the paper-scoped assistant thread
 * and registers an `ask` mark card for persistence.
 */
export function PaperAskPopover({
  anchor,
  containerRef,
  onSubmit,
  onClose,
  t
}: {
  anchor: { x: number; y: number }
  containerRef: RefObject<HTMLElement | null>
  onSubmit: (question: string) => void
  onClose: () => void
  t: TFunction
}): ReactElement {
  const popRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y })
  const [question, setQuestion] = useState('')

  useLayoutEffect(() => {
    const pop = popRef.current
    const container = containerRef.current
    if (!pop || !container) return
    const bounds = container.getBoundingClientRect()
    const rect = pop.getBoundingClientRect()
    const left = Math.min(
      Math.max(8, anchor.x - bounds.left),
      Math.max(8, bounds.width - rect.width - 8)
    )
    const top = Math.min(
      Math.max(8, anchor.y - bounds.top + 8),
      Math.max(8, bounds.height - rect.height - 8)
    )
    setPos({ left, top })
  }, [anchor, containerRef])

  const submit = (): void => {
    const value = question.trim()
    if (!value) return
    onSubmit(value)
    onClose()
  }

  return (
    <div
      ref={popRef}
      className="absolute z-30 w-[300px] rounded-xl border border-ds-border bg-ds-card shadow-xl"
      style={{ left: pos.left, top: pos.top }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 border-b border-ds-border-muted px-3 py-1.5">
        <MessagesSquare className="h-3.5 w-3.5 shrink-0 text-ds-accent" strokeWidth={1.9} />
        <span className="flex-1 text-[11px] font-medium text-ds-muted">
          {t('writePaperReaderAsk')}
        </span>
        <button
          type="button"
          className="write-pdf-icon-button"
          aria-label={t('close')}
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.9} />
        </button>
      </div>
      <form
        className="flex items-center gap-1.5 p-2"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <input
          autoFocus
          className="min-w-0 flex-1 rounded-md border border-ds-border-muted bg-ds-surface-subtle px-2 py-1 text-[12px] text-ds-ink outline-none focus:border-ds-accent/50"
          value={question}
          placeholder={t('writePaperReaderAskPlaceholder')}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button
          type="submit"
          disabled={!question.trim()}
          className="inline-flex items-center gap-1 rounded-md bg-ds-accent px-2 py-1 text-[12px] font-medium text-white disabled:opacity-50"
        >
          <CornerDownRight className="h-3.5 w-3.5" strokeWidth={2} />
          {t('send')}
        </button>
      </form>
    </div>
  )
}
