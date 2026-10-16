import type { Room } from '../contracts/rooms.js'
import type { RoomRuntimeDeps, RoomRequestState } from '../rooms/room-runtime-types.js'
import type { RoomStoredDocument } from '../rooms/room-store.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { RestartReference } from './agent-lifecycle-handoff.js'
import { directCancellationTarget } from './agent-direct-cancellation.js'
import { roomRunId } from '../rooms/room-run-recording.js'
import { PolicyMutationRejected } from '../domain/remote-policy-revision.js'
import type { ThreadRecord } from '../contracts/threads.js'

export type LifecycleRequestSummary = { privateProtocol?: string; threadId: string; turnId?: string;
  admissionAttempted?: boolean; privateContinuation?: string; status: string; contextGeneration: number; transcriptEpoch: number }
export async function lifecycleQueuedCount(deps: RoomRuntimeDeps, roomId: string) {
  const rows = await deps.store.list<LifecycleRequestSummary>('request', { roomId, status: ['pending', 'running'], lifecycleOnly: true, limit: 1000 })
  const threads = new Map<string, ThreadRecord | null>()
  let count = 0, incomplete = rows.length === 1000
  for (const row of rows) {
    if (!row.value.privateProtocol || row.value.privateContinuation) continue
    if (!row.value.admissionAttempted && !row.value.turnId) { count++; continue }
    if (!threads.has(row.value.threadId)) {
      if (threads.size >= 32) { incomplete = true; continue }
      threads.set(row.value.threadId, await deps.threads.getMetadata(row.value.threadId))
    }
    const thread = threads.get(row.value.threadId)
    if (thread?.turns.some(turn => turn.id === row.value.turnId && turn.status === 'queued')) count++
  }
  return { count, incomplete }
}
/** Query live indexed records, never scan/retain the entire private transcript to restart a long-lived Agent. */
export async function lifecycleTargets(deps: RoomRuntimeDeps, room: Room) {
  const summaries = await deps.store.list<LifecycleRequestSummary>('request', { roomId: room.id,
    status: ['running', 'stopping', 'recovery_required', 'needs_input'], privateGeneration: room.privateContextGeneration ?? 0, lifecycleOnly: true, limit: 129 })
  if (summaries.length > 128) throw new PolicyMutationRejected('TASK_BUSY')
  const rows = new Map<string, RoomStoredDocument<RoomRequestState>>()
  for (const summary of summaries) if (summary.value.privateProtocol) {
    const row = await deps.store.get<RoomRequestState>('request', summary.id)
    if (!row || row.revision !== summary.revision) throw new PolicyMutationRejected('REVISION_CONFLICT')
    rows.set(row.id, row)
  }
  // Terminal public status is not proof that native/background work has stopped.
  const executions = [...deps.turns['deps'].inflight.list(), ...(deps.activeBackgroundTurns?.() ?? [])]
  for (const execution of executions.slice(0, 256)) {
    const thread = await deps.threads.getMetadata(execution.threadId)
    if (thread?.roomContext?.kind !== 'conversation' || thread.roomContext.roomId !== room.id) continue
    if (!execution.turnId) throw new PolicyMutationRejected('TASK_BUSY')
    const turn = thread.turns.find(item => item.id === execution.turnId)
    if (!turn?.clientRequestId) throw new Error('AGENT_EXECUTION_IDENTITY_UNAVAILABLE')
    const run = await deps.store.get<RoomRunRecord>('room_run', roomRunId(room.id, turn.clientRequestId))
    const row = run?.value.requestId ? await deps.store.get<RoomRequestState>('request', run.value.requestId) : null
    if (!row || row.roomId !== room.id || !row.value.privateProtocol) throw new Error('AGENT_EXECUTION_IDENTITY_UNAVAILABLE')
    rows.set(row.id, row)
  }
  if (executions.length > 256 || rows.size > 128) throw new PolicyMutationRejected('TASK_BUSY')
  const targets: RoomStoredDocument<RoomRequestState>[] = [], references: RestartReference[] = []
  let queued = Boolean((await deps.store.list('request', { roomId: room.id, status: 'pending', lifecycleOnly: true, limit: 1 })).length)
  let bytes = 0
  for (const row of rows.values()) {
    const target = await directCancellationTarget(deps, row.value)
    const background = Boolean(deps.activeBackgroundTurns?.().some(item => item.threadId === row.value.threadId && item.turnId === target.turn?.id))
    if (target.turn?.status === 'queued' && !deps.turns.isTurnExecutionActive(target.turn.id) && !background) { queued = true; continue }
    bytes += Buffer.byteLength(JSON.stringify(row.value))
    if (bytes > 4 * 1024 * 1024) throw new PolicyMutationRejected('TASK_BUSY')
    targets.push(row)
    if (target.turn && (row.value.roomSnapshot.privateEpoch ?? 0) === (room.privateEpoch ?? 0))
      references.push({ requestId: row.id, threadId: row.value.threadId, turnId: target.turn.id })
  }
  const recent = await deps.store.list<RoomRunRecord>('room_run', { roomId: room.id, phase: 'conversation',
    status: ['running', 'completed', 'failed', 'cancelled', 'recovery_required'], summaryOnly: true, limit: 4 })
  for (const run of recent.reverse()) {
    const row = run.value.requestId ? await deps.store.get<RoomRequestState>('request', run.value.requestId) : null
    if (!row?.value.privateProtocol || (row.value.roomSnapshot.privateEpoch ?? 0) !== (room.privateEpoch ?? 0) ||
      !run.value.threadId || !run.value.turnId) continue
    if (!references.some(ref => ref.threadId === run.value.threadId && ref.turnId === run.value.turnId))
      references.unshift({ requestId: row.id, threadId: run.value.threadId, turnId: run.value.turnId })
  }
  return { targets, references: references.slice(-4), queuePaused: queued }
}
