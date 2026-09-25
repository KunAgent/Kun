import { peerBudgetMember } from '../agents/agent-discussion-scope.js'
import { roomPeerDiscussionPrompt, roomPollInvitationPrompt } from './room-ax-surfaces.js'
import { randomUUID } from 'node:crypto'
import type { RoomMember, RoomMessage } from '../contracts/rooms.js'
import type { RoomRuntimeDeps, RoomRequestState } from './room-runtime-types.js'
import type { RoomPeerUpdates } from './room-peer-types.js'
import { boundedRoomText, roomContext, roomContextBudget } from './room-context.js'
import { roomDiscussionContext } from './room-discussion-evidence.js'
import { uniqueRoomReplyTrigger } from './room-replies.js'

export type RoomPeerTurnContext = {
  id: string
  roomId: string
  rootRequestId: string
  memberId: string
  prompt: string
  attachmentIds: string[]
  itemIds: string[]
  publicationRevision: number
  generation: number
  triageInput?: unknown
  replyToMessageId?: string
  displayThreadRootId?: string
}

/** Freeze the precise supplied prefix before recording its admission identity. */
export async function prepareRoomPeerContext(deps: RoomRuntimeDeps, updates: RoomPeerUpdates,
  member: RoomMember): Promise<RoomPeerTurnContext> {
  const topic = updates.topic.value
  const row = await deps.store.get<RoomRequestState>('request', topic.requestId)
  if (!row || row.roomId !== topic.roomId) throw new Error('room topic request not found')
  const request = row.value
  const budget = roomContextBudget(deps, request)
  const background = roomDiscussionContext(request, await roomContext(deps, request), budget)
  const selected = updates.items.slice(0, 12)
  const recent = await deps.store.list<RoomMessage>('message', {
    roomId: topic.roomId, rootRequestId: topic.rootRequestId, limit: 6
  })
  const reference = {
    authority: 'reference_only', ...background,
    topicHistory: [...recent].reverse().filter((item) => item.value.status === 'final').map((item) => ({
      messageId: item.id, bodyRevision: item.value.bodyRevision, authorMemberId: item.value.authorMemberId,
      body: boundedRoomText(item.value.body, 1000), truncated: Buffer.byteLength(item.value.body) > 1000
    })),
    updates: selected.map((item) => ({
      inboxId: item.id, sourceId: item.value.sourceId, sourceRevision: item.value.sourceRevision,
      kind: item.value.sourceKind, authorMemberId: item.value.authorMemberId,
      body: boundedRoomText(item.value.body, 1500),
      truncated: Buffer.byteLength(item.value.body) > 1500
    }))
  }
  const bytes = () => Buffer.byteLength(JSON.stringify(reference))
  while (bytes() > budget && reference.context.messages.length) {
    reference.context.messages.shift()
    reference.context.truncated = true
  }
  while (bytes() > budget && reference.context.summary) {
    reference.context.summary = boundedRoomText(reference.context.summary,
      Math.max(0, Buffer.byteLength(reference.context.summary) - 256))
    reference.context.truncated = true
  }
  while (bytes() > budget && reference.topicHistory.length) reference.topicHistory.shift()
  while (bytes() > budget && reference.updates.length > 1) reference.updates.pop()
  while (bytes() > budget && reference.updates[0]?.body.length) {
    const item = reference.updates[0]
    item.body = boundedRoomText(item.body, Math.max(0, Buffer.byteLength(item.body) - 256))
    item.truncated = true
  }
  if (bytes() > budget) throw new Error('Room agreements leave no room for the pending topic update')
  // A classifier sees data, including its own recent contributions. Do not
  // truncate the response turn's serialized prompt mid-JSON or spend its input
  // budget on tool instructions before reaching the actual pending updates.
  const triageInput = {
    userQuestion: boundedRoomText(request.message.body, 1500),
    recentResponses: reference.topicHistory,
    pendingUpdates: reference.updates.map((item) => ({ ...item, body: boundedRoomText(item.body, 500) }))
  }
  while (Buffer.byteLength(JSON.stringify(triageInput)) > 9000 && triageInput.recentResponses.length) {
    triageInput.recentResponses.shift()
  }
  while (Buffer.byteLength(JSON.stringify(triageInput)) > 9000) {
    const longest = triageInput.pendingUpdates.reduce((a, b) => a.body.length >= b.body.length ? a : b)
    if (!longest.body) throw new Error('Pending room update metadata exceeds the participation budget')
    longest.body = boundedRoomText(longest.body, Math.max(0, Buffer.byteLength(longest.body) - 128))
    longest.truncated = true
  }
  const result: RoomPeerTurnContext = {
    id: 'peer-context-' + randomUUID(), roomId: topic.roomId, rootRequestId: topic.rootRequestId,
    memberId: member.id, generation: topic.generation, publicationRevision: topic.publicationRevision,
    triageInput,
    itemIds: reference.updates.map((item) => item.inboxId), attachmentIds: request.message.attachmentIds,
    prompt: roomPeerDiscussionPrompt({
      pollInvitationLine: roomPollInvitationPrompt(request.pollInvitation, member.id),
      member: { ...member, presetSnapshot: undefined },
      currentUserRequest: request.message,
      topic: { rootRequestId: topic.rootRequestId, generation: topic.generation, publicationRevision: topic.publicationRevision,
        responsesRemaining: 32 - topic.responseCount, memberResponsesRemaining: 8 - (topic.memberResponses[peerBudgetMember(topic, member.id)] ?? 0) },
      reference
    })
  }
  const displayReply = reference.updates.some((item) => item.kind === 'task') ? { checks: [] } :
    await uniqueRoomReplyTrigger(deps.store, topic.roomId, reference.updates.map((item) => item.sourceId))
  if ('replyToMessageId' in displayReply) {
    result.replyToMessageId = displayReply.replyToMessageId
    result.displayThreadRootId = displayReply.displayThreadRootId
  }
  await deps.store.commit({ requestId: result.id,
    checks: [{ kind: 'context', id: result.id, expectedRevision: null }],
    puts: [{ kind: 'context', id: result.id, roomId: result.roomId, value: result }], result: { id: result.id } })
  return result
}
