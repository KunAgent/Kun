import { AgentCommitmentSchema, CreateAgentCommitment, UpdateAgentCommitment, AgentCommitmentQuery,
  type AgentCommitment, type AgentCommitmentEntry } from '../contracts/agent-commitments.js'
import type { Room, RoomMessage } from '../contracts/rooms.js'
import type { AgentHandoff } from '../contracts/agent-handoffs.js'
import type { WorkbenchLink } from '../contracts/workbench-links.js'
import type { RoomRuntimeDeps, RoomTaskExecution } from '../rooms/room-runtime-types.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'
import { roomFingerprint } from '../rooms/room-service.js'
import { agentStableId, type AgentIdentityService } from './agent-identity-service.js'

/** Durable commitments track outcomes across turns. Execution remains with existing tasks/threads. */
export class AgentCommitmentService {
  constructor(readonly deps: RoomRuntimeDeps, private readonly agents: AgentIdentityService) {}

  async get(agentId: string, id: string): Promise<AgentCommitmentEntry> {
    await this.agents.get(agentId)
    const row = await this.deps.store.get<AgentCommitment>('agent_commitment', id)
    if (!row || row.value.participantAgentId !== agentId) throw new Error('agent commitment not found')
    return { ...AgentCommitmentSchema.parse(row.value), revision: row.revision }
  }

  async list(agentId: string, raw: unknown = {}) {
    await this.agents.get(agentId)
    const input = AgentCommitmentQuery.parse(raw)
    const rows = await this.deps.store.list<AgentCommitment>('agent_commitment', {
      participantAgentId: agentId, status: input.status, search: input.search, beforeSeq: input.cursor, limit: input.limit + 1 })
    return { commitments: rows.slice(0, input.limit).map((row) => ({ ...row.value, revision: row.revision })),
      ...(rows.length > input.limit ? { nextCursor: String(rows[input.limit - 1].seq) } : {}) }
  }

  private async source(agentId: string, roomId: string, messageId: string) {
    await this.agents.active(agentId)
    const room = await this.deps.store.get<Room>('room', roomId)
    if (!room || room.value.archivedAt || !room.value.members.some((member) => member.participantAgentId === agentId &&
      member.enabled && !member.removedAt)) throw new Error('commitment source room unavailable')
    const message = await this.deps.store.get<RoomMessage>('message', messageId)
    if (!message || message.roomId !== roomId || message.value.authorKind !== 'user' || message.value.status !== 'final') {
      throw new Error('commitment requires an actual user message in its source room')
    }
    return message.value
  }

  private async validateLinks(agentId: string, links: AgentCommitment['links']) {
    for (const link of links) {
      if (link.kind === 'thread' || link.kind === 'goal') {
        const thread = await this.deps.threads.getMetadata(link.id)
        if (!thread || thread.roomContext?.participantAgentId !== agentId && thread.workbenchOrigin?.agentId !== agentId) {
          throw new Error('linked thread is outside this Agent scope')
        }
        if (link.kind === 'goal' && !thread.goal) throw new Error('linked goal not found')
      } else if (link.kind === 'workbench_link') {
        const row = await this.deps.store.get<WorkbenchLink>('workbench_link', link.id)
        if (!row || row.value.participantAgentId !== agentId) throw new Error('workbench link not found')
      } else if (link.kind === 'handoff') {
        const row = await this.deps.store.get<AgentHandoff>('agent_handoff', link.id)
        if (!row || ![row.value.senderAgentId, row.value.recipientAgentId].includes(agentId)) throw new Error('agent handoff not found')
      } else {
        const row = await this.deps.store.get<RoomTaskExecution>('task', link.id)
        if (!row || row.value.task.memberSnapshot.participantAgentId !== agentId) throw new Error('agent task not found')
      }
    }
  }

