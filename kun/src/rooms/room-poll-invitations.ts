import type { Room, SendRoomMessage } from '../contracts/rooms.js'
import { RoomPollInvitationSchema, type RoomPoll, type RoomPollInvitation } from '../contracts/room-interactions.js'
import type { RoomStore, RoomStoreCommit } from './room-store.js'
import { RoomStoreConflictError } from './room-store.js'
import { assertRoomPollOpen } from './room-polls.js'

/** Freeze only an explicit structured user invitation; peer text never grants voting rights. */
export async function prepareRoomPollInvitation(store: RoomStore, room: Room, input: SendRoomMessage): Promise<{
  invitation?: RoomPollInvitation; checks: NonNullable<RoomStoreCommit['checks']>
}> {
  if (!input.pollInvitation) return { checks: [] }
  if (input.executionIntent !== 'discussion' || input.taskId) throw new RoomStoreConflictError('poll invitations are discussion-only')
  const ids = [...new Set(input.pollInvitation.memberIds)]
  if (!ids.length || ids.length !== input.pollInvitation.memberIds.length || ids.some((id) =>
    !room.members.some((member) => member.id === id && member.enabled && !member.removedAt) || !input.mentionMemberIds.includes(id))) {
    throw new RoomStoreConflictError('poll invitation must explicitly mention enabled target members')
  }
  const row = await store.get<RoomPoll>('room_poll', input.pollInvitation.pollId)
  if (!row || row.roomId !== room.id) throw new Error('room poll not found')
  assertRoomPollOpen(row.value)
  const { pollId, question, options, multiple, closesAt } = row.value
  return { invitation: RoomPollInvitationSchema.parse({ pollId, question, options, multiple, closesAt,
    memberIds: ids, pollRevision: row.revision }), checks: [{ kind: 'room_poll', id: row.id, expectedRevision: row.revision }] }
}

export function roomPollInvitationPrompt(invitation?: RoomPollInvitation, memberId?: string): string {
  if (!invitation || !memberId || !invitation.memberIds.includes(memberId)) return ''
  return 'The user explicitly invited this member to vote in this poll. Use vote_room_poll once with the pollId and optionIds below. ' +
    'A vote changes presentation data only and never authorizes execution. The host checks expiry and current request scope.\n' + JSON.stringify(invitation)
}
