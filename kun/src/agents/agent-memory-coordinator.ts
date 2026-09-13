import type { RoomReview } from '../contracts/room-deliveries.js'
import type { AgentHandoff } from '../contracts/agent-handoffs.js'
import type { Room } from '../contracts/rooms.js'
import { createHash } from 'node:crypto'
import type { RoomRuntimeDeps, RoomRequestState, RoomTaskExecution } from '../rooms/room-runtime-types.js'
import type { RoomMessage } from '../contracts/rooms.js'
import { RoomRunRecordSchema } from '../contracts/room-runs.js'
import type { RoomStoredDocument } from '../rooms/room-store.js'
import type { RoomPeerTopic } from '../rooms/room-peer-types.js'
import { AgentIdentitySchema } from '../contracts/agent-identities.js'
import { canonicalMemoryHash } from '../memory/memory-record-normalizer.js'
import { agentStableId } from './agent-identity-service.js'
import { prepareAgentMemoryCapture, extractAgentMemories } from './agent-memory-extraction.js'
import type { AgentMemoryCapture, AgentMemoryCaptureResult, AgentMemoryCandidate } from './agent-memory-capture-types.js'

type Active = { jobId: string; controller: AbortController; done: boolean; promise: Promise<void>; result?: AgentMemoryCaptureResult }

