import { RoomRequestContinueSchema, RoomTaskActionSchema } from '../contracts/rooms-api.js'
import { RoomMessageSchema } from '../contracts/rooms.js'
import type { RoomRuntimeDeps, RoomRequestState } from './room-runtime-types.js'
import type { RoomStoredDocument } from './room-store.js'
import { RoomStoreConflictError } from './room-store.js'
import { RoomService, putRoomDocument, roomFingerprint, roomId as newId } from './room-service.js'
import { stopRoomTaskTurn } from './room-task-activity.js'
import { preserveRoomDiscussions } from './room-discussion-evidence.js'

type Identity = { threadId: string; turnId?: string; admissionAttempted?: boolean }
export async function roomRequestActivity(deps: RoomRuntimeDeps, request: RoomRequestState) {
  const identities: Identity[] = [{ threadId: request.threadId, turnId: request.turnId,
    admissionAttempted: request.admissionAttempted || request.status === 'failed' },
    ...(request.discussions ?? []).map(({ threadId, turnId, admissionAttempted }) => ({ threadId, turnId, admissionAttempted }))]
  const summary = await deps.store.get<{ ownerRequestId?: string; threadId?: string; turnId?: string }>('summary', request.roomId)
  if (summary?.value.ownerRequestId === request.id && summary.value.threadId) identities.push({
    threadId: summary.value.threadId, turnId: summary.value.turnId })
  if (request.compressionId) {
    const compression = await deps.store.get<{ ownerRequestId: string; threadId?: string; turnId?: string }>('rule_compression', request.compressionId)
    if (compression?.value.ownerRequestId === request.id && compression.value.threadId) identities.push({
      threadId: compression.value.threadId, turnId: compression.value.turnId })
  }
  const active: Identity[] = []
  let unknown = false
  for (const identity of identities) {
    try {
      const thread = await deps.threads.getMetadata(identity.threadId)
      const turns = thread?.turns.filter((turn) => ['running', 'queued'].includes(turn.status)) ?? []
      active.push(...turns.map((turn) => ({ threadId: identity.threadId, turnId: turn.id })))
      if (deps.backgroundExecutionActive?.(identity.threadId) && !turns.length) active.push(identity)
      if ((identity.turnId && !thread?.turns.some((turn) => turn.id === identity.turnId)) ||
        (!identity.turnId && identity.admissionAttempted && !turns.length)) {
        if (!await deps.proveStopped?.(identity.threadId, identity.turnId)) unknown = true
      } else if (!turns.length && identity.turnId && deps.proveStopped &&
        !await deps.proveStopped(identity.threadId, identity.turnId)) {
        unknown = true
      }
    } catch { unknown = true }
  }
  return { state: active.length ? 'active' as const : unknown ? 'unknown' as const : 'stopped' as const, active }
}

/** The durable stop intent is consumed under the same action lane as dispatch. */
export async function settleRoomRequestStop(deps: RoomRuntimeDeps, row: RoomStoredDocument<RoomRequestState>) {
  let activity = await roomRequestActivity(deps, row.value)
  let failure: string | undefined
  for (const identity of activity.active) {
    try {
      await deps.stopBackgroundExecution?.(identity.threadId)
      if (identity.turnId) await stopRoomTaskTurn(deps, identity.threadId, identity.turnId)
    } catch (error) { failure = error instanceof Error ? error.message : String(error) }
  }
  activity = await roomRequestActivity(deps, row.value)
  const status = activity.state === 'stopped' ? 'cancelled' :
    activity.state === 'unknown' ? 'recovery_required' : 'stopping'
  if (row.value.status !== status || row.value.error !== failure) await putRoomDocument(deps.store, 'request', row.id, row.roomId!,
    { ...row.value, status, error: failure, cancellationRequested: true }, row)
  return { status, state: activity.state }
}

