import { createHash, randomUUID } from 'node:crypto'
import { RoomRunRecordSchema, type RoomRunRecord } from '../contracts/room-runs.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomRuntimeDeps, RoomRequestState, RoomTaskExecution } from './room-runtime-types.js'
import type { RoomStore, RoomStoreCommit } from './room-store.js'
import { RoomStoreConflictError } from './room-store.js'
import { captureRoomTurnUsageBaseline, readRoomTurnUsage } from './room-run-usage.js'

export const roomRunId = (roomId: string, clientRequestId: string, triage = false): string =>
  'run-' + createHash('sha256').update(JSON.stringify([roomId, clientRequestId, triage])).digest('hex').slice(0, 40)
export type RoomRunAdmission = Partial<Pick<RoomRunRecord,
  'phase' | 'requestId' | 'rootRequestId' | 'triggerMessageId' | 'contextId' | 'generation' |
  'attempt' | 'previousRunId' | 'integrationId' | 'integrationStage' | 'input'>>

async function retry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await work() } catch (error) {
      if (!(error instanceof RoomStoreConflictError) || attempt >= 5) throw error
    }
  }
}

/** The durable receipt is created before calling the shared turn queue. */
export async function prepareRoomRun(deps: RoomRuntimeDeps, thread: ThreadRecord,
  clientRequestId: string, prompt: string, attachmentIds: string[], override: RoomRunAdmission = {}): Promise<RoomRunRecord> {
  const scope = thread.roomContext!
  const id = roomRunId(scope.roomId, clientRequestId)
  const old = await deps.store.get<RoomRunRecord>('room_run', id)
  if (old) {
    const snapshot = await deps.store.get<{ prompt: string; attachmentIds: string[] }>('context',
      old.value.threadId ? id + '-input' : old.value.contextId ?? id + '-input') ??
      await deps.store.get<{ prompt: string; attachmentIds: string[] }>('context', old.value.contextId ?? id + '-input')
    if (old.value.threadId && old.value.threadId !== thread.id || old.value.memberId !== scope.memberId ||
      snapshot?.value.prompt !== prompt || JSON.stringify(snapshot.value.attachmentIds) !== JSON.stringify(attachmentIds)) {
      throw new Error('Room run identity was reused with different input')
    }
    if (!old.value.threadId) await updateRoomRun(deps.store, id, { threadId: thread.id, model: thread.model,
      ...await captureRoomTurnUsageBaseline(deps, thread.id), ...override })
    return (await deps.store.get<RoomRunRecord>('room_run', id))!.value
  }
  const task = scope.taskId ? await deps.store.get<RoomTaskExecution>('task', scope.taskId) : null
  const requestId = override.requestId ?? scope.requestId ?? task?.value.task.requestId
  const request = requestId ? await deps.store.get<RoomRequestState>('request', requestId) : null
  const trigger = request?.value.sourceMessageId
    ? await deps.store.get<RoomMessage>('message', override.triggerMessageId ?? request.value.sourceMessageId) : null
  const phase = override.phase ?? scope.kind
  const rootRequestId = override.rootRequestId ?? scope.rootRequestId ?? request?.value.rootRequestId ?? requestId
  const previous = (await deps.store.list<RoomRunRecord>('room_run', {
    roomId: scope.roomId, rootRequestId, memberId: scope.memberId, taskId: scope.taskId, phase, limit: 1
  }))[0]
  const now = new Date().toISOString()
  const run = RoomRunRecordSchema.parse({ id, roomId: scope.roomId, taskId: scope.taskId,
    requestId, rootRequestId, memberId: scope.memberId,
    memberLabel: request?.value.roomSnapshot.members.find((member) => member.id === scope.memberId)?.displayName ??
      task?.value.task.memberSnapshot.displayName ?? thread.title ?? scope.memberId,
    phase, attempt: override.attempt ?? (previous?.value.attempt ?? 0) + 1,
    previousRunId: override.previousRunId ?? previous?.id, clientRequestId, threadId: thread.id,
    triggerMessageId: trigger?.id ?? request?.value.sourceMessageId, triggerMessageRevision: trigger?.value.bodyRevision,
    triggerSource: trigger ? { kind: 'message', id: trigger.id, version: trigger.value.bodyRevision } : undefined, contextId: id + '-input',
    input: (task?.value.prompt ?? request?.value.originalMessage?.body ?? request?.value.message.body ?? prompt).slice(0, 64000),
    attachmentIds, status: 'queued', createdAt: now, updatedAt: now, model: thread.model,
    ...await captureRoomTurnUsageBaseline(deps, thread.id), ...override })
  return retry(async () => {
    const current = await deps.store.get<RoomRunRecord>('room_run', id)
    if (current) return current.value
    await deps.store.commit({ requestId: id + '-create',
      checks: [{ kind: 'room_run', id, expectedRevision: null }, { kind: 'context', id: id + '-input', expectedRevision: null }],
      puts: [{ kind: 'room_run', id, roomId: run.roomId, taskId: run.taskId, value: run },
        { kind: 'context', id: id + '-input', roomId: run.roomId, taskId: run.taskId,
          value: { id: id + '-input', roomId: run.roomId, rootRequestId, memberId: run.memberId, prompt, attachmentIds } }],
      events: [{ roomId: run.roomId, kind: 'room_run.updated', payload: { id, rootRequestId, memberId: run.memberId } }] })
    return run
  })
}

