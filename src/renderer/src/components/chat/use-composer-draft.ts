import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'

import { postWorkerNoticeHold } from '../../agent/ade-notices'

const WORKER_NOTICE_HOLD_RENEW_MS = 30_000

type UseComposerDraftOptions = {
  input: string
  canCompose: boolean
  /**
   * ADE manager thread id (09 §6.2): while the composer is focused with a
   * non-empty draft, renew a server-side worker-notice hold every 30 s so a
   * wake-up turn never interrupts typing; notices ride the user's send.
   */
  noticeHoldThreadId?: string | null
}

export function useComposerDraft({ input, canCompose, noticeHoldThreadId }: UseComposerDraftOptions): {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  focused: boolean
  focusComposer: () => void
  onFocus: () => void
  onBlur: () => void
  onCompositionStart: () => void
  onCompositionEnd: () => void
  isComposingEvent: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean
} {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const composingRef = useRef(false)
  const [focused, setFocused] = useState(false)

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return

    el.style.height = '0px'
    const nextHeight = Math.min(el.scrollHeight, 176)
    const minHeight = 36
    el.style.height = `${Math.max(nextHeight, minHeight)}px`
    el.style.overflowY = el.scrollHeight > 176 ? 'auto' : 'hidden'
  }, [])

  useLayoutEffect(() => {
    resizeTextarea()
  }, [canCompose, input, resizeTextarea])

  useEffect(() => {
    const el = textareaRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    let frame = 0
    let previousWidth = el.getBoundingClientRect().width
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = entry?.contentRect.width ?? el.getBoundingClientRect().width
      if (Math.abs(nextWidth - previousWidth) < 0.5) return
      previousWidth = nextWidth
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(resizeTextarea)
    })

    observer.observe(el)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [resizeTextarea])

  const focusComposer = useCallback(() => {
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])

  const hasDraft = input.trim().length > 0
  useEffect(() => {
    if (!noticeHoldThreadId || !focused || !hasDraft) return
    void postWorkerNoticeHold(noticeHoldThreadId)
    const interval = window.setInterval(
      () => void postWorkerNoticeHold(noticeHoldThreadId),
      WORKER_NOTICE_HOLD_RENEW_MS
    )
    return () => window.clearInterval(interval)
  }, [noticeHoldThreadId, focused, hasDraft])

  return {
    textareaRef,
    focused,
    focusComposer,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onCompositionStart: () => {
      composingRef.current = true
    },
    onCompositionEnd: () => {
      composingRef.current = false
    },
    isComposingEvent: (event) =>
      event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229
  }
}
