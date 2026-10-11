import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { bodyZoom } from '../../../lib/body-zoom'
import { askAssistantForPaperPurpose } from '../../../paper/paper-assistant-ask'
import { PAPER_READING_PURPOSES } from '../../../paper/paper-reading-request'

const MENU_WIDTH = 208

/**
 * "Read for…" in the reader toolbar: each purpose is one click that asks the
 * Work assistant (the open paper is the turn's context). No form, no dialog.
 */
export function PaperReadingPurposeMenu({ title }: { title: string }): ReactElement {
  const { t } = useTranslation('common')
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!anchor) return
    const close = (): void => setAnchor(null)
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && (triggerRef.current?.contains(target) || menuRef.current?.contains(target))) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      close()
      triggerRef.current?.focus()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', close)
    }
  }, [anchor])

  const toggle = (): void => {
    if (anchor) {
      setAnchor(null)
      return
    }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    // Measured rects include the shell's body zoom; fixed offsets do not.
    const zoom = bodyZoom()
    const viewportWidth = window.innerWidth / zoom
    setAnchor({
      left: Math.max(8, Math.min(rect.left / zoom, viewportWidth - MENU_WIDTH - 8)),
      top: rect.bottom / zoom + 4
    })
  }

  return (
    <>
      <button ref={triggerRef} type="button" aria-haspopup="menu" aria-expanded={Boolean(anchor)}
        data-paper-reading-purpose-trigger onClick={toggle}
        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-accent hover:bg-ds-hover">
        {t('paperReadingTitle')}
        <ChevronDown className={`h-3 w-3 transition-transform ${anchor ? 'rotate-180' : ''}`} strokeWidth={2} aria-hidden />
      </button>
      {anchor && typeof document !== 'undefined' ? createPortal(
        <div ref={menuRef} role="menu" aria-label={t('paperReadingTitle')} data-paper-reading-purpose-menu
          style={{ left: anchor.left, top: anchor.top, width: MENU_WIDTH }}
          className="fixed z-50 rounded-xl border border-ds-border-muted bg-white p-1 text-[12.5px] text-ds-ink shadow-[0_18px_52px_rgba(15,23,42,0.18)] dark:bg-ds-card">
          {PAPER_READING_PURPOSES.map((purpose) => (
            <button key={purpose} type="button" role="menuitem" data-paper-reading-purpose={purpose}
              onClick={() => {
                setAnchor(null)
                askAssistantForPaperPurpose({ t, purpose, title })
              }}
              className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30">
              {t(`paperReading_${purpose}`)}
            </button>
          ))}
        </div>,
        document.body
      ) : null}
    </>
  )
}
