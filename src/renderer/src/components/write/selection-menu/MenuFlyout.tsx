import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { writeFocusModeFloatingLayerClassName } from '../../../write/write-focus-mode'

export function MenuFlyout({ anchor, onClose, children, focusMode = false }: {
  anchor: RefObject<HTMLElement | null>; onClose: () => void; children: ReactNode; focusMode?: boolean
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 220 })
  useLayoutEffect(() => {
    const update = (): void => {
      const rect = anchor.current?.getBoundingClientRect()
      if (!rect) return
      const scale = Number.parseFloat(getComputedStyle(document.body).zoom) || 1
      const vw = innerWidth / scale, vh = innerHeight / scale
      const width = Math.min(220, vw - 32), height = ref.current?.scrollHeight ?? 280
      const right = rect.right / scale + 12
      setPosition({ width, left: Math.max(16, right + width <= vw - 16 ? right : rect.left / scale - width - 12),
        top: Math.max(16, Math.min(rect.top / scale - 6, vh - height - 16)) })
    }
    update()
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    const outside = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true) }
  }, [anchor, onClose])
  return createPortal(<div ref={ref} className={`write-selection-menu-flyout ${writeFocusModeFloatingLayerClassName(focusMode, 'z-50')}`}
    data-selection-ignore="true" role="menu" style={position}
    onKeyDown={(event) => {
      if (event.key === 'Escape' || event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); onClose(); anchor.current?.querySelector('button')?.focus() }
      else navigateMenu(event)
    }}>{children}</div>, document.body)
}

export function navigateMenu(event: React.KeyboardEvent<HTMLElement>): void {
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
  if (!direction && event.key !== 'Home' && event.key !== 'End') return
  event.preventDefault(); event.stopPropagation()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + direction + buttons.length) % buttons.length
  buttons[next]?.focus()
}
