import { useEffect, useRef, useState } from 'react'
import type { RoomSidebarPage, RoomSidebarQuery } from '@shared/rooms-api'
import { roomsRequest } from './rooms-client'
import { subscribeRoomEvents, roomEventsLive } from './useRoomEvents'

export function useRoomSidebar(query: RoomSidebarQuery, refreshKey = '') {
  const path = '/v1/rooms/sidebar?' + new URLSearchParams({ kind: query.kind ?? 'all', search: query.search ?? '',
    archived_only: String(Boolean(query.archivedOnly)), unread_only: String(Boolean(query.unreadOnly)),
    attention_only: String(Boolean(query.attentionOnly)), ...(query.repositoryRoot ? { repository_root: query.repositoryRoot } : {}), limit: '40' })
  const [state, setState] = useState<RoomSidebarPage>({ entries: [] }), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [pages, setPages] = useState(1), [version, setVersion] = useState(0)
  const previousPath = useRef(path)
  useEffect(() => {
    const changed = previousPath.current !== path
    if (changed) { previousPath.current = path; setState({ entries: [] }); setPages(1) }
    const count = changed ? 1 : pages
    const controller = new AbortController()
    let refreshSerial = 0, timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      const serial = ++refreshSerial
      setBusy(true)
      try {
        const entries: RoomSidebarPage['entries'] = []
        let cursor: string | undefined
        for (let page = 0; page < count; page++) {
          const result = await roomsRequest<RoomSidebarPage>(path + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), 'GET', undefined, controller.signal)
          if (controller.signal.aborted || serial !== refreshSerial) return
          entries.push(...result.entries); cursor = result.nextCursor
          if (!cursor) break
        }
        setState({ entries: [...new Map(entries.map((entry) => [entry.id, entry])).values()], nextCursor: cursor }); setError('')
      } catch (cause) { if (!controller.signal.aborted && serial === refreshSerial) setError(String(cause)) }
      finally { if (!controller.signal.aborted && serial === refreshSerial) setBusy(false) }
    }
    timer = setTimeout(() => void refresh(), query.search ? 200 : 0)
    const off = subscribeRoomEvents((event) => {
      if (!/^(agent\.|room\.|message\.(created|updated|presentation)|room_run\.|task\.|request\.|integration\.|presentation\.preference)/.test(event.kind)) return
      clearTimeout(timer); timer = setTimeout(() => void refresh(), 350)
    })
    const fallback = setInterval(() => { if (!roomEventsLive()) void refresh() }, 10000)
    return () => { controller.abort(); off(); clearTimeout(timer); clearInterval(fallback) }
  }, [path, pages, version, query.search, refreshKey])
  return { ...state, busy, error, refresh: () => setVersion((v) => v + 1), more: () => setPages((v) => v + 1) }
}
