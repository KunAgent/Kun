import { z } from 'zod'
import { ParticipantAgentId, type AgentIdentity } from '../contracts/agent-identities.js'
import { RoomIdSchema, RoomMessageSchema, type Room, type RoomMessage } from '../contracts/rooms.js'
import { ResolveRoomProposalSchema, RoomProposalPayloadSchema, RoomProposalSchema,
  type RoomProposal, type RoomProposalEntry, type RoomProposalResultRef } from '../contracts/room-proposals.js'
import type { RoomRule } from '../contracts/rooms-product.js'
import type { RoomStore, RoomStoredDocument } from './room-store.js'
import { RoomStoreConflictError } from './room-store.js'
import { interactionFingerprint, interactionId, interactionReplay, interactionRoom, retryRoomInteraction } from './room-interaction-store.js'
import { prepareRoomReplyContext } from './room-replies.js'

export const ROOM_PROPOSAL_RUN_LIMIT = 2
export const ROOM_PROPOSAL_ROOM_OPEN_LIMIT = 20

/**
 * Durable input for an agent-drafted proposal. The tool derives the identity
 * fields from host-authored context; nothing here performs the proposed action.
 */
export const CreateRoomProposalSchema = z.object({
  clientRequestId: RoomIdSchema,
  payload: RoomProposalPayloadSchema,
  rationale: z.string().trim().min(1).max(1000),
  authorMemberId: RoomIdSchema,
  authorLabelSnapshot: z.string().trim().min(1).max(120),
  authorAgentId: ParticipantAgentId.optional(),
  originRunId: RoomIdSchema,
  originItemId: z.string().min(1).max(256).optional(),
  rootRequestId: RoomIdSchema.optional(),
  sourceRequestId: RoomIdSchema.optional(),
  replyToMessageId: RoomIdSchema.optional()
}).strict()
export type CreateRoomProposal = z.infer<typeof CreateRoomProposalSchema>

export type RoomProposalCreateResult = { proposal: RoomProposal; messageId: string }

export async function readRoomProposal(store: RoomStore, roomId: string, proposalId: string): Promise<RoomProposalEntry> {
  const row = await store.get<RoomProposal>('room_proposal', proposalId)
  if (!row || row.roomId !== roomId) throw new Error('room proposal not found')
  return { ...row.value, revision: row.revision }
}

/**
 * Atomically stores the draft proposal and its presentation message. The
 * events are presentation-only: no member inbox, budget, or wake-up is spent.
 */
export async function createRoomProposal(store: RoomStore, roomId: string, input: unknown): Promise<RoomProposalCreateResult> {
  const body = CreateRoomProposalSchema.parse(input)
  const receipt = interactionId('proposal-create', roomId, body.clientRequestId)
  const fingerprint = interactionFingerprint({ roomId, ...body })
  const replay = await interactionReplay<RoomProposalCreateResult>(store, receipt, fingerprint)
  if (replay) return replay
  const room = await interactionRoom(store, roomId)
  const author = room.value.members.find((member) => member.id === body.authorMemberId)
  if (!author || author.removedAt || !author.enabled) {
    throw new RoomStoreConflictError('proposal author is not an enabled room member')
  }
  const runCount = (await store.list<RoomProposal>('room_proposal', {
    roomId, originRunId: body.originRunId, status: 'open', limit: ROOM_PROPOSAL_RUN_LIMIT })).length
  if (runCount >= ROOM_PROPOSAL_RUN_LIMIT) throw new RoomStoreConflictError('run proposal limit reached')
  const openCount = (await store.list<RoomProposal>('room_proposal', {
    roomId, status: 'open', limit: ROOM_PROPOSAL_ROOM_OPEN_LIMIT })).length
  if (openCount >= ROOM_PROPOSAL_ROOM_OPEN_LIMIT) throw new RoomStoreConflictError('room open proposal limit reached')
  const reply = await prepareRoomReplyContext(store, roomId, body.replyToMessageId)
  const proposalId = interactionId('proposal', roomId, body.clientRequestId)
  const messageId = interactionId('proposal-message', proposalId)
  const now = new Date().toISOString()
  const proposal = RoomProposalSchema.parse({
    schemaVersion: 1, proposalId, roomId, messageId, payload: body.payload, rationale: body.rationale,
    status: 'open', authorMemberId: body.authorMemberId, authorAgentId: body.authorAgentId,
    originRunId: body.originRunId, rootRequestId: body.rootRequestId ?? reply.rootRequestId, createdAt: now
  })
  const message = RoomMessageSchema.parse({
    id: messageId, roomId, messageSeq: 1, body: body.rationale,
    authorKind: 'member', authorMemberId: body.authorMemberId, authorAgentId: body.authorAgentId,
    authorLabelSnapshot: body.authorLabelSnapshot, bodyRevision: 0, status: 'final',
    presentationKind: 'proposal', proposalId, originRunId: body.originRunId, originItemId: body.originItemId,
    sourceRequestId: body.sourceRequestId, mentionMemberIds: [], attachmentIds: [], createdAt: now,
    replyToMessageId: reply.replyToMessageId, displayThreadRootId: reply.displayThreadRootId,
    rootRequestId: reply.rootRequestId ?? body.rootRequestId
  })
  const result = { proposal, messageId }
  await store.commit({ requestId: receipt, fingerprint,
    checks: [{ kind: 'room', id: roomId, expectedRevision: room.revision }, ...reply.checks,
      { kind: 'room_proposal', id: proposalId, expectedRevision: null },
      { kind: 'message', id: messageId, expectedRevision: null }],
    puts: [{ kind: 'room_proposal', id: proposalId, roomId, value: proposal },
      { kind: 'message', id: messageId, roomId, value: message }],
    events: [{ roomId, kind: 'message.presentation.created', payload: { id: messageId, presentationKind: 'proposal' } },
      { roomId, kind: 'room.proposal.updated', payload: { proposalId, messageId } }], result })
  return result
}

