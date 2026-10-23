import { useEffect, useRef, type ReactElement, type ReactNode, type RefObject } from 'react'
import { useCanvasViewportStore } from '../../../../design/canvas/canvas-viewport-store'

/** Floating chrome shared by the canvas toolbar, view controls and board focus header. */
export const CANVAS_CHROME_PILL =
  'flex items-center gap-0.5 rounded-[12px] border border-ds-border bg-ds-elevated p-1 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_10px_28px_rgba(15,23,42,0.08)] dark:shadow-[0_10px_28px_rgba(0,0,0,0.38)]'
export const CANVAS_CHROME_ICON_BUTTON =
  'inline-flex shrink-0 items-center justify-center rounded-[8px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/40 disabled:cursor-not-allowed disabled:opacity-40'
export const CANVAS_CHROME_ACTIVE = 'bg-accent-tint/15 text-accent'
export const CANVAS_CHROME_INACTIVE = 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
export const CANVAS_CHROME_DIVIDER = 'mx-1 h-5 w-px shrink-0 bg-ds-border'
export const CANVAS_CHROME_MENU =
  'absolute z-50 overflow-hidden rounded-[12px] border border-ds-border bg-ds-elevated p-1 text-[12.5px] text-ds-ink shadow-[0_16px_40px_rgba(15,23,42,0.16)] dark:shadow-[0_16px_40px_rgba(0,0,0,0.45)]'
export const CANVAS_CHROME_MENU_ITEM =
  'flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-45'
export const CANVAS_CHROME_MENU_SECTION =
  'px-2 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-[0.08em] text-ds-faint first:pt-1'
export const CANVAS_CHROME_MENU_SEPARATOR = 'my-1 h-px bg-ds-border-muted'
export const CANVAS_CHROME_KBD = 'ml-auto shrink-0 pl-3 text-[11px] tabular-nums text-ds-faint'

/** Panels narrower than this get the compact chrome (smaller buttons, icon-only title). */
export const CANVAS_CHROME_COMPACT_WIDTH = 820

/** Whether the canvas host is narrow enough to need the compact chrome. */
export function useCanvasChromeCompact(): boolean {
  return useCanvasViewportStore((s) => s.containerWidth < CANVAS_CHROME_COMPACT_WIDTH)
}

export function canvasChromeButtonClass(active: boolean, compact = false): string {
  const size = compact ? 'h-7 w-7' : 'h-8 w-8'
  return `${CANVAS_CHROME_ICON_BUTTON} ${size} ${active ? CANVAS_CHROME_ACTIVE : CANVAS_CHROME_INACTIVE}`
}

/** Closes a floating menu on outside pointer-down or Escape. */
export function useCanvasChromeDismiss(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  onClose: () => void
): void {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      closeRef.current()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeRef.current()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, rootRef])
}

export function CanvasChromeMenuItem({
  icon,
  label,
  shortcut,
  checked,
  disabled,
  role = 'menuitem',
  onSelect
}: {
  icon?: ReactNode
  label: string
  shortcut?: string
  checked?: boolean
  disabled?: boolean
  role?: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox'
  onSelect: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === 'menuitem' ? undefined : Boolean(checked)}
      disabled={disabled}
      className={`${CANVAS_CHROME_MENU_ITEM} ${checked && role === 'menuitemradio' ? 'bg-ds-hover' : ''}`}
      onClick={onSelect}
    >
      {icon ? <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ds-muted">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {role === 'menuitemcheckbox' ? (
        <span
          aria-hidden="true"
          className={`ml-auto h-3.5 w-6 shrink-0 rounded-full p-0.5 transition ${checked ? 'bg-accent' : 'bg-ds-border'}`}
        >
          <span className={`block h-2.5 w-2.5 rounded-full bg-white shadow transition ${checked ? 'translate-x-2.5' : ''}`} />
        </span>
      ) : shortcut ? (
        <kbd className={CANVAS_CHROME_KBD}>{shortcut}</kbd>
      ) : null}
    </button>
  )
}
