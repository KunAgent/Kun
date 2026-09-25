import { peerBudgetMember } from '../agents/agent-discussion-scope.js'
import { appendPeerActivationRun, appendPeerRunOutcome } from './room-peer-run-recording.js'
import { createHash } from 'node:crypto'
import type { Room, RoomMessage } from '../contracts/rooms.js'
import type { RoomStore, RoomStoreCommit, RoomStoredDocument } from './room-store.js'
import { RoomStoreConflictError } from './room-store.js'
import { appendPeerInbox, emptyPeerMember, peerId, peerInboxRows, peerMemberId } from './room-peer-inbox.js'
import { publishPeerMessage } from './room-peer-publication.js'
import { ROOM_PEER_HOLD_LIMITS, ROOM_PEER_LIMITS, type RoomPeerActivation, type RoomPeerBeginInput,
  type RoomPeerMemberState, type RoomPeerPublishInput, type RoomPeerRequestInput, type RoomPeerTopic,
  type RoomPeerUpdates } from './room-peer-types.js'

type TopicRow = RoomStoredDocument<RoomPeerTopic>
type MemberRow = RoomStoredDocument<RoomPeerMemberState>

export async function retryPeerConflict<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation() } catch (error) {
      if (!(error instanceof RoomStoreConflictError) || attempt >= 2) throw error
    }
  }
}

export class RoomPeerStore {
  constructor(readonly store: RoomStore) {}

  topic(rootId: string): Promise<TopicRow | null> { return this.store.get('peer_topic', rootId) }
  async topics(roomId?: string): Promise<TopicRow[]> {
    const rows: TopicRow[] = []
    for (;;) {
      const page = await this.store.list<RoomPeerTopic>('peer_topic', { roomId,
        status: ['active', 'idle', 'paused', 'stopping'], order: 'asc', afterSeq: rows.at(-1)?.seq, limit: 200 })
      rows.push(...page)
      if (page.length < 200) return rows
    }
  }
  member(rootId: string, memberId: string): Promise<MemberRow | null> {
    return this.store.get('peer_member', peerMemberId(rootId, memberId))
  }
  members(rootId: string): Promise<MemberRow[]> {
    return this.store.list('peer_member', { rootRequestId: rootId, order: 'asc', limit: 1000 })
  }

  async initialize(request: RoomPeerRequestInput): Promise<TopicRow | null> {
    if (request.collaborationProtocol !== 'peer') return null
    return retryPeerConflict(async () => {
      const rootId = request.rootRequestId ?? request.id
      const receiptId = peerId('initialize', request.id)
      if (await this.store.getRequest(receiptId)) return this.topic(rootId)
      const root = await this.store.get<RoomPeerRequestInput>('request', rootId)
      if (!root || root.roomId !== request.roomId ||
        (root.value.peerLatestRequestId ?? root.id) !== request.id) return null
      const source = await this.store.get<RoomMessage>('message', request.sourceMessageId)
      if (!source || source.roomId !== request.roomId || source.value.status !== 'final' ||
        source.value.rootRequestId !== rootId) throw new Error('peer request source is unavailable')
      const old = await this.topic(rootId)
      const now = new Date().toISOString()
      const memberIds = request.roomSnapshot.members.filter((member) => member.enabled && !member.removedAt).map((member) => member.id)
      const topic: RoomPeerTopic = { roomId: request.roomId, rootRequestId: rootId,
        requestId: request.id, sourceMessageId: request.sourceMessageId, title: request.message.body.slice(0, 160),
        generation: (old?.value.generation ?? 0) + 1, publicationRevision: old?.value.publicationRevision ?? 0,
        status: 'active', responseCount: 0, triageCount: 0, memberResponses: {}, memberIds,
        roomSnapshot: request.roomSnapshot, createdAt: old?.value.createdAt ?? now, updatedAt: now }
      const commit: RoomStoreCommit = { requestId: receiptId, fingerprint: peerFingerprint(request.id),
        checks: [{ kind: 'request', id: rootId, expectedRevision: root.revision },
          { kind: 'peer_topic', id: rootId, expectedRevision: old?.revision ?? null }],
        puts: [{ kind: 'peer_topic', id: rootId, roomId: request.roomId, value: topic }],
        events: [{ roomId: request.roomId, kind: 'peer.topic.updated', payload: { rootRequestId: rootId } }] }
      for (const memberId of memberIds) {
        const member = await this.member(rootId, memberId)
        const state = member?.value ?? emptyPeerMember(topic, memberId)
        commit.checks!.push({ kind: 'peer_member', id: peerMemberId(rootId, memberId), expectedRevision: member?.revision ?? null })
        commit.puts!.push({ kind: 'peer_member', id: peerMemberId(rootId, memberId), roomId: request.roomId,
          value: { ...state, generation: topic.generation, state: state.activation ? state.state : 'pending',
            lastError: undefined, retryAt: undefined, retryCount: 0, waitingReason: undefined, updatedAt: now } })
      }
      const mentioned = new Set(request.message.mentionMemberIds)
      await appendPeerInbox(this.store, commit, topic, memberIds.filter((id) => !mentioned.has(id)), {
        sourceKind: 'message', sourceId: source.id, sourceRevision: source.value.bodyRevision,
        messageId: source.id, causeId: request.id, body: source.value.body
      })
      await appendPeerInbox(this.store, commit, topic, memberIds.filter((id) => mentioned.has(id)), {
        sourceKind: 'invitation', sourceId: source.id, sourceRevision: source.value.bodyRevision,
        messageId: source.id, causeId: request.id, body: source.value.body
      })
      await this.store.commit(commit)
      return this.topic(rootId)
    })
  }

