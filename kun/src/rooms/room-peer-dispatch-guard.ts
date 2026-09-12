import type { Room, RoomMessage } from '../contracts/rooms.js'
import type { RoomPeerTopic } from './room-peer-types.js'
import type { RoomRequestState, RoomRuntimeDeps } from './room-runtime-types.js'
import type { RoomStoreCommit } from './room-store.js'
import { RoomStoreConflictError } from './room-store.js'
import { roomFingerprint } from './room-service.js'

/** The initiating persisted human message is the authority, never a peer response or model summary. */
export async function peerRoomDispatchChecks(deps: RoomRuntimeDeps, request: RoomRequestState) {
  const rootId = request.rootRequestId ?? request.id
  const [root, current, room, source, topic] = await Promise.all([
    deps.store.get<RoomRequestState>('request', rootId),
    deps.store.get<RoomRequestState>('request', request.id),
    deps.store.get<Room>('room', request.roomId),
    deps.store.get<RoomMessage>('message', request.sourceMessageId),
    deps.store.get<RoomPeerTopic>('peer_topic', rootId)
  ])
  if (!root || !current || !room || root.roomId !== request.roomId || current.roomId !== request.roomId ||
    (root.value.peerLatestRequestId ?? root.id) !== request.id || current.value.cancellationRequested ||
    ['cancelled', 'stopping', 'recovery_required'].includes(current.value.status) || room.value.archivedAt ||
    current.value.sourceMessageId !== request.sourceMessageId ||
    roomFingerprint({ message: current.value.message, ruleAdoption: current.value.ruleAdoption }) !==
      roomFingerprint({ message: request.message, ruleAdoption: request.ruleAdoption }) ||
    (topic && (topic.roomId !== request.roomId || ['stopping', 'stopped'].includes(topic.value.status)))) {
    throw new RoomStoreConflictError('peer execution request was stopped or superseded')
  }
  if (!source || source.roomId !== request.roomId || source.value.authorKind !== 'user' ||
    source.value.status !== 'final' || source.value.rootRequestId !== rootId) {
    throw new RoomStoreConflictError('peer execution requires its original final user message')
  }
  const checks: NonNullable<RoomStoreCommit['checks']> = [
    { kind: 'request', id: root.id, expectedRevision: root.revision },
    ...(current.id === root.id ? [] : [{ kind: 'request' as const, id: current.id, expectedRevision: current.revision }]),
    { kind: 'room', id: room.id, expectedRevision: room.revision },
    { kind: 'message', id: source.id, expectedRevision: source.revision },
    ...(topic ? [{ kind: 'peer_topic' as const, id: topic.id, expectedRevision: topic.revision }] : [])
  ]
  return checks
}

/** A durable admission is the linearization point for amendments that may steer a running executor. */
export async function admitPeerRoomAmendment(deps: RoomRuntimeDeps, request: RoomRequestState): Promise<void> {
  const id = 'peer-amend-dispatch-' + request.id
  const fingerprint = roomFingerprint({ roomId: request.roomId, sourceMessageId: request.sourceMessageId,
    message: request.message, ruleAdoption: request.ruleAdoption })
  const prior = await deps.store.getRequest(id)
  if (prior) {
    if (prior.fingerprint !== fingerprint) throw new RoomStoreConflictError('peer amendment admission identity conflict')
    return
  }
  await deps.store.commit({ requestId: id, fingerprint, checks: await peerRoomDispatchChecks(deps, request),
    result: { requestId: request.id, sourceMessageId: request.sourceMessageId, taskId: request.message.taskId } })
}

export async function pendingPeerRoomAmendment(deps: RoomRuntimeDeps, request: RoomRequestState): Promise<boolean> {
  if (request.collaborationProtocol !== 'peer' || !request.message.taskId) return false
  return Boolean(await deps.store.getRequest('peer-amend-dispatch-' + request.id)) &&
    !await deps.store.getRequest('amend-' + request.id)
}
