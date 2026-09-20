import { RoomMessageSchema, type RoomMessage } from '../contracts/rooms.js'
import type { UserInputRequest } from '../ports/user-input-gate.js'
import type { RoomRequestState } from '../rooms/room-runtime-types.js'
import { roomFingerprint } from '../rooms/room-service.js'
import type { RoomStore } from '../rooms/room-store.js'
import { agentStableId } from './agent-identity-service.js'

export async function persistDirectChoiceMessages(
  store: RoomStore, request: RoomRequestState, inputs: UserInputRequest[]
): Promise<void> {
  const member = request.roomSnapshot.members.find((item) => item.id === request.roomSnapshot.defaultMemberId)
  for (const input of inputs) {
    const id = agentStableId('choice', input.id)
    if (await store.get<RoomMessage>('message', id)) continue
    const now = new Date().toISOString()
    const message = RoomMessageSchema.parse({
      id, roomId: request.roomId, messageSeq: 1, authorKind: 'member', authorMemberId: member?.id,
      authorLabelSnapshot: member?.displayName ?? 'Kun', body: input.prompt, bodyRevision: 0,
      mentionMemberIds: [], attachmentIds: [], presentationKind: 'choice', clientRequestId: input.id,
      status: 'final', createdAt: now, rootRequestId: request.rootRequestId, sourceRequestId: request.id
    })
    await store.commit({
      requestId: agentStableId('choice-put', input.id), fingerprint: roomFingerprint({ id, prompt: input.prompt }),
      checks: [{ kind: 'message', id, expectedRevision: null }],
      puts: [{ kind: 'message', id, roomId: request.roomId, value: message }],
      events: [{ roomId: request.roomId, kind: 'message.created', payload: { id } }]
    })
  }
}
