import type { RoomRuntimeDeps, RoomRequestState } from './room-runtime-types.js'
import type { RoomPeerMemberState } from './room-peer-types.js'
import { putRoomDocument } from './room-service.js'
import { settleRoomRequestStop } from './room-request-actions.js'

export function roomRequestDiscussionTarget(request: RoomRequestState) {
  if (request.stage === 'discuss') {
    const discussion = request.discussions?.find((item) => item.response === undefined)
    return discussion ? { memberId: discussion.memberId, threadId: discussion.threadId, turnId: discussion.turnId } : undefined
  }
  return { memberId: request.roomSnapshot.defaultMemberId, threadId: request.threadId, turnId: request.turnId }
}

/** Read-only discussion lanes are separate from repository execution lanes. */
export async function roomDiscussionBusy(deps: RoomRuntimeDeps, includePeer = false): Promise<Set<string>> {
  const busy = new Set<string>()
  let afterSeq: number | undefined
  for (;;) {
    const rows = await deps.store.list<RoomRequestState>('request', {
      status: ['running', 'pending', 'stopping', 'recovery_required'], order: 'asc', limit: 1000, afterSeq
    })
    for (const row of rows) {
      const target = roomRequestDiscussionTarget(row.value)
      if (!target?.turnId) continue
      try {
        const thread = await deps.threads.getMetadata(target.threadId)
        const turn = thread?.turns.find((item) => item.id === target.turnId)
        if (!turn || ['queued', 'running'].includes(turn.status)) busy.add(row.value.roomId + ':' + target.memberId)
      } catch { busy.add(row.value.roomId + ':' + target.memberId) }
    }
    if (rows.length < 1000) break
    afterSeq = rows.at(-1)!.seq
  }
  if (includePeer) {
    let afterSeq: number | undefined
    for (;;) {
      const rows = await deps.store.list<RoomPeerMemberState>('peer_member', { order: 'asc', limit: 1000, afterSeq })
      for (const row of rows) if (row.value.activation) busy.add(row.value.roomId + ':' + row.value.memberId)
      if (rows.length < 1000) break
      afterSeq = rows.at(-1)!.seq
    }
  }
  return busy
}

export async function cancelSupersededRoomRequest(deps: RoomRuntimeDeps, id: string): Promise<void> {
  let row = await deps.store.get<RoomRequestState>('request', id)
  if (!row || ['completed', 'cancelled'].includes(row.value.status)) return
  if (!row.value.cancellationRequested) {
    await putRoomDocument(deps.store, 'request', id, row.value.roomId,
      { ...row.value, cancellationRequested: true, status: 'stopping' }, row)
    row = await deps.store.get<RoomRequestState>('request', id)
  }
  if (row) await settleRoomRequestStop(deps, row)
}
