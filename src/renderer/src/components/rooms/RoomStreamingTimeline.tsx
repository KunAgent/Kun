import { useEffect, useMemo, useState, type ComponentProps } from 'react'
import type { RoomMessage, RoomRunEvent } from '@shared/rooms-api'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { roomRequestId } from './rooms-client'
import { RoomTimeline } from './RoomTimeline'

/** Live text is disposable presentation. A committed/failed room message always wins. */
export function projectStreamingMessages(messages: RoomMessage[], live: RoomMessage[]) {
  if (!live.length) return messages
  const byId = new Map(messages.map((message) => [message.id, message]))
  let changed = false
  for (const item of live) {
    const current = byId.get(item.id)
    if (current && current.status !== 'streaming') continue
    if (current && (current.body === item.body || current.body.length > item.body.length)) continue
    byId.set(item.id, current ? { ...current, body: item.body } : item)
    changed = true
  }
  if (!changed) return messages
  return [...byId.values()].sort((a, b) => a.messageSeq - b.messageSeq)
}

/** Accumulate live segments in one frame without dropping any of them. */
function mergeLiveMessages(current: RoomMessage[], message: RoomMessage | null): RoomMessage[] {
  if (message === null) return []
  const byId = new Map(current.map((item) => [item.id, item]))
  byId.set(message.id, message)
  return [...byId.values()].sort((a, b) => a.messageSeq - b.messageSeq)
}

export function RoomStreamingTimeline({ runId, ...props }: ComponentProps<typeof RoomTimeline> & { runId?: string }) {
  const roomId = props.room.id
  const [live, setLive] = useState<RoomMessage[]>([])
  useEffect(() => {
    setLive([])
    if (!runId || !window.kunGui?.startSse) return
    const streamId = 'room-text-' + roomRequestId()
    let closed = false, frame: number | undefined
    let pending: RoomMessage[] = []
    const off = rendererRuntimeClient.onSseEvent((payload) => {
      if (closed || payload.streamId !== streamId) return
      for (const event of payload.events as RoomRunEvent[]) {
        if (event.kind !== 'run.text' || event.roomId !== roomId || event.runId !== runId) continue
        pending = mergeLiveMessages(pending, event.message ?? null)
      }
      if (frame === undefined) frame = requestAnimationFrame(() => { frame = undefined; if (!closed) setLive(pending) })
    })
    void rendererRuntimeClient.startSse(runId, 0, streamId, { scope: 'room-run', roomId, runId }).catch(() => {})
    return () => { closed = true; off(); if (frame !== undefined) cancelAnimationFrame(frame); void rendererRuntimeClient.stopSse(streamId).catch(() => {}) }
  }, [roomId, runId])
  const messages = useMemo(() => projectStreamingMessages(props.messages,
    live.filter((message) => message.roomId === roomId && message.originRunId === runId)), [props.messages, live, roomId, runId])
  return <RoomTimeline {...props} messages={messages} />
}
