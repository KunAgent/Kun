import { useCallback, useEffect, useRef, useState } from 'react'
import { roomRequestId } from './rooms-client'
import { roomEventsLive, subscribeRoomEvents } from './useRoomEvents'
import { invalidateRoomRead, roomResourceAffected, sharedRoomRead } from './room-resource-events'

/** Subscribe once, coalesce bursts, and retain the last usable snapshot on failure. */
export function useRoomResource<T>(roomId: string, path: string | null, live = true) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const refreshRef = useRef<() => Promise<void>>(async () => undefined)
  useEffect(() => {
    setData(null)
    setError('')
    if (!path) return
    const controller = new AbortController()
    let generation = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let eventTimer: ReturnType<typeof setTimeout> | undefined
    let inFlight: Promise<void> | undefined
    let invalidated = false
    const load = async (): Promise<void> => {
      clearTimeout(timer)
      const current = ++generation
      try {
        const result = await sharedRoomRead<T>(path)
        if (!controller.signal.aborted && generation === current) {
          setData(result)
          setError('')
        }
      } catch (cause) {
        if (live && !controller.signal.aborted && generation === current)
          setError(String(cause instanceof Error ? cause.message : cause))
      } finally {
        if (!controller.signal.aborted && generation === current)
          timer = setTimeout(
            () => void refresh(),
            roomEventsLive() ? 30000 : 2500
          )
      }
    }
    const refresh = (): Promise<void> => {
      if (inFlight) { invalidated = true; return inFlight }
      inFlight = (async () => {
        invalidated = false
        await load()
        if (invalidated && !controller.signal.aborted) { invalidated = false; await load() }
      })().finally(() => {
        inFlight = undefined
        if (invalidated && !controller.signal.aborted) {
          clearTimeout(eventTimer)
          eventTimer = setTimeout(() => void refresh(), 0)
        }
      })
      return inFlight
    }
    refreshRef.current = () => { invalidateRoomRead(path); return refresh() }
    const unsubscribe = subscribeRoomEvents((event) => {
      if (!live || event.roomId !== roomId || !roomResourceAffected(path, event)) return
      invalidateRoomRead(path)
      clearTimeout(eventTimer)
      eventTimer = setTimeout(() => void refresh(), 150)
    })
    void refresh()
    return () => {
      controller.abort()
      clearTimeout(timer)
      clearTimeout(eventTimer)
      unsubscribe()
      refreshRef.current = async () => undefined
    }
  }, [path, roomId, live])
  const refresh = useCallback(() => refreshRef.current(), [])
  return { data, error, refresh }
}

export function useRoomMutation(onUpdated: () => void | Promise<void>) {
  const identities = useRef(new Map<string, string>())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  const run = async (
    identity: string,
    action: (requestId: string) => Promise<unknown>
  ): Promise<boolean> => {
    if (locked.current) return false
    locked.current = true
    setBusy(true)
    setError('')
    const id = identities.current.get(identity) ?? roomRequestId()
    identities.current.set(identity, id)
    try {
      await action(id)
      identities.current.delete(identity)
      await onUpdated()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  return { run, busy, error }
}
