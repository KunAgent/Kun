import { RoomMessageSchema, type Room, type RoomMessage } from '../contracts/rooms.js'
import type { RoomStoreCommit } from './room-store.js'
import { appendPeerInbox, peerId, peerInboxRows } from './room-peer-inbox.js'
import { peerFingerprint, retryPeerConflict, type RoomPeerStore } from './room-peer-state.js'
import type { RoomPeerPublishInput, RoomPeerPublishResult, RoomPeerRequestInput, RoomPeerInboxItem } from './room-peer-types.js'

/** Publication is the only peer output boundary: no unfinished model text enters the room. */
export async function publishPeerMessage(peer: RoomPeerStore, input: RoomPeerPublishInput): Promise<RoomPeerPublishResult> {
  const receiptId = peerId('publish', input.clientRequestId)
  const fingerprint = peerFingerprint(input)
  return retryPeerConflict(async () => {
    const receipt = await peer.store.getRequest(receiptId)
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw new Error('peer publication identity reused with different content')
      return { ...(receipt.result as RoomPeerPublishResult), status: 'duplicate' }
    }
    const topic = await peer.topic(input.rootRequestId)
    const member = await peer.member(input.rootRequestId, input.memberId)
    const activation = member?.value.activation
    if (!topic || !member || !activation || activation.clientRequestId !== input.activationClientRequestId) return { status: 'stale' }
    if (activation.phase !== 'respond') throw new Error('peer triage cannot publish a response')
    if (['stopping', 'stopped'].includes(topic.value.status) ||
      (topic.value.status === 'paused' && topic.value.pauseReason !== 'budget_exhausted')) return { status: 'stopped' }
    if (activation.generation !== topic.value.generation) return { status: 'stale' }
    const root = await peer.store.get<RoomPeerRequestInput>('request', input.rootRequestId)
    const request = root?.id === topic.value.requestId ? root :
      await peer.store.get<RoomPeerRequestInput>('request', topic.value.requestId)
    if (!root || !request || (root.value.peerLatestRequestId ?? root.id) !== topic.value.requestId) return { status: 'stale' }
    if (request.value.cancellationRequested || ['cancelled', 'stopping', 'recovery_required'].includes(request.value.status)) return { status: 'stopped' }
    const room = await peer.store.get<Room>('room', topic.value.roomId)
    if (!room || room.value.archivedAt || !room.value.members.some((value) =>
      value.id === input.memberId && value.enabled && !value.removedAt)) return { status: 'stopped' }
    // A source can change before the event bridge advances publicationRevision.
    // Check only the newest supplied version per source; older versions may coexist in the same input prefix.
    const sources = new Map<string, number>()
    for (const seen of activation.seenItems) {
      const item = await peer.store.get<RoomPeerInboxItem>('peer_inbox', seen.id)
      if (!item || item.value.rootRequestId !== input.rootRequestId || item.value.memberId !== input.memberId ||
        item.value.sourceId !== seen.sourceId || item.value.sourceRevision !== seen.sourceRevision) return { status: 'stale' }
      if (item.value.sourceKind !== 'task') sources.set(seen.sourceId,
        Math.max(sources.get(seen.sourceId) ?? -1, seen.sourceRevision))
    }
    const sourceChecks: NonNullable<RoomStoreCommit['checks']> = []
    for (const [sourceId, revision] of sources) {
      const source = await peer.store.get<RoomMessage>('message', sourceId)
      if (!source || source.roomId !== topic.value.roomId || source.value.rootRequestId !== input.rootRequestId ||
        source.value.status !== 'final' || source.value.bodyRevision !== revision) return { status: 'stale' }
      sourceChecks.push({ kind: 'message', id: source.id, expectedRevision: source.revision })
    }
    const sender = topic.value.roomSnapshot.members.find((value) => value.id === input.memberId && value.enabled && !value.removedAt)
    if (!sender) return { status: 'stopped' }
    const mentions = [...new Set(input.mentionMemberIds ?? [])]
    const invites = [...new Set([...mentions, ...(input.inviteMemberIds ?? [])])]
    const available = new Set(topic.value.roomSnapshot.members.filter((value) => value.enabled && !value.removedAt &&
      room.value.members.some((current) => current.id === value.id && current.enabled && !current.removedAt)).map((value) => value.id))
    if ([...mentions, ...invites].some((id) => !available.has(id))) throw new Error('peer recipient is unavailable in this topic')
    if (input.replyToMessageId) {
      const reply = await peer.store.get<RoomMessage>('message', input.replyToMessageId)
      if (!reply || reply.roomId !== topic.value.roomId || reply.value.rootRequestId !== input.rootRequestId) {
        throw new Error('peer reply must refer to this topic')
      }
    }
    const contentId = peerId('content', input.rootRequestId, activation.generation,
      activation.basePublicationRevision, input.replyToMessageId ?? null, [...invites].sort(), input.body)
    const content = await peer.store.get<{ messageId: string }>('peer_publication', contentId)
    if (content) {
      const message = await peer.store.get<RoomMessage>('message', content.value.messageId)
      await peer.skip(input.rootRequestId, input.memberId, input.activationClientRequestId)
      return { status: 'duplicate', message: message?.value }
    }
    if (activation.basePublicationRevision !== topic.value.publicationRevision) return { status: 'stale' }
    const now = new Date().toISOString()
    const message = RoomMessageSchema.parse({ id: peerId('message', input.clientRequestId),
      roomId: topic.value.roomId, rootRequestId: input.rootRequestId, sourceRequestId: topic.value.requestId,
      messageSeq: 1, status: 'final', authorKind: 'member', authorMemberId: input.memberId,
      authorLabelSnapshot: sender.displayName, body: input.body, bodyRevision: 0,
      mentionMemberIds: [...new Set([...mentions, ...invites])], replyToMessageId: input.replyToMessageId,
      attachmentIds: [], createdAt: now })
    if (!message.body.trim()) throw new Error('peer message requires text')
    const handled = Math.max(member.value.handledInboxSeq, activation.seenThroughSeq)
    const pending = (await peerInboxRows(peer.store, input.rootRequestId, input.memberId, handled, topic.value.generation)).length > 0
    const nextTopic = { ...topic.value, publicationRevision: topic.value.publicationRevision + 1,
      memberIds: [...new Set([...topic.value.memberIds, ...invites])], updatedAt: now }
    const result: RoomPeerPublishResult = { status: 'published', message }
    const commit: RoomStoreCommit = { requestId: receiptId, fingerprint,
      checks: [{ kind: 'peer_topic', id: topic.id, expectedRevision: topic.revision },
        { kind: 'peer_member', id: member.id, expectedRevision: member.revision },
        { kind: 'request', id: root.id, expectedRevision: root.revision },
        { kind: 'room', id: room.id, expectedRevision: room.revision },
        ...(request.id !== root.id ? [{ kind: 'request' as const, id: request.id, expectedRevision: request.revision }] : []),
        { kind: 'message', id: message.id, expectedRevision: null },
        { kind: 'peer_publication', id: contentId, expectedRevision: null }],
      puts: [{ kind: 'peer_topic', id: topic.id, roomId: topic.roomId, value: nextTopic },
        { kind: 'peer_member', id: member.id, roomId: topic.roomId, value: { ...member.value,
          activation: undefined, handledInboxSeq: handled, state: pending ? 'pending' : 'idle', updatedAt: now } },
        { kind: 'message', id: message.id, roomId: topic.roomId, value: message },
        { kind: 'peer_publication', id: contentId, roomId: topic.roomId, value: {
          rootRequestId: input.rootRequestId, memberId: input.memberId, messageId: message.id } }],
      events: [{ roomId: topic.value.roomId, kind: 'message.created', payload: { id: message.id, rootRequestId: input.rootRequestId } },
        { roomId: topic.value.roomId, kind: 'peer.topic.updated', payload: { rootRequestId: input.rootRequestId } },
        { roomId: topic.value.roomId, kind: 'peer.member.updated', payload: { rootRequestId: input.rootRequestId, memberId: input.memberId } }], result }
    commit.checks!.push(...sourceChecks)
    const recipients = nextTopic.memberIds.filter((id) => id !== input.memberId)
    await appendPeerInbox(peer.store, commit, nextTopic, recipients.filter((id) => !invites.includes(id)), {
      sourceKind: 'message', sourceId: message.id, sourceRevision: message.bodyRevision,
      messageId: message.id, causeId: activation.clientRequestId, body: message.body, authorMemberId: input.memberId
    })
    await appendPeerInbox(peer.store, commit, nextTopic, invites.filter((id) => id !== input.memberId), {
      sourceKind: 'invitation', sourceId: message.id, sourceRevision: message.bodyRevision,
      messageId: message.id, causeId: activation.clientRequestId, body: message.body, authorMemberId: input.memberId
    })
    await peer.store.commit(commit)
    return result
  })
}
