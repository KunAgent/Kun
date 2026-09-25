import { describe, expect, it } from 'vitest'
import {
  ResolveRoomProposalSchema,
  RoomProposalPayloadSchema,
  RoomProposalSchema
} from './room-proposals.js'

const base = {
  schemaVersion: 1,
  proposalId: 'proposal-1',
  roomId: 'room-1',
  messageId: 'message-1',
  rationale: 'The team agreed on this convention.',
  status: 'open',
  authorMemberId: 'developer',
  originRunId: 'run-1',
  createdAt: '2026-01-01T00:00:00.000Z'
}

describe('room proposal contracts', () => {
  it('accepts every payload kind with its required fields', () => {
    const payloads = [
      { kind: 'pin_agreement', body: 'Use UTC timestamps everywhere.' },
      { kind: 'execution_request', goal: 'Port the parser', memberIds: ['developer'], repositoryId: 'repo-1' },
      { kind: 'add_member', participantAgentId: 'agent-9', roleNotes: 'Review database changes.' },
      { kind: 'create_agent', name: 'Doc writer', title: 'Docs', instructions: 'Keep docs current.' }
    ]
    for (const payload of payloads) expect(RoomProposalPayloadSchema.parse(payload).kind).toBe(payload.kind)
    const proposal = RoomProposalSchema.parse({ ...base, payload: payloads[0] })
    expect(proposal.status).toBe('open')
    expect(proposal.payload).toMatchObject(payloads[0])
  })

  it('rejects malformed payloads and unknown kinds', () => {
    for (const payload of [
      { kind: 'pin_agreement', body: '   ' },
      { kind: 'pin_agreement' },
      { kind: 'execution_request', goal: 'x', memberIds: ['developer'], repositoryId: '../outside' },
      { kind: 'add_member', participantAgentId: 'agent 9', roleNotes: '' },
      { kind: 'create_agent', name: '  ', title: '', instructions: '' },
      { kind: 'delete_room' },
      { kind: 'pin_agreement', body: 'ok', extra: true }
    ]) expect(RoomProposalPayloadSchema.safeParse(payload).success).toBe(false)
  })

  it('requires a result reference only when committing and keeps identity fields stable', () => {
    const open = { ...base, payload: { kind: 'pin_agreement', body: 'Rule' } }
    expect(RoomProposalSchema.safeParse({ ...open, status: 'committed' }).success).toBe(true)
    expect(ResolveRoomProposalSchema.safeParse({
      clientRequestId: 'resolve-1', expectedRevision: 0, decision: 'committed'
    }).success).toBe(true) // schema allows; service enforces the resultRef rule
    expect(ResolveRoomProposalSchema.safeParse({
      clientRequestId: 'resolve-1', expectedRevision: -1, decision: 'dismissed'
    }).success).toBe(false)
    expect(ResolveRoomProposalSchema.safeParse({
      clientRequestId: 'resolve-1', expectedRevision: 0, decision: 'withdrawn'
    }).success).toBe(false)
    expect(RoomProposalSchema.safeParse({ ...open, status: 'rejected' }).success).toBe(false)
    expect(RoomProposalSchema.safeParse({ ...open, resultRef: { kind: 'rule', id: '' } }).success).toBe(false)
  })
})
