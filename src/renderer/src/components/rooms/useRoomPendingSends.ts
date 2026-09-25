import { useCallback, useEffect, useRef, useState } from 'react'
import type { RoomMessage, SendRoomMessage } from '@shared/rooms-api'

export type RoomPendingSend = {
  clientRequestId: string
  body: string
  message: SendRoomMessage
  createdAt: string
  state: 'sending' | 'sent' | 'steered' | 'failed'
  error?: string
}

/**
 * Keep optimistic bubbles only until the server echoes the message back
 * (matched by clientRequestId) or until a timeout covers an older runtime
 * that never echoes the field. Failed sends stay for explicit retry/dismiss.
 * `steered` marks clientRequestIds whose private request merged into the
 * running reply, so the row can announce that instead of looking queued.
 */
export function reconcilePendingSends(
  pending: RoomPendingSend[],
  messages: RoomMessage[],
  now: number,
  timeoutMs = 30000,
  steered?: ReadonlySet<string>
): RoomPendingSend[] {
  const echoed = new Set(
    messages.map((message) => message.clientRequestId).filter(Boolean)
  )
  return pending.flatMap((item) => {
    if (echoed.has(item.clientRequestId)) return []
    if (item.state === 'failed') return [item]
    if (now - Date.parse(item.createdAt) > timeoutMs) return []
    const state = steered?.has(item.clientRequestId) ? 'steered' as const
      : item.state === 'steered' ? 'sent' as const : item.state
    return [state === item.state ? item : { ...item, state }]
  })
}

export function useRoomPendingSends(
  roomId: string | undefined,
  messages: RoomMessage[],
  steered?: ReadonlySet<string>
) {
  const [pending, setPending] = useState<RoomPendingSend[]>([])
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // Switching rooms drops every optimistic bubble of the previous room.
  useEffect(() => {
    setPending([])
  }, [roomId])
  // Server echo (or timeout) reconciles the optimistic rows away.
  useEffect(() => {
    setPending((current) => {
      const next = reconcilePendingSends(current, messages, Date.now(), 30000, steered)
      return next.length === current.length &&
        next.every((item, index) => item === current[index])
        ? current
        : next
    })
  }, [messages, steered])
  const patch = useCallback(
    (clientRequestId: string, update: Partial<RoomPendingSend>) => {
      setPending((current) =>
        current.map((item) =>
          item.clientRequestId === clientRequestId ? { ...item, ...update } : item
        )
      )
    },
    []
  )
  const enqueue = useCallback((message: SendRoomMessage): RoomPendingSend => {
    const item: RoomPendingSend = {
      clientRequestId: message.clientRequestId,
      body: message.body,
      message,
      createdAt: new Date().toISOString(),
      state: 'sending'
    }
    setPending((current) =>
      current.some((entry) => entry.clientRequestId === item.clientRequestId)
        ? current.map((entry) =>
            entry.clientRequestId === item.clientRequestId
              ? { ...item, state: 'sending', error: undefined }
              : entry
          )
        : [...current, item]
    )
    return item
  }, [])
  const markSent = useCallback(
    (clientRequestId: string) => patch(clientRequestId, { state: 'sent' }),
    [patch]
  )
  const markFailed = useCallback(
    (clientRequestId: string, error: string) =>
      patch(clientRequestId, { state: 'failed', error }),
    [patch]
  )
  const retry = useCallback(
    (clientRequestId: string): SendRoomMessage | undefined => {
      if (!mounted.current) return undefined
      return pending.find((item) => item.clientRequestId === clientRequestId)
        ?.message
    },
    [pending]
  )
  const dismiss = useCallback((clientRequestId: string) => {
    setPending((current) =>
      current.filter((item) => item.clientRequestId !== clientRequestId)
    )
  }, [])
  const hasUnsettled = pending.some((item) => item.state !== 'failed')
  return { pending, enqueue, markSent, markFailed, retry, dismiss, hasUnsettled }
}
