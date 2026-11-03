import { lifecycleTargets, lifecycleQueuedCount } from './agent-lifecycle-targets.js'
import { captureRestartHandoff } from './agent-lifecycle-handoff.js'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { PolicyMutationRejected } from '../domain/remote-policy-revision.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import { currentAgentConversation } from './agent-conversations.js'
import { agentStableId } from './agent-identity-service.js'
import { directCancellationTarget } from './agent-direct-cancellation.js'
import { AgentLifecycleState, agentLifecycleId, contextGeneration } from './agent-lifecycle-state.js'
import type { RoomRuntime } from '../rooms/room-runtime.js'
import type { RoomRequestState } from '../rooms/room-runtime-types.js'
import type { Room } from '../contracts/rooms.js'

const Target = z.object({ requestId: z.string(), threadId: z.string(), turnId: z.string().optional() }).strict()
const Operation = z.object({ kind: z.literal('restart'), status: z.enum(['pending', 'applied']), agentId: z.string(),
  roomId: z.string(), clientRequestId: z.string(), fingerprint: z.string(), generation: z.number().int().positive(),
  targets: z.array(Target).max(128), references: z.array(Target).max(4), epoch: z.number().int().nonnegative(), createdAt: z.string(), result: z.unknown().optional() }).strict()
type Operation = z.infer<typeof Operation>
const revision = (value: number) => 'agent-life-v1:' + value

