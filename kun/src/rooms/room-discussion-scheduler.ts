import { privateRequestCanRun } from '../agents/agent-lifecycle-state.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { discussionAgentLane } from '../agents/agent-discussion-scope.js'
import type { RoomRuntimeDeps, RoomRequestState } from './room-runtime-types.js'
import type { RoomPeerMemberState } from './room-peer-types.js'
import { putRoomDocument } from './room-service.js'
import { settleRoomRequestStop } from './room-request-actions.js'

export function roomRequestDiscussionTarget(request: RoomRequestState) {
  if (request.stage === 'discuss') {
    const discussion = request.discussions?.find((item) => item.response === undefined)
    return discussion ? { memberId: discussion.memberId, threadId: discussion.threadId, turnId: discussion.turnId, admissionAttempted: discussion.admissionAttempted } : undefined
  }
  return { memberId: request.roomSnapshot.defaultMemberId, threadId: request.threadId, turnId: request.turnId, admissionAttempted: request.admissionAttempted }
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
      if (row.value.privateProtocol && !row.value.cancellationRequested && !await privateRequestCanRun(deps.store, row.value)) continue
      const target = roomRequestDiscussionTarget(row.value)
      if (!target || !target.turnId && !target.admissionAttempted) continue
      const agent = await discussionAgentLane(deps, row.value.roomId, target.memberId, row.value.roomSnapshot)
      try {
        const thread = await deps.threads.getMetadata(target.threadId)
        const turn = target.turnId ? thread?.turns.find((item) => item.id === target.turnId) : undefined
        if (!turn || ['queued', 'running'].includes(turn.status)) { busy.add(row.value.roomId + ':' + target.memberId); if (agent) busy.add(agent) }
      } catch { { busy.add(row.value.roomId + ':' + target.memberId); if (agent) busy.add(agent) } }
    }
    if (rows.length < 1000) break
    afterSeq = rows.at(-1)!.seq
  }
  if (includePeer) {
    let afterSeq: number | undefined
    for (;;) {
      const rows = await deps.store.list<RoomPeerMemberState>('peer_member', { order: 'asc', limit: 1000, afterSeq })
      for (const row of rows) if (row.value.activation) {
        busy.add(row.value.roomId + ':' + row.value.memberId)
        const agent = await discussionAgentLane(deps, row.value.roomId, row.value.memberId)
        if (agent) busy.add(agent)
      }
      if (rows.length < 1000) break
      afterSeq = rows.at(-1)!.seq
    }
  }
  let runCursor: number | undefined
  for (;;) {
    const rows = await deps.store.list<RoomRunRecord>('room_run', { status: ['queued', 'running', 'recovery_required'],
      order: 'asc', afterSeq: runCursor, limit: 100, summaryOnly: true })
    for (const row of rows) {
      if (!['discussion', 'coordination', 'conversation'].includes(row.value.phase)) continue
      const request = row.value.requestId ? await deps.store.get<RoomRequestState>('request', row.value.requestId) : null
      if (row.value.phase === 'conversation') {
        if (request?.value.privateProtocol && !request.value.cancellationRequested && !await privateRequestCanRun(deps.store, request.value)) continue
      }
      const topic = row.value.phase === 'discussion' && !row.value.handoffId && row.value.rootRequestId
        ? await deps.store.get('peer_topic', row.value.rootRequestId) : null
      if (!includePeer && topic) {
        // Active peer reservations are counted by the peer runner itself.
        continue
      }
      // An unadmitted orphan has no execution to reserve. Peer activations reserve
      // their lane before creating a thread and are governed by their topic instead.
      let ended = !row.value.admissionAttempted && !row.value.turnId && !topic && !row.value.handoffId
      if (row.value.threadId) {
        try {
          const thread = await deps.threads.getMetadata(row.value.threadId)
          const turn = thread?.turns.find((turn) => row.value.turnId ? turn.id === row.value.turnId : turn.clientRequestId === row.value.clientRequestId)
          if (turn) ended = !['queued', 'running'].includes(turn.status)
          else if (request && ['failed', 'cancelled'].includes(request.value.status) &&
            await deps.proveStopped?.(row.value.threadId, row.value.turnId)) ended = true
        } catch { ended = false } // Unreadable metadata cannot prove that an execution ended.
      }
      if (ended) continue
      busy.add(row.value.roomId + ':' + row.value.memberId)
      const agent = row.value.participantAgentId ? 'agent:' + row.value.participantAgentId :
        await discussionAgentLane(deps, row.value.roomId, row.value.memberId)
      if (agent) busy.add(agent)
    }
    if (rows.length < 100) break
    runCursor = rows.at(-1)!.seq
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
