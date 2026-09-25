import { z } from 'zod'
import { AgentFeaturesSchema, type AgentIdentity } from '../contracts/agent-identities.js'
import { ROOM_REMINDER_LIMITS, RoomReminderSchema,
  type RoomReminder, type RoomReminderEntry } from '../contracts/room-reminders.js'
import { RoomMessageSchema, SendRoomMessageSchema, type Room, type RoomMessage } from '../contracts/rooms.js'
import { RoomStoreConflictError, type RoomStore, type RoomStoredDocument } from './room-store.js'
import { interactionFingerprint, interactionId, interactionReplay, interactionRoom, retryRoomInteraction } from './room-interaction-store.js'
import type { RoomRuntimeDeps, RoomRequestState } from './room-runtime-types.js'
import type { RoomService } from './room-service.js'

/** Reminder scheduling follows the enabled agent-features flag, like proposals. */
export async function remindersEnabled(store: RoomStore): Promise<boolean> {
  return AgentFeaturesSchema.parse((await store.get('agent_features', 'features'))?.value ?? {}).reminders
}

export async function readRoomReminder(store: RoomStore, roomId: string, reminderId: string): Promise<RoomReminderEntry> {
  const row = await store.get<RoomReminder>('room_reminder', reminderId)
  if (!row || row.roomId !== roomId) throw new Error('room reminder not found')
  return { ...row.value, revision: row.revision }
}

/**
 * Scheduled reminders sort by their next fire time; ended reminders fall back
 * to most recently updated. Listing never crosses rooms or agents.
 */
export async function listRoomReminders(store: RoomStore, roomId: string, input: {
  status?: 'scheduled' | 'all'
  participantAgentId?: string
  limit?: number
}): Promise<RoomReminderEntry[]> {
  const limit = Math.min(input.limit ?? ROOM_REMINDER_LIMITS.maxList, ROOM_REMINDER_LIMITS.maxList)
  const rows = await store.list<RoomReminder>('room_reminder', {
    roomId, ...(input.participantAgentId ? { participantAgentId: input.participantAgentId } : {}),
    ...(input.status === 'scheduled' ? { status: 'scheduled' } : {}),
    limit: 1000, order: 'desc' })
  const rank = (row: RoomStoredDocument<RoomReminder>) => row.value.status === 'scheduled' ? 0 : 1
  return rows
    .sort((a, b) => rank(a) - rank(b) ||
      (a.value.status === 'scheduled' ? a.value.fireAt.localeCompare(b.value.fireAt) : b.value.updatedAt.localeCompare(a.value.updatedAt)))
    .slice(0, limit)
    .map((row) => ({ ...row.value, revision: row.revision }))
}

/** Validates one-shot timing shared by schedule and update paths. */
export function reminderFireAt(input: { delaySeconds?: number; fireAt?: string }, now: Date): string {
  const hasDelay = input.delaySeconds !== undefined, hasTime = input.fireAt !== undefined
  if (hasDelay === hasTime) throw new RoomStoreConflictError('exactly one of delaySeconds or fireAt is required')
  const at = hasDelay ? now.getTime() + input.delaySeconds! * 1000 : Date.parse(input.fireAt!)
  if (!Number.isFinite(at)) throw new RoomStoreConflictError('fireAt must be a valid timestamp')
  const delay = (at - now.getTime()) / 1000
  if (delay < ROOM_REMINDER_LIMITS.minDelaySec) {
    throw new RoomStoreConflictError(`reminders must be at least ${ROOM_REMINDER_LIMITS.minDelaySec} seconds out`)
  }
  if (delay > ROOM_REMINDER_LIMITS.maxDelaySec) {
    throw new RoomStoreConflictError('reminders cannot be scheduled more than 30 days out')
  }
  return new Date(at).toISOString()
}

/**
 * Stores one scheduled reminder. All identity fields are host-derived by the
 * calling tool; the model never supplies room, member, agent or run identity.
 */
