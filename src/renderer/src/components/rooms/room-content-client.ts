import { useEffect, useRef, useState } from 'react'
import type { Room, RoomContentReference, RoomContentResult } from '@shared/rooms-api'
import { roomsRequest } from './rooms-client'
import { subscribeRoomEvents } from './useRoomEvents'

export function roomContentStatusKey(kind: RoomContentResult['kind'], status: string): string {
  return kind === 'board_card' ? status === 'pending' ? 'projectBoardPending'
    : status === 'in_progress' ? 'projectBoardInProgress' : 'projectBoardCompleted' : `roomsState_${status}`
}

export function roomContentKey(reference: RoomContentReference): string {
  const { titleSnapshot: _title, ...identity } = reference
  return JSON.stringify(identity)
}
export function roomContentPath(roomId: string, reference: RoomContentReference, mode = 'summary', messageId?: string): string {
  const query = new URLSearchParams({ reference: JSON.stringify(reference), mode })
  if (messageId) query.set('message_id', messageId)
  return `/v1/rooms/${encodeURIComponent(roomId)}/content?${query}`
}
export function useRoomContentVisibility(rootMargin = '0px', enabled = true) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!enabled) { setVisible(false); return }
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    if (!ref.current) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) { setVisible(true); observer.disconnect() }
    }, { rootMargin })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [rootMargin, enabled])
  return { ref, visible }
}
const summaries = new Map<string, { result: RoomContentResult; expires: number }>()
export function useRoomContent(room: Room, reference: RoomContentReference, mode: 'summary' | 'thumbnail' | 'preview',
  enabled: boolean, messageId?: string, revision = 0) {
  const path = roomContentPath(room.id, reference, mode, messageId)
  const key = `${room.revision}:${path}`
  const [value, setValue] = useState<{ key: string; result: RoomContentResult } | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const result = value?.key === key ? value.result : null
  const error = failure?.key === key ? failure.message : ''
  const [updates, setUpdates] = useState(0)
  const taskId = reference.kind === 'task' ? reference.taskId : undefined
  useEffect(() => {
    if (!enabled || !taskId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = subscribeRoomEvents((event) => {
      if (event.roomId !== room.id || !event.kind.startsWith('task.')) return
      const payload = event.payload as { id?: string; taskId?: string }
      if (payload?.id !== taskId && payload?.taskId !== taskId) return
      summaries.delete(key)
      clearTimeout(timer)
      timer = setTimeout(() => setUpdates((value) => value + 1), 150)
    })
    return () => { clearTimeout(timer); unsubscribe() }
  }, [enabled, taskId, room.id, key])
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const cached = mode === 'summary' ? summaries.get(key) : undefined
    if (cached && cached.expires > Date.now()) { setValue({ key, result: cached.result }); return }
    setFailure(null)
    setValue((current) => current?.key === key ? current : null)
    void roomsRequest<RoomContentResult>(path, 'GET', undefined, controller.signal).then((data) => {
      if (controller.signal.aborted) return
      setValue({ key, result: data })
      if (mode === 'summary') {
        if (summaries.size >= 200) summaries.delete(summaries.keys().next().value!)
        summaries.set(key, { result: data, expires: Date.now() + 30000 })
      }
    }).catch((cause) => { if (!controller.signal.aborted) setFailure({ key, message: String(cause) }) })
    return () => controller.abort()
  }, [enabled, key, path, mode, revision, updates])
  return { result, error, loading: enabled && !result && !error }
}
