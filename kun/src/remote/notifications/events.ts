import { createHash } from 'node:crypto'
import type { AgentIdentity } from '../../contracts/agent-identities.js'
import type { RuntimeEvent } from '../../contracts/events.js'
import type { RoomRunRecord } from '../../contracts/room-runs.js'
import type { Room, RoomMessage } from '../../contracts/rooms.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { RoomRequestState } from '../../rooms/room-runtime-types.js'
import type { RoomStoreEvent } from '../../rooms/room-store.js'
import { isRemoteCodeAllowed } from '../code/access.js'
export type MobileNotificationEvent = { eventId: string; resourceKind: 'agent' | 'code'; resourceId: string;
  kind: 'completed' | 'failed' | 'approval' | 'input'; title?: string }
const ID = /^[A-Za-z0-9_-]{1,128}$/
const MAX_NOTIFICATION_TITLE_CHARS = 80
export function sanitizeNotificationTitle(raw?: string | null): string | undefined {
  if (typeof raw !== 'string') return undefined
  const cleaned = raw.replace(/[\p{Cc}\s]+/gu, ' ').trim()
  if (!cleaned) return undefined
  const chars = Array.from(cleaned)
  return chars.length > MAX_NOTIFICATION_TITLE_CHARS
    ? `${chars.slice(0, MAX_NOTIFICATION_TITLE_CHARS - 1).join('').trimEnd()}…`
    : cleaned
}
function projected(resourceKind: 'agent' | 'code', resourceId: string, kind: MobileNotificationEvent['kind'],
  identity: string[], rawTitle?: string | null): MobileNotificationEvent | null {
  if (!ID.test(resourceId)) return null
  const title = sanitizeNotificationTitle(rawTitle)
  return { resourceKind, resourceId, kind,
    eventId: createHash('sha256').update(JSON.stringify([resourceKind, resourceId, kind, ...identity])).digest('hex'),
    ...(title ? { title } : {}) }
}
async function agentForRoom(runtime: ServerRuntime, roomId: string, participantId?: string) {
  const room = await runtime.rooms!.deps.store.get<Room>('room', roomId)
  if (!room || room.value.conversationKind !== 'user_agent' || room.value.deletedAt) return null
  const member = participantId ? room.value.members.find((member) => member.participantAgentId === participantId) : room.value.members[0]
  if (!member?.participantAgentId) return null
  const agent = await runtime.rooms!.deps.store.get<AgentIdentity>('agent_identity', member.participantAgentId).catch(() => null)
  return { id: member.participantAgentId, title: agent?.value.name || member.displayName }
}
/** Terminal events are persisted before this observer runs. Never infer completion from idle. */
export async function codeNotification(runtime: ServerRuntime, event: RuntimeEvent): Promise<MobileNotificationEvent | null> {
  if (!['turn_completed', 'turn_failed', 'approval_requested', 'user_input_requested'].includes(event.kind)) return null
  const thread = await runtime.threadService.getMetadata(event.threadId)
  if (!thread || !await isRemoteCodeAllowed(runtime, thread)) return null
  if (event.kind === 'approval_requested') {
    if (event.status !== 'pending' || event.approvalReviewer === 'agent' ||
      !runtime.approvalGate.pending(thread.id).some((gate) => gate.id === event.approvalId)) return null
    return projected('code', thread.id, 'approval', [event.approvalId], thread.title)
  }
  if (event.kind === 'user_input_requested') {
    if (event.status !== 'pending' || !runtime.userInputGate.pending(thread.id).some((gate) => gate.id === event.inputId)) return null
    return projected('code', thread.id, 'input', [event.inputId], thread.title)
  }
  const turn = thread.turns.find((turn) => turn.id === event.turnId)
  const kind = event.kind === 'turn_completed' ? 'completed' : 'failed'
  if (!turn || turn.status !== kind || !turn.finishedAt || !Number.isFinite(Date.parse(turn.finishedAt)) ||
    Date.now() - Date.parse(turn.finishedAt) > 3600000) return null
  // Goal continuations are real turns, but completion of one is not completion of the active goal.
  if (kind === 'completed' && thread.goal?.status === 'active') return null
  return projected('code', thread.id, kind, [turn.id], thread.title)
}
/** Personal Agent finality comes from the durable request transaction after publication. */
export async function agentNotification(runtime: ServerRuntime, event: RoomStoreEvent): Promise<MobileNotificationEvent | null> {
  if (!['request.updated', 'notification.requested'].includes(event.kind)) return null
  const payload = event.payload as { id?: unknown; threadId?: unknown; gateKind?: unknown } | null
  if (!payload || typeof payload.id !== 'string') return null
  if (event.kind === 'request.updated') {
    const row = await runtime.rooms!.deps.store.get<RoomRequestState>('request', payload.id)
    if (!row || row.roomId !== event.roomId || !['completed', 'failed'].includes(row.value.status)) return null
    const source = await runtime.rooms!.deps.store.get<RoomMessage>('message', row.value.sourceMessageId)
    if (!source || source.roomId !== event.roomId || source.value.presentationKind === 'setup' ||
      row.value.status === 'failed' && row.value.failureAcknowledgedRevision !== undefined) return null
    const run = row.value.privateRunId ? await runtime.rooms!.deps.store.get<RoomRunRecord>('room_run', row.value.privateRunId) : null
    if (run && (run.roomId !== event.roomId || run.value.requestId && run.value.requestId !== row.id)) return null
    const finishedAt = run?.value.endedAt ?? source.value.createdAt
    if (!Number.isFinite(Date.parse(finishedAt)) || Date.now() - Date.parse(finishedAt) > 3600000) return null
    const agent = await agentForRoom(runtime, event.roomId)
    return agent ? projected('agent', agent.id, row.value.status as 'completed' | 'failed', [row.id], agent.title) : null
  }
  if (typeof payload.threadId !== 'string' || !['approval', 'input'].includes(String(payload.gateKind))) return null
  const thread = await runtime.threadService.getMetadata(payload.threadId), context = thread?.roomContext
  if (context?.kind !== 'conversation' || context.roomId !== event.roomId) return null
  const pending = payload.gateKind === 'approval' ? runtime.approvalGate.pending(thread!.id) : runtime.userInputGate.pending(thread!.id)
  const gate = pending.find((gate) => gate.id === payload.id)
  if (!gate || payload.gateKind === 'approval' && thread!.turns.find((turn) => turn.id === gate.turnId)?.approvalReviewer === 'agent') return null
  const agent = await agentForRoom(runtime, event.roomId, context.participantAgentId)
  return agent ? projected('agent', agent.id, payload.gateKind as 'approval' | 'input', [payload.id], agent.title) : null
}