  async create(agentId: string, raw: unknown): Promise<AgentCommitmentEntry> {
    const input = CreateAgentCommitment.parse(raw)
    const id = agentStableId('commitment', agentId, input.clientRequestId), receipt = id + ':create'
    const fingerprint = roomFingerprint({ agentId, input })
    const old = await this.deps.store.getRequest(receipt)
    if (old) {
      if (old.fingerprint !== fingerprint) throw new RoomStoreConflictError('commitment request changed')
      return old.result as AgentCommitmentEntry
    }
    const source = await this.source(agentId, input.sourceRoomId, input.sourceMessageId)
    await this.validateLinks(agentId, input.links)
    const { clientRequestId: _request, ...fields } = input
    const now = new Date().toISOString()
    const value = AgentCommitmentSchema.parse({ ...fields, schemaVersion: 1, id, participantAgentId: agentId,
      authorization: { kind: 'user_message', messageRevision: source.bodyRevision, text: source.body.slice(0, 16000), capturedAt: now },
      status: 'open', createdAt: now, updatedAt: now })
    const result = { ...value, revision: 0 }
    await this.deps.store.commit({ requestId: receipt, fingerprint,
      checks: [{ kind: 'agent_commitment', id, expectedRevision: null }],
      puts: [{ kind: 'agent_commitment', id, roomId: input.sourceRoomId, value }],
      events: [{ roomId: input.sourceRoomId, kind: 'agent.commitment.updated', payload: { id, participantAgentId: agentId } }], result })
    return result
  }

  async update(agentId: string, id: string, raw: unknown): Promise<AgentCommitmentEntry> {
    const input = UpdateAgentCommitment.parse(raw), receipt = id + ':update:' + input.clientRequestId
    const fingerprint = roomFingerprint({ agentId, id, input })
    const old = await this.deps.store.getRequest(receipt)
    if (old) {
      if (old.fingerprint !== fingerprint) throw new RoomStoreConflictError('commitment update changed')
      return old.result as AgentCommitmentEntry
    }
    const current = await this.get(agentId, id)
    if (current.revision !== input.expectedRevision) throw new RoomStoreConflictError('commitment changed', current.revision)
    if (input.links) await this.validateLinks(agentId, input.links)
    for (const result of input.results ?? []) if (result.artifactId) {
      const key = result.version ? `${result.artifactId}:v${result.version}` : result.artifactId
      const artifact = await this.deps.store.get<{ participantAgentId: string }>('agent_artifact', key)
      if (!artifact || artifact.value.participantAgentId !== agentId) throw new Error('result artifact is outside this Agent scope')
    }
    const { clientRequestId: _request, expectedRevision: _expected, ...parsedPatch } = input
    // Zod defaults in a partial object must not erase omitted schedule/link fields.
    const patch = Object.fromEntries(Object.entries(parsedPatch).filter(([key]) => Object.hasOwn(raw as object, key)))
    const { revision, ...prior } = current
    const now = new Date().toISOString()
    const value = AgentCommitmentSchema.parse({ ...prior, ...patch, updatedAt: now })
    if (value.status === 'completed' && !value.acceptanceEvidence.length) throw new Error('completion requires acceptance evidence')
    if (['waiting', 'blocked'].includes(value.status) && !value.waitingOn?.trim()) throw new Error('waiting or blocked requires a waitingOn explanation')
    if (['completed', 'cancelled'].includes(value.status)) { value.finishedAt = now; value.nextCheckAt = null }
    else delete value.finishedAt
    const result = { ...value, revision: revision + 1 }
    await this.deps.store.commit({ requestId: receipt, fingerprint,
      checks: [{ kind: 'agent_commitment', id, expectedRevision: revision }],
      puts: [{ kind: 'agent_commitment', id, roomId: value.sourceRoomId, value }],
      events: [{ roomId: value.sourceRoomId, kind: 'agent.commitment.updated', payload: { id, participantAgentId: agentId } }], result })
    return result
  }
}
