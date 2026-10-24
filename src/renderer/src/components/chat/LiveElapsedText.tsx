import { useEffect, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { threadLiveActivityAt } from '../../store/thread-live-activity'
import { formatDuration } from './message-timeline-tools'

/**
 * Elapsed-time label that ticks by writing `textContent` directly once a
 * second instead of bubbling a state update through React. The parent turn
 * stays memoized while the timer visibly advances.
 */
export function LiveElapsedText({ sinceMs }: { sinceMs: number }): ReactElement {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const update = (): void => {
      node.textContent = formatDuration(Math.max(0, Date.now() - sinceMs))
    }
    update()
    const id = window.setInterval(update, 1000)
    return () => window.clearInterval(id)
  }, [sinceMs])
  return <span ref={ref} className="tabular-nums" />
}

/** A running turn says it has gone quiet after this long without any event. */
export const LIVE_SILENCE_NOTICE_MS = 120_000

export function liveSilenceMinutes(nowMs: number, startedAtMs: number, lastEventAtMs: number | undefined): number | null {
  const silentMs = nowMs - Math.max(startedAtMs, lastEventAtMs ?? 0)
  return silentMs >= LIVE_SILENCE_NOTICE_MS ? Math.floor(silentMs / 60_000) : null
}

/**
 * " · no output for N min" once a running turn has received nothing for two
 * minutes, so a stalled turn reads differently from a long command. Ticks in
 * the DOM like `LiveElapsedText`.
 */
export function LiveSilenceText({ threadId, sinceMs }: { threadId: string; sinceMs: number }): ReactElement {
  const { t } = useTranslation('common')
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const update = (): void => {
      const minutes = liveSilenceMinutes(Date.now(), sinceMs, threadLiveActivityAt(threadId))
      node.textContent = minutes === null ? '' : ` · ${t('liveTurnSilentMinutes', { minutes })}`
    }
    update()
    const id = window.setInterval(update, 1000)
    return () => window.clearInterval(id)
  }, [sinceMs, t, threadId])
  return <span ref={ref} className="text-amber-600 dark:text-amber-300" data-live-silence />
}
