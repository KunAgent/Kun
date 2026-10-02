import { AgentFeaturesSchema, type AgentIdentity } from '../contracts/agent-identities.js'
import { ROOM_REMINDER_LIMITS, RoomReminderSchema, type RoomReminder } from '../contracts/room-reminders.js'
import { RoomMessageSchema, SendRoomMessageSchema, type Room } from '../contracts/rooms.js'
import { RoomStoreConflictError, type RoomStore, type RoomStoredDocument } from './room-store.js'
import { interactionId } from './room-interaction-store.js'
import type { RoomRuntimeDeps, RoomRequestState } from './room-runtime-types.js'
import type { RoomService } from './room-service.js'
import { reminderBudget, reminderRows } from './room-reminder-budget.js'
import { nextReminderOccurrence, quietHoursEnd } from './room-reminder-schedule.js'
import { checkReminderTrigger } from './room-reminder-triggers.js'

function occurrenceId(reminder: RoomReminder) {
  return (reminder.occurrence ?? 0) === 0 ? reminder.reminderId : `${reminder.reminderId}:${reminder.occurrence}`
}
function reminderPresentation(roomId: string, reminder: RoomReminder, now: string) {
  return RoomMessageSchema.parse({
    id: interactionId('reminder-message', occurrenceId(reminder)), roomId,
    messageSeq: 1, originRunId: reminder.createdByRunId,
    authorKind: 'system', authorLabelSnapshot: 'Kun',
    presentationKind: 'reminder', reminderId: reminder.reminderId,
    body: reminder.note, bodyRevision: 0, mentionMemberIds: [], attachmentIds: [],
    status: 'final', createdAt: now })
}
async function expireRoomReminder(store: RoomStore, row: RoomStoredDocument<RoomReminder>,
  reason: RoomReminder['endedReason'], notify: boolean, now: string): Promise<void> {
  const roomId = row.roomId ?? row.value.roomId
  const value = RoomReminderSchema.parse({ ...row.value, status: 'expired', endedReason: reason, updatedAt: now })
  const message = notify ? reminderPresentation(roomId, row.value, now) : null
  await store.commit({ requestId: interactionId('reminder-expire', row.id, reason, String(row.revision)),
    checks: [{ kind: 'room_reminder', id: row.id, expectedRevision: row.revision },
      ...(message ? [{ kind: 'message' as const, id: message.id, expectedRevision: null }] : [])],
    puts: [{ kind: 'room_reminder', id: row.id, roomId, value },
      ...(message ? [{ kind: 'message' as const, id: message.id, roomId, value: message }] : [])],
    events: [{ roomId, kind: 'room.reminder.updated', payload: { reminderId: row.id } },
      ...(message ? [{ roomId, kind: 'message.presentation.created',
        payload: { id: message.id, presentationKind: 'reminder' } }] : [])] })
}
async function deferReminder(store: RoomStore, row: RoomStoredDocument<RoomReminder>, now: string,
  fireAt: string, deferredReason: RoomReminder['deferredReason']) {
  await store.commit({ requestId: interactionId('reminder-defer', row.id, row.revision),
    checks: [{ kind: 'room_reminder', id: row.id, expectedRevision: row.revision }],
    puts: [{ kind: 'room_reminder', id: row.id, roomId: row.value.roomId,
      value: RoomReminderSchema.parse({ ...row.value, fireAt, deferredReason, updatedAt: now }) }],
    events: [{ roomId: row.value.roomId, kind: 'room.reminder.updated', payload: { reminderId: row.id } }] })
}

