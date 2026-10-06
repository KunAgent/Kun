import type { MemoryCreateRequest } from '../contracts/memory.js'
import type { AgentMemoryCapture, AgentMemoryCandidate } from './agent-memory-capture-types.js'
import type { AgentMemoryService } from './agent-memory-service.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { agentStableId } from './agent-identity-service.js'

export function agentMemoryCaptureInput(job: AgentMemoryCapture, candidate: AgentMemoryCandidate['candidate']): MemoryCreateRequest {
  return { ...candidate, scope: 'user', agentContext: { schemaVersion: 1, agentId: job.participantAgentId,
    sourceConversationId: job.memoryConversationId ?? job.roomId, sourceRootRequestId: job.rootRequestId,
    sourceHandoffId: job.memoryConversationId === job.roomId ? job.handoffId : undefined,
    sourceTaskId: job.taskScopeId, shared: false, sharedConversationIds: [], sharedProjectRoots: [], locked: false } }
}

/** Remove derived payloads, retain only durable non-content job identities against replay. */
export async function scrubForgottenAgentMemory(service: AgentMemoryService): Promise<void> {
  const memory = service.store()
  if (!memory.isForgotten) return
  for (const phase of ['capture', 'candidate']) {
    let afterSeq = 0
    while (true) {
      const rows = await service.agents.store.list<AgentMemoryCapture | AgentMemoryCandidate>('agent_memory_job',
        { phase, limit: 100, afterSeq, order: 'asc' })
      for (const row of rows) {
        const job = row.value
        let forgotten = false
        if (job.phase === 'capture' && job.snapshot) {
          const snapshot = job.snapshot
          const input = agentMemoryCaptureInput(job, { content: snapshot.input, type: 'episode', confidence: 1,
            importance: .5, tags: [], sources: snapshot.sources, observedAt: snapshot.observedAt })
          forgotten = await memory.isForgotten(input)
          for (const record of snapshot.comparisonRecords) {
            if (!forgotten) forgotten = await memory.isForgotten(record, record.id)
          }
        } else if (job.phase === 'candidate') {
          forgotten = await memory.isForgotten({ ...job.candidate, scope: 'user', agentContext: {
            schemaVersion: 1, agentId: job.participantAgentId, sourceConversationId: job.roomId,
            shared: false, sharedConversationIds: [], sharedProjectRoots: [], locked: false
          } }, job.memoryId)
          if (!forgotten && job.targetId) {
            const target = await service.find(job.participantAgentId, job.targetId).catch(() => undefined)
            forgotten = !target || await memory.isForgotten(target, target.id)
          }
        }
        if (!forgotten) continue
        const run = job.runId ? await service.agents.store.get<RoomRunRecord>('room_run', job.runId) : null
        await service.agents.store.commit({ requestId: agentStableId('memory-forgotten-job', row.id, String(row.revision)),
          checks: [{ kind: 'agent_memory_job', id: row.id, expectedRevision: row.revision },
            ...(run ? [{ kind: 'room_run' as const, id: run.id, expectedRevision: run.revision }] : [])],
          puts: [{ kind: 'agent_memory_job', id: row.id, roomId: row.roomId, value: {
            id: row.id, phase: 'forgotten', status: 'cancelled', participantAgentId: job.participantAgentId,
            roomId: job.roomId, rootRequestId: job.rootRequestId, reason: 'memory_forgotten'
          } }, ...(run ? [{ kind: 'room_run' as const, id: run.id, roomId: run.roomId, value: {
            ...run.value, input: '', status: 'cancelled', reason: 'memory_forgotten', error: undefined
          } }] : [])] })
      }
      if (rows.length < 100) break
      afterSeq = rows.at(-1)!.seq
    }
  }
}