export async function updateRoomRun(store: RoomStore, id: string,
  patch: Partial<RoomRunRecord>): Promise<void> {
  await retry(async () => {
    const row = await store.get<RoomRunRecord>('room_run', id)
    if (!row) return
    if (patch.turnId && row.value.turnId && row.value.turnId !== patch.turnId) throw new Error('Room run turn identity changed')
    if (patch.threadId && row.value.threadId && row.value.threadId !== patch.threadId) throw new Error('Room run thread identity changed')
    // Observation/usage acknowledgements may arrive after publication has atomically finished the run.
    if (row.value.outcome === 'published' && patch.outcome && patch.outcome !== 'published') patch = { ...patch, outcome: 'published' }
    if (['completed', 'failed', 'cancelled'].includes(row.value.status) &&
      (patch.status === 'running' || patch.status === 'queued')) {
      patch = { ...patch, status: row.value.status, startedAt: row.value.startedAt, endedAt: row.value.endedAt }
    }
    const value = RoomRunRecordSchema.parse({ ...row.value, ...patch })
    if (JSON.stringify(value) === JSON.stringify(row.value)) return
    value.updatedAt = new Date().toISOString()
    await store.commit({ requestId: randomUUID(), checks: [{ kind: 'room_run', id, expectedRevision: row.revision }],
      puts: [{ kind: 'room_run', id, roomId: value.roomId, taskId: value.taskId, value }],
      events: [{ roomId: value.roomId, kind: 'room_run.updated', payload: { id, rootRequestId: value.rootRequestId, memberId: value.memberId } }] })
  })
}

/** Called by runtime producers only. Read-only query code must never call this observer. */
export async function observeRecordedRoomTurn(deps: RoomRuntimeDeps, thread: ThreadRecord, turn: Turn): Promise<void> {
  if (!thread.roomContext || !turn.clientRequestId) return
  const id = roomRunId(thread.roomContext.roomId, turn.clientRequestId)
  const row = await deps.store.get<RoomRunRecord>('room_run', id)
  if (!row) return // Historical runs are resolved explicitly by the read path, never guessed here.
  const status = turn.status === 'aborted' ? 'cancelled' : turn.status
  const patch: Partial<RoomRunRecord> = { turnId: turn.id, status, startedAt: turn.startedAt,
    endedAt: turn.finishedAt }
  if (turn.startedAt && turn.finishedAt) patch.elapsedMs = Math.max(0, Date.parse(turn.finishedAt) - Date.parse(turn.startedAt))
  if (turn.finishedAt && row.value.usageStatus !== 'complete') {
    const accounting = await readRoomTurnUsage(deps, { ...row.value, threadId: thread.id, turnId: turn.id })
    patch.model = accounting.model ?? row.value.model ?? thread.model
    // Unavailable telemetry is not evidence that a known model or partial usage disappeared.
    if (accounting.usage) {
      patch.usage = accounting.usage
      patch.usageStatus = accounting.usageStatus
    } else if (!row.value.usage) patch.usageStatus = accounting.usageStatus
  }
  await updateRoomRun(deps.store, id, patch)
}

