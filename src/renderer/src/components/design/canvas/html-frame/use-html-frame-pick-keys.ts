import { useEffect, useRef } from 'react'

type Options = {
  enabled: boolean
  hasSelection: boolean
  menuOpen: boolean
  canGoUp: () => boolean
  onUp: () => void
  onDown: () => void
  onSibling: (step: 1 | -1) => void
  onClear: () => void
  onCloseMenu: () => void
  onAlt: (held: boolean) => void
}

/** Keys that own a text caret or a focused control must keep their own meaning. */
function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('input,textarea,select,[contenteditable="true"],[contenteditable=""]'))
}

function controlTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('button,a[href],summary,[role="button"],[role="menuitem"],[role="tab"]'))
}

/**
 * Depth navigation for a picked element: Esc/Shift+Enter go up one level,
 * Enter goes into the first child, Tab/Shift+Tab walk siblings. Alt is tracked
 * for the distance guides.
 */
export function useHtmlFramePickKeys(options: Options): void {
  const latest = useRef(options)
  latest.current = options
  const { enabled, hasSelection, menuOpen } = options
  useEffect(() => {
    if (!enabled) return
    const stop = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const o = latest.current
      if (event.key === 'Alt') { o.onAlt(true); return }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Escape') {
        if (menuOpen) { o.onCloseMenu(); stop(event); return }
        if (!hasSelection) return
        if (o.canGoUp()) o.onUp()
        else o.onClear()
        stop(event)
        return
      }
      if (!hasSelection || typingTarget(event.target) || controlTarget(event.target)) return
      if (event.key === 'Enter') {
        if (event.shiftKey) o.onUp()
        else o.onDown()
        stop(event)
      } else if (event.key === 'Tab') {
        o.onSibling(event.shiftKey ? -1 : 1)
        stop(event)
      }
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Alt') latest.current.onAlt(false)
    }
    const onBlur = (): void => latest.current.onAlt(false)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      latest.current.onAlt(false)
    }
  }, [enabled, hasSelection, menuOpen])
}
