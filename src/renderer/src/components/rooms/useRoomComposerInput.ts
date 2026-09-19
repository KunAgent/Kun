import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

export function useRoomComposerInput(body: string) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)
  const resize = useCallback(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${Math.max(40, Math.min(element.scrollHeight, 200))}px`
    element.style.overflowY = element.scrollHeight > 200 ? 'auto' : 'hidden'
  }, [])
  useLayoutEffect(resize, [body, resize])
  useEffect(() => {
    const element = textareaRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    let width = element.getBoundingClientRect().width
    let frame = 0
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = entry?.contentRect.width ?? element.getBoundingClientRect().width
      if (Math.abs(nextWidth - width) < 0.5) return
      width = nextWidth
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(resize)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [resize])
  return { textareaRef, composingRef }
}