  async readUpdates(rootId: string, memberId: string): Promise<RoomPeerUpdates | null> {
    const topic = await this.topic(rootId), member = await this.member(rootId, memberId)
    if (!topic || !member) return null
    const items = await peerInboxRows(this.store, rootId, memberId, member.value.handledInboxSeq, topic.value.generation)
    return { topic, member, items }
  }

  async begin(rootId: string, memberId: string, input: RoomPeerBeginInput): Promise<MemberRow | null> {
    return retryPeerConflict(async () => {
      const receiptId = peerId('begin', input.clientRequestId)
      const receipt = await this.store.getRequest(receiptId)
      if (receipt) {
        if (receipt.fingerprint !== peerFingerprint([rootId, memberId, input])) {
          throw new Error('peer activation identity reused with different input')
        }
        return this.member(rootId, memberId)
      }
      const updates = await this.readUpdates(rootId, memberId)
      if (!updates || updates.member.value.activation || !await this.current(updates.topic, memberId) ||
        !['active', 'idle'].includes(updates.topic.value.status)) return null
      const { topic, member, items } = updates
      if (input.generation !== topic.value.generation || input.basePublicationRevision !== topic.value.publicationRevision) return null
      const selected = items.slice(0, input.itemIds.length)
      if (!selected.length || selected.some((item, index) => item.id !== input.itemIds[index])) {
        throw new Error('peer activation must cover an ordered inbox prefix')
      }
      const nextTopic = this.consumeBudget(topic.value, memberId, input.phase)
      if (!nextTopic) { await this.exhaustBudget(topic, member, input.phase); return null }
      const activation: RoomPeerActivation = { ...input,
        seenItems: selected.map((item) => ({ id: item.id, sourceId: item.value.sourceId,
          sourceRevision: item.value.sourceRevision, seq: item.seq })),
        seenThroughSeq: selected.at(-1)!.seq }
      const next: RoomPeerMemberState = { ...member.value, activation, attempt: input.attempt,
        seenInboxSeq: Math.max(member.value.seenInboxSeq, activation.seenThroughSeq),
        state: input.phase === 'triage' ? 'triaging' : 'responding', lastError: undefined, waitingReason: undefined,
        updatedAt: new Date().toISOString() }
      const commit: RoomStoreCommit = { requestId: receiptId, fingerprint: peerFingerprint([rootId, memberId, input]),
        checks: [{ kind: 'peer_topic', id: rootId, expectedRevision: topic.revision },
          { kind: 'peer_member', id: member.id, expectedRevision: member.revision }],
        puts: [{ kind: 'peer_topic', id: rootId, roomId: topic.roomId, value: nextTopic },
          { kind: 'peer_member', id: member.id, roomId: topic.roomId, value: next }],
        events: [{ roomId: topic.value.roomId, kind: 'peer.member.updated', payload: { rootRequestId: rootId, memberId } }] }
      await appendPeerActivationRun(this.store, commit, topic.value, member.value, activation)
      await this.store.commit(commit)
      return this.member(rootId, memberId)
    })
  }

