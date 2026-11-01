import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './kun-context-menu.css'

export type KunContextMenuEntry =
  | {
    id: string
    label: string
    icon?: ReactNode
    count?: number
    disabled?: boolean
    danger?: boolean
    title?: string
    onSelect: () => void
  }
  | 'separator'

/** A pointer position in the body's own layout pixels. */
export type KunContextMenuPoint = { x: number; y: number }

const EDGE = 8

function bodyZoom(): number {
  if (typeof document === 'undefined') return 1
  const zoom = Number.parseFloat(getComputedStyle(document.body).zoom)
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1
}

/**
 * The body is zoomed by the UI scale: `clientX` is in viewport pixels while a
 * fixed child of the body is laid out in its own, so divide the pointer once.
 */
export function contextMenuPoint(event: { clientX: number; clientY: number }): KunContextMenuPoint {
  const zoom = bodyZoom()
  return { x: event.clientX / zoom, y: event.clientY / zoom }
}

/** Below and to the right of an element, for keyboard-opened menus. */
export function contextMenuPointBelow(element: Element): KunContextMenuPoint {
  const box = element.getBoundingClientRect()
  return contextMenuPoint({ clientX: box.left, clientY: box.bottom })
}

/**
 * The app's right-click menu: portaled to the body, kept inside the window,
 * closed by Escape, an outside press, a blur or a resize.
 */
export function KunContextMenu({ point, label, entries, onDismiss, width = 232 }: {
  point: KunContextMenuPoint
  label: string
  entries: KunContextMenuEntry[]
  onDismiss: () => void
  width?: number
}): ReactElement | null {
  const ref = useRef<HTMLDivElement | null>(null)
  const [placed, setPlaced] = useState(point)
  useLayoutEffect(() => {
    const zoom = bodyZoom()
    const height = ref.current?.offsetHeight ?? 0
    const maxX = window.innerWidth / zoom - width - EDGE
    const maxY = window.innerHeight / zoom - height - EDGE
    setPlaced({ x: Math.max(EDGE, Math.min(point.x, maxX)), y: Math.max(EDGE, Math.min(point.y, maxY)) })
  }, [point, width])
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
    const dismiss = (): void => onDismiss()
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss()
    }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
    }
  }, [onDismiss])

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    if (!items.length) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length
    items[next]?.focus()
  }

  if (typeof document === 'undefined') return null
  // Separators never lead, trail or double up when an entry list is assembled conditionally.
  const visible = entries.filter((entry, index, list) => entry !== 'separator'
    || (index > 0 && index < list.length - 1 && list[index - 1] !== 'separator'))
  return createPortal(
    <div ref={ref} className="kun-context-menu ds-no-drag" role="menu" aria-label={label}
      style={{ left: placed.x, top: placed.y, width }}
      onPointerDown={(event) => event.stopPropagation()} onKeyDown={moveFocus}
      onContextMenu={(event) => event.preventDefault()}>
      {visible.map((entry, index) => entry === 'separator' ? (
        <div key={`separator-${index}`} className="kun-context-menu-separator" role="separator" />
      ) : (
        <button key={entry.id} type="button" role="menuitem" className="kun-context-menu-item" data-action={entry.id}
          data-tone={entry.danger ? 'danger' : undefined} disabled={entry.disabled} title={entry.title}
          onClick={() => {
            onDismiss()
            entry.onSelect()
          }}>
          {entry.icon ?? <span className="kun-context-menu-spacer" aria-hidden="true" />}
          <span className="kun-context-menu-label">{entry.label}</span>
          {entry.count ? <span className="kun-context-menu-count">{entry.count}</span> : null}
        </button>
      ))}
    </div>,
    document.body
  )
}