const RESULT_REF_KIND = { pin_agreement: 'rule', execution_request: 'message', add_member: 'room', create_agent: 'agent' } as const

/** User-authorized resolution. Agents can never reach this path: it is only bound to the user route. */
export async function resolveRoomProposal(store: RoomStore, roomId: string, proposalId: string, input: unknown): Promise<RoomProposalEntry> {
  const body = ResolveRoomProposalSchema.parse(input)
  if (body.decision === 'committed' && !body.resultRef) {
    throw new RoomStoreConflictError('committed proposals require a result reference')
  }
  const receipt = interactionId('proposal-resolve', roomId, proposalId, body.clientRequestId)
  const fingerprint = interactionFingerprint({ roomId, proposalId, ...body })
  return retryRoomInteraction(async () => {
    const replay = await interactionReplay<RoomProposalEntry>(store, receipt, fingerprint)
    if (replay) return replay
    const room = await interactionRoom(store, roomId)
    const row = await store.get<RoomProposal>('room_proposal', proposalId)
    if (!row || row.roomId !== roomId) throw new Error('room proposal not found')
    if (row.revision !== body.expectedRevision) {
      throw new RoomStoreConflictError('proposal changed since it was read', row.revision)
    }
    if (row.value.status !== 'open') throw new RoomStoreConflictError('proposal is not open', row.revision)
    if (body.decision === 'committed') await assertProposalResult(store, room.value, row, body.resultRef!)
    const value = RoomProposalSchema.parse({ ...row.value, status: body.decision,
      resultRef: body.decision === 'committed' ? body.resultRef : undefined,
      resolvedAt: new Date().toISOString() })
    const result: RoomProposalEntry = { ...value, revision: row.revision + 1 }
    await store.commit({ requestId: receipt, fingerprint,
      checks: [{ kind: 'room', id: roomId, expectedRevision: room.revision },
        { kind: 'room_proposal', id: proposalId, expectedRevision: row.revision }],
      puts: [{ kind: 'room_proposal', id: proposalId, roomId, value }],
      events: [{ roomId, kind: 'room.proposal.updated', payload: { proposalId, messageId: row.value.messageId } }], result })
    return result
  })
}

/** Every committed result must be a durable artifact the user actually produced after the draft. */
async function assertProposalResult(store: RoomStore, room: Room, row: RoomStoredDocument<RoomProposal>,
  ref: RoomProposalResultRef): Promise<void> {
  const proposal = row.value
  if (ref.kind !== RESULT_REF_KIND[proposal.payload.kind]) {
    throw new RoomStoreConflictError('result reference kind does not match the proposal')
  }
  switch (proposal.payload.kind) {
    case 'pin_agreement': {
      const rule = await store.get<RoomRule>('rule', ref.id)
      if (!rule || rule.roomId !== proposal.roomId || rule.value.messageId !== proposal.messageId) {
        throw new RoomStoreConflictError('the pinned agreement must reference this proposal message')
      }
      return
    }
    case 'execution_request': {
      const message = await store.get<RoomMessage>('message', ref.id)
      if (!message || message.roomId !== proposal.roomId || message.value.authorKind !== 'user' ||
        message.seq <= row.seq) {
        throw new RoomStoreConflictError('the execution request must reference a newer user message')
      }
      return
    }
    case 'add_member': {
      const target = proposal.payload.participantAgentId
      if (ref.id !== proposal.roomId ||
        !room.members.some((member) => member.participantAgentId === target && member.enabled && !member.removedAt)) {
        throw new RoomStoreConflictError('the proposed agent is not an enabled room member')
      }
      return
    }
    case 'create_agent': {
      const agent = await store.get<AgentIdentity>('agent_identity', ref.id)
      if (!agent || agent.seq <= row.seq) {
        throw new RoomStoreConflictError('the proposed agent identity was not created after this proposal')
      }
      return
    }
  }
}

/**
 * Withdraws every still-open proposal drafted by a cancelled or stopped run.
 * Stale drafts stay open: only the user decides them.
 */
export async function withdrawRunProposals(store: RoomStore, runId: string,
  reason: 'run_cancelled' | 'topic_stopped'): Promise<number> {
  const rows = await store.list<RoomProposal>('room_proposal', { originRunId: runId, status: 'open', limit: 50 })
  let withdrawn = 0
  for (const row of rows) {
    const value = RoomProposalSchema.parse({ ...row.value, status: 'withdrawn',
      withdrawnReason: reason, resolvedAt: new Date().toISOString() })
    try {
      await store.commit({ requestId: interactionId('proposal-withdraw', runId, row.id, String(row.revision)),
        fingerprint: interactionFingerprint({ runId, id: row.id, reason }),
        checks: [{ kind: 'room_proposal', id: row.id, expectedRevision: row.revision }],
        puts: [{ kind: 'room_proposal', id: row.id, roomId: row.roomId, value }],
        events: [{ roomId: row.roomId!, kind: 'room.proposal.updated',
          payload: { proposalId: row.id, messageId: row.value.messageId } }] })
      withdrawn += 1
    } catch (error) {
      // A user resolution that landed first wins; the draft is no longer open.
      if (!(error instanceof RoomStoreConflictError)) throw error
    }
  }
  return withdrawn
}
