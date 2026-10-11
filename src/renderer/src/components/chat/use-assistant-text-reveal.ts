import { useEffect, useRef, useState } from 'react'
import {
  advanceTextReveal,
  completeTextReveal,
  createTextReveal,
  retargetTextReveal,
  visibleTextForTypewriter
} from './assistant-text-reveal'

const FRAME_FALLBACK_MS = 48

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

export function useAssistantTextReveal(text: string, streaming: boolean): string {
  const [state, setState] = useState(() => createTextReveal(text, streaming))
  const current = retargetTextReveal(state, text, streaming, performance.now(), isDocumentHidden())
  // Reconcile before painting: a phase change, replacement or background update
  // must never flash the previous cursor's truncated text, even for one frame.
  if (current !== state) setState(current)
  const currentRef = useRef(current)
  currentRef.current = current
  const revealing = current.pendingSince !== null

  useEffect(() => {
    if (!revealing) return
    let cancelled = false
    let frame: number | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancelScheduled = () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      if (timer !== undefined) clearTimeout(timer)
    }
    const tick = () => {
      if (cancelled) return
      cancelScheduled()
      const now = performance.now()
      const next = isDocumentHidden()
        ? completeTextReveal(currentRef.current)
        : advanceTextReveal(currentRef.current, now)
      currentRef.current = next
      setState(next)
      if (next.pendingSince !== null) schedule()
    }
    // rAF can stop in a minimized window. The timer provides bounded catch-up
    // without retaining an idle frame loop once the received text is visible.
    const schedule = () => {
      timer = setTimeout(tick, FRAME_FALLBACK_MS)
      if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(tick)
    }
    schedule()
    return () => {
      cancelled = true
      cancelScheduled()
    }
  }, [revealing])

  useEffect(() => {
    if (!streaming || typeof document === 'undefined') return
    const settle = () => {
      const next = completeTextReveal(currentRef.current)
      currentRef.current = next
      setState(next)
    }
    document.addEventListener('visibilitychange', settle)
    return () => document.removeEventListener('visibilitychange', settle)
  }, [streaming])

  return visibleTextForTypewriter(current.text, current.visibleLength)
}
