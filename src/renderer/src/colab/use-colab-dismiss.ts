import { useEffect, type RefObject } from 'react'

/** Closes a popover or dialog on outside pointer-down (when a ref is given) and on Escape. */
export function useColabDismiss(
  open: boolean,
  onClose: () => void,
  ref?: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!ref) return
      if (event.target instanceof Node && ref.current?.contains(event.target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose, ref])
}
