import { randomUUID } from 'node:crypto'
import { RoomRunRecordSchema, type RoomRunRecord } from '../contracts/room-runs.js'
import { roomRunId } from './room-run-recording.js'
import type { RoomRequestState, RoomRuntimeDeps } from './room-runtime-types.js'
import type { RoomStoreCommit, RoomStoredDocument } from './room-store.js'
import { RoomStoreConflictError } from './room-store.js'

type SettlementDeps = Pick<RoomRuntimeDeps, 'store' | 'threads'>
const PAGE_SIZE = 100

/** Release only a private reservation whose exact request never attempted admission. */
async function appendRunSettlement(deps: SettlementDeps, commit: RoomStoreCommit,
  requestRow: RoomStoredDocument<RoomRequestState>, value: RoomRequestState,
  runRow: RoomStoredDocument<RoomRunRecord>): Promise<boolean> {
  const status = value.status
  if (status !== 'failed' && status !== 'cancelled') return false
  const request = requestRow.value, run = runRow.value
  const member = value.roomSnapshot.members.find(item => item.id === value.roomSnapshot.defaultMemberId)
  const clientRequestId = 'private-' + value.id + '-' + (value.stepAttempt ?? 0)
  if (request.privateProtocol !== 'direct-v1' || value.privateProtocol !== 'direct-v1' ||
    requestRow.id !== value.id || request.id !== value.id || requestRow.roomId !== value.roomId ||
    request.roomId !== value.roomId || value.roomSnapshot.id !== value.roomId ||
    value.roomSnapshot.conversationKind !== 'user_agent' || !member?.participantAgentId ||
    request.admissionAttempted || value.admissionAttempted || request.turnId || value.turnId ||
    request.steer || value.steer || run.admissionAttempted || run.turnId || run.startedAt || run.endedAt ||
    run.mergedIntoRunId || run.publishedMessageId || run.outcome === 'published' ||
    runRow.id !== roomRunId(value.roomId, clientRequestId) || run.id !== runRow.id ||
    value.privateRunId && value.privateRunId !== run.id ||
    runRow.roomId !== value.roomId || run.roomId !== value.roomId || run.requestId !== value.id ||
    run.rootRequestId !== (value.rootRequestId ?? value.id) || run.memberId !== member.id ||
    run.participantAgentId !== member.participantAgentId || run.phase !== 'conversation' ||
    run.clientRequestId !== clientRequestId || run.status !== 'queued' ||
    !run.threadId || run.threadId !== value.threadId) return false

  // A lost receipt or unreadable thread is not proof that execution never began.
  let thread
  try { thread = await deps.threads.getMetadata(run.threadId) } catch { return false }
  if (!thread || thread.id !== run.threadId || thread.roomContext?.kind !== 'conversation' ||
    thread.roomContext.roomId !== run.roomId || thread.roomContext.memberId !== run.memberId ||
    thread.roomContext.participantAgentId !== run.participantAgentId ||
    thread.turns.some(turn => turn.clientRequestId === clientRequestId)) return false

  const now = new Date().toISOString()
  commit.checks ??= []; commit.puts ??= []; commit.events ??= []
  commit.checks.push({ kind: 'room_run', id: runRow.id, expectedRevision: runRow.revision })
  commit.puts.push({ kind: 'room_run', id: runRow.id, roomId: runRow.roomId, taskId: runRow.taskId,
    value: RoomRunRecordSchema.parse({ ...run, status, outcome: status,
      admissionAttempted: false, error: (value.error ?? run.error)?.slice(0, 4000), endedAt: now, updatedAt: now }) })
  commit.events.push({ roomId: run.roomId, kind: 'room_run.updated',
    payload: { id: run.id, rootRequestId: run.rootRequestId, memberId: run.memberId } })
  return true
}

/** Persist the failed/cancelled request and its unadmitted reservation atomically. */
export async function savePrivateRequestWithRunSettlement(deps: SettlementDeps,
  row: RoomStoredDocument<RoomRequestState>, value: RoomRequestState): Promise<void> {
  const commit: RoomStoreCommit = { requestId: randomUUID(),
    checks: [{ kind: 'request', id: row.id, expectedRevision: row.revision }],
    puts: [{ kind: 'request', id: row.id, roomId: row.roomId, value }],
    events: [{ roomId: value.roomId, kind: 'request.updated', payload: { id: row.id } }] }
  if (value.status === 'failed' || value.status === 'cancelled') {
    const id = roomRunId(value.roomId, 'private-' + value.id + '-' + (value.stepAttempt ?? 0))
    const run = await deps.store.get<RoomRunRecord>('room_run', id)
    if (run) await appendRunSettlement(deps, commit, row, value, run)
  }
  await deps.store.commit(commit)
}

/** Owned producer repair: process one page and retain a cursor past protected reservations. */
export async function reconcileTerminalPrivateRuns(deps: SettlementDeps,
  afterSeq?: number): Promise<number | undefined> {
  const rows = await deps.store.list<RoomRunRecord>('room_run', {
    phase: 'conversation', status: 'queued', order: 'asc', afterSeq, limit: PAGE_SIZE, summaryOnly: true
  })
  for (const summary of rows) {
    for (let attempt = 0; attempt < 3; attempt++) {
      // Summary projections truncate input; never use them as the value to persist.
      const run = await deps.store.get<RoomRunRecord>('room_run', summary.id)
      if (!run?.value.requestId) break
      const request = await deps.store.get<RoomRequestState>('request', run.value.requestId)
      if (!request || !['failed', 'cancelled'].includes(request.value.status)) break
      const commit: RoomStoreCommit = { requestId: randomUUID(),
        checks: [{ kind: 'request', id: request.id, expectedRevision: request.revision }] }
      if (!await appendRunSettlement(deps, commit, request, request.value, run)) break
      try {
        await deps.store.commit(commit)
        break
      } catch (error) {
        if (!(error instanceof RoomStoreConflictError)) throw error
        // Re-read both records and all guards, rather than replaying a stale patch.
      }
    }
  }
  return rows.length === PAGE_SIZE ? rows.at(-1)!.seq : undefined
}
