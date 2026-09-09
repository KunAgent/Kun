import { useCallback, useEffect, useRef, useState } from 'react'
import { getProvider } from '../agent/registry'
import type { NormalizedThread } from '../agent/types'
import { formatRuntimeError } from '../lib/format-runtime-error'

// Settings needs a complete archive inventory, independent of the sidebar's
// active-only first page, workspace cursors, and visibility filters.
export function useArchivedThreads(runtimeReady: boolean, initialThreads: NormalizedThread[]) {
  const [threads, setThreads] = useState(() => initialThreads.filter((thread) => thread.archived === true))
  const [loading, setLoading] = useState(runtimeReady)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const currentRequestId = ++requestId.current
    if (retryTimer.current) clearTimeout(retryTimer.current)
    retryTimer.current = null
    if (!runtimeReady) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const provider = getProvider()
      const inventory = new Map<string, NormalizedThread>()
      let indexing = false
      if (typeof provider.listThreadsPage === 'function') {
        let cursor: string | undefined
        const seenCursors = new Set<string>()
        do {
          const page = await provider.listThreadsPage({
            archivedOnly: true,
            includeSide: false,
            lean: true,
            limit: 500,
            ...(cursor ? { cursor } : {})
          })
          if (currentRequestId !== requestId.current) return
          for (const thread of page.threads) inventory.set(thread.id, thread)
          indexing ||= page.indexStatus?.status === 'running' || page.indexStatus?.status === 'not_started'
          if (!page.hasMore) break
          if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
            throw new Error('Archived conversation pagination did not advance')
          }
          cursor = page.nextCursor
          seenCursors.add(cursor)
        } while (cursor)
      } else {
        const listed = await provider.listThreads({ archivedOnly: true, includeSide: false, lean: true })
        for (const thread of listed) inventory.set(thread.id, thread)
      }
      if (currentRequestId !== requestId.current) return
      setThreads([...inventory.values()].filter((thread) => thread.archived === true))
      setLoading(indexing)
      if (indexing) {
        // A cold index can return an empty/partial page. Restart from page one
        // until backfill finishes so older archives are not silently omitted.
        retryTimer.current = setTimeout(() => void refresh(), 1500)
      }
    } catch (error) {
      if (currentRequestId !== requestId.current) return
      setLoading(false)
      setError(formatRuntimeError(error))
    }
  }, [runtimeReady])

  useEffect(() => {
    void refresh()
    return () => {
      requestId.current += 1
      if (retryTimer.current) clearTimeout(retryTimer.current)
      retryTimer.current = null
    }
  }, [refresh])

  return { threads, loading, error, refresh }
}
