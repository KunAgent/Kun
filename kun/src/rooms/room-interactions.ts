import { interactionId, interactionFingerprint, interactionReplay, interactionRoom, retryRoomInteraction } from './room-interaction-store.js'
import { RoomReactionInputSchema, type RoomMessageReactions, type RoomMessageInteractions } from '../contracts/room-interactions.js'
import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomStore } from './room-store.js'
import { readRoomPoll } from './room-polls.js'

export async function interactionMessage(store: RoomStore, roomId: string, messageId: string) {
  const message = await store.get<RoomMessage>('message', messageId)
  if (!message || message.roomId !== roomId) throw new Error('room message not found')
  return message
}
export async function readRoomMessageInteractions(store: RoomStore, roomId: string, messageId: string): Promise<RoomMessageInteractions> {
  const message = await interactionMessage(store, roomId, messageId)
  const reactions = await store.get<RoomMessageReactions>('room_reactions', interactionId('reactions', roomId, messageId))
  return { reactions: reactions ? { ...reactions.value, revision: reactions.revision } : { roomId, messageId, reactions: [], revision: 0 },
    ...(message.value.pollId ? { poll: await readRoomPoll(store, roomId, message.value.pollId) } : {}) }
}

/** Local-user presentation state. Never change a message revision or emit a message update. */
export async function setRoomMessageReaction(store: RoomStore, roomId: string, messageId: string, input: unknown) {
  const body = RoomReactionInputSchema.parse(input)
  const receipt = interactionId('reaction-request', roomId, messageId, body.clientRequestId)
  const fingerprint = interactionFingerprint(body)
  return retryRoomInteraction(async () => {
    const replay = await interactionReplay<RoomMessageReactions>(store, receipt, fingerprint)
    if (replay) return replay
    const room = await interactionRoom(store, roomId)
    const message = await interactionMessage(store, roomId, messageId)
    const id = interactionId('reactions', roomId, messageId)
    const previous = await store.get<RoomMessageReactions>('room_reactions', id)
    const reactions = (previous?.value.reactions ?? []).filter((entry) => entry.emoji !== body.emoji)
    if (body.active) reactions.push({ emoji: body.emoji, count: 1, reacted: true })
    const result: RoomMessageReactions = { roomId, messageId, reactions, revision: (previous?.revision ?? -1) + 1 }
    await store.commit({ requestId: receipt, fingerprint,
      checks: [{ kind: 'room', id: roomId, expectedRevision: room.revision },
        { kind: 'message', id: messageId, expectedRevision: message.revision },
        { kind: 'room_reactions', id, expectedRevision: previous?.revision ?? null }],
      puts: [{ kind: 'room_reactions', id, roomId, value: result }],
      events: [{ roomId, kind: 'room.reactions.updated', payload: { messageId } }], result })
    return result
  })
}