/** Durable current-state checks run before every occurrence, including after restart. */
async function fireRoomReminder(deps: RoomRuntimeDeps, service: RoomService,
  row: RoomStoredDocument<RoomReminder>, now: string): Promise<boolean> {
  const reminder = row.value, roomId = reminder.roomId
  const lateSeconds = Math.max(0, Math.floor((Date.parse(now) - Date.parse(reminder.fireAt)) / 1000))
  const room = await deps.store.get<Room>('room', roomId)
  if (!room || room.value.archivedAt) {
    await expireRoomReminder(deps.store, row, 'room_archived', false, now); return false
  }
  const member = room.value.members.find((entry) => entry.id === reminder.memberId)
  const agent = await deps.store.get<AgentIdentity>('agent_identity', reminder.participantAgentId)
  if (room.value.conversationKind !== 'user_agent' || !agent || agent.value.archivedAt ||
    !member || member.removedAt || !member.enabled || member.id !== room.value.defaultMemberId ||
    member.participantAgentId !== reminder.participantAgentId) {
    await expireRoomReminder(deps.store, row, 'agent_unavailable', false, now); return false
  }
  if (reminder.maxOccurrences && (reminder.occurrence ?? 0) >= reminder.maxOccurrences) {
    await expireRoomReminder(deps.store, row, 'schedule_complete', false, now); return false
  }
  if (reminder.expiresAt && Date.parse(now) >= Date.parse(reminder.expiresAt)) {
    await expireRoomReminder(deps.store, row, 'condition_expired', false, now); return false
  }
  if (lateSeconds > ROOM_REMINDER_LIMITS.maxLatenessSec) {
    if (!reminder.recurrence) {
      await expireRoomReminder(deps.store, row, 'too_late', true, now); return false
    }
    // Skip missed occurrences rather than replaying a backlog on restart.
    await deferReminder(deps.store, row, now, nextReminderOccurrence(reminder, now)!, undefined)
    return false
  }
  const features = await deps.store.get('agent_features', 'features')
  const pollAt = new Date(Date.parse(now) + ROOM_REMINDER_LIMITS.conditionPollSec * 1000).toISOString()
  if (!AgentFeaturesSchema.parse(features?.value ?? {}).reminders) {
    await deferReminder(deps.store, row, now, pollAt, 'feature_disabled'); return false
  }
  const quietUntil = quietHoursEnd(reminder, now)
  if (quietUntil) {
    await deferReminder(deps.store, row, now, quietUntil, 'quiet_hours'); return false
  }
  const condition = await checkReminderTrigger(deps.store, reminder, now)
  if (!condition.ready) {
    await deferReminder(deps.store, row, now, pollAt, 'condition_pending'); return false
  }
  const budget = await reminderBudget(deps.store, reminder.participantAgentId, now)
  if (budget.nextAvailable) {
    await deferReminder(deps.store, row, now, budget.nextAvailable, 'fire_budget'); return false
  }
  const requestId = 'reminder-fire:' + occurrenceId(reminder)
  const message = reminderPresentation(roomId, reminder, now)
  let request: RoomRequestState
  try {
    const frozen = deps.agentDirectory ? await deps.agentDirectory.freeze(room.value) : room.value
    request = await service.privateDirectRequest(frozen, {
      requestId, rootRequestId: requestId,
      message: SendRoomMessageSchema.parse({
        clientRequestId: interactionId('reminder-fire', occurrenceId(reminder)),
        body: reminder.note, mentionMemberIds: [], attachmentIds: [] }),
      sourceMessageId: message.id,
      privateReminder: { reminderId: reminder.reminderId, chainDepth: reminder.chainDepth,
        scheduledFor: reminder.fireAt, lateSeconds, occurrence: reminder.occurrence ?? 0 }
    })
  } catch (error) {
    if (error instanceof RoomStoreConflictError) {
      await expireRoomReminder(deps.store, row, 'agent_unavailable', false, now); return false
    }
    throw error
  }
  request.clientSurface = reminder.clientSurface
  request.imConnectionId = reminder.imConnectionId
  const occurrence = (reminder.occurrence ?? 0) + 1
  const next = nextReminderOccurrence(reminder, now)
  const continueSchedule = next && (!reminder.maxOccurrences || occurrence < reminder.maxOccurrences) &&
    (!reminder.expiresAt || Date.parse(next) < Date.parse(reminder.expiresAt))
  const value = RoomReminderSchema.parse({ ...reminder, status: continueSchedule ? 'scheduled' : 'fired',
    fireAt: continueSchedule ? next : reminder.fireAt, occurrence,
    triggerCursor: condition.cursor ?? reminder.triggerCursor, deferredReason: undefined,
    endedReason: !continueSchedule && reminder.recurrence ? 'schedule_complete' : undefined,
    firedAt: now, firedRequestId: requestId, updatedAt: now })
  budget.value.fires.push({ id: requestId, at: now })
  await deps.store.commit({ requestId,
    checks: [budget.check, { kind: 'room_reminder', id: row.id, expectedRevision: row.revision },
      { kind: 'room', id: roomId, expectedRevision: room.revision },
      { kind: 'agent_identity', id: agent.id, expectedRevision: agent.revision },
      { kind: 'agent_features', id: 'features', expectedRevision: features?.revision ?? null },
      { kind: 'message', id: message.id, expectedRevision: null },
      { kind: 'request', id: requestId, expectedRevision: null }],
    puts: [budget.put, { kind: 'room_reminder', id: row.id, roomId, value },
      { kind: 'message', id: message.id, roomId, value: message },
      { kind: 'request', id: requestId, roomId, value: request }],
    events: [{ roomId, kind: 'message.presentation.created', payload: { id: message.id, presentationKind: 'reminder' } },
      { roomId, kind: 'request.updated', payload: { id: requestId } },
      { roomId, kind: 'room.reminder.updated', payload: { reminderId: row.id } }] })
  return true
}

/** Keeps the existing runtime tick contract; next wake includes deferred/recurring rows. */
export async function fireDueRoomReminders(deps: RoomRuntimeDeps, service: RoomService,
  now: string): Promise<{ fired: number; nextFireAt?: string }> {
  const scheduled = await reminderRows(deps.store, { status: 'scheduled' })
  const nextCheck = (reminder: RoomReminder) => reminder.expiresAt && Date.parse(reminder.expiresAt) < Date.parse(reminder.fireAt)
    ? reminder.expiresAt : reminder.fireAt
  const due = scheduled.filter((row) => Date.parse(nextCheck(row.value)) <= Date.parse(now))
    .sort((a, b) => Date.parse(a.value.fireAt) - Date.parse(b.value.fireAt))
    .slice(0, ROOM_REMINDER_LIMITS.maxFireBatch)
  let fired = 0
  for (const row of due) {
    try { if (await fireRoomReminder(deps, service, row, now)) fired++ }
    catch (error) {
      // A concurrent cancel, pause, edit or feature change always wins.
      if (!(error instanceof RoomStoreConflictError)) {
        console.warn('[kun] room reminder', row.id, error instanceof Error ? error.message : String(error))
      }
    }
  }
  const pending = await reminderRows(deps.store, { status: 'scheduled' })
  return { fired, nextFireAt: pending.map((row) => nextCheck(row.value)).sort((a, b) => Date.parse(a) - Date.parse(b))[0] }
}
