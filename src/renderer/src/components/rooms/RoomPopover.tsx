import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { bodyZoom } from '../../lib/body-zoom'
import './rooms-popover.css'

type Placement = { left: number; top: number; width: number; maxHeight: number }
export function roomPopoverPlacement(input: {
  anchor: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>
  viewportWidth: number; viewportHeight: number; width: number; height: number
  side: 'top' | 'bottom'; align: 'start' | 'end'; zoom?: number
}): Placement {
  const zoom = input.zoom && input.zoom > 0 ? input.zoom : 1
  const viewportWidth = input.viewportWidth / zoom, viewportHeight = input.viewportHeight / zoom
  const anchor = { top: input.anchor.top / zoom, bottom: input.anchor.bottom / zoom,
    left: input.anchor.left / zoom, right: input.anchor.right / zoom }
  const width = Math.max(1, Math.min(input.width, viewportWidth - 24))
  const above = Math.max(1, anchor.top - 20), below = Math.max(1, viewportHeight - anchor.bottom - 20)
  const desiredHeight = Math.min(input.height || 260, 360)
  const openAbove = input.side === 'top' ? above >= desiredHeight || above >= below : below < desiredHeight && above > below
  const maxHeight = Math.min(360, openAbove ? above : below)
  const top = openAbove ? anchor.top - 8 - Math.min(desiredHeight, maxHeight) : anchor.bottom + 8
  return { left: Math.max(12, Math.min(input.align === 'end' ? anchor.right - width : anchor.left, viewportWidth - width - 12)),
    top: Math.max(12, Math.min(top, viewportHeight - Math.min(desiredHeight, maxHeight) - 12)), width, maxHeight }
}

export function RoomPopover({ label, trigger, children, side = 'bottom', align = 'start',
  className = '', disabled = false, width = 280 }: {
  label: string; trigger: ReactNode; children: (close: () => void) => ReactNode
  side?: 'top' | 'bottom'; align?: 'start' | 'end'; className?: string; disabled?: boolean; width?: number
}) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const anchor = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  const focused = useRef(false)
  const id = useId()
  const close = useCallback(() => { setOpen(false); anchor.current?.focus() }, [])
  const measure = useCallback(() => {
    if (!anchor.current || !panel.current) return
    setPlacement(roomPopoverPlacement({ anchor: anchor.current.getBoundingClientRect(),
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      width, height: panel.current.scrollHeight, side, align, zoom: bodyZoom() }))
  }, [width, side, align])
  useLayoutEffect(() => { if (open) measure() }, [open, measure])
  useEffect(() => {
    if (!open) { focused.current = false; return }
    if (!placement || focused.current || !panel.current) return
    focused.current = true
    panel.current.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')?.focus()
  }, [open, placement])
  useEffect(() => {
    if (!open || typeof document === 'undefined' || !document.addEventListener) return
    const outside = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false)
    }
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (panel.current) resize?.observe(panel.current)
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      resize?.disconnect()
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, measure])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  const content = open ? (
    <div ref={panel} id={id} role="dialog" aria-label={label} className="rooms-popover-surface"
      style={placement ? { ...placement, visibility: 'visible' } : { width, visibility: 'hidden' }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); close() }
        if (event.key === 'Tab' && panel.current) {
          const controls = Array.from(panel.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]'))
          const first = controls[0], last = controls.at(-1)
          if (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
            event.preventDefault(); close()
          }
        }
      }}>{children(close)}</div>
  ) : null
  return <>
    <button ref={anchor} type="button" aria-label={label} title={label} aria-expanded={open}
      aria-haspopup="dialog" aria-controls={open ? id : undefined} disabled={disabled}
      className={className} onClick={() => { setPlacement(null); setOpen((value) => !value) }}
      onKeyDown={(event) => { if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>{trigger}</button>
    {content && typeof document !== 'undefined' && document.body?.nodeType === 1
      ? createPortal(content, anchor.current?.closest('.rooms-popover-surface, dialog') ?? document.body) : content}
  </>
}