export async function createRoomReminder(store: RoomStore, input: {
  clientRequestId: string
  roomId: string
  participantAgentId: string
  memberId: string
  note: string
  fireAt: string
  anchorMessageId?: string
  chainDepth: number
  createdByRunId: string
}): Promise<RoomReminderEntry> {
  const receipt = interactionId('reminder-create', input.roomId, input.clientRequestId)
  const fingerprint = interactionFingerprint(input)
  const replay = await interactionReplay<RoomReminderEntry>(store, receipt, fingerprint)
  if (replay) return replay
  const room = await interactionRoom(store, input.roomId)
  if (room.value.conversationKind !== 'user_agent') {
    throw new RoomStoreConflictError('reminders are only available in private agent conversations')
  }
  const member = room.value.members.find((entry) => entry.id === input.memberId)
  if (!member || member.removedAt || !member.enabled || member.participantAgentId !== input.participantAgentId) {
    throw new RoomStoreConflictError('the agent member is unavailable')
  }
  const scheduled = await store.list<RoomReminder>('room_reminder', {
    roomId: input.roomId, participantAgentId: input.participantAgentId, status: 'scheduled',
    limit: 1000 })
  if (scheduled.length >= ROOM_REMINDER_LIMITS.maxScheduledPerAgent) {
    throw new RoomStoreConflictError('scheduled reminder limit reached')
  }
  const windowEnd = new Date(Date.now() + 86400_000).toISOString()
  if (input.fireAt <= windowEnd) {
    // Bound the wakes an agent can receive in any 24-hour span: reminders that
    // already fired recently still count against the budget.
    const windowStart = new Date(Date.now() - 86400_000).toISOString()
    const fired = await store.list<RoomReminder>('room_reminder', {
      roomId: input.roomId, participantAgentId: input.participantAgentId, status: 'fired', limit: 1000 })
    const firesInWindow =
      scheduled.filter((row) => row.value.fireAt <= windowEnd).length +
      fired.filter((row) => row.value.firedAt !== undefined && row.value.firedAt >= windowStart).length
    if (firesInWindow >= ROOM_REMINDER_LIMITS.maxFiresPer24h) {
      throw new RoomStoreConflictError('too many reminders firing within a 24 hour window')
    }
  }
  if (input.anchorMessageId) {
    const anchor = await store.get<RoomMessage>('message', input.anchorMessageId)
    if (!anchor || anchor.roomId !== input.roomId) throw new RoomStoreConflictError('anchor message is outside this room')
  }
  const now = new Date().toISOString()
  const reminderId = interactionId('reminder', input.roomId, input.clientRequestId)
  const reminder = RoomReminderSchema.parse({
    schemaVersion: 1, reminderId, roomId: input.roomId,
    participantAgentId: input.participantAgentId, memberId: input.memberId,
    note: input.note, ...(input.anchorMessageId ? { anchorMessageId: input.anchorMessageId } : {}),
    fireAt: input.fireAt, status: 'scheduled', chainDepth: input.chainDepth,
    createdByRunId: input.createdByRunId, createdAt: now, updatedAt: now })
  const result: RoomReminderEntry = { ...reminder, revision: 0 }
  await store.commit({ requestId: receipt, fingerprint,
    checks: [{ kind: 'room', id: input.roomId, expectedRevision: room.revision },
      { kind: 'room_reminder', id: reminderId, expectedRevision: null }],
    puts: [{ kind: 'room_reminder', id: reminderId, roomId: input.roomId, value: reminder }],
    events: [{ roomId: input.roomId, kind: 'room.reminder.updated', payload: { reminderId } }], result })
  return result
}

/** Only a still-scheduled reminder may be edited; identity fields never move. */
export async function updateRoomReminder(store: RoomStore, roomId: string, reminderId: string, input: {
  clientRequestId: string
  note?: string
  delaySeconds?: number
  fireAt?: string
}): Promise<RoomReminderEntry> {
  const receipt = interactionId('reminder-update', roomId, reminderId, input.clientRequestId)
  const fingerprint = interactionFingerprint({ roomId, reminderId, ...input })
  return retryRoomInteraction(async () => {
    const replay = await interactionReplay<RoomReminderEntry>(store, receipt, fingerprint)
    if (replay) return replay
    const room = await interactionRoom(store, roomId)
    const row = await store.get<RoomReminder>('room_reminder', reminderId)
    if (!row || row.roomId !== roomId) throw new Error('room reminder not found')
    if (row.value.status !== 'scheduled') throw new RoomStoreConflictError('only scheduled reminders can be updated', row.revision)
    const patch: Partial<RoomReminder> = {}
    if (input.note !== undefined) patch.note = z.string().trim().min(1).max(1000).parse(input.note)
    if (input.delaySeconds !== undefined || input.fireAt !== undefined) {
      patch.fireAt = reminderFireAt({ delaySeconds: input.delaySeconds, fireAt: input.fireAt }, new Date())
    }
    if (!Object.keys(patch).length) return { ...row.value, revision: row.revision }
    const value = RoomReminderSchema.parse({ ...row.value, ...patch, updatedAt: new Date().toISOString() })
    const result: RoomReminderEntry = { ...value, revision: row.revision + 1 }
    await store.commit({ requestId: receipt, fingerprint,
      checks: [{ kind: 'room', id: roomId, expectedRevision: room.revision },
        { kind: 'room_reminder', id: reminderId, expectedRevision: row.revision }],
      puts: [{ kind: 'room_reminder', id: reminderId, roomId, value }],
      events: [{ roomId, kind: 'room.reminder.updated', payload: { reminderId } }], result })
    return result
  })
}