  async updateActivation(rootId: string, memberId: string, activationClientRequestId: string,
    patch: Partial<Pick<RoomPeerActivation, 'turnId' | 'admissionAttempted' | 'usageSinceSeq' | 'usageBaseline' |
      'phase' | 'contextId' | 'threadId' | 'clientRequestId'>>): Promise<MemberRow | null> {
    return retryPeerConflict(async () => {
      const receiptId = peerId('activation', activationClientRequestId, patch)
      if (await this.store.getRequest(receiptId)) return this.member(rootId, memberId)
      const topic = await this.topic(rootId), member = await this.member(rootId, memberId)
      const active = member?.value.activation
      if (!topic || !member || active?.clientRequestId !== activationClientRequestId) return null
      const promotion = active.phase === 'triage' && patch.phase === 'respond'
      if (patch.phase === 'triage' && active.phase === 'respond') throw new Error('peer response cannot revert to triage')
      if (promotion && (!await this.current(topic, memberId) || topic.value.generation !== active.generation ||
        topic.value.publicationRevision !== active.basePublicationRevision)) return null
      const nextTopic = promotion ? this.consumeBudget(topic.value, memberId, 'respond') : topic.value
      if (!nextTopic) { await this.exhaustBudget(topic, member, 'respond'); return null }
      const next: RoomPeerMemberState = { ...member.value, activation: { ...active, ...patch },
        state: (patch.phase ?? active.phase) === 'respond' ? 'responding' : 'triaging', updatedAt: new Date().toISOString() }
      const commit: RoomStoreCommit = { requestId: receiptId, fingerprint: peerFingerprint([rootId, memberId, activationClientRequestId, patch]),
        checks: [{ kind: 'peer_topic', id: rootId, expectedRevision: topic.revision },
          { kind: 'peer_member', id: member.id, expectedRevision: member.revision }],
        puts: [...(promotion ? [{ kind: 'peer_topic' as const, id: rootId, roomId: topic.roomId, value: nextTopic }] : []),
          { kind: 'peer_member', id: member.id, roomId: topic.roomId, value: next }],
        events: [{ roomId: topic.value.roomId, kind: 'peer.member.updated', payload: { rootRequestId: rootId, memberId } }] }
      if (promotion) await appendPeerActivationRun(this.store, commit, topic.value, member.value, next.activation!)
      await this.store.commit(commit)
      return this.member(rootId, memberId)
    })
  }

