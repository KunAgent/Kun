import { useEffect, useState } from 'react'
import type { RoomMessage } from '@shared/rooms-api'

/** How long a just-sent message keeps the receipt up when nobody starts responding. */
export const ROOM_REPLY_AWAIT_TIMEOUT_MS = 20000

/**
 * Bridges the gap between "message echoed back" and "a member reports it is
 * responding" so a chat never goes silent right after sending. Cleared once a
 * member is busy, a new member reply lands, or the timeout passes.
 */
export function useRoomReplyAwaiting(busy: boolean, messages: RoomMessage[]) {
  // Compare reply ids, not timestamps: a remote phone clock is not the desktop clock.
  const [baseline, setBaseline] = useState<{ replyId: string | null } | null>(null)
  const replyId = latestReplyId(messages)
  const replied = baseline !== null && replyId !== baseline.replyId
  useEffect(() => {
    if (baseline !== null && (busy || replied)) setBaseline(null)
  }, [busy, replied, baseline])
  useEffect(() => {
    if (baseline === null) return
    const timer = setTimeout(() => setBaseline(null), ROOM_REPLY_AWAIT_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [baseline])
  return { awaiting: baseline !== null && !replied, markSent: () => setBaseline({ replyId }) }
}

export function latestReplyId(messages: RoomMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].authorKind === 'member') return messages[index].id
  }
  return null
}