/**
 * Cancels a scheduled reminder. Ended reminders are never reactivated: an
 * already-cancelled entry is returned as-is, a fired/expired one rejects.
 */
export async function cancelRoomReminder(store: RoomStore, roomId: string, reminderId: string, input: {
  clientRequestId: string
  reason: 'agent_cancelled' | 'user_cancelled'
  expectedRevision?: number
}): Promise<RoomReminderEntry> {
  const receipt = interactionId('reminder-cancel', roomId, reminderId, input.clientRequestId)
  const fingerprint = interactionFingerprint({ roomId, reminderId, ...input })
  return retryRoomInteraction(async () => {
    const replay = await interactionReplay<RoomReminderEntry>(store, receipt, fingerprint)
    if (replay) return replay
    const room = await interactionRoom(store, roomId)
    const row = await store.get<RoomReminder>('room_reminder', reminderId)
    if (!row || row.roomId !== roomId) throw new Error('room reminder not found')
    if (input.expectedRevision !== undefined && row.revision !== input.expectedRevision) {
      throw new RoomStoreConflictError('reminder changed since it was read', row.revision)
    }
    if (row.value.status === 'cancelled') return { ...row.value, revision: row.revision }
    if (row.value.status !== 'scheduled') {
      throw new RoomStoreConflictError('reminder already ended', row.revision)
    }
    const value = RoomReminderSchema.parse({ ...row.value, status: 'cancelled',
      endedReason: input.reason, updatedAt: new Date().toISOString() })
    const result: RoomReminderEntry = { ...value, revision: row.revision + 1 }
    await store.commit({ requestId: receipt, fingerprint,
      checks: [{ kind: 'room', id: roomId, expectedRevision: room.revision },
        { kind: 'room_reminder', id: reminderId, expectedRevision: row.revision }],
      puts: [{ kind: 'room_reminder', id: reminderId, roomId, value }],
      events: [{ roomId, kind: 'room.reminder.updated', payload: { reminderId } }], result })
    return result
  })
}

/**
 * The visible timeline row. Request provenance lives on the request's
 * `sourceMessageId` (message ids cannot carry the colon-shaped wake request
 * id); the row itself links back through `reminderId` and `originRunId`.
 */
function reminderPresentation(roomId: string, reminder: RoomReminder, now: string) {
  const messageId = interactionId('reminder-message', reminder.reminderId)
  return RoomMessageSchema.parse({
    id: messageId, roomId, messageSeq: 1, originRunId: reminder.createdByRunId,
    authorKind: 'system', authorLabelSnapshot: 'Kun',
    presentationKind: 'reminder', reminderId: reminder.reminderId,
    body: reminder.note, bodyRevision: 0, mentionMemberIds: [], attachmentIds: [],
    status: 'final', createdAt: now })
}

/** Marks a due reminder expired with a durable reason inside a single CAS commit. */
async function expireRoomReminder(store: RoomStore, row: RoomStoredDocument<RoomReminder>,
  reason: 'room_archived' | 'agent_unavailable' | 'too_late', notify: boolean, now: string): Promise<void> {
  const roomId = row.roomId ?? row.value.roomId
  const value = RoomReminderSchema.parse({ ...row.value, status: 'expired', endedReason: reason, updatedAt: now })
  const message = notify ? reminderPresentation(roomId, row.value, now) : null
  try {
    await store.commit({ requestId: interactionId('reminder-expire', row.id, reason, String(row.revision)),
      checks: [{ kind: 'room_reminder', id: row.id, expectedRevision: row.revision },
        ...(message ? [{ kind: 'message' as const, id: message.id, expectedRevision: null }] : [])],
      puts: [{ kind: 'room_reminder', id: row.id, roomId, value },
        ...(message ? [{ kind: 'message' as const, id: message.id, roomId, value: message }] : [])],
      events: [{ roomId, kind: 'room.reminder.updated', payload: { reminderId: row.id } },
        ...(message ? [{ roomId, kind: 'message.presentation.created',
          payload: { id: message.id, presentationKind: 'reminder' } }] : [])] })
  } catch (error) {
    if (!(error instanceof RoomStoreConflictError)) throw error
  }
}

