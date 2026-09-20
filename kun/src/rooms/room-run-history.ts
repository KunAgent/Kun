import { roomDiscussionMessageId, roomDiscussionMessageThreads } from './room-discussion-message.js'
import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { RoomRuntimeDeps, RoomRequestState, RoomTaskExecution } from './room-runtime-types.js'
import type { RoomStoredDocument } from './room-store.js'
import { peerId } from './room-peer-inbox.js'

const LEGACY_PREFIX = 'legacy-'
export const historicalRunId = (messageId: string): string => LEGACY_PREFIX + messageId
export const historicalMessageId = (runId: string): string | undefined =>
  runId.startsWith(LEGACY_PREFIX) ? runId.slice(LEGACY_PREFIX.length) : undefined

type Evidence = {
  threadId: string; turnId: string; memberId: string; phase: RoomRunRecord['phase']
  requestId?: string; rootRequestId?: string; taskId?: string; contextId?: string
  triggerMessageId?: string; attempt?: number; input?: string
}

/** Resolve only durable, unique identities. This path never writes migration records. */
export async function resolveHistoricalRoomRun(deps: RoomRuntimeDeps,
  message: RoomMessage): Promise<RoomRunRecord | undefined> {
  if (message.authorKind !== 'member' || !message.authorMemberId) return
  const candidates: Evidence[] = []
  for (const threadId of roomDiscussionMessageThreads(message.id)) {
    const thread = await deps.threadStore.getMetadata?.(threadId)
    const requestId = thread?.roomContext?.requestId
    const request = requestId ? await deps.store.get<RoomRequestState>('request', requestId) : null
    if (request?.roomId === message.roomId) {
      for (const entry of [...(request.value.discussions ?? []), ...(request.value.previousDiscussions ?? [])]) {
        // Pre-upgrade retries overwrote the unsuffixed message; exact body and a unique turn remain required.
        const matchesMessage = entry.messageId ? entry.messageId === message.id :
          roomDiscussionMessageId(threadId, entry.attempt) === message.id || roomDiscussionMessageId(threadId) === message.id
        if (!matchesMessage || entry.threadId !== threadId || !entry.turnId || entry.memberId !== message.authorMemberId ||
          (entry.response !== message.body && entry.error !== message.body)) continue
        candidates.push({ threadId, turnId: entry.turnId, memberId: entry.memberId,
          phase: 'discussion', requestId: request.id, rootRequestId: request.value.rootRequestId ?? request.id,
          triggerMessageId: entry.sourceMessageId, attempt: (entry.attempt ?? 0) + 1 })
      }
    }
  }
  // The exact publication hash binds the metric's admission identity. Member/time similarity is never evidence.
  if (message.rootRequestId && message.id.startsWith('peer-')) {
    const metrics = await deps.store.list<{
      id: string; phase: string; outcome: string; threadId?: string; turnId?: string;
      rootRequestId: string; memberId: string
    }>('peer_metric', { roomId: message.roomId, rootRequestId: message.rootRequestId,
      memberId: message.authorMemberId, limit: 201 })
    // An exhausted scan cannot establish uniqueness. Leave the source unavailable.
    if (metrics.length < 201) for (const metric of metrics) {
      const value = metric.value
      if (value.phase !== 'response' || value.outcome !== 'published' || !value.threadId || !value.turnId ||
        peerId('message', value.id) !== message.id) continue
      candidates.push({ threadId: value.threadId, turnId: value.turnId, memberId: value.memberId,
        phase: 'discussion', rootRequestId: value.rootRequestId, requestId: message.sourceRequestId })
    }
  }
  // Task progress is model text; task state notifications are deliberately excluded.
  if (message.taskId && message.id.startsWith('progress-' + message.taskId + '-')) {
    const task = await deps.store.get<RoomTaskExecution>('task', message.taskId)
    if (task?.roomId === message.roomId && task.value.turnId &&
      message.id === `progress-${message.taskId}-${task.value.attempt}` &&
      task.value.task.ownerMemberId === message.authorMemberId) {
      candidates.push({ threadId: task.value.task.executionThreadId, turnId: task.value.turnId,
        memberId: message.authorMemberId, phase: 'execution', taskId: message.taskId,
        requestId: task.value.task.requestId, attempt: Math.max(1, task.value.attempt), input: task.value.prompt })
    }
  }
  if (!message.taskId && message.id.startsWith('result-')) {
    const direct = message.sourceRequestId ?? message.id.slice('result-'.length)
    const ids = [...new Set([direct, direct.replace(/-step-\d+$/, '')])]
    for (const id of ids) {
      const request = await deps.store.get<RoomRequestState>('request', id)
      if (!request || request.roomId !== message.roomId || !request.value.turnId || request.value.message.taskId) continue
      const state = request.value
      const expected = 'result-' + id + (state.stepAttempt ? '-step-' + state.stepAttempt : '')
      if (message.id !== expected || state.roomSnapshot.defaultMemberId !== message.authorMemberId) continue
      // Only an admitted coordinator result in the currently recorded coordinate phase has unique evidence.
      if (state.stage === 'discuss' || state.status !== 'completed') continue
      candidates.push({ threadId: state.threadId, turnId: state.turnId!, memberId: message.authorMemberId,
        phase: 'coordination', requestId: id, rootRequestId: state.rootRequestId ?? id,
        triggerMessageId: state.sourceMessageId, contextId: state.contextId,
        input: state.originalMessage?.body ?? state.message.body, attempt: (state.stepAttempt ?? 0) + 1 })
    }
  }
  const unique = [...new Map(candidates.map((item) => [item.threadId + ':' + item.turnId, item])).values()]
  if (unique.length !== 1) return
  const evidence = unique[0]!
  const thread = await deps.threadStore.getMetadata?.(evidence.threadId)
  if (thread && (thread.roomContext?.roomId !== message.roomId ||
    thread.roomContext.memberId !== message.authorMemberId || thread.roomContext.kind !== evidence.phase)) return
  const turn = thread?.turns.find((item) => item.id === evidence.turnId)
  // Durable evidence still names a pruned turn; the detail reader reports missing_turn.
  const source = evidence.triggerMessageId ? await deps.store.get<RoomMessage>('message', evidence.triggerMessageId) : null
  return { id: historicalRunId(message.id), roomId: message.roomId, ...evidence,
    memberLabel: message.authorLabelSnapshot, attempt: Math.max(1, evidence.attempt ?? 1),
    clientRequestId: turn?.clientRequestId ?? 'historical-' + evidence.turnId,
    input: (source?.roomId === message.roomId ? source.value.body : evidence.input ?? '').slice(0, 64000),
    attachmentIds: turn?.attachmentIds ?? [],
    status: turn?.status === 'aborted' ? 'cancelled' : turn?.status ?? 'completed', outcome: 'published',
    publishedMessageId: message.id, createdAt: turn?.createdAt ?? message.createdAt,
    updatedAt: turn?.finishedAt ?? message.createdAt, startedAt: turn?.startedAt, endedAt: turn?.finishedAt,
    model: thread?.model, usageStatus: 'unavailable' }
}

export async function getRoomRunRow(deps: RoomRuntimeDeps, roomId: string,
  runId: string): Promise<RoomStoredDocument<RoomRunRecord>> {
  const row = await deps.store.get<RoomRunRecord>('room_run', runId)
  if (row) {
    if (row.roomId !== roomId || row.value.roomId !== roomId) throw new Error('room run not found')
    return row
  }
  const messageId = historicalMessageId(runId)
  const message = messageId ? await deps.store.get<RoomMessage>('message', messageId) : null
  if (message?.roomId !== roomId) throw new Error('room run not found')
  const run = await resolveHistoricalRoomRun(deps, message.value)
  if (!run || run.id !== runId) throw new Error('room run not found')
  return { kind: 'room_run', id: runId, roomId, taskId: run.taskId,
    revision: message.revision, seq: message.seq, value: run }
}
