import { useCallback, useEffect, useRef } from 'react'
import { paperResourceKey } from './paper-resource-key'

type Position = { root: string; unitDir: string; page: number; pageCount: number }
const keyFor = (root: string, unitDir: string): string => `kun.mobile.paper.page.${paperResourceKey(root, unitDir)}`

export function readMobilePaperPage(root: string, unitDir: string, hostPage: number | undefined,
  hostOpenedAt?: string): number {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(keyFor(root, unitDir)) ?? 'null') as
      { page?: number; updatedAt?: number } | null
    const hostTime = hostOpenedAt ? Date.parse(hostOpenedAt) : 0
    if (value && Number.isInteger(value.page) && value.page! > 0 &&
      Number.isFinite(value.updatedAt) && value.updatedAt! > (Number.isFinite(hostTime) ? hostTime : 0)) {
      return value.page!
    }
  } catch { /* private mode or invalid old state */ }
  return hostPage && hostPage > 0 ? hostPage : 1
}

function cachePosition(position: Position): void {
  try {
    window.sessionStorage.setItem(keyFor(position.root, position.unitDir),
      JSON.stringify({ page: position.page, updatedAt: Date.now() }))
  } catch { /* private mode */ }
}

/** Serializes host writes and flushes the latest position on hide or unmount. */
export function useMobilePaperPageProgress(position: Position, onError: (message: string) => void) {
  const { root, unitDir, page, pageCount } = position
  const pending = useRef<Position | null>(null)
  const timer = useRef<number | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const mounted = useRef(true)
  const errorRef = useRef(onError)
  errorRef.current = onError
  const flush = useCallback((): Promise<void> => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    const snapshot = pending.current
    pending.current = null
    if (!snapshot) return queue.current
    queue.current = queue.current.then(async () => {
      await window.kunGui.paperLocalStateWrite({ libraryRoot: snapshot.root,
        unitRelDir: snapshot.unitDir, patch: { lastPage: snapshot.page, pageCount: snapshot.pageCount } })
    }).catch((cause: unknown) => {
      if (mounted.current) errorRef.current(cause instanceof Error ? cause.message : String(cause))
    })
    return queue.current
  }, [])
  useEffect(() => {
    if (pending.current && (pending.current.root !== root || pending.current.unitDir !== unitDir)) {
      void flush()
    }
    if (!root || !unitDir || pageCount <= 0) return
    const snapshot = { root, unitDir, page, pageCount }
    pending.current = snapshot
    cachePosition(snapshot)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { void flush() }, 700)
  }, [root, unitDir, page, pageCount, flush])
  useEffect(() => {
    mounted.current = true
    const onVisibility = (): void => { if (document.visibilityState === 'hidden') void flush() }
    const onPageHide = (): void => { void flush() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      mounted.current = false
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      void flush()
    }
  }, [flush])
  return flush
}
