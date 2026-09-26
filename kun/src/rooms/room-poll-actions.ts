import { RoomPollInviteSchema, RoomPollActionSchema } from '../contracts/room-interactions.js'
import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomStore } from './room-store.js'
import type { RoomService } from './room-service.js'
import type { RoomRequestState } from './room-runtime-types.js'
import { RoomStoreConflictError } from './room-store.js'
import { readRoomPoll } from './room-polls.js'
import { interactionId } from './room-interaction-store.js'

/** Only these explicit user actions create ordinary discussion requests. */
export async function submitRoomPollAction(input: { store: RoomStore; service: RoomService }, roomId: string,
  pollId: string, action: 'invite' | 'discuss', value: unknown) {
  const invitation = action === 'invite' ? RoomPollInviteSchema.parse(value) : undefined
  const body = invitation ?? RoomPollActionSchema.parse(value)
  const memberIds = invitation ? [...invitation.memberIds].sort() : undefined
  const clientRequestId = interactionId(action === 'invite' ? 'poll-invitation' : 'poll-results', pollId, body.clientRequestId)
  const poll = await readRoomPoll(input.store, roomId, pollId)
  // Results can change after admission. Replay the original frozen user request, not a new summary.
  const receipt = await input.store.getRequest('room-message:' + roomId + ':' + clientRequestId)
  if (receipt) {
    const original = receipt.result as { message: RoomMessage; requestId: string }
    const request = await input.store.get<RoomRequestState>('request', original.requestId)
    if (!request || request.roomId !== roomId || original.message.replyToMessageId !== poll.messageId ||
      (memberIds && (request.value.pollInvitation?.pollId !== pollId ||
        JSON.stringify([...request.value.pollInvitation.memberIds].sort()) !== JSON.stringify(memberIds)))) {
      throw new RoomStoreConflictError('poll action identity reused with different input')
    }
    return original
  }
  if (memberIds) return input.service.send(roomId, { clientRequestId, executionIntent: 'discussion',
    body: 'Please vote in this poll and briefly explain your choice. This is discussion only.\n' +
      poll.question + '\n' + poll.options.map((option) => option.id + ': ' + option.label).join('\n'),
    mentionMemberIds: memberIds, pollInvitation: { pollId, memberIds }, replyToMessageId: poll.messageId })
  const results = poll.options.map((option) => ({ ...option,
    votes: Object.values(poll.ballots).filter((ballot) => ballot.optionIds.includes(option.id)).length }))
  return input.service.send(roomId, { clientRequestId, executionIntent: 'discussion',
    body: 'Discuss these poll results as reference information only; do not implement or change task authorization.\n' +
      JSON.stringify({ question: poll.question, state: poll.state, results }), replyToMessageId: poll.messageId })
}
