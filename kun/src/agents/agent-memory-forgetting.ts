import { z } from 'zod'
import type { MemoryCreateRequest } from '../contracts/memory.js'
import type { MemoryStore } from '../memory/memory-store.js'
import type { AgentMemoryCapture, AgentMemoryCandidate } from './agent-memory-capture-types.js'
import type { AgentMemoryService } from './agent-memory-service.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { RoomStoredDocument } from '../rooms/room-store.js'
import { ServiceManagerHttpError } from '../manager/usage-errors.js'
import { agentStableId } from './agent-identity-service.js'

type IsForgotten = NonNullable<MemoryStore['isForgotten']>
type ScrubRow = RoomStoredDocument<AgentMemoryCapture | AgentMemoryCandidate>

/** Snapshots stored before empty excerpts were dropped still carry `excerpt: ''`, which memory validation rejects. */
function withoutEmptyExcerpts<T extends { excerpt?: string }>(sources: T[]): T[] {
  return sources.map((source) => source.excerpt === '' ? { ...source, excerpt: undefined } : source)
}

export function agentMemoryCaptureInput(job: AgentMemoryCapture, candidate: AgentMemoryCandidate['candidate']): MemoryCreateRequest {
  return { ...candidate, sources: withoutEmptyExcerpts(candidate.sources), scope: 'user', agentContext: { schemaVersion: 1, agentId: job.participantAgentId,
    sourceConversationId: job.memoryConversationId ?? job.roomId, sourceRootRequestId: job.rootRequestId,
    sourceHandoffId: job.memoryConversationId === job.roomId ? job.handoffId : undefined,
    sourceTaskId: job.taskScopeId, shared: false, sharedConversationIds: [], sharedProjectRoots: [], locked: false } }
}

/** The store rejected the record itself, so resending the same payload can never succeed. */
function recordRejected(error: unknown) {
  return error instanceof z.ZodError || error instanceof ServiceManagerHttpError && error.status === 400
}

async function jobIsForgotten(service: AgentMemoryService, isForgotten: IsForgotten, job: ScrubRow['value']) {
  if (job.phase === 'capture' && job.snapshot) {
    const snapshot = job.snapshot
    const input = agentMemoryCaptureInput(job, { content: snapshot.input, type: 'episode', confidence: 1,
      importance: .5, tags: [], sources: snapshot.sources, observedAt: snapshot.observedAt })
    if (await isForgotten(input)) return true
    for (const record of snapshot.comparisonRecords) {
      if (await isForgotten(record, record.id)) return true
    }
  } else if (job.phase === 'candidate') {
    if (await isForgotten({ ...job.candidate, sources: withoutEmptyExcerpts(job.candidate.sources), scope: 'user', agentContext: {
      schemaVersion: 1, agentId: job.participantAgentId, sourceConversationId: job.roomId,
      shared: false, sharedConversationIds: [], sharedProjectRoots: [], locked: false
    } }, job.memoryId)) return true
    if (job.targetId) {
      const target = await service.find(job.participantAgentId, job.targetId).catch(() => undefined)
      return !target || await isForgotten(target, target.id)
    }
  }
  return false
}

/** Remove derived payloads, retain only durable non-content job identities against replay. */
export async function scrubForgottenAgentMemory(service: AgentMemoryService): Promise<void> {
  const memory = service.store()
  if (!memory.isForgotten) return
  const isForgotten: IsForgotten = memory.isForgotten.bind(memory)
  for (const phase of ['capture', 'candidate']) {
    let afterSeq = 0
    while (true) {
      const rows = await service.agents.store.list<AgentMemoryCapture | AgentMemoryCandidate>('agent_memory_job',
        { phase, limit: 100, afterSeq, order: 'asc' })
      for (const row of rows) {
        const job = row.value
        let forgotten: boolean
        try {
          forgotten = await jobIsForgotten(service, isForgotten, job)
        } catch (error) {
          // One invalid record must not block the pass for every later job; transport failures still abort it.
          if (!recordRejected(error)) throw error
          warnRejectedJob(row, error)
          continue
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

function warnRejectedJob(row: ScrubRow, error: unknown) {
  console.warn(`[kun] agent memory scrub skipped ${row.value.phase} job ${row.id} in room ${row.roomId ?? row.value.roomId}:`,
    error instanceof Error ? error.message : String(error))
}
