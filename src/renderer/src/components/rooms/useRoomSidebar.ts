import { RoomSidebarPins } from './room-sidebar-pins'
import { useEffect, useRef, useState } from 'react'
import type { RoomSidebarPage, RoomSidebarQuery } from '@shared/rooms-api'
import { roomsRequest } from './rooms-client'
import { subscribeRoomEvents, roomEventsLive } from './useRoomEvents'

export function useRoomSidebar(query: RoomSidebarQuery, refreshKey = '', enabled = true) {
  const path = '/v1/rooms/sidebar?' + new URLSearchParams({ kind: query.kind ?? 'all', search: query.search ?? '',
    archived_only: String(Boolean(query.archivedOnly)), deleted_only: String(Boolean(query.deletedOnly)), unread_only: String(Boolean(query.unreadOnly)),
    attention_only: String(Boolean(query.attentionOnly)), ...(query.repositoryRoot ? { repository_root: query.repositoryRoot } : {}), limit: '40' })
  const [state, setState] = useState<RoomSidebarPage>({ entries: [] }), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [pages, setPages] = useState(1), [version, setVersion] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [, redraw] = useState(0)
  const [pins] = useState(() => new RoomSidebarPins(() => redraw((v) => v + 1), () => setVersion((v) => v + 1), setError))
  const previousPath = useRef(path)
  useEffect(() => {
    if (!enabled) { setError(''); setBusy(false); setLoaded(false); return }
    const changed = previousPath.current !== path
    if (changed) { previousPath.current = path; setState({ entries: [] }); setPages(1); setLoaded(false) }
    const count = changed ? 1 : pages
    const controller = new AbortController()
    let refreshSerial = 0, timer: ReturnType<typeof setTimeout> | undefined
    let refreshing = false, dirty = false
    const schedule = (delay: number) => {
      if (timer || controller.signal.aborted) return
      if (refreshing) { dirty = true; return }
      timer = setTimeout(() => { timer = undefined; void refresh() }, delay)
    }
    const refresh = async () => {
      const serial = ++refreshSerial
      const pinCheckpoint = pins.checkpoint()
      refreshing = true; setBusy(true); setError('')
      try {
        const entries: RoomSidebarPage['entries'] = []
        let cursor: string | undefined
        for (let page = 0; page < count; page++) {
          const result = await roomsRequest<RoomSidebarPage>(path + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), 'GET', undefined, controller.signal)
          if (controller.signal.aborted || serial !== refreshSerial) return
          entries.push(...result.entries); cursor = result.nextCursor
          if (!cursor) break
        }
        pins.received(pinCheckpoint)
        setState({ entries: [...new Map(entries.map((entry) => [entry.id, entry])).values()], nextCursor: cursor }); setError('')
      } catch (cause) { if (!controller.signal.aborted && serial === refreshSerial) setError(String(cause)) }
      finally {
        refreshing = false
        if (!controller.signal.aborted && serial === refreshSerial) {
          setLoaded(true)
          setBusy(false)
          if (dirty) { dirty = false; schedule(350) }
        }
      }
    }
    schedule(query.search ? 200 : 0)
    const off = subscribeRoomEvents((event) => {
      if (!/^(agent\.|room\.|message\.(created|updated|presentation)|room_run\.|task\.|request\.|integration\.|presentation\.preference)/.test(event.kind)) return
      schedule(350)
    })
    const fallback = setInterval(() => { if (!roomEventsLive()) schedule(0) }, 10000)
    return () => { controller.abort(); off(); clearTimeout(timer); clearInterval(fallback) }
  }, [path, pages, version, query.search, refreshKey, pins, enabled])
  return { ...state, entries: enabled && loaded ? pins.project(state.entries) : [],
    nextCursor: enabled && loaded ? state.nextCursor : undefined,
    togglePin: (entry: RoomSidebarPage['entries'][number]) => { if (enabled) pins.toggle(entry) },
    busy: enabled && (!loaded || busy), error: enabled ? error : '',
    refresh: () => { if (enabled) setVersion((v) => v + 1) }, more: () => { if (enabled) setPages((v) => v + 1) } }
}
