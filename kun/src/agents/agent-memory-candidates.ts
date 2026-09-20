import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { MemoryRecord } from '../contracts/memory.js'
import { canonicalMemoryHash } from '../memory/memory-record-normalizer.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'
import type { AgentMemoryService } from './agent-memory-service.js'
import type { AgentMemoryCandidate } from './agent-memory-capture-types.js'
import { agentStableId } from './agent-identity-service.js'

export const AgentMemoryCandidateDecision = z.object({
  clientRequestId: z.string().min(1).max(128), expectedRevision: z.number().int().nonnegative(),
  decision: z.enum(['allow', 'skip']), expectedTargetFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional()
}).strict()
export async function listAgentMemoryCandidates(service: AgentMemoryService, agentId: string, cursor?: number) {
  await service.agents.get(agentId)
  const rows = await service.agents.store.list<AgentMemoryCandidate>('agent_memory_job', {
    participantAgentId: agentId, phase: 'candidate', status: ['pending', 'conflicted'], limit: 21, beforeSeq: cursor })
  const candidates = []
  for (const row of rows.slice(0, 20)) {
    let target: MemoryRecord | undefined
    if (row.value.targetId) {
      try { target = await service.find(agentId, row.value.targetId) } catch { /* Report a missing source instead of inventing a replacement. */ }
    }
    candidates.push({ candidate: row.value, revision: row.revision,
      target: target ? { content: target.content, fingerprint: canonicalMemoryHash(target),
        shared: target.agentContext?.shared, disabled: Boolean(target.disabledAt || target.deletedAt || target.supersededAt) } : undefined })
  }
  return { candidates, nextCursor: rows.length > 20 ? String(rows[19].seq) : undefined }
}
export async function decideAgentMemoryCandidate(service: AgentMemoryService, agentId: string, candidateId: string, raw: unknown) {
  const input = AgentMemoryCandidateDecision.parse(raw)
  const key = agentStableId('agent-memory-decision', candidateId, input.clientRequestId)
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex')
  const receipt = await service.agents.store.getRequest(key)
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) throw new RoomStoreConflictError('memory decision identity changed')
    return receipt.result
  }
  const row = await service.agents.store.get<AgentMemoryCandidate>('agent_memory_job', candidateId)
  if (!row || row.value.participantAgentId !== agentId) throw new Error('agent memory candidate not found')
  if (row.revision !== input.expectedRevision || !['pending', 'conflicted'].includes(row.value.status)) {
    throw new RoomStoreConflictError('memory candidate changed; reload before deciding')
  }
  let memoryId: string | undefined
  if (input.decision === 'allow') {
    if (!await service.available()) throw new RoomStoreConflictError('agent memory is disabled')
    if (!row.value.targetId) throw new RoomStoreConflictError('candidate has no valid target')
    const target = await service.find(agentId, row.value.targetId)
    memoryId = agentStableId('mem-agent-approved', candidateId)
    const existing = await service.store().getById?.(memoryId, { agent: { agentId, manage: true } }).catch(() => undefined)
    if (!existing) {
      if (!input.expectedTargetFingerprint || canonicalMemoryHash(target) !== input.expectedTargetFingerprint ||
        target.deletedAt || target.disabledAt || target.supersededAt) throw new RoomStoreConflictError('target memory changed or is unavailable')
      if (!service.store().createWithId) throw new Error('idempotent memory storage unavailable')
      await service.store().createWithId!(memoryId, {
        ...row.value.candidate, scope: target.scope, workspace: target.workspace, project: target.project,
        supersedes: target.id, provenance: { kind: 'user', origin: 'agent-memory-candidate:' + candidateId },
        agentContext: { ...target.agentContext!, locked: true, lastOperationId: key,
          originFingerprint: createHash('sha256').update(candidateId).digest('hex') }
      })
    } else if (service.store().createWithId) {
      // Complete the old-record tombstone if canonical creation committed before its acknowledgement.
      await service.store().createWithId!(memoryId, {
        content: existing.content, scope: existing.scope, workspace: existing.workspace, project: existing.project,
        supersedes: existing.supersedes, agentContext: existing.agentContext, sources: existing.sources,
        provenance: existing.provenance
      })
    }
  }
  const value: AgentMemoryCandidate = { ...row.value, status: input.decision === 'allow' ? 'completed' : 'skipped', memoryId }
  const result = { candidate: value }
  await service.agents.store.commit({ requestId: key, fingerprint,
    checks: [{ kind: 'agent_memory_job', id: candidateId, expectedRevision: row.revision }],
    puts: [{ kind: 'agent_memory_job', id: candidateId, roomId: row.roomId, value }],
    events: [{ roomId: row.roomId!, kind: 'agent.memory.updated', payload: { agentId } }], result })
  return result
}