/**
 * Fires every scheduled reminder whose time arrived. Firing is one atomic
 * commit — reminder, presentation message and the pending private request —
 * keyed by `reminder-fire:<reminderId>`, so replay and restart never duplicate
 * a wake-up. Reminders never fire while the application is closed; overdue
 * ones are reconciled here by the lateness rules instead.
 */
export async function fireDueRoomReminders(deps: RoomRuntimeDeps, service: RoomService, now: string): Promise<void> {
  const scheduled = await deps.store.list<RoomReminder>('room_reminder', { status: 'scheduled', limit: 1000, order: 'asc' })
  const due = scheduled.filter((row) => row.value.fireAt <= now)
    .sort((a, b) => a.value.fireAt.localeCompare(b.value.fireAt))
    .slice(0, ROOM_REMINDER_LIMITS.maxFireBatch)
  for (const row of due) {
    try { await fireRoomReminder(deps, service, row, now) }
    catch (error) { console.warn('[kun] room reminder', row.id, error instanceof Error ? error.message : String(error)) }
  }
}

async function fireRoomReminder(deps: RoomRuntimeDeps, service: RoomService,
  row: RoomStoredDocument<RoomReminder>, now: string): Promise<void> {
  const reminder = row.value
  const roomId = row.roomId ?? reminder.roomId
  const lateSeconds = Math.max(0, Math.floor((Date.parse(now) - Date.parse(reminder.fireAt)) / 1000))
  const room = await deps.store.get<Room>('room', roomId)
  if (!room || room.value.archivedAt) return expireRoomReminder(deps.store, row, 'room_archived', false, now)
  const member = room.value.members.find((entry) => entry.id === reminder.memberId)
  const agent = await deps.store.get<AgentIdentity>('agent_identity', reminder.participantAgentId)
  // The private runner always wakes the room's default member; a reminder
  // bound to anyone else can no longer reach its agent.
  if (room.value.conversationKind !== 'user_agent' || !agent || agent.value.archivedAt ||
    !member || member.removedAt || !member.enabled || member.id !== room.value.defaultMemberId ||
    member.participantAgentId !== reminder.participantAgentId) {
    return expireRoomReminder(deps.store, row, 'agent_unavailable', false, now)
  }
  if (lateSeconds > ROOM_REMINDER_LIMITS.maxLatenessSec) {
    return expireRoomReminder(deps.store, row, 'too_late', true, now)
  }
  const requestId = 'reminder-fire:' + reminder.reminderId
  const message = reminderPresentation(roomId, reminder, now)
  let request: RoomRequestState
  try {
    const frozen = deps.agentDirectory ? await deps.agentDirectory.freeze(room.value) : room.value
    request = await service.privateDirectRequest(frozen, {
    requestId, rootRequestId: requestId,
    message: SendRoomMessageSchema.parse({
      clientRequestId: interactionId('reminder-fire', reminder.reminderId),
      body: reminder.note, mentionMemberIds: [], attachmentIds: [] }),
    sourceMessageId: message.id,
    privateReminder: {
      reminderId: reminder.reminderId, chainDepth: reminder.chainDepth,
      scheduledFor: reminder.fireAt, lateSeconds }
    })
  } catch (error) {
    // Permission or snapshot failures mean the agent can no longer act here.
    if (error instanceof RoomStoreConflictError) return expireRoomReminder(deps.store, row, 'agent_unavailable', false, now)
    throw error
  }
  const fired = RoomReminderSchema.parse({ ...reminder, status: 'fired',
    firedAt: now, firedRequestId: requestId, updatedAt: now })
  try {
    await deps.store.commit({ requestId,
      checks: [{ kind: 'room_reminder', id: row.id, expectedRevision: row.revision },
        { kind: 'room', id: roomId, expectedRevision: room.revision },
        { kind: 'message', id: message.id, expectedRevision: null },
        { kind: 'request', id: requestId, expectedRevision: null }],
      puts: [{ kind: 'room_reminder', id: row.id, roomId, value: fired },
        { kind: 'message', id: message.id, roomId, value: message },
        { kind: 'request', id: requestId, roomId, value: request }],
      events: [{ roomId, kind: 'message.presentation.created', payload: { id: message.id, presentationKind: 'reminder' } },
        { roomId, kind: 'request.updated', payload: { id: requestId } },
        { roomId, kind: 'room.reminder.updated', payload: { reminderId: row.id } }] })
  } catch (error) {
    // A concurrent cancellation or a previous firing wins; replay is silent.
    if (!(error instanceof RoomStoreConflictError)) throw error
  }
}
