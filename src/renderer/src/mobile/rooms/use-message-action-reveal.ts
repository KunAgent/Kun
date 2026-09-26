import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'

const HOLD_MS = 450
const SLOP_PX = 10
export const MESSAGE_ACTIONS_OPEN_ATTRIBUTE = 'data-kun-actions-open'

function messageAt(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element) || !target.closest('.rooms-message-bubble')) return null
  return target.closest<HTMLElement>('article[data-room-message-id]')
}

/**
 * Press-and-hold message actions: each message's action bar stays hidden until
 * its bubble is pressed and held (or right-clicked); a tap anywhere else hides
 * it again. Delegated from the conversation root because the timeline markup
 * belongs to the shared desktop RoomTimeline.
 */
export function useMessageActionReveal() {
  const [open, setOpen] = useState<HTMLElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const swallowClick = useRef(false)
  const cancel = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    origin.current = null
  }
  useEffect(() => cancel, [])
  useEffect(() => {
    if (!open) return undefined
    open.setAttribute(MESSAGE_ACTIONS_OPEN_ATTRIBUTE, '')
    return () => open.removeAttribute(MESSAGE_ACTIONS_OPEN_ATTRIBUTE)
  }, [open])
  const reveal = (article: HTMLElement): void => {
    cancel()
    swallowClick.current = true
    navigator.vibrate?.(10)
    setOpen(article)
  }
  return {
    onPointerDown: (event: PointerEvent) => {
      swallowClick.current = false
      if (open && !(event.target instanceof Node && open.contains(event.target))) setOpen(null)
      if (event.pointerType === 'mouse' && event.button !== 0) return
      const article = messageAt(event.target)
      if (!article) return
      origin.current = { x: event.clientX, y: event.clientY }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => reveal(article), HOLD_MS)
    },
    onPointerMove: (event: PointerEvent) => {
      const start = origin.current
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP_PX) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event: MouseEvent) => {
      const article = messageAt(event.target)
      if (!article) return
      event.preventDefault()
      reveal(article)
    },
    onClickCapture: (event: MouseEvent) => {
      if (!swallowClick.current) return
      swallowClick.current = false
      event.preventDefault()
      event.stopPropagation()
    }
  }
}
