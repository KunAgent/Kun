import { useEffect, useRef, type ReactElement } from 'react'
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
