import type { RoomRuntime } from '../rooms/room-runtime.js'
import type { RoomRuntimeDeps, RoomRequestState } from '../rooms/room-runtime-types.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { roomRunId } from '../rooms/room-run-recording.js'
import { roomFingerprint } from '../rooms/room-service.js'
import { RoomStoreConflictError, type RoomStoreCommit, type RoomStoredDocument } from '../rooms/room-store.js'
import { TurnConflictError } from '../services/turn-service.js'

/** Resolve only this request's admitted execution, never the thread's newest turn. */
export async function directCancellationTarget(deps: RoomRuntimeDeps, request: RoomRequestState) {
  let owner: RoomStoredDocument<RoomRequestState> | undefined
  let clientRequestId = 'private-' + request.id + '-' + (request.stepAttempt ?? 0)
  let turnId = request.turnId
  if (request.steer) {
    const run = await deps.store.get<RoomRunRecord>('room_run', request.steer.targetRunId)
    if (!run || run.roomId !== request.roomId || run.value.phase !== 'conversation' ||
      run.value.threadId !== request.threadId || run.value.turnId !== request.steer.targetTurnId ||
      run.id !== roomRunId(request.roomId, run.value.clientRequestId) || !run.value.requestId) return {}
    const source = await deps.store.get<RoomRequestState>('request', run.value.requestId)
    if (!source || source.roomId !== request.roomId || !source.value.privateProtocol || source.value.steer ||
      source.value.threadId !== request.threadId || source.value.privateRunId !== run.id ||
      source.value.turnId && source.value.turnId !== run.value.turnId ||
      run.value.clientRequestId !== 'private-' + source.id + '-' + (source.value.stepAttempt ?? 0)) return {}
    owner = source
    clientRequestId = run.value.clientRequestId
    turnId = run.value.turnId
  }
  const thread = await deps.threads.getMetadata(request.threadId)
  if (thread?.roomContext?.kind !== 'conversation' || thread.roomContext.roomId !== request.roomId) return { owner }
  const turn = thread.turns.find((candidate) => candidate.clientRequestId === clientRequestId &&
    (!turnId || candidate.id === turnId))
  return { owner, thread, turn }
}

async function interruptCancelledRequest(rooms: RoomRuntime, request: RoomRequestState) {
  if (!request.cancellationRequested || request.status !== 'stopping') return
  const { thread, turn } = await directCancellationTarget(rooms.deps, request)
  if (!thread || !turn || !['queued', 'running'].includes(turn.status)) return
  try { await rooms.deps.turns.interruptTurn({ threadId: thread.id, turnId: turn.id }) }
  catch (error) { if (!(error instanceof TurnConflictError)) throw error }
}

/** Durable cancellation fences publication before interrupting the exact local execution. */
export async function stopDirectRequest(rooms: RoomRuntime, roomId: string, requestId: string,
  input: { action: 'stop'; clientRequestId: string; expectedRevision: number }) {
  const store = rooms.deps.store, key = 'private-control:' + input.clientRequestId
  const fingerprint = roomFingerprint({ roomId, requestId, ...input })
  try {
    for (let attempt = 0; ; attempt++) {
      const prior = await store.getRequest(key)
      // Older Stop receipts omitted their target from the hash; their durable
      // request.updated event still proves which exact request they cancelled.
      const legacyReplay = prior?.fingerprint === roomFingerprint(input) && prior.events.some((event) =>
        event.roomId === roomId && event.kind === 'request.updated' &&
        (event.payload as { id?: string })?.id === requestId)
      if (prior && prior.fingerprint !== fingerprint && !legacyReplay) throw new RoomStoreConflictError('request changed')
      const row = await store.get<RoomRequestState>('request', requestId)
      if (!row || row.roomId !== roomId || !row.value.privateProtocol) throw new Error('Private request not found')
      if (prior) {
        // A lost response may follow a durable cancel but precede interruption.
        await interruptCancelledRequest(rooms, row.value)
        return prior.result ?? { accepted: true }
      }
      if (input.expectedRevision > row.revision) throw new RoomStoreConflictError('request revision is ahead of the original execution')
      if (['completed', 'failed', 'cancelled'].includes(row.value.status)) return { accepted: true, alreadyFinished: true }
      const target = await directCancellationTarget(rooms.deps, row.value)
      const rows = target.owner && target.owner.id !== row.id ? [row, target.owner] : [row]
      const commit: RoomStoreCommit = { requestId: key, fingerprint, checks: [], puts: [], events: [], result: { accepted: true } }
      for (const current of rows) {
        commit.checks!.push({ kind: 'request', id: current.id, expectedRevision: current.revision })
        // Stopping a merged input revokes its response owner's publication in the same transaction.
        if (current.id !== row.id && ['completed', 'failed', 'cancelled'].includes(current.value.status)) continue
        commit.puts!.push({ kind: 'request', id: current.id, roomId,
          value: { ...current.value, cancellationRequested: true, status: 'stopping' } })
        commit.events!.push({ roomId, kind: 'request.updated', payload: { id: current.id } })
      }
      try { await store.commit(commit) }
      catch (error) {
        if (error instanceof RoomStoreConflictError && attempt < 5) continue
        throw error
      }
      await interruptCancelledRequest(rooms, { ...row.value, cancellationRequested: true, status: 'stopping' })
      return { accepted: true }
    }
  } finally { rooms.wake() }
}
