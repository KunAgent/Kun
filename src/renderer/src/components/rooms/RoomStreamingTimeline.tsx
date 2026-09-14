import { useEffect, useMemo, useState, type ComponentProps } from 'react'
import type { RoomMessage, RoomRunEvent } from '@shared/rooms-api'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { roomRequestId } from './rooms-client'
import { RoomTimeline } from './RoomTimeline'

/** Live text is disposable presentation. A committed/failed room message always wins. */
export function projectStreamingMessage(messages: RoomMessage[], live: RoomMessage | null) {
  if (!live) return messages
  const current = messages.find((message) => message.id === live.id)
  if (current && current.status !== 'streaming') return messages
  if (current && (current.body === live.body || current.body.length > live.body.length)) return messages
  const merged = current ? messages.map((message) => message.id === live.id ? { ...message, body: live.body } : message) : [...messages, live]
  return merged.sort((a, b) => a.messageSeq - b.messageSeq)
}
export function RoomStreamingTimeline({ runId, ...props }: ComponentProps<typeof RoomTimeline> & { runId?: string }) {
  const roomId = props.room.id
  const [live, setLive] = useState<RoomMessage | null>(null)
  const committed = props.messages.some((message) => message.originRunId === runId && message.status !== 'streaming')
  useEffect(() => {
    setLive(null)
    if (!runId || committed || !window.kunGui?.startSse) return
    const streamId = 'room-text-' + roomRequestId()
    let closed = false, frame: number | undefined, pending: RoomMessage | null = null
    const off = rendererRuntimeClient.onSseEvent((payload) => {
      if (closed || payload.streamId !== streamId) return
      for (const event of payload.events as RoomRunEvent[]) {
        if (event.kind !== 'run.text' || event.roomId !== roomId || event.runId !== runId) continue
        pending = event.message ?? null
        if (frame === undefined) frame = requestAnimationFrame(() => { frame = undefined; if (!closed) setLive(pending) })
      }
    })
    void rendererRuntimeClient.startSse(runId, 0, streamId, { scope: 'room-run', roomId, runId }).catch(() => {})
    return () => { closed = true; off(); if (frame !== undefined) cancelAnimationFrame(frame); void rendererRuntimeClient.stopSse(streamId).catch(() => {}) }
  }, [roomId, runId, committed])
  const messages = useMemo(() => projectStreamingMessage(props.messages, live?.roomId === roomId && live.originRunId === runId ? live : null), [props.messages, live, roomId, runId])
  return <RoomTimeline {...props} messages={messages} />
}
