import { RoomMessageSchema } from '../contracts/rooms.js'
import { CreateRoomPollSchema, RoomPollSchema, RoomPollVoteSchema, RoomPollActionSchema, type RoomPoll } from '../contracts/room-interactions.js'
import type { RoomStore, RoomStoreCommit } from './room-store.js'
import { RoomStoreConflictError } from './room-store.js'
import { interactionId, interactionFingerprint, interactionReplay, interactionRoom, retryRoomInteraction } from './room-interaction-store.js'
import { prepareRoomReplyContext } from './room-replies.js'

export function currentRoomPoll(poll: RoomPoll, now = Date.now()): RoomPoll {
  return poll.state === 'open' && poll.closesAt && Date.parse(poll.closesAt) <= now ? { ...poll, state: 'expired' } : poll
}
export async function readRoomPoll(store: RoomStore, roomId: string, pollId: string): Promise<RoomPoll> {
  const row = await store.get<RoomPoll>('room_poll', pollId)
  if (!row || row.roomId !== roomId) throw new Error('room poll not found')
  return currentRoomPoll({ ...row.value, revision: row.revision })
}
export function assertRoomPollOpen(poll: RoomPoll): void {
  if (currentRoomPoll(poll).state !== 'open') throw new RoomStoreConflictError('poll is closed or expired')
}
export async function createRoomPoll(store: RoomStore, roomId: string, input: unknown) {
  const body = CreateRoomPollSchema.parse(input)
  const receipt = interactionId('poll-create', roomId, body.clientRequestId)
  const fingerprint = interactionFingerprint(body)
  const replay = await interactionReplay<{ poll: RoomPoll; messageId: string }>(store, receipt, fingerprint)
  if (replay) return replay
  const room = await interactionRoom(store, roomId)
  if (body.closesAt && Date.parse(body.closesAt) <= Date.now()) throw new RoomStoreConflictError('poll deadline must be in the future')
  const reply = await prepareRoomReplyContext(store, roomId, body.replyToMessageId)
  const pollId = interactionId('poll', roomId, body.clientRequestId), messageId = interactionId('poll-message', pollId)
  const now = new Date().toISOString()
  const poll = RoomPollSchema.parse({ pollId, roomId, messageId, question: body.question,
    options: body.options.map((label, index) => ({ id: 'option-' + (index + 1), label })), multiple: body.multiple,
    closesAt: body.closesAt, state: 'open', createdAt: now, revision: 0, ballots: {} })
  const message = RoomMessageSchema.parse({ id: messageId, roomId, messageSeq: 1, body: body.question,
    authorKind: 'user', authorLabelSnapshot: 'You', bodyRevision: 0, status: 'final',
    presentationKind: 'poll', pollId, mentionMemberIds: [], attachmentIds: [], createdAt: now,
    replyToMessageId: reply.replyToMessageId, displayThreadRootId: reply.displayThreadRootId, rootRequestId: reply.rootRequestId })
  const result = { poll, messageId }
  await store.commit({ requestId: receipt, fingerprint,
    checks: [{ kind: 'room', id: roomId, expectedRevision: room.revision }, ...reply.checks,
      { kind: 'room_poll', id: pollId, expectedRevision: null }, { kind: 'message', id: messageId, expectedRevision: null }],
    puts: [{ kind: 'room_poll', id: pollId, roomId, value: poll }, { kind: 'message', id: messageId, roomId, value: message }],
    events: [{ roomId, kind: 'message.presentation.created', payload: { id: messageId, presentationKind: 'poll' } },
      { roomId, kind: 'room.poll.updated', payload: { pollId, messageId } }], result })
  return result
}

export function validateRoomBallot(poll: RoomPoll, optionIds: string[]): string[] {
  const ids = [...new Set(optionIds)].sort()
  if (ids.length !== optionIds.length || ids.some((id) => !poll.options.some((option) => option.id === id)) ||
    (!poll.multiple && ids.length > 1)) throw new RoomStoreConflictError('invalid poll selection')
  return ids
}
export type RoomPollActor = { id: string; memberId?: string; requestId?: string; threadId?: string; turnId?: string }
export async function commitRoomPollVote(store: RoomStore, roomId: string, pollId: string, input: unknown,
  actor: RoomPollActor = { id: 'local-user' }, authorize?: (commit: RoomStoreCommit) => Promise<void>): Promise<RoomPoll> {
  const body = RoomPollVoteSchema.parse(input)
  const receipt = interactionId('poll-vote', roomId, pollId, actor.id, body.clientRequestId)
  const fingerprint = interactionFingerprint({ body, actor })
  return retryRoomInteraction(async () => {
    const replay = await interactionReplay<RoomPoll>(store, receipt, fingerprint)
    if (replay) return replay
    const room = await interactionRoom(store, roomId)
    const row = await store.get<RoomPoll>('room_poll', pollId)
    if (!row || row.roomId !== roomId) throw new Error('room poll not found')
    const poll = currentRoomPoll(row.value)
    assertRoomPollOpen(poll)
    const optionIds = validateRoomBallot(poll, body.optionIds)
    const now = new Date().toISOString()
    const { id: _id, ...origin } = actor
    const ballots = { ...poll.ballots }
    if (optionIds.length) ballots[actor.id] = { optionIds, updatedAt: now, ...origin }
    else delete ballots[actor.id]
    const result = { ...poll, ballots, revision: row.revision + 1 }
    const commit: RoomStoreCommit = { requestId: receipt, fingerprint,
      checks: [{ kind: 'room', id: roomId, expectedRevision: room.revision }, { kind: 'room_poll', id: pollId, expectedRevision: row.revision }],
      puts: [{ kind: 'room_poll', id: pollId, roomId, value: result }],
      events: [{ roomId, kind: 'room.poll.updated', payload: { pollId, messageId: poll.messageId } }], result }
    await authorize?.(commit)
    await store.commit(commit)
    return result
  })
}
export async function closeRoomPoll(store: RoomStore, roomId: string, pollId: string, input: unknown): Promise<RoomPoll> {
  const body = RoomPollActionSchema.parse(input), receipt = interactionId('poll-close', roomId, pollId, body.clientRequestId)
  const fingerprint = interactionFingerprint(body)
  return retryRoomInteraction(async () => {
    const replay = await interactionReplay<RoomPoll>(store, receipt, fingerprint)
    if (replay) return replay
    const room = await interactionRoom(store, roomId)
    const row = await store.get<RoomPoll>('room_poll', pollId)
    if (!row || row.roomId !== roomId) throw new Error('room poll not found')
    const poll = currentRoomPoll(row.value)
    const result = { ...poll, state: poll.state === 'expired' ? 'expired' as const : 'closed' as const,
      closedAt: poll.closedAt ?? new Date().toISOString(), revision: row.revision + 1 }
    await store.commit({ requestId: receipt, fingerprint,
      checks: [{ kind: 'room', id: roomId, expectedRevision: room.revision }, { kind: 'room_poll', id: pollId, expectedRevision: row.revision }],
      puts: [{ kind: 'room_poll', id: pollId, roomId, value: result }],
      events: [{ roomId, kind: 'room.poll.updated', payload: { pollId, messageId: poll.messageId } }], result })
    return result
  })
}
