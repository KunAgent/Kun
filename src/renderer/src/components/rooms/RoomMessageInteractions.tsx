import { useCallback, useEffect, useRef, useState } from 'react'
import type { Room, RoomMessage, RoomMessageInteractions as Interactions, RoomMessageReactions } from '@shared/rooms-api'
import { roomPath, roomRequestId, roomsRequest } from './rooms-client'
import { subscribeRoomEvents } from './useRoomEvents'
import { RoomEmojiPicker } from './RoomEmojiPicker'
import { RoomPollCard } from './RoomPollCard'
import './rooms-interactions.css'

export function RoomMessageInteractions({ room, message }: { room: Room; message: RoomMessage; onMember?: (id: string) => void }) {
  const [value, setValue] = useState<Interactions>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const scope = useRef('')
  const base = `${roomPath(room.id)}/messages/${encodeURIComponent(message.id)}`
  scope.current = base
  const merge = useCallback((next: Interactions) => setValue((previous) => !previous ? next : {
    reactions: next.reactions.revision >= previous.reactions.revision ? next.reactions : previous.reactions,
    poll: next.poll && (!previous.poll || next.poll.revision >= previous.poll.revision) ? next.poll : previous.poll
  }), [])
  useEffect(() => {
    const controller = new AbortController()
    setValue(undefined); setError('')
    const load = () => void roomsRequest<Interactions>(base + '/interactions', 'GET', undefined, controller.signal)
      .then((result) => { if (!controller.signal.aborted) merge(result) }).catch((cause) => { if (!controller.signal.aborted && message.pollId) setError(String(cause)) })
    load()
    const off = subscribeRoomEvents((event) => {
      const payload = event.payload as { messageId?: string; pollId?: string } | undefined
      if (event.roomId === room.id && ['room.poll.updated', 'room.reactions.updated'].includes(event.kind) &&
        (payload?.messageId === message.id || payload?.pollId && payload.pollId === message.pollId)) load()
    })
    return () => { controller.abort(); off() }
  }, [base, message.id, message.pollId, room.id, merge])
  const react = async (emoji: string, active: boolean) => {
    setBusy(true); setError('')
    try {
      const reactions = await roomsRequest<RoomMessageReactions>(base + '/reactions', 'PUT', { clientRequestId: roomRequestId(), emoji, active })
      if (scope.current === base) merge({ reactions })
    } catch (cause) { if (scope.current === base) setError(String(cause)) } finally { if (scope.current === base) setBusy(false) }
  }
  return <div className="rooms-message-interactions">
    {value?.poll ? <RoomPollCard room={room} poll={value.poll} onUpdate={(poll) => setValue((previous) => previous ? { ...previous, poll } : previous)} /> : null}
    <div className="rooms-reactions">{value?.reactions.reactions.map((reaction) => <button type="button" key={reaction.emoji} className={reaction.reacted ? 'is-reacted' : ''}
      aria-pressed={reaction.reacted} disabled={busy || Boolean(room.archivedAt)} onClick={() => void react(reaction.emoji, !reaction.reacted)}>{reaction.emoji}<span>{reaction.count}</span></button>)}
      <span className="rooms-reaction-add"><RoomEmojiPicker reactions disabled={busy || Boolean(room.archivedAt)} onChoose={(emoji) => void react(emoji, !value?.reactions.reactions.some((entry) => entry.emoji === emoji && entry.reacted))} /></span>
    </div>
    {error ? <p role="alert" className="rooms-interaction-error">{error}</p> : null}
  </div>
}
