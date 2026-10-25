import { z } from 'zod'
import { createHash } from 'node:crypto'
import type { MemoryCreateRequest } from '../contracts/memory.js'
import type { MemoryStore } from '../memory/memory-store.js'
import type { AgentMemoryCapture, AgentMemoryCandidate } from './agent-memory-capture-types.js'
import type { AgentMemoryService } from './agent-memory-service.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { RoomStoredDocument } from '../rooms/room-store.js'
import { ServiceManagerHttpError } from '../manager/usage-errors.js'
import { agentStableId } from './agent-identity-service.js'

type IsForgotten = NonNullable<MemoryStore['isForgotten']>
type MemoryJob = AgentMemoryCapture | AgentMemoryCandidate
type ScrubRow = RoomStoredDocument<MemoryJob>

const SCRUB_RETRY_MS = 5 * 60_000
const MAX_SCRUB_ATTEMPTS = 3

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
export async function scrubForgottenAgentMemory(service: AgentMemoryService,
  options: { force?: boolean; now?: number } = {}): Promise<void> {
  const memory = service.store()
  if (!memory.isForgotten) return
  const isForgotten: IsForgotten = memory.isForgotten.bind(memory)
  for (const phase of ['capture', 'candidate']) {
    let afterSeq = 0
    while (true) {
      const rows = await service.agents.store.list<AgentMemoryCapture | AgentMemoryCandidate>('agent_memory_job',
        { phase, limit: 100, afterSeq, order: 'asc' })
      for (const original of rows) {
        if (original.value.phase === 'capture' && !original.value.snapshot) continue
        const row = await repairEmptyExcerpts(service, original)
        await scrubJobWithRetry(service, row, options, async () => {
          const job = row.value
          if (!await jobIsForgotten(service, isForgotten, job)) return
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
        })
      }
      if (rows.length < 100) break
      afterSeq = rows.at(-1)!.seq
    }
  }
}

/** Old snapshots still need their source anchors for forgetting, even without textual evidence. */
async function repairEmptyExcerpts(service: AgentMemoryService, row: RoomStoredDocument<MemoryJob>) {
  const job = row.value
  const sources = job.phase === 'capture' ? job.snapshot?.sources : job.candidate.sources
  if (!sources?.some((source) => source.excerpt !== undefined && !source.excerpt.trim())) return row
  const repaired = sources.map((source) => source.excerpt !== undefined && !source.excerpt.trim()
    ? { ...source, excerpt: undefined } : source)
  const value: MemoryJob = job.phase === 'capture'
    ? { ...job, snapshot: { ...job.snapshot!, sources: repaired } }
    : { ...job, candidate: { ...job.candidate, sources: repaired } }
  await saveScrubState(service, row, value, 'repair')
  return (await service.agents.store.get<MemoryJob>('agent_memory_job', row.id))!
}

async function saveScrubState(service: AgentMemoryService, row: RoomStoredDocument<MemoryJob>,
  value: MemoryJob, operation: string) {
  await service.agents.store.commit({ requestId: agentStableId('memory-scrub-' + operation, row.id, String(row.revision)),
    checks: [{ kind: 'agent_memory_job', id: row.id, expectedRevision: row.revision }],
    puts: [{ kind: 'agent_memory_job', id: row.id, roomId: row.roomId, value }] })
}

/** Persist budgets per evidence fingerprint so restart cannot restart a poison-job retry loop. */
async function scrubJobWithRetry(service: AgentMemoryService, row: RoomStoredDocument<MemoryJob>,
  options: { force?: boolean; now?: number }, operation: () => Promise<void>) {
  const job = row.value, now = options.now ?? Date.now()
  const fingerprint = createHash('sha256').update(JSON.stringify(job.phase === 'capture'
    ? job.snapshot ?? null : [job.candidate, job.targetId, job.memoryId])).digest('hex')
  const failure = job.scrubFailure?.fingerprint === fingerprint ? job.scrubFailure : undefined
  if (!options.force && failure && (failure.nextRetryAt === undefined || now < failure.nextRetryAt)) return
  try {
    await operation()
  } catch (error) {
    // Explicit forget/erase and candidate reads must not claim a successful scrub.
    if (options.force) throw error
    const attempts = (failure?.attempts ?? 0) + 1
    const nextRetryAt = !recordRejected(error) && attempts < MAX_SCRUB_ATTEMPTS
      ? now + SCRUB_RETRY_MS * 2 ** (attempts - 1) : undefined
    await saveScrubState(service, row, { ...job, scrubFailure: { fingerprint, attempts, nextRetryAt } }, 'failed')
    // Never log the request body, excerpt, model output, or Manager response detail.
    console.warn('[kun] agent memory scrub:', { roomId: job.roomId, requestId: job.rootRequestId,
      runId: job.runId, jobId: job.id, attempts, nextRetryAt, stopped: nextRetryAt === undefined,
      error: error instanceof Error ? error.name : 'UnknownError',
      ...(error instanceof ServiceManagerHttpError ? { status: error.status, code: error.code } : {}) })
    return
  }
  if (job.scrubFailure) {
    const current = await service.agents.store.get<MemoryJob>('agent_memory_job', row.id)
    // A successful forgetting operation may already have removed this payload.
    if (current?.revision === row.revision) {
      await saveScrubState(service, row, { ...job, scrubFailure: undefined }, 'recovered')
    }
  }
}