export async function roomRequestAction(deps: RoomRuntimeDeps, service: RoomService,
  roomId: string, id: string, action: 'continue' | 'cancel' | 'reconcile', input: unknown) {
  const body = action === 'continue' ? RoomRequestContinueSchema.parse(input) : RoomTaskActionSchema.parse(input)
  const key = 'request-action-' + roomFingerprint({ roomId, id, action, clientRequestId: body.clientRequestId })
  const fingerprint = roomFingerprint(body)
  const replay = await deps.store.getRequest(key)
  if (replay) {
    if (replay.fingerprint !== fingerprint) throw new RoomStoreConflictError('request action identity conflict')
    return replay.result
  }
  const row = await deps.store.get<RoomRequestState>('request', id)
  if (!row || row.roomId !== roomId) throw new Error('request not found')
  if (row.revision !== body.expectedRevision) throw new RoomStoreConflictError('request changed', row.revision)
  const value = structuredClone(row.value)
  if (action !== 'continue') {
    if (action === 'cancel' && value.status === 'completed') throw new RoomStoreConflictError('coordination completed; control its tasks separately')
    const activity = await roomRequestActivity(deps, value)
    value.cancellationRequested = action === 'cancel' || value.cancellationRequested
    value.status = activity.state === 'unknown' ? 'recovery_required' : activity.state === 'active' ?
      value.cancellationRequested ? 'stopping' : 'running' : value.cancellationRequested ? 'cancelled' : 'failed'
    await deps.store.commit({ requestId: key, fingerprint,
      checks: [{ kind: 'request', id, expectedRevision: row.revision }],
      puts: [{ kind: 'request', id, roomId, value }],
      events: [{ roomId, kind: 'request.updated', payload: { id } }], result: { id, status: value.status } })
    return { id, status: value.status }
  }
  if (!['needs_input', 'failed', 'cancelled'].includes(value.status)) throw new RoomStoreConflictError('request is not awaiting continuation')
  if ((await roomRequestActivity(deps, value)).state !== 'stopped') throw new RoomStoreConflictError('reconcile the original request execution before continuing')
  const room = await service.get(roomId)
  if (room.archivedAt) throw new RoomStoreConflictError('restore the room before continuing')
  const messageInput = RoomRequestContinueSchema.parse(input).message
  if (messageInput.taskId) throw new RoomStoreConflictError('continue a task through its task composer')
  if (messageInput.mentionMemberIds.some((id) => !room.members.some((member) => member.id === id && member.enabled && !member.removedAt))) {
    throw new RoomStoreConflictError('selected room member is unavailable')
  }
  if (messageInput.repositoryId && !room.repositories.some((repo) => repo.id === messageInput.repositoryId)) throw new RoomStoreConflictError('selected repository is unavailable')
  const messageId = newId()
  const message = RoomMessageSchema.parse({ body: messageInput.body, mentionMemberIds: messageInput.mentionMemberIds,
    attachmentIds: messageInput.attachmentIds, id: messageId, roomId, messageSeq: 1,
    authorKind: 'user', authorLabelSnapshot: 'You', bodyRevision: 0, replyToMessageId: value.sourceMessageId,
    clientRequestId: body.clientRequestId, createdAt: new Date().toISOString() })
  const combined = value.message.body + '\n\nClarification: ' + (value.clarification ?? '') + '\nUser continuation: ' + messageInput.body
  if (combined.length > 64000) throw new RoomStoreConflictError('request text is too long; start a new explicitly scoped request')
  const attachments = [...new Set([...value.message.attachmentIds, ...messageInput.attachmentIds])]
  if (attachments.length > 20) throw new RoomStoreConflictError('request supports at most 20 attachments')
  preserveRoomDiscussions(value)
  value.originalMessage ??= structuredClone(value.message)
  value.originalSourceMessageId ??= value.sourceMessageId
  value.message = { ...value.message, ...messageInput, clientRequestId: value.message.clientRequestId,
    executionIntent: messageInput.executionIntent === 'auto' ? value.message.executionIntent : messageInput.executionIntent,
    body: combined, attachmentIds: attachments,
    repositoryId: messageInput.repositoryId ?? value.message.repositoryId,
    mentionMemberIds: messageInput.mentionMemberIds.length ? messageInput.mentionMemberIds : value.message.mentionMemberIds }
  value.sourceMessageId = messageId
  value.continuation = (value.continuation ?? 0) + 1
  value.contextId = 'context-' + id + '-continuation-' + value.continuation
  value.discussions = undefined
  value.stage = 'coordinate'
  value.round = 0
  value.status = 'pending'
  value.turnId = undefined
  value.admissionAttempted = false
  value.error = undefined
  value.clarification = undefined
  value.cancellationRequested = false
  value.compressionId = undefined
  value.resultRepairs = 0
  value.repairInstruction = undefined
  value.stepAttempt = (value.stepAttempt ?? 0) + 1
  value.roomSnapshot = room
  const inputId = id + '-input-' + value.continuation
  return (await deps.store.commit({ requestId: key, fingerprint,
    checks: [{ kind: 'request', id, expectedRevision: row.revision }, { kind: 'message', id: messageId, expectedRevision: null },
      { kind: 'request_input', id: inputId, expectedRevision: null }],
    puts: [{ kind: 'request', id, roomId, value }, { kind: 'message', id: messageId, roomId, value: message },
      { kind: 'request_input', id: inputId, roomId, value: { requestId: id, clarification: row.value.clarification, message, continuation: value.continuation } }],
    events: [{ roomId, kind: 'request.updated', payload: { id } }, { roomId, kind: 'message.created', payload: { id: messageId } }],
    result: { id, status: value.status, messageId } })).result
}
