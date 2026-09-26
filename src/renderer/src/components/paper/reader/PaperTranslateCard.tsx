import { useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import { Check, Copy, Languages, Loader2, Settings2, X } from 'lucide-react'
import type { TFunction } from 'i18next'

/**
 * Floating translation card pinned beside the selection (U2): shows the
 * source quote and the translated text as soon as the request resolves.
 * Position clamps inside the reader root like the selection menu.
 */
export function PaperTranslateCard({
  anchor,
  containerRef,
  quote,
  translation,
  model,
  loading,
  error,
  onConfigure,
  onClose,
  onHoverChange,
  t
}: {
  anchor: { x: number; y: number }
  containerRef: RefObject<HTMLElement | null>
  quote: string
  translation: string
  model?: string
  loading: boolean
  error: string | null
  /** Shown in the error state when the failure is fixable via settings. */
  onConfigure?: () => void
  onClose: () => void
  /** R1.3: pauses the 700ms auto-collapse while the pointer is over the card. */
  onHoverChange?: (hovered: boolean) => void
  t: TFunction
}): ReactElement {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y })
  const [copied, setCopied] = useState(false)

  useLayoutEffect(() => {
    const card = cardRef.current
    const container = containerRef.current
    if (!card || !container) return
    const bounds = container.getBoundingClientRect()
    const rect = card.getBoundingClientRect()
    const left = Math.min(
      Math.max(8, anchor.x - bounds.left + 12),
      Math.max(8, bounds.width - rect.width - 8)
    )
    const top = Math.min(
      Math.max(8, anchor.y - bounds.top - rect.height / 2),
      Math.max(8, bounds.height - rect.height - 8)
    )
    setPos({ left, top })
  }, [anchor, containerRef, loading, translation])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(translation)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard denied — leave the icon as-is.
    }
  }

  return (
    <div
      ref={cardRef}
      className="absolute z-30 w-[300px] rounded-xl border border-ds-border bg-ds-card shadow-xl"
      style={{ left: pos.left, top: pos.top }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
    >
      <div className="flex items-center gap-1.5 border-b border-ds-border-muted px-3 py-1.5">
        <Languages className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.9} />
        <span className="flex-1 text-[11px] font-medium text-ds-muted">
          {t('writePaperReaderTranslate')}
        </span>
        {translation ? (
          <button
            type="button"
            className="write-pdf-icon-button"
            title={t('writePaperCopy')}
            aria-label={t('writePaperCopy')}
            onClick={() => void copy()}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={2} />
            ) : (
              <Copy className="h-3.5 w-3.5" strokeWidth={1.9} />
            )}
          </button>
        ) : null}
        <button
          type="button"
          className="write-pdf-icon-button"
          aria-label={t('close')}
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.9} />
        </button>
      </div>
      <p className="line-clamp-3 px-3 pt-2 text-[11px] leading-4 text-ds-faint">{quote}</p>
      <div className="max-h-[220px] overflow-y-auto px-3 pb-2.5 pt-1">
        {loading ? (
          <span className="flex items-center gap-1.5 py-2 text-[12px] text-ds-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
            {t('writePaperReaderTranslating')}
          </span>
        ) : error ? (
          <div className="py-1">
            <p className="text-[12px] text-red-500">{error}</p>
            {onConfigure ? (
              <button
                type="button"
                className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-ds-border bg-ds-card px-2.5 py-1 text-[11.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                onClick={onConfigure}
              >
                <Settings2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                {t('writePaperTranslateConfigure')}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-[12.5px] leading-5 text-ds-ink">{translation}</p>
        )}
        {model ? <p className="pt-1 text-[10.5px] text-ds-faint">{model}</p> : null}
      </div>
    </div>
  )
}
