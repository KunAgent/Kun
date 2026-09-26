import { useCallback, useEffect, useRef, useState } from 'react'
import type { RoomPeerTopicSummary } from '@shared/rooms-api'
import { roomsClient } from './rooms-client'
import { roomEventsLive, subscribeRoomEvents } from './useRoomEvents'

type TopicPage = { topics: RoomPeerTopicSummary[]; nextCursor?: string | null }

/** Keep loaded topics while refreshing their pages; never retain a request from another room. */
export function useRoomTopics(roomId: string) {
  const [topics, setTopics] = useState<RoomPeerTopicSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(roomId))
  const [moreBusy, setMoreBusy] = useState(false)
  const [error, setError] = useState('')
  const refreshRef = useRef<() => Promise<void>>(async () => undefined)
  const moreRef = useRef<() => Promise<void>>(async () => undefined)

  useEffect(() => {
    setTopics([])
    setNextCursor(null)
    setError('')
    setLoading(Boolean(roomId))
    setMoreBusy(false)
    if (!roomId) return
    const controller = new AbortController()
    const pages = new Map<string, TopicPage>()
    let inFlight: Promise<void> | undefined
    let again = false
    let cursor: string | null = null
    let loadingMore = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let eventTimer: ReturnType<typeof setTimeout> | undefined
    const merge = () => {
      const byId = new Map<string, RoomPeerTopicSummary>()
      for (const page of pages.values()) {
        for (const topic of page.topics) {
          const previous = byId.get(topic.rootRequestId)
          if (!previous || topic.revision >= previous.revision)
            byId.set(topic.rootRequestId, topic)
        }
      }
      setTopics(
        [...byId.values()].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt)
        )
      )
    }
    const refresh = (): Promise<void> => {
      if (inFlight) {
        again = true
        return inFlight
      }
      clearTimeout(timer)
      inFlight = (async () => {
        do {
          again = false
          const cursors = pages.size ? [...pages.keys()] : ['']
          try {
            const values = await Promise.all(
              cursors.map(async (pageCursor) => ({
                cursor: pageCursor,
                page: await roomsClient.topics(
                  roomId,
                  pageCursor || undefined,
                  controller.signal
                )
              }))
            )
            if (controller.signal.aborted) return
            for (const value of values) pages.set(value.cursor, value.page)
            if (cursors.length === 1 && cursors[0] === '') {
              cursor = values[0].page.nextCursor ?? null
              setNextCursor(cursor)
            }
            merge()
            setError('')
          } catch (cause) {
            if (!controller.signal.aborted)
              setError(cause instanceof Error ? cause.message : String(cause))
          }
        } while (again && !controller.signal.aborted)
      })().finally(() => {
        inFlight = undefined
        if (!controller.signal.aborted) {
          setLoading(false)
          timer = setTimeout(
            () => void refresh(),
            roomEventsLive() ? 30000 : 2500
          )
        }
      })
      return inFlight
    }
    refreshRef.current = refresh
    moreRef.current = async () => {
      if (!cursor || loadingMore) return
      loadingMore = true
      setMoreBusy(true)
      try {
        const pageCursor = cursor
        const page = await roomsClient.topics(
          roomId,
          pageCursor,
          controller.signal
        )
        if (controller.signal.aborted) return
        pages.set(pageCursor, page)
        cursor = page.nextCursor ?? null
        setNextCursor(cursor)
        merge()
        setError('')
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        loadingMore = false
        if (!controller.signal.aborted) setMoreBusy(false)
      }
    }
    const unsubscribe = subscribeRoomEvents((event) => {
      if (event.roomId !== roomId || !event.kind.startsWith('peer.')) return
      clearTimeout(eventTimer)
      eventTimer = setTimeout(() => void refresh(), 150)
    })
    void refresh()
    return () => {
      controller.abort()
      unsubscribe()
      clearTimeout(timer)
      clearTimeout(eventTimer)
      refreshRef.current = async () => undefined
      moreRef.current = async () => undefined
    }
  }, [roomId])
  const refresh = useCallback(() => refreshRef.current(), [])
  const loadMore = useCallback(() => moreRef.current(), [])
  return { topics, nextCursor, loading, moreBusy, error, refresh, loadMore }
}
