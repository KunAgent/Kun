import { realpath, stat } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import type { Room, RoomMember } from '../contracts/rooms.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { RoomRuntime } from '../rooms/room-runtime.js'
import type { RoomRequestState } from '../rooms/room-runtime-types.js'
import type { RoomStoredDocument } from '../rooms/room-store.js'
import { roomRunId } from '../rooms/room-run-recording.js'
import { agentWorkspace } from './agent-direct-runner.js'
import { freezeAgentPermissions } from './agent-permission-snapshot.js'
import { agentSetupPending } from './agent-setup.js'

export type PrivateExecutionBinding = {
  roomId: string; requestId: string; runId: string; threadId: string; turnId: string
}
const memberAuthority = (value: RoomMember) => {
  const { fastModelRef: _resolvedAtSend, ...member } = JSON.parse(JSON.stringify(value)) as RoomMember
  return member
}

/** Read-only reconstruction: messages, historical cards and caller-supplied thread IDs confer no authority. */
export async function privateExecutionBinding(rooms: RoomRuntime, room: Room,
  row: RoomStoredDocument<RoomRequestState> | undefined): Promise<PrivateExecutionBinding | undefined> {
  if (!row || room.conversationKind !== 'user_agent' || room.archivedAt) return
  const request = row.value, accepted = request.roomSnapshot
  if (row.roomId !== room.id || request.roomId !== room.id || request.id !== row.id ||
    request.privateProtocol !== 'direct-v1' || request.status !== 'running' || request.steer ||
    request.cancellationRequested || !request.admissionAttempted || (request.clientSurface ?? 'gui') !== 'gui' ||
    !request.turnId || !request.privateRunId || !request.privateWorkspace ||
    accepted.id !== room.id || accepted.conversationKind !== 'user_agent' ||
    (accepted.privateEpoch ?? 0) !== (room.privateEpoch ?? 0) || accepted.privateWorkspace !== room.privateWorkspace ||
    accepted.defaultMemberId !== room.defaultMemberId) return
  const member = accepted.members.find((item) => item.id === accepted.defaultMemberId)
  if (!member?.participantAgentId || !member.enabled || member.removedAt) return
  const clientRequestId = 'private-' + request.id + '-' + (request.stepAttempt ?? 0)
  if (request.privateRunId !== roomRunId(room.id, clientRequestId)) return
  try {
    const runRow = await rooms.deps.store.get<RoomRunRecord>('room_run', request.privateRunId)
    const run = runRow?.value
    if (!runRow || !run || runRow.id !== request.privateRunId || runRow.roomId !== room.id ||
      run.id !== runRow.id || run.roomId !== room.id || run.requestId !== request.id ||
      run.rootRequestId !== (request.rootRequestId ?? request.id) || run.memberId !== member.id ||
      run.participantAgentId !== member.participantAgentId || run.phase !== 'conversation' ||
      run.clientRequestId !== clientRequestId || run.threadId !== request.threadId || run.turnId !== request.turnId ||
      !run.admissionAttempted || !['queued', 'running'].includes(run.status) || run.endedAt || run.mergedIntoRunId) return
    const rootId = request.rootRequestId ?? request.id
    const root = rootId === request.id ? row : await rooms.deps.store.get<RoomRequestState>('request', rootId)
    if (!root || root.id !== root.value.id || root.roomId !== room.id || root.value.roomId !== room.id ||
      root.value.cancellationRequested || ['cancelled', 'stopping', 'recovery_required'].includes(root.value.status)) return
    const agent = await rooms.agents.active(member.participantAgentId)
    if (agentSetupPending(agent)) return
    const snapshot = await freezeAgentPermissions(rooms.agents, await rooms.agents.freeze(room))
    const current = snapshot.members.find((item) => item.id === member.id)
    if (!current || !current.enabled || current.removedAt || current.participantAgentId !== member.participantAgentId ||
      !isDeepStrictEqual(memberAuthority(current), memberAuthority(member)) ||
      !isDeepStrictEqual(snapshot.privateExecutionPolicy, accepted.privateExecutionPolicy)) return
    const workspace = await realpath(room.privateWorkspace ?? agentWorkspace(rooms.deps.dataDir, agent.id))
    if (workspace !== request.privateWorkspace || !(await stat(workspace)).isDirectory() ||
      room.privateWorkspace && agent.allowedRepositoryRoots && !agent.allowedRepositoryRoots.includes(workspace)) return
    const validThread = (thread: ThreadRecord | null) => {
      const scope = thread?.roomContext, policy = accepted.privateExecutionPolicy
      if (!thread || thread.id !== request.threadId || thread.status !== 'running' || thread.workspace !== workspace ||
        scope?.kind !== 'conversation' || scope.roomId !== room.id || scope.memberId !== member.id ||
        scope.participantAgentId !== member.participantAgentId || scope.agentRevision !== member.agentRevision || !policy) return false
      const sandboxMode = member.presetSnapshot?.toolPolicy === 'readOnly' ? 'read-only' : policy.sandboxMode
      const running = thread.turns.filter((turn) => turn.status === 'running'), turn = running[0]
      return running.length === 1 && turn.id === request.turnId && turn.threadId === thread.id &&
        turn.clientRequestId === clientRequestId && turn.clientSurface === 'gui' &&
        !turn.admissionPending && !turn.finishedAt && !turn.steeredToTurnId &&
        thread.sandboxMode === sandboxMode && turn.sandboxMode === sandboxMode &&
        thread.approvalPolicy === policy.approvalPolicy && turn.approvalPolicy === policy.approvalPolicy &&
        thread.approvalReviewer === policy.approvalReviewer && turn.approvalReviewer === policy.approvalReviewer
    }
    if (!validThread(await rooms.deps.threads.getMetadata(request.threadId))) return
    // Fail closed if cancellation, permissions, workspace or Agent ownership changed while reading.
    const [freshRequest, freshRun, freshRoot, freshRoom, freshAgent] = await Promise.all([
      rooms.deps.store.get<RoomRequestState>('request', row.id), rooms.deps.store.get<RoomRunRecord>('room_run', runRow.id),
      rooms.deps.store.get<RoomRequestState>('request', root.id), rooms.service.get(room.id), rooms.agents.active(agent.id)
    ])
    if (freshRequest?.revision !== row.revision || freshRun?.revision !== runRow.revision ||
      freshRoot?.revision !== root.revision || freshRoom.revision !== room.revision || freshAgent.revision !== agent.revision ||
      !validThread(await rooms.deps.threads.getMetadata(request.threadId))) return
    return { roomId: room.id, requestId: request.id, runId: run.id, threadId: request.threadId, turnId: request.turnId }
  } catch {
    // Unavailable/removed authority is never a reason to attach an old browser session.
    return
  }
}
