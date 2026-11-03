import { useEffect, useMemo, useRef, useState } from 'react'
import {
  advanceTextReveal,
  completeTextReveal,
  createTextReveal,
  isTextRevealActive,
  retargetTextReveal,
  STREAM_FADE_MS,
  visibleTextForTypewriter,
  type TextRevealState
} from './assistant-text-reveal'
import { adoptRevealHandoff, registerRevealSource } from './assistant-reveal-handoff'
import type { StreamFadeSnapshot } from './rehype-stream-fade'

const FRAME_FALLBACK_MS = 48

export type AssistantTextReveal = {
  text: string
  /** In-flight graphemes for the fade plugin; null when nothing is fading. */
  fade: StreamFadeSnapshot | null
}

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

function fadeSnapshot(state: TextRevealState, now: number): StreamFadeSnapshot | null {
  if (state.fading.length === 0) return null
  const births = new Map<number, number>()
  for (const entry of state.fading) births.set(entry.offset, entry.birth)
  return { fadeFrom: state.fading[0].offset, births, now, fadeMs: STREAM_FADE_MS }
}

export function useAssistantTextReveal(text: string, streaming: boolean): AssistantTextReveal {
  const [state, setState] = useState(() => {
    const now = performance.now()
    return adoptRevealHandoff(text, streaming, now, isDocumentHidden()) ??
      createTextReveal(text, streaming, now)
  })
  const current = retargetTextReveal(state, text, streaming, performance.now(), isDocumentHidden())
  // Reconcile before painting: a phase change, replacement or background update
  // must never flash the previous cursor's truncated text, even for one frame.
  if (current !== state) setState(current)
  const currentRef = useRef(current)
  currentRef.current = current
  const revealing = isTextRevealActive(current)

  useEffect(() => {
    if (!revealing) return
    const release = registerRevealSource(() => currentRef.current)
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
      const previous = currentRef.current
      const next = isDocumentHidden()
        ? completeTextReveal(previous)
        : advanceTextReveal(previous, now)
      // Most frames only wait for the commit clock or a running CSS fade;
      // re-render (and re-parse the Markdown) only when the reveal moved.
      if (next !== previous) {
        currentRef.current = next
        setState(next)
      }
      if (isTextRevealActive(next)) schedule()
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
      release(performance.now())
    }
  }, [revealing])

  useEffect(() => {
    if (!revealing || typeof document === 'undefined') return
    const settle = () => {
      const next = completeTextReveal(currentRef.current)
      currentRef.current = next
      setState(next)
    }
    document.addEventListener('visibilitychange', settle)
    return () => document.removeEventListener('visibilitychange', settle)
  }, [revealing])

  const fade = useMemo(() => fadeSnapshot(current, performance.now()), [current])
  return { text: visibleTextForTypewriter(current.text, current.visibleLength), fade }
}
