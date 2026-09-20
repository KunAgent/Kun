import type { RoomIntegration } from '../contracts/rooms-product.js'
import type { RoomRuntimeDeps, RoomRequestState, RoomTaskExecution } from './room-runtime-types.js'
import { RoomPeerStore, retryPeerConflict } from './room-peer-state.js'
import { peerId } from './room-peer-inbox.js'
import { deliverPeerMessageUpdate } from './room-peer-message-updates.js'

const CURSOR_ID = 'peer-task-progress'
const TASK_MILESTONES = new Set(['needs_input', 'needs_approval', 'failed', 'cancelled',
  'awaiting_acceptance', 'completed', 'recovery_required'])
const INTEGRATION_MILESTONES = new Set(['ready', 'conflict', 'applied', 'failed', 'recovery_required'])

async function deliverTask(deps: RoomRuntimeDeps, peer: RoomPeerStore, taskId: string,
  source?: { roomId?: string; createdAt?: string; integrationId?: string; threadId?: string }): Promise<void> {
  const row = await deps.store.get<RoomTaskExecution>('task', taskId)
  if (!row || source?.roomId && source.roomId !== row.roomId) return
  const task = row.value.task
  const request = await deps.store.get<RoomRequestState>('request', task.requestId)
  if (!request || request.roomId !== row.roomId || request.value.collaborationProtocol !== 'peer') return
  const rootId = request.value.rootRequestId ?? request.id
  const topic = await peer.topic(rootId)
  if (!topic || !['active', 'idle'].includes(topic.value.status) ||
    source?.createdAt && Date.parse(source.createdAt) < Date.parse(topic.value.createdAt)) return
  const integration = source?.integrationId
    ? await deps.store.get<RoomIntegration>('integration', source.integrationId) : null
  if (integration && (integration.roomId !== row.roomId || integration.value.taskId !== taskId)) return
  const controlThreadId = source?.threadId ?? integration?.value.threadId ??
    (task.stage === 'review' ? row.value.reviewThreadId : task.executionThreadId)
  const approvalIds = controlThreadId ? deps.approvals.pending(controlThreadId).map((gate) => gate.id).sort() : []
  const userInputIds = controlThreadId ? deps.inputs.pending(controlThreadId).map((gate) => gate.id).sort() : []
  if (!approvalIds.length && !userInputIds.length && !(integration
    ? INTEGRATION_MILESTONES.has(integration.value.status) : TASK_MILESTONES.has(task.status))) return
  const key = peerId('task-notice', rootId, topic.value.generation, task.id, task.status, task.latestDeliveryId,
    integration?.id, integration?.value.status, controlThreadId, approvalIds, userInputIds)
  if (await deps.store.getRequest(key)) return
  await peer.deliverTask(rootId, { id: task.id, revision: row.revision, memberId: task.ownerMemberId, eventId: key,
    body: JSON.stringify({ taskId: task.id, title: task.title, status: task.status, ownerMemberId: task.ownerMemberId,
      deliveryId: task.latestDeliveryId, integrationId: integration?.id, integrationStatus: integration?.value.status,
      approvalIds, userInputIds, progress: task.latestProgress?.slice(0, 2000) }) })
  await deps.store.commit({ requestId: key, result: { taskId: task.id, revision: row.revision } })
}

/** Replay bounded task facts, then inspect only currently pending native gates, never all idle task history. */
export async function deliverRoomPeerTaskProgress(deps: RoomRuntimeDeps, peer: RoomPeerStore): Promise<void> {
  await retryPeerConflict(async () => {
    const cursor = await deps.store.get<{ seq: number }>('peer_cursor', CURSOR_ID)
    const events = await deps.store.events('*', cursor?.value.seq ?? 0, 200)
    for (const event of events) {
      const payload = event.payload && typeof event.payload === 'object' ? event.payload as { id?: string; taskId?: string } : {}
      if (event.kind.startsWith('task.') && (payload.taskId ?? payload.id)) {
        await deliverTask(deps, peer, (payload.taskId ?? payload.id)!, { roomId: event.roomId, createdAt: event.createdAt })
      } else if (event.kind.startsWith('integration.') && payload.id) {
        const integration = await deps.store.get<RoomIntegration>('integration', payload.id)
        if (integration) await deliverTask(deps, peer, integration.value.taskId,
          { roomId: event.roomId, createdAt: event.createdAt, integrationId: integration.id })
      } else if (event.kind === 'message.updated' && payload.id) {
        await deliverPeerMessageUpdate(peer, event.roomId, payload.id)
      }
    }
    if (events.length) await deps.store.commit({ requestId: peerId('task-progress-cursor', cursor?.value.seq ?? 0, events.at(-1)!.seq),
      checks: [{ kind: 'peer_cursor', id: CURSOR_ID, expectedRevision: cursor?.revision ?? null }],
      puts: [{ kind: 'peer_cursor', id: CURSOR_ID, value: { seq: events.at(-1)!.seq } }] })
  })
  // A new approval can replace an earlier gate before the task status changes.
  const gateThreads = new Set([...deps.approvals.pending(), ...deps.inputs.pending()].map((gate) => gate.threadId))
  for (const threadId of gateThreads) {
    const thread = await deps.threads.getMetadata(threadId)
    if (thread?.roomContext?.taskId) await deliverTask(deps, peer, thread.roomContext.taskId,
      { roomId: thread.roomContext.roomId, threadId })
  }
}
