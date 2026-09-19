import { useCallback, useEffect, useRef, useState } from 'react'
import { roomsRequest } from './rooms-client'
import { useRoomResource } from './useRoomResource'
import { subscribeRoomEvents } from './useRoomEvents'
import { roomResourceAffected, sharedRoomRead } from './room-resource-events'

/** Retain loaded immutable history and the current selection while refreshing the head page. */
export function useRoomPage<T extends { id: string; version?: number; revision?: number }>(
  roomId: string, path: string | null, field: string, versions = false
) {
  const resource = useRoomResource<Record<string, unknown>>(roomId, path)
  const [items, setItems] = useState<T[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pages = useRef(new Map<string, T[]>())
  const pathRef = useRef(path)
  pathRef.current = path
  const initialized = useRef(false)
  const key = useCallback((item: T) => versions ? item.id + ':' + item.version : item.id, [versions])
  useEffect(() => {
    pages.current.clear()
    initialized.current = false
    setItems([])
    setNextCursor(undefined)
    setError('')
    setBusy(false)
  }, [path])
  useEffect(() => {
    const incoming = resource.data?.[field] as T[] | undefined
    if (!incoming) return
    const merged = new Map<string, T>()
    for (const item of [...incoming, ...[...pages.current.values()].flat()]) {
      const old = merged.get(key(item))
      if (!old || (item.revision ?? 0) > (old.revision ?? 0)) merged.set(key(item), item)
    }
    const head = new Map((pages.current.get('') ?? []).map((item) => [key(item), item]))
    for (const item of incoming) head.set(key(item), item)
    pages.current.set('', [...head.values()])
    setItems([...merged.values()])
    if (!initialized.current) {
      initialized.current = true
      setNextCursor(resource.data?.nextCursor as string | undefined)
    }
  }, [resource.data, field, versions, key])
  const refreshPages = useCallback(async (cursors: string[]) => {
    if (!path) return
    const values = await Promise.all(cursors.map(async (cursor) => ({ cursor,
      page: await sharedRoomRead<Record<string, unknown>>(path + (path.includes('?') ? '&' : '?') + 'cursor=' + encodeURIComponent(cursor)) })))
    if (pathRef.current !== path) return
    for (const value of values) if (Array.isArray(value.page[field])) pages.current.set(value.cursor, value.page[field] as T[])
    const merged = new Map<string, T>()
    for (const item of [...pages.current.values()].flat()) {
      const old = merged.get(key(item))
      if (!old || (item.revision ?? 0) >= (old.revision ?? 0)) merged.set(key(item), item)
    }
    setItems([...merged.values()])
  }, [path, field, key])
  useEffect(() => {
    if (!path) return
    const dirty = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = subscribeRoomEvents((event) => {
      if (event.roomId !== roomId || !roomResourceAffected(path, event) || !event.payload?.id) return
      for (const [cursor, items] of pages.current) if (cursor && items.some((item) => item.id === event.payload!.id)) dirty.add(cursor)
      if (!dirty.size) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        const cursors = [...dirty]; dirty.clear()
        void refreshPages(cursors).catch((cause) => setError(String(cause)))
      }, 150)
    })
    return () => { off(); clearTimeout(timer) }
  }, [path, roomId, refreshPages])
  const refresh = async () => {
    await resource.refresh()
    await refreshPages([...pages.current.keys()].filter(Boolean))
  }
  const loadMore = async () => {
    if (!path || !nextCursor || busy) return
    const selectedPath = path
    setBusy(true)
    try {
      const data = await roomsRequest<Record<string, unknown>>(path + (path.includes('?') ? '&' : '?') + 'cursor=' + encodeURIComponent(nextCursor))
      if (pathRef.current !== selectedPath) return
      const more = data[field] as T[]
      pages.current.set(nextCursor, more)
      const merged = new Map<string, T>()
      for (const item of [...pages.current.values()].flat()) {
        const old = merged.get(key(item))
        if (!old || (item.revision ?? 0) > (old.revision ?? 0)) merged.set(key(item), item)
      }
      setItems([...merged.values()])
      setNextCursor(data.nextCursor as string | undefined)
      setError('')
    } catch (cause) {
      if (pathRef.current === selectedPath) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (pathRef.current === selectedPath) setBusy(false)
    }
  }
  return { items, nextCursor, loadMore, busy, error: error || resource.error, refresh }
}
