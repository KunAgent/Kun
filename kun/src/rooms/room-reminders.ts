import { z } from 'zod'
import { AgentFeaturesSchema } from '../contracts/agent-identities.js'
import { ROOM_REMINDER_LIMITS, RoomReminderSchema,
  RoomReminderOptionsShape, type RoomReminderOptions, type RoomReminder, type RoomReminderEntry } from '../contracts/room-reminders.js'
import { type RoomMessage } from '../contracts/rooms.js'
import { RoomStoreConflictError, type RoomStore, type RoomStoredDocument } from './room-store.js'
import { interactionFingerprint, interactionId, interactionReplay, interactionRoom, retryRoomInteraction } from './room-interaction-store.js'
import { assertReminderCapacity, reminderBudget, reminderRows } from './room-reminder-budget.js'
import { reminderFireAt, validateReminderOptions, nextReminderOccurrence } from './room-reminder-schedule.js'
export { reminderFireAt } from './room-reminder-schedule.js'
export { fireDueRoomReminders } from './room-reminder-execution.js'

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
  status?: 'scheduled' | 'paused' | 'all'
  participantAgentId?: string
  limit?: number
}): Promise<RoomReminderEntry[]> {
  const limit = Math.min(input.limit ?? ROOM_REMINDER_LIMITS.maxList, ROOM_REMINDER_LIMITS.maxList)
  const rows = await reminderRows(store, {
    roomId, ...(input.participantAgentId ? { participantAgentId: input.participantAgentId } : {}),
    ...(input.status && input.status !== 'all' ? { status: input.status } : {}) })
  const rank = (row: RoomStoredDocument<RoomReminder>) => ['scheduled', 'paused'].includes(row.value.status) ? 0 : 1
  return rows
    .sort((a, b) => rank(a) - rank(b) ||
      (a.value.status === 'scheduled' ? a.value.fireAt.localeCompare(b.value.fireAt) : b.value.updatedAt.localeCompare(a.value.updatedAt)))
    .slice(0, limit)
    .map((row) => ({ ...row.value, revision: row.revision }))
}

/**
 * Stores one scheduled reminder. All identity fields are host-derived by the
 * calling tool; the model never supplies room, member, agent or run identity.
 */
export async function createRoomReminder(store: RoomStore, input: RoomReminderOptions & {
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
  return retryRoomInteraction(async () => {
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
    if (input.anchorMessageId) {
      const anchor = await store.get<RoomMessage>('message', input.anchorMessageId)
      if (!anchor || anchor.roomId !== input.roomId) throw new RoomStoreConflictError('anchor message is outside this room')
    }
    const now = new Date().toISOString()
    const reminderId = interactionId('reminder', input.roomId, input.clientRequestId)
    const options = validateReminderOptions(Object.fromEntries(Object.keys(RoomReminderOptionsShape)
      .filter((key) => input[key as keyof RoomReminderOptions] !== undefined)
      .map((key) => [key, input[key as keyof RoomReminderOptions]])))
    const latest = input.trigger?.kind === 'message'
      ? (await store.list('message', { roomId: input.roomId, limit: 1 }))[0]?.seq ?? 0 : undefined
    const reminder = RoomReminderSchema.parse({
      schemaVersion: 1, reminderId, roomId: input.roomId,
      participantAgentId: input.participantAgentId, memberId: input.memberId,
      note: input.note, ...(input.anchorMessageId ? { anchorMessageId: input.anchorMessageId } : {}),
      ...options, triggerCursor: latest, occurrence: 0,
      fireAt: new Date(input.fireAt).toISOString(), status: 'scheduled', chainDepth: input.chainDepth,
      createdByRunId: input.createdByRunId, createdAt: now, updatedAt: now })
    const budget = await reminderBudget(store, input.participantAgentId, now)
    assertReminderCapacity(budget, reminder, now)
    const result: RoomReminderEntry = { ...reminder, revision: 0 }
    await store.commit({ requestId: receipt, fingerprint,
      checks: [budget.check, { kind: 'room', id: input.roomId, expectedRevision: room.revision },
        { kind: 'room_reminder', id: reminderId, expectedRevision: null }],
      puts: [budget.put, { kind: 'room_reminder', id: reminderId, roomId: input.roomId, value: reminder }],
      events: [{ roomId: input.roomId, kind: 'room.reminder.updated', payload: { reminderId } }], result })
    return result
  })
}

/** Only a still-scheduled reminder may be edited; identity fields never move. */
export async function updateRoomReminder(store: RoomStore, roomId: string, reminderId: string, input: RoomReminderOptions & {
  clientRequestId: string
  expectedRevision?: number
  paused?: boolean
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
    if (!['scheduled', 'paused'].includes(row.value.status)) throw new RoomStoreConflictError('only scheduled or paused reminders can be updated', row.revision)
    if (input.expectedRevision !== undefined && input.expectedRevision !== row.revision) {
      throw new RoomStoreConflictError('reminder changed since it was read', row.revision)
    }
    const patch: Partial<RoomReminder> = {}
    for (const key of Object.keys(RoomReminderOptionsShape)) {
      if (input[key as keyof RoomReminderOptions] !== undefined) Object.assign(patch, { [key]: input[key as keyof RoomReminderOptions] })
    }
    if (input.trigger?.kind === 'message' && JSON.stringify(input.trigger) !== JSON.stringify(row.value.trigger)) {
      patch.triggerCursor = (await store.list('message', { roomId, limit: 1 }))[0]?.seq ?? 0
    }
    if (input.paused !== undefined) patch.status = input.paused ? 'paused' : 'scheduled'
    if (input.paused === false && Date.parse(row.value.fireAt) <= Date.now()) {
      patch.fireAt = nextReminderOccurrence({ ...row.value, ...patch }, new Date().toISOString())
        ?? new Date(Date.now() + ROOM_REMINDER_LIMITS.minDelaySec * 1000).toISOString()
    }
    if ((input.recurrence !== undefined || (input.timezone !== undefined && row.value.recurrence)) &&
      input.delaySeconds === undefined && input.fireAt === undefined) {
      patch.fireAt = reminderFireAt({ ...row.value, ...patch, fireAt: undefined }, new Date())
    }
    if (input.note !== undefined) patch.note = z.string().trim().min(1).max(1000).parse(input.note)
    if (input.delaySeconds !== undefined || input.fireAt !== undefined) {
      patch.fireAt = reminderFireAt({ delaySeconds: input.delaySeconds, fireAt: input.fireAt }, new Date())
    }
    if (!Object.keys(patch).length) return { ...row.value, revision: row.revision }
    const now = new Date().toISOString()
    const options = Object.fromEntries(Object.keys(RoomReminderOptionsShape).map((key) =>
      [key, ({ ...row.value, ...patch })[key as keyof RoomReminderOptions]]))
    validateReminderOptions(options)
    const value = RoomReminderSchema.parse({ ...row.value, ...patch, deferredReason: undefined, updatedAt: now })
    const budget = await reminderBudget(store, value.participantAgentId, now)
    assertReminderCapacity(budget, value, now)
    const result: RoomReminderEntry = { ...value, revision: row.revision + 1 }
    await store.commit({ requestId: receipt, fingerprint,
      checks: [budget.check, { kind: 'room', id: roomId, expectedRevision: room.revision },
        { kind: 'room_reminder', id: reminderId, expectedRevision: row.revision }],
      puts: [budget.put, { kind: 'room_reminder', id: reminderId, roomId, value }],
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
    if (!['scheduled', 'paused'].includes(row.value.status)) {
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
