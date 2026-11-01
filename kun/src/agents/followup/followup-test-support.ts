import { AgentCommitmentService } from '../agent-commitment-service.js'
import { AgentIdentityService } from '../agent-identity-service.js'
import { RoomMessageSchema } from '../../contracts/rooms.js'
import { createTurnRecord } from '../../domain/turn.js'
import { putRoomDocument } from '../../rooms/room-service.js'
import { workbenchFixture } from '../../workbench-bridge/workbench-test-support.js'
import { FollowUpService } from './service.js'

export async function followUpFixture() {
  const f = await workbenchFixture()
  f.deps.proveStopped = async (threadId) => Boolean(f.stub.threads.get(threadId)) &&
    !f.stub.threads.get(threadId)!.turns.some((turn) => turn.status === 'running' || turn.status === 'queued')
  const now = new Date().toISOString()
  const source = RoomMessageSchema.parse({ id: 'follow-up-source', roomId: f.room.id, messageSeq: 2,
    authorKind: 'user', authorLabelSnapshot: 'You', body: 'Follow this repair until the current version passes review.',
    bodyRevision: 0, mentionMemberIds: [], attachmentIds: [], status: 'final', createdAt: now })
  await putRoomDocument(f.store, 'message', source.id, f.room.id, source, null)
  const agents = new AgentIdentityService(f.store, () => ({}))
  const commitments = new AgentCommitmentService(f.deps, agents)
  const create = { clientRequestId: 'create-follow-up', objective: 'Repair the authorized PR', acceptance: 'Current head passes tests and is reviewed',
    sourceRoomId: f.room.id, sourceMessageId: source.id }
  const commitment = await commitments.create('agent-1', create)
  const features = { enabled: true, auto: false, github: false }, wakes = { count: 0 }
  const followUp = new FollowUpService(f.deps, { features: () => features, wake: () => { wakes.count++ } })
  const userEvidence = { kind: 'user_message' as const, sourceRoomId: f.room.id, sourceMessageId: source.id, messageRevision: 0 }
  const enable = { clientRequestId: 'enable', expectedControlRevision: null,
    policy: { continuationMode: 'manual' as const, newWorkMode: 'off' as const,
      allowedActions: ['continue', 'read_source', 'notify'],
      limits: { attemptsPerDay: 3, attemptsTotal: 10, minimumIntervalMs: 1000, softTokenBudget: 100_000 },
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() }, userEvidence }
  const addTarget = (id = 'target-thread', status: 'running' | 'queued' | 'completed' = 'completed') => {
    f.addCodeThread(id, f.directory, { workbenchOrigin: {
      kind: 'bot', agentId: 'agent-1', agentName: 'Bot', roomId: f.room.id, linkId: 'wb-' + id
    } })
    f.stub.threads.get(id)!.turns.push(createTurnRecord({ id: id + '-turn', threadId: id, prompt: 'Repair',
      clientRequestId: id + '-request', status }))
    return { kind: 'thread' as const, threadId: id }
  }
  return { ...f, source, agents, commitments, commitment, create, followUp, features, wakes, userEvidence, enable, addTarget }
}
export type FollowUpFixture = Awaited<ReturnType<typeof followUpFixture>>
