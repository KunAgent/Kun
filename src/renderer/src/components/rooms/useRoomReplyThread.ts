import { useCallback, useEffect, useRef, useState } from 'react'
import type { RoomMessage, RoomReplyPage } from '@shared/rooms-api'
import { mergeRoomMessages, roomPath, roomsRequest } from './rooms-client'
import { subscribeRoomEvents } from './useRoomEvents'

export function useRoomReplyThread(roomId: string, messageId: string, active = true) {
  const [page, setPage] = useState<RoomReplyPage | null>(null)
  const [messages, setMessages] = useState<RoomMessage[]>([])
  const [cursor, setCursor] = useState<string>()
  const [gaps, setGaps] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [moreBusy, setMoreBusy] = useState(false)
  const current = useRef(messages)
  current.current = messages
  const lifetime = useRef<AbortController | null>(null)
  const snapshot = useRef(0)
  const loaded = useRef(false)
  const base = `${roomPath(roomId)}/replies/${encodeURIComponent(messageId)}?limit=40`
  const read = useCallback((signal: AbortSignal, before?: string) => roomsRequest<RoomReplyPage>(
    base + (before ? `&cursor=${encodeURIComponent(before)}` : ''), 'GET', undefined, signal), [base])
  useEffect(() => {
    const controller = new AbortController()
    const revision = ++snapshot.current
    lifetime.current = controller
    loaded.current = false
    setPage(null); setMessages([]); setCursor(undefined); setGaps([]); setError(''); setLoading(true)
    void read(controller.signal).then((value) => {
      if (!controller.signal.aborted && snapshot.current === revision) { loaded.current = true; setPage(value); setMessages(value.messages); setCursor(value.nextCursor) }
    }).catch((cause) => { if (!controller.signal.aborted && snapshot.current === revision) setError(String(cause)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [read])
  const refresh = useCallback(async () => {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted) return
    const revision = ++snapshot.current
    try {
      const value = await read(signal)
      if (signal.aborted || snapshot.current !== revision) return
      if (!current.current.length) setCursor(value.nextCursor)
      loaded.current = true
      if (current.current.length && value.messages.length && value.nextCursor &&
        !value.messages.some((item) => current.current.some((old) => old.id === item.id))) {
        const next = value.nextCursor
        setGaps((pending) => pending.includes(next) ? pending : [next, ...pending])
      }
      setPage(value); setMessages((previous) => mergeRoomMessages(previous, value.messages)); setError('')
    } catch (cause) { if (!signal.aborted && snapshot.current === revision) setError(String(cause)) }
  }, [read])
  useEffect(() => {
    if (!active) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = subscribeRoomEvents((event) => {
      if (event.roomId !== roomId || !['message.created', 'message.updated'].includes(event.kind)) return
      clearTimeout(timer); timer = setTimeout(() => void refresh(), 200)
    })
    // Return from a nested detail refreshes this thread, never changes its target.
    if (loaded.current) void refresh()
    return () => { clearTimeout(timer); off() }
  }, [active, refresh, roomId])
  const loadEarlier = async () => {
    const before = gaps[0] ?? cursor, signal = lifetime.current?.signal
    if (!before || !signal || moreBusy) return
    setMoreBusy(true)
    try {
      const value = await read(signal, before)
      if (signal.aborted) return
      if (gaps[0]) {
        const overlap = value.messages.some((item) => current.current.some((old) => old.id === item.id))
        setGaps((pending) => pending.flatMap((entry) => entry === before
          ? overlap || !value.nextCursor ? [] : [value.nextCursor] : [entry]))
      } else setCursor(value.nextCursor)
      setMessages((previous) => mergeRoomMessages(value.messages, previous)); setError('')
    } catch (cause) { if (!signal.aborted) setError(String(cause)) }
    finally { if (!signal.aborted) setMoreBusy(false) }
  }
  return { page, messages, error, loading, moreBusy, hasEarlier: Boolean(gaps.length || cursor),
    loadEarlier, refresh, insert: (message: RoomMessage) => setMessages((previous) => mergeRoomMessages(previous, [message])) }
}
