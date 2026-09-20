import { isDeepStrictEqual } from 'node:util'
import { agentStableId } from '../agents/agent-identity-service.js'
import { freezeAgentPermissions } from '../agents/agent-permission-snapshot.js'
import type { AgentIdentity } from '../contracts/agent-identities.js'
import type { Room } from '../contracts/rooms.js'
import { roomRunId } from './room-run-recording.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { RoomContinuation } from './room-continuation-dispatch.js'
import type { RoomRequestState, RoomRuntimeDeps } from './room-runtime-types.js'

/** Re-evaluate authority both before queuing and before admitting a continuation. */
async function sourceFor(deps: RoomRuntimeDeps, input: RoomContinuation) {
  const thread = await deps.threads.getMetadata(input.threadId)
  const scope = thread?.roomContext
  if (!thread || scope?.kind !== 'conversation' || !scope.participantAgentId) return null
  const source = thread.turns.find((turn) => turn.id === input.sourceTurnId)
  if (!source?.clientRequestId || source.status === 'aborted') return null
  const sourceIndex = thread.turns.indexOf(source)
  const background = input.kind === 'background_shell' || input.kind === 'background_subagent'
  if (!background && sourceIndex !== thread.turns.length - 1) return null
  if (input.kind === 'goal' && (!['completed', 'failed'].includes(source.status) || thread.goal?.status !== 'active')) return null
  if (input.kind === 'restart' && source.status !== 'failed') return null
  const run = await deps.store.get<RoomRunRecord>('room_run', roomRunId(scope.roomId, source.clientRequestId))
  if (!run?.value.requestId || run.value.threadId !== thread.id || run.value.turnId !== source.id) return null
  const base = await deps.store.get<RoomRequestState>('request', run.value.requestId)
  if (!base || base.roomId !== scope.roomId || !base.value.privateProtocol || base.value.cancellationRequested ||
    ['cancelled', 'stopping'].includes(base.value.status) || base.value.turnId !== source.id ||
    base.value.threadId !== thread.id || base.value.privateWorkspace !== thread.workspace) return null
  const rootId = base.value.rootRequestId ?? base.id
  const root = rootId === base.id ? base : await deps.store.get<RoomRequestState>('request', rootId)
  if (!root || root.roomId !== scope.roomId || root.value.cancellationRequested ||
    ['cancelled', 'stopping'].includes(root.value.status)) return null
  // Sibling completions may follow host continuations of the same user request,
  // but never a newer user turn or an unowned turn.
  for (const later of thread.turns.slice(sourceIndex + 1)) {
    if (!later.clientRequestId || later.status === 'aborted') return null
    const laterRun = await deps.store.get<RoomRunRecord>('room_run', roomRunId(scope.roomId, later.clientRequestId))
    if (!laterRun?.value.requestId || laterRun.value.threadId !== thread.id || laterRun.value.turnId !== later.id) return null
    const laterRequest = await deps.store.get<RoomRequestState>('request', laterRun.value.requestId)
    if (!laterRequest?.value.privateContinuation || laterRequest.value.rootRequestId !== rootId ||
      laterRequest.value.threadId !== thread.id || laterRequest.value.cancellationRequested ||
      ['cancelled', 'stopping'].includes(laterRequest.value.status)) return null
  }
  const room = await deps.store.get<Room>('room', scope.roomId)
  const agent = await deps.store.get<AgentIdentity>('agent_identity', scope.participantAgentId)
  if (!room || room.value.archivedAt || room.value.conversationKind !== 'user_agent' || !agent || agent.value.archivedAt) return null
  if ((room.value.privateEpoch ?? 0) !== (base.value.roomSnapshot.privateEpoch ?? 0) ||
    room.value.privateWorkspace !== base.value.roomSnapshot.privateWorkspace || !deps.agentDirectory) return null
  const snapshot = await deps.agentDirectory.freeze(room.value)
  await freezeAgentPermissions(deps.agentDirectory, snapshot)
  const actor = snapshot.members.find((member) => member.id === scope.memberId)
  const original = base.value.roomSnapshot.members.find((member) => member.id === scope.memberId)
  if (!actor || !original || !actor.enabled || actor.removedAt || actor.participantAgentId !== scope.participantAgentId ||
    !isDeepStrictEqual(snapshot.privateExecutionPolicy, base.value.roomSnapshot.privateExecutionPolicy) ||
    !isDeepStrictEqual(JSON.parse(JSON.stringify(actor)), JSON.parse(JSON.stringify(original)))) return null
  return { thread, source, base, root, room, agent, snapshot }
}

export async function roomContinuationIsCurrent(deps: RoomRuntimeDeps, request: RoomRequestState): Promise<boolean> {
  const continuation = request.privateContinuation
  if (!continuation) return true
  const source = await sourceFor(deps, { ...continuation, threadId: request.threadId, prompt: request.privateInput ?? '', key: request.id })
  return Boolean(source && (continuation.kind !== 'goal' || source.thread.goal?.createdAt === continuation.goalCreatedAt))
}

/** Only the room's admission queue starts work; coordinators never launch a second room turn directly. */
export async function enqueuePrivateContinuation(deps: RoomRuntimeDeps, input: RoomContinuation): Promise<'queued' | 'ignored'> {
  await deps.assertOwnership()
  const id = agentStableId('private-continuation', input.threadId, input.sourceTurnId, input.kind, input.key)
  const existing = await deps.store.get<RoomRequestState>('request', id)
  if (existing) return existing.value.cancellationRequested ? 'ignored' : 'queued'
  const current = await sourceFor(deps, input)
  if (!current) return 'ignored'
  const { thread, source, base, root, room, agent, snapshot } = current
  const request: RoomRequestState = {
    id, roomId: room.id, rootRequestId: root.id, privateProtocol: 'direct-v1',
    privateInput: input.prompt, privateWorkspace: thread.workspace,
    privateModel: base.value.privateModel,
    privateContinuation: { sourceTurnId: source.id, kind: input.kind,
      ...(input.kind === 'goal' ? { goalCreatedAt: thread.goal!.createdAt } : {}) },
    status: 'pending', threadId: thread.id, roomSnapshot: snapshot,
    message: { ...base.value.message, attachmentIds: [] }, sourceMessageId: base.value.sourceMessageId,
    continuation: (base.value.continuation ?? 0) + 1
  }
  await deps.store.commit({
    requestId: id,
    checks: [
      { kind: 'request', id, expectedRevision: null },
      { kind: 'request', id: base.id, expectedRevision: base.revision },
      ...(root.id !== base.id ? [{ kind: 'request' as const, id: root.id, expectedRevision: root.revision }] : []),
      { kind: 'room', id: room.id, expectedRevision: room.revision },
      { kind: 'agent_identity', id: agent.id, expectedRevision: agent.revision }
    ],
    puts: [{ kind: 'request', id, roomId: room.id, value: request }],
    events: [{ roomId: room.id, kind: 'request.updated', payload: { id } }]
  })
  return 'queued'
}