/** Manager-owned lifecycle intents. No cloud transport, model request or application restart. */
export class AgentLifecycleService {
  private work = new Map<string, Promise<boolean>>()
  private timer?: ReturnType<typeof setTimeout>
  private closed = false
  constructor(private rooms: RoomRuntime) {}
  async get(agentId: string) {
    const agent = await this.rooms.agents.get(agentId)
    const state = await this.rooms.deps.store.get<AgentLifecycleState>('agent_lifecycle', agentLifecycleId(agentId))
    const room = await currentAgentConversation(this.rooms.agents, agentId)
    let queuedCount = 0, queuedCountAtLeast = false
    const currentState = state && room && state.value.roomId === room.id ? state.value : undefined
    if (room) {
      const queued = await lifecycleQueuedCount(this.rooms.deps, room.id)
      queuedCount = queued.count; queuedCountAtLeast = queued.incomplete
    }
    return { agentId, agentRevision: agent.revision, lifecycleRevision: revision(state?.revision ?? 0),
      state: currentState?.state ?? 'active', contextGeneration: room ? contextGeneration(room.value) : 0,
      queuePaused: Boolean(currentState?.queuePaused), queuedCount, ...(queuedCountAtLeast ? { queuedCountAtLeast: true } : {}),
      actions: !agent.archivedAt && room && !room.value.archivedAt && currentState?.state !== 'restarting' ? ['restart'] : [] }
  }
  async restart(input: { agentId: string; expectedRevision: number; expectedLifecycleRevision: string; clientRequestId: string }) {
    if (this.closed) throw new Error('AGENT_LIFECYCLE_CLOSED')
    const id = agentStableId('agent-restart', input.agentId, input.clientRequestId)
    return withManagerDataMutex('agent-lifecycle:' + input.agentId, async () => {
      const prior = await this.rooms.deps.store.get<Operation>('agent_lifecycle', id)
      if (prior && prior.value.fingerprint !== createHash('sha256').update(JSON.stringify(input)).digest('hex')) throw new Error('REQUEST_CONFLICT')
      if (!prior) await this.prepare(input, id)
      return this.finish(id)
    })
  }
  private async prepare(input: { agentId: string; expectedRevision: number; expectedLifecycleRevision: string; clientRequestId: string }, id: string) {
    return this.rooms.exclusive(async () => {
      const store = this.rooms.deps.store, agent = await this.rooms.agents.active(input.agentId)
      const room = await currentAgentConversation(this.rooms.agents, agent.id)
      const state = await store.get<AgentLifecycleState>('agent_lifecycle', agentLifecycleId(agent.id))
      if (agent.revision !== input.expectedRevision || revision(state?.revision ?? 0) !== input.expectedLifecycleRevision)
        throw new PolicyMutationRejected('REVISION_CONFLICT')
      if (!room || room.value.archivedAt || state?.value.state === 'restarting') throw new PolicyMutationRejected('INVALID_REQUEST')
      const { targets, references, queuePaused } = await lifecycleTargets(this.rooms.deps, room.value)
      const generation = contextGeneration(room.value) + 1
      const now = new Date().toISOString()
      const operation: Operation = { kind: 'restart', status: 'pending', agentId: agent.id, roomId: room.id,
        generation, references, epoch: room.value.privateEpoch ?? 0, clientRequestId: input.clientRequestId, fingerprint: createHash('sha256').update(JSON.stringify(input)).digest('hex'), createdAt: now,
        targets: targets.map(row => ({ requestId: row.id, threadId: row.value.threadId, turnId: row.value.turnId })) }
      await store.commit({ requestId: id + '-prepare', checks: [
        { kind: 'agent_identity', id: agent.id, expectedRevision: agent.revision },
        { kind: 'room', id: room.id, expectedRevision: room.revision },
        { kind: 'agent_lifecycle', id, expectedRevision: null },
        { kind: 'agent_lifecycle', id: agentLifecycleId(agent.id), expectedRevision: state?.revision ?? null },
        ...targets.map(row => ({ kind: 'request' as const, id: row.id, expectedRevision: row.revision }))],
        puts: [{ kind: 'agent_lifecycle', id, roomId: room.id, value: operation },
          { kind: 'agent_lifecycle', id: agentLifecycleId(agent.id), roomId: room.id,
            value: { kind: 'state', agentId: agent.id, roomId: room.id, state: 'restarting', generation,
              operationId: id, queuePaused, updatedAt: now } satisfies AgentLifecycleState },
          { kind: 'room', id: room.id, roomId: room.id, value: { ...room.value, revision: room.revision + 1, updatedAt: now } },
          ...targets.map(row => ({ kind: 'request' as const, id: row.id, roomId: room.id, value: { ...row.value,
            cancellationRequested: true, status: row.value.admissionAttempted || row.value.turnId ? 'stopping' : 'cancelled' } }))],
        events: [{ roomId: room.id, kind: 'agent.lifecycle.updated', payload: { agentId: agent.id, state: 'restarting' } }] })
      this.rooms.wake()
    })
  }
  private async stop(target: Operation['targets'][number]): Promise<boolean> {
    const deps = this.rooms.deps, row = await deps.store.get<RoomRequestState>('request', target.requestId)
    if (!row || !row.value.cancellationRequested) return false
    const resolved = await directCancellationTarget(deps, row.value)
    if (!resolved.turn) return !row.value.admissionAttempted && !target.turnId
    const { thread, turn } = resolved
    const key = thread!.id + ':' + turn.id
    let work = this.work.get(key)
    if (!work) {
      if (this.work.size >= 128) return false
      work = (async () => {
        if (['queued', 'running'].includes(turn.status)) await deps.turns.interruptTurn({ threadId: thread!.id, turnId: turn.id })
        await deps.stopBackgroundExecution?.(thread!.id, turn.id)
        if (deps.turns['deps'].inflight.list().some(item => item.threadId === thread!.id && item.turnId === turn.id)) return false
        if (deps.proveTurnStopped) return deps.proveTurnStopped(thread!.id, turn.id)
        const fresh = (await deps.threads.getMetadata(thread!.id))?.turns.find(item => item.id === turn.id)
        return Boolean(fresh && ['completed', 'failed', 'aborted'].includes(fresh.status) &&
          !deps.turns.isTurnExecutionActive(turn.id) && !deps.backgroundExecutionActive?.(thread!.id) &&
          !await deps.turns['deps'].executionLeases?.owner(thread!.id))
      })().catch(() => false)
      this.work.set(key, work)
      const captured = work
      void work.finally(() => { if (this.work.get(key) === captured) this.work.delete(key) })
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([work, new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 1000) })]) }
    finally { clearTimeout(timer) }
  }
  private async finish(id: string) {
    const store = this.rooms.deps.store, saved = await store.get<Operation>('agent_lifecycle', id)
    if (!saved) return undefined
    const operation = Operation.parse(saved.value)
    if (id !== agentStableId('agent-restart', operation.agentId, operation.clientRequestId) || this.closed) return undefined
    if (operation.result) return operation.result
    const deadline = Date.now() + 4000
    for (const target of operation.targets) if (Date.now() >= deadline || !await this.stop(target)) return undefined
    if (this.closed) return undefined
    const handoffId = id + '-handoff', handoff = await captureRestartHandoff(this.rooms.deps, operation.roomId, operation.epoch, operation.generation, operation.references)
    return this.rooms.exclusive(async () => {
      if (this.closed) return undefined
      const row = await store.get<Operation>('agent_lifecycle', id)
      if (row?.value.result) return row.value.result
      const state = await store.get<AgentLifecycleState>('agent_lifecycle', agentLifecycleId(operation.agentId))
      const room = await store.get<Room>('room', operation.roomId)
      if (!row || !state || state.value.operationId !== id || state.value.state !== 'restarting' ||
        !room || contextGeneration(room.value) !== operation.generation - 1) return undefined
      const result = { agentId: operation.agentId, state: 'active', lifecycleRevision: revision(state.revision + 1),
        contextGeneration: operation.generation, queuePaused: state.value.queuePaused,
        preserved: { history: true, memory: true, files: true, delegatedTasks: true }, restarted: true }
      await store.commit({ requestId: id + '-finish', checks: [
        { kind: 'agent_lifecycle', id, expectedRevision: row.revision },
        { kind: 'agent_lifecycle', id: state.id, expectedRevision: state.revision },
        { kind: 'room', id: room.id, expectedRevision: room.revision },
        { kind: 'context', id: handoffId, expectedRevision: null }], puts: [
        { kind: 'agent_lifecycle', id, roomId: room.id, value: { ...row.value, status: 'applied', result } },
        { kind: 'agent_lifecycle', id: state.id, roomId: room.id,
          value: { ...state.value, state: 'active', handoffId, updatedAt: new Date().toISOString() } },
        { kind: 'context', id: handoffId, roomId: room.id, value: handoff },
        { kind: 'room', id: room.id, roomId: room.id, value: { ...room.value, revision: room.revision + 1,
          privateContextGeneration: operation.generation, updatedAt: new Date().toISOString() } }],
        events: [{ roomId: room.id, kind: 'agent.lifecycle.updated', payload: { agentId: operation.agentId, state: 'active' } }] })
      return result
    })
  }
  async recover(agentId: string, clientRequestId: string) {
    return withManagerDataMutex('agent-lifecycle:' + agentId, () => this.finish(agentStableId('agent-restart', agentId, clientRequestId)))
  }
  start() { this.closed = false; this.schedule(0) }
  private schedule(attempt: number) {
    if (this.closed || attempt > 4) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void (async () => {
        const rows = await this.rooms.deps.store.list<Operation>('agent_lifecycle', { status: 'pending', limit: 8 })
        for (const row of rows) if (!this.closed && row.value.kind === 'restart') await this.recover(row.value.agentId, row.value.clientRequestId)
        if (rows.length) this.schedule(attempt + 1)
      })().catch(() => this.schedule(attempt + 1))
    }, [0, 1000, 5000, 30000, 60000][attempt])
    this.timer.unref?.()
  }
  close() { this.closed = true; clearTimeout(this.timer) }
}
