import { useEffect, useRef, type RefObject } from 'react'

export function useSchedulePanelFocus(
  panel: RefObject<HTMLElement | null>, onClose: () => void, modal: boolean
): void {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = panel.current
    element?.focus()
    const keydown = (event: KeyboardEvent): void => {
      if (!element?.contains(document.activeElement)) return
      if (event.key === 'Escape') { event.preventDefault(); close.current(); return }
      if (!modal || event.key !== 'Tab') return
      const targets = [...element.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]'
      )]
      const first = targets[0], last = targets.at(-1)
      if (!first || !last) { event.preventDefault(); element.focus(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      if (previous?.isConnected) previous.focus()
    }
  }, [modal, panel])
}