/** Add provenance and its publication result to the same message transaction. */
export async function attachRoomRunPublication(store: RoomStore, commit: RoomStoreCommit,
  message: RoomMessage, runId?: string): Promise<void> {
  if (!runId) return
  const row = await store.get<RoomRunRecord>('room_run', runId)
  if (!row || row.roomId !== message.roomId || row.value.memberId !== message.authorMemberId || !row.value.turnId ||
    (row.value.taskId && row.value.taskId !== message.taskId)) {
    throw new Error('Message run provenance does not match its room and member')
  }
  if (row.value.publishedMessageId && row.value.publishedMessageId !== message.id) throw new Error('Run already published another message')
  if (message.originRunId && message.originRunId !== runId) throw new Error('Message run provenance is immutable')
  message.originRunId = runId
  message.rootRequestId = row.value.rootRequestId
  message.sourceRequestId = row.value.requestId
  commit.checks ??= []; commit.puts ??= []; commit.events ??= []
  commit.checks.push({ kind: 'room_run', id: runId, expectedRevision: row.revision })
  commit.puts.push({ kind: 'room_run', id: runId, roomId: row.roomId, taskId: row.taskId,
    value: { ...row.value, outcome: 'published', publishedMessageId: message.id, updatedAt: new Date().toISOString() } })
  commit.events.push({ roomId: message.roomId, kind: 'room_run.updated', payload: { id: runId, memberId: row.value.memberId } })
}

export async function roomTurnRunId(deps: RoomRuntimeDeps, roomId: string, threadId: string,
  turnId?: string): Promise<string | undefined> {
  if (!turnId) return undefined
  const thread = await deps.threads.getMetadata(threadId)
  const turn = thread?.turns.find((candidate) => candidate.id === turnId)
  if (!turn?.clientRequestId || thread?.roomContext?.roomId !== roomId) return undefined
  const id = roomRunId(roomId, turn.clientRequestId)
  const run = await deps.store.get<RoomRunRecord>('room_run', id)
  return run?.value.threadId === threadId && run.value.turnId === turnId ? id : undefined
}

/** Cancellation/recovery producers settle retained records even after transient activity was cleared. */
export async function reconcileRecordedRoomRuns(deps: RoomRuntimeDeps,
  filter: { roomId: string; requestId?: string; threadId?: string }): Promise<void> {
  let afterSeq: number | undefined
  for (;;) {
    const rows = await deps.store.list<RoomRunRecord>('room_run', { ...filter, afterSeq, order: 'asc', limit: 100,
      status: ['queued', 'running', 'recovery_required'] })
    for (const row of rows) {
      if (!row.value.threadId) continue
      const thread = await deps.threads.getMetadata(row.value.threadId)
      if (thread?.roomContext?.roomId !== row.value.roomId || thread.roomContext.memberId !== row.value.memberId) continue
      const turn = thread.turns.find((value) => row.value.turnId ? value.id === row.value.turnId : value.clientRequestId === row.value.clientRequestId)
      if (turn?.clientRequestId === row.value.clientRequestId) await observeRecordedRoomTurn(deps, thread, turn)
      else if (row.value.admissionAttempted) await updateRoomRun(deps.store, row.id, { status: 'recovery_required' })
    }
    if (rows.length < 100) return
    afterSeq = rows.at(-1)!.seq
  }
}
