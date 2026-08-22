import { useEffect } from 'react'

export const NODE_GRAPH_AUTO_REFRESH_MS = 4_000

type Options = {
  enabled: boolean
  intervalMs?: number
  onRefresh: () => void
}

/**
 * Keeps the graph in step with the files behind it.
 *
 * A folder projection describes markdown on disk, which changes whenever the
 * user saves or edits a link, so requiring a manual refresh to see your own edit
 * is the wrong default. There is no push channel for arbitrary directory trees,
 * so this polls — cheaply, because an unchanged tree costs one stat pass on the
 * runtime side and the projection is cached.
 *
 * The timer is suspended whenever the document is hidden, so a backgrounded
 * window is never scanning the filesystem on a loop.
 */
export function useNodeGraphAutoRefresh({
  enabled,
  intervalMs = NODE_GRAPH_AUTO_REFRESH_MS,
  onRefresh
}: Options): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    let timer = 0
    const visible = (): boolean =>
      typeof document === 'undefined' || document.visibilityState !== 'hidden'
    const stop = (): void => {
      if (timer) window.clearInterval(timer)
      timer = 0
    }
    const start = (): void => {
      if (timer || !visible()) return
      timer = window.setInterval(() => {
        if (visible()) onRefresh()
      }, Math.max(1_000, intervalMs))
    }
    const onVisibilityChange = (): void => {
      if (visible()) {
        // Catch up immediately on return rather than waiting a full interval.
        onRefresh()
        start()
      } else stop()
    }
    start()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, intervalMs, onRefresh])
}