  /** Fold the unseen inbox batch into the live draft without spending another response activation. */
  async rebaseActivation(rootId: string, memberId: string, activationClientRequestId: string,
    input: { expectedPublicationRevision: number; itemIds: string[] }): Promise<MemberRow | null> {
    return retryPeerConflict(async () => {
      const receiptId = peerId('rebase', activationClientRequestId, input.expectedPublicationRevision, input.itemIds)
      const fingerprint = peerFingerprint([rootId, memberId, activationClientRequestId, input])
      const receipt = await this.store.getRequest(receiptId)
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new Error('peer rebase identity reused with different input')
        return this.member(rootId, memberId)
      }
      const topic = await this.topic(rootId), member = await this.member(rootId, memberId)
      const activation = member?.value.activation
      if (!topic || !member || !activation || activation.clientRequestId !== activationClientRequestId ||
        activation.phase !== 'respond' || activation.generation !== topic.value.generation ||
        (activation.holds ?? 0) >= ROOM_PEER_HOLD_LIMITS.maxHolds ||
        !(['active', 'idle'].includes(topic.value.status) ||
          topic.value.status === 'paused' && topic.value.pauseReason === 'budget_exhausted') ||
        topic.value.publicationRevision !== input.expectedPublicationRevision ||
        !await this.current(topic, memberId)) return null
      const unseen = await peerInboxRows(this.store, rootId, memberId, activation.seenThroughSeq, topic.value.generation)
      if (unseen.length !== input.itemIds.length || unseen.some((item, index) => item.id !== input.itemIds[index])) return null
      const seenThroughSeq = unseen.at(-1)?.seq ?? activation.seenThroughSeq
      const next: RoomPeerMemberState = { ...member.value,
        activation: { ...activation, basePublicationRevision: input.expectedPublicationRevision,
          holds: (activation.holds ?? 0) + 1, seenThroughSeq,
          seenItems: [...activation.seenItems, ...unseen.map((item) => ({ id: item.id, sourceId: item.value.sourceId,
            sourceRevision: item.value.sourceRevision, seq: item.seq }))] },
        seenInboxSeq: Math.max(member.value.seenInboxSeq, seenThroughSeq), updatedAt: new Date().toISOString() }
      await this.store.commit({ requestId: receiptId, fingerprint,
        checks: [{ kind: 'peer_topic', id: rootId, expectedRevision: topic.revision },
          { kind: 'peer_member', id: member.id, expectedRevision: member.revision }],
        puts: [{ kind: 'peer_member', id: member.id, roomId: topic.roomId, value: next }],
        events: [{ roomId: topic.value.roomId, kind: 'peer.member.updated', payload: { rootRequestId: rootId, memberId } }] })
      return this.member(rootId, memberId)
    })
  }

  publish(input: RoomPeerPublishInput) { return publishPeerMessage(this, input) }

  async skip(rootId: string, memberId: string, activationClientRequestId: string, outcome: 'skipped' | 'duplicate' = 'skipped'): Promise<void> {
    await retryPeerConflict(async () => {
      const topic = await this.topic(rootId), member = await this.member(rootId, memberId)
      const activation = member?.value.activation
      if (!topic || !member || activation?.clientRequestId !== activationClientRequestId) return
      const fresh = activation.generation === topic.value.generation &&
        activation.basePublicationRevision === topic.value.publicationRevision && await this.current(topic)
      const handled = fresh ? Math.max(member.value.handledInboxSeq, activation.seenThroughSeq) : member.value.handledInboxSeq
      const pending = (await peerInboxRows(this.store, rootId, memberId, handled, topic.value.generation)).length > 0
      const commit: RoomStoreCommit = { requestId: peerId('skip', activationClientRequestId),
        fingerprint: peerFingerprint([rootId, memberId, activationClientRequestId]),
        checks: [{ kind: 'peer_topic', id: rootId, expectedRevision: topic.revision },
          { kind: 'peer_member', id: member.id, expectedRevision: member.revision }],
        puts: [{ kind: 'peer_member', id: member.id, roomId: topic.roomId, value: { ...member.value,
          handledInboxSeq: handled, activation: undefined, state: pending ? 'pending' : 'idle', updatedAt: new Date().toISOString() } }],
        events: [{ roomId: topic.value.roomId, kind: 'peer.member.updated', payload: { rootRequestId: rootId, memberId } }] }
      await appendPeerRunOutcome(this.store, commit, member.value, { status: 'completed', outcome: fresh ? outcome : 'stale' })
      await this.store.commit(commit)
    })
  }

  async fail(rootId: string, memberId: string, activationClientRequestId: string, error: string, recovery = false): Promise<void> {
    await retryPeerConflict(async () => {
      const member = await this.member(rootId, memberId)
      if (!member || member.value.activation?.clientRequestId !== activationClientRequestId) return
      const commit: RoomStoreCommit = { requestId: peerId('failed', activationClientRequestId, error, recovery),
        fingerprint: peerFingerprint([rootId, memberId, activationClientRequestId, error, recovery]),
        checks: [{ kind: 'peer_member', id: member.id, expectedRevision: member.revision }],
        puts: [{ kind: 'peer_member', id: member.id, roomId: member.roomId, value: { ...member.value,
          state: recovery ? 'recovery_required' : 'failed', lastError: error.slice(0, 4000),
          updatedAt: new Date().toISOString() } }],
        events: [{ roomId: member.value.roomId, kind: 'peer.member.updated', payload: { rootRequestId: rootId, memberId } }] }
      await appendPeerRunOutcome(this.store, commit, member.value, { status: recovery ? 'recovery_required' : 'failed', outcome: 'failed', error: error.slice(0, 4000) })
      await this.store.commit(commit)
    })
  }

  async stop(rootId: string): Promise<TopicRow | null> {
    return retryPeerConflict(async () => {
      const topic = await this.topic(rootId)
      if (!topic || ['stopping', 'stopped'].includes(topic.value.status)) return topic
      await this.store.commit({ requestId: peerId('stop', rootId, topic.value.generation),
        fingerprint: peerFingerprint([rootId, topic.value.generation]),
        checks: [{ kind: 'peer_topic', id: rootId, expectedRevision: topic.revision }],
        puts: [{ kind: 'peer_topic', id: rootId, roomId: topic.roomId, value: { ...topic.value,
          status: 'stopping', pauseReason: 'user_stopped', generation: topic.value.generation + 1, updatedAt: new Date().toISOString() } }],
        events: [{ roomId: topic.value.roomId, kind: 'peer.topic.updated', payload: { rootRequestId: rootId } }] })
      return this.topic(rootId)
    })
  }

  async deliverTask(rootId: string, input: { id: string; revision: number; body: string; memberId?: string; eventId?: string }): Promise<void> {
    await retryPeerConflict(async () => {
      const topic = await this.topic(rootId)
      if (!topic || !['active', 'idle'].includes(topic.value.status) || !await this.current(topic)) return
      const receiptId = peerId('task-event', rootId, topic.value.generation, input.id, input.revision, input.eventId)
      if (await this.store.getRequest(receiptId)) return
      const commit: RoomStoreCommit = { requestId: receiptId, fingerprint: peerFingerprint(input),
        checks: [{ kind: 'peer_topic', id: rootId, expectedRevision: topic.revision }],
        puts: [{ kind: 'peer_topic', id: rootId, roomId: topic.roomId, value: {
          ...topic.value, status: 'active', publicationRevision: topic.value.publicationRevision + 1, updatedAt: new Date().toISOString() } }] }
      await appendPeerInbox(this.store, commit, topic.value, topic.value.memberIds, {
        sourceKind: 'task', sourceId: input.id, sourceRevision: input.revision, taskId: input.id,
        causeId: input.eventId ?? peerId(input.id, input.revision), body: input.body.slice(0, 16000), authorMemberId: input.memberId
      })
      await this.store.commit(commit)
    })
  }

  async current(topic: TopicRow, memberId?: string): Promise<boolean> {
    const room = await this.store.get<Room>('room', topic.value.roomId)
    if (!room || room.value.archivedAt || (memberId && !room.value.members.some((member) =>
      member.id === memberId && member.enabled && !member.removedAt))) return false
    const root = await this.store.get<RoomPeerRequestInput>('request', topic.value.rootRequestId)
    const request = topic.value.requestId === root?.id ? root : await this.store.get<RoomPeerRequestInput>('request', topic.value.requestId)
    return Boolean(root && request && (root.value.peerLatestRequestId ?? root.id) === topic.value.requestId &&
      !request.value.cancellationRequested && !['cancelled', 'stopping', 'recovery_required'].includes(request.value.status))
  }

  private async exhaustBudget(topic: TopicRow, member: MemberRow, phase: RoomPeerActivation['phase']): Promise<void> {
    if (phase === 'respond' && topic.value.responseCount < ROOM_PEER_LIMITS.responses &&
      (topic.value.memberResponses[peerBudgetMember(topic.value, member.value.memberId)] ?? 0) >= ROOM_PEER_LIMITS.memberResponses) {
      await this.store.commit({ requestId: peerId('member-budget', topic.id, topic.value.generation, member.id),
        fingerprint: peerFingerprint([topic.id, topic.value.generation, member.id]),
        checks: [{ kind: 'peer_topic', id: topic.id, expectedRevision: topic.revision },
          { kind: 'peer_member', id: member.id, expectedRevision: member.revision }],
        puts: [{ kind: 'peer_member', id: member.id, roomId: topic.roomId, value: { ...member.value,
          activation: undefined, state: 'idle', waitingReason: 'member_budget_exhausted', updatedAt: new Date().toISOString() } }],
        events: [{ roomId: topic.value.roomId, kind: 'peer.member.updated', payload: { rootRequestId: topic.id, memberId: member.value.memberId } }] })
      return
    }
    await this.pauseBudget(topic)
  }

  private consumeBudget(topic: RoomPeerTopic, memberId: string, phase: RoomPeerActivation['phase']): RoomPeerTopic | null {
    memberId = peerBudgetMember(topic, memberId)
    const status = topic.status === 'paused' ? 'paused' : 'active'
    if (phase === 'triage') return topic.triageCount >= ROOM_PEER_LIMITS.triages ? null :
      { ...topic, status, triageCount: topic.triageCount + 1, updatedAt: new Date().toISOString() }
    if (topic.responseCount >= ROOM_PEER_LIMITS.responses ||
      (topic.memberResponses[memberId] ?? 0) >= ROOM_PEER_LIMITS.memberResponses) return null
    return { ...topic, status, responseCount: topic.responseCount + 1,
      memberResponses: { ...topic.memberResponses, [memberId]: (topic.memberResponses[memberId] ?? 0) + 1 },
      updatedAt: new Date().toISOString() }
  }

  private async pauseBudget(topic: TopicRow): Promise<void> {
    await this.store.commit({ requestId: peerId('budget', topic.id, topic.revision),
      checks: [{ kind: 'peer_topic', id: topic.id, expectedRevision: topic.revision }],
      puts: [{ kind: 'peer_topic', id: topic.id, roomId: topic.roomId, value: {
        ...topic.value, status: 'paused', pauseReason: 'budget_exhausted', updatedAt: new Date().toISOString() } }],
      events: [{ roomId: topic.value.roomId, kind: 'peer.topic.updated', payload: { rootRequestId: topic.id } }] })
  }
}

// RoomStore fingerprints are SHA-256 hex; peerId intentionally carries a human prefix.
export const peerFingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
