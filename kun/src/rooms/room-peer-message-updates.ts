import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomStoreCommit } from './room-store.js'
import { RoomPeerStore, peerFingerprint, retryPeerConflict } from './room-peer-state.js'
import { appendPeerInbox, peerId, peerMessageRecipients } from './room-peer-inbox.js'

/** Only finalized revisions of this generation's published member messages can wake peers. */
export async function deliverPeerMessageUpdate(peer: RoomPeerStore, roomId: string, messageId: string): Promise<void> {
  await retryPeerConflict(async () => {
    const message = await peer.store.get<RoomMessage>('message', messageId)
    const value = message?.value
    if (!message || message.roomId !== roomId || value?.authorKind !== 'member' || value.status !== 'final' ||
      !value.rootRequestId || !value.sourceRequestId || value.bodyRevision === 0) return
    const topic = await peer.topic(value.rootRequestId)
    if (!topic || topic.roomId !== roomId || !['active', 'idle'].includes(topic.value.status) ||
      topic.value.requestId !== value.sourceRequestId || !await peer.current(topic)) return
    const id = peerId('message-revision', value.rootRequestId, topic.value.generation, messageId, value.bodyRevision)
    if (await peer.store.getRequest(id)) return
    const next = { ...topic.value, status: 'active' as const,
      publicationRevision: topic.value.publicationRevision + 1, updatedAt: new Date().toISOString() }
    const commit: RoomStoreCommit = { requestId: id, fingerprint: peerFingerprint([roomId, messageId, value.bodyRevision]),
      checks: [{ kind: 'peer_topic', id: topic.id, expectedRevision: topic.revision },
        { kind: 'message', id: message.id, expectedRevision: message.revision }],
      puts: [{ kind: 'peer_topic', id: topic.id, roomId, value: next }],
      events: [{ roomId, kind: 'peer.topic.updated', payload: { rootRequestId: topic.id } }] }
    const recipients = topic.value.memberIds.filter((memberId) => memberId !== value.authorMemberId)
    const mentions = new Set(value.mentionMemberIds)
    for (const sourceKind of ['message', 'invitation'] as const) {
      const candidates = recipients.filter((memberId) => mentions.has(memberId) === (sourceKind === 'invitation'))
      await appendPeerInbox(peer.store, commit, next,
        sourceKind === 'message' ? peerMessageRecipients(topic.value.roomSnapshot, candidates) : candidates, {
        sourceKind, sourceId: message.id, sourceRevision: value.bodyRevision, messageId: message.id,
        causeId: id, body: value.body, authorMemberId: value.authorMemberId
      })
    }
    await peer.store.commit(commit)
  })
}