/** One bounded background extraction at a time. Applying results runs inside the room runtime's ownership queue. */
export class AgentMemoryCoordinator {
  private active?: Active
  private closed = false
  constructor(private readonly deps: RoomRuntimeDeps) {}
  async close() {
    this.closed = true
    this.active?.controller.abort(new Error('runtime closing'))
    await this.active?.promise
  }
  async tick() {
    if (this.closed || !this.deps.agentMemory || !this.deps.memoryStore) return
    await this.deps.agentMemory.recoverEdits()
    await this.discover()
    if (this.active) {
      const row = await this.deps.store.get<AgentMemoryCapture>('agent_memory_job', this.active.jobId)
      if (row && !await this.allowed(row.value)) this.active.controller.abort(new Error('memory source cancelled or disabled'))
      if (!this.active.done) return
      const active = this.active; this.active = undefined
      if (row) await this.apply(row, active.result!)
    }
    if (!await this.deps.agentMemory.available()) return
    const jobs = await this.deps.store.list<AgentMemoryCapture>('agent_memory_job', {
      phase: 'capture', status: ['pending', 'running'], limit: 50, order: 'asc' })
    for (const row of jobs) {
      if (!await this.allowed(row.value)) { await this.save(row, { status: 'cancelled' }); continue }
      const topic = await this.deps.store.get<RoomPeerTopic>('peer_topic', row.value.rootRequestId)
      const request = await this.deps.store.get<RoomRequestState>('request', row.value.rootRequestId)
      if (topic && !['idle', 'paused'].includes(topic.value.status) || !topic && request?.value.status !== 'completed') continue
      if (row.value.status === 'running') {
        // No durable extraction handle exists after restart. Count the lost attempt; never acknowledge its source.
        const run = row.value.runId ? await this.deps.store.get('room_run', row.value.runId) : null
        if (run) await this.deps.store.commit({ requestId: row.value.runId + ':interrupted',
          checks: [{ kind: 'room_run', id: run.id, expectedRevision: run.revision }],
          puts: [{ kind: 'room_run', id: run.id, roomId: run.roomId, value: {
            ...(run.value as object), status: 'failed', error: 'Memory extraction interrupted by restart',
            endedAt: new Date().toISOString(), updatedAt: new Date().toISOString()
          } }], events: [{ roomId: run.roomId!, kind: 'room_run.updated', payload: { id: run.id } }] })
        await this.save(row, { status: row.value.attempts >= 2 ? 'deferred' : 'pending', error: 'Extraction interrupted by restart' })
        continue
      }
      if (row.value.attempts >= 2) { await this.save(row, { status: 'deferred' }); continue }
      await this.start(row)
      break
    }
  }
  private async save(row: RoomStoredDocument<AgentMemoryCapture>, patch: Partial<AgentMemoryCapture>) {
    await this.deps.store.commit({ requestId: agentStableId('memory-state', row.id, String(row.revision), JSON.stringify(patch)),
      checks: [{ kind: 'agent_memory_job', id: row.id, expectedRevision: row.revision }],
      puts: [{ kind: 'agent_memory_job', id: row.id, roomId: row.roomId, value: { ...row.value, ...patch } }] })
  }
  private async allowed(job: AgentMemoryCapture) {
    if (!await this.deps.agentMemory!.available()) return false
    if (job.handoffId && (!this.deps.agentHandoffs || !await this.deps.agentHandoffs.current(job.handoffId))) return false
    const row = await this.deps.store.get('agent_identity', job.participantAgentId)
    const agent = row ? AgentIdentitySchema.safeParse(row.value) : null
    if (!agent?.success || agent.data.archivedAt || !agent.data.memory.captureEnabled) return false
    const topic = await this.deps.store.get<RoomPeerTopic>('peer_topic', job.rootRequestId)
    const request = await this.deps.store.get<RoomRequestState>('request', job.rootRequestId)
    return !request?.value.cancellationRequested && !['cancelled', 'stopping'].includes(request?.value.status ?? '') &&
      (!topic || topic.value.generation === job.generation && !['stopped', 'stopping'].includes(topic.value.status))
  }
  private async discover() {
    const cursorId = 'agent-memory-event-cursor'
    const cursor = await this.deps.store.get<{ seq: number }>('agent_memory_job', cursorId)
    if (!cursor) {
      await this.deps.store.commit({ requestId: cursorId,
        checks: [{ kind: 'agent_memory_job', id: cursorId, expectedRevision: null }],
        puts: [{ kind: 'agent_memory_job', id: cursorId, value: { phase: 'cursor', seq: await this.deps.store.latestEventSeq?.() ?? 0 } }] })
      return
    }
    const events = await this.deps.store.events('*', cursor.value.seq, 100)
    for (const event of events) {
      const id = (event.payload as { id?: string } | null)?.id
      if (!id) continue
      let agentId: string | undefined, memberId: string | undefined, rootId: string | undefined
      let messageId: string | undefined, taskId: string | undefined, taskScopeId: string | undefined, reviewId: string | undefined, handoff: AgentHandoff | undefined
      if (event.kind === 'message.created' || event.kind === 'message.updated' || event.kind === 'message.presentation.created') {
        const message = await this.deps.store.get<RoomMessage>('message', id)
        if (!message || message.value.status !== 'final') continue
        if (message.value.handoffId) {
          if (!message.value.originRunId || message.value.authorKind !== 'member') continue
          handoff = (await this.deps.store.get<AgentHandoff>('agent_handoff', message.value.handoffId))?.value
          if (!handoff || handoff.status !== 'completed') continue
        }
        agentId = message.value.authorAgentId; memberId = message.value.authorMemberId
        rootId = message.value.rootRequestId; messageId = id
      } else if (event.kind === 'review.created') {
        const review = await this.deps.store.get<RoomReview>('review', id)
        const task = review ? await this.deps.store.get<RoomTaskExecution>('task', review.value.taskId) : null
        if (!review || !task || task.value.reviewer?.id !== review.value.reviewerMemberId) continue
        agentId = task.value.reviewer.participantAgentId; memberId = task.value.reviewer.id
        const request = await this.deps.store.get<RoomRequestState>('request', task.value.task.requestId)
        rootId = request?.value.rootRequestId ?? task.value.task.requestId; reviewId = id
        taskScopeId = task.value.reviewer.taskScopedMemory ? task.value.task.id : undefined
      } else if (event.kind === 'task.updated') {
        const task = await this.deps.store.get<RoomTaskExecution>('task', id)
        if (!task || !['completed', 'awaiting_acceptance'].includes(task.value.task.status) || !task.value.task.latestDeliveryId) continue
        agentId = task.value.task.memberSnapshot.participantAgentId; memberId = task.value.task.ownerMemberId
        const request = await this.deps.store.get<RoomRequestState>('request', task.value.task.requestId)
        rootId = request?.value.rootRequestId ?? task.value.task.requestId; taskId = id
        taskScopeId = task.value.task.memberSnapshot.taskScopedMemory ? task.value.task.id : undefined
      } else continue
      if (!agentId || !rootId || !memberId) continue
      const topic = await this.deps.store.get<RoomPeerTopic>('peer_topic', rootId)
      const jobId = agentStableId('agent-capture', agentId, rootId, String(topic?.value.generation ?? 0), taskScopeId ?? '')
      const origin = handoff ? await this.deps.store.get<Room>('room', handoff.sourceRoomId) : null
      const memoryConversationId = handoff && origin?.value.members.some((member) => member.participantAgentId === agentId && member.enabled && !member.removedAt) ? handoff.sourceRoomId : event.roomId
      const previous = await this.deps.store.get<AgentMemoryCapture>('agent_memory_job', jobId)
      const old = previous?.value
      if (old && event.seq <= old.sourceSeq) continue
      const value: AgentMemoryCapture = { id: jobId, phase: 'capture', roomId: event.roomId,
        rootRequestId: rootId, participantAgentId: agentId, memberId, taskScopeId, handoffId: handoff?.id, memoryConversationId,
        budgetRootRequestId: handoff?.sourceRootRequestId ?? rootId, budgetGeneration: handoff?.sourceGeneration ?? topic?.value.generation, generation: topic?.value.generation,
        status: 'pending', attempts: 0, messageIds: [], taskIds: [], ...old,
        sourceSeq: event.seq }
      if (messageId && !value.messageIds.includes(messageId)) value.messageIds = [...value.messageIds, messageId]
      if (reviewId && !value.reviewIds?.includes(reviewId)) value.reviewIds = [...(value.reviewIds ?? []), reviewId]
      if (taskId && !value.taskIds.includes(taskId)) value.taskIds = [...value.taskIds, taskId]
      if (old?.status === 'completed') value.status = value.attempts < 2 ? 'pending' : 'deferred'
      const backlog = !old && !handoff && !taskScopeId ? (await this.deps.store.list<AgentMemoryCapture>('agent_memory_job', {
        roomId: event.roomId, participantAgentId: agentId, phase: 'capture', status: 'deferred', limit: 20
      })).filter((row) => !row.value.handoffId && !row.value.taskScopeId) : []
      for (const row of backlog) {
        value.messageIds = [...new Set([...row.value.messageIds, ...value.messageIds])]
        value.taskIds = [...new Set([...row.value.taskIds, ...value.taskIds])]
        value.reviewIds = [...new Set([...(row.value.reviewIds ?? []), ...(value.reviewIds ?? [])])]
      }
      await this.deps.store.commit({ requestId: agentStableId('agent-capture-event', jobId, String(event.seq)),
        checks: [{ kind: 'agent_memory_job', id: jobId, expectedRevision: previous?.revision ?? null },
          ...backlog.map((row) => ({ kind: 'agent_memory_job' as const, id: row.id, expectedRevision: row.revision }))],
        puts: [{ kind: 'agent_memory_job', id: jobId, roomId: event.roomId, value },
          ...backlog.map((row) => ({ kind: 'agent_memory_job' as const, id: row.id, roomId: row.roomId, value: { ...row.value, status: 'completed', messageIds: [], taskIds: [], reviewIds: [] } }))] })
    }
    if (events.length) await this.deps.store.commit({
      requestId: cursorId + ':' + events.at(-1)!.seq,
      checks: [{ kind: 'agent_memory_job', id: cursorId, expectedRevision: cursor.revision }],
      puts: [{ kind: 'agent_memory_job', id: cursorId, value: { phase: 'cursor', seq: events.at(-1)!.seq } }] })
  }
  private async start(row: RoomStoredDocument<AgentMemoryCapture>) {
    const job = row.value
    try {
      const budgetId = agentStableId('agent-memory-budget', job.participantAgentId, job.budgetRootRequestId ?? job.rootRequestId, String(job.budgetGeneration ?? job.generation ?? 0))
      const budget = await this.deps.store.get<{ attempts: number }>('agent_memory_job', budgetId)
      if ((budget?.value.attempts ?? 0) >= 2) { await this.save(row, { status: 'deferred', error: 'Memory extraction budget exhausted' }); return }
      const snapshot = await prepareAgentMemoryCapture(this.deps, job)
      const runId = agentStableId('agent-memory-run', job.id, String(job.attempts + 1))
      const actor = await this.deps.agentMemory!.agents.get(job.participantAgentId)
      const now = new Date().toISOString()
      const run = RoomRunRecordSchema.parse({ id: runId, roomId: job.roomId, rootRequestId: job.rootRequestId,
        participantAgentId: job.participantAgentId, memberId: job.memberId, memberLabel: actor.name,
        phase: 'memory', attempt: job.attempts + 1, clientRequestId: runId, contextId: job.id,
        input: snapshot.input, status: 'running', createdAt: now, updatedAt: now, startedAt: now,
        model: snapshot.model, usageStatus: 'unavailable' })
      await this.deps.store.commit({ requestId: runId,
        checks: [{ kind: 'agent_memory_job', id: job.id, expectedRevision: row.revision },
          { kind: 'room_run', id: runId, expectedRevision: null },
          { kind: 'agent_memory_job', id: budgetId, expectedRevision: budget?.revision ?? null }],
        puts: [{ kind: 'agent_memory_job', id: job.id, roomId: job.roomId,
          value: { ...job, status: 'running', attempts: job.attempts + 1, runId, snapshot } },
        { kind: 'room_run', id: runId, roomId: job.roomId, value: run },
        { kind: 'agent_memory_job', id: budgetId, value: { phase: 'budget', attempts: (budget?.value.attempts ?? 0) + 1, participantAgentId: job.participantAgentId } }],
        events: [{ roomId: job.roomId, kind: 'room_run.updated', payload: { id: runId } }] })
      const controller = new AbortController()
      const active: Active = { jobId: job.id, controller, done: false, promise: Promise.resolve() }
      const timer = setTimeout(() => controller.abort(new Error('memory extraction timeout')), 20000)
      active.promise = extractAgentMemories(this.deps, snapshot, runId, controller.signal)
        .then((result) => { active.result = result }).finally(() => { clearTimeout(timer); active.done = true })
      this.active = active
    } catch (error) {
      await this.save(row, { attempts: job.attempts + 1, status: job.attempts >= 1 ? 'deferred' : 'pending',
        error: error instanceof Error ? error.message : String(error) })
    }
  }
  private async apply(row: RoomStoredDocument<AgentMemoryCapture>, result: AgentMemoryCaptureResult) {
    const job = row.value, snapshot = job.snapshot!
    const allowed = await this.allowed(job)
    let saved = 0, pending = 0
    if (allowed && !result.error) {
      for (const value of result.candidates) {
        const candidateId = agentStableId('agent-memory-candidate', job.runId!, value.candidate.content)
        const record: AgentMemoryCandidate = { id: candidateId, phase: 'candidate', participantAgentId: job.participantAgentId,
          roomId: job.roomId, rootRequestId: job.rootRequestId, status: 'pending', ...value,
          runId: job.runId!, sourceMessageIds: job.messageIds }
        if (value.action === 'create') {
          const id = agentStableId('mem-agent-auto', job.participantAgentId, job.memoryConversationId ?? job.roomId, job.taskScopeId ?? '', job.handoffId ?? '',
            value.candidate.sources.map((source) => source.id + ':' + source.contentHash).sort().join('|'), value.candidate.content)
          const store = this.deps.agentMemory!.store()
          if (!store.createWithId) throw new Error('idempotent memory storage unavailable')
          const memory = await store.createWithId(id, { ...value.candidate, scope: 'user',
            agentContext: { schemaVersion: 1, agentId: job.participantAgentId, sourceConversationId: job.memoryConversationId ?? job.roomId,
              sourceHandoffId: job.memoryConversationId === job.roomId ? job.handoffId : undefined,
              sourceRootRequestId: job.rootRequestId, sourceTaskId: job.taskScopeId, shared: false, sharedConversationIds: [], sharedProjectRoots: [], locked: false,
              originFingerprint: createHash('sha256').update(JSON.stringify(value.candidate.sources)).digest('hex') },
            provenance: { kind: 'inference', origin: 'agent-memory-capture:' + job.runId } })
          record.status = 'completed'; record.memoryId = memory.id; saved++
        } else {
          const target = value.targetId ? await this.deps.agentMemory!.find(job.participantAgentId, value.targetId) : null
          record.reason = target && target.agentContext?.locked ? 'user_locked' :
            target && canonicalMemoryHash(target) !== value.targetFingerprint ? 'source_changed' : 'conflicting_memory'
          pending++
        }
        await this.deps.store.commit({ requestId: candidateId,
          checks: [{ kind: 'agent_memory_job', id: candidateId, expectedRevision: null }],
          puts: [{ kind: 'agent_memory_job', id: candidateId, roomId: job.roomId, value: record }] })
      }
    }
    const run = await this.deps.store.get('room_run', job.runId!)
    const finished = RoomRunRecordSchema.parse({ ...(run!.value as object),
      status: !allowed ? 'cancelled' : result.error ? 'failed' : 'completed',
      reason: !allowed ? 'source_cancelled' : result.error ?? saved + ' saved; ' + pending + ' need review',
      error: result.error, usage: result.usage, usageStatus: result.usage ? 'complete' : 'unavailable',
      elapsedMs: result.elapsedMs, endedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    await this.deps.store.commit({ requestId: job.runId! + ':finished',
      checks: [{ kind: 'agent_memory_job', id: job.id, expectedRevision: row.revision },
        { kind: 'room_run', id: job.runId!, expectedRevision: run!.revision }],
      puts: [{ kind: 'agent_memory_job', id: job.id, roomId: job.roomId,
        value: { ...job, capturedSeq: result.error ? job.capturedSeq : snapshot.sourceSeq,
          messageIds: result.error ? job.messageIds : job.messageIds.filter((id) => !snapshot.messageIds.includes(id)),
          taskIds: result.error ? job.taskIds : job.taskIds.filter((id) => !snapshot.taskIds.includes(id)),
          reviewIds: result.error ? job.reviewIds : job.reviewIds?.filter((id) => !snapshot.reviewIds?.includes(id)),
          status: !allowed ? 'cancelled' : result.error || job.sourceSeq > snapshot.sourceSeq || job.messageIds.some((id) => !snapshot.messageIds.includes(id)) || job.taskIds.some((id) => !snapshot.taskIds.includes(id)) || job.reviewIds?.some((id) => !snapshot.reviewIds?.includes(id)) ? job.attempts < 2 ? 'pending' : 'deferred' : 'completed',
          error: result.error } },
        { kind: 'room_run', id: job.runId!, roomId: job.roomId, value: finished }],
      events: [{ roomId: job.roomId, kind: 'agent.memory.updated', payload: { agentId: job.participantAgentId } },
        { roomId: job.roomId, kind: 'room_run.updated', payload: { id: job.runId } }] })
  }
}
